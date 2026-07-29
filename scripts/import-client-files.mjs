// Mirrors a client's markdown artefacts into Cloud SQL.
//
// Reads diary/YYYY-MM.md and open-items.md from the client folder, parses them
// with the module's own parsers (the same code the file watcher uses), and
// writes finance.diary_entries and finance.open_items.
//
// Write semantics differ per table, and deliberately so:
//
//   diary_entries  replaced wholesale per source file, inside one transaction.
//                  It is a pure mirror, nothing acts on it, and replacement is
//                  the only way edits and deletions propagate correctly.
//
//   open_items     upserted on (client_id, source_file, ref), then any ref no
//                  longer present in the file is deleted. Rows keep stable ids
//                  because later phases will act on them.
//
// Usage:
//   node scripts/import-client-files.mjs [--client <slug>] [--folder <path>] [--dry-run]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { connect } from "./db.mjs";
import { parseDiary } from "../src/modules/finance/lib/parse-diary.ts";
import { parseOpenItems } from "../src/modules/finance/lib/parse-open-items.ts";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// UTF-8 explicit on every read. These files contain pound signs, and reading
// them as cp1252 corrupts them (Feldspar CLAUDE.md rule 12).
const readUtf8 = (p) => readFileSync(p, "utf-8").replace(/^﻿/, "");

export function collect(folder) {
  const diaryDir = join(folder, "diary");
  const diary = [];

  if (existsSync(diaryDir)) {
    for (const f of readdirSync(diaryDir).filter((x) => x.endsWith(".md")).sort()) {
      const rel = `diary/${f}`;
      diary.push({ sourceFile: rel, entries: parseDiary(readUtf8(join(diaryDir, f)), rel) });
    }
  }

  const openItemsPath = join(folder, "open-items.md");
  const openItems = existsSync(openItemsPath)
    ? parseOpenItems(readUtf8(openItemsPath), "open-items.md")
    : [];

  return { diary, openItems };
}

async function main() {
  const slug = arg("--client", "feldspar-sport-group");
  const folder = arg("--folder", null);
  const dryRun = process.argv.includes("--dry-run");

  const { client, release } = dryRun
    ? { client: null, release: async () => {} }
    : await connect();

  try {
    let clientId = null;
    let resolvedFolder = folder;

    if (client) {
      const { rows } = await client.query(
        "SELECT id, folder_path FROM shared.clients WHERE slug = $1",
        [slug]
      );
      if (!rows.length) throw new Error(`no client in shared.clients with slug '${slug}'`);
      clientId = rows[0].id;
      resolvedFolder = folder ?? rows[0].folder_path;
    }

    if (!resolvedFolder) throw new Error("no folder given and none on the client record");
    if (!existsSync(resolvedFolder)) throw new Error(`folder not found: ${resolvedFolder}`);

    console.log(`Client: ${slug}`);
    console.log(`Folder: ${resolvedFolder}\n`);

    const { diary, openItems } = collect(resolvedFolder);

    for (const d of diary) {
      const undated = d.entries.filter((e) => !e.occurredAt).length;
      const monthOnly = d.entries.filter((e) => e.occurredPrecision === "month").length;
      console.log(
        `  ${d.sourceFile.padEnd(22)} ${String(d.entries.length).padStart(3)} entries` +
          (monthOnly ? `  (${monthOnly} month-only)` : "") +
          (undated ? `  (${undated} undated)` : "")
      );
    }

    const active = openItems.filter((i) => !i.isClosed).length;
    console.log(
      `  ${"open-items.md".padEnd(22)} ${String(openItems.length).padStart(3)} items` +
        `  (${active} active, ${openItems.length - active} closed)`
    );

    if (dryRun) {
      console.log("\n--- diary sample ---");
      for (const e of (diary[diary.length - 1]?.entries ?? []).slice(0, 3)) {
        console.log(`  ${e.occurredAt} [${e.occurredPrecision}] role=${e.role} name=${e.agentName}`);
        console.log(`    ${e.action.slice(0, 90).replace(/\s+/g, " ")}`);
      }
      console.log("\n--- open items sample ---");
      for (const i of openItems.slice(0, 3)) {
        console.log(`  #${i.ref} [${i.priority ?? "-"}] ${i.status ?? "-"} | ${i.category ?? "-"}`);
        console.log(`    ${i.title.slice(0, 90).replace(/\s+/g, " ")}`);
      }
      console.log("\nDry run. Nothing written.");
      return;
    }

    await client.query("BEGIN");

    let diaryRows = 0;
    for (const d of diary) {
      // Same advisory lock the API sync endpoint takes, so a manual import run
      // while the watcher is active cannot race it into duplicate rows.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `finance.diary:${clientId}:${d.sourceFile}`,
      ]);
      await client.query(
        "DELETE FROM finance.diary_entries WHERE client_id = $1 AND source_file = $2",
        [clientId, d.sourceFile]
      );
      for (const e of d.entries) {
        await client.query(
          `INSERT INTO finance.diary_entries
             (client_id, occurred_at, occurred_precision, role, agent_name, action,
              where_path, status, notes, heading, source_file, source_line)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [clientId, e.occurredAt, e.occurredPrecision, e.role, e.agentName, e.action,
           e.wherePath, e.status, e.notes, e.heading, e.sourceFile, e.sourceLine]
        );
        diaryRows++;
      }
    }

    for (const i of openItems) {
      await client.query(
        `INSERT INTO finance.open_items
           (client_id, ref, title, category, owner_label, priority, status,
            raised_at, last_update_at, closed_at, resolution, is_closed,
            source_file, source_line)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (client_id, source_file, ref) DO UPDATE SET
           title          = EXCLUDED.title,
           category       = EXCLUDED.category,
           owner_label    = EXCLUDED.owner_label,
           priority       = EXCLUDED.priority,
           status         = EXCLUDED.status,
           raised_at      = EXCLUDED.raised_at,
           last_update_at = EXCLUDED.last_update_at,
           closed_at      = EXCLUDED.closed_at,
           resolution     = EXCLUDED.resolution,
           is_closed      = EXCLUDED.is_closed,
           source_line    = EXCLUDED.source_line`,
        [clientId, i.ref, i.title, i.category, i.ownerLabel, i.priority, i.status,
         i.raisedAt, i.lastUpdateAt, i.closedAt, i.resolution, i.isClosed,
         i.sourceFile, i.sourceLine]
      );
    }

    // Drop items that have gone from the register.
    const refs = openItems.map((i) => i.ref);
    const removed = await client.query(
      `DELETE FROM finance.open_items
       WHERE client_id = $1 AND source_file = 'open-items.md'
         AND NOT (ref = ANY($2::text[]))
       RETURNING ref`,
      [clientId, refs]
    );

    await client.query("COMMIT");

    console.log(`\nWrote ${diaryRows} diary entries and ${openItems.length} open items.`);
    if (removed.rowCount) {
      console.log(`Removed ${removed.rowCount} open item(s) no longer in the file: ` +
        removed.rows.map((r) => r.ref).join(", "));
    }
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await release();
  }
}

main().catch((e) => {
  console.error("\nImport failed:", e.message);
  process.exit(1);
});

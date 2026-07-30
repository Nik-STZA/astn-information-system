// Scans a client's WIP folders and mirrors them into finance.wip_items and
// finance.wip_review_log.
//
// Keyed on the ref in each folder's wip.json, never on the path, because the
// lifecycle of an item is moving its folder between state directories.
//
// A folder that fails to parse is reported and skipped rather than silently
// ignored: an unreadable item is work that will never reach the queue, which
// is worse than a loud error.
//
// Usage:
//   node scripts/import-wip.mjs [--client <slug>] [--dry-run]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { connect } from "./db.mjs";
import { parseWipFolder } from "../src/modules/finance/lib/parse-wip.ts";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const readUtf8 = (p) => readFileSync(p, "utf-8").replace(/^﻿/, "");

// A WIP folder is any directory containing a wip.json.
function findWipFolders(clientRoot) {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      if (existsSync(join(path, "wip.json"))) found.push(path);
      else walk(path);
    }
  };
  walk(join(clientRoot, "wip"));
  const entities = join(clientRoot, "entities");
  if (existsSync(entities)) {
    for (const e of readdirSync(entities)) {
      walk(join(entities, e, "wip"));
    }
  }
  return found;
}

async function main() {
  const slug = arg("--client", "feldspar-sport-group");
  const dryRun = process.argv.includes("--dry-run");

  const { client, release } = await connect();
  try {
    const { rows } = await client.query(
      "SELECT id, folder_path FROM shared.clients WHERE slug = $1",
      [slug]
    );
    if (!rows.length) throw new Error(`no client with slug '${slug}'`);
    const clientId = rows[0].id;
    const clientRoot = rows[0].folder_path;

    const { rows: entityRows } = await client.query(
      "SELECT id, slug FROM finance.entities WHERE client_id = $1",
      [clientId]
    );
    const entityIdBySlug = new Map(entityRows.map((r) => [r.slug, r.id]));

    console.log(`Client: ${slug}`);
    console.log(`Folder: ${clientRoot}\n`);

    const folders = findWipFolders(clientRoot);
    const items = [];
    const failures = [];

    for (const abs of folders) {
      const rel = relative(clientRoot, abs).replace(/\\/g, "/");
      try {
        items.push(
          parseWipFolder({
            relativePath: rel,
            manifestJson: readUtf8(join(abs, "wip.json")),
            reviewMarkdown: existsSync(join(abs, "review.md"))
              ? readUtf8(join(abs, "review.md"))
              : "",
          })
        );
      } catch (e) {
        failures.push(`${rel}: ${e.message}`);
      }
    }

    const byPanel = items.reduce((acc, i) => {
      acc[i.panel] = (acc[i.panel] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`${items.length} item(s) parsed:`);
    for (const [panel, n] of Object.entries(byPanel)) console.log(`  ${panel.padEnd(22)} ${n}`);

    if (failures.length) {
      console.log(`\n${failures.length} folder(s) could NOT be read:`);
      failures.forEach((f) => console.log(`  ${f}`));
    }

    if (dryRun) {
      console.log("\nDry run. Nothing written.");
      return;
    }

    await client.query("BEGIN");

    for (const item of items) {
      const entityId = item.entity ? entityIdBySlug.get(item.entity) ?? null : null;
      if (item.entity && !entityId) {
        throw new Error(`item ${item.ref} names entity '${item.entity}' which is not registered`);
      }

      const res = await client.query(
        `INSERT INTO finance.wip_items
           (client_id, entity_id, entity_scope, ref, type, status, panel, priority,
            folder_path, state_path, drafter_role, title, amount_total, due_at,
            blocked_on, drafted_at, tier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (client_id, ref) DO UPDATE SET
           entity_id    = EXCLUDED.entity_id,
           entity_scope = EXCLUDED.entity_scope,
           type         = EXCLUDED.type,
           status       = EXCLUDED.status,
           panel        = EXCLUDED.panel,
           priority     = EXCLUDED.priority,
           folder_path  = EXCLUDED.folder_path,
           state_path   = EXCLUDED.state_path,
           drafter_role = EXCLUDED.drafter_role,
           title        = EXCLUDED.title,
           amount_total = EXCLUDED.amount_total,
           due_at       = EXCLUDED.due_at,
           blocked_on   = EXCLUDED.blocked_on,
           drafted_at   = EXCLUDED.drafted_at,
           tier         = EXCLUDED.tier
         RETURNING id`,
        [
          clientId, entityId, item.entityScope, item.ref, item.type, item.state,
          item.panel, item.priority, item.folderPath, item.state, item.drafterRole,
          item.title, item.amountTotal, item.dueAt, item.blockedOn, item.draftedAt,
          item.tier,
        ]
      );
      const wipId = res.rows[0].id;

      // The review chain is rebuilt from the file, which is append only and
      // therefore authoritative.
      await client.query("DELETE FROM finance.wip_review_log WHERE wip_id = $1", [wipId]);
      for (const r of item.reviews) {
        await client.query(
          `INSERT INTO finance.wip_review_log
             (wip_id, reviewer_role, outcome, findings, notes, next_step, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [wipId, r.reviewerRole, r.outcome ?? "Noted",
           JSON.stringify(r.findings), r.notes, r.nextStep, r.reviewedAt]
        );
      }
    }

    // Items whose folder has gone are no longer work.
    const refs = items.map((i) => i.ref);
    const removed = await client.query(
      `DELETE FROM finance.wip_items
       WHERE client_id = $1 AND NOT (ref = ANY($2::text[])) RETURNING ref`,
      [clientId, refs]
    );

    await client.query("COMMIT");

    console.log(`\nWrote ${items.length} item(s).`);
    if (removed.rowCount) console.log(`Removed ${removed.rowCount} item(s) no longer on disk.`);
    if (failures.length) process.exitCode = 1;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await release();
  }
}

main().catch((e) => {
  console.error("\nImport failed:", e.message);
  process.exit(1);
});

// Composes a client's balance sheet ownership matrix from its actual trial
// balance.
//
// The skill says compose from the client's real balance sheet rather than
// stamping the master, because permanently blank rows train the reader to skim
// past blanks — which is what hides the row that went blank this month for a
// real reason. This does that composition.
//
// It maps only what it can identify with confidence and lists everything else
// as unmapped, rather than placing accounts by guesswork. An ownership matrix
// with a confidently wrong owner is worse than one with a visible gap.
//
// No model. Grouping a trial balance to known lines is deterministic work, and
// a script does it reproducibly, testably and for nothing. What an agent adds
// is upstream and downstream of this: whether a line is material, whether it
// needs a register, what the judgement rows actually require.
//
// Usage:
//   node scripts/compose-matrix.mjs --client stza [--as-at 2026-07-31] [--dry-run]

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./db.mjs";

const PROJECT = "africanstn-research";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function gcloud(args) {
  const cmd = ["gcloud", ...args]
    .map((a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(" ");
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const readSecret = (name) =>
  gcloud(["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT}`]);

async function xeroAccessToken(secretName) {
  const refreshToken = readSecret(secretName);
  const basic = Buffer.from(
    `${readSecret("xero-app-client-id")}:${readSecret("xero-app-client-secret")}`
  ).toString("base64");
  const r = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!r.ok) throw new Error(`Xero refused the token refresh (${r.status}). Reconnect the entity.`);
  const tokens = await r.json();
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    execSync(`gcloud secrets versions add ${secretName} --project=${PROJECT} --data-file=-`, {
      input: tokens.refresh_token,
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  return tokens.access_token;
}

// The master matrix: owner, challenge, artefact and class are properties of the
// LINE, so they live in one place, and the reconciliations read the same data.
const { LINES, classify } = matrix;

const money = (n) =>
  `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const slug = arg("--client", "stza");
  const asAt = arg("--as-at", new Date().toISOString().slice(0, 10));
  const dryRun = process.argv.includes("--dry-run");

  const { client, release } = await connect();
  let entity, clientRoot, clientName;
  try {
    const { rows } = await client.query(
      `SELECT c.folder_path, c.name, e.slug,
              e.accounting_system_config->>'tenant_id'   AS tenant_id,
              e.accounting_system_config->>'tenant_name' AS tenant_name,
              e.accounting_system_config->>'secret_name' AS secret_name
         FROM shared.clients c JOIN finance.entities e ON e.client_id = c.id
        WHERE c.slug = $1 AND e.accounting_system_config->>'tenant_id' IS NOT NULL`,
      [slug]
    );
    if (!rows.length) throw new Error(`no mapped Xero entity for '${slug}'`);
    if (rows.length > 1) {
      throw new Error(
        `'${slug}' has ${rows.length} mapped entities. Compose per entity; a group matrix ` +
          `needs consolidation decisions this script does not make.`
      );
    }
    entity = rows[0];
    clientRoot = rows[0].folder_path;
    clientName = rows[0].name;
  } finally {
    await release();
  }

  const token = await xeroAccessToken(entity.secret_name || `xero-refresh-${slug}-${entity.slug}`);
  const head = {
    Authorization: `Bearer ${token}`,
    "Xero-tenant-id": entity.tenant_id,
    Accept: "application/json",
  };

  const accRes = await fetch("https://api.xero.com/api.xro/2.0/Accounts", { headers: head });
  if (!accRes.ok) throw new Error(`Xero accounts failed (${accRes.status})`);
  const accounts = (await accRes.json()).Accounts ?? [];

  const tbRes = await fetch(
    `https://api.xero.com/api.xro/2.0/Reports/TrialBalance?date=${asAt}`,
    { headers: head }
  );
  if (!tbRes.ok) throw new Error(`Xero trial balance failed (${tbRes.status})`);

  // Trial balance rows: [Account, Debit, Credit, YTD Debit, YTD Credit].
  //
  // Two things here are easy to get wrong and one of them is silent.
  //
  // The report labels accounts "Name (Code)" while the Accounts endpoint returns
  // the bare name, so matching on name alone finds nothing. The code is the
  // reliable join.
  //
  // And columns 1 and 2 are the PERIOD movement; 3 and 4 are year to date. A
  // balance sheet position is the YTD figure. Reading the period columns
  // produces a plausible number that is a month's movement dressed as a
  // balance, which nothing downstream would flag.
  const balances = new Map();
  const walk = (rows) => {
    for (const row of rows ?? []) {
      if (row.RowType === "Row" && row.Cells?.length >= 5) {
        const label = String(row.Cells[0]?.Value ?? "").trim();
        const dr = Number(row.Cells[3]?.Value || 0);
        const cr = Number(row.Cells[4]?.Value || 0);
        const m = label.match(/^(.*)\s+\(([^)]+)\)$/);
        if (m) balances.set(`code:${m[2].trim()}`, dr - cr);
        balances.set(`name:${(m ? m[1] : label).trim().toLowerCase()}`, dr - cr);
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk((await tbRes.json()).Reports?.[0]?.Rows);

  // Only balance sheet accounts. Revenue and expenses are not matrix lines.
  const BS_TYPES = new Set([
    "BANK", "CURRENT", "FIXED", "INVENTORY", "NONCURRENT", "PREPAYMENT",
    "CURRLIAB", "LIABILITY", "TERMLIAB", "EQUITY",
  ]);

  const present = new Map();
  const unmapped = [];

  for (const a of accounts) {
    if (!BS_TYPES.has(a.Type)) continue;
    const bal =
      balances.get(`code:${(a.Code || "").trim()}`) ??
      balances.get(`name:${(a.Name || "").trim().toLowerCase()}`);
    if (bal === undefined || bal === 0) continue;

    const hit = classify(a);
    if (!hit) {
      unmapped.push({ name: a.Name, code: a.Code, type: a.Type, balance: bal });
      continue;
    }
    if (!present.has(hit.key)) present.set(hit.key, { total: 0, accounts: [] });
    const e = present.get(hit.key);
    e.total += bal;
    e.accounts.push({ name: a.Name, code: a.Code, balance: bal, how: hit.how });
  }

  const rows = LINES.filter((l) => present.has(l.key));
  const absent = LINES.filter((l) => !present.has(l.key));

  const out = [];
  out.push(`# ${clientName} — balance sheet ownership matrix`);
  out.push("");
  out.push(`Composed from the trial balance at **${asAt}**, per \`skills/balance-sheet-matrix\`.`);
  out.push(`Generated by \`scripts/compose-matrix.mjs\`. Regenerate rather than hand-edit the table;`);
  out.push(`notes below it are yours to keep.`);
  out.push("");
  out.push(`Lines appear because this client **has** them. A line absent here is absent because`);
  out.push(`there is no balance, not because it was forgotten — the full master list is at the foot.`);
  out.push("");
  out.push("| Line | Balance | Owner | Challenge | Artefact | Cadence | Class | Verified |");
  out.push("|---|---:|---|---|---|---|---|---|");
  for (const l of rows) {
    const e = present.get(l.key);
    out.push(
      `| ${l.line} | ${money(e.total)} | ${l.owner} | ${l.challenge} | ${l.artefact} | ${l.cadence} | ${l.cls} | |`
    );
  }
  out.push("");
  out.push("**Class** — M is mechanical, J is judgement. It drives approval routing and is a");
  out.push("property of the line, never something an agent sets about its own work.");
  out.push("");
  out.push("**Verified** is filled at each close with the date the artefact was last tied to");
  out.push("source. Per row, never per matrix.");
  out.push("");

  if (unmapped.length) {
    out.push("## Not yet placed");
    out.push("");
    out.push("Balances the composer could not identify with confidence. **Placed by hand, not by");
    out.push("guesswork** — a matrix with a confidently wrong owner is worse than one with a");
    out.push("visible gap.");
    out.push("");
    out.push("| Account | Code | Type | Balance |");
    out.push("|---|---|---|---:|");
    unmapped.forEach((u) => out.push(`| ${u.name} | ${u.code ?? "-"} | ${u.type} | ${money(u.balance)} |`));
    out.push("");
  }

  out.push("## Master lines this client does not have");
  out.push("");
  out.push(absent.map((l) => l.line).join(" · "));
  out.push("");
  out.push("Add a row the first time one of these appears, and note it in the diary.");
  out.push("");
  out.push("## Accounts behind each line");
  out.push("");
  for (const l of rows) {
    const e = present.get(l.key);
    out.push(`**${l.line}**`);
    e.accounts.forEach((a) =>
      out.push(`- ${a.code ? `${a.code} ` : ""}${a.name} — ${money(a.balance)} *(${a.how})*`)
    );
    out.push("");
  }

  const body = out.join("\n");
  const target = join(clientRoot, "balance-sheet-matrix.md");

  console.log(`\n${clientName} — ${entity.tenant_name}, trial balance at ${asAt}\n`);
  console.log(`  ${rows.length} line(s) present, ${absent.length} absent, ${unmapped.length} unplaced`);
  for (const l of rows) console.log(`    ${l.line.padEnd(34)} ${money(present.get(l.key).total)}`);
  if (unmapped.length) {
    console.log("\n  Not placed:");
    unmapped.forEach((u) => console.log(`    ${String(u.name).padEnd(34)} ${money(u.balance)}`));
  }

  if (dryRun) {
    console.log("\nDry run. Nothing written.\n");
    return;
  }
  writeFileSync(target, body + "\n", "utf-8");
  console.log(`\nWritten to ${target}\n`);
}

main().catch((e) => {
  console.error("\nCompose failed:", e.message, "\n");
  process.exit(1);
});

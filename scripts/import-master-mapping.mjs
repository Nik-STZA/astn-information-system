// Imports the Master Mapping CSV into finance.chart_of_accounts_mapping.
//
// Idempotent and re-runnable: rows upsert on (client_id, account_code,
// account_name). That composite is the only unique natural key in the source.
// account_code alone is not unique (427, 442, 463, 666 and 802 each appear
// twice with different names) and six bank rows carry no code at all.
//
// Master Mapping is the source of truth for what an account contains
// (Feldspar CLAUDE.md rule 9). Read-only in the portal for v1: to change a
// mapping, edit the CSV and re-run this.
//
// Usage:
//   node scripts/import-master-mapping.mjs [--csv <path>] [--client <slug>] [--dry-run]

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { connect } from "./db.mjs";

const DEFAULT_CSV =
  "C:\\Users\\yogim\\Feldspar_Project\\XERO REPORTING\\Master Mapping as at 29 march 2026.csv";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Minimal RFC 4180 parser. Handles quoted fields, escaped quotes and embedded
// newlines, none of which the current file uses but any hand-edit could add.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r") { /* handled by \n */ }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (v) => (v ?? "").trim();
const orNull = (v) => (clean(v) === "" ? null : clean(v));

async function main() {
  const csvPath = arg("--csv", DEFAULT_CSV);
  const slug = arg("--client", "feldspar-sport-group");
  const dryRun = process.argv.includes("--dry-run");

  // UTF-8 explicit, and strip the BOM. Reading this as cp1252 is what put a
  // stray character before every pound sign in an earlier board pack
  // (Feldspar CLAUDE.md rule 12).
  const raw = readFileSync(csvPath, "utf-8").replace(/^\uFEFF/, "");
  const rows = parseCsv(raw);
  if (rows.length < 2) throw new Error(`${csvPath} has no data rows`);

  const header = rows[0].map(clean);
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`column '${name}' not found. Header: ${header.join(", ")}`);
    return i;
  };

  const cCode = idx("*Code");
  const cName = idx("*Name");
  const cType = idx("*Type");
  const cTax = idx("*Tax Code");
  const cPnl1 = idx("P&L Mapping 1");
  const cPnl2 = idx("P&L Mapping 2");
  const cPnl3 = idx("P&L Mapping 3");
  const cBs = idx("BS Mapping");

  const sourceFile = basename(csvPath);
  const records = [];
  const seen = new Set();
  let skippedBlank = 0;
  let duplicateInSource = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = clean(row[cName]);
    if (!name) { skippedBlank++; continue; }

    const code = clean(row[cCode]);
    const key = `${code}\u0000${name}`;
    if (seen.has(key)) {
      duplicateInSource++;
      console.warn(`  line ${r + 1}: duplicate (code, name) '${code}' / '${name}', keeping the later row`);
    }
    seen.add(key);

    records.push({
      code,
      name,
      type: orNull(row[cType]),
      tax: orNull(row[cTax]),
      pnl1: orNull(row[cPnl1]),
      pnl2: orNull(row[cPnl2]),
      pnl3: orNull(row[cPnl3]),
      bs: orNull(row[cBs]),
      sourceLine: r + 1,
    });
  }

  console.log(`Source:  ${csvPath}`);
  console.log(`Client:  ${slug}`);
  console.log(`Parsed:  ${records.length} rows (${skippedBlank} blank skipped, ${duplicateInSource} duplicate keys)`);
  const noCode = records.filter((x) => x.code === "").length;
  console.log(`         ${noCode} rows carry no account code (bank accounts and current year earnings)`);

  if (dryRun) {
    console.log("\nDry run. Nothing written.");
    return;
  }

  const { client, release } = await connect();
  try {
    const { rows: cr } = await client.query(
      "SELECT id FROM shared.clients WHERE slug = $1",
      [slug]
    );
    if (!cr.length) throw new Error(`no client in shared.clients with slug '${slug}'`);
    const clientId = cr[0].id;

    const before = await client.query(
      "SELECT COUNT(*)::int AS n FROM finance.chart_of_accounts_mapping WHERE client_id = $1",
      [clientId]
    );

    await client.query("BEGIN");
    for (const m of records) {
      await client.query(
        `INSERT INTO finance.chart_of_accounts_mapping
           (client_id, account_code, account_name, account_type, tax_code,
            pnl_mapping_1, pnl_mapping_2, pnl_mapping_3, bs_mapping,
            source_file, source_row)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (client_id, account_code, account_name) DO UPDATE SET
           account_type  = EXCLUDED.account_type,
           tax_code      = EXCLUDED.tax_code,
           pnl_mapping_1 = EXCLUDED.pnl_mapping_1,
           pnl_mapping_2 = EXCLUDED.pnl_mapping_2,
           pnl_mapping_3 = EXCLUDED.pnl_mapping_3,
           bs_mapping    = EXCLUDED.bs_mapping,
           source_file   = EXCLUDED.source_file,
           source_row    = EXCLUDED.source_row`,
        [clientId, m.code, m.name, m.type, m.tax, m.pnl1, m.pnl2, m.pnl3, m.bs,
         sourceFile, m.sourceLine]
      );
    }
    await client.query("COMMIT");

    const after = await client.query(
      "SELECT COUNT(*)::int AS n FROM finance.chart_of_accounts_mapping WHERE client_id = $1",
      [clientId]
    );
    console.log(`\nRows for this client: ${before.rows[0].n} before, ${after.rows[0].n} after.`);
    console.log("Import complete.");
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

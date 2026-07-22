/**
 * Supabase → Cloud SQL data migration (Phase A).
 *
 * - Source: Supabase project vjtdcsshsqnmfcftlver (direct Postgres, session pooler)
 * - Target: Cloud SQL africastn_os via local cloud-sql-proxy on 127.0.0.1:15432
 *
 * For each table: sync schema (CREATE missing table / ADD missing columns from
 * source information_schema), then batch-copy rows preserving UUIDs with
 * ON CONFLICT (id) DO NOTHING, then verify counts.
 *
 * Env:
 *   SUPA_PWD_FILE  — path to file containing the Supabase DB password
 *   PGPWD          — Cloud SQL app_user password (falls back to africastn_app via CSQL_USER)
 *   CSQL_USER      — target user (default app_user; must own/create tables)
 */
const { Client } = require("pg");
const fs = require("fs");

// FK-dependency order: parents before children.
const TABLES = [
  "lookup_countries",
  "lookup_sports",
  "source_registry",
  "organizations",
  "partnerships",
  "organization_changes",
  "international_ecosystem_partners",
  "companies",
  "raw_items",
  "classified_items",
  "approvals",
  "feedback_log",
  "content_usage",
  "publishing_queue",
  "analytics",
  "system_logs",
  "weekly_reports",
  "dp_jurisdictions",
  "dp_editions",
];

const BATCH = 500;

function pk(table) {
  // lookup tables use natural keys
  if (table === "lookup_countries") return "iso_code";
  if (table === "lookup_sports") return "code";
  return "id";
}

async function getColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows;
}

function sqlType(udt) {
  if (udt.startsWith("_")) return `${sqlType(udt.slice(1))}[]`;
  const map = {
    int4: "integer", int8: "bigint", float8: "double precision",
    bool: "boolean", timestamptz: "timestamptz", timestamp: "timestamp",
    varchar: "text",
  };
  return map[udt] || udt;
}

async function syncSchema(src, dst, table) {
  const srcCols = await getColumns(src, table);
  if (srcCols.length === 0) throw new Error(`${table} not found in source`);
  let dstCols = await getColumns(dst, table);

  if (dstCols.length === 0) {
    const defs = srcCols.map((c) => {
      let d = `"${c.column_name}" ${sqlType(c.udt_name)}`;
      if (c.column_name === pk(table)) d += " PRIMARY KEY";
      if (c.is_nullable === "NO" && c.column_name !== pk(table)) d += "";
      if (c.udt_name === "uuid" && c.column_name === "id") d += " DEFAULT gen_random_uuid()";
      return d;
    });
    await dst.query(`CREATE TABLE "${table}" (${defs.join(", ")})`);
    console.log(`  [schema] created table ${table} (${srcCols.length} cols)`);
    dstCols = await getColumns(dst, table);
  } else {
    const dstNames = new Set(dstCols.map((c) => c.column_name));
    for (const c of srcCols) {
      if (!dstNames.has(c.column_name)) {
        await dst.query(
          `ALTER TABLE "${table}" ADD COLUMN "${c.column_name}" ${sqlType(c.udt_name)}`
        );
        console.log(`  [schema] ${table}: added column ${c.column_name} ${sqlType(c.udt_name)}`);
      }
    }
    dstCols = await getColumns(dst, table);
  }
  // copy only columns that exist on both sides
  const dstNames = new Set(dstCols.map((c) => c.column_name));
  return srcCols.map((c) => c.column_name).filter((n) => dstNames.has(n));
}

async function copyTable(src, dst, table) {
  const cols = await syncSchema(src, dst, table);
  const key = pk(table);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const { rows: cnt } = await src.query(`SELECT count(*)::int AS n FROM "${table}"`);
  const total = cnt[0].n;
  let copied = 0, inserted = 0;

  for (let offset = 0; offset < total; offset += BATCH) {
    const { rows } = await src.query(
      `SELECT ${colList} FROM "${table}" ORDER BY "${key}" LIMIT ${BATCH} OFFSET ${offset}`
    );
    if (rows.length === 0) break;
    // multi-row insert: one statement per batch instead of one per row
    const vals = [];
    const tuples = rows.map((row, r) => {
      const ph = cols.map((c, i) => {
        let v = row[c];
        if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
          v = JSON.stringify(v);
        }
        vals.push(v);
        return `$${r * cols.length + i + 1}`;
      });
      return `(${ph.join(", ")})`;
    });
    const res = await dst.query(
      `INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(", ")}
       ON CONFLICT ("${key}") DO NOTHING`,
      vals
    );
    inserted += res.rowCount;
    copied += rows.length;
    if (total > BATCH) console.log(`  ${table}: ${copied}/${total}`);
  }

  const { rows: dstCnt } = await dst.query(`SELECT count(*)::int AS n FROM "${table}"`);
  console.log(
    `  ${table}: source=${total} inserted=${inserted} target-now=${dstCnt[0].n} ${dstCnt[0].n >= total ? "OK" : "**SHORTFALL**"}`
  );
  return { table, source: total, target: dstCnt[0].n };
}

(async () => {
  const supaPwd = fs.readFileSync(process.env.SUPA_PWD_FILE, "utf8").trim();
  const src = new Client({
    // Supabase session pooler (IPv4-friendly). Direct db host is IPv6-only on many networks.
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.vjtdcsshsqnmfcftlver",
    password: supaPwd,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  const dst = new Client({
    host: "127.0.0.1",
    port: 15432,
    user: process.env.CSQL_USER || "app_user",
    password: process.env.PGPWD,
    database: "africastn_os",
  });
  await src.connect();
  console.log("connected to Supabase");
  await dst.connect();
  console.log("connected to Cloud SQL");

  const results = [];
  for (const t of TABLES) {
    try {
      results.push(await copyTable(src, dst, t));
    } catch (e) {
      console.error(`  ${t}: FAILED — ${e.message}`);
      results.push({ table: t, error: e.message });
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(r.error ? `${r.table}: ERROR ${r.error}` : `${r.table}: ${r.source} → ${r.target}`);
  }

  // grant read/write to the API user on everything copied
  for (const t of TABLES) {
    try {
      await dst.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO africastn_app`);
    } catch (_) { /* table may not exist on failure */ }
  }
  console.log("grants applied to africastn_app");

  await src.end();
  await dst.end();
})();

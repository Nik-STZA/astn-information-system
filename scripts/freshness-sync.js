/**
 * Freshness pass: for tables with updated_at, find rows where Supabase has a
 * newer updated_at than Cloud SQL (or Cloud SQL lacks the row) and upsert the
 * full row. Fixes content drift the ON CONFLICT DO NOTHING copy can't touch.
 */
const { Client } = require("pg");
const fs = require("fs");

const TABLES = [
  "organizations",
  "partnerships",
  "international_ecosystem_partners",
  "source_registry",
  "dp_jurisdictions",
  "dp_editions",
];

async function cols(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

(async () => {
  const src = new Client({
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.vjtdcsshsqnmfcftlver",
    password: fs.readFileSync(process.env.SUPA_PWD_FILE, "utf8").trim(),
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  const dst = new Client({
    host: "127.0.0.1",
    port: 15432,
    user: "app_user",
    password: process.env.PGPWD,
    database: "africastn_os",
  });
  await src.connect();
  await dst.connect();

  for (const table of TABLES) {
    const srcCols = await cols(src, table);
    const dstCols = new Set(await cols(dst, table));
    const shared = srcCols.filter((c) => dstCols.has(c));

    const { rows: srcTimes } = await src.query(
      `SELECT id, updated_at FROM "${table}"`
    );
    const { rows: dstTimes } = await dst.query(
      `SELECT id, updated_at FROM "${table}"`
    );
    const dstMap = new Map(dstTimes.map((r) => [String(r.id), r.updated_at ? new Date(r.updated_at).getTime() : 0]));

    const stale = srcTimes.filter((r) => {
      const d = dstMap.get(String(r.id));
      const s = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      return d === undefined || s > d;
    });

    if (stale.length === 0) {
      console.log(`${table}: fresh (0 stale)`);
      continue;
    }

    let updated = 0;
    for (const s of stale) {
      const { rows } = await src.query(
        `SELECT ${shared.map((c) => `"${c}"`).join(", ")} FROM "${table}" WHERE id = $1`,
        [s.id]
      );
      if (rows.length === 0) continue;
      const row = rows[0];
      const vals = shared.map((c) => {
        const v = row[c];
        if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
          return JSON.stringify(v);
        }
        return v;
      });
      const ph = shared.map((_, i) => `$${i + 1}`);
      const sets = shared.filter((c) => c !== "id").map((c) => `"${c}" = EXCLUDED."${c}"`);
      await dst.query(
        `INSERT INTO "${table}" (${shared.map((c) => `"${c}"`).join(", ")})
         VALUES (${ph.join(", ")})
         ON CONFLICT (id) DO UPDATE SET ${sets.join(", ")}`,
        vals
      );
      updated += 1;
    }
    console.log(`${table}: upserted ${updated} stale rows`);
  }

  await src.end();
  await dst.end();
})();

#!/usr/bin/env node
/**
 * Production job for the verifier (server-lib-verifier.js).
 *
 *   node scripts/verify-job.js <week-ending YYYY-MM-DD>
 *
 * Verifies every approved item that has no verifier decision yet, against
 * the week ending on the given Thursday: fetches each source, stores it in
 * item_sources, and writes one item_screen_decisions row (step 'verify':
 * pass, fail or unverified, with the reason, problems and required edits).
 * It changes no item's status: a failed item stays approved until Nik
 * decides. An override is recorded as a new 'verify' row with rule
 * 'override'.
 *
 * Does nothing unless VERIFY=on. Needs migrations 069 and 072, DB_* env vars
 * and ANTHROPIC_API_KEY (Secret Manager: anthropic-api-key). Never publishes.
 */
const { Pool } = require("pg");
const verifier = require("../server-lib-verifier");

if (!verifier.isEnabled()) {
  console.log("VERIFY is not 'on'; nothing to do.");
  process.exit(0);
}
const weekEnding = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnding || "")) {
  console.error("Usage: verify-job.js <week-ending YYYY-MM-DD>");
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "africastn_os",
  user: process.env.DB_USER || "africastn_app",
  password: process.env.DB_PASSWORD,
});

(async () => {
  const { rows: items } = await pool.query(
    `SELECT id, title, summary, translated_text, source_name, COALESCE(url, source_url) AS url, created_at
       FROM classified_items ci
      WHERE status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM item_screen_decisions v WHERE v.item_id = ci.id AND v.step = 'verify')`
  );
  if (!items.length) return console.log("No approved items waiting for the verifier.");

  // Related stories: the dedup cluster's members plus nearby headlines.
  const { rows: pool14 } = await pool.query(
    `SELECT id, title, translated_text, source_name, created_at FROM classified_items
      WHERE created_at >= $1::date - INTERVAL '14 days' AND created_at < $1::date + INTERVAL '2 days'`,
    [weekEnding]
  );

  const counts = { pass: 0, fail: 0, unverified: 0 };
  for (const it of items) {
    const { rows: cluster } = await pool.query(
      `SELECT ci.id, ci.title, ci.translated_text, ci.source_name, ci.created_at
         FROM item_screen_decisions d JOIN classified_items ci ON ci.id = d.item_id
        WHERE d.step = 'dedup' AND (d.detail->>'lead_id' = $1
              OR d.item_id IN (SELECT (jsonb_array_elements_text(detail->'duplicate_ids'))::uuid
                                 FROM item_screen_decisions WHERE item_id = $1 AND step = 'dedup'))`,
      [it.id]
    );
    const seen = new Set(cluster.map((c) => c.id));
    const related = [...cluster, ...verifier.findRelated(it, pool14).filter((r) => !seen.has(r.id))].slice(0, 15);

    const r = await verifier.verifyItem(it, { weekEnding, related });
    const s = r.source;
    await pool.query(
      `INSERT INTO item_sources (item_id, url, final_url, http_status, ok, failure_reason, page_title,
                                 published_at, published_from, text, text_hash, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [it.id, s.url || it.url || "", s.finalUrl, s.status, s.ok, s.reason, s.title,
       s.published.date, s.published.where, s.text, s.textHash, s.fetchedAt]
    );
    await pool.query(
      `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
       VALUES ($1, 'verify', $2, NULL, $3, $4, $5, $6)`,
      [it.id, r.decision, r.reason,
       JSON.stringify({ problems: r.problems, required_edits: r.required_edits, ...r.detail }),
       it.url, r.version]
    );
    counts[r.decision]++;
    console.log(`${r.decision.padEnd(10)} ${it.title.slice(0, 80)} | ${r.reason}`);
  }
  console.log(`\n${items.length} items: ${counts.pass} pass, ${counts.fail} fail, ${counts.unverified} unverified.`);
})()
  .catch((e) => { console.error("ERR", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

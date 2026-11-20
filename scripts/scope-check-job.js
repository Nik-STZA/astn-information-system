#!/usr/bin/env node
/**
 * Production job for the scope check. Two phases, because a batch takes
 * minutes to hours:
 *
 *   node scripts/scope-check-job.js submit
 *     Picks pending_review items that the rule screen kept and that have no
 *     scope_check decision yet, submits one batch and prints its id.
 *
 *   node scripts/scope-check-job.js collect <batch-id>
 *     Waits for the batch, writes one item_screen_decisions row per item
 *     (step 'scope_check'), and archives the out-of-scope items. Archiving is
 *     reversible: set status back to 'pending_review'.
 *
 * Does nothing unless SCOPE_CHECK=on. Needs migration 069, DB_* env vars and
 * ANTHROPIC_API_KEY (Secret Manager: anthropic-api-key). Never publishes.
 */
const { Pool } = require("pg");
const scope = require("../server-lib-scope-check");

if (!scope.isEnabled()) {
  console.log("SCOPE_CHECK is not 'on'; nothing to do.");
  process.exit(0);
}

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "africastn_os",
  user: process.env.DB_USER || "africastn_app",
  password: process.env.DB_PASSWORD,
});

async function submit() {
  const { rows } = await pool.query(
    `SELECT ci.id, ci.title, ci.summary, ci.translated_text, ci.source_name
       FROM classified_items ci
       JOIN item_screen_decisions rs
         ON rs.item_id = ci.id AND rs.step = 'rule_screen' AND rs.decision = 'keep'
      WHERE ci.status = 'pending_review'
        AND NOT EXISTS (SELECT 1 FROM item_screen_decisions sc
                         WHERE sc.item_id = ci.id AND sc.step = 'scope_check')`
  );
  if (!rows.length) return console.log("No items waiting for the scope check.");
  const id = await scope.submitBatch(rows);
  console.log(`Submitted ${rows.length} items in batch ${id}. Run: node scripts/scope-check-job.js collect ${id}`);
}

async function collect(batchId) {
  await scope.waitForBatch(batchId);
  const results = await scope.collectResults(batchId);
  let kept = 0, archived = 0;
  for (const [itemId, r] of results) {
    const { rows } = await pool.query(`SELECT COALESCE(url, source_url) AS url FROM classified_items WHERE id = $1`, [itemId]);
    await pool.query(
      `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
       VALUES ($1, 'scope_check', $2, NULL, $3, $4, $5, $6)`,
      [itemId, r.decision, r.reason, JSON.stringify({ answers: r.answers, error: r.error || null, batch: batchId }),
       rows[0] ? rows[0].url : null, scope.SCOPE_VERSION]
    );
    if (r.decision === "archive") {
      await pool.query(
        `UPDATE classified_items SET status = 'archived', updated_at = now() WHERE id = $1 AND status = 'pending_review'`,
        [itemId]
      );
      archived++;
    } else kept++;
  }
  console.log(`Batch ${batchId}: ${kept} kept for review, ${archived} archived as out of scope.`);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "submit") await submit();
  else if (cmd === "collect" && arg) await collect(arg);
  else throw new Error("Usage: scope-check-job.js submit | collect <batch-id>");
})()
  .catch((e) => { console.error("ERR", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

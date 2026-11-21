#!/usr/bin/env node
/**
 * Production job for the independent reviewer (server-lib-brief-review.js).
 *
 *   node scripts/review-job.js <brief-id>
 *
 * Reviews a draft brief as it stands: its markdown, the latest verifier
 * record for each item it uses, and the source text the verifier stored.
 * Writes one brief_checks row (step 'reviewer') keyed to md5 of the text,
 * and prints the findings. Changes nothing in the brief. With
 * PUBLISH_GATES=on, the brief can only be published if this text passed.
 *
 * Does nothing unless REVIEW=on. Needs migrations 069, 072 and 073, DB_* env
 * vars and ANTHROPIC_API_KEY (Secret Manager: anthropic-api-key).
 */
const { Pool } = require("pg");
const review = require("../server-lib-brief-review");
const { weekBounds } = require("../server-lib-verifier");

if (!review.isEnabled()) {
  console.log("REVIEW is not 'on'; nothing to do.");
  process.exit(0);
}
const briefId = process.argv[2];
if (!briefId) {
  console.error("Usage: review-job.js <brief-id>");
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
  const { rows: [brief] } = await pool.query(
    `SELECT id, status, week_ending::text AS week_ending, item_ids, report_markdown FROM weekly_reports WHERE id = $1`,
    [briefId]
  );
  if (!brief) throw new Error("Brief not found");
  if (brief.status !== "draft") console.log(`Note: this brief is ${brief.status}; reviewing anyway.`);

  const ids = brief.item_ids || [];
  const { rows: verified } = await pool.query(
    `SELECT DISTINCT ON (ci.id) ci.id, ci.title, COALESCE(ci.url, ci.source_url) AS url,
            d.decision, d.reason, d.detail
       FROM classified_items ci
       LEFT JOIN item_screen_decisions d ON d.item_id = ci.id AND d.step = 'verify'
      WHERE ci.id = ANY($1::uuid[])
      ORDER BY ci.id, d.created_at DESC NULLS LAST`,
    [ids]
  );
  const { rows: sources } = await pool.query(
    `SELECT DISTINCT ON (item_id) url, text FROM item_sources
      WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, fetched_at DESC`,
    [ids]
  );

  const records = verified.map((v) => v.decision ? {
    title: v.title, url: v.url, decision: v.decision, reason: v.reason,
    problems: (v.detail && v.detail.problems) || [], required_edits: (v.detail && v.detail.required_edits) || [],
    reading: v.detail && v.detail.reading,
  } : { title: v.title, url: v.url, decision: "none", reason: "Not verified.", problems: [], required_edits: [] });

  const r = await review.reviewBrief({
    markdown: brief.report_markdown,
    weekLabel: weekBounds(brief.week_ending).label,
    verified: records,
    sources,
  });

  await pool.query(
    `INSERT INTO brief_checks (brief_id, markdown_hash, step, result, checklist, findings, summary, model, version)
     VALUES ($1, $2, 'reviewer', $3, $4, $5, $6, $7, $8)`,
    [brief.id, r.markdown_hash, r.result, JSON.stringify(r.checklist), JSON.stringify(r.findings), r.summary, r.model, r.version]
  );

  console.log(`Reviewer: ${r.result.toUpperCase()}\n${r.summary}\n`);
  for (const f of r.findings.filter((f) => f.severity === "must fix")) console.log(`must fix | ${f.location} | ${f.rule} | ${f.fix}`);
})()
  .catch((e) => { console.error("ERR", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

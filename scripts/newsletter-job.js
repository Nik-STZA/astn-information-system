#!/usr/bin/env node
/**
 * Production job: draft the newsletter for a PUBLISHED brief.
 *
 *   node scripts/newsletter-job.js <week-ending YYYY-MM-DD>
 *
 * Refuses a brief that is not published (the research agent's Beehiiv path
 * took whatever row was newest, drafts included). Drafts, checks and reviews
 * the newsletter (server-lib-newsletter.js), marks any earlier draft for the
 * same brief as superseded, and stores the result in newsletter_drafts.
 * Sends nothing and pushes nothing to Beehiiv: Nik approves and sends.
 *
 * Does nothing unless NEWSLETTER=on. Needs migration 074, DB_* env vars and
 * ANTHROPIC_API_KEY (Secret Manager: anthropic-api-key).
 */
const { Pool } = require("pg");
const newsletter = require("../server-lib-newsletter");

if (!newsletter.isEnabled()) {
  console.log("NEWSLETTER is not 'on'; nothing to do.");
  process.exit(0);
}
const weekEnding = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnding || "")) {
  console.error("Usage: newsletter-job.js <week-ending YYYY-MM-DD>");
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
    `SELECT id, status, week_ending::text AS week_ending, report_markdown FROM weekly_reports WHERE week_ending = $1::date`,
    [weekEnding]
  );
  if (!brief) throw new Error(`No brief for w/e ${weekEnding}.`);
  if (brief.status !== "published") throw new Error(`The w/e ${weekEnding} brief is ${brief.status}; publish it first.`);

  const { rows: figures } = await pool.query(
    `SELECT DISTINCT ON (figure_name) figure_name, value, report_edition, as_at_date::text AS as_at_date
       FROM published_figures ORDER BY figure_name, as_at_date DESC`
  );

  const n = await newsletter.draftNewsletter(brief, figures);

  await pool.query(`UPDATE newsletter_drafts SET status = 'superseded' WHERE brief_id = $1 AND status = 'draft'`, [brief.id]);
  const { rows: [row] } = await pool.query(
    `INSERT INTO newsletter_drafts (brief_id, subject, preview, markdown, note_is_draft, figure_name,
                                    review_result, review_findings, review_summary, model, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [brief.id, n.subject, n.preview, n.markdown, n.note_is_draft, n.figure ? n.figure.figure_name : null,
     n.result, JSON.stringify(n.findings), n.summary, n.model, n.version]
  );

  console.log(`Newsletter draft ${row.id} for w/e ${weekEnding}: review ${n.result.toUpperCase()}.`);
  console.log(`Subject: ${n.subject}\nPreview: ${n.preview}`);
  if (n.note_is_draft) console.log("The brief had no approved editor's note, so the note is a draft for Nik.");
  for (const f of n.findings.filter((x) => x.severity === "must fix")) console.log(`  must fix | ${f.location}: ${f.fix}`);
})()
  .catch((e) => { console.error("ERR", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

#!/usr/bin/env node
/**
 * Production job: draft the week's brief with the editor, have the
 * independent reviewer check it, and revise once if it fails.
 *
 *   node scripts/editor-job.js <week-ending YYYY-MM-DD> [--replace-draft]
 *
 * Uses every approved item whose latest verifier decision is 'pass' (a
 * recorded override counts), with the verifier's record and the source text
 * it stored. Writes the result as a DRAFT in weekly_reports (week_ending is
 * unique: an existing draft is only replaced with --replace-draft, after its
 * text is saved to brief_versions; a published brief is never touched), and
 * records each editor and reviewer result in brief_checks.
 *
 * If the reviewer fails the draft twice, the draft is saved anyway with the
 * findings, for Nik (design: two fails in a row go to Nik). Nothing is
 * published: publishing stays with Nik and the publish gates.
 *
 * Does nothing unless EDITOR=on. Needs migrations 069 to 073, DB_* env vars
 * and ANTHROPIC_API_KEY (Secret Manager: anthropic-api-key).
 */
const { Pool } = require("pg");
const editor = require("../server-lib-brief-editor");
const { reviewBrief } = require("../server-lib-brief-review");
const { findRelated, weekBounds } = require("../server-lib-verifier");
const { markdownHash } = require("../server-lib-brief-checks");

if (!editor.isEnabled()) {
  console.log("EDITOR is not 'on'; nothing to do.");
  process.exit(0);
}
const weekEnding = process.argv[2];
const replace = process.argv.includes("--replace-draft");
if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnding || "")) {
  console.error("Usage: editor-job.js <week-ending YYYY-MM-DD> [--replace-draft]");
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "africastn_os",
  user: process.env.DB_USER || "africastn_app",
  password: process.env.DB_PASSWORD,
});

async function recordCheck(briefId, step, markdown, result, extra) {
  await pool.query(
    `INSERT INTO brief_checks (brief_id, markdown_hash, step, result, checklist, findings, summary, model, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [briefId, markdownHash(markdown), step, result, JSON.stringify(extra.checklist || []),
     JSON.stringify(extra.findings || []), extra.summary || null, extra.model || null, extra.version]
  );
}

(async () => {
  const week = weekBounds(weekEnding);

  const { rows: existing } = await pool.query(
    `SELECT id, status, report_markdown FROM weekly_reports WHERE week_ending = $1::date`, [weekEnding]
  );
  if (existing.length && existing[0].status !== "draft") throw new Error(`The w/e ${weekEnding} brief is ${existing[0].status}; not touching it.`);
  if (existing.length && !replace) throw new Error(`A draft for w/e ${weekEnding} exists (${existing[0].id}). Re-run with --replace-draft to replace it.`);

  // Approved items whose latest verifier decision is a pass.
  const { rows: items } = await pool.query(
    `SELECT ci.id, ci.title, ci.summary, ci.translated_text, ci.source_name,
            COALESCE(ci.url, ci.source_url) AS url, ci.created_at,
            v.decision, v.reason, v.rule, v.detail,
            (SELECT s.text FROM item_sources s WHERE s.item_id = ci.id ORDER BY s.fetched_at DESC LIMIT 1) AS source_text
       FROM classified_items ci
       JOIN LATERAL (SELECT d.decision, d.reason, d.rule, d.detail FROM item_screen_decisions d
                      WHERE d.item_id = ci.id AND d.step = 'verify' ORDER BY d.created_at DESC LIMIT 1) v ON true
      WHERE ci.status = 'approved' AND v.decision = 'pass'`
  );
  if (!items.length) return console.log("No verified, approved items: nothing to draft.");

  const { rows: nearby } = await pool.query(
    `SELECT id, title, translated_text, source_name, created_at FROM classified_items
      WHERE created_at >= $1::date - INTERVAL '14 days' AND created_at < $1::date + INTERVAL '2 days'`,
    [weekEnding]
  );
  // An override row carries no reading; use the original verifier row's.
  for (const it of items) {
    let detail = it.detail || {};
    if (it.rule === "override") {
      const { rows } = await pool.query(
        `SELECT detail FROM item_screen_decisions WHERE item_id = $1 AND step = 'verify' AND rule IS DISTINCT FROM 'override'
          ORDER BY created_at DESC LIMIT 1`, [it.id]);
      detail = rows[0] ? rows[0].detail : {};
    }
    it.verify = { decision: "pass", override: it.rule === "override", reason: it.reason,
      required_edits: detail.required_edits || [], problems: detail.problems || [], reading: detail.reading };
    it.related = findRelated(it, nearby);
  }

  let draft = await editor.draftBrief({ weekEnding, weekLabel: week.label, items });
  if (!draft.markdown) return console.log(draft.notes_for_nik);

  // Save the draft row first so checks can reference it.
  let briefId;
  if (existing.length) {
    briefId = existing[0].id;
    await pool.query(
      `INSERT INTO brief_versions (brief_id, version_num, report_markdown, saved_by, change_summary)
       SELECT $1, COALESCE(MAX(version_num), 0) + 1, $2, 'editor-job', 'Replaced by the editor agent'
         FROM brief_versions WHERE brief_id = $1`,
      [briefId, existing[0].report_markdown]
    );
  } else {
    const { rows } = await pool.query(
      `INSERT INTO weekly_reports (week_ending, status, report_markdown, item_ids, item_count)
       VALUES ($1::date, 'draft', $2, $3::uuid[], $4) RETURNING id`,
      [weekEnding, draft.markdown, draft.used_ids, draft.used_ids.length]
    );
    briefId = rows[0].id;
  }

  const sources = items.map((it) => ({ url: it.url, text: it.source_text }));
  const verified = items.map((it) => ({ title: it.title, url: it.url, ...it.verify }));
  let review;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await pool.query(
      `UPDATE weekly_reports SET report_markdown = $2, item_ids = $3::uuid[], item_count = $4 WHERE id = $1 AND status = 'draft'`,
      [briefId, draft.markdown, draft.used_ids, draft.used_ids.length]
    );
    await recordCheck(briefId, "editor", draft.markdown, "pass", {
      summary: draft.notes_for_nik, findings: draft.dropped.map((d) => ({ location: d.id, rule: "dropped", text: d.reason, fix: "", severity: "note" })),
      model: draft.model, version: draft.version,
    });
    review = await reviewBrief({ markdown: draft.markdown, weekLabel: week.label, verified, sources });
    await recordCheck(briefId, "reviewer", draft.markdown, review.result, review);
    console.log(`Attempt ${attempt}: reviewer ${review.result.toUpperCase()}`);
    if (review.result === "pass" || attempt === 2) break;
    draft = await editor.reviseBrief({ weekEnding, weekLabel: week.label, items, markdown: draft.markdown, review });
  }

  console.log(`\nDraft ${briefId} saved for w/e ${weekEnding}: ${draft.used_ids.length} items.`);
  if (review.result === "fail") {
    console.log("The reviewer failed it twice. It is saved as a draft for Nik with these must-fix findings:");
    for (const f of review.findings.filter((f) => f.severity === "must fix")) console.log(`  - ${f.location}: ${f.fix}`);
  }
  console.log(`Notes for Nik: ${draft.notes_for_nik}`);
  console.log("Next: Nik rewrites or approves the editor's note (deleting the draft line), then re-runs the reviewer.");
})()
  .catch((e) => { console.error("ERR", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

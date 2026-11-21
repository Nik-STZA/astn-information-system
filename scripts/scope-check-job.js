#!/usr/bin/env node
/**
 * Production job for the scope check. Two phases, because a batch takes
 * minutes to hours:
 *
 *   node scripts/scope-check-job.js submit
 *     First rule-screens any pending item not screened yet (items from the
 *     research agent's digest skip the API ingester), archives kept items the
 *     source published before this brief week, then picks pending_review
 *     items the rule screen kept that have no scope_check decision yet,
 *     submits one batch and prints its id.
 *
 *   node scripts/scope-check-job.js collect <batch-id>
 *     Waits for the batch, writes one item_screen_decisions row per item
 *     (step 'scope_check'), and archives the out-of-scope items. Archiving is
 *     reversible: set status back to 'pending_review'.
 *
 *   node scripts/scope-check-job.js dedup
 *     Groups the in-scope pending items into stories (one Haiku call) and
 *     archives all but the lead of each story, recording which lead. Then
 *     scores each remaining item for importance (no model) with its parts
 *     and registry matches (step 'importance').
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

// Rule-screen every pending item that has no rule_screen decision yet,
// whichever path it came in by. Most items arrive through the research
// agent's digest, which writes classified_items directly and never passes the
// API ingester's screen, so the job screens them here.
async function screenPending() {
  const ruleScreen = require("../server-lib-rule-screen");
  const { rows: items } = await pool.query(
    `SELECT ci.id, ci.title, ci.summary, ci.translated_text, ci.source_name,
            COALESCE(ci.url, ci.source_url) AS url
       FROM classified_items ci
      WHERE ci.status = 'pending_review'
        AND NOT EXISTS (SELECT 1 FROM item_screen_decisions rs
                         WHERE rs.item_id = ci.id AND rs.step = 'rule_screen')`
  );
  if (!items.length) return;
  const { rows: orgs } = await pool.query(
    `SELECT astn_id, organization_name, organization_website FROM organizations`
  );
  const { rows: srcRows } = await pool.query(
    `SELECT source_name FROM content_sources WHERE lens = 'africa-sport-business'`
  );
  const { screen } = ruleScreen.buildScreen(orgs, { africaSportSources: srcRows.map((r) => r.source_name) });
  let archived = 0;
  for (const it of items) {
    const v = screen(it);
    await pool.query(
      `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
       VALUES ($1, 'rule_screen', $2, $3, $4, $5, $6, $7)`,
      [it.id, v.keep ? "keep" : "archive", v.rule, v.reason, JSON.stringify(v.matches), it.url, ruleScreen.SCREEN_VERSION]
    );
    if (!v.keep) {
      await pool.query(
        `UPDATE classified_items SET status = 'archived', updated_at = now() WHERE id = $1 AND status = 'pending_review'`,
        [it.id]
      );
      archived++;
    }
  }
  console.log(`Rule screen: ${items.length} unscreened pending items, ${archived} archived.`);
}

// Archive kept items that the source published before this brief week began
// (Friday to Thursday). The source date comes from the feed (raw_items),
// else from the page itself (fetched with code, no model), and is saved to
// classified_items.published_at where that is empty. Items with no date
// anywhere stay in the queue: the verifier checks them later.
// Why: after the 6 Nov outage, items from earlier weeks were rescored into
// this week's queue; 7 of 10 test approvals on 20 Nov 2026 predated the week.
function currentWeekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 2) % 7)); // back to Friday
  return d;
}

async function archiveStale() {
  const { fetchSource } = require("../server-lib-source-fetch");
  const weekStart = currentWeekStart();
  const { rows: items } = await pool.query(
    `SELECT ci.id, ci.published_at, r.published_at AS raw_published, COALESCE(ci.url, ci.source_url) AS url
       FROM classified_items ci
       JOIN item_screen_decisions rs ON rs.item_id = ci.id AND rs.step = 'rule_screen' AND rs.decision = 'keep'
       LEFT JOIN raw_items r ON r.id = ci.raw_item_id
      WHERE ci.status = 'pending_review'`
  );
  let archived = 0, fetched = 0, undated = 0;
  for (const it of items) {
    let date = it.published_at || it.raw_published;
    let from = it.published_at ? "classified_items" : "feed";
    if (!date && it.url) {
      const s = await fetchSource(it.url);
      fetched++;
      if (s.published.date && !s.published.monthOnly) { date = s.published.date; from = `page (${s.published.where})`; }
    }
    if (!date) { undated++; continue; }
    if (!it.published_at) {
      await pool.query(`UPDATE classified_items SET published_at = $2 WHERE id = $1 AND published_at IS NULL`, [it.id, date]);
    }
    if (new Date(date) < weekStart) {
      await pool.query(
        `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
         VALUES ($1, 'rule_screen', 'archive', 'stale', $2, $3, $4, 'stale-1')`,
        [it.id, `Published ${new Date(date).toISOString().slice(0, 10)}, before this week (from ${weekStart.toISOString().slice(0, 10)}).`,
         JSON.stringify({ date_from: from, week_start: weekStart.toISOString().slice(0, 10) }), it.url]
      );
      await pool.query(
        `UPDATE classified_items SET status = 'archived', updated_at = now() WHERE id = $1 AND status = 'pending_review'`,
        [it.id]
      );
      archived++;
    }
  }
  console.log(`Stale check: ${items.length} kept items, ${archived} archived as published before ${weekStart.toISOString().slice(0, 10)}, ${fetched} pages fetched for a date, ${undated} with no date.`);
}

async function submit() {
  await screenPending();
  await archiveStale();
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

// Group in-scope pending items into stories; mark all but the lead of each
// story as a duplicate (archived, reversible), recording the lead's id.
async function dedup() {
  const { clusterStories, CLUSTER_VERSION } = require("../server-lib-story-cluster");
  const { rows: items } = await pool.query(
    `SELECT ci.id, ci.title, ci.summary, ci.translated_text, ci.source_name, COALESCE(ci.url, ci.source_url) AS url
       FROM classified_items ci
       JOIN item_screen_decisions sc
         ON sc.item_id = ci.id AND sc.step = 'scope_check' AND sc.decision = 'keep'
      WHERE ci.status = 'pending_review'
        AND NOT EXISTS (SELECT 1 FROM item_screen_decisions d WHERE d.item_id = ci.id AND d.step = 'dedup')`
  );
  const { rows: srcRows } = await pool.query(
    `SELECT source_name FROM content_sources WHERE lens = 'africa-sport-business'`
  );
  const { stories } = await clusterStories(items, { preferredSources: srcRows.map((r) => r.source_name) });
  let dupes = 0;
  for (const s of stories) {
    await pool.query(
      `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
       VALUES ($1, 'dedup', 'keep', 'story_lead', $2, $3, $4, $5)`,
      [s.lead.id, `Lead of story: ${s.label}`, JSON.stringify({ duplicate_ids: s.duplicates.map((d) => d.id) }), s.lead.url, CLUSTER_VERSION]
    );
    for (const d of s.duplicates) {
      await pool.query(
        `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
         VALUES ($1, 'dedup', 'archive', 'same_story', $2, $3, $4, $5)`,
        [d.id, `Same story as "${s.lead.title}".`, JSON.stringify({ lead_id: s.lead.id }), d.url, CLUSTER_VERSION]
      );
      await pool.query(
        `UPDATE classified_items SET status = 'archived', updated_at = now() WHERE id = $1 AND status = 'pending_review'`,
        [d.id]
      );
      dupes++;
    }
  }
  console.log(`${items.length} in-scope items -> ${stories.length} stories (${dupes} duplicates archived).`);
  await importance();
}

// Score every in-scope story lead for importance (no model) and record the
// parts, so the queue can rank by it and Nik can see why. Uses the story
// cluster from dedup (other outlets reporting it) and the last four
// published briefs (for "country not covered recently").
async function importance() {
  const imp = require("../server-lib-importance");
  const { rows: items } = await pool.query(
    `SELECT ci.id, ci.title, ci.summary, ci.translated_text, ci.source_name, COALESCE(ci.url, ci.source_url) AS url,
            d.detail->'duplicate_ids' AS duplicate_ids
       FROM classified_items ci
       JOIN item_screen_decisions sc ON sc.item_id = ci.id AND sc.step = 'scope_check' AND sc.decision = 'keep'
       LEFT JOIN LATERAL (SELECT detail FROM item_screen_decisions x
                           WHERE x.item_id = ci.id AND x.step = 'dedup' AND x.decision = 'keep'
                           ORDER BY x.created_at DESC LIMIT 1) d ON true
      WHERE ci.status = 'pending_review'
        AND NOT EXISTS (SELECT 1 FROM item_screen_decisions i WHERE i.item_id = ci.id AND i.step = 'importance')`
  );
  if (!items.length) return;
  const { rows: orgs } = await pool.query(
    `SELECT astn_id, organization_name, level, organization_type, country FROM organizations`
  );
  const { rows: srcRows } = await pool.query(`SELECT source_name FROM content_sources WHERE lens = 'africa-sport-business'`);
  const { rows: recent } = await pool.query(
    `SELECT report_markdown FROM weekly_reports WHERE status = 'published' ORDER BY week_ending DESC NULLS LAST LIMIT 4`
  );
  const matcher = imp.buildMatcher(orgs);
  const countries = [...new Set(orgs.map((o) => o.country).filter(Boolean))];
  const recentBriefText = recent.map((r) => r.report_markdown).join("\n");

  for (const it of items) {
    const dupIds = Array.isArray(it.duplicate_ids) ? it.duplicate_ids : [];
    let clusterOutlets = 0;
    if (dupIds.length) {
      const { rows } = await pool.query(
        `SELECT count(DISTINCT source_name)::int AS n FROM classified_items WHERE id = ANY($1::uuid[]) AND source_name IS DISTINCT FROM $2`,
        [dupIds, it.source_name]
      );
      clusterOutlets = rows[0].n;
    }
    const s = imp.scoreItem(it, {
      matcher, africaSportSources: srcRows.map((r) => r.source_name), clusterOutlets, countries, recentBriefText,
    });
    const why = Object.entries(s.parts).filter(([, v]) => v > 0).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ") || "nothing scored";
    await pool.query(
      `INSERT INTO item_screen_decisions (item_id, step, decision, rule, reason, detail, source_url, version)
       VALUES ($1, 'importance', 'keep', NULL, $2, $3, $4, $5)`,
      [it.id, `Importance ${s.score}: ${why}.`,
       JSON.stringify({ score: s.score, parts: s.parts, money: s.money,
         registry: s.matches.map((m) => ({ matched_as: m.matched_as, ambiguous: m.ambiguous, orgs: m.orgs })) }),
       it.url, imp.IMPORTANCE_VERSION]
    );
  }
  console.log(`Importance: scored ${items.length} in-scope items.`);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "submit") await submit();
  else if (cmd === "collect" && arg) await collect(arg);
  else if (cmd === "dedup") await dedup();
  else if (cmd === "importance") await importance();
  else throw new Error("Usage: scope-check-job.js submit | collect <batch-id> | dedup | importance");
})()
  .catch((e) => { console.error("ERR", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

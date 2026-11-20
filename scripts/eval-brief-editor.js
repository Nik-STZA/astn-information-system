#!/usr/bin/env node
/**
 * End-to-end test of verifier -> editor -> reviewer -> one revision ->
 * reviewer, on a set of stand-in approvals (items Nik has not approved;
 * test only, nothing is written to the database or published).
 *
 * Usage: node scripts/eval-brief-editor.js <data-dir> <week-ending> <title-pattern>...
 * Reads pending.jsonl (candidate items) and week-items.json (for related
 * stories) from <data-dir>. Writes draft-1.md, draft-2.md and a JSON log
 * there. Needs ANTHROPIC_API_KEY.
 */
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { verifyItem, findRelated, weekBounds } = require("../server-lib-verifier");
const { draftBrief, reviseBrief } = require("../server-lib-brief-editor");
const { reviewBrief } = require("../server-lib-brief-review");

const [dir, weekEnding, ...patterns] = process.argv.slice(2);
const RATE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const cost = (u) => !u ? 0 : ((u.input_tokens || 0) * RATE.input + (u.output_tokens || 0) * RATE.output +
  (u.cache_read_input_tokens || 0) * RATE.cacheRead + (u.cache_creation_input_tokens || 0) * RATE.cacheWrite) / 1e6;
const searches = (u) => (u && u.server_tool_use && u.server_tool_use.web_search_requests) || 0;

(async () => {
  const anthropic = new Anthropic();
  const pending = fs.readFileSync(path.join(dir, "pending.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const pool = JSON.parse(fs.readFileSync(path.join(dir, "week-items.json"), "utf8"));
  const items = patterns.map((p) => pending.find((x) => new RegExp(p, "i").test(x.title))).filter(Boolean);
  console.log(`Stand-in approvals: ${items.length} of ${patterns.length} patterns matched`);
  const week = weekBounds(weekEnding);
  let spend = 0, nSearch = 0;

  // 1. Verify
  const queue = [...items];
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const it = queue.shift();
      it.related = findRelated(it, pool);
      const v = await verifyItem(it, { weekEnding, related: it.related, anthropic });
      it.verify = { decision: v.decision, reason: v.reason, problems: v.problems, required_edits: v.required_edits, reading: v.detail.reading };
      it.source_text = v.source.text;
      for (const u of v.usage) { spend += cost(u); nSearch += searches(u); }
      console.log(`  verify ${v.decision.padEnd(10)} ${it.title.slice(0, 70)} | ${v.reason}`);
    }
  }));

  // 2. Draft
  const d1 = await draftBrief({ weekEnding, weekLabel: week.label, items }, { anthropic });
  spend += cost(d1.usage);
  fs.writeFileSync(path.join(dir, "draft-1.md"), d1.markdown || "");
  console.log(`\nDraft 1: used ${d1.used_ids.length}, dropped ${d1.dropped.length}`);
  for (const d of d1.dropped) console.log(`  dropped: ${d.reason}`);
  console.log(`  notes for Nik: ${d1.notes_for_nik}`);

  // 3. Review
  const sources = items.map((it) => ({ url: it.url, text: it.source_text }));
  const verified = items.map((it) => ({ title: it.title, url: it.url, ...it.verify }));
  const r1 = await reviewBrief({ markdown: d1.markdown, weekLabel: week.label, verified, sources }, { anthropic });
  spend += cost(r1.usage);
  const tally = (r) => `${r.result.toUpperCase()} (${r.findings.filter((f) => f.severity === "must fix").length} must fix, ${r.findings.filter((f) => f.severity === "should fix").length} should fix; failed lines: ${r.checklist.filter((c) => c.result === "fail").map((c) => c.id).join(", ") || "none"})`;
  console.log(`\nReview 1: ${tally(r1)}`);
  for (const f of r1.findings.filter((f) => f.severity !== "note")) console.log(`  [${f.severity}] ${f.location} | ${f.rule} | ${f.fix.slice(0, 140)}`);

  let final = { draft: d1, review: r1 };
  if (r1.result === "fail") {
    // 4. Revise once, review again
    const d2 = await reviseBrief({ weekEnding, weekLabel: week.label, items, markdown: d1.markdown, review: r1 }, { anthropic });
    spend += cost(d2.usage);
    fs.writeFileSync(path.join(dir, "draft-2.md"), d2.markdown || "");
    const r2 = await reviewBrief({ markdown: d2.markdown, weekLabel: week.label, verified, sources }, { anthropic });
    spend += cost(r2.usage);
    console.log(`\nReview 2: ${tally(r2)}`);
    for (const f of r2.findings.filter((f) => f.severity !== "note")) console.log(`  [${f.severity}] ${f.location} | ${f.rule} | ${f.fix.slice(0, 140)}`);
    console.log(`  notes for Nik: ${d2.notes_for_nik}`);
    final = { draft: d2, review: r2 };
  }

  fs.writeFileSync(path.join(dir, "editor-run.json"), JSON.stringify({
    items: items.map((it) => ({ id: it.id, title: it.title, url: it.url, verify: it.verify })),
    final_review: final.review,
  }, null, 1));
  console.log(`\nCost: $${(spend + nSearch * 0.01).toFixed(2)} (${nSearch} web searches)`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

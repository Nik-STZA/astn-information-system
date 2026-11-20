#!/usr/bin/env node
/**
 * Run the reviewer (server-lib-brief-review.js) on a published brief, using
 * the verifier's results for its items.
 *
 * Usage: node scripts/eval-brief-review.js <data-dir> <week-ending> [markdown-file]
 * Reads brief-markdown.json and verifier-results.json from <data-dir>
 * (outside git: the repo is public). A markdown file, if given, replaces the
 * published text (to review a rewritten draft). Re-fetches the sources the
 * verifier read. Needs ANTHROPIC_API_KEY.
 */
const fs = require("fs");
const path = require("path");
const { reviewBrief } = require("../server-lib-brief-review");
const { fetchSource } = require("../server-lib-source-fetch");
const { weekBounds } = require("../server-lib-verifier");

const [dir, week, mdFile] = process.argv.slice(2);
const RATE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const cost = (u) => !u ? 0 : ((u.input_tokens || 0) * RATE.input + (u.output_tokens || 0) * RATE.output +
  (u.cache_read_input_tokens || 0) * RATE.cacheRead + (u.cache_creation_input_tokens || 0) * RATE.cacheWrite) / 1e6;

(async () => {
  const brief = JSON.parse(fs.readFileSync(path.join(dir, "brief-markdown.json"), "utf8")).find((b) => b.week_ending.startsWith(week));
  const markdown = mdFile ? fs.readFileSync(mdFile, "utf8") : brief.report_markdown;
  const verified = JSON.parse(fs.readFileSync(path.join(dir, "verifier-results.json"), "utf8")).filter((v) => v.week === week)
    .map((v) => ({ ...v, reading: v.detail && v.detail.reading }));
  const sources = [];
  for (const v of verified) {
    const s = await fetchSource(v.url);
    sources.push({ url: v.url, text: s.ok ? s.text : `(not available: ${s.reason})` });
  }
  const r = await reviewBrief({ markdown, weekLabel: weekBounds(week).label, verified, sources });
  fs.writeFileSync(path.join(dir, `review-${week}${mdFile ? "-draft" : ""}.json`), JSON.stringify(r, null, 1));

  console.log(`RESULT: ${r.result.toUpperCase()}  (${r.findings.filter((f) => f.severity === "must fix").length} must fix, ${r.findings.filter((f) => f.severity === "should fix").length} should fix)`);
  console.log(`\n${r.summary}\n\nChecklist:`);
  for (const c of r.checklist) console.log(`  ${c.result === "pass" ? "pass" : "FAIL"}  ${c.id}: ${c.note}`);
  console.log("\nFindings by the model (code findings as in the code-check run):");
  for (const f of r.findings.filter((f) => f.by === "model")) {
    console.log(`  [${f.severity}] ${f.location} | ${f.rule}\n      "${f.text.slice(0, 160)}"\n      fix: ${f.fix}`);
  }
  console.log(`\nCost: $${cost(r.usage).toFixed(2)}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

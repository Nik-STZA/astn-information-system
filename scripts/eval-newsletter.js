#!/usr/bin/env node
/**
 * Try the newsletter drafter on a brief.
 *
 * Usage: node scripts/eval-newsletter.js <data-dir> <week-ending> [markdown-file]
 * Reads brief-markdown.json and published-figures.json from <data-dir>
 * (outside git). A markdown file, if given, stands in for the published
 * brief (for example a draft from the editor). Needs ANTHROPIC_API_KEY.
 */
const fs = require("fs");
const path = require("path");
const { draftNewsletter } = require("../server-lib-newsletter");

const [dir, week, mdFile] = process.argv.slice(2);
const RATE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const cost = (u) => !u ? 0 : ((u.input_tokens || 0) * RATE.input + (u.output_tokens || 0) * RATE.output +
  (u.cache_read_input_tokens || 0) * RATE.cacheRead + (u.cache_creation_input_tokens || 0) * RATE.cacheWrite) / 1e6;

(async () => {
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "brief-markdown.json"), "utf8")).find((b) => b.week_ending.startsWith(week));
  const brief = {
    id: stored ? stored.id : "test",
    status: "published",
    week_ending: week,
    report_markdown: mdFile ? fs.readFileSync(mdFile, "utf8") : stored.report_markdown,
  };
  const figures = JSON.parse(fs.readFileSync(path.join(dir, "published-figures.json"), "utf8"));
  const n = await draftNewsletter(brief, figures);
  const out = path.join(dir, `newsletter-${week}${mdFile ? "-from-draft" : ""}.md`);
  fs.writeFileSync(out, n.markdown);
  console.log(n.markdown);
  console.log(`\n---\nRESULT: ${n.result.toUpperCase()}  (note ${n.note_is_draft ? "drafted, needs Nik" : "taken from the brief"})\n${n.summary}`);
  for (const f of n.findings) console.log(`  [${f.severity}] (${f.by}) ${f.location} | ${f.rule} | ${String(f.text).slice(0, 120)} | fix: ${String(f.fix).slice(0, 140)}`);
  console.log(`Cost: $${n.usage.reduce((a, u) => a + cost(u), 0).toFixed(2)}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

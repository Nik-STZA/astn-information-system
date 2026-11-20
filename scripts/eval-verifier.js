#!/usr/bin/env node
/**
 * Run the verifier (server-lib-verifier.js) over the items of published
 * briefs and print what it finds, for comparison with Nik's manual check of
 * the w/e 19 November 2026 brief.
 *
 * Usage: node scripts/eval-verifier.js <data-dir> [only-week-ending] [--limit n]
 * Reads brief-items.json (items with week_ending) and week-items.json (all
 * items from the surrounding weeks, for related stories) from <data-dir>,
 * which is outside git because the repo is public. Needs ANTHROPIC_API_KEY.
 */
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { verifyItem, findRelated } = require("../server-lib-verifier");

const args = process.argv.slice(2);
const dir = args[0];
const onlyWeek = args[1] && !args[1].startsWith("--") ? args[1] : null;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx > -1 ? Number(args[limitIdx + 1]) : Infinity;

// Opus 5.5 rates, $ per MTok (no batch discount: the verifier runs synchronously).
const RATE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const cost = (u) => !u ? 0 : ((u.input_tokens || 0) * RATE.input + (u.output_tokens || 0) * RATE.output +
  (u.cache_read_input_tokens || 0) * RATE.cacheRead + (u.cache_creation_input_tokens || 0) * RATE.cacheWrite) / 1e6;
const searches = (u) => (u && u.server_tool_use && u.server_tool_use.web_search_requests) || 0;

(async () => {
  const items = JSON.parse(fs.readFileSync(path.join(dir, "brief-items.json"), "utf8"))
    .map((x) => ({ ...x, week_ending: String(x.week_ending).slice(0, 10) }))
    .filter((x) => !onlyWeek || x.week_ending === onlyWeek)
    .slice(0, limit);
  const pool = JSON.parse(fs.readFileSync(path.join(dir, "week-items.json"), "utf8"));
  const anthropic = new Anthropic();

  const results = [];
  const queue = [...items];
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const it = queue.shift();
      const related = findRelated(it, pool);
      const r = await verifyItem(it, { weekEnding: it.week_ending, related, anthropic });
      results.push({ item: it, related: related.length, r });
      process.stderr.write(`  ${r.decision.padEnd(10)} ${it.title.slice(0, 70)}\n`);
    }
  }));

  fs.writeFileSync(path.join(dir, "verifier-results.json"),
    JSON.stringify(results.map(({ item, related, r }) => ({ week: item.week_ending, title: item.title, source: item.source_name, url: item.url, related, ...r, source: undefined })), null, 1));

  let total = 0, nSearch = 0;
  for (const week of [...new Set(results.map((x) => x.item.week_ending))].sort().reverse()) {
    console.log(`\n=== w/e ${week}`);
    for (const { item, related, r } of results.filter((x) => x.item.week_ending === week)) {
      console.log(`\n[${r.decision.toUpperCase()}] ${item.title.slice(0, 100)}  (${item.source_name}; ${related} related)`);
      console.log(`  ${r.reason}`);
      const pub = r.detail.source.published;
      console.log(`  published ${pub.date ? pub.date.slice(0, 10) : "unknown"}${pub.where ? ` (${pub.where})` : ""}; event ${r.detail.reading ? r.detail.reading.event_date : "-"}`);
      for (const p of r.problems.slice(1)) console.log(`  problem: ${p}`);
      for (const e of r.required_edits) console.log(`  edit: ${e}`);
      if (r.detail.reading) console.log(`  technology: ${r.detail.reading.technology}`);
      for (const u of r.usage) { total += cost(u); nSearch += searches(u); }
    }
  }
  const searchCost = nSearch * 0.01;
  console.log(`\nCost: $${(total + searchCost).toFixed(2)} for ${results.length} items (tokens $${total.toFixed(2)}, ${nSearch} web searches $${searchCost.toFixed(2)})`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

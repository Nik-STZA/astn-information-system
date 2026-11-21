#!/usr/bin/env node
/**
 * Evaluate the scope check (server-lib-scope-check.js) against Nik's reviewed
 * items, and run it over the pending items the rule screen kept.
 *
 * Usage:
 *   node scripts/eval-scope-check.js <data-dir> sample [n]   one synchronous call per item, for a smoke test
 *   node scripts/eval-scope-check.js <data-dir> submit       submit one batch (test set + pending survivors)
 *   node scripts/eval-scope-check.js <data-dir> collect <batch-id>
 *
 * Reads testset.jsonl, pending.jsonl, registry.json from <data-dir> (not in
 * git: the repo is public). Labels come from label_scope (Nik, 20 Nov 2026:
 * Africa-tech-without-sport approvals are out of scope). Needs ANTHROPIC_API_KEY.
 */
const fs = require("fs");
const path = require("path");
const scope = require("../server-lib-scope-check");
const { buildScreen } = require("../server-lib-rule-screen");

const [dir, cmd, arg] = process.argv.slice(2);
const readJsonl = (f) => fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

function loadSets() {
  const byTitle = new Map();
  for (const r of readJsonl("testset.jsonl")) {
    const k = r.title.trim().toLowerCase();
    const prev = byTitle.get(k);
    const label = r.label_scope || r.label;
    if (!prev) byTitle.set(k, { ...r, label });
    else if (label === "approve") byTitle.set(k, { ...prev, label: "approve" });
  }
  const test = [...byTitle.values()];
  const registry = JSON.parse(fs.readFileSync(path.join(dir, "registry.json"), "utf8"));
  const { screen } = buildScreen(registry, { africaSportSources: ["Business of Sports Africa", "Esports Africa News"] });
  for (const t of test) t.rule = screen(t);
  const pending = readJsonl("pending.jsonl").map((p) => ({ ...p, rule: screen(p) })).filter((p) => p.rule.keep);
  return { test, pending };
}

// Haiku 5.5 rates (prompts <= 100K tokens), Batch API = 50% off.
const RATE = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 }; // $ per MTok, before batch discount
function costOf(usage) {
  const u = usage || {};
  return ((u.input_tokens || 0) * RATE.input + (u.output_tokens || 0) * RATE.output +
    (u.cache_read_input_tokens || 0) * RATE.cacheRead + (u.cache_creation_input_tokens || 0) * RATE.cacheWrite) / 1e6 * 0.5;
}

(async () => {
  const { test, pending } = loadSets();

  if (cmd === "sample") {
    const n = Number(arg || 6);
    const pick = [...test.filter((t) => t.label === "approve").slice(0, n / 2), ...test.filter((t) => t.label === "reject").slice(0, n / 2)];
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic();
    for (const it of pick) {
      const msg = await client.messages.create(scope.buildParams(it));
      const d = scope.parseMessage(msg);
      console.log(`[${it.label}] ${it.title.slice(0, 70)}\n   -> ${d.decision} ${JSON.stringify(d.answers)} ${d.reason}\n   usage ${JSON.stringify(msg.usage)}`);
    }
    return;
  }

  if (cmd === "submit") {
    const items = [
      ...test.map((t) => ({ ...t, id: `t_${t.id}` })),
      ...pending.map((p) => ({ ...p, id: `p_${p.id}` })),
    ];
    const id = await scope.submitBatch(items);
    console.log(`Submitted batch ${id} with ${items.length} requests (${test.length} test, ${pending.length} pending survivors)`);
    return;
  }

  if (cmd === "collect") {
    await scope.waitForBatch(arg, undefined, { onPoll: (b) => console.log(`  ${b.processing_status} ${JSON.stringify(b.request_counts)}`) });
    const res = await scope.collectResults(arg);
    fs.writeFileSync(path.join(dir, "scope-results.json"), JSON.stringify([...res.entries()]));

    const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
    let cost = 0, errors = 0;
    for (const r of res.values()) { cost += costOf(r.usage); if (r.error) errors++; }

    const scored = test.map((t) => ({ t, r: res.get(`t_${t.id}`) })).filter((x) => x.r);
    const appr = scored.filter((x) => x.t.label === "approve");
    const rej = scored.filter((x) => x.t.label === "reject");
    const keep = (x) => x.r.decision === "keep";
    console.log(`\nScope check alone, on all ${scored.length} reviewed items:`);
    console.log(`  Approvals kept:     ${appr.filter(keep).length}/${appr.length} (${pct(appr.filter(keep).length, appr.length)})`);
    console.log(`  Rejections removed: ${rej.filter((x) => !keep(x)).length}/${rej.length} (${pct(rej.filter((x) => !keep(x)).length, rej.length)})`);

    const both = (x) => x.t.rule.keep && keep(x);
    console.log(`\nRule screen then scope check:`);
    console.log(`  Approvals kept:     ${appr.filter(both).length}/${appr.length} (${pct(appr.filter(both).length, appr.length)})`);
    console.log(`  Rejections removed: ${rej.filter((x) => !both(x)).length}/${rej.length} (${pct(rej.filter((x) => !both(x)).length, rej.length)})`);

    const failCounts = { africa: 0, sport: 0, business: 0 };
    for (const x of rej) if (x.r.answers) for (const k of Object.keys(failCounts)) if (!x.r.answers[k]) failCounts[k]++;
    console.log(`  Rejections failing each question (an item can fail several):`, failCounts);

    console.log(`\nApprovals the scope check would archive:`);
    for (const x of appr.filter((x) => !keep(x))) {
      console.log(`  - [${x.t.source_name}] ${x.t.title.slice(0, 100)}\n      ${JSON.stringify(x.r.answers)} ${x.r.reason}`);
    }
    console.log(`\nRejections the scope check keeps (${rej.filter(keep).length}):`);
    for (const x of rej.filter(keep)) {
      console.log(`  - [${x.t.source_name}] ${x.t.title.slice(0, 100)}\n      ${x.r.reason}`);
    }

    const pk = pending.filter((p) => res.get(`p_${p.id}`)?.decision === "keep");
    console.log(`\nPending queue: 1127 -> ${pending.length} after rule screen -> ${pk.length} after scope check`);
    const bySource = {};
    for (const p of pk) bySource[p.source_name] = (bySource[p.source_name] || 0) + 1;
    console.log("  Survivors by source:", bySource);
    fs.writeFileSync(path.join(dir, "scope-pending-survivors.jsonl"),
      pk.map((p) => JSON.stringify({ id: p.id, source: p.source_name, title: p.title, url: p.url, reason: res.get(`p_${p.id}`).reason })).join("\n") + "\n");

    const n = res.size;
    console.log(`\nCost: $${cost.toFixed(4)} for ${n} requests ($${(cost / n * 1000).toFixed(3)} per 1,000), ${errors} errors or refusals`);
    return;
  }

  if (cmd === "cluster") {
    const { clusterStories } = require("../server-lib-story-cluster");
    const ids = new Set(fs.readFileSync(path.join(dir, "scope-pending-survivors.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).id));
    const items = pending.filter((p) => ids.has(p.id));
    const { stories, usage } = await clusterStories(items, { preferredSources: ["Business of Sports Africa", "Esports Africa News"] });
    console.log(`${items.length} in-scope items -> ${stories.length} stories\n`);
    for (const s of stories) {
      console.log(`* ${s.label}\n    lead: [${s.lead.source_name}] ${s.lead.title.slice(0, 90)}`);
      for (const d of s.duplicates) console.log(`    dup:  [${d.source_name}] ${d.title.slice(0, 90)}`);
    }
    console.log(`\nCost: $${(costOf(usage) * 2).toFixed(4)} (synchronous call, no batch discount)`);
    return;
  }

  console.error("Usage: node scripts/eval-scope-check.js <data-dir> sample|submit|collect|cluster [arg]");
  process.exit(1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

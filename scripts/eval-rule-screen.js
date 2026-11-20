#!/usr/bin/env node
/**
 * Offline evaluation of the rule screen (server-lib-rule-screen.js).
 *
 * Usage:
 *   node scripts/eval-rule-screen.js <data-dir> [--show-kept-rejections]
 *
 * <data-dir> must hold (exported read-only from africastn_os; NOT committed,
 * because this repo is public):
 *   registry.json   organizations rows (astn_id, organization_name, organization_website)
 *   testset.jsonl   reviewed items with label 'approve' | 'reject'
 *   pending.jsonl   items currently in pending_review
 *
 * Headlines that appear more than once are merged; a merged headline counts
 * as an approval if any copy was approved.
 */
const fs = require("fs");
const path = require("path");
const { buildScreen } = require("../server-lib-rule-screen");

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node scripts/eval-rule-screen.js <data-dir>");
  process.exit(1);
}
const readJsonl = (f) =>
  fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

const registry = JSON.parse(fs.readFileSync(path.join(dir, "registry.json"), "utf8"));
// Sources with the Africa sport-business lens. Proposed, for Nik to confirm;
// in production this comes from content_sources.lens (migration 069).
const AFRICA_SPORT_SOURCES = ["Business of Sports Africa", "Esports Africa News"];
const { screen, stats } = buildScreen(registry, { africaSportSources: AFRICA_SPORT_SOURCES });
console.log(`Registry: ${stats.orgs} organisations, ${stats.safeOrgNames} names safe to match, ${stats.domains} domains\n`);

// Merge repeated headlines
const byTitle = new Map();
for (const r of readJsonl("testset.jsonl")) {
  const k = r.title.trim().toLowerCase();
  const prev = byTitle.get(k);
  if (!prev) byTitle.set(k, r);
  else if (r.label === "approve") byTitle.set(k, { ...r, label: "approve" });
}
const test = [...byTitle.values()];

const res = test.map((r) => ({ r, s: screen(r) }));
const appr = res.filter((x) => x.r.label === "approve");
const rej = res.filter((x) => x.r.label === "reject");
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;

const apprKept = appr.filter((x) => x.s.keep).length;
const rejDropped = rej.filter((x) => !x.s.keep).length;
console.log(`Test set: ${test.length} items after merging repeats (${appr.length} approvals, ${rej.length} rejections)`);
console.log(`  Approvals kept:     ${apprKept}/${appr.length} (${pct(apprKept, appr.length)})`);
console.log(`  Rejections removed: ${rejDropped}/${rej.length} (${pct(rejDropped, rej.length)})`);

const byRule = (arr) =>
  arr.reduce((m, x) => ((m[x.s.rule || "dropped"] = (m[x.s.rule || "dropped"] || 0) + 1), m), {});
console.log("  Approvals by rule: ", byRule(appr));
console.log("  Rejections by rule:", byRule(rej));

console.log("\nApprovals the screen would drop:");
const dropped = appr.filter((x) => !x.s.keep);
if (!dropped.length) console.log("  none");
for (const x of dropped) {
  console.log(`  - [${x.r.source_name}] ${x.r.title}\n      ${x.s.reason}`);
}

if (process.argv.includes("--show-kept-rejections")) {
  console.log("\nRejections the screen keeps (sample of 40):");
  for (const x of rej.filter((x) => x.s.keep).slice(0, 40)) {
    console.log(`  - [${x.s.rule}] ${x.r.title.slice(0, 90)}  | ${x.s.reason}`);
  }
}

// Pending queue
const pending = readJsonl("pending.jsonl");
const pres = pending.map((r) => ({ r, s: screen(r) }));
const pk = pres.filter((x) => x.s.keep);
console.log(`\nPending queue: ${pending.length} items, ${pk.length} survive (${pct(pk.length, pending.length)})`);
console.log("  Survivors by rule:", byRule(pk));
const bySource = {};
for (const x of pres) {
  const s = (bySource[x.r.source_name] ||= { total: 0, kept: 0 });
  s.total++;
  if (x.s.keep) s.kept++;
}
console.log("  By source (total -> kept), largest first:");
for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`    ${k.padEnd(30)} ${String(v.total).padStart(4)} -> ${String(v.kept).padStart(4)}`);
}

if (process.argv.includes("--dump")) {
  fs.writeFileSync(
    path.join(dir, "rule-screen-results.jsonl"),
    [...res.map((x) => ({ set: "test", ...x })), ...pres.map((x) => ({ set: "pending", ...x }))]
      .map((x) => JSON.stringify({ set: x.set, id: x.r.id, label: x.r.label, source: x.r.source_name, title: x.r.title, ...x.s }))
      .join("\n") + "\n"
  );
  console.log(`\nPer-item results written to ${path.join(dir, "rule-screen-results.jsonl")}`);
}

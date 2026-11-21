#!/usr/bin/env node
/**
 * Does the importance score rank Nik's approvals above his rejections?
 *
 * Usage: node scripts/eval-importance.js <data-dir>
 * Uses the reviewed test set (testset.jsonl, label_scope), the registry and,
 * where present, the scope check's results (scope-results.json) to restrict
 * to items the scope check kept, as the score only ever sees those.
 * Compares with the old relevance_score. No model, no network.
 */
const fs = require("fs");
const path = require("path");
const { buildMatcher, scoreItem } = require("../server-lib-importance");

const dir = process.argv[2];
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const registry = JSON.parse(read("registry.json"));
const matcher = buildMatcher(registry);
console.log("Matcher:", matcher.stats);

const byTitle = new Map();
for (const r of read("testset.jsonl").trim().split("\n").map(JSON.parse)) {
  const k = r.title.trim().toLowerCase();
  const label = r.label_scope || r.label;
  const prev = byTitle.get(k);
  if (!prev || label === "approve") byTitle.set(k, { ...r, label });
}
let items = [...byTitle.values()];
let scope = null;
try { scope = new Map(JSON.parse(read("scope-results.json"))); } catch { /* none */ }
if (scope) items = items.filter((t) => scope.get(`t_${t.id}`) && scope.get(`t_${t.id}`).decision === "keep");

const weights = process.argv[3] || "editorial";
console.log(`Weights: ${weights}`);
const scored = items.map((t) => ({ t, s: scoreItem(t, {
  matcher, weights, africaSportSources: ["Business of Sports Africa", "Esports Africa News"], clusterOutlets: 0,
}) }));

// AUC: chance a random approval outranks a random rejection (ties count half).
function auc(list, key) {
  const a = list.filter((x) => x.t.label === "approve").map(key);
  const r = list.filter((x) => x.t.label === "reject").map(key);
  let wins = 0;
  for (const x of a) for (const y of r) wins += x > y ? 1 : x === y ? 0.5 : 0;
  return a.length && r.length ? wins / (a.length * r.length) : NaN;
}
const mean = (arr) => arr.reduce((p, c) => p + c, 0) / (arr.length || 1);
const ap = scored.filter((x) => x.t.label === "approve");
const rj = scored.filter((x) => x.t.label === "reject");
console.log(`\nItems scored: ${scored.length} in scope (${ap.length} approvals, ${rj.length} rejections)`);
console.log(`Mean importance: approvals ${mean(ap.map((x) => x.s.score)).toFixed(1)}, rejections ${mean(rj.map((x) => x.s.score)).toFixed(1)}`);
console.log(`AUC importance:      ${auc(scored, (x) => x.s.score).toFixed(3)}`);
console.log(`AUC relevance_score: ${auc(scored, (x) => x.t.relevance_score || 0).toFixed(3)}  (the old classifier score)`);
const nov = scored.filter((x) => String(x.t.reviewed_at || "").startsWith("2026-11"));
console.log(`November reviews only (${nov.length} items): AUC importance ${auc(nov, (x) => x.s.score).toFixed(3)}, relevance_score ${auc(nov, (x) => x.t.relevance_score || 0).toFixed(3)}`);

for (const part of ["money", "technology", "registry", "source"]) {
  const on = scored.filter((x) => x.s.parts[part] > 0);
  const rate = (arr) => arr.length ? `${((100 * arr.filter((x) => x.t.label === "approve").length) / arr.length).toFixed(0)}% approved` : "-";
  console.log(`  ${part.padEnd(11)} present in ${String(on.length).padStart(3)} items: ${rate(on)}; absent: ${rate(scored.filter((x) => !(x.s.parts[part] > 0)))}`);
}

const top = [...scored].sort((a, b) => b.s.score - a.s.score);
const prec = (k) => (100 * top.slice(0, k).filter((x) => x.t.label === "approve").length / k).toFixed(0);
const base = (100 * ap.length / scored.length).toFixed(0);
console.log(`\nApproved share: top 20 ${prec(20)}%, top 40 ${prec(40)}%, all items ${base}%`);
console.log("\nTop 10:");
for (const x of top.slice(0, 10)) console.log(`  ${String(x.s.score).padStart(3)} ${x.t.label.padEnd(7)} ${JSON.stringify(x.s.parts)} ${x.t.title.slice(0, 70)}`);
const amb = scored.filter((x) => x.s.matches.some((m) => m.ambiguous)).length;
console.log(`\nItems with an ambiguous registry match: ${amb}; with a firm match: ${scored.filter((x) => x.s.parts.registry > 0).length}`);

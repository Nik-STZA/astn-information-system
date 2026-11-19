// What FM1 works from on a reconciliation, as one short key, so "Run all"
// can leave alone a rec FM1 has already finished on when nothing it reads
// has moved since (close in a day or two, 18 Nov 2026: a second run on the
// same facts costs money and gives the CFO the same answer to read again).
//
// The key is taken when an FM1 run on the rec finishes (server.js, the run's
// completion), so what FM1 itself saved during the run is in it. A person's
// comment, new evidence, a schedule edit, a moved figure, a cleared item, a
// review note or the prior month's sign-off all change it. Pure.

const crypto = require("crypto");
const { toPence } = require("./journal");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const money = (v) => (v === null || v === undefined ? null : toPence(v));
const byId = (a, b) => String(a.id ?? a.entity_id).localeCompare(String(b.id ?? b.entity_id));

//   parts  { status, review_note, prior_status, balances, evidence, items, reconciling, statements, people }
function inputsKey(parts) {
  const p = parts || {};
  const canon = {
    status: p.status ?? null,
    review_note: p.review_note ?? null,
    prior_status: p.prior_status ?? null,
    balances: (p.balances ?? []).map((b) => ({ entity_id: b.entity_id, opening: money(b.opening), closing: money(b.closing) })).sort(byId),
    evidence: (p.evidence ?? []).map((e) => ({ id: e.id, entity_id: e.entity_id, amount: money(e.amount) })).sort(byId),
    items: (p.items ?? []).map((i) => ({ id: i.id, updated_at: i.updated_at ? new Date(i.updated_at).toISOString() : null, deleted: Boolean(i.deleted_at) })).sort(byId),
    reconciling: (p.reconciling ?? []).map((r) => ({ id: r.id, state: r.state, kind: r.kind, amount: money(r.amount) })).sort(byId),
    statements: (p.statements ?? []).map((s) => ({ id: s.id })).sort(byId),
    people: (p.people ?? []).map((t) => ({ id: t.id })).sort(byId),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
}

// Why Run all leaves this rec alone, or null to run it. Only a rec still in
// progress whose last FM1 run succeeded on exactly what is there now.
//   last  { run_id, status, inputs, at } from the latest agent_finished event
function unchangedSince({ rec, last, key }) {
  if (rec?.status !== "in_progress" || !last || last.status !== "succeeded" || !last.inputs || last.inputs !== key) return null;
  const d = new Date(last.at);
  const when = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `FM1 finished on it on ${when} and nothing has moved since, so its answer stands. Comment on the rec or add evidence to have it run again.`;
}

module.exports = { inputsKey, unchangedSince };

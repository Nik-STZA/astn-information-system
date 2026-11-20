// Releasing a version of a developed asset, and amortising it after
// (docs/asset-register-spec.md section 4.2; CFO, 20 Nov 2026: every asset on
// the software WIP account has an initial release on 1 November 2026, and
// future builds are their next version).
//
// A release is the signed available-for-use event: the asset's cost moves
// from the WIP account to the cost account, the asset is available from the
// release date, amortisation starts under the policy, and its next version
// opens on the WIP account to take further cost. Amortisation each month is
// the policy's straight-line charge, recorded as an event when the month is
// prepared, and tested against the ledger like any other account.
//
// Pure, so it is tested without a database.

const engine = require("./asset-register");

const r2 = engine.r2;

// "SW-003" -> "SW-003-V2"; "SW-003-V2" -> "SW-003-V3". Version from fields
// when present ("V1" -> "V2").
function nextVersion(asset) {
  const cur = String(asset.fields?.version ?? "").match(/^V(\d+)$/);
  const n = cur ? Number(cur[1]) + 1 : (Number(String(asset.asset_no).match(/-V(\d+)$/)?.[1] ?? 1) + 1);
  const base = String(asset.asset_no).replace(/-V\d+$/, "");
  const name = String(asset.name).replace(/\s+V\d+$/, "");
  return { asset_no: `${base}-V${n}`, name: `${name} V${n}`, version: `V${n}` };
}

// assets: the assets to release (rows with id, entity_id, asset_no, name,
// status, cost_account_id, fields). cost: Map asset id -> cost on the WIP
// account at the day before release. accounts: { cost, accumulated } AccountIDs
// the released asset moves to. Returns { events, updates, next, issues }.
function plan({ assets, cost, date, accounts, policyId, reason, evidence, held = new Set() }) {
  const issues = [];
  const period = engine.periodOf(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) issues.push("date must be YYYY-MM-DD");
  if (!accounts?.cost || !accounts?.accumulated) issues.push("the cost and accumulated amortisation accounts are needed");
  if (String(evidence ?? "").trim().length < 3) issues.push("say what evidences the release (e.g. the CFO's instruction and its date)");
  const events = [];
  const updates = [];
  const next = [];
  for (const a of assets) {
    if (a.status !== "wip") { issues.push(`${a.asset_no} is ${a.status}, not in progress`); continue; }
    const v = nextVersion(a);
    if (held.has(v.asset_no)) issues.push(`${v.asset_no} is already in the register`);
    const amount = r2(cost.get(a.id) ?? 0);
    events.push({ asset_id: a.id, asset_no: a.asset_no, entity_id: a.entity_id, kind: "transfer", period, event_date: date, amount,
      accounts: { from: a.cost_account_id, to: accounts.cost, accumulated: accounts.accumulated }, reason, evidence_ref: String(evidence).trim() });
    updates.push({ asset_id: a.id, asset_no: a.asset_no, status: "available", available_for_use_date: date, cost_account_id: accounts.cost,
      accum_account_id: accounts.accumulated, policy_id: policyId });
    next.push({ entity_id: a.entity_id, asset_no: v.asset_no, name: v.name, status: "wip", cost_account_id: a.cost_account_id,
      parent_asset_id: a.parent_asset_id ?? null, fields: { ...(a.fields || {}), version: v.version, previous: a.asset_no } });
  }
  return { events, updates, next, issues };
}

// The month's amortisation events for available assets the register
// amortises. before: roll(previous month).assets (cost, accumulated negative).
// policies: { id: policy row }. done: Set of asset ids already charged for the
// period. Returns [{ asset_id, entity_id, kind, period, event_date, amount, accounts }].
function monthCharges({ assets, policies, before, period, done = new Set() }) {
  const out = [];
  for (const a of assets || []) {
    if (a.status !== "available" || !a.policy_id || !a.available_for_use_date || done.has(a.id)) continue;
    const p = policies[a.policy_id];
    if (!p) continue;
    const b = before.get(a.id) || { cost: 0, accumulated: 0 };
    // The asset's cost is the same on either side of its release (the
    // transfer moves it between accounts), so last month's cost is the base.
    const charge = engine.expectedCharge({
      cost: b.cost, residual: Number(p.residual_value ?? 0), accumulated: b.accumulated, lifeMonths: p.life_months, lifeKind: p.life_kind,
      start: engine.startPeriod(a.available_for_use_date, p.start_convention), period,
    });
    if (!charge) continue;
    out.push({ asset_id: a.id, asset_no: a.asset_no, entity_id: a.entity_id, kind: "amortisation", period, event_date: engine.monthEnd(period), amount: charge,
      accounts: { accumulated: a.accum_account_id } });
  }
  return out;
}

// Journal lines for Xero, by account code: [{ account_code, amount, description }].
function transferLines(events, codes) {
  const total = r2(events.reduce((s, e) => s + e.amount, 0));
  return total ? [
    { account_code: codes.cost, amount: total, description: `Released to use: ${events.filter((e) => e.amount).map((e) => e.asset_no).join(", ")}` },
    { account_code: codes.wip, amount: -total, description: "Out of work in progress" },
  ] : [];
}

function chargeLines(charges, codes) {
  const total = r2(charges.reduce((s, e) => s + e.amount, 0));
  return total ? [
    { account_code: codes.charge, amount: total, description: `Amortisation: ${charges.map((c) => `${c.asset_no} ${c.amount.toFixed(2)}`).join(", ")}` },
    { account_code: codes.accumulated, amount: -total, description: "Accumulated amortisation" },
  ] : [];
}

module.exports = { nextVersion, plan, monthCharges, transferLines, chargeLines };

// The fixed asset schedule for a month, as an accountant reads it: for each
// asset, cost brought forward, additions and transfers in the month, cost
// carried forward; accumulated amortisation and impairment brought forward,
// the month's charge and impairment, carried forward; net book value at both
// ends. Pure: the route reads the rows. Built from the same approved lines
// and events as the prepared month, so it agrees with the tie.

const { eventEffects } = require("./asset-register");

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const periodOf = (d) => String(d).slice(0, 7);

const EMPTY = () => ({ cost_bf: 0, additions: 0, transfers: 0, accumulated_bf: 0, charge: 0, impairment: 0, other: 0 });

// assets: [{ id, ... }]; lines: approved lines with asset_id, line_date,
// amount, treatment; events: with asset_id, period, kind, amount, accounts.
// Returns Map asset id -> the schedule row.
function schedule({ assets, lines, events, period }) {
  const byId = new Map((assets || []).map((a) => [a.id, a]));
  const eventById = new Map((events || []).map((e) => [e.id, e]));
  const out = new Map((assets || []).map((a) => [a.id, EMPTY()]));
  const row = (id) => { if (!out.has(id)) out.set(id, EMPTY()); return out.get(id); };
  for (const l of lines || []) {
    if (l.treatment !== "capitalise" || !l.asset_id) continue;
    const p = periodOf(l.line_date);
    if (p > period) continue;
    const r = row(l.asset_id);
    if (p === period) r.additions = r2(r.additions + Number(l.amount));
    else r.cost_bf = r2(r.cost_bf + Number(l.amount));
  }
  for (const e of events || []) {
    if (e.period > period) continue;
    const inMonth = e.period === period && e.kind !== "opening";
    for (const x of eventEffects(e, byId.get(e.asset_id), eventById)) {
      const r = row(e.asset_id);
      if (x.side === "cost") {
        if (inMonth) r.transfers = r2(r.transfers + x.amount);
        else r.cost_bf = r2(r.cost_bf + x.amount);
      } else if (!inMonth) r.accumulated_bf = r2(r.accumulated_bf + x.amount);
      else if (x.column === "impairment") r.impairment = r2(r.impairment + x.amount);
      else if (x.column === "amortisation") r.charge = r2(r.charge + x.amount);
      else r.other = r2(r.other + x.amount);
    }
  }
  for (const r of out.values()) {
    r.cost_cf = r2(r.cost_bf + r.additions + r.transfers);
    r.accumulated_cf = r2(r.accumulated_bf + r.charge + r.impairment + r.other);
    r.nbv_bf = r2(r.cost_bf + r.accumulated_bf);
    r.nbv_cf = r2(r.cost_cf + r.accumulated_cf);
  }
  return out;
}

// What an account's Xero-run charge was in the month: the snapshot holds
// Xero's movement since the opening, so the month is this month's figure less
// last month's.
function xeroMonthCharge(thisMonth, lastMonth) {
  if (thisMonth == null) return null;
  return r2(Number(thisMonth) - Number(lastMonth ?? 0));
}

// The month before YYYY-MM.
function previousPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

module.exports = { schedule, xeroMonthCharge, previousPeriod };

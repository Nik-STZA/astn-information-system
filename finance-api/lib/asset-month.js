// Preparing a month of the asset register (docs/asset-register-spec.md
// sections 4.6 and 5): the roll-forward to the month end, tied to each
// company's trial balance, with the controls. Pure, so it is tested without
// Xero or a database; the route reads them and passes them in.
//
// Accounts Xero's own fixed asset register amortises (amortised_by 'xero'):
// Xero's register is their schedule. Their accumulated amortisation in the
// register is the opening plus Xero's own movement on the account since the
// opening, and the control is whether Xero has run its depreciation for the
// month (lastDepreciationDate). A month Xero has not run is a finding, not a
// block: running it is a step in Xero.
//
// Blocks: lines still proposed in or before the month (the register would be
// short of the ledger), a trial balance that does not foot (unless that exact
// difference is acknowledged), and any account left unexplained after its
// named items.

const engine = require("./asset-register");

const r2 = engine.r2;
const lc = (s) => String(s ?? "").toLowerCase();
const inForce = (m, day) => m.effective_from <= day && (!m.effective_to || m.effective_to >= day) && !m.ended_at;
const tbBalance = (report, accountId) => {
  const tb = require("./journal").trialBalanceByAccountId(report);
  const b = Object.entries(tb).find(([id]) => lc(id) === lc(accountId))?.[1];
  return b ? r2(b.ytdDebit - b.ytdCredit) : 0;
};

// period YYYY-MM. map: the grouping's account map rows (with entity_id,
// xero_account_id, account_code, role, amortised_by). assets, lines, events:
// the grouping's rows. trialBalances / openingTrialBalances: { entity_id:
// Xero report } at the month end and at the opening date. namedItems: [{
// entity_id, account_id, label, amount }], the opening's plus anything carried
// since (e.g. a paused grouping's share of a shared account). lastDepreciation:
// { entity_id: date } for companies with accounts Xero amortises.
function prepareMonth({ period, map, assets, lines, events, trialBalances, openingTrialBalances = {}, namedItems = [], lastDepreciation = {},
  tbAcknowledgements = [], tolerance = 0, nameOf = {} }) {
  const end = engine.monthEnd(period);
  const issues = [];
  const findings = [];

  const undecided = lines.filter((l) => l.state === "proposed" && String(l.line_date) <= end);
  for (const l of undecided) issues.push(`${l.invoice_no ?? "A line"} (${r2(l.amount).toFixed(2)}, ${l.line_date}) is still waiting for a decision.`);

  // A line with no posted account (a workbook row whose schedule had no
  // account column) counts on its asset's own account, as at the opening.
  const assetAccount = Object.fromEntries(assets.map((a) => [a.id, a.cost_account_id]));
  const approved = lines.filter((l) => l.state === "approved").map((l) => ({ ...l, line_date: String(l.line_date),
    posted_account_id: l.posted_account_id ?? l.expected_account_id ?? assetAccount[l.asset_id] ?? null }));
  const rolled = engine.roll({ assets, lines: approved, events, period });

  // Accounts in force at the month end: every one is shown, even at nil.
  const live = map.filter((m) => inForce(m, end) && ["cost", "wip", "accumulated"].includes(m.role));
  const key = (e, a) => `${e}|${lc(a)}`;
  const have = new Map(rolled.accounts.map((a) => [key(a.entity_id, a.account_id), a]));
  for (const m of live) {
    if (!have.has(key(m.entity_id, m.xero_account_id))) {
      const row = { entity_id: m.entity_id, account_id: m.xero_account_id, opening: 0, additions: 0, transfers: 0, amortisation: 0, impairment: 0, other: 0, closing: 0 };
      rolled.accounts.push(row);
      have.set(key(m.entity_id, m.xero_account_id), row);
    }
  }
  // Xero amortises it: the register takes Xero's movement since the opening.
  const xeroRuns = {};
  for (const m of live.filter((x) => x.role === "accumulated" && x.amortised_by === "xero")) {
    const row = have.get(key(m.entity_id, m.xero_account_id));
    const moved = r2(tbBalance(trialBalances[m.entity_id], m.xero_account_id) - tbBalance(openingTrialBalances[m.entity_id], m.xero_account_id));
    row.amortisation = r2(row.amortisation + moved);
    row.closing = r2(row.closing + moved);
    row.by_xero = moved;
    if (!xeroRuns[m.entity_id]) {
      xeroRuns[m.entity_id] = engine.xeroRunControl(lastDepreciation[m.entity_id], period);
      if (!xeroRuns[m.entity_id].passes) findings.push({ kind: "xero_depreciation_not_run", company: nameOf[m.entity_id] ?? m.entity_id, issue: xeroRuns[m.entity_id].issue });
    }
  }

  const rows = engine.tie({ rolled, trialBalances, tolerance, namedItems });
  const footing = Object.fromEntries(Object.entries(trialBalances).map(([id, rep]) => [id,
    engine.tbFooting(rep, null, tbAcknowledgements.find((t) => t.entity_id === id) || null)]));
  for (const [id, f] of Object.entries(footing)) if (!f.foots) issues.push(...f.issues.map((x) => `${nameOf[id] ?? id}: ${x}`));
  for (const r of rows) if (!r.ties) issues.push(`${nameOf[r.entity_id] ?? r.entity_id} ${r.account ?? r.account_id}: register ${r.register} against ledger ${r.ledger}, ${r.unexplained} unexplained`);
  const slices = engine.sliceIssues(lines.map((l, i) => ({ ...l, id: l.id ?? i })));
  for (const s of slices) issues.push(`${s.source}: ${s.issue}`);

  const assetNo = Object.fromEntries(assets.map((a) => [a.id, a.asset_no]));
  return {
    period, prepared: issues.length === 0, issues, findings,
    undecided: undecided.map((l) => ({ id: l.id, invoice_no: l.invoice_no, amount: r2(l.amount), line_date: String(l.line_date), question: l.fields?.question ?? null })),
    accounts: rows.map((r) => {
      const a = have.get(key(r.entity_id, r.account_id)) || {};
      const code = map.find((m) => m.entity_id === r.entity_id && lc(m.xero_account_id) === lc(r.account_id))?.account_code;
      return { company: nameOf[r.entity_id] ?? r.entity_id, entity_id: r.entity_id, account_id: r.account_id, account: r.account ?? (code ? `(${code})` : null),
        opening: r2(a.opening), additions: r2(a.additions), transfers: r2(a.transfers), amortisation: r2(a.amortisation), impairment: r2(a.impairment),
        by_xero: a.by_xero ?? null, register: r.register, ledger: r.ledger, difference: r.difference, named_items: r.named_items, unexplained: r.unexplained, ties: r.ties };
    }),
    assets: [...rolled.assets.entries()].map(([id, a]) => ({ asset_no: assetNo[id] ?? id, cost: a.cost, accumulated: a.accumulated, additions: a.additions, amortisation: a.amortisation, impairment: a.impairment })),
    trial_balances: Object.entries(footing).map(([id, f]) => ({ company: nameOf[id] ?? id, debits: f.debits, credits: f.credits, difference: f.difference, acknowledged: f.acknowledged, foots: f.foots })),
    xero_runs: Object.entries(xeroRuns).map(([id, x]) => ({ company: nameOf[id] ?? id, ...x })),
  };
}

// The months after the opening up to and including period, as YYYY-MM.
function monthsAfter(opening, period) {
  const out = [];
  for (let p = engine.addMonths(opening, 1); p <= period; p = engine.addMonths(p, 1)) out.push(p);
  return out;
}

module.exports = { prepareMonth, monthsAfter };

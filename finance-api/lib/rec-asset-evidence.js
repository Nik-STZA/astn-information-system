// Evidence for the asset reconciliations (CFO, 18 Nov 2026): the signed asset
// register is the reconciliation's evidence for every account it keeps, and
// Xero's own fixed asset register for the accounts Xero keeps. FM1 fetches it;
// the CFO reviews. Pure: recs-routes.js reads the rows and Xero.
//
// An account the os.stza.io register keeps (finance.asset_account_map, in
// force at the month end) takes the register's figure for that company and
// account from the month's snapshot, and only once the month is signed: a
// prepared month can still change. An account no register keeps is Xero's:
// its cost is the purchase price of the assets on it at the month end, exact
// for any month; its accumulated depreciation can be read only as Xero holds
// it now, so only when Xero's last depreciation run is that month end.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pence = (v) => Math.round(Number(v ?? 0) * 100);
const lc = (s) => String(s ?? "").toLowerCase();
const day = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(0, 10) : null);
const amount = (p) => (p / 100).toFixed(2);
const gbp = (p) => (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (period) => { const [y, m] = String(period).split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };

// The register's mapping for a company's account at a date, or null.
function mappingAt(map, entityId, code, date) {
  return (map || []).find((m) => m.entity_id === entityId && String(m.account_code ?? "").trim() === String(code ?? "").trim()
    && !m.ended_at && day(m.effective_from) <= date && (!m.effective_to || day(m.effective_to) >= date)) ?? null;
}

// Evidence from the os.stza.io registers, per company on the rec.
//   balances  [{ entity_id, entity_name, account_code }]
//   map       finance.asset_account_map rows for the client
//   periods   finance.asset_register_periods rows for the month (grouping, status, snapshot, signed_by, signed_at)
//   names     { grouping: register name }
// Returns { rows, said, xero: [balance] } where xero are the companies whose
// account no register keeps, for Xero's register to answer.
function registerEvidence({ balances = [], map = [], periods = [], names = {}, period, date }) {
  const rows = [], said = [], xero = [];
  for (const b of balances) {
    const who = b.entity_name ?? "A company";
    const m = mappingAt(map, b.entity_id, b.account_code, date);
    if (!m) { xero.push(b); continue; }
    const reg = names[m.grouping] ?? m.grouping;
    const p = periods.find((x) => x.grouping === m.grouping);
    if (!p || p.status !== "signed") {
      said.push(`${who}: ${reg} is ${p ? p.status : "not prepared"} for ${monthName(period)}, so it is not evidence yet. Sign the month on the Fixed assets page, then fetch again.`);
      continue;
    }
    const acc = (p.snapshot?.accounts || []).find((a) => a.entity_id === b.entity_id && lc(a.account_id) === lc(m.xero_account_id));
    if (!acc) {
      said.push(`${who}: ${reg}, signed for ${monthName(period)}, holds nothing on account ${b.account_code}. Check the register's account map.`);
      continue;
    }
    const named = (acc.named_items || []).filter((n) => Number(n.amount) !== 0);
    rows.push({
      entity_id: b.entity_id, amount: amount(pence(acc.register)),
      source: `${reg}, signed for ${monthName(period)}${p.signed_by ? ` by ${p.signed_by}` : ""}: account ${b.account_code}`,
      note: named.length ? `The register ties to the ledger after: ${named.map((n) => `${gbp(pence(n.amount))} ${n.label}`).join("; ")}.` : "The register ties to the ledger.",
    });
    said.push(`${who}: ${reg} holds ${gbp(pence(acc.register))} on ${b.account_code} at the end of ${monthName(period)}, signed.`);
  }
  return { rows, said, xero };
}

// Evidence from Xero's own fixed asset register for one company's account.
//   balance   { entity_id, entity_name, account_code }
//   accountId the account's Xero AccountID
//   types     Xero asset types; assets: Xero assets (any status)
//   lastRun   Xero's last depreciation date (Settings.lastDepreciationDate)
// Returns { row | null, said }
function xeroEvidence({ balance, accountId, types = [], assets = [], lastRun, date, period }) {
  const who = balance.entity_name ?? "A company";
  const costTypes = new Set(types.filter((t) => lc(t.fixedAssetAccountId) === lc(accountId)).map((t) => t.assetTypeId));
  const accTypes = new Set(types.filter((t) => lc(t.accumulatedDepreciationAccountId) === lc(accountId)).map((t) => t.assetTypeId));
  if (!costTypes.size && !accTypes.size) {
    return { row: null, said: `${who}: no register keeps account ${balance.account_code}, in os.stza.io or Xero. Record its outside evidence.` };
  }
  // On the account at the month end: bought by then, not yet disposed of.
  const held = (types) => assets.filter((a) => types.has(a.assetTypeId) && ["registered", "disposed"].includes(lc(a.assetStatus))
    && day(a.purchaseDate) && day(a.purchaseDate) <= date && (!day(a.disposalDate) || day(a.disposalDate) > date));
  if (costTypes.size) {
    const on = held(costTypes);
    const cost = on.reduce((s, a) => s + pence(a.purchasePrice), 0);
    return {
      row: { entity_id: balance.entity_id, amount: amount(cost), source: `Xero fixed asset register: cost of ${on.length} asset${on.length === 1 ? "" : "s"} on ${balance.account_code} at ${date}`,
        note: "Assets bought by the month end and not disposed of by then, at their purchase price." },
      said: `${who}: Xero's register holds ${gbp(cost)} of cost on ${balance.account_code} at ${date} (${on.length} asset${on.length === 1 ? "" : "s"}).`,
    };
  }
  if (day(lastRun) !== date) {
    return { row: null, said: `${who}: Xero's register can be read only as it stands now, depreciated to ${day(lastRun) ?? "no date"}, not as at ${date}. Record Xero's Fixed Asset Reconciliation report for ${monthName(period)} as outside evidence.` };
  }
  const on = held(accTypes);
  const acc = on.reduce((s, a) => s + pence(a.purchasePrice) - pence(a.accountingBookValue ?? a.purchasePrice), 0);
  return {
    row: { entity_id: balance.entity_id, amount: amount(-acc), source: `Xero fixed asset register: depreciation to ${date} on ${on.length} asset${on.length === 1 ? "" : "s"}, account ${balance.account_code}`,
      note: "Cost less book value per Xero, depreciation run to the month end." },
    said: `${who}: Xero's register holds ${gbp(acc)} of depreciation on ${balance.account_code}, run to ${date}.`,
  };
}

module.exports = { mappingAt, registerEvidence, xeroEvidence, r2 };

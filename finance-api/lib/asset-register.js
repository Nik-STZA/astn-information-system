// The asset register's monthly engine (docs/asset-register-spec.md section 5).
// Deterministic and pure, so it is tested without Xero or a database, as
// fixed-assets.js is: the routes read the rows and Xero's reports and pass them
// in. Scripts compute, agents interpret (decision 20).
//
// For each asset, account and month:
//   opening + additions +/- transfers - amortisation - impairment = closing
//
// Then: the trial balance foots; the register ties to the ledger per company
// and account; the expected charge is tested against the ledger, so a register
// and a ledger that have both stopped do not agree with each other; the
// unallocated and mismatched cost lines are listed. Differences are shown as
// found and never explained away; known residuals are carried as named items,
// shown beside the difference, never netted into it.
//
// Sign: every figure is a ledger balance, debit positive. Cost is positive;
// accumulated amortisation and impairment are negative.

const { trialBalanceByAccountId } = require("./journal");
const { monthsNotRun } = require("./fixed-assets");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const periodOf = (d) => String(d ?? "").slice(0, 7);
const LIVE = (l) => !["rejected", "withdrawn", "superseded"].includes(l.state);

function addMonths(period, n) {
  const [y, m] = period.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
const monthsBetween = (a, b) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
function monthEnd(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const money = (n) => r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Signed months ────────────────────────────────────────────────────────────

// The reason a write dated `date` is refused for a grouping, or null. The
// database refuses it too (049); this gives the reason in words first.
function lockIssue(periods, grouping, date) {
  const p = periodOf(date);
  const signed = (periods || []).find((x) => x.grouping === grouping && x.period === p && x.status === "signed");
  return signed ? `The ${grouping} register is signed for ${p}. Reopen it (CFO), or record the correction in an open month.` : null;
}

// ── Who amortises an account ─────────────────────────────────────────────────

const inForce = (row, date) => row.effective_from <= date && (!row.effective_to || row.effective_to >= date) && !row.ended_at;

// The rows of the account map in force for one company's account on a date.
// More than one grouping may use an account; they must agree on who
// amortises it.
function accountOwners(map, entityId, accountId, date) {
  const rows = (map || []).filter((r) => r.entity_id === entityId
    && String(r.xero_account_id).toLowerCase() === String(accountId).toLowerCase() && inForce(r, date));
  const by = [...new Set(rows.map((r) => r.amortised_by))];
  return {
    rows,
    groupings: [...new Set(rows.map((r) => r.grouping))],
    amortised_by: by.length === 1 ? by[0] : null,
    issue: by.length > 1 ? `Account ${rows[0].account_code ?? accountId} is mapped as amortised by both the register and Xero on ${date}.` : null,
  };
}

// Every disagreement in a map, for the dry check when a mapping is added.
function mapIssues(map) {
  const out = [];
  const seen = new Set();
  for (const r of (map || []).filter((x) => !x.ended_at)) {
    for (const d of [r.effective_from, r.effective_to].filter(Boolean)) {
      const o = accountOwners(map, r.entity_id, r.xero_account_id, d);
      if (o.issue && !seen.has(o.issue)) { seen.add(o.issue); out.push(o.issue); }
    }
  }
  return out;
}

// ── Cost lines ───────────────────────────────────────────────────────────────

// A workbook line names its invoice line with fields.source_key when the
// workbook split one invoice line over several rows; otherwise its row is its
// own source.
const sourceKey = (l) => (l.source_type === "workbook"
  ? `workbook|${l.fields?.source_key ?? JSON.stringify(l.source_ref ?? {})}`
  : `${l.source_type}|${l.xero_source_id}|${l.xero_line_id ?? ""}`);

// Every source line whose live slices do not sum to its net, to the penny.
function sliceIssues(lines) {
  const by = new Map();
  for (const l of (lines || []).filter(LIVE)) {
    const k = sourceKey(l);
    if (!by.has(k)) by.set(k, { net: r2(l.source_net), total: 0, lines: [], label: l.invoice_no || l.xero_source_id || "a workbook row" });
    const g = by.get(k);
    g.total = r2(g.total + Number(l.amount));
    g.lines.push(l.id);
    if (r2(l.source_net) !== g.net) g.netsDiffer = true;
  }
  const out = [];
  for (const g of by.values()) {
    if (g.netsDiffer) out.push({ source: g.label, issue: "its slices carry different source amounts", lines: g.lines });
    else if (g.total !== g.net) out.push({ source: g.label, issue: `slices sum to ${money(g.total)} against ${money(g.net)}`, difference: r2(g.net - g.total), lines: g.lines });
  }
  return out;
}

// Lines with no asset and no treatment dated before the month, unless they
// carry a question; and lines posted to another account than expected.
function lineFindings(lines, period) {
  const live = (lines || []).filter(LIVE);
  const unallocated = live
    .filter((l) => !l.asset_id && !l.treatment && periodOf(l.line_date) < period && !String(l.fields?.question ?? "").trim())
    .map((l) => ({ id: l.id, invoice_no: l.invoice_no, supplier: l.supplier, amount: r2(l.amount), line_date: l.line_date }));
  const mismatched = live
    .filter((l) => l.expected_account_id && l.posted_account_id && String(l.expected_account_id).toLowerCase() !== String(l.posted_account_id).toLowerCase())
    .map((l) => ({ id: l.id, invoice_no: l.invoice_no, amount: r2(l.amount), expected_account_id: l.expected_account_id, posted_account_id: l.posted_account_id, fix_route: l.fix_route ?? "edit_bill" }));
  return { unallocated, mismatched };
}

// ── Amortisation ─────────────────────────────────────────────────────────────

// The first month charged, from the signed date and the policy's convention.
function startPeriod(availableDate, convention) {
  if (!availableDate) return null;
  const p = periodOf(availableDate);
  return convention === "same_month" ? p : addMonths(p, 1);
}

// The charge for one month: straight line over the remaining life on cost less
// residual less what is already charged; the final month takes the pence so the
// total equals cost exactly. Nothing before the start, nothing without a
// signed date, nothing for an indefinite life. Returns a positive amount.
function expectedCharge({ cost, residual = 0, accumulated = 0, lifeMonths, start, period, lifeKind = "finite" }) {
  if (!start || lifeKind === "indefinite" || !lifeMonths || period < start) return 0;
  const used = monthsBetween(start, period);
  if (used >= lifeMonths) return 0;
  const left = r2(Number(cost) - Number(residual) - Math.abs(Number(accumulated)));
  if (left <= 0) return 0;
  const remaining = lifeMonths - used;
  return remaining === 1 ? left : r2(left / remaining);
}

// ── The roll-forward ─────────────────────────────────────────────────────────

const EMPTY = () => ({ opening: 0, additions: 0, transfers: 0, amortisation: 0, impairment: 0, other: 0, closing: 0, cost: 0, accumulated: 0 });

// What one event does to account balances: [{ account, amount, column, side }].
// side is cost (cost and WIP accounts) or accumulated (amortisation and
// impairment), so an asset's cost and accumulated amortisation stay apart.
function eventEffects(e, asset, byId) {
  const acc = e.accounts || {};
  const accum = acc.accumulated || asset?.accum_account_id;
  const amt = r2(e.amount);
  switch (e.kind) {
    case "opening": return accum && amt ? [{ account: accum, amount: -Math.abs(amt), column: "opening", side: "accumulated" }] : [];
    case "amortisation":
    case "catch_up": return [{ account: accum, amount: -Math.abs(amt), column: "amortisation", side: "accumulated" }];
    case "impairment": return [{ account: acc.impairment || accum, amount: -Math.abs(amt), column: "impairment", side: "accumulated" }];
    case "transfer": return amt ? [
      { account: acc.from, amount: -Math.abs(amt), column: "transfers", side: "cost" },
      { account: acc.to || asset?.cost_account_id, amount: Math.abs(amt), column: "transfers", side: "cost" },
    ] : [];
    case "reclass":
    case "disposal":
    case "transition": return (e.detail?.moves || []).map((m) => ({ account: m.account, amount: r2(m.amount), column: e.kind === "reclass" ? "transfers" : "other", side: m.side === "accumulated" ? "accumulated" : "cost" }));
    case "reversal": {
      const target = byId.get(e.reverses_event_id);
      return target ? eventEffects(target, asset, byId).map((x) => ({ ...x, amount: -x.amount })) : [];
    }
    default: return [];
  }
}

// Balances for the month, per asset and per company and account. Additions
// are approved, capitalised cost lines in the month of their date, held on the
// account Xero posted them to (the tie compares like with like; a line posted
// to the wrong account is a mismatch finding, fixed in Xero). Opening events
// carry accumulated amortisation brought forward.
function roll({ assets, lines, events, period }) {
  if (!PERIOD.test(period)) throw new Error("period must be YYYY-MM");
  const assetById = new Map((assets || []).map((a) => [a.id, a]));
  const eventById = new Map((events || []).map((e) => [e.id, e]));
  const perAsset = new Map();
  const perAccount = new Map();
  const put = (assetId, entityId, account, amount, column, inMonth, side) => {
    if (!account || !amount) return;
    if (!perAsset.has(assetId)) perAsset.set(assetId, EMPTY());
    const key = `${entityId}|${String(account).toLowerCase()}`;
    if (!perAccount.has(key)) perAccount.set(key, { entity_id: entityId, account_id: account, ...EMPTY() });
    for (const row of [perAsset.get(assetId), perAccount.get(key)]) {
      if (inMonth && column !== "opening") row[column] = r2(row[column] + amount);
      else row.opening = r2(row.opening + amount);
      row.closing = r2(row.closing + amount);
    }
    const own = perAsset.get(assetId);
    own[side] = r2(own[side] + amount);
  };
  for (const l of (lines || []).filter((x) => x.state === "approved" && x.treatment === "capitalise" && x.asset_id)) {
    const p = periodOf(l.line_date);
    if (p > period) continue;
    const a = assetById.get(l.asset_id);
    put(l.asset_id, l.owning_entity_id ?? a?.entity_id, l.posted_account_id ?? l.expected_account_id, r2(l.amount), "additions", p === period, "cost");
  }
  for (const e of events || []) {
    if (e.period > period) continue;
    for (const x of eventEffects(e, assetById.get(e.asset_id), eventById)) put(e.asset_id, e.entity_id, x.account, x.amount, x.column, e.period === period, x.side);
  }
  return { period, assets: perAsset, accounts: [...perAccount.values()] };
}

// ── Controls ─────────────────────────────────────────────────────────────────

// The trial balance foots, and (when Xero's own balance sheet figures are
// given, by account id) each account's balance equals Xero's report. The
// A mistyped trial balance tab once agreed with itself.
//
// Two checks, kept apart. First, the accounts read must add up to Xero's own
// Total row exactly: a partial or mistyped read fails here and is never
// acknowledged away. Second, Xero's own totals must balance. Xero rounds each
// foreign-currency balance for the report, so its trial balance can be a penny
// out with nothing to post (seen on one company at 31 Aug 2026). That is
// refused unless `acknowledged` names exactly that difference, debits less
// credits, with a reason; a different amount is refused again.
function tbFooting(report, reportBalances, acknowledged = null) {
  const tb = trialBalanceByAccountId(report);
  const rows = Object.entries(tb);
  const debits = r2(rows.reduce((s, [, b]) => s + b.ytdDebit, 0));
  const credits = r2(rows.reduce((s, [, b]) => s + b.ytdCredit, 0));
  const issues = [];
  if (!rows.length) issues.push("The trial balance has no accounts.");
  const totalRow = (report?.Rows ?? []).flatMap((s) => (s?.RowType === "SummaryRow" ? [s] : (s?.Rows ?? []).filter((r) => r?.RowType === "SummaryRow"))).pop();
  const cell = (i) => Number(String(totalRow?.Cells?.[i]?.Value ?? "").replace(/,/g, ""));
  const xero = totalRow && Number.isFinite(cell(3)) && Number.isFinite(cell(4)) ? { debits: r2(cell(3)), credits: r2(cell(4)) } : null;
  if (xero && (xero.debits !== debits || xero.credits !== credits)) {
    issues.push(`The accounts read (debits ${money(debits)}, credits ${money(credits)}) do not add up to Xero's own total (debits ${money(xero.debits)}, credits ${money(xero.credits)}).`);
  }
  const difference = r2((xero ?? { debits, credits }).debits - (xero ?? { debits, credits }).credits);
  let acknowledgedNow = null;
  if (difference !== 0) {
    if (acknowledged && r2(acknowledged.difference) === difference && String(acknowledged.reason ?? "").trim().length >= 3) {
      acknowledgedNow = { difference, reason: acknowledged.reason };
    } else {
      issues.push(`The trial balance does not foot: debits ${money(debits)}, credits ${money(credits)} (difference ${money(difference)})`
        + (acknowledged ? `; the acknowledgement names ${money(acknowledged.difference)}.` : "."));
    }
  }
  for (const [id, want] of Object.entries(reportBalances || {})) {
    const b = tb[id];
    const got = b ? r2(b.ytdDebit - b.ytdCredit) : 0;
    if (got !== r2(want)) issues.push(`${b?.name ?? id}: trial balance ${money(got)} against Xero's report ${money(want)}.`);
  }
  return { foots: issues.length === 0, debits, credits, xero_totals: xero, difference, acknowledged: acknowledgedNow, issues };
}

// The register against the ledger per company and account. Named items are
// shown beside the difference and never netted into it.
function tie({ rolled, trialBalances, tolerance = 0, namedItems = [] }) {
  const tbByEntity = new Map(Object.entries(trialBalances || {}).map(([k, rep]) => [k, trialBalanceByAccountId(rep)]));
  return rolled.accounts.map((a) => {
    const tb = tbByEntity.get(a.entity_id)?.[a.account_id] ?? null;
    const ledger = tb ? r2(tb.ytdDebit - tb.ytdCredit) : 0;
    const difference = r2(ledger - a.closing);
    const named = namedItems.filter((n) => n.entity_id === a.entity_id && String(n.account_id).toLowerCase() === String(a.account_id).toLowerCase());
    const namedTotal = r2(named.reduce((s, n) => s + Number(n.amount), 0));
    return {
      entity_id: a.entity_id, account_id: a.account_id, account: tb?.name ?? null,
      register: a.closing, ledger, difference,
      named_items: named.map((n) => ({ label: n.label, amount: r2(n.amount) })),
      unexplained: r2(difference - namedTotal),
      ties: Math.abs(r2(difference - namedTotal)) <= Number(tolerance) + 0.004,
      read: Boolean(tb),
    };
  });
}

// The expected-charge control for accounts the register amortises: last
// month's accumulated amortisation plus this month's expected charge, against
// the ledger now. A frozen ledger fails even when the register froze too.
// assets carry { id, entity_id, accum_account_id, available_for_use_date },
// policies by id; before is roll(previous month).assets: each asset's cost and
// accumulated (negative) as at the previous month end.
function expectedChargeControl({ assets, policies, period, before, trialBalances, map }) {
  const day = monthEnd(period);
  const want = new Map();
  for (const a of assets || []) {
    if (!a.accum_account_id) continue;
    const owner = accountOwners(map, a.entity_id, a.accum_account_id, day);
    if (owner.amortised_by !== "register") continue;
    const p = (policies || {})[a.policy_id] || {};
    const b = before.get(a.id) || { cost: 0, accumulated: 0 };
    const charge = expectedCharge({
      cost: b.cost, residual: p.residual_value, accumulated: b.accumulated, lifeMonths: p.life_months, lifeKind: p.life_kind,
      start: startPeriod(a.available_for_use_date, p.start_convention), period,
    });
    const key = `${a.entity_id}|${String(a.accum_account_id).toLowerCase()}`;
    const w = want.get(key) || { entity_id: a.entity_id, account_id: a.accum_account_id, before: 0, charge: 0 };
    w.before = r2(w.before - Math.abs(b.accumulated));
    w.charge = r2(w.charge + charge);
    want.set(key, w);
  }
  const tbByEntity = new Map(Object.entries(trialBalances || {}).map(([k, rep]) => [k, trialBalanceByAccountId(rep)]));
  return [...want.values()].map((w) => {
    const tb = tbByEntity.get(w.entity_id)?.[w.account_id];
    const ledger = tb ? r2(tb.ytdDebit - tb.ytdCredit) : 0;
    const expected = r2(w.before - w.charge);
    return { ...w, expected, ledger, difference: r2(ledger - expected), passes: r2(ledger - expected) === 0 };
  });
}

// For accounts Xero's register amortises: has Xero's depreciation run for the
// month? From settings.lastDepreciationDate, as the Fixed assets page reads it.
function xeroRunControl(lastDepreciationDate, period) {
  const notRun = monthsNotRun(lastDepreciationDate, `${addMonths(period, 1)}-01`);
  if (notRun === null) return { passes: false, issue: "Xero has no last depreciation date for this company." };
  return notRun.length
    ? { passes: false, months_not_run: notRun, issue: `Xero's depreciation has not been run for ${notRun.join(", ")}.` }
    : { passes: true, months_not_run: [] };
}

module.exports = {
  r2, periodOf, addMonths, monthEnd,
  lockIssue, accountOwners, mapIssues, sliceIssues, lineFindings,
  startPeriod, expectedCharge, eventEffects, roll, tbFooting, tie, expectedChargeControl, xeroRunControl,
};

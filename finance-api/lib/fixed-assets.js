// The Fixed assets page (Nik, 6 Nov 2026): each company's register as Xero
// holds it, read only. Pure, so it is tested without Xero; server.js reads the
// register and passes it in.
//
// What the Assets API gives (5 Nov 2026): asset types with their three
// accounts, each asset's cost, book value and depreciation settings, and
// settings.lastDepreciationDate. It has no depreciation run, disposal or
// period schedule, so "has this month's depreciation run" comes from that one
// date, and the ties to the ledger (cost and accumulated depreciation against
// the trial balance) come later with the fixed asset reconciliation.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(0, 10) : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Today's date in London, YYYY-MM-DD.
// "31 Aug 2026", the house date style.
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const londonToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

// The month ends after the last depreciation run, up to the end of last month,
// as "Sep 2026". Depreciation for a month is run once the month has ended, so
// the month we are in is never late. An empty list means it is up to date.
function monthsNotRun(lastDepreciationDate, today) {
  const last = day(lastDepreciationDate);
  if (!last) return null;
  const [ly, lm] = last.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const out = [];
  // Month after the last run (lm is 1-based, so lm is the next month's 0-based index).
  let y = ly;
  let m = lm;
  if (m === 12) { y += 1; m = 0; }
  while (y < ty || (y === ty && m < tm - 1)) {
    out.push(`${MONTHS[m]} ${y}`);
    m += 1;
    if (m === 12) { y += 1; m = 0; }
  }
  return out;
}

// One asset as the page shows it. Accumulated depreciation is cost less book
// value: Xero's own book value is the number its register reports.
function assetRow(a, typeName) {
  const cost = r2(a.purchasePrice);
  const hasBook = a.accountingBookValue !== undefined && a.accountingBookValue !== null;
  const book = hasBook ? r2(a.accountingBookValue) : null;
  const s = a.bookDepreciationSetting || {};
  return {
    id: a.assetId,
    number: a.assetNumber ?? null,
    name: String(a.assetName ?? "").replace(/\s+/g, " ").trim(),
    type: typeName,
    purchase_date: day(a.purchaseDate),
    cost,
    accumulated: book === null ? null : r2(cost - book),
    book_value: book,
    method: s.depreciationMethod ?? null,
    life_years: s.effectiveLifeYears ?? null,
    rate: s.depreciationRate ?? null,
    disposal_date: day(a.disposalDate),
  };
}

const accountLabel = (accounts, id) => {
  const a = accounts.get(id);
  return a ? [a.Code, a.Name].filter(Boolean).join(" ") : null;
};

// One company's register, shaped for the page.
//   register: { types, assets, settings, accounts } as Xero returned them
//   proposals: open finance.xero_changes rows for create_fixed_asset
function companyRegister(register, { today = londonToday(), proposals = [] } = {}) {
  const types = Array.isArray(register.types) ? register.types : [];
  const accounts = new Map((register.accounts || []).map((a) => [a.AccountID, a]));
  const typeName = new Map(types.map((t) => [t.assetTypeId, t.assetTypeName]));
  const rows = (register.assets || []).map((a) => ({ status: String(a.assetStatus ?? "").toLowerCase(), row: assetRow(a, typeName.get(a.assetTypeId) ?? null) }));
  const of = (status) => rows.filter((r) => r.status === status).map((r) => r.row)
    .sort((x, y) => String(y.purchase_date ?? "").localeCompare(String(x.purchase_date ?? "")) || String(x.number ?? "").localeCompare(String(y.number ?? "")));
  const registered = of("registered");
  const drafts = of("draft");
  const disposed = of("disposed");

  // Totals by asset type, registered assets only (drafts are not in the
  // ledger's register yet; disposed ones have left it).
  const byType = types.map((t) => {
    const mine = registered.filter((a) => a.type === t.assetTypeName);
    return {
      type: t.assetTypeName,
      cost_account: accountLabel(accounts, t.fixedAssetAccountId),
      accumulated_account: accountLabel(accounts, t.accumulatedDepreciationAccountId),
      expense_account: accountLabel(accounts, t.depreciationExpenseAccountId),
      count: mine.length,
      cost: r2(mine.reduce((s, a) => s + a.cost, 0)),
      accumulated: r2(mine.reduce((s, a) => s + (a.accumulated ?? 0), 0)),
      book_value: r2(mine.reduce((s, a) => s + (a.book_value ?? 0), 0)),
    };
  }).filter((t) => t.count > 0);
  const untyped = registered.filter((a) => !a.type);
  if (untyped.length) {
    byType.push({
      type: null, cost_account: null, accumulated_account: null, expense_account: null, count: untyped.length,
      cost: r2(untyped.reduce((s, a) => s + a.cost, 0)),
      accumulated: r2(untyped.reduce((s, a) => s + (a.accumulated ?? 0), 0)),
      book_value: r2(untyped.reduce((s, a) => s + (a.book_value ?? 0), 0)),
    });
  }
  const sum = (k) => r2(byType.reduce((s, t) => s + t[k], 0));

  const last = day(register.settings?.lastDepreciationDate);
  const notRun = monthsNotRun(last, today);
  let depreciation;
  if (!registered.length) depreciation = { state: "nothing_registered", text: "No registered assets, so there is nothing to depreciate." };
  else if (!last) depreciation = { state: "never_run", text: "Depreciation has never been run in Xero for this company." };
  else if (notRun.length) depreciation = { state: "behind", text: `Last run to ${dayLabel(last)}. Not yet run for ${notRun.join(", ")}.` };
  else depreciation = { state: "up_to_date", text: `Run to ${dayLabel(last)}. Up to date.` };

  return {
    last_depreciation_date: last,
    months_not_run: notRun ?? [],
    depreciation,
    totals: { count: registered.length, cost: sum("cost"), accumulated: sum("accumulated"), book_value: sum("book_value") },
    by_type: byType,
    registered,
    drafts,
    disposed_count: disposed.length,
    proposals: proposals.map((p) => ({ id: p.id, summary: p.summary, state: p.state, proposed_by: p.proposed_by, created_at: p.created_at })),
  };
}

module.exports = { monthsNotRun, assetRow, companyRegister, londonToday };

// Month-end close template (Work, 28 Oct 2026): one click makes a client's
// close for a month as tasks, with owners, due dates and what waits on what.
//
// The steps follow the review chain the agents already work in: the clerks
// and FM1 prepare, the FC reviews and drafts the commentary, the CFO signs
// off. Due dates are working days after the month end (weekends skipped; bank
// holidays are not known here, so move a date by hand when one falls in it).
//
// Pure: the route turns the plan into rows.

// key       stable name, part of each task's source_ref
// wd        due on this working day after the month end
// after     keys this step waits for
// perEntity a sub-task for each company when the client has more than one
// multi     only when the client has more than one company
// vat       only when the close includes a VAT return
const STEPS = [
  { key: "bank", title: "Bank reconciliations", wd: 2, owner: ["agent", "fm1"], perEntity: true,
    notes: "Every bank and card account reconciled to the statement at the month end. Unreconciled items listed with dates and amounts." },
  { key: "ap", title: "Supplier bills in for the month", wd: 2, owner: ["agent", "ap-clerk"],
    notes: "Bills queue cleared for the month: every supplier document coded and sent to Xero for approval. Missing bills chased." },
  { key: "ar", title: "Sales invoices raised and billing reconciled", wd: 2, owner: ["agent", "ar-clerk"],
    notes: "Every sale for the month invoiced; billing system reconciled to the ledger; deposits held as liabilities." },
  { key: "revenue", title: "Revenue and deferred revenue", wd: 3, owner: ["agent", "fm1"], after: ["ar"],
    notes: "Revenue recognised for what was delivered in the month; deferred revenue released per the schedule and new billing in advance deferred; the schedule agrees to the ledger." },
  { key: "payroll", title: "Payroll journal", wd: 3, owner: ["agent", "fm1"],
    notes: "Payroll for the month journalled from the payroll report: gross pay, employer NI and pension, PAYE and net pay controls." },
  { key: "accruals", title: "Accruals and prepayments", wd: 3, owner: ["agent", "fm1"], after: ["ap"],
    notes: "Costs incurred but not billed accrued; prepayments released per the schedule; schedules agree to the ledger." },
  { key: "fixed-assets", title: "Fixed assets and depreciation", wd: 3, owner: ["agent", "fm1"],
    notes: "Additions and disposals in the register; depreciation run for the month; register agrees to the ledger." },
  { key: "intercompany", title: "Intercompany recharges and balances", wd: 4, owner: ["agent", "fm1"], multi: true,
    after: ["payroll", "accruals"], notes: "Recharges for the month posted; intercompany balances agree between each pair of companies." },
  { key: "vat", title: "VAT return", wd: 5, owner: ["agent", "fm1"], vat: true, after: ["ap", "ar"],
    notes: "VAT return prepared from the ledger, boxes agreed to the VAT control account, reverse charge checked. Reviewed by FM2 and the FC before filing." },
  { key: "bs-recs", title: "Balance sheet reconciliations", wd: 4, owner: ["agent", "fm1"], perEntity: true,
    after: ["bank", "ap", "ar", "revenue", "payroll", "accruals", "fixed-assets", "intercompany"],
    notes: "Every balance sheet account reconciled with support; differences explained, not plugged." },
  { key: "fc-review", title: "FC review of the close", wd: 5, owner: ["agent", "fc"], after: ["bs-recs"],
    notes: "Balance Control, reconciliation ties, mapping gaps and cash flow variance checked. Anything that does not tie goes back with findings." },
  { key: "pack", title: "Management pack and variance commentary", wd: 6, owner: ["agent", "fc"], after: ["fc-review"],
    notes: "Pack built for the month; variance commentary drafted from the drivers, not just the gaps." },
  { key: "sign-off", title: "CFO sign-off", wd: 7, owner: ["person"], after: ["pack", "vat"],
    notes: "Pack and close reviewed and signed off." },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ymd = (d) => d.toISOString().slice(0, 10);

// The month's last day for "2026-09", or null.
function monthEnd(period) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
}

// The nth working day (Monday to Friday) after a date.
function workingDay(after, n) {
  const d = new Date(after.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d;
}

// The close as tasks and blockers, or the issues that stop it.
//   period    "2026-09"
//   entities  [{ id, name }] the client's companies
//   vat       include a VAT return
//   cfo       the signing person's email, who owns sign-off
// tasks: [{ key, parent_key, title, notes, owner_kind, owner, start_on, due_on, entity_id, position, source_ref }]
// blockers: [{ task_key, blocking_key }]
function closePlan({ period, entities = [], vat = false, cfo } = {}) {
  const end = monthEnd(period);
  if (!end) return { issues: ["period must be a month (YYYY-MM)"] };
  if (!cfo) return { issues: ["the person signing off is needed"] };
  const multi = entities.length > 1;
  const label = `${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  const ref = (k) => `month-end:${period}${k ? `:${k}` : ""}`;
  const start = ymd(workingDay(end, 1));
  const steps = STEPS.filter((s) => (!s.multi || multi) && (!s.vat || vat));
  const keys = new Set(steps.map((s) => s.key));

  const tasks = [{
    key: "close", parent_key: null, title: `Month-end close: ${label}`, position: 0, entity_id: null,
    notes: `The close for ${label}, from the month-end template. Each step waits for the ones it needs.`,
    owner_kind: "person", owner: cfo, start_on: start, due_on: ymd(workingDay(end, Math.max(...steps.map((s) => s.wd)))),
    source_ref: ref(),
  }];
  const blockers = [];
  steps.forEach((s, i) => {
    const [kind, who] = s.owner;
    tasks.push({
      key: s.key, parent_key: "close", title: s.title, notes: s.notes, position: i + 1, entity_id: null,
      owner_kind: kind, owner: kind === "person" ? cfo : who, start_on: start, due_on: ymd(workingDay(end, s.wd)),
      source_ref: ref(s.key),
    });
    if (s.perEntity && multi) {
      entities.forEach((e, j) => tasks.push({
        key: `${s.key}:${e.id}`, parent_key: s.key, title: `${s.title}: ${e.name}`, notes: null, position: j, entity_id: e.id,
        owner_kind: kind, owner: kind === "person" ? cfo : who, start_on: start, due_on: ymd(workingDay(end, s.wd)),
        source_ref: ref(`${s.key}:${e.id}`),
      }));
    }
    for (const a of s.after || []) if (keys.has(a)) blockers.push({ task_key: s.key, blocking_key: a });
  });
  return { issues: [], label, tasks, blockers };
}

module.exports = { STEPS, closePlan, monthEnd, workingDay };

// The payroll-to-ledger checks for an entity that runs payroll in Xero.
//
// Every rule was derived from STZA's own pay runs and trial balances (Feb to
// Sep 2026, eight monthly runs) rather than from what sounded sensible:
//
//   - wage expense plus employer NIC moved by exactly each month's pay run
//     totalCost, every month, including the three with employer NIC;
//   - wages payable was nil at every month end after the pay date;
//   - a payroll liability should be a credit holding at most the current
//     month's accrual, because HMRC is paid by the 22nd of the next month.
//
// The last rule is the one STZA fails: on 18 Jun 2026 a 1,142.85 HMRC payment
// was coded wholly to NIC Payable against an 11.25 liability that had already
// been paid, and the account has sat in debit since, absorbing the August and
// September employer NIC. A balance check alone would not say why, so the flag
// carries the balances it saw.
//
// Pay runs and the ledger are matched on the pay run's PAYMENT date, because
// that is the date Xero posts the pay run journal on.
//
// This computes. It does not judge, and it never writes. Per-person payroll data
// never reaches it: the route strips payslips and employees before calling.

const pence = (v) => Math.round(Number(v || 0) * 100);
const money = (p) => (p / 100).toFixed(2);
const day = (s) => String(s || "").slice(0, 10);

// The four accounts the checks need, from Xero's payroll settings. PAYE and NIC
// can share one account; it is then checked once.
function payrollAccounts(settingsAccounts = []) {
  const code = (type) => settingsAccounts.find((a) => a.type === type)?.code || null;
  const liabilities = [...new Set([code("PAYELIABILITY"), code("NICLIABILITY")].filter(Boolean))];
  return { wages: code("WAGESEXPENSE"), employerNic: code("EMPLOYERSNIC"), wagesPayable: code("WAGESPAYABLE"), liabilities };
}

// A TrialBalance report to { code: { movement, balance } } in pence, debit
// positive. Columns are found by title, so a reordered report cannot silently
// swap movement and balance.
function parseTrialBalance(report) {
  const rows = report?.Reports?.[0]?.Rows || [];
  const titles = (rows.find((r) => r.RowType === "Header")?.Cells || []).map((c) => String(c.Value || "").trim());
  const col = (t, fallback) => (titles.indexOf(t) >= 0 ? titles.indexOf(t) : fallback);
  const [dr, cr, ydr, ycr] = [col("Debit", 1), col("Credit", 2), col("YTD Debit", 3), col("YTD Credit", 4)];
  const out = {};
  for (const r of rows.flatMap((s) => s.Rows || [])) {
    if (r.RowType !== "Row") continue;
    const code = (/\(([^()]+)\)\s*$/.exec(String(r.Cells?.[0]?.Value || "")) || [])[1];
    if (!code) continue;
    const v = (i) => pence(r.Cells?.[i]?.Value);
    out[code] = { movement: v(dr) - v(cr), balance: v(ydr) - v(ycr) };
  }
  return out;
}

// Calendar months from..to inclusive, as { month: "YYYY-MM", end: "YYYY-MM-DD" }.
function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, end });
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

// payRuns: Xero payroll PayRuns. accounts: payrollAccounts(). ledger: one entry
// per month, { month, end, tb: parseTrialBalance(...) }. today: YYYY-MM-DD.
function checkPayroll({ payRuns = [], accounts, ledger = [], today }) {
  const months = ledger.map(({ month, end, tb }) => {
    const flags = [];
    const flag = (check, fired, detail, extra = {}) => flags.push({ check, flagged: Boolean(fired), detail, ...extra });
    const at = (code) => tb[code] || { movement: 0, balance: 0 };
    const inMonth = payRuns.filter((r) => day(r.paymentDate).slice(0, 7) === month);
    const posted = inMonth.filter((r) => r.payRunStatus === "Posted");
    const scheduled = posted.filter((r) => r.payRunType === "Scheduled");

    flag("pay_run_missing", !posted.length && end < today,
      posted.length ? `${posted.length} posted pay run(s) paid this month` : "no posted pay run paid this month");
    flag("duplicate_scheduled_run", scheduled.length > 1,
      `${scheduled.length} scheduled run(s) paid this month`);
    const lateDrafts = inMonth.filter((r) => r.payRunStatus !== "Posted" && day(r.paymentDate) <= today);
    flag("draft_past_payment_date", lateDrafts.length,
      lateDrafts.length ? `not posted: ${lateDrafts.map((r) => `${r.payRunStatus} run paid ${day(r.paymentDate)}`).join(", ")}` : "none");

    const cost = posted.reduce((s, r) => s + pence(r.totalCost), 0);
    const booked = at(accounts.wages).movement + (accounts.employerNic ? at(accounts.employerNic).movement : 0);
    flag("cost_not_in_ledger", cost !== booked,
      `pay runs ${money(cost)}; ledger ${accounts.wages}${accounts.employerNic ? ` + ${accounts.employerNic}` : ""} moved ${money(booked)}`,
      { pay_run_cost: money(cost), ledger_movement: money(booked) });

    if (accounts.wagesPayable) {
      const owed = at(accounts.wagesPayable).balance;
      const allPaid = inMonth.every((r) => day(r.paymentDate) <= end);
      flag("wages_payable_not_cleared", allPaid && owed !== 0,
        `${accounts.wagesPayable} balance ${money(owed)} at ${end}`, { balance: money(owed) });
    }

    for (const code of accounts.liabilities) {
      const { movement, balance } = at(code);
      flag("liability_in_debit", balance > 0, balance > 0
        ? `${code} is ${money(balance)} in debit at ${end}: more was paid or posted to it than was owed`
        : `${code} is a credit of ${money(-balance)} at ${end}`,
        { account: code, balance: money(-balance) });
      const accrued = Math.max(-movement, 0);
      flag("liability_overdue", -balance > accrued,
        `${code} holds ${money(-balance)} but only ${money(accrued)} accrued this month; the rest was due to HMRC by the 22nd`,
        { account: code, balance: money(-balance), accrued_this_month: money(accrued) });
    }

    return { month, end, flags, flagged: flags.filter((f) => f.flagged).map((f) => f.check) };
  });
  return {
    accounts,
    months,
    flagged: months.flatMap((m) => m.flagged.map((c) => `${m.month}:${c}`)),
  };
}

module.exports = { payrollAccounts, parseTrialBalance, monthsBetween, checkPayroll };

import { describe, expect, it } from "vitest";
import { payrollAccounts, parseTrialBalance, monthsBetween, checkPayroll } from "./payroll-checks";

// STZA's payroll settings and pay runs, 2026 (totals only, as the route sees them).
const SETTINGS = [
  { type: "WAGESEXPENSE", code: "477" }, { type: "BANK", code: "601" },
  { type: "WAGESPAYABLE", code: "814" }, { type: "PAYELIABILITY", code: "825" },
  { type: "NICLIABILITY", code: "826" }, { type: "EMPLOYERSNIC", code: "479" },
];
const ACC = payrollAccounts(SETTINGS);
const run = (paid, cost, over = {}) => ({
  paymentDate: `${paid}T00:00:00`, totalCost: cost, totalPay: 1047.5,
  payRunStatus: "Posted", payRunType: "Scheduled", ...over,
});
// { code: [movement, balance] } in pounds, debit positive.
const tb = (o) => Object.fromEntries(Object.entries(o).map(([c, [m, b]]) => [c, { movement: Math.round(m * 100), balance: Math.round(b * 100) }]));
const month = (m, end, o) => ({ month: m, end, tb: tb(o) });
const flagged = (r, m) => r.months.find((x) => x.month === m).flagged;

describe("helpers", () => {
  it("reads the payroll accounts and checks a shared PAYE/NIC account once", () => {
    expect(ACC).toEqual({ wages: "477", employerNic: "479", wagesPayable: "814", liabilities: ["825", "826"] });
    expect(payrollAccounts([{ type: "PAYELIABILITY", code: "825" }, { type: "NICLIABILITY", code: "825" }]).liabilities).toEqual(["825"]);
  });

  it("parses a trial balance by column title", () => {
    const report = { Reports: [{ Rows: [
      { RowType: "Header", Cells: [{ Value: "Account" }, { Value: "Debit" }, { Value: "Credit" }, { Value: "YTD Debit" }, { Value: "YTD Credit" }] },
      { RowType: "Section", Rows: [
        { RowType: "Row", Cells: [{ Value: "Salaries (477)" }, { Value: "1047.50" }, { Value: "" }, { Value: "6285.00" }, { Value: "" }] },
        { RowType: "Row", Cells: [{ Value: "NIC Payable (826)" }, { Value: "" }, { Value: "157.13" }, { Value: "950.10" }, { Value: "" }] },
        { RowType: "SummaryRow", Cells: [{ Value: "Total" }] },
      ] },
    ] }] };
    expect(parseTrialBalance(report)).toEqual({
      477: { movement: 104750, balance: 628500 },
      826: { movement: -15713, balance: 95010 },
    });
  });

  it("lists calendar months across a year end", () => {
    expect(monthsBetween("2025-11", "2026-02").map((m) => m.end)).toEqual(["2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28"]);
  });
});

describe("check_payroll on STZA's 2026 ledger", () => {
  const payRuns = [run("2026-03-25", 1058.75), run("2026-05-26", 1047.5), run("2026-06-25", 1047.5), run("2026-09-25", 1204.63)];
  const r = checkPayroll({
    payRuns, accounts: ACC, today: "2026-10-19",
    ledger: [
      month("2026-03", "2026-03-31", { 477: [1047.5, 2095], 479: [11.25, 11.25], 826: [-11.25, -11.25] }),
      month("2026-05", "2026-05-31", { 477: [1047.5, 2095], 826: [11.25, 0] }),
      // 18 Jun: 1,142.85 paid to HMRC and coded wholly to 826.
      month("2026-06", "2026-06-30", { 477: [1047.5, 3142.5], 826: [1142.85, 1142.85] }),
      month("2026-09", "2026-09-30", { 477: [1047.5, 6285], 479: [157.13, 192.75], 826: [-157.13, 950.1] }),
    ],
  });

  it("passes the months where the pay run, the ledger and the liabilities agree", () => {
    expect(flagged(r, "2026-03")).toEqual([]);
    expect(flagged(r, "2026-05")).toEqual([]);
  });

  it("flags NIC Payable in debit from June, and says by how much", () => {
    expect(flagged(r, "2026-06")).toEqual(["liability_in_debit"]);
    expect(flagged(r, "2026-09")).toEqual(["liability_in_debit"]);
    const f = r.months.find((m) => m.month === "2026-09").flags.find((x) => x.check === "liability_in_debit" && x.account === "826");
    expect(f.detail).toMatch(/950\.10 in debit/);
  });
});

describe("check_payroll rules", () => {
  const base = (over) => checkPayroll({ accounts: ACC, today: "2026-10-19", ...over });

  it("flags a pay run whose cost the ledger does not carry", () => {
    const r = base({ payRuns: [run("2026-08-25", 1083.12)], ledger: [month("2026-08", "2026-08-31", { 477: [1047.5, 0] })] });
    expect(flagged(r, "2026-08")).toEqual(["cost_not_in_ledger"]);
    expect(r.months[0].flags.find((f) => f.check === "cost_not_in_ledger")).toMatchObject({ pay_run_cost: "1083.12", ledger_movement: "1047.50" });
  });

  it("flags a missing run only once the month has ended", () => {
    expect(flagged(base({ ledger: [month("2026-09", "2026-09-30", {})] }), "2026-09")).toEqual(["pay_run_missing"]);
    expect(flagged(base({ ledger: [month("2026-10", "2026-10-31", {})] }), "2026-10")).toEqual([]);
  });

  it("flags a draft run past its payment date, and a second scheduled run", () => {
    const r = base({
      payRuns: [run("2026-07-25", 1047.5), run("2026-07-25", 1047.5), run("2026-07-28", 1047.5, { payRunStatus: "Draft" })],
      ledger: [month("2026-07", "2026-07-31", { 477: [2095, 0] })],
    });
    expect(flagged(r, "2026-07")).toEqual(["duplicate_scheduled_run", "draft_past_payment_date"]);
  });

  it("flags wages payable left after the pay date", () => {
    const r = base({ payRuns: [run("2026-07-25", 1047.5)], ledger: [month("2026-07", "2026-07-31", { 477: [1047.5, 0], 814: [-1047.5, -1047.5] })] });
    expect(flagged(r, "2026-07")).toEqual(["wages_payable_not_cleared"]);
  });

  it("flags a liability holding more than this month's accrual", () => {
    // April: March's 11.25 still unpaid after 22 April.
    const r = base({ payRuns: [run("2026-04-25", 1047.5)], ledger: [month("2026-04", "2026-04-30", { 477: [1047.5, 0], 826: [0, -11.25] })] });
    expect(flagged(r, "2026-04")).toEqual(["liability_overdue"]);
  });
});

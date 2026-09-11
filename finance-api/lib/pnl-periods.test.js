import { describe, expect, it } from "vitest";
import { mergeReports, planPnl } from "./pnl-periods.js";

const ends = (plan) => plan.ranges.map((r) => r.toDate);

describe("planPnl", () => {
  it("splits Jan-Aug into eight whole calendar months", () => {
    const p = planPnl({ fromDate: "2026-01-01", toDate: "2026-08-31", timeframe: "MONTH", periods: 8 }, "2026-09-11");
    expect(p.ranges.map((r) => r.label)).toEqual([
      "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026",
    ]);
    expect(p.ranges[0]).toMatchObject({ fromDate: "2026-01-01", toDate: "2026-01-31" });
    expect(p.partialLast).toBe(false);
    expect(p.truncated).toBe(false);
  });

  // 11 Sep 2026, failure 3: a base ending 30 Sep cost every 31-day month its
  // last day. Each range must end on its own month end.
  it("ends every month on its own last day, whatever month the range ends in", () => {
    const p = planPnl({ fromDate: "2025-10-01", toDate: "2026-09-11", timeframe: "MONTH" }, "2026-09-11");
    expect(ends(p)).toEqual([
      "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31",
      "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30",
    ]);
  });

  // Failure 2: a range ending today is whole months, with the last flagged as to date.
  it("flags the current month as in progress", () => {
    const p = planPnl({ fromDate: "2026-08-01", toDate: "2026-09-11", timeframe: "MONTH" }, "2026-09-11");
    expect(p.ranges.map((r) => r.label)).toEqual(["Aug 2026", "Sep 2026"]);
    expect(p.partialLast).toBe(true);
  });

  it("keeps the 12 most recent columns and says it dropped the rest", () => {
    const p = planPnl({ fromDate: "2025-04-01", toDate: "2026-09-30", timeframe: "MONTH" }, "2026-09-11");
    expect(p.ranges).toHaveLength(12);
    expect(p.ranges[0].fromDate).toBe("2025-10-01");
    expect(p.truncated).toBe(true);
  });

  it("honours periods as comparatives before a single month", () => {
    const p = planPnl({ fromDate: "2026-08-01", toDate: "2026-08-31", timeframe: "MONTH", periods: 3 }, "2026-09-11");
    expect(p.ranges.map((r) => r.label)).toEqual(["May 2026", "Jun 2026", "Jul 2026", "Aug 2026"]);
  });

  it("uses whole quarters ending with the requested month", () => {
    const p = planPnl({ fromDate: "2026-01-01", toDate: "2026-08-31", timeframe: "QUARTER" }, "2026-09-11");
    expect(p.ranges).toEqual([
      { fromDate: "2025-12-01", toDate: "2026-02-28", label: "Dec 2025 - Feb 2026" },
      { fromDate: "2026-03-01", toDate: "2026-05-31", label: "Mar 2026 - May 2026" },
      { fromDate: "2026-06-01", toDate: "2026-08-31", label: "Jun 2026 - Aug 2026" },
    ]);
  });

  it("returns nothing to split without a timeframe", () => {
    expect(planPnl({ fromDate: "2026-01-01", toDate: "2026-08-31" })).toBeNull();
  });
});

// Minimal single-period Xero P&L reports.
const report = (rows) => ({
  Rows: [
    { RowType: "Header", Cells: [{ Value: "" }, { Value: "31 Aug 26" }] },
    ...rows.map(([title, lines]) => ({
      RowType: "Section",
      Title: title,
      Rows: lines.map(([name, value, summary]) => ({
        RowType: summary ? "SummaryRow" : "Row",
        Cells: [{ Value: name }, { Value: value }],
      })),
    })),
  ],
});

describe("mergeReports", () => {
  const ranges = [{ label: "Jul 2026" }, { label: "Aug 2026" }];

  it("lines months up by account and totals them in code", () => {
    const out = mergeReports(ranges, [
      report([["Income", [["Revenue", "7650.00"], ["Total Income", "7650.00", true]]]]),
      report([["Income", [["Revenue", "9725.00"], ["Total Income", "9725.00", true]]]]),
    ]);
    expect(out.columns).toEqual(["Jul 2026", "Aug 2026"]);
    expect(out.sections[0].rows).toEqual([
      { account: "Revenue", values: [7650, 9725], total: 17375 },
      { account: "Total Income", values: [7650, 9725], total: 17375, summary: true },
    ]);
  });

  it("puts 0 where an account has no activity that month", () => {
    const out = mergeReports(ranges, [
      report([["Less Operating Expenses", [["Rent", "317.25"]]]]),
      report([["Less Operating Expenses", [["Rent", "317.25"], ["Legal Expenses", "270.00"]]]]),
    ]);
    const legal = out.sections[0].rows.find((r) => r.account === "Legal Expenses");
    expect(legal).toEqual({ account: "Legal Expenses", values: [0, 270], total: 270 });
  });

  // STZA had no income in January, so January's report opens with expenses.
  it("keeps Xero's section order even when the first month lacks a section", () => {
    const out = mergeReports(ranges, [
      report([["Less Operating Expenses", [["Rent", "317.25"]]], ["", [["Net Profit", "-317.25"]]]]),
      report([
        ["Income", [["Revenue", "6800.00"]]],
        ["Less Operating Expenses", [["Rent", "317.25"]]],
        ["", [["Net Profit", "6482.75"]]],
      ]),
    ]);
    expect(out.sections.map((s) => s.title)).toEqual(["Income", "Less Operating Expenses", ""]);
    expect(out.sections[0].rows[0]).toEqual({ account: "Revenue", values: [0, 6800], total: 6800 });
  });

  // The agent's own addition came out 1.00 wrong; the code must be exact to the penny.
  it("adds to the penny without floating-point drift", () => {
    const out = mergeReports(ranges, [
      report([["", [["Net Profit", "0.10"]]]]),
      report([["", [["Net Profit", "0.20"]]]]),
    ]);
    expect(out.sections[0].rows[0].total).toBe(0.3);
  });
});

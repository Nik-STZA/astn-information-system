import { describe, expect, it } from "vitest";
import { isPayrollPath, payDateIssue, stripReport } from "./payroll";

// A made-up report in the provider's shape.
const REPORT = [
  ["Company Name", "Sample Ltd"], [], [],
  ["CompanyName", "EmpCode", "Forenames", "Surname", "TaxCode", "Basic", "Tax", "NetPay", "NINumber", "Email"],
  ["Sample Ltd", "11", "JO", "BLOGGS", "1257L", "5000", "900.0000000001", "3450", "AB123456C", "jo@example.com"],
  [],
  ["Sample Ltd", "3", "", "", "", "5000", "900", "3450", "", ""],
];

describe("cutting the report down in the browser", () => {
  it("keeps the code and the figures only", () => {
    const out = stripReport(REPORT)!;
    expect(out.rows[0]).toEqual(["EmpCode", "Basic", "Tax", "NetPay"]);
    expect(out.rows[1]).toEqual(["11", 5000, 900.0000000001, 3450]);
    expect(out.dropped).toBe(6);
    const sent = JSON.stringify(out.rows);
    for (const personal of ["JO", "BLOGGS", "1257L", "AB123456C", "jo@example.com", "Sample Ltd"]) expect(sent.includes(personal), personal).toBe(false);
  });
  it("drops empty rows and leaves the totals row for finance-api to spot", () => {
    expect(stripReport(REPORT)!.rows).toHaveLength(3);
  });
  it("says when the sheet is not a salary report", () => {
    expect(stripReport([["a", "b"], ["1", "2"]])).toBeNull();
  });
});

describe("the rest", () => {
  it("checks the pay date against the month", () => {
    expect(payDateIssue("2026-10", "2026-10-23")).toBeNull();
    expect(payDateIssue("2026-10", "2026-11-01")).toMatch(/fall in the month/);
  });
  it("reaches only the payroll paths", () => {
    expect(isPayrollPath("payroll/roles")).toBe(true);
    expect(isPayrollPath("payroll/runs/123e4567-e89b-12d3-a456-426614174000/propose")).toBe(true);
    expect(isPayrollPath("payroll/runs/123e4567-e89b-12d3-a456-426614174000/workbook-saved")).toBe(false);
    expect(isPayrollPath("journals/approve")).toBe(false);
  });
});

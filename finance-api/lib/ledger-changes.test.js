import { describe, expect, it } from "vitest";
import { documentsFrom, summariseChanges, xeroDate } from "./ledger-changes.js";

const ms = (iso) => `/Date(${Date.parse(`${iso}T00:00:00Z`)}+0000)/`;
const doc = (date, label = "invoices and bills", status = "AUTHORISED") => ({ label, date: ms(date), status });

describe("xeroDate", () => {
  it("reads Xero's /Date(...)/ format and plain days as calendar days", () => {
    expect(xeroDate("/Date(1788134400000+0000)/").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(xeroDate("2026-08-31T00:00:00").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(xeroDate("2026-08-31").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(xeroDate(null)).toBeNull();
  });
});

describe("documentsFrom", () => {
  it("maps each ledger document type to a dated entry", () => {
    expect(
      documentsFrom("/BankTransactions", { BankTransactions: [{ Date: ms("2026-08-14"), Status: "AUTHORISED" }] })
    ).toEqual([{ label: "bank transactions", date: ms("2026-08-14"), status: "AUTHORISED" }]);
    expect(documentsFrom("/Nope", { Nope: [{}] })).toEqual([]);
    expect(documentsFrom("/Invoices", {})).toEqual([]);
  });
});

describe("summariseChanges", () => {
  it("with nothing changed, re-pulls only the reporting year", () => {
    const out = summariseChanges([], { since: "2026-09-01T10:00:00Z", reportingYear: 2026 });
    expect(out).toMatchObject({ changed: 0, yearsToRepull: [2026], flags: [] });
  });

  it("groups changes by the period they post to", () => {
    const out = summariseChanges(
      [doc("2026-08-14"), doc("2026-08-20", "bank transactions"), doc("2026-09-02")],
      { reportingYear: 2026 }
    );
    expect(out.periods).toEqual([
      { period: "2026-08", count: 2, kinds: { "invoices and bills": 1, "bank transactions": 1 } },
      { period: "2026-09", count: 1, kinds: { "invoices and bills": 1 } },
    ]);
  });

  // What the check exists for: something changed today in a year already reported.
  it("re-pulls and flags a year already reported when a document dated into it changed", () => {
    const out = summariseChanges([doc("2025-03-31", "manual journals")], { reportingYear: 2026 });
    expect(out.yearsToRepull).toEqual([2025, 2026]);
    expect(out.flags[0]).toMatch(/already reported: 2025/);
  });

  it("counts voids like any other change, because a void moves the period", () => {
    const out = summariseChanges([doc("2024-11-30", "invoices and bills", "VOIDED")], { reportingYear: 2026 });
    expect(out.yearsToRepull).toEqual([2024, 2026]);
  });

  it("flags changes dated on or before the period lock date", () => {
    const out = summariseChanges([doc("2026-06-30"), doc("2026-07-15")], {
      reportingYear: 2026,
      lockDates: { periodLockDate: ms("2026-06-30") },
    });
    expect(out.flags).toContain("1 entry dated on or before the lock date 2026-06-30");
  });

  it("ignores years after the reporting year and reports undated documents", () => {
    const out = summariseChanges([doc("2027-01-05"), { label: "payments", date: null }], { reportingYear: 2026 });
    expect(out.yearsToRepull).toEqual([2026]);
    expect(out.flags).toContain("1 changed document(s) had no date and could not be placed in a period");
  });
});

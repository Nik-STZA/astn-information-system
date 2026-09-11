import { describe, expect, it } from "vitest";
import {
  documentsFrom,
  historyShowsLedgerChange,
  needsHistoryCheck,
  neverPosted,
  summariseChanges,
  xeroDate,
} from "./ledger-changes.js";

const ms = (iso) => `/Date(${Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)}+0000)/`;
const doc = (date, label = "invoices and bills", status = "AUTHORISED") => ({ label, date: ms(date), status });
const history = (iso, Changes) => ({ DateUTC: ms(iso), Changes });

describe("xeroDate", () => {
  it("reads Xero's /Date(...)/ format and plain days as calendar days", () => {
    expect(xeroDate("/Date(1788134400000+0000)/").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(xeroDate("2026-08-31T00:00:00").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(xeroDate("2026-08-31").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(xeroDate(null)).toBeNull();
  });
});

describe("documentsFrom", () => {
  it("keeps the resource, id, date and status of each changed document", () => {
    expect(
      documentsFrom("/BankTransactions", {
        BankTransactions: [{ BankTransactionID: "b-1", Date: ms("2026-08-14"), Status: "AUTHORISED" }],
      })
    ).toEqual([
      { resource: "/BankTransactions", id: "b-1", label: "bank transactions", date: ms("2026-08-14"), status: "AUTHORISED" },
    ]);
    expect(documentsFrom("/Nope", { Nope: [{}] })).toEqual([]);
    expect(documentsFrom("/Invoices", {})).toEqual([]);
  });
});

describe("neverPosted", () => {
  // FGH on 11 Sep 2026: four deleted draft sales invoices with no date.
  it("drops drafts and deleted drafts, which never reached the ledger", () => {
    expect(neverPosted({ resource: "/Invoices", status: "DELETED" })).toBe(true);
    expect(neverPosted({ resource: "/Invoices", status: "DRAFT" })).toBe(true);
    expect(neverPosted({ resource: "/ManualJournals", status: "DRAFT" })).toBe(true);
  });

  it("keeps voids and deleted bank transactions and payments, which reverse postings", () => {
    expect(neverPosted({ resource: "/Invoices", status: "VOIDED" })).toBe(false);
    expect(neverPosted({ resource: "/BankTransactions", status: "DELETED" })).toBe(false);
    expect(neverPosted({ resource: "/Payments", status: "DELETED" })).toBe(false);
  });
});

describe("needsHistoryCheck", () => {
  const ctx = { reportingYear: 2026, lockDates: { periodLockDate: ms("2026-07-31") } };

  it("checks documents dated on or before the lock date, or into an earlier year", () => {
    expect(needsHistoryCheck({ resource: "/Invoices", id: "i", date: ms("2026-06-30") }, ctx)).toBe(true);
    expect(needsHistoryCheck({ resource: "/Invoices", id: "i", date: ms("2025-12-31") }, { reportingYear: 2026 })).toBe(true);
  });

  it("does not spend a call on documents in open periods of the reporting year", () => {
    expect(needsHistoryCheck({ resource: "/Invoices", id: "i", date: ms("2026-08-15") }, ctx)).toBe(false);
  });

  it("never reads history for bank transfers or documents without an id", () => {
    expect(needsHistoryCheck({ resource: "/BankTransfers", id: "t", date: ms("2026-06-30") }, ctx)).toBe(false);
    expect(needsHistoryCheck({ resource: "/Invoices", id: null, date: ms("2026-06-30") }, ctx)).toBe(false);
  });
});

describe("historyShowsLedgerChange", () => {
  const since = "2026-09-01T00:00:00Z";

  // Real FGH histories from 11 Sep 2026.
  it("ignores a June bill that was only paid since the watermark", () => {
    const records = [
      history("2026-06-03T09:00:00Z", "Created"),
      history("2026-06-03T09:00:01Z", "Attached a file"),
      history("2026-06-03T09:00:02Z", "Approved"),
      history("2026-06-30T10:00:00Z", "Edited"),
      history("2026-09-05T10:00:00Z", "Paid"),
    ];
    expect(historyShowsLedgerChange(records, since)).toBe(false);
  });

  it("ignores a document Xero marked modified with no history since the watermark", () => {
    expect(historyShowsLedgerChange([history("2026-08-25T12:00:00Z", "Paid")], since)).toBe(false);
  });

  it("counts a manual journal created and posted since the watermark", () => {
    const records = [history("2026-09-07T09:59:53Z", "Created"), history("2026-09-07T10:01:40Z", "Posted")];
    expect(historyShowsLedgerChange(records, since)).toBe(true);
  });

  it("counts an edit since the watermark, and any label it does not recognise", () => {
    expect(historyShowsLedgerChange([history("2026-09-02T08:00:00Z", "Edited")], since)).toBe(true);
    expect(historyShowsLedgerChange([history("2026-09-02T08:00:00Z", "Something new")], since)).toBe(true);
  });

  it("counts everything when the watermark is unusable", () => {
    expect(historyShowsLedgerChange([], "not a date")).toBe(true);
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

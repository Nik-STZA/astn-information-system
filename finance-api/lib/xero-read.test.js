import { describe, expect, it } from "vitest";
import { resolveRead, stripPersonal, maskBankDetails, XERO_READ_RESOURCES, XERO_READ_REPORTS } from "./xero-read";

const ID = "6306a21a-8684-4fd8-8c71-4180c464b6b9";

describe("resolveRead: lists and records", () => {
  it("keeps the resources the portal already served", () => {
    for (const k of ["accounts", "invoices", "contacts", "payments", "bank-transactions",
      "manual-journals", "credit-notes", "tax-rates", "tracking-categories"]) {
      expect(resolveRead({ resource: k }).ok).toBe(true);
    }
  });

  it("builds accounting URLs", () => {
    const r = resolveRead({ resource: "invoices", id: ID });
    expect(r.url).toBe(`https://api.xero.com/api.xro/2.0/Invoices/${ID}`);
    expect(r.binary).toBe(false);
  });

  it("routes Files, Assets and Payroll to their own APIs", () => {
    expect(resolveRead({ resource: "inbox" }).url).toBe("https://api.xero.com/files.xro/1.0/Inbox");
    expect(resolveRead({ resource: "assets" }).url).toBe("https://api.xero.com/assets.xro/1.0/Assets");
    expect(resolveRead({ resource: "pay-runs" }).url).toBe("https://api.xero.com/payroll.xro/2.0/PayRuns");
  });

  it("does not offer /Journals, which this app cannot be granted", () => {
    expect(XERO_READ_RESOURCES.journals).toBeUndefined();
    expect(resolveRead({ resource: "journals" }).status).toBe(404);
  });

  it("rejects unknown resources with the allowed list", () => {
    const r = resolveRead({ resource: "everything" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.allowed.resources).toContain("invoices");
  });

  it("requires a GUID id", () => {
    expect(resolveRead({ resource: "invoices", id: "INV-001" }).status).toBe(400);
    expect(resolveRead({ resource: "invoices", id: "../Organisation" }).status).toBe(400);
  });

  it("refuses ids on list-only resources", () => {
    expect(resolveRead({ resource: "tax-rates", id: ID }).status).toBe(404);
  });

  it("defaults the fixed asset list to REGISTERED, and only the list", () => {
    expect(resolveRead({ resource: "assets" }).defaults).toEqual({ status: "REGISTERED" });
    expect(resolveRead({ resource: "assets", id: ID }).defaults).toEqual({});
    expect(resolveRead({ resource: "invoices" }).defaults).toEqual({});
  });

  it("needs an id for object associations", () => {
    expect(resolveRead({ resource: "object-associations" }).status).toBe(400);
    expect(resolveRead({ resource: "object-associations", id: ID }).url)
      .toBe(`https://api.xero.com/files.xro/1.0/Associations/${ID}`);
  });
});

describe("resolveRead: sub-resources", () => {
  it("keeps history on the five documents that had it", () => {
    for (const k of ["invoices", "credit-notes", "manual-journals", "bank-transactions", "payments"]) {
      const r = resolveRead({ resource: k, id: ID, sub: "history" });
      expect(r.ok).toBe(true);
      expect(r.url.endsWith(`/${ID}/History`)).toBe(true);
    }
  });

  it("returns PDFs as binary from the record URL", () => {
    const r = resolveRead({ resource: "invoices", id: ID, sub: "pdf" });
    expect(r.url).toBe(`https://api.xero.com/api.xro/2.0/Invoices/${ID}`);
    expect(r).toMatchObject({ binary: true, accept: "application/pdf" });
  });

  it("returns Files content as binary", () => {
    const r = resolveRead({ resource: "files", id: ID, sub: "content" });
    expect(r.url).toBe(`https://api.xero.com/files.xro/1.0/Files/${ID}/Content`);
    expect(r.binary).toBe(true);
  });

  it("reads organisation CIS settings by organisation id", () => {
    expect(resolveRead({ resource: "organisation", id: ID, sub: "cis" }).url)
      .toBe(`https://api.xero.com/api.xro/2.0/Organisation/${ID}/CISSettings`);
    expect(resolveRead({ resource: "organisation", id: ID }).ok).toBe(false);
  });

  it("refuses a sub-resource the record does not have", () => {
    expect(resolveRead({ resource: "payments", id: ID, sub: "pdf" }).status).toBe(404);
    expect(resolveRead({ resource: "invoices", id: ID, sub: "everything" }).status).toBe(404);
  });

  it("refuses a sub-resource without an id", () => {
    expect(resolveRead({ resource: "invoices", sub: "history" }).status).toBe(400);
  });
});

describe("resolveRead: attachments", () => {
  it("fetches one attachment by name, encoded", () => {
    const r = resolveRead({ resource: "invoices", id: ID, name: "Supplier invoice 12.pdf" });
    expect(r.url).toBe(`https://api.xero.com/api.xro/2.0/Invoices/${ID}/Attachments/Supplier%20invoice%2012.pdf`);
    expect(r.binary).toBe(true);
  });

  it("rejects names that could walk the path", () => {
    for (const name of ["../x", "a/b", "a\\b", "..", ""]) {
      expect(resolveRead({ resource: "invoices", id: ID, name }).status).toBe(400);
    }
  });

  it("refuses attachments on records that cannot carry them", () => {
    expect(resolveRead({ resource: "payments", id: ID, name: "x.pdf" }).status).toBe(404);
  });
});

describe("reports", () => {
  it("adds budget summary to the existing seven", () => {
    expect(Object.keys(XERO_READ_REPORTS)).toHaveLength(8);
    expect(XERO_READ_REPORTS["budget-summary"]).toBe("/Reports/BudgetSummary");
  });
});

describe("payroll redaction", () => {
  it("marks every payroll resource as personal", () => {
    for (const [k, def] of Object.entries(XERO_READ_RESOURCES)) {
      if (def.api === "payroll") expect(resolveRead({ resource: k }).personal, k).toBe(true);
    }
  });

  it("removes per-person fields at any depth, whatever their case", () => {
    const payRun = {
      payRuns: [{
        payRunID: "x", totalCost: 1000, totalPay: 800,
        paySlips: [{ firstName: "A", lastName: "B", employeeID: "e", netPay: 800 }],
        Employees: [{ FirstName: "A" }],
        nested: { bacsHash: "h", paymentMethod: "Electronically", keep: 1 },
      }],
    };
    expect(stripPersonal(payRun)).toEqual({
      payRuns: [{ payRunID: "x", totalCost: 1000, totalPay: 800, nested: { keep: 1 } }],
    });
  });

  it("leaves non-personal values untouched", () => {
    expect(stripPersonal([1, "a", null, { a: [true] }])).toEqual([1, "a", null, { a: [true] }]);
  });
});

describe("maskBankDetails", () => {
  it("shows a contact's bank numbers as the last 4 characters only", () => {
    const contact = {
      Name: "Supplier Ltd", CompanyNumber: "16850337", TaxNumber: "GB493735845",
      BankAccountDetails: "60-14-41 12345678",
      BatchPayments: { BankAccountNumber: "60-14-4112345678", BankAccountName: "Supplier Ltd" },
    };
    expect(maskBankDetails({ Contacts: [contact] })).toEqual({ Contacts: [{
      Name: "Supplier Ltd", CompanyNumber: "16850337", TaxNumber: "GB493735845",
      BankAccountDetails: "****5678",
      BatchPayments: { BankAccountNumber: "****5678", BankAccountName: "Supplier Ltd" },
    }] });
  });

  it("leaves empty values and everything else alone", () => {
    expect(maskBankDetails({ BankAccountDetails: "", Total: 12, Lines: [{ IBAN: "GB00 TEST 0000 0000 0012 34" }] }))
      .toEqual({ BankAccountDetails: "", Total: 12, Lines: [{ IBAN: "****1234" }] });
  });

  // 21 Oct 2026: a contact's history carried the full number in its sentence.
  it("masks bank numbers inside history sentences, and nothing else there", () => {
    const h = { HistoryRecords: [
      { Changes: "Edited", Details: "Bank account number changed from no value to 60-14-41 12345678." },
      { Changes: "Edited", Details: "Bank account number changed from 60-14-4100000068 to 60-14-4100001068." },
      { Changes: "Note", Details: "IBAN updated: GB29 NWBK 6016 1331 9268 19" },
      { Changes: "Note", Details: "Invoice 5713451497 approved for 12,000.00. Company 16850337." },
    ] };
    const out = maskBankDetails(h).HistoryRecords.map((r) => r.Details);
    expect(out[0]).toBe("Bank account number changed from no value to ****5678.");
    expect(out[1]).toBe("Bank account number changed from ****0068 to ****1068.");
    expect(out[2]).not.toMatch(/6016|1331/);
    expect(out[2]).toMatch(/\*\*\*\*6819/);
    expect(out[3]).toBe("Invoice 5713451497 approved for 12,000.00. Company 16850337.");
  });
});

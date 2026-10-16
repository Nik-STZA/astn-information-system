import { describe, expect, it } from "vitest";
import {
  writePolicy, tierIssues, laneIssues, parseDecimal, validateLines,
  documentRequestIssues, buildDocumentPayload, duplicateWhere,
  contactRequestIssues, buildContactPayload, historyText, HISTORY_PREFIX,
  fileNameIssues, idempotencyKey, xeroErrors,
} from "./xero-write";

const ID = "6306a21a-8684-4fd8-8c71-4180c464b6b9";
const ACCOUNTS = [
  { Code: "400", Status: "ACTIVE" },
  { Code: "429", Status: "ACTIVE" },
  { Code: "999", Status: "ARCHIVED" },
];
const TAX = [
  { TaxType: "INPUT2", Status: "ACTIVE" },
  { TaxType: "NONE", Status: "ACTIVE" },
  { TaxType: "OLDTAX", Status: "DELETED" },
];

describe("write policy", () => {
  it("defaults to note and draft only", () => {
    expect(writePolicy(undefined)).toMatchObject({ note: true, draft: true, post: false, settle: false, conversion: false });
  });

  it("takes an entity's own switches, ignoring anything not boolean", () => {
    const p = writePolicy({ write_policy: { draft: false, post: true, settle: "yes" } });
    expect(p).toMatchObject({ draft: false, post: true, settle: false });
  });

  it("refuses a tier that is off", () => {
    expect(tierIssues({ write_policy: { draft: false } }, "draft")).toHaveLength(1);
    expect(tierIssues({}, "draft")).toEqual([]);
    expect(tierIssues({}, "settle")).toHaveLength(1);
  });
});

describe("the lane ends at SUBMITTED", () => {
  it("allows DRAFT and SUBMITTED", () => {
    expect(laneIssues("DRAFT")).toEqual([]);
    expect(laneIssues("SUBMITTED")).toEqual([]);
  });

  it("refuses approval and beyond", () => {
    for (const s of ["AUTHORISED", "PAID", "VOIDED", "DELETED"]) expect(laneIssues(s)[0]).toMatch(/lane ends at SUBMITTED/);
  });

  it("refuses to touch a document already past SUBMITTED", () => {
    expect(laneIssues("DRAFT", "AUTHORISED")[0]).toMatch(/existing document is AUTHORISED/);
  });
});

describe("exact amounts", () => {
  it("accepts strings and integers up to 4 places", () => {
    expect(parseDecimal("12.3456", "x").scaled).toBe(123456n);
    expect(parseDecimal(7, "x").scaled).toBe(70000n);
    expect(parseDecimal("-0.5", "x").scaled).toBe(-5000n);
  });

  it("refuses floats, extra places and text", () => {
    expect(() => parseDecimal(0.1, "x")).toThrow(/float/);
    expect(() => parseDecimal("1.23456", "x")).toThrow(/decimal places/);
    expect(() => parseDecimal("1,000", "x")).toThrow(/not a number/);
    expect(() => parseDecimal("", "x")).toThrow(/not a number/);
  });
});

describe("line validation", () => {
  const line = (o = {}) => ({ description: "Hosting", account_code: "429", unit_amount: "100.00", ...o });

  it("builds Xero line items and a pence-exact net", () => {
    const v = validateLines([line(), line({ unit_amount: "0.335", quantity: "3", tax_type: "INPUT2" })], ACCOUNTS, TAX);
    expect(v.issues).toEqual([]);
    expect(v.net).toBe("101.01"); // 100.00 + round(1.005) = 101.01
    expect(v.items[0]).toEqual({ Description: "Hosting", Quantity: 1, UnitAmount: 100, AccountCode: "429" });
    expect(v.items[1]).toMatchObject({ Quantity: 3, UnitAmount: 0.335, TaxType: "INPUT2" });
  });

  it("rounds half away from zero to pence, negatives included", () => {
    expect(validateLines([line({ unit_amount: "-0.005" })], ACCOUNTS, TAX).net).toBe("-0.01");
  });

  it("reports every problem at once", () => {
    const v = validateLines([
      line({ account_code: "123" }),
      line({ account_code: "999" }),
      line({ tax_type: "OLDTAX" }),
      line({ description: " " }),
      line({ quantity: "0" }),
      line({ unit_amount: 1.5 }),
      "not a line",
    ], ACCOUNTS, TAX);
    expect(v.issues.join("\n")).toMatch(/123 is not in this entity's chart/);
    expect(v.issues.join("\n")).toMatch(/999 is archived/);
    expect(v.issues.join("\n")).toMatch(/OLDTAX is not an active tax rate/);
    expect(v.issues.join("\n")).toMatch(/Line 4: description is required/);
    expect(v.issues.join("\n")).toMatch(/Line 5: quantity must be positive/);
    expect(v.issues.join("\n")).toMatch(/Line 6 unit_amount: 1.5 must be a string or an integer/);
    expect(v.issues.join("\n")).toMatch(/Line 7: must be an object/);
  });

  it("needs at least one line", () => {
    expect(validateLines([], ACCOUNTS, TAX).issues).toEqual(["At least one line is required"]);
  });

  it("passes tracking through, and needs name and option", () => {
    expect(validateLines([line({ tracking: [{ name: "Region", option: "UK" }] })], ACCOUNTS, TAX).items[0].Tracking)
      .toEqual([{ Name: "Region", Option: "UK" }]);
    expect(validateLines([line({ tracking: [{ name: "Region" }] })], ACCOUNTS, TAX).issues[0]).toMatch(/tracking/);
  });
});

describe("bills, invoices and credit notes", () => {
  const bill = { type: "ACCPAY", contact_id: ID, date: "2026-10-16", lines: [{}], audit_note: "test" };

  it("accepts a well-formed new bill", () => {
    expect(documentRequestIssues("invoice", bill).issues).toEqual([]);
  });

  it("needs contact, date, lines and an audit note for a new document", () => {
    const { issues } = documentRequestIssues("invoice", { type: "ACCPAY" });
    expect(issues.join("\n")).toMatch(/contact_id is required/);
    expect(issues.join("\n")).toMatch(/date is required/);
    expect(issues.join("\n")).toMatch(/lines are required/);
    expect(issues.join("\n")).toMatch(/audit_note is required/);
  });

  it("refuses the wrong type for the document", () => {
    expect(documentRequestIssues("invoice", { ...bill, type: "ACCPAYCREDIT" }).issues[0]).toMatch(/ACCPAY, ACCREC/);
    expect(documentRequestIssues("credit_note", { ...bill, type: "ACCPAYCREDIT" }).issues).toEqual([]);
  });

  it("refuses AUTHORISED", () => {
    expect(documentRequestIssues("invoice", { ...bill, status: "authorised" }).issues[0]).toMatch(/lane ends at SUBMITTED/);
  });

  it("refuses bad dates and ids", () => {
    const { issues } = documentRequestIssues("invoice", { ...bill, date: "2026-02-30", due_date: "16/10/2026", contact_id: "x" });
    expect(issues.join("\n")).toMatch(/date must be YYYY-MM-DD/);
    expect(issues.join("\n")).toMatch(/due_date must be YYYY-MM-DD/);
    expect(issues.join("\n")).toMatch(/contact_id must be a Xero GUID/);
  });

  it("builds the payload, with no due date on a credit note", () => {
    const items = [{ Description: "x" }];
    const inv = buildDocumentPayload("invoice", { ...bill, due_date: "2026-11-15", number: "INV-9", currency_code: "usd" },
      { type: "ACCPAY", status: "DRAFT", lineAmountTypes: "Exclusive", items });
    expect(inv.Invoices[0]).toEqual({
      Type: "ACCPAY", Status: "DRAFT", LineAmountTypes: "Exclusive", LineItems: items,
      Contact: { ContactID: ID }, Date: "2026-10-16", DueDate: "2026-11-15", InvoiceNumber: "INV-9", CurrencyCode: "USD",
    });
    const cn = buildDocumentPayload("credit_note", { ...bill, due_date: "2026-11-15", number: "CN-1" },
      { type: "ACCPAYCREDIT", status: "DRAFT", lineAmountTypes: "Exclusive", items });
    expect(cn.CreditNotes[0].DueDate).toBeUndefined();
    expect(cn.CreditNotes[0].CreditNoteNumber).toBe("CN-1");
  });

  it("escapes the supplier number in the duplicate check", () => {
    expect(duplicateWhere("invoice", "ACCPAY", 'A"1', ID))
      .toBe(`Type=="ACCPAY" AND InvoiceNumber=="A\\"1" AND Contact.ContactID==guid("${ID}")`);
  });
});

describe("contacts", () => {
  it("refuses bank details and archiving whatever Xero allows", () => {
    const issues = contactRequestIssues({ name: "X", audit_note: "n", bank_account_details: "12-34-56", contact_status: "ARCHIVED" });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/bank details/);
  });

  it("needs a name for a new contact and an audit note", () => {
    expect(contactRequestIssues({}).join("\n")).toMatch(/name is required.*\n.*audit_note/s);
  });

  it("sends only the fields passed, so an update never blanks one", () => {
    expect(buildContactPayload({ id: ID, tax_number: "GB123", email: "", default_currency: "eur" }))
      .toEqual({ Contacts: [{ ContactID: ID, TaxNumber: "GB123", DefaultCurrency: "EUR" }] });
  });

  it("carries identity fields for the supplier master", () => {
    const c = buildContactPayload({
      name: "Acme Ltd", company_number: "01234567", tax_number: "GB123456789",
      address: { line1: "1 High St", city: "London", postal_code: "N1 1AA", country: "GB" },
    }).Contacts[0];
    expect(c).toMatchObject({ Name: "Acme Ltd", CompanyNumber: "01234567", TaxNumber: "GB123456789" });
    expect(c.Addresses[0]).toMatchObject({ AddressType: "POBOX", AddressLine1: "1 High St", Country: "GB" });
  });
});

describe("history notes, files and keys", () => {
  it("prefixes notes once", () => {
    expect(historyText("hello")).toBe(`${HISTORY_PREFIX}hello`);
    expect(historyText(`${HISTORY_PREFIX}hello`)).toBe(`${HISTORY_PREFIX}hello`);
  });

  it("refuses file names that could walk a path", () => {
    for (const n of ["", "../x.pdf", "a/b.pdf", "a\\b.pdf", ".."]) expect(fileNameIssues(n)).toHaveLength(1);
    expect(fileNameIssues("Supplier invoice 12.pdf")).toEqual([]);
  });

  it("derives the same key for the same payload, whatever the key order", () => {
    const a = idempotencyKey("stza", "upsert_invoice", { a: 1, b: { c: 2, d: 3 } });
    const b = idempotencyKey("stza", "upsert_invoice", { b: { d: 3, c: 2 }, a: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^stza-[0-9a-f]{48}$/);
    expect(idempotencyKey("feldspar-ltd", "upsert_invoice", { a: 1, b: { c: 2, d: 3 } })).not.toBe(a);
  });

  it("uses a caller's key, within Xero's length limit", () => {
    expect(idempotencyKey("stza", "x", {}, " mine ")).toBe("mine");
    expect(() => idempotencyKey("stza", "x", {}, "k".repeat(129))).toThrow(/1 to 128/);
  });

  it("pulls validation messages out of any Xero error shape", () => {
    expect(xeroErrors({ Elements: [{ ValidationErrors: [{ Message: "Account code '1' is not valid" }] }] }))
      .toEqual(["Account code '1' is not valid"]);
    expect(xeroErrors({ Message: "A validation exception occurred" })).toEqual(["A validation exception occurred"]);
    expect(xeroErrors({ Detail: "AuthorizationUnsuccessful" })).toEqual(["AuthorizationUnsuccessful"]);
    expect(xeroErrors(null)).toEqual([]);
  });
});

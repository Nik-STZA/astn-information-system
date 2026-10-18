import { describe, expect, it } from "vitest";
import {
  isConfirmedTier, payloadDigest, confirmationRefusal, capIssues, money, grossOf,
  journalTier, journalTransitionIssues, parseCsv, parseJournalFile, resolveTaxRate,
  paymentRequest, paymentDocumentIssues, bankAccountIssues, allocationRequest,
  allocationDocumentIssues, bankTransactionRequest, buildBankTransaction,
  bankTransferRequest, settingRequest, settingChartIssues, repeatingInvoiceRequest,
  fixedAssetRequest, conversionRequest,
} from "./xero-confirmed";
import { writePolicy } from "./xero-write";

const ID = "6306a21a-8684-4fd8-8c71-4180c464b6b9";
const ID2 = "a1b2c3d4-0000-4000-8000-000000000002";
const NOTE = { audit_note: "STZA-TEST" };

describe("confirmation codes", () => {
  it("covers exactly the five confirmed tiers", () => {
    for (const t of ["post", "send", "settle", "setup", "conversion"]) expect(isConfirmedTier(t)).toBe(true);
    for (const t of ["note", "draft"]) expect(isConfirmedTier(t)).toBe(false);
  });

  it("binds the digest to tool, entity and payload, ignoring key order", () => {
    const a = payloadDigest("record_payment", "e1", { a: 1, b: { c: 2, d: 3 } });
    expect(payloadDigest("record_payment", "e1", { b: { d: 3, c: 2 }, a: 1 })).toBe(a);
    expect(payloadDigest("record_payment", "e2", { a: 1, b: { c: 2, d: 3 } })).not.toBe(a);
    expect(payloadDigest("delete_payment", "e1", { a: 1, b: { c: 2, d: 3 } })).not.toBe(a);
    expect(payloadDigest("record_payment", "e1", { a: 1, b: { c: 2, d: 4 } })).not.toBe(a);
  });

  it("says why a code did not redeem", () => {
    expect(confirmationRefusal(undefined)).toMatch(/not recognised/);
    expect(confirmationRefusal({ consumed_at: new Date(), live: true })).toMatch(/already been used/);
    expect(confirmationRefusal({ consumed_at: null, live: false })).toMatch(/expired/);
    expect(confirmationRefusal({ consumed_at: null, live: true })).toMatch(/different write/);
  });
});

describe("settle cap", () => {
  const cfg = { write_policy: { settle: true } };
  it("defaults to 5000.00 and applies to settle only", () => {
    expect(writePolicy(cfg).max_amount).toBe("5000.00");
    expect(capIssues(cfg, "settle", "5000.00")).toEqual([]);
    expect(capIssues(cfg, "settle", "5000.01")[0]).toMatch(/over the settle cap of 5000.00/);
    expect(capIssues(cfg, "post", "99999.00")).toEqual([]);
  });
  it("compares the size of a negative amount", () => {
    expect(capIssues(cfg, "settle", "-6000.00")).toHaveLength(1);
  });
  it("honours an entity's own cap, and null for none", () => {
    expect(capIssues({ write_policy: { max_amount: "100" } }, "settle", "100.01")).toHaveLength(1);
    expect(capIssues({ write_policy: { max_amount: null } }, "settle", "1000000.00")).toEqual([]);
  });
  it("skips writes with no single amount", () => {
    expect(capIssues(cfg, "settle", null)).toEqual([]);
  });
});

describe("money and gross", () => {
  it("takes strings and integers, refuses floats, zero and negatives", () => {
    const issues = [];
    expect(money("12.50", "amount", issues)).toEqual({ json: 12.5, text: "12.50" });
    expect(money(12, "amount", issues)).toEqual({ json: 12, text: "12" });
    expect(issues).toEqual([]);
    money(12.5, "amount", issues);
    money("0", "amount", issues);
    money("-1", "amount", issues);
    money("1.005", "amount", issues);
    expect(issues).toHaveLength(4);
  });
  it("sums the debit side exactly", () => {
    expect(grossOf(["0.10", "0.20", "-0.30"])).toBe("0.30");
    expect(grossOf(["1234.56", "-1234.56"])).toBe("1234.56");
  });
});

describe("journal status", () => {
  it("puts DRAFT in the draft tier and anything else in post", () => {
    expect(journalTier("DRAFT")).toBe("draft");
    expect(journalTier(undefined)).toBe("draft");
    expect(journalTier("POSTED")).toBe("post");
    expect(journalTier("VOIDED")).toBe("post");
    expect(journalTier("nonsense")).toBe("post");
  });
  it("allows only the transitions Xero allows", () => {
    expect(journalTransitionIssues("DRAFT", "POSTED")).toEqual([]);
    expect(journalTransitionIssues("DRAFT", "voided")).toEqual([]);
    expect(journalTransitionIssues("POSTED", "VOIDED")).toEqual([]);
    expect(journalTransitionIssues("POSTED", "DRAFT")[0]).toMatch(/does not allow POSTED -> DRAFT/);
    expect(journalTransitionIssues("VOIDED", "POSTED")).toHaveLength(1);
    expect(journalTransitionIssues("DRAFT", "DELETED")[0]).toMatch(/must be DRAFT, POSTED or VOIDED/);
  });
});

describe("journal files", () => {
  const HEADER = "*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount";

  it("parses quoted fields, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });

  it("groups rows into journals by narration and date", () => {
    const csv = [HEADER,
      "Payroll Sep,30/09/2026,Gross pay,477,No VAT,\"1,000.00\"",
      "Payroll Sep,30/09/2026,PAYE,825,No VAT,(1000.00)",
      "Accrual,2026-09-30,Audit fee,401,,250",
      "Accrual,2026-09-30,Audit fee,800,,-250"].join("\r\n");
    const { journals, issues } = parseJournalFile(csv);
    expect(issues).toEqual([]);
    expect(journals).toHaveLength(2);
    expect(journals[0]).toMatchObject({ narration: "Payroll Sep", date: "2026-09-30", rows: [2, 3] });
    expect(journals[0].lines.map((l) => l.amount)).toEqual(["1000.00", "-1000.00"]);
    expect(journals[0].lines[0]).toMatchObject({ account_code: "477", tax_rate: "No VAT", description: "Gross pay" });
    expect(journals[1].lines.map((l) => l.amount)).toEqual(["250", "-250"]);
  });

  it("accepts headers without asterisks, in any case", () => {
    const { journals, issues } = parseJournalFile("narration,DATE,AccountCode,amount\nX,01/10/2026,400,1\nX,01/10/2026,401,-1");
    expect(issues).toEqual([]);
    expect(journals[0].date).toBe("2026-10-01");
  });

  it("reports every bad row by its row number", () => {
    const csv = [HEADER, ",31/02/2026,,400,,1.234", "OK,01/10/2026,,,,abc"].join("\n");
    const { issues } = parseJournalFile(csv);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Row 2: narration is blank/),
      expect.stringMatching(/^Row 2: date "31\/02\/2026"/),
      expect.stringMatching(/^Row 2: amount "1.234"/),
      expect.stringMatching(/^Row 3: amount "abc"/),
      expect.stringMatching(/^Row 3: account code is blank/),
    ]));
  });

  it("refuses a file without the required columns", () => {
    expect(parseJournalFile("Narration,Date,Amount\nx,01/10/2026,1").issues[0]).toMatch(/missing account_code/);
    expect(parseJournalFile("").issues[0]).toMatch(/empty/);
  });

  it("keeps tracking, and refuses half of a pair", () => {
    const csv = "*Narration,*Date,*AccountCode,*Amount,TrackingName1,TrackingOption1\nX,01/10/2026,400,1,Dept,Ops\nX,01/10/2026,401,-1,Dept,";
    const { journals, issues } = parseJournalFile(csv);
    expect(journals[0].lines[0].tracking).toEqual([{ name: "Dept", option: "Ops" }]);
    expect(issues[0]).toMatch(/Row 3: tracking needs both/);
  });

  it("resolves tax rates by Xero name or code, never by guess", () => {
    const rates = [
      { Name: "No VAT", TaxType: "NONE", Status: "ACTIVE" },
      { Name: "20% (VAT on Expenses)", TaxType: "INPUT2", Status: "ACTIVE" },
      { Name: "Old", TaxType: "OLD", Status: "DELETED" },
    ];
    expect(resolveTaxRate("", rates)).toEqual({ taxType: "NONE" });
    expect(resolveTaxRate("20% (vat on expenses)", rates)).toEqual({ taxType: "INPUT2" });
    expect(resolveTaxRate("INPUT2", rates)).toEqual({ taxType: "INPUT2" });
    expect(resolveTaxRate("Old", rates).error).toMatch(/not an active tax rate/);
    expect(resolveTaxRate("Exempt", rates).error).toMatch(/not an active tax rate/);
  });
});

describe("payments", () => {
  const good = { ...NOTE, document_type: "Invoices", document_id: ID, bank_account_code: "090", amount: "120.00", date: "2026-10-01" };

  it("builds the Xero payment with exact amounts", () => {
    const r = paymentRequest({ ...good, reference: "BACS", currency_rate: "1.1712345" });
    expect(r.issues).toEqual([]);
    expect(r.amount).toBe("120.00");
    expect(r.payload.Payments[0]).toEqual({
      Invoice: { InvoiceID: ID }, Account: { Code: "090" }, Date: "2026-10-01", Amount: 120, Reference: "BACS", CurrencyRate: 1.1712345,
    });
    expect(paymentRequest({ ...good, document_type: "CreditNotes" }).payload.Payments[0].CreditNote).toEqual({ CreditNoteID: ID });
  });

  it("refuses a bad request in full", () => {
    const r = paymentRequest({ document_type: "Bills", document_id: "x", amount: 1.5, date: "01/10/2026" });
    expect(r.issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/audit_note/), expect.stringMatching(/document_type/), expect.stringMatching(/GUID/),
      expect.stringMatching(/bank_account_code/), expect.stringMatching(/float/), expect.stringMatching(/YYYY-MM-DD/),
    ]));
  });

  it("checks the document is AUTHORISED and the amount is not over what is due", () => {
    expect(paymentDocumentIssues({ Status: "AUTHORISED", AmountDue: 120 }, "120.00")).toEqual([]);
    expect(paymentDocumentIssues({ Status: "AUTHORISED", AmountDue: 119.99 }, "120.00")[0]).toMatch(/more than the 119.99/);
    expect(paymentDocumentIssues({ Status: "DRAFT", AmountDue: 120 }, "1.00")[0]).toMatch(/DRAFT/);
  });

  it("checks the account is an active bank or payments account", () => {
    const accounts = [
      { Code: "090", Type: "BANK", Status: "ACTIVE" },
      { Code: "091", Type: "BANK", Status: "ARCHIVED" },
      { Code: "820", Type: "CURRLIAB", Status: "ACTIVE", EnablePaymentsToAccount: true },
      { Code: "400", Type: "EXPENSE", Status: "ACTIVE" },
    ];
    expect(bankAccountIssues(accounts, "090")).toEqual([]);
    expect(bankAccountIssues(accounts, "820")).toEqual([]);
    expect(bankAccountIssues(accounts, "091")[0]).toMatch(/archived/);
    expect(bankAccountIssues(accounts, "400")[0]).toMatch(/neither/);
    expect(bankAccountIssues(accounts, "999")[0]).toMatch(/not in this entity/);
  });
});

describe("allocations", () => {
  const src = { Type: "ACCPAYCREDIT", Contact: { ContactID: ID }, RemainingCredit: 50 };
  const inv = { Type: "ACCPAY", Contact: { ContactID: ID }, Status: "AUTHORISED", AmountDue: 80 };

  it("builds the allocation", () => {
    const r = allocationRequest({ ...NOTE, source_type: "CreditNotes", source_id: ID, invoice_id: ID2, amount: "50.00", date: "2026-10-01" });
    expect(r.issues).toEqual([]);
    expect(r.payload).toEqual({ Allocations: [{ Invoice: { InvoiceID: ID2 }, Amount: 50, Date: "2026-10-01" }] });
  });

  it("refuses the wrong side, another contact, an unapproved invoice or too much", () => {
    expect(allocationDocumentIssues(src, inv, "50.00")).toEqual([]);
    expect(allocationDocumentIssues(src, { ...inv, Type: "ACCREC" }, "1.00")[0]).toMatch(/cannot be applied/);
    expect(allocationDocumentIssues(src, { ...inv, Contact: { ContactID: ID2 } }, "1.00")[0]).toMatch(/different contacts/);
    expect(allocationDocumentIssues(src, { ...inv, Status: "DRAFT" }, "1.00")[0]).toMatch(/DRAFT/);
    expect(allocationDocumentIssues(src, inv, "50.01")[0]).toMatch(/more than the credit remaining \(50.00\)/);
  });
});

describe("bank transactions and transfers", () => {
  it("posts bank transactions as AUTHORISED, because Xero has no draft for them", () => {
    const b = { ...NOTE, transaction_type: "spend", bank_account_code: "090", date: "2026-10-01", reference: "Card", contact_id: ID };
    const r = bankTransactionRequest(b);
    expect(r.issues).toEqual([]);
    const p = buildBankTransaction(b, { ...r, items: [{ Description: "Fee" }] });
    expect(p.BankTransactions[0]).toMatchObject({ Type: "SPEND", Status: "AUTHORISED", BankAccount: { Code: "090" }, Contact: { ContactID: ID } });
  });

  it("refuses an unknown type", () => {
    expect(bankTransactionRequest({ ...NOTE, transaction_type: "PREPAYMENT", bank_account_code: "090", date: "2026-10-01" }).issues[0]).toMatch(/SPEND or RECEIVE/);
  });

  it("refuses a transfer to the same account", () => {
    const r = bankTransferRequest({ ...NOTE, from_bank_account_code: "090", to_bank_account_code: "090", amount: "10", date: "2026-10-01" });
    expect(r.issues[0]).toMatch(/must differ/);
    const ok = bankTransferRequest({ ...NOTE, from_bank_account_code: "090", to_bank_account_code: "091", amount: "10.00", date: "2026-10-01" });
    expect(ok.issues).toEqual([]);
    expect(ok.payload.BankTransfers[0]).toMatchObject({ Amount: 10, FromBankAccount: { Code: "090" }, ToBankAccount: { Code: "091" } });
  });
});

describe("settings", () => {
  it("refuses bank accounts, protected account fields and tracked inventory", () => {
    expect(settingRequest("account_create", { Code: "1", Name: "x", Type: "BANK" }, NOTE).issues[0]).toMatch(/bank accounts/);
    expect(settingRequest("account_update", { AccountID: ID, Code: "2" }, NOTE).issues[0]).toMatch(/cannot change Code/);
    expect(settingRequest("item", { Code: "I1", IsTrackedAsInventory: true }, NOTE).issues[0]).toMatch(/tracked inventory/);
    expect(settingRequest("archive_account", {}, NOTE).issues[0]).toMatch(/kind must be one of/);
  });

  it("puts the path id in the path and the members in an envelope", () => {
    const r = settingRequest("contact_group_members", { ContactGroupID: ID, ContactIDs: [ID2] }, NOTE);
    expect(r.issues).toEqual([]);
    expect(r).toMatchObject({ method: "PUT", path: `ContactGroups/${ID}/Contacts`, payload: { Contacts: [{ ContactID: ID2 }] } });
    const o = settingRequest("tracking_option", { TrackingCategoryID: ID, Name: "Ops" }, NOTE);
    expect(o).toMatchObject({ path: `TrackingCategories/${ID}/Options`, payload: { Options: [{ Name: "Ops" }] } });
  });

  it("sends rates and prices as exact numbers", () => {
    const t = settingRequest("tax_rate", { Name: "R", ReportTaxType: "INPUT", TaxComponents: [{ Name: "VAT", Rate: "12.5" }] }, NOTE);
    expect(t.payload.TaxRates[0].TaxComponents[0].Rate).toBe(12.5);
    expect(settingRequest("item", { Code: "I", SalesDetails: { UnitPrice: 9.99 } }, NOTE).issues[0]).toMatch(/float/);
  });

  it("checks codes against the chart", () => {
    const accounts = [{ Code: "400", Status: "ACTIVE" }, { Code: "401", Status: "ARCHIVED" }];
    expect(settingChartIssues("account_create", { Code: "400" }, accounts)[0]).toMatch(/already exists/);
    expect(settingChartIssues("item", { SalesDetails: { AccountCode: "401" } }, accounts)[0]).toMatch(/not an active account/);
  });
});

describe("repeating invoices, fixed assets and conversion", () => {
  it("refuses repeating bills, which Xero's API cannot create", () => {
    const sched = { Unit: "MONTHLY", Period: 1, StartDate: "2026-11-01" };
    expect(repeatingInvoiceRequest({ ...NOTE, type: "ACCPAY", contact_id: ID, schedule: sched }).issues[0]).toMatch(/cannot create repeating bill/);
    expect(repeatingInvoiceRequest({ ...NOTE, type: "ACCREC", contact_id: ID, schedule: sched }).issues).toEqual([]);
    expect(repeatingInvoiceRequest({ ...NOTE, type: "ACCREC", contact_id: ID, schedule: { ...sched, Period: 0 } }).issues[0]).toMatch(/Period/);
  });

  it("registers assets as Draft unless told otherwise", () => {
    const r = fixedAssetRequest("asset", { assetName: "Laptop", purchaseDate: "2026-10-01", purchasePrice: "999.00" }, NOTE);
    expect(r.issues).toEqual([]);
    expect(r.payload).toMatchObject({ assetStatus: "Draft", purchasePrice: 999 });
    expect(fixedAssetRequest("asset", { assetName: "x", purchaseDate: "2026-10-01", assetStatus: "Disposed" }, NOTE).issues[0]).toMatch(/Draft or Registered/);
    expect(fixedAssetRequest("disposal", {}, NOTE).issues[0]).toMatch(/asset or asset_type/);
  });

  it("requires conversion balances to net to exactly zero", () => {
    const ok = conversionRequest({ ...NOTE, conversion_month: 1, conversion_year: 2026, conversion_balances: [{ account_code: "090", balance: "100.10" }, { account_code: "300", balance: "-100.10" }] });
    expect(ok.issues).toEqual([]);
    expect(ok.payload).toEqual({ ConversionDate: { Month: 1, Year: 2026 }, ConversionBalances: [{ AccountCode: "090", Balance: 100.1 }, { AccountCode: "300", Balance: -100.1 }] });
    const off = conversionRequest({ ...NOTE, conversion_month: 13, conversion_year: 2026, conversion_balances: [{ account_code: "090", balance: "0.01" }] });
    expect(off.issues).toEqual(expect.arrayContaining([expect.stringMatching(/1 to 12/), expect.stringMatching(/net to 0.01/)]));
  });
});

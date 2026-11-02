import { describe, expect, it } from "vitest";
import {
  buildActivity, fetchDocuments, netLinePence, toBase, tbBalance, isDate, dayBefore, SIDE,
} from "./account-activity";

// ── Fixtures: Sample Ltd, Prepayments 620 ────────────────────────────────────

const PREPAY = { AccountID: "acc-620", Code: "620", Name: "Prepayments", Type: "CURRASSET", Class: "ASSET" };
const DEFERRED = { AccountID: "acc-835", Code: "835", Name: "Deferred income", Type: "CURRLIAB", Class: "LIABILITY" };

// A Xero TrialBalance report with one row per [AccountID, code, name, ytdDebit, ytdCredit].
function tb(rows) {
  return {
    Rows: [
      { RowType: "Header", Cells: [{ Value: "Account" }, { Value: "Debit" }, { Value: "Credit" }, { Value: "YTD Debit" }, { Value: "YTD Credit" }] },
      {
        RowType: "Section",
        Rows: rows.map(([id, code, name, ydr, ycr]) => ({
          RowType: "Row",
          Cells: [
            { Value: `${name} (${code})`, Attributes: id ? [{ Id: "account", Value: id }] : [] },
            { Value: "0.00" }, { Value: "0.00" }, { Value: String(ydr) }, { Value: String(ycr) },
          ],
        })),
      },
    ],
  };
}

const line = (code, amount, extra = {}) => ({ AccountCode: code, LineAmount: amount, TaxAmount: 0, Description: `line ${code}`, ...extra });

const bill = (over = {}) => ({
  InvoiceID: "inv-1", Type: "ACCPAY", InvoiceNumber: "B-001", Contact: { Name: "Sample Supplier Ltd" },
  DateString: "2026-09-10T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive", CurrencyRate: 1,
  LineItems: [line("620", 1200, { TaxAmount: 240 }), line("400", 50, { TaxAmount: 10 })],
  ...over,
});

const docs = {
  invoices: [
    bill(),
    // Inclusive: 600 gross with 100 VAT puts 500 on the account.
    bill({ InvoiceID: "inv-2", InvoiceNumber: "B-002", LineAmountTypes: "Inclusive", DateString: "2026-09-15T00:00:00", LineItems: [line("620", 600, { TaxAmount: 100 })] }),
    // Paid counts as posted.
    bill({ InvoiceID: "inv-3", InvoiceNumber: "B-003", Status: "PAID", LineAmountTypes: "NoTax", LineItems: [line("620", 300)] }),
    // A draft has not posted.
    bill({ InvoiceID: "inv-4", InvoiceNumber: "B-004", Status: "DRAFT", LineItems: [line("620", 999)] }),
    bill({ InvoiceID: "inv-5", InvoiceNumber: "B-005", Status: "SUBMITTED", LineItems: [line("620", 1)] }),
    // Voided and deleted are ignored entirely.
    bill({ InvoiceID: "inv-6", InvoiceNumber: "B-006", Status: "VOIDED", LineItems: [line("620", 5000)] }),
    bill({ InvoiceID: "inv-7", InvoiceNumber: "B-007", Status: "DELETED", LineItems: [line("620", 5000)] }),
    // Outside the dates: left to the opening trial balance.
    bill({ InvoiceID: "inv-8", InvoiceNumber: "B-008", DateString: "2026-08-31T00:00:00", LineItems: [line("620", 7000)] }),
    // A sales invoice coded to the account credits it.
    { InvoiceID: "inv-9", Type: "ACCREC", InvoiceNumber: "INV-100", Contact: { Name: "Sample Customer" }, DateString: "2026-09-20T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive", LineItems: [line("620", 80)] },
  ],
  creditNotes: [
    // Supplier credit reverses a bill: credit.
    { CreditNoteID: "cn-1", Type: "ACCPAYCREDIT", CreditNoteNumber: "CN-1", Contact: { Name: "Sample Supplier Ltd" }, DateString: "2026-09-25T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive", LineItems: [line("620", 200, { TaxAmount: 40 })] },
    { CreditNoteID: "cn-2", Type: "ACCPAYCREDIT", CreditNoteNumber: "CN-2", DateString: "2026-09-25T00:00:00", Status: "VOIDED", LineAmountTypes: "Exclusive", LineItems: [line("620", 900)] },
  ],
  bankTransactions: [
    // Spend money straight to the account: debit. The case FM1 used to miss.
    { BankTransactionID: "bt-1", Type: "SPEND", Reference: "Card", Contact: { Name: "Sample Insurer" }, DateString: "2026-09-05T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Inclusive", LineItems: [line("620", 1200, { TaxAmount: 0 })] },
    { BankTransactionID: "bt-2", Type: "RECEIVE", Reference: "Refund", DateString: "2026-09-28T00:00:00", Status: "AUTHORISED", LineAmountTypes: "NoTax", LineItems: [line("620", 150)] },
    { BankTransactionID: "bt-3", Type: "SPEND", Reference: "Gone", DateString: "2026-09-06T00:00:00", Status: "DELETED", LineAmountTypes: "NoTax", LineItems: [line("620", 4000)] },
    { BankTransactionID: "bt-4", Type: "SPEND-PREPAYMENT", Reference: "Deposit", DateString: "2026-09-07T00:00:00", Status: "AUTHORISED", LineAmountTypes: "NoTax", LineItems: [line("620", 250)] },
  ],
  manualJournals: [
    // The monthly release: credit 620 (negative LineAmount), debit the expense.
    { ManualJournalID: "mj-1", Narration: "Prepayment release Sep", DateString: "2026-09-30T00:00:00", Status: "POSTED", LineAmountTypes: "NoTax", JournalLines: [line("620", -400), line("460", 400)] },
    { ManualJournalID: "mj-2", Narration: "Draft release", DateString: "2026-09-30T00:00:00", Status: "DRAFT", LineAmountTypes: "NoTax", JournalLines: [line("620", -100), line("460", 100)] },
    { ManualJournalID: "mj-3", Narration: "Voided", DateString: "2026-09-30T00:00:00", Status: "VOIDED", LineAmountTypes: "NoTax", JournalLines: [line("620", -3000), line("460", 3000)] },
  ],
};

// Posted movement on 620:
//   bills +1200 +500 +300, sales invoice -80, supplier credit -200,
//   spend +1200, receive -150, spend prepayment +250, journal -400
//   debits 3450, credits 830, net +2620
const OPENING = 1000;
const CLOSING = OPENING + 2620;

function run(over = {}) {
  return buildActivity({
    account: PREPAY, from: "2026-09-01", to: "2026-09-30", documents: docs,
    openingTb: tb([["acc-620", "620", "Prepayments", OPENING, 0]]),
    closingTb: tb([["acc-620", "620", "Prepayments", CLOSING, 0]]),
    fetch: { complete: true, read: 18, cap: 2000, incomplete: [] },
    ...over,
  });
}

// ── Amounts ──────────────────────────────────────────────────────────────────

describe("line amounts", () => {
  it("takes VAT out of inclusive amounts and leaves exclusive and no-tax alone", () => {
    expect(netLinePence(120, 20, "Inclusive")).toBe(10000);
    expect(netLinePence(100, 20, "Exclusive")).toBe(10000);
    expect(netLinePence(100, 0, "NoTax")).toBe(10000);
    expect(netLinePence("1,234.56", 0, "Exclusive")).toBe(123456);
  });

  it("keeps a negative inclusive line negative, whatever sign Xero gives its VAT", () => {
    expect(netLinePence(-120, -20, "Inclusive")).toBe(-10000);
    expect(netLinePence(-120, 20, "Inclusive")).toBe(-10000);
  });

  it("converts a foreign-currency line to base at the document's rate", () => {
    expect(toBase(11500, 1.15)).toBe(10000);
    expect(toBase(10000, 1)).toBe(10000);
    expect(toBase(10000, undefined)).toBe(10000);
    expect(toBase(10000, 0)).toBe(10000);
  });

  it("puts each document type on the side it posts to", () => {
    expect(SIDE).toEqual({
      ACCPAY: 1, ACCREC: -1, ACCPAYCREDIT: -1, ACCRECCREDIT: 1,
      SPEND: 1, "SPEND-PREPAYMENT": 1, "SPEND-OVERPAYMENT": 1,
      RECEIVE: -1, "RECEIVE-PREPAYMENT": -1, "RECEIVE-OVERPAYMENT": -1,
    });
  });
});

// ── The rebuild ──────────────────────────────────────────────────────────────

describe("rebuilding an account from its documents", () => {
  it("lists every posted line on the account, by date, with the right side", () => {
    const r = run();
    const got = r.lines.map((l) => [l.id, l.debit, l.credit]);
    expect(got).toEqual([
      ["bt-1", 1200, 0],
      ["bt-4", 250, 0],
      ["inv-1", 1200, 0],
      ["inv-3", 300, 0],
      ["inv-2", 500, 0],
      ["inv-9", 0, 80],
      ["cn-1", 0, 200],
      ["bt-2", 0, 150],
      ["mj-1", 0, 400],
    ]);
    expect(r.lines.find((l) => l.id === "inv-1")).toMatchObject({
      date: "2026-09-10", source: "bill", number_or_ref: "B-001", contact: "Sample Supplier Ltd", status: "AUTHORISED",
    });
    expect(r.lines.find((l) => l.id === "bt-4").source).toBe("bank_spend_prepayment");
    expect(r.lines.find((l) => l.id === "cn-1").source).toBe("supplier_credit_note");
  });

  it("ignores lines on other accounts", () => {
    expect(run().lines.some((l) => l.description === "line 400" || l.description === "line 460")).toBe(false);
  });

  it("drops voided, deleted and out-of-range documents", () => {
    const ids = run().lines.map((l) => l.id);
    for (const id of ["inv-6", "inv-7", "inv-8", "cn-2", "bt-3", "mj-3"]) expect(ids).not.toContain(id);
  });

  it("lists drafts and submitted documents separately, outside the totals", () => {
    const r = run();
    expect(r.not_posted.map((l) => [l.id, l.status, l.debit, l.credit])).toEqual([
      ["inv-4", "DRAFT", 999, 0],
      ["inv-5", "SUBMITTED", 1, 0],
      ["mj-2", "DRAFT", 0, 100],
    ]);
    expect(r.not_posted_total).toBe(900);
    expect(r.note).toMatch(/3 line\(s\) on draft or submitted/);
  });

  it("agrees opening plus posted movement to the closing trial balance", () => {
    const r = run();
    expect(r.posted_total).toEqual({ debit: 3450, credit: 830, net: 2620 });
    expect(r.opening_from_tb).toBe(1000);
    expect(r.closing_from_tb).toBe(3620);
    expect(r.rebuilt_closing).toBe(3620);
    expect(r.unexplained).toBe(0);
    expect(r.opening_date).toBe("2026-08-31");
    expect(r.note).toMatch(/explain the whole movement/);
    expect(r.note).toMatch(/quote these totals/);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("reports what the documents cannot explain, and why that can happen", () => {
    const r = run({ closingTb: tb([["acc-620", "620", "Prepayments", CLOSING + 55.5, 0]]) });
    expect(r.unexplained).toBe(55.5);
    expect(r.note).toMatch(/55\.50 more debit/);
    for (const s of [/conversion/, /depreciation/, /revaluation/, /outside|before the start date/]) expect(r.note).toMatch(s);
    const credit = run({ closingTb: tb([["acc-620", "620", "Prepayments", CLOSING - 10, 0]]) });
    expect(credit.unexplained).toBe(-10);
    expect(credit.note).toMatch(/10\.00 more credit/);
  });

  it("converts a foreign-currency bill line to the base currency", () => {
    const usd = bill({ InvoiceID: "inv-usd", CurrencyRate: 1.25, LineItems: [line("620", 1000)] });
    const r = run({ documents: { invoices: [usd] }, openingTb: tb([["acc-620", "620", "Prepayments", 0, 0]]), closingTb: tb([["acc-620", "620", "Prepayments", 800, 0]]) });
    expect(r.lines[0].debit).toBe(800);
    expect(r.unexplained).toBe(0);
  });

  it("treats a negative line on a bill as a credit", () => {
    const r = run({ documents: { invoices: [bill({ LineItems: [line("620", 1000), line("620", -100)] })] } });
    expect(r.posted_total).toEqual({ debit: 1000, credit: 100, net: 900 });
  });

  it("matches the account code regardless of case and spacing", () => {
    const acct = { ...PREPAY, Code: "PRE1" };
    const r = run({ account: acct, documents: { invoices: [bill({ LineItems: [line(" pre1 ", 10)] })] } });
    expect(r.lines).toHaveLength(1);
  });

  it("works for a sales-side account: invoices credit it and customer credit notes debit it", () => {
    const sales = {
      invoices: [
        { InvoiceID: "s-1", Type: "ACCREC", InvoiceNumber: "INV-1", DateString: "2026-09-01T00:00:00", Status: "PAID", LineAmountTypes: "Exclusive", LineItems: [line("835", 6000, { TaxAmount: 1200 })] },
        { InvoiceID: "s-2", Type: "ACCREC", InvoiceNumber: "INV-2", DateString: "2026-09-02T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Inclusive", LineItems: [line("835", 1200, { TaxAmount: 200 })] },
      ],
      creditNotes: [
        { CreditNoteID: "sc-1", Type: "ACCRECCREDIT", CreditNoteNumber: "CN-9", DateString: "2026-09-03T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive", LineItems: [line("835", 500, { TaxAmount: 100 })] },
      ],
      bankTransactions: [
        { BankTransactionID: "r-1", Type: "RECEIVE-PREPAYMENT", DateString: "2026-09-04T00:00:00", Status: "AUTHORISED", LineAmountTypes: "NoTax", LineItems: [line("835", 300)] },
      ],
      manualJournals: [
        // Release to revenue: debit deferred income.
        { ManualJournalID: "j-1", Narration: "Release", DateString: "2026-09-30T00:00:00", Status: "POSTED", LineAmountTypes: "NoTax", JournalLines: [line("835", 1000), line("200", -1000)] },
      ],
    };
    // Credit balance of 2000 opening; credits 6000 + 1000 + 300, debits 500 + 1000 => net credit 5800.
    const r = buildActivity({
      account: DEFERRED, from: "2026-09-01", to: "2026-09-30", documents: sales,
      openingTb: tb([["acc-835", "835", "Deferred income", 0, 2000]]),
      closingTb: tb([["acc-835", "835", "Deferred income", 0, 7800]]),
    });
    expect(r.posted_total).toEqual({ debit: 1500, credit: 7300, net: -5800 });
    expect(r.opening_from_tb).toBe(-2000);
    expect(r.closing_from_tb).toBe(-7800);
    expect(r.rebuilt_closing).toBe(-7800);
    expect(r.unexplained).toBe(0);
    expect(r.lines.find((l) => l.id === "sc-1")).toMatchObject({ debit: 500, credit: 0, source: "sales_credit_note" });
    expect(r.lines.find((l) => l.id === "s-2")).toMatchObject({ debit: 0, credit: 1000, source: "sales_invoice" });
  });

  it("applies an inclusive manual journal's VAT", () => {
    const mj = { ManualJournalID: "mj-vat", Narration: "Incl", DateString: "2026-09-10T00:00:00", Status: "POSTED", LineAmountTypes: "Inclusive", JournalLines: [line("620", 120, { TaxAmount: 20 })] };
    expect(run({ documents: { manualJournals: [mj] } }).posted_total.net).toBe(100);
  });

  it("reads Xero's /Date(...)/ form when the date string is missing", () => {
    const d = bill({ DateString: undefined, Date: `/Date(${Date.UTC(2026, 8, 12)}+0000)/` });
    expect(run({ documents: { invoices: [d] } }).lines[0].date).toBe("2026-09-12");
  });

  it("warns, and does not guess, when a trial balance came back empty", () => {
    const r = run({ openingTb: { Rows: [] } });
    expect(r.opening_from_tb).toBeNull();
    expect(r.rebuilt_closing).toBeNull();
    expect(r.unexplained).toBeNull();
    expect(r.warnings[0]).toMatch(/no rows at 2026-08-31/);
  });

  it("warns on accounts Xero posts to itself and on profit and loss accounts", () => {
    expect(run({ account: { ...PREPAY, Type: "BANK" } }).warnings.join(" ")).toMatch(/Xero posts to this account itself/);
    expect(run({ account: { ...PREPAY, SystemAccount: "CREDITORS" } }).warnings.join(" ")).toMatch(/Xero posts to this account itself/);
    expect(run({ account: { ...PREPAY, Class: "EXPENSE" } }).warnings.join(" ")).toMatch(/same financial year/);
  });

  it("says so when the document cap was hit", () => {
    const r = run({ fetch: { complete: false, read: 2000, cap: 2000, incomplete: ["invoices and bills"] } });
    expect(r.complete).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/cap of 2000[\s\S]*invoices and bills[\s\S]*do not rely/);
  });
});

// ── Trial balance ────────────────────────────────────────────────────────────

describe("the trial balance figure", () => {
  it("finds the account by id, falls back to the code in the name, and reads absence as nil", () => {
    expect(tbBalance(tb([["acc-620", "620", "Prepayments", "1,500.25", "0.25"]]), PREPAY)).toBe(150000);
    expect(tbBalance(tb([[null, "620", "Prepayments", 10, 0]]), PREPAY)).toBe(1000);
    expect(tbBalance(tb([["acc-999", "999", "Other", 10, 0]]), PREPAY)).toBe(0);
    expect(tbBalance({ Rows: [] }, PREPAY)).toBeNull();
    expect(tbBalance(undefined, PREPAY)).toBeNull();
  });
});

describe("dates", () => {
  it("validates and steps back a day across month and year ends", () => {
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-9-1")).toBe(false);
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });
});

// ── Fetching ─────────────────────────────────────────────────────────────────

describe("fetching the documents", () => {
  const page = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

  it("pages each source one call at a time, filtered by date, with line items", async () => {
    const calls = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const get = async (path, params) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push([path, params.page, params.where, params.summaryOnly]);
      await Promise.resolve();
      inFlight--;
      if (path === "/Invoices") return { Invoices: params.page === "1" ? page(100, "i") : page(3, "j") };
      if (path === "/ManualJournals") return { ManualJournals: page(2, "m") };
      return {};
    };
    const r = await fetchDocuments({ get, from: "2026-09-01", to: "2026-09-30" });
    expect(maxInFlight).toBe(1);
    expect(calls.map((c) => `${c[0]}#${c[1]}`)).toEqual(["/ManualJournals#1", "/CreditNotes#1", "/BankTransactions#1", "/Invoices#1", "/Invoices#2"]);
    expect(calls[0][2]).toBe("Date>=DateTime(2026,9,1) AND Date<=DateTime(2026,9,30)");
    expect(calls.every((c) => c[3] === undefined)).toBe(true);
    expect(r.documents.invoices).toHaveLength(103);
    expect(r.documents.manualJournals).toHaveLength(2);
    expect(r.fetch).toEqual({ complete: true, read: 105, cap: 2000, incomplete: [] });
  });

  it("stops at the cap and names what was not fully read", async () => {
    const get = async (path) => {
      const key = { "/ManualJournals": "ManualJournals", "/CreditNotes": "CreditNotes", "/BankTransactions": "BankTransactions", "/Invoices": "Invoices" }[path];
      return { [key]: page(100, key) };
    };
    const r = await fetchDocuments({ get, from: "2026-09-01", to: "2026-09-30", cap: 250 });
    expect(r.fetch.complete).toBe(false);
    expect(r.fetch.read).toBe(250);
    expect(r.fetch.incomplete).toEqual(["manual journals", "credit notes", "bank transactions", "invoices and bills"]);
  });

  it("marks a source incomplete when the cap cuts a short page", async () => {
    const get = async (path) => (path === "/ManualJournals" ? { ManualJournals: page(40, "m") } : {});
    const r = await fetchDocuments({ get, from: "2026-09-01", to: "2026-09-30", cap: 30 });
    expect(r.documents.manualJournals).toHaveLength(30);
    expect(r.fetch.incomplete[0]).toBe("manual journals");
  });
});

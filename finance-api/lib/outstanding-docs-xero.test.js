import { describe, expect, it } from "vitest";
import { dateWhere, monthRange, checkWindow, day, fromBankTransaction, fromPayment, matchItems, matchOutcome, scanMonth } from "./outstanding-docs-xero";
import { agentOutstandingDocs, ROLES } from "./agent-outstanding-docs";

const bt = (o) => ({ BankTransactionID: "bt-1", Type: "SPEND", Status: "AUTHORISED", DateString: "2026-09-30T00:00:00", Total: 690, CurrencyCode: "GBP", BankAccount: { Name: "Main account" }, Contact: { Name: "Supplier A" }, HasAttachments: false, IsReconciled: true, ...o });
const item = (o) => ({ id: "i-1", txn_date: "2026-09-30", direction: "spent", amount: 690, currency: "GBP", bank_account: "Main account", payee: "Supplier A", xero_id: null, ...o });

describe("dates", () => {
  it("reads Xero dates, writes where clauses, and finds the month", () => {
    expect(day("2026-09-30T00:00:00")).toBe("2026-09-30");
    expect(day("/Date(1790726400000+0000)/")).toBe("2026-09-30");
    expect(dateWhere("2026-09-01", "2026-09-30")).toBe("Date >= DateTime(2026,9,1) AND Date <= DateTime(2026,9,30)");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-13")).toBe(null);
  });

  it("reads Xero from 3 days before the oldest item to 3 after the newest, never past today", () => {
    expect(checkWindow([item({ txn_date: "2026-09-04" }), item({ txn_date: "2026-11-09" })], "2026-11-10")).toEqual({ from: "2026-09-01", to: "2026-11-10" });
    expect(checkWindow([], "2026-11-10")).toBe(null);
  });
});

describe("Xero records", () => {
  it("takes spend and receive money, never transfers or deleted ones", () => {
    expect(fromBankTransaction(bt()).direction).toBe("spent");
    expect(fromBankTransaction(bt({ Type: "RECEIVE" })).direction).toBe("received");
    expect(fromBankTransaction(bt({ Type: "SPEND-TRANSFER" }))).toBe(null);
    expect(fromBankTransaction(bt({ Status: "DELETED" }))).toBe(null);
    expect(fromBankTransaction(bt({ Reference: "R1" })).label).toBe("spend money R1");
  });

  it("takes payments on bills and invoices, pointing at the invoice", () => {
    const p = fromPayment({ PaymentID: "p-1", Status: "AUTHORISED", DateString: "2026-10-01T00:00:00", Amount: 120, Invoice: { InvoiceID: "inv-1", InvoiceNumber: "B-9", Type: "ACCPAY", CurrencyCode: "GBP" } });
    expect(p).toMatchObject({ kind: "payment", invoice_id: "inv-1", direction: "spent", label: "bill B-9" });
    expect(fromPayment({ PaymentID: "p-2", Invoice: { Type: "ACCREC", InvoiceID: "inv-2" } }).direction).toBe("received");
    expect(fromPayment({ PaymentID: "p-3" })).toBe(null);
  });
});

describe("matchItems", () => {
  const recs = (list) => list.map(fromBankTransaction);

  it("matches same direction, amount and currency within 3 days", () => {
    const m = matchItems([item()], recs([bt({ DateString: "2026-10-02T00:00:00" })]));
    expect(m.map((x) => x.record.id)).toEqual(["bt-1"]);
    expect(matchItems([item()], recs([bt({ DateString: "2026-10-04T00:00:00" })]))).toEqual([]);
    expect(matchItems([item()], recs([bt({ Total: 690.01 })]))).toEqual([]);
    expect(matchItems([item()], recs([bt({ Type: "RECEIVE" })]))).toEqual([]);
    expect(matchItems([item({ currency: "USD" })], recs([bt()]))).toEqual([]);
  });

  it("pairs identical charges one to one", () => {
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    const m = matchItems(items, recs([bt({ BankTransactionID: "x" }), bt({ BankTransactionID: "y" })]));
    expect(m).toHaveLength(2);
    expect(new Set(m.map((x) => x.record.id))).toEqual(new Set(["x", "y"]));
    expect(new Set(m.map((x) => x.item_id)).size).toBe(2);
  });

  it("prefers the same bank account, then the closest date", () => {
    const m = matchItems([item()], recs([
      bt({ BankTransactionID: "far", DateString: "2026-10-02T00:00:00" }),
      bt({ BankTransactionID: "other-bank", BankAccount: { Name: "Card" } }),
      bt({ BankTransactionID: "near", DateString: "2026-10-01T00:00:00" }),
    ]));
    expect(m[0].record.id).toBe("near");
  });

  it("keeps an earlier match while Xero still has it", () => {
    const m = matchItems([item({ xero_id: "kept", txn_date: "2026-09-01" })], recs([bt({ BankTransactionID: "kept", DateString: "2026-09-20T00:00:00" }), bt({ BankTransactionID: "new", DateString: "2026-09-01T00:00:00" })]));
    expect(m[0].record.id).toBe("kept");
  });

  it("clears only on an attachment", () => {
    expect(matchOutcome(fromBankTransaction(bt({ HasAttachments: true, Reference: "R1" })))).toEqual({ clear: true, reason: "Attachment found in Xero on the spend money R1 (2026-09-30)." });
    expect(matchOutcome(fromBankTransaction(bt())).clear).toBe(false);
  });
});

describe("scanMonth", () => {
  const range = { from: "2026-09-01", to: "2026-09-30" };
  const entity = { id: "e-1" };
  const bill = (o) => ({ InvoiceID: "b-1", Type: "ACCPAY", Status: "AUTHORISED", DateString: "2026-09-12T00:00:00", Total: 300, CurrencyCode: "GBP", Contact: { Name: "Printer Ltd" }, InvoiceNumber: "P-1", HasAttachments: false, ...o });

  it("adds spend money and bills with no attachment above the threshold", () => {
    const lines = scanMonth({ bankTransactions: [bt(), bt({ BankTransactionID: "small", Total: 25 }), bt({ BankTransactionID: "att", HasAttachments: true })], bills: [bill(), bill({ InvoiceID: "draft", Status: "DRAFT" }), bill({ InvoiceID: "att", HasAttachments: true })], range, threshold: 25, entity });
    expect(lines.map((l) => l.xero_id)).toEqual(["bt-1", "b-1"]);
    expect(lines[0]).toMatchObject({ payee: "Supplier A", concern: "no_vat_invoice", xero_type: "bank_transaction", entity_id: "e-1" });
    expect(lines[1]).toMatchObject({ payee: "Printer Ltd", reference: "P-1", xero_type: "bill" });
  });

  it("leaves out what the register holds, and marks a repeat of a held item", () => {
    const held = [{ ...item(), id: "h-1", state: "open", xero_id: "bt-1" }, { id: "h-2", state: "open", txn_date: "2026-09-12", direction: "spent", amount: 300, currency: "GBP", payee: "Printer Ltd" }];
    const lines = scanMonth({ bankTransactions: [bt()], bills: [bill()], range, threshold: 25, held, entity });
    expect(lines.map((l) => [l.xero_id, l.duplicate_of])).toEqual([["b-1", "h-2"]]);
  });

  it("keeps foreign currency lines whatever their size, marked overseas", () => {
    const lines = scanMonth({ bankTransactions: [bt({ CurrencyCode: "USD", Total: 10 })], range, threshold: 25, entity });
    expect(lines[0]).toMatchObject({ currency: "USD", concern: "overseas_reverse_charge" });
  });

  it("only the month", () => {
    expect(scanMonth({ bankTransactions: [bt({ DateString: "2026-10-01T00:00:00" })], range, threshold: 25, entity })).toEqual([]);
  });
});

describe("agent tools", () => {
  it("are FM1's and the FC's only", () => {
    const t = agentOutstandingDocs({});
    expect(ROLES).toEqual(["fm1", "fc"]);
    expect(t.tools(["a"], "fm1").map((x) => x.name)).toEqual(["list_outstanding_documents", "check_outstanding_documents_in_xero", "note_outstanding_document"]);
    expect(t.tools(["a"], "ap-clerk")).toEqual([]);
  });

  it("send the check as the agent's run, and refuse a bad month", async () => {
    const sent = [];
    const t = agentOutstandingDocs({
      apiCall: async () => ({ items: [{ id: "x", state: "open", entity_slug: "a" }, { id: "y", state: "candidate" }], summary: {} }),
      apiRequest: async (method, path, body, headers) => { sent.push({ method, path, body, headers }); return { ok: true, body: { month: "2026-10", companies: [] } }; },
      requesterOf: async () => "cfo@example.com",
    });
    const job = { id: "run-1", agent: "fm1", client: { slug: "sample" } };
    expect((await t.call(job, "list_outstanding_documents", {})).items.map((i) => i.id)).toEqual(["x"]);
    expect((await t.call(job, "check_outstanding_documents_in_xero", { month: "Oct" })).error).toMatch(/YYYY-MM/);
    const r = await t.call(job, "check_outstanding_documents_in_xero", { month: "2026-10" });
    expect(r.done).toBe(true);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/api/finance/clients/sample/outstanding-documents/xero-check", body: { month: "2026-10" }, headers: { "X-Actor-Email": "cfo@example.com", "X-Work-Via": "agent:fm1:run-1" } });
  });
});

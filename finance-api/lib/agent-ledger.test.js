import { describe, expect, it } from "vitest";
import { agentLedger, invoiceView, organisationView, where, dt } from "./agent-ledger";

const job = { id: "run-1", agent: "fm1", client: { slug: "acme" } };
const INV = "00000000-0000-4000-8000-0000000000a1";

function stub(answer) {
  const calls = [];
  const ledger = agentLedger({ apiCall: async (method, p) => { calls.push(p); return answer(p); } });
  return { ledger, calls };
}

const invoice = (n) => ({ InvoiceID: `id-${n}`, Type: "ACCPAY", InvoiceNumber: `B-${n}`, Contact: { Name: "Jo Bloggs Ltd" }, DateString: "2026-09-30T00:00:00", Status: "AUTHORISED", Total: 120, TotalTax: 20, AmountDue: 120 });

describe("agent ledger reads", () => {
  it("builds Xero where clauses from the filters", () => {
    expect(dt("2026-09-01")).toBe("DateTime(2026,9,1)");
    expect(where('Type=="ACCPAY"', null, "Date>=DateTime(2026,9,1)")).toBe('Type=="ACCPAY" AND Date>=DateTime(2026,9,1)');
    expect(where(null)).toBeUndefined();
  });

  it("reads through finance-api's read routes with the filters", async () => {
    const { ledger, calls } = stub(() => ({ data: { Invoices: [invoice(1)] } }));
    const r = await ledger.call(job, "get_invoices", { entity: "acme-ltd", invoice_type: "ACCPAY", from_date: "2026-09-01" });
    expect(r).toMatchObject({ count: 1, complete: true });
    expect(r.items[0]).toMatchObject({ number: "B-1", contact: "Jo Bloggs Ltd", date: "2026-09-30", total: 120 });
    expect(decodeURIComponent(calls[0])).toContain('/api/finance/clients/acme/xero/acme-ltd/read/invoices?where=Type=="ACCPAY"+AND+Date>=DateTime(2026,9,1)');
  });

  it("stops at the cap and says the list is partial", async () => {
    const { ledger, calls } = stub(() => ({ data: { Invoices: Array.from({ length: 100 }, (_, i) => invoice(i)) } }));
    const r = await ledger.call(job, "get_invoices", { entity: "acme-ltd", max_items: 150 });
    expect(r.count).toBe(150);
    expect(r.complete).toBe(false);
    expect(r.note).toMatch(/partial/);
    expect(calls).toHaveLength(2);
  });

  it("refuses ids and dates that did not come from a tool", async () => {
    const { ledger, calls } = stub(() => ({}));
    expect((await ledger.call(job, "get_invoice", { entity: "acme-ltd", invoice_id: "../../tasks" })).error).toMatch(/id/);
    expect((await ledger.call(job, "get_payments", { entity: "acme-ltd", from_date: "30/09/2026" })).error).toMatch(/YYYY-MM-DD/);
    expect((await ledger.call(job, "list_attachments", { entity: "acme-ltd", record_type: "payment", record_id: INV })).error).toMatch(/not kept/);
    expect(calls).toHaveLength(0);
  });

  it("opens a history by record type", async () => {
    const { ledger, calls } = stub(() => ({ data: { HistoryRecords: [{ DateUTCString: "2026-10-01T09:00:00", User: "Jo Bloggs", Changes: "Edited", Details: "Line 1 account changed" }] } }));
    const r = await ledger.call(job, "get_history", { entity: "acme-ltd", record_type: "invoice", record_id: INV });
    expect(r.history[0]).toMatchObject({ who: "Jo Bloggs", change: "Edited" });
    expect(calls[0]).toBe(`/api/finance/clients/acme/xero/acme-ltd/read/invoices/${INV}/history`);
  });

  it("shows an invoice's lines and Xero's /Date() dates as days", () => {
    const v = invoiceView({ ...invoice(1), LineItems: [{ Description: "Hosting", LineAmount: 100, AccountCode: "429", TaxType: "INPUT2" }],
      Payments: [{ PaymentID: "p1", Date: "/Date(1788134400000+0000)/", Amount: 120 }] });
    expect(v.lines[0]).toMatchObject({ description: "Hosting", account_code: "429", tax_type: "INPUT2" });
    expect(v.payments[0].date).toBe("2026-08-31");
  });

  it("reports VAT registration from the organisation", () => {
    expect(organisationView({ Name: "Acme", PaysTax: false, FinancialYearEndDay: 31, FinancialYearEndMonth: 12 }))
      .toMatchObject({ vat_registered: false, financial_year_end: "31/12" });
  });
});

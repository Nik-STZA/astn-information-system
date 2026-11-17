import { describe, expect, it, vi } from "vitest";
const { agentContracts } = require("./agent-contracts");
const { billingFromInvoice } = require("./contracts");

const inv = (over = {}) => ({ Type: "ACCREC", Status: "AUTHORISED", InvoiceNumber: "INV-0003", DateString: "2026-09-03T00:00:00", LineAmountTypes: "Exclusive",
  LineItems: [{ AccountCode: "810", LineAmount: 200000, TaxAmount: 40000 }, { AccountCode: "810", LineAmount: 50000, TaxAmount: 10000 }, { AccountCode: "200", LineAmount: 99 }], ...over });

describe("a billing read from its Xero sales invoice", () => {
  it("is the net of the invoice's lines on the contract's account, on the invoice date", () => {
    const { set, issues } = billingFromInvoice(inv(), "810");
    expect(issues).toEqual([]);
    expect(set).toMatchObject({ kind: "billed", on_date: "2026-09-03", amount: 250000, ref: "INV-0003" });
    expect(set.note).toMatch(/2 lines on 810, net of VAT/);
  });
  it("takes the VAT out of a tax-inclusive invoice", () => {
    expect(billingFromInvoice(inv({ LineAmountTypes: "Inclusive" }), "810").set.amount).toBe(200000);
  });
  it("refuses a draft, a bill, an invoice with nothing on the account, or none at all", () => {
    expect(billingFromInvoice(inv({ Status: "DRAFT" }), "810").issues[0]).toMatch(/draft in Xero, not approved/);
    expect(billingFromInvoice(inv({ Type: "ACCPAY" }), "810").issues[0]).toMatch(/not a sales invoice/);
    expect(billingFromInvoice(inv(), "820").issues[0]).toMatch(/no line on account 820/);
    expect(billingFromInvoice(null, "810").issues[0]).toMatch(/not found in Xero/);
  });
});

describe("FM1's contract tools", () => {
  const job = { id: "run-1", agent: "fm1", client: { slug: "acme" } };
  it("lists customer contracts with what they hold and each billing's reference", async () => {
    const apiCall = vi.fn(async (_m, path) => (path.includes("?side=")
      ? { contracts: [{ id: "c1", side: "customer", entity_name: "FGH", counterparty: "Jo Bloggs Ltd", account_code: "810", total_value: 250000, currency: "GBP",
        status: "active", pattern: "milestone", pattern_label: "Milestone or installation", pattern_confirmed_at: null, held: 0 }] }
      : { movements: [{ kind: "billed", on_date: "2026-09-03", amount: 250000, ref: "INV-0003", withdrawn_at: null }, { kind: "billed", on_date: "2026-09-01", amount: 5, ref: "X", withdrawn_at: "2026-09-02" }] }));
    const t = agentContracts({ apiCall, apiRequest: vi.fn(), requesterOf: vi.fn() });
    const r = await t.call(job, "list_contracts", {});
    expect(r.contracts[0]).toMatchObject({ id: "c1", company: "FGH", account: "810", confirmed_by_cfo: false, held_now: 0 });
    expect(r.contracts[0].movements).toEqual([{ kind: "billed", on: "2026-09-03", amount: 250000, ref: "INV-0003" }]);
  });
  it("records a billing from its invoice as the person who asked, naming the agent", async () => {
    const apiRequest = vi.fn(async () => ({ ok: true, status: 201, body: { id: "m1", amount: 250000 } }));
    const t = agentContracts({ apiCall: vi.fn(), apiRequest, requesterOf: vi.fn(async () => "cfo@example.com") });
    const id = "11111111-2222-3333-4444-555555555555";
    const r = await t.call(job, "record_contract_billing", { contract_id: id, invoice_number: "INV-0003" });
    expect(apiRequest).toHaveBeenCalledWith("POST", `/api/finance/clients/acme/contracts/${id}/billed-from-invoice`, { invoice_number: "INV-0003" },
      { "X-Actor-Email": "cfo@example.com", "X-Work-Via": "agent:fm1:run-1" });
    expect(r).toMatchObject({ saved: true, id: "m1" });
  });
  it("hands a refusal back", async () => {
    const apiRequest = vi.fn(async () => ({ ok: false, status: 409, body: { error: "INV-0003 is already recorded on this contract" } }));
    const t = agentContracts({ apiCall: vi.fn(), apiRequest, requesterOf: vi.fn(async () => "cfo@example.com") });
    expect(await t.call(job, "record_contract_billing", { contract_id: "11111111-2222-3333-4444-555555555555", invoice_number: "INV-0003" }))
      .toEqual({ saved: false, status: 409, refused: { error: "INV-0003 is already recorded on this contract" } });
  });
});

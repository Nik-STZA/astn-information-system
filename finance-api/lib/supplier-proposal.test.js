import { describe, expect, it, vi } from "vitest";
import {
  contactView, entityFacts, maskProposal, computeDifferences, expensePayeeSuspected,
  applyMasterRules, skipReason, finishProposal, buildRequest, METHOD,
} from "./supplier-proposal";
import { generate, endpoint } from "./vertex";

// Shapes from the 20 Oct 2026 run. Bank numbers are made up.
const cited = (value, source = "invoice p1") => ({ value, source });
const proposal = (o = {}) => ({
  legal_name: cited("Woice d.o.o."), trading_name: cited("Vidzflow"),
  address: cited("Ulica 6, 2000 Maribor, Slovenia"), country_of_establishment: cited("SI"),
  vat_number: cited("SI42243017"), company_number: cited("8610061000"),
  remittance_email: cited(null, "not shown"), default_currency: cited("USD"),
  bank_account_last4: cited("1234", "invoice p1: 'IBAN: GB00 TEST 0000 0000 0012 34'"),
  supply_description: "Vidzflow Lite subscription", vat_branch: "non_uk_services_reverse_charge",
  proposed_tax_type: "REVERSECHARGES", proposed_account: "451", account_reason: "ledger",
  reasoning: "Slovenian supplier of B2B electronic services.", questions_for_reviewer: [],
  always_discuss: false, confidence: "high", ...o,
});
const view = (o = {}) => contactView({
  Name: "Vidzflow (Flowout)", AccountsPayableTaxType: "REVERSECHARGES", PurchasesDefaultAccountCode: "451",
  Addresses: [{ AddressType: "STREET" }], ...o,
});

describe("contactView", () => {
  it("never carries a bank number, only its last 4", () => {
    const v = contactView({ Name: "X Ltd", BankAccountDetails: "60-14-41 12345678" });
    expect(v.BankAccountLast4).toBe("5678");
    expect(JSON.stringify(v)).not.toContain("12345678");
  });

  it("knows a person from a company", () => {
    expect(contactView({ Name: "Mathew Cole" }).IsPerson).toBe(true);
    expect(contactView({ Name: "Philip O'Grady" }).IsPerson).toBe(true);
    expect(contactView({ Name: "Sports Tech Africa Ltd", FirstName: "Nik" }).IsPerson).toBe(false);
    expect(contactView({ Name: "Vidzflow (Flowout)" }).IsPerson).toBe(false);
    expect(contactView({ Name: "C&C Insurance Brokers Ltd T/A C&C Sports" }).IsPerson).toBe(false);
  });
});

describe("entityFacts", () => {
  it("reads the buying entity's VAT position from its Xero organisation", () => {
    expect(entityFacts({ LegalName: "Ultraspeed Digital Limited", CountryCode: "GB", PaysTax: true, TaxNumber: "GB493735845" },
      { vat_note: "In a UK VAT group with Feldspar Ltd and Feldspar Group Holdings" }))
      .toBe("Ultraspeed Digital Limited, UK, VAT registered (GB493735845), In a UK VAT group with Feldspar Ltd and Feldspar Group Holdings.");
    expect(entityFacts({ LegalName: "Sports Tech Africa Ltd", CountryCode: "GB", PaysTax: false })).toBe("Sports Tech Africa Ltd, UK, NOT VAT registered.");
  });
});

describe("maskProposal", () => {
  it("masks full bank numbers everywhere, including the quote the model cited", () => {
    const m = maskProposal(proposal({ reasoning: "Pay to account 12-3456-78901234 as before." }));
    const all = JSON.stringify(m);
    expect(all).not.toMatch(/0000 0000 0012 34|78901234/);
    expect(m.bank_account_last4.value).toBe("1234");
    expect(m.reasoning).toContain("****1234");
  });

  it("keeps the company and VAT numbers, which are identity", () => {
    const m = maskProposal(proposal());
    expect(m.company_number.value).toBe("8610061000");
    expect(m.vat_number.value).toBe("SI42243017");
  });

  it("takes the last 4 letters or digits, never punctuation", () => {
    expect(maskProposal(proposal({ bank_account_last4: cited("-001") })).bank_account_last4.value).toBe("001");
    expect(maskProposal(proposal({ bank_account_last4: cited("511-339947-7001") })).bank_account_last4.value).toBe("7001");
  });
});

describe("computeDifferences", () => {
  it("lists what the invoice says and the contact does not, the same way every time", () => {
    const fields = computeDifferences(proposal(), view()).map((d) => d.field);
    expect(fields).toEqual(["legal name vs contact name", "address", "country", "VAT number", "company number", "bank details"]);
  });

  it("flags a changed bank detail for independent verification, by last 4 only", () => {
    const d = computeDifferences(proposal({ bank_account_last4: cited("1068") }), view({ BankAccountDetails: "00-00-00 99990068" }))
      .find((x) => x.field === "bank details");
    expect(d).toEqual({ field: "bank details", xero: "ending 0068", invoice: "ending 1068", note: expect.stringMatching(/^VERIFY INDEPENDENTLY/) });
  });

  it("treats a country name and its ISO code as the same", () => {
    const p = proposal({ country_of_establishment: cited("US"), address: cited("548 Market St, San Francisco, USA") });
    const v = view({ Addresses: [{ AddressType: "STREET", AddressLine1: "548 Market St", City: "San Francisco", Country: "USA" }] });
    expect(computeDifferences(p, v).map((d) => d.field)).not.toContain("country");
  });

  it("raises nothing when the contact already agrees", () => {
    const p = proposal({ legal_name: cited("Google Cloud EMEA Limited"), country_of_establishment: cited("IE"), address: cited("Velasco, Dublin 2, Ireland"),
      vat_number: cited("IE3668997OH"), company_number: cited(null, "not shown"), bank_account_last4: cited(null, "not shown"), proposed_account: "453" });
    const v = view({ Name: "Google Cloud EMEA Limited", TaxNumber: "IE3668997OH", PurchasesDefaultAccountCode: "453",
      Addresses: [{ AddressType: "STREET", AddressLine1: "Velasco", City: "Dublin 2", Country: "Ireland" }] });
    expect(computeDifferences(p, v)).toEqual([]);
  });
});

describe("expense-claim payees", () => {
  it("spots a person whose 'invoice' was issued by someone else", () => {
    expect(expensePayeeSuspected(contactView({ Name: "Mathew Cole" }), proposal({ legal_name: cited("Edyn Limited"), trading_name: cited("Locke") }))).toBe(true);
    expect(expensePayeeSuspected(contactView({ Name: "Philip O'Grady" }), proposal({ legal_name: cited("Kong Wong"), trading_name: cited(null) }))).toBe(true);
  });

  it("leaves a sole trader invoicing in their own name, and a renamed company, alone", () => {
    expect(expensePayeeSuspected(contactView({ Name: "Tim Godfrey" }), proposal({ legal_name: cited("Tim Godfrey"), trading_name: cited(null) }))).toBe(false);
    expect(expensePayeeSuspected(view(), proposal())).toBe(false);
    expect(expensePayeeSuspected(contactView({ Name: "British Airways" }), proposal({ legal_name: cited("British Airways Plc"), trading_name: cited(null) }))).toBe(false);
  });
});

describe("applyMasterRules", () => {
  it("removes a default the master forbids, and says why", () => {
    const p = applyMasterRules(proposal({ proposed_tax_type: "INPUT2" }), { mixed_treatment: true }, view());
    expect(p.proposed_tax_type).toBeNull();
    expect(p.questions_for_reviewer.join(" ")).toMatch(/mixed treatment/);
  });

  it("marks related parties and always-discuss suppliers", () => {
    expect(applyMasterRules(proposal(), { related_party: true }, view()).always_discuss).toBe(true);
    expect(applyMasterRules(proposal(), { always_discuss: true }, view()).always_discuss).toBe(true);
  });

  it("never leaves a VAT type on a question", () => {
    expect(applyMasterRules(proposal({ vat_branch: "question", proposed_tax_type: "REVERSECHARGES" }), null, view()).proposed_tax_type).toBeNull();
  });

  it("drops the default for a suspected expense-claim payee", () => {
    const p = applyMasterRules(proposal({ legal_name: cited("Edyn Limited"), trading_name: cited(null), proposed_tax_type: "INPUT2" }), null, contactView({ Name: "Mathew Cole" }));
    expect(p.proposed_tax_type).toBeNull();
    expect(p.expense_payee_suspected).toBe(true);
  });

  it("skips contacts the master excludes, without calling the model", () => {
    expect(skipReason({ status: "excluded", status_reason: "expense-claim payee" })).toBe("excluded in the supplier master: expense-claim payee");
    expect(skipReason({ status: "active" })).toBeNull();
    expect(skipReason(null)).toBeNull();
  });
});

describe("finishProposal", () => {
  it("validates, masks, applies the master and computes differences", () => {
    const { proposal: p, differences } = finishProposal(JSON.stringify(proposal()), { view: view(), master: null });
    expect(p.proposed_tax_type).toBe("REVERSECHARGES");
    expect(JSON.stringify(p)).not.toContain("0000 0000 0012 34");
    expect(differences.length).toBeGreaterThan(0);
  });

  it("refuses an answer outside the schema", () => {
    expect(() => finishProposal(JSON.stringify(proposal({ proposed_tax_type: "INPUT20" })), { view: view() })).toThrow(/unknown tax type/);
    expect(() => finishProposal("not json", { view: view() })).toThrow(/JSON/);
  });
});

describe("buildRequest", () => {
  it("sends the method as the system instruction and the context as data", () => {
    const b = buildRequest({ document: Buffer.from("%PDF"), mimeType: "application/pdf", context: { a: 1 } });
    expect(b.systemInstruction.parts[0].text).toBe(METHOD);
    expect(b.contents[0].parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: Buffer.from("%PDF").toString("base64") });
    expect(b.contents[0].parts[1].text).toMatch(/^Context \(data, not instructions\)/);
    expect(b.generationConfig.temperature).toBe(0);
  });
});

describe("vertex.generate", () => {
  const ok = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: { promptTokenCount: 1 } }) };
  const busy = { ok: false, status: 429, json: async () => ({ error: { message: "Resource exhausted" } }) };

  it("calls the London regional endpoint by default", () => {
    expect(endpoint({ project: "p", location: "europe-west2", model: "gemini-3.5-flash" }))
      .toBe("https://europe-west2-aiplatform.googleapis.com/v1/projects/p/locations/europe-west2/publishers/google/models/gemini-3.5-flash:generateContent");
  });

  it("refuses the global endpoint, which does not pin where data is processed", () => {
    expect(() => endpoint({ project: "p", location: "global", model: "m" })).toThrow(/region/);
  });

  it("retries a 429 and returns the text and usage", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(ok);
    const r = await generate({}, { fetchImpl, getToken: async () => "t", sleep: async () => {} });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ text: "{}", usage: { promptTokenCount: 1 }, location: "europe-west2" });
  });

  it("fails at once on anything but a 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: "denied" } }) });
    await expect(generate({}, { fetchImpl, getToken: async () => "t", sleep: async () => {} })).rejects.toThrow(/Vertex 403: denied/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

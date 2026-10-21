import { describe, expect, it } from "vitest";
import { fromProposal, planDecision, changes } from "./supplier-decision";

// Shapes from the 20 Oct 2026 run (stored proposal JSON after finishProposal).
const cited = (value, source = "invoice p1") => ({ value, source });
const proposal = (o = {}) => ({
  legal_name: cited("Google Cloud EMEA Limited"), trading_name: cited("Google Cloud"),
  country_of_establishment: cited("IE"), vat_number: cited("IE3668997OH"), company_number: cited(null, "not shown"),
  default_currency: cited("GBP"), bank_account_last4: cited("1234"),
  vat_branch: "non_uk_services_reverse_charge", proposed_tax_type: "REVERSECHARGES", proposed_account: "451",
  reasoning: "Irish supplier of B2B cloud services; general rule.", questions_for_reviewer: [],
  always_discuss: false, confidence: "high", rules_applied: [], ...o,
});
const plan = (o) => planDecision({ contactName: "Google Cloud EMEA", ...o });

describe("fromProposal", () => {
  it("takes the cited values, treats 'not shown' as nothing, never the bank last 4", () => {
    const { supplier, link } = fromProposal(proposal());
    expect(supplier).toMatchObject({ legal_name: "Google Cloud EMEA Limited", country_of_establishment: "IE", company_number: null });
    expect(link).toMatchObject({ default_tax_type: "REVERSECHARGES", vat_basis: "non_uk_services_reverse_charge", default_account_code: "451" });
    expect(JSON.stringify({ supplier, link })).not.toContain("1234");
  });

  // 21 Oct 2026: Tim Godfrey's record took a receipt issuer's name and VAT number.
  it("takes nothing but the type from an expense payee's receipt", () => {
    const p = proposal({ legal_name: cited("Soho Works"), vat_number: cited("GB 283 1918 86"),
      expense_payee_suspected: true, proposed_tax_type: null });
    expect(fromProposal(p)).toEqual({ supplier: { supplier_type: "expense_payee" }, link: {} });
    const r = planDecision({ contactName: "Tim Godfrey", decision: "always_discuss", note: "Employee expense claims", proposal: p });
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({ legal_name: "Tim Godfrey", trading_name: null, vat_number: null,
      country_of_establishment: null, supplier_type: "expense_payee" });
    expect(r.link).toMatchObject({ default_tax_type: null, default_account_code: null, vat_basis: null });
  });

  it("a question is not a basis", () => {
    expect(fromProposal(proposal({ vat_branch: "question", proposed_tax_type: null })).link.vat_basis).toBeNull();
  });
});

describe("planDecision", () => {
  it("approves a clean proposal into an approved determination", () => {
    const r = plan({ decision: "approved", proposal: proposal() });
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({ legal_name: "Google Cloud EMEA Limited", vat_number: "IE3668997OH", status: "active", related_party: false });
    expect(r.link).toMatchObject({ status: "approved", default_tax_type: "REVERSECHARGES", vat_basis: "non_uk_services_reverse_charge", default_currency: "GBP" });
  });

  it("never copies the model's always_discuss onto the master", () => {
    const r = plan({ decision: "approved", proposal: proposal({ always_discuss: true }) });
    expect(r.supplier.always_discuss).toBe(false);
  });

  it("will not approve a proposal that asked a question", () => {
    const r = plan({ decision: "approved", proposal: proposal({ vat_branch: "question", proposed_tax_type: null }) });
    expect(r.errors[0]).toMatch(/asked a question/);
    expect(r.supplier).toBeNull();
  });

  it("edits answer the question (Asian Capital Partners shape)", () => {
    const r = plan({
      decision: "edited", proposal: proposal({ vat_branch: "question", proposed_tax_type: null }),
      edits: { default_tax_type: "EXEMPTINPUT", vat_basis: "non_uk_services_where_performed", vat_basis_note: "Securities exemption, per adviser" },
    });
    expect(r.errors).toEqual([]);
    expect(r.link).toMatchObject({ status: "approved", default_tax_type: "EXEMPTINPUT" });
  });

  it("STZA into UDL: related party, NONE, not VAT registered", () => {
    const r = plan({
      decision: "edited", contactName: "Sports Tech Africa Ltd",
      proposal: proposal({ legal_name: cited("Sports Tech Africa Ltd"), country_of_establishment: cited("GB"), vat_number: cited(null, "not shown"),
        vat_branch: "uk_not_registered", proposed_tax_type: "NONE" }),
      edits: { related_party: true, company_number: "16850337" },
    });
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({ related_party: true, company_number: "16850337", vat_number: null });
    expect(r.link).toMatchObject({ default_tax_type: "NONE", vat_basis: "uk_not_registered", status: "approved" });
  });

  it("mixed treatment refuses a default VAT type (Venture Proof)", () => {
    expect(plan({ decision: "edited", proposal: proposal(), edits: { mixed_treatment: true } }).errors[0]).toMatch(/mixed treatment/);
    const r = plan({ decision: "edited", proposal: proposal(), edits: { mixed_treatment: true, default_tax_type: null } });
    expect(r.errors).toEqual([]);
    expect(r.link).toMatchObject({ default_tax_type: null, status: "approved" });
    expect(r.supplier.mixed_treatment).toBe(true);
  });

  it("mixed treatment clears the basis too (Venture Proof, 21 Oct)", () => {
    const r = plan({ decision: "edited", proposal: proposal({ vat_branch: "uk_charges_vat", proposed_tax_type: null }),
      edits: { mixed_treatment: true, default_account_code: null } });
    expect(r.errors).toEqual([]);
    expect(r.link).toMatchObject({ default_tax_type: null, vat_basis: null, default_account_code: null });
  });

  it("a self-contradicting proposal cannot be approved as it stands", () => {
    const p = proposal({ vat_branch: "uk_charges_vat", proposed_tax_type: null, contradiction: true });
    expect(plan({ decision: "approved", proposal: p }).errors[0]).toMatch(/contradicted itself/);
    expect(plan({ decision: "edited", proposal: p, edits: { default_tax_type: "INPUT2", vat_basis: "uk_charges_vat" } }).errors).toEqual([]);
  });

  it("an existing mixed-treatment master also refuses a default", () => {
    const r = plan({ decision: "approved", proposal: proposal(), supplier: { legal_name: "Venture Proof Ltd", mixed_treatment: true } });
    expect(r.errors[0]).toMatch(/mixed treatment/);
  });

  it("a VAT type needs its basis", () => {
    const r = plan({ decision: "edited", proposal: null, edits: { legal_name: "X Ltd", default_tax_type: "INPUT2" } });
    expect(r.errors[0]).toMatch(/needs its vat_basis/);
  });

  it("a changed VAT type does not inherit the old basis", () => {
    const r = plan({ decision: "edited", proposal: proposal(), edits: { default_tax_type: "INPUT2" } });
    expect(r.errors[0]).toMatch(/its own vat_basis/);
    expect(plan({ decision: "edited", proposal: proposal(), edits: { default_tax_type: "INPUT2", vat_basis: "uk_charges_vat" } }).errors).toEqual([]);
  });

  it("always_discuss sets the flag, keeps the stored identity, sets no default", () => {
    const r = plan({ decision: "always_discuss", note: "Settle at fundraising close", proposal: proposal(),
      supplier: { legal_name: "Asian Capital Partners Ltd", country_of_establishment: "HK" } });
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({ always_discuss: true, legal_name: "Asian Capital Partners Ltd", country_of_establishment: "HK" });
    expect(r.link).toMatchObject({ status: "proposed", default_tax_type: null });
  });

  it("excludes an expense-claim payee without a proposal", () => {
    const r = plan({ decision: "excluded", note: "Employee expense claims, not a supplier", contactName: "Mathew Cole",
      edits: { supplier_type: "expense_payee" } });
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({ legal_name: "Mathew Cole", status: "excluded", status_reason: "Employee expense claims, not a supplier", supplier_type: "expense_payee" });
    expect(r.link).toMatchObject({ status: "proposed", default_tax_type: null, default_account_code: null });
  });

  it("marks a supplier dormant without a proposal (Mahgerre)", () => {
    const r = plan({ decision: "edited", contactName: "Mahgerre", edits: { status: "dormant", status_reason: "All paid, nothing due (Nik, 20 Oct 2026)" } });
    expect(r.errors).toEqual([]);
    expect(r.supplier).toMatchObject({ legal_name: "Mahgerre", status: "dormant" });
    expect(r.link.status).toBe("approved");
  });

  it("question and rejected leave the master alone and need a note", () => {
    expect(plan({ decision: "question", proposal: proposal() }).errors[0]).toMatch(/needs a note/);
    for (const decision of ["question", "rejected"]) {
      const r = plan({ decision, note: "Which entity was billed?", proposal: proposal() });
      expect(r).toEqual({ errors: [], supplier: null, link: null });
    }
  });

  it("approved needs a proposal and takes no edits; edited needs edits", () => {
    expect(plan({ decision: "approved" }).errors[0]).toMatch(/needs a proposal/);
    expect(plan({ decision: "approved", proposal: proposal(), edits: { default_account_code: "463" } }).errors[0]).toMatch(/decision edited/);
    expect(plan({ decision: "edited", proposal: proposal() }).errors[0]).toMatch(/at least one edit/);
    expect(plan({ decision: "maybe" }).errors[0]).toMatch(/decision must be one of/);
  });

  it("refuses bank details, unknown fields and bad values, all at once", () => {
    const r = plan({ decision: "edited", proposal: proposal(),
      edits: { bank_account: "12345678", colour: "red", country_of_establishment: "Ireland", payment_terms_days: 400, legal_name: null } });
    expect(r.errors).toHaveLength(5);
    expect(r.errors.join(" ")).toMatch(/never stored/);
    expect(r.supplier).toBeNull();
  });

  it("flags set earlier by the CFO survive a later approval", () => {
    const r = plan({ decision: "approved", proposal: proposal(), supplier: { legal_name: "Old", related_party: true, always_discuss: true },
      link: { status: "proposed", payment_terms_days: 30 } });
    expect(r.supplier).toMatchObject({ related_party: true, always_discuss: true, legal_name: "Google Cloud EMEA Limited" });
    expect(r.link.payment_terms_days).toBe(30);
  });
});

describe("changes", () => {
  it("lists only what moved", () => {
    expect(changes({ a: 1, b: null }, { a: 1, b: 2, c: null })).toEqual({ b: { from: null, to: 2 } });
    expect(changes(null, null)).toEqual({});
  });
});

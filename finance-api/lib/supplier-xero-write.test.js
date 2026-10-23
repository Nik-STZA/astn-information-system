import { describe, expect, it } from "vitest";
import { skipReason, determinationNote, planContactWrite } from "./supplier-xero-write";

// Shapes from the master as decided 21-22 Oct 2026.
const supplier = (o = {}) => ({
  legal_name: "Google Cloud EMEA Limited", country_of_establishment: "IE", vat_number: "IE3668997OH",
  company_number: null, status: "active", always_discuss: false, mixed_treatment: false, related_party: false, ...o,
});
const link = (o = {}) => ({
  id: "l1", status: "approved", default_tax_type: "REVERSECHARGES", default_account_code: "453",
  vat_basis: "non_uk_services_reverse_charge", vat_basis_note: null,
  approved_by_email: "nik@stza.io", approved_at: "2026-10-21T09:00:00Z", written_to_xero_at: null, ...o,
});
const contact = (o = {}) => ({ ContactID: "c1", Name: "Google Cloud EMEA", ContactStatus: "ACTIVE", ...o });
const source = { id: "inv1", number: "5713451497", date: "2026-10-01", file: "5713451497.pdf" };
const plan = (o = {}) => planContactWrite({ supplier: supplier(), link: link(), contact: contact(), source, ...o });

describe("skipReason", () => {
  it("writes only approved, active, not yet written links", () => {
    expect(skipReason({ supplier: supplier(), link: link() })).toBeNull();
    expect(skipReason({ supplier: null, link: null })).toMatch(/not in the supplier master/);
    expect(skipReason({ supplier: supplier({ status: "excluded" }), link: link() })).toMatch(/excluded/);
    expect(skipReason({ supplier: supplier({ status: "dormant" }), link: link() })).toMatch(/dormant/);
    expect(skipReason({ supplier: supplier(), link: link({ status: "proposed" }) })).toBe("not approved");
    expect(skipReason({ supplier: supplier(), link: link({ written_to_xero_at: "2026-10-22T10:00:00Z" }) })).toMatch(/already written/);
  });
});

describe("determinationNote", () => {
  it("is the one-line spec 2.3 note", () => {
    expect(determinationNote({ supplier: supplier(), link: link(), source })).toBe(
      "VAT: REVERSECHARGES - non-UK supplier (IE), B2B services, general rule: reverse charge. Default 453. "
      + "Source: invoice 5713451497 (1 Oct 2026). Approved nik@stza.io, 21 Oct 2026.");
  });

  it("says mixed treatment, always discuss and related party in words", () => {
    const n = determinationNote({ supplier: supplier({ mixed_treatment: true, always_discuss: true, related_party: true }),
      link: link({ default_tax_type: null, default_account_code: null, vat_basis: null }), source: null });
    expect(n).toMatch(/^VAT: no default, mixed treatment: every bill is reviewed\. Always discuss: every bill goes to the CFO\. Related party\. No default account\. Approved/);
  });

  it("carries the CFO's reasoning when the basis is a CFO decision", () => {
    const n = determinationNote({ supplier: supplier({ country_of_establishment: "US" }),
      link: link({ default_tax_type: "NONE", vat_basis: "cfo_decision", vat_basis_note: "services performed entirely from the USA" }), source });
    expect(n).toMatch(/^VAT: NONE - CFO decision: services performed entirely from the USA\./);
  });

  // Underdog, 22 Oct 2026: the stored note began "CFO decision:" and ended with a full stop.
  it("does not repeat the label or double the full stop", () => {
    const n = determinationNote({ supplier: supplier({ country_of_establishment: "US" }),
      link: link({ default_tax_type: "NONE", vat_basis: "cfo_decision",
        vat_basis_note: "CFO decision: no VAT; services performed entirely from the USA (Nik, 22 Oct 2026)." }), source });
    expect(n).toMatch(/^VAT: NONE - CFO decision: no VAT; services performed entirely from the USA \(Nik, 22 Oct 2026\)\. Default 453\./);
  });
});

describe("planContactWrite", () => {
  it("sends only what changes", () => {
    const p = plan({ contact: contact({ AccountsPayableTaxType: "REVERSECHARGES", TaxNumber: "IE 3668997OH" }) });
    expect(p.fields).toEqual({ PurchasesDefaultAccountCode: "453" });
    expect(p.changes).toEqual({ PurchasesDefaultAccountCode: { from: null, to: "453" } });
    expect(p.attach).toEqual({ invoice_id: "inv1", file_name: "5713451497.pdf" });
    expect(p.issues).toEqual([]);
  });

  it("fills a blank VAT number but never overwrites a different one", () => {
    expect(plan().fields.TaxNumber).toBe("IE3668997OH");
    const p = plan({ contact: contact({ TaxNumber: "GB123456789" }) });
    expect(p.fields.TaxNumber).toBeUndefined();
    expect(p.warnings.join(" ")).toMatch(/VAT number is GB123456789; the master holds IE3668997OH/);
  });

  it("never sends name, address, email, bank details or status", () => {
    const p = plan({ supplier: supplier({ legal_name: "Something Else Ltd" }) });
    expect(Object.keys(p.fields).sort()).toEqual(["AccountsPayableTaxType", "PurchasesDefaultAccountCode", "TaxNumber"]);
  });

  // Venture Proof, 22 Oct 2026: re-decided as mixed after holding NONE.
  it("mixed treatment sends no default and warns about one left on the contact", () => {
    const p = plan({ supplier: supplier({ mixed_treatment: true, vat_number: null }),
      link: link({ default_tax_type: null, default_account_code: null, vat_basis: null }),
      contact: contact({ AccountsPayableTaxType: "NONE" }) });
    expect(p.fields).toEqual({});
    expect(p.warnings[0]).toMatch(/still defaults bills to NONE/);
    expect(p.note).toMatch(/mixed treatment/);
  });

  it("does not attach the same file twice, and says when there is no source", () => {
    expect(plan({ attachments: [{ FileName: "5713451497.pdf" }] }).attach).toBeNull();
    const p = plan({ source: null });
    expect(p.attach).toBeNull();
    expect(p.warnings.join(" ")).toMatch(/No source invoice/);
  });

  it("refuses an archived contact", () => {
    expect(plan({ contact: contact({ ContactStatus: "ARCHIVED" }) }).issues).toEqual(["Xero contact is ARCHIVED"]);
  });

  it("returns the skip and nothing else for a link not to write", () => {
    expect(plan({ supplier: supplier({ status: "dormant" }) })).toEqual({ skip: expect.stringMatching(/dormant/) });
  });
});

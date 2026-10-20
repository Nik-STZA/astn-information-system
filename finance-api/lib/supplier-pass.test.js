import { describe, expect, it } from "vitest";
import { entityPass, groupPass, normaliseName, docDate, contactCountry } from "./supplier-pass";

const contact = (id, name, o = {}) => ({ ContactID: id, Name: name, IsSupplier: true, ContactStatus: "ACTIVE", ...o });
const bill = (contactId, date, lines, o = {}) => ({
  InvoiceID: `inv-${contactId}-${date}`, Type: "ACCPAY", Status: "AUTHORISED",
  Contact: { ContactID: contactId }, DateString: `${date}T00:00:00`,
  CurrencyCode: "GBP", CurrencyRate: 1, LineAmountTypes: "Exclusive",
  LineItems: lines.map(([AccountCode, TaxType, LineAmount, TaxAmount = 0]) => ({ AccountCode, TaxType, LineAmount, TaxAmount })),
  ...o,
});
const ORG = { BaseCurrency: "GBP", PaysTax: true };
const only = (r, id) => r.live.find((s) => s.contact_id === id);

describe("helpers", () => {
  it("normalises supplier names so legal suffixes do not split one supplier", () => {
    expect(normaliseName("Dragon Argent Ltd")).toBe(normaliseName("Dragon Argent Limited"));
    expect(normaliseName("Sports Tech South Africa Ltd T/A STZA")).toBe("sports tech south africa");
    expect(normaliseName("Smith & Co")).toBe("smith and");
  });

  it("reads Xero dates in either form", () => {
    expect(docDate({ DateString: "2026-09-30T00:00:00" })).toBe("2026-09-30");
    expect(docDate({ Date: "/Date(1790726400000+0000)/" })).toBe("2026-09-30");
  });

  it("prefers the street address country", () => {
    expect(contactCountry({ Addresses: [{ AddressType: "POBOX", Country: "GB" }, { AddressType: "STREET", Country: "Ireland" }] })).toBe("Ireland");
    expect(contactCountry({ Addresses: [{ AddressType: "STREET" }] })).toBe(null);
  });
});

describe("entityPass", () => {
  it("a clean UK supplier carries no flags", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG,
      contacts: [contact("a", "Clean Ltd", { Addresses: [{ AddressType: "STREET", Country: "GB" }], TaxNumber: "GB123", PurchasesDefaultAccountCode: "463", AccountsPayableTaxType: "INPUT2" })],
      bills: [bill("a", "2026-05-01", [["463", "INPUT2", 100, 20]])],
    });
    expect(only(r, "a")).toMatchObject({ net: "100.00", documents: 1, flags: [] });
  });

  it("flags mixed VAT treatment and lists it first", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG,
      contacts: [contact("big", "Big"), contact("mix", "Venture Proof")],
      bills: [
        bill("big", "2026-03-01", [["463", "INPUT2", 9000, 1800]]),
        bill("mix", "2026-04-01", [["463", "INPUT2", 100, 20]]),
        bill("mix", "2026-05-01", [["463", "NONE", 50]]),
      ],
    });
    expect(r.live[0].contact_id).toBe("mix");
    expect(r.live[0].flags).toContain("mixed_tax");
    expect(r.live[0].tax_types).toEqual({ INPUT2: { n: 1, net: "100.00" }, NONE: { n: 1, net: "50.00" } });
  });

  it("converts foreign documents to base and flags VAT charged on them", () => {
    const r = entityPass({
      entity: "fsl", organisation: ORG,
      contacts: [contact("hk", "Asian Capital Partners", { Addresses: [{ AddressType: "STREET", Country: "Hong Kong" }] })],
      bills: [bill("hk", "2026-06-01", [["404", "INPUT2", 1000, 200]], { CurrencyCode: "HKD", CurrencyRate: 10 })],
    });
    const s = only(r, "hk");
    expect(s.net).toBe("100.00");
    expect(s.flags).toEqual(expect.arrayContaining(["foreign_currency_vat_charged", "possible_reverse_charge", "no_default_tax"]));
  });

  it("takes tax off inclusive lines and nets credit notes", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG, contacts: [contact("x", "X")],
      bills: [bill("x", "2026-06-01", [["463", "INPUT2", 120, 20]], { LineAmountTypes: "Inclusive" })],
      credits: [{ ...bill("x", "2026-06-02", [["463", "INPUT2", 30, 6]]), InvoiceID: undefined, CreditNoteID: "cn1" }],
    });
    expect(only(r, "x")).toMatchObject({ net: "70.00", documents: 2 });
  });

  it("ignores drafts, voids and documents before the window, and counts drafts", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG, from: "2025-10-20",
      contacts: [contact("x", "X"), contact("old", "Old")],
      bills: [
        bill("x", "2026-06-01", [["463", "NONE", 10]], { Status: "DRAFT" }),
        bill("x", "2026-06-02", [["463", "NONE", 10]], { Status: "VOIDED" }),
        bill("old", "2025-01-01", [["463", "NONE", 10]]),
      ],
    });
    expect(r.live).toEqual([]);
    expect(r.drafts_ignored).toBe(1);
    expect(r.dormant).toEqual({ count: 2, names: ["Old", "X"] });
  });

  it("raises no VAT flags for an entity that is not VAT registered", () => {
    const r = entityPass({
      entity: "stza", organisation: { BaseCurrency: "GBP", PaysTax: false },
      contacts: [contact("ii", "Interactive Investor", { PurchasesDefaultAccountCode: "481" })],
      bills: [bill("ii", "2026-09-30", [["481", "NONE", 1360]]), bill("ii", "2026-08-29", [["481", "INPUT2", 1, 0]])],
    });
    expect(only(r, "ii").flags).toEqual(["no_country"]);
  });

  const spend = (contactId, date, account, amount) => ({ BankTransactionID: `bt-${contactId}-${date}`, Type: "SPEND", Status: "AUTHORISED", Contact: { ContactID: contactId }, DateString: `${date}T00:00:00`, CurrencyCode: "GBP", LineAmountTypes: "Exclusive", LineItems: [{ AccountCode: account, TaxType: "NONE", LineAmount: amount }] });

  it("counts a payee met only through spend money, but does not list it", () => {
    const r = entityPass({ entity: "udl", organisation: ORG, contacts: [contact("s", "Pret")], spends: [spend("s", "2026-07-01", "424", 5)] });
    expect(r.live).toEqual([]);
    expect(r.spend_only).toEqual({ count: 1, net: "5.00", balance_sheet: "0.00" });
    expect(r.dormant.count).toBe(0);
  });

  it("includes spend money for a billed supplier", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG, contacts: [contact("d", "Dropbox")],
      bills: [bill("d", "2026-06-01", [["423", "REVERSECHARGES", 10]])], spends: [spend("d", "2026-07-01", "423", 10)],
    });
    expect(only(r, "d").sources).toEqual({ bill: { n: 1, net: "10.00" }, spend: { n: 1, net: "10.00" } });
  });

  it("keeps balance-sheet lines out of the coding analysis", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG, contacts: [contact("s", "Sheridans"), contact("h", "HMRC")],
      accounts: [{ Code: "641", Class: "LIABILITY" }, { Code: "825", Class: "LIABILITY" }, { Code: "441", Class: "EXPENSE" }],
      bills: [bill("s", "2026-06-01", [["441", "INPUT2", 100, 20]]), bill("h", "2026-06-01", [["825", "NONE", 500]])],
      spends: [spend("s", "2026-07-01", "641", 900)],
    });
    expect(only(r, "s")).toMatchObject({ accounts: { 441: { n: 1, net: "100.00" } }, balance_sheet_lines: 1 });
    expect(only(r, "s").flags).not.toContain("mixed_account");
    expect(only(r, "h").flags).toEqual(["balance_sheet_only"]);
  });

  it("flags two live contacts that are one supplier", () => {
    const r = entityPass({
      entity: "udl", organisation: ORG, contacts: [contact("a", "Pitch Ltd"), contact("b", "Pitch Limited")],
      bills: [bill("a", "2026-06-01", [["463", "NONE", 1]]), bill("b", "2026-06-02", [["463", "NONE", 1]])],
    });
    expect(r.live.every((s) => s.flags.includes("possible_duplicate_contact"))).toBe(true);
  });
});

describe("groupPass", () => {
  it("joins one supplier across entities", () => {
    const a = entityPass({ entity: "udl", organisation: ORG, contacts: [contact("1", "Dragon Argent Ltd")], bills: [bill("1", "2026-06-01", [["463", "NONE", 1]])] });
    const b = entityPass({ entity: "fgh", organisation: ORG, contacts: [contact("2", "Dragon Argent Limited")], bills: [bill("2", "2026-06-01", [["463", "NONE", 1]])] });
    const g = groupPass([a, b]);
    expect(g).toHaveLength(1);
    expect(g[0].entities.map((e) => e.entity)).toEqual(["udl", "fgh"]);
    expect(g[0].names).toEqual(["Dragon Argent Ltd", "Dragon Argent Limited"]);
  });
});

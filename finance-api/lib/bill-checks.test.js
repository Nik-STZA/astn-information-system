import { describe, expect, it } from "vitest";
import { normNumber, xeroTime, billDate, checkBill } from "./bill-checks";

const SUP = { ContactID: "c1", Name: "Anthropic" };
const bill = (over = {}) => ({
  InvoiceID: "11111111-0000-4000-8000-000000000001", InvoiceNumber: "GKSLYBWM-0001", Contact: SUP,
  DateString: "2026-09-30T00:00:00", Total: 120, TotalTax: 0, Status: "DRAFT",
  LineItems: [{ Description: "Claude Team", LineAmount: 120, AccountCode: "463", TaxType: "NONE" }],
  ...over,
});
const other = (id, over = {}) => ({ InvoiceID: `2222222${id}-0000-4000-8000-000000000000`, Status: "AUTHORISED", ...over });
const flagged = (r, c) => r.flags.find((f) => f.check === c).flagged;
const ACCOUNTS = [{ Code: "463" }, { Code: "400" }];

describe("helpers", () => {
  it("normalises numbers and reads both Xero date forms", () => {
    expect(normNumber("gkslybwm-0001")).toBe(normNumber("GKSLYBWM0001"));
    expect(xeroTime("/Date(1727654400000+0000)/")).toBe(1727654400000);
    expect(xeroTime("2026-09-30T10:00:00Z")).toBe(Date.parse("2026-09-30T10:00:00Z"));
    expect(billDate({ Date: "/Date(1727654400000+0000)/" })).toBe("2024-09-30");
  });
});

describe("check_bill", () => {
  it("flags nothing on a clean bill, and never passes the PDF check", () => {
    const r = checkBill({ bill: bill(), paysTax: false, accounts: ACCOUNTS });
    expect(r.flagged).toEqual([]);
    expect(r.flags.find((f) => f.check === "lines_vs_pdf")).toMatchObject({ flagged: false, not_checked: true });
  });

  it("flags a blank line repeating the total", () => {
    const b = bill({ LineItems: [...bill().LineItems, { Description: "", LineAmount: 120, AccountCode: "463" }] });
    expect(flagged(checkBill({ bill: b, accounts: ACCOUNTS }), "blank_line_repeating_total")).toBe(true);
  });

  it("flags VAT on an entity that does not pay it", () => {
    const b = bill({ TotalTax: 20, LineItems: [{ Description: "x", LineAmount: 100, AccountCode: "463", TaxType: "INPUT2" }] });
    expect(flagged(checkBill({ bill: b, paysTax: false, accounts: ACCOUNTS }), "vat_on_non_vat_entity")).toBe(true);
    expect(flagged(checkBill({ bill: b, paysTax: true, accounts: ACCOUNTS }), "vat_on_non_vat_entity")).toBe(false);
  });

  it("flags a code outside the chart", () => {
    const r = checkBill({ bill: bill({ LineItems: [{ Description: "x", LineAmount: 1, AccountCode: "999" }] }), accounts: ACCOUNTS });
    expect(flagged(r, "account_not_in_coa")).toBe(true);
  });

  it("finds a duplicate number after normalising, ignoring deleted and voided bills", () => {
    const siblings = [other(1, { InvoiceNumber: "GKSLYBWM0001", Total: 120 }), other(2, { InvoiceNumber: "GKSLYBWM-0001", Status: "DELETED" })];
    const r = checkBill({ bill: bill(), accounts: ACCOUNTS, siblings });
    expect(flagged(r, "duplicate_invoice_number")).toBe(true);
    expect(r.flags.find((f) => f.check === "duplicate_invoice_number").detail).not.toMatch(/DELETED/);
  });

  it("treats a number on more than three bills as a label, not four duplicates", () => {
    const siblings = [1, 2, 3, 4].map((i) => other(i, { InvoiceNumber: "Expense Claims", Total: i }));
    const r = checkBill({ bill: bill({ InvoiceNumber: "Expense Claims" }), accounts: ACCOUNTS, siblings });
    expect(flagged(r, "non_identifying_number")).toBe(true);
    expect(flagged(r, "duplicate_invoice_number")).toBe(false);
  });

  it("flags same supplier, same amount, same day, but not the same amount a month apart", () => {
    const sameDay = [other(1, { InvoiceNumber: "R-1", DateString: "2026-09-30T00:00:00", Total: 120 })];
    const monthApart = [other(1, { InvoiceNumber: "R-1", DateString: "2026-08-30T00:00:00", Total: 120 })];
    expect(flagged(checkBill({ bill: bill(), accounts: ACCOUNTS, siblings: sameDay }), "duplicate_same_day")).toBe(true);
    expect(flagged(checkBill({ bill: bill(), accounts: ACCOUNTS, siblings: monthApart }), "duplicate_same_day")).toBe(false);
  });

  it("reports the supplier's prior coding without flagging it", () => {
    const r = checkBill({ bill: bill(), accounts: ACCOUNTS, priorLines: [{ AccountCode: "463" }, { AccountCode: "400" }] });
    expect(r.flags.find((f) => f.check === "supplier_prior_account")).toMatchObject({ flagged: false, matches_prior: true });
  });

  it("detects Round writing after the agent's edit, as a word only", () => {
    const history = [
      { DateUTC: "2026-09-30T09:00:00", Details: "Received through the Xero API from Round" },
      { DateUTC: "2026-09-30T12:00:00", Details: "Received through the Xero API from Round" },
      { DateUTC: "2026-09-30T13:00:00", Details: "Rounding adjustment" },
    ];
    expect(flagged(checkBill({ bill: bill(), accounts: ACCOUNTS, history, since: "2026-09-30T11:00:00" }), "round_overwrote")).toBe(true);
    expect(flagged(checkBill({ bill: bill(), accounts: ACCOUNTS, history, since: "2026-09-30T12:30:00" }), "round_overwrote")).toBe(false);
    expect(flagged(checkBill({ bill: bill(), accounts: ACCOUNTS, history }), "round_overwrote")).toBe(false);
  });
});

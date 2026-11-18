import { describe, expect, it } from "vitest";
const { expectedOf, windowOf, candidatesFrom, statusAfter, dayOf } = require("./vat-payments");

const txn = (id, date, type, amount, { contact = "HMRC", code = "820", status = "AUTHORISED" } = {}) => ({
  BankTransactionID: id, Type: type, Status: status, Date: `/Date(${Date.parse(`${date}T00:00:00Z`)}+0000)/`, Total: amount,
  Contact: { Name: contact }, Reference: `R-${id}`, BankAccount: { Name: "Current" }, LineItems: [{ AccountCode: code, LineAmount: amount }],
});

describe("HMRC's payment for a VAT return", () => {
  it("expects a repayment when more VAT was reclaimed than due", () => {
    expect(expectedOf({ 3: 4703.29, 4: 87267.62 })).toBe(8256433);
    expect(expectedOf({ 3: 500, 4: 120 })).toBe(-38000);
  });

  it("looks from a week before filing to 90 days after", () => {
    expect(windowOf("2026-11-20")).toEqual({ from: "2026-11-13", to: "2027-02-18" });
  });

  it("finds HMRC's repayment, the exact amount first, and leaves out the rest", () => {
    const txns = [
      txn("near", "2026-11-25", "RECEIVE", 82000.00),
      txn("exact", "2026-11-28", "RECEIVE", 82564.33),
      txn("out", "2026-11-26", "SPEND", 82564.33),                                   // the wrong way
      txn("other", "2026-11-26", "RECEIVE", 82564.33, { contact: "A Customer", code: "200" }),   // not HMRC
      txn("early", "2026-10-01", "RECEIVE", 82564.33),                              // before the window
      txn("void", "2026-11-28", "RECEIVE", 82564.33, { status: "DELETED" }),
      txn("bycode", "2026-11-29", "RECEIVE", 100, { contact: "Bank" }),             // a line to the VAT account
    ];
    const c = candidatesFrom(txns, { expected: 8256433, vatCode: "820", from: "2026-11-13", to: "2027-02-18", taken: ["near"] });
    expect(c.map((x) => x.xero_bank_txn_id)).toEqual(["exact", "near", "bycode"]);
    expect(c[0]).toMatchObject({ date: "2026-11-28", amount: 82564.33, difference: 0, exact: true, contact: "HMRC" });
    expect(c[1]).toMatchObject({ difference: -564.33, taken: true });
  });

  it("finds a payment to HMRC when VAT was owed", () => {
    const c = candidatesFrom([txn("pay", "2026-12-05", "SPEND", 380)], { expected: -38000, vatCode: "820", from: "2026-11-13", to: "2027-02-18" });
    expect(c[0]).toMatchObject({ amount: -380, exact: true });
  });

  it("is paid when it matches, or when the CFO says why HMRC paid less", () => {
    expect(statusAfter({ expected: 10000, amount: 100 })).toBe("paid");
    expect(statusAfter({ expected: 10000, amount: 90 })).toBe("part_paid");
    expect(statusAfter({ expected: 10000, amount: 90, setOffReason: "Set off against a PAYE debt" })).toBe("paid");
  });

  it("reads Xero's dates", () => {
    expect(dayOf("/Date(1792972800000+0000)/")).toBe("2026-10-26");
    expect(dayOf("2026-10-26T00:00:00")).toBe("2026-10-26");
  });
});

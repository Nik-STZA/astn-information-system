import { describe, expect, it } from "vitest";
import {
  addMoney,
  ErpError,
  formatMoney,
  money,
  toMinorUnits,
} from "@/modules/finance/lib/erp-adapter";

// Money is carried as integer minor units precisely so that ledger arithmetic
// cannot drift. These tests pin the cases that make floats unsafe.

describe("toMinorUnits", () => {
  it("converts a decimal string exactly", () => {
    expect(toMinorUnits("18420.50")).toEqual({ amount: 1842050, currency: "GBP" });
  });

  it("handles the ordinary two-decimal cases", () => {
    expect(toMinorUnits("19.99").amount).toBe(1999);
    expect(toMinorUnits("0.29").amount).toBe(29);
    expect(toMinorUnits("133552.00").amount).toBe(13355200);
  });

  // Xero unit prices carry four decimals. Truncating rather than rounding here
  // loses value silently. These cases discriminate between the two behaviours,
  // unlike the two-decimal ones above where truncating and rounding agree.
  it("rounds at the third decimal instead of truncating it away", () => {
    expect(toMinorUnits("1.005").amount).toBe(101);
    expect(toMinorUnits("1.999").amount).toBe(200);
    expect(toMinorUnits("0.004").amount).toBe(0);
    expect(toMinorUnits("0.005").amount).toBe(1);
  });

  it("rounds negatives away from zero, keeping magnitude symmetric", () => {
    expect(toMinorUnits("-1.005").amount).toBe(-101);
    expect(toMinorUnits("-1.005").amount).toBe(-toMinorUnits("1.005").amount);
  });

  // A float multiply drifts before this magnitude; the digit handling does not.
  it("stays exact at large magnitudes", () => {
    expect(toMinorUnits("8000000000000.01").amount).toBe(800000000000001);
  });

  it("handles negatives, which are credits on a journal line", () => {
    expect(toMinorUnits("-25.72").amount).toBe(-2572);
    expect(toMinorUnits("-0.01").amount).toBe(-1);
  });

  it("treats a missing or short fraction as trailing zeros", () => {
    expect(toMinorUnits("5").amount).toBe(500);
    expect(toMinorUnits("5.1").amount).toBe(510);
  });

  it("strips currency symbols and thousands separators", () => {
    expect(toMinorUnits("£1,705,710.49").amount).toBe(170571049);
  });

  it("accepts a number as well as a string", () => {
    expect(toMinorUnits(3870.89).amount).toBe(387089);
  });

  it("carries the currency it was given", () => {
    expect(toMinorUnits("10.00", "USD").currency).toBe("USD");
  });
});

describe("addMoney", () => {
  it("adds within one currency", () => {
    expect(addMoney(money(1000), money(2500))).toEqual({ amount: 3500, currency: "GBP" });
  });

  // Xero line amounts arrive in the document's own currency. Silently adding
  // them would produce a number that looks like GBP and is not.
  it("refuses to add across currencies rather than producing a wrong total", () => {
    expect(() => addMoney(money(1000, "GBP"), money(1000, "USD"))).toThrow(ErpError);
    expect(() => addMoney(money(1000, "GBP"), money(1000, "USD"))).toThrow(/conversion rate/);
  });

  it("sums a journal to zero, which is what a balanced journal must do", () => {
    const lines = [toMinorUnits("2572.00"), toMinorUnits("-2572.00")];
    const total = lines.reduce((a, b) => addMoney(a, b), money(0));
    expect(total.amount).toBe(0);
  });
});

describe("formatMoney", () => {
  it("renders minor units back to a currency string", () => {
    expect(formatMoney({ amount: 1842050, currency: "GBP" })).toBe("£18,420.50");
  });

  it("renders negatives", () => {
    expect(formatMoney({ amount: -2572, currency: "GBP" })).toBe("-£25.72");
  });
});

describe("money", () => {
  it("rounds rather than truncating a fractional minor unit", () => {
    expect(money(10.6).amount).toBe(11);
    expect(money(10.4).amount).toBe(10);
  });
});

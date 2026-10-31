import { describe, expect, it } from "vitest";
import { AP_TABS, checkLabel, documentTypeLabel, matchOptions, money, shortDate } from "./ap-labels";

describe("ap-labels", () => {
  it("puts every queue state in exactly one tab, except superseded; Agent review has none of its own", () => {
    expect(AP_TABS.find((t) => t.key === "agents")?.states).toEqual([]);
    const states = AP_TABS.flatMap((t) => t.states);
    expect(new Set(states).size).toBe(states.length);
    expect(states.sort()).toEqual(["approved", "clean", "exception", "rejected", "skipped", "written"]);
  });

  it("says each check in plain words, and falls back to the check's own name", () => {
    expect(checkLabel("vat_without_invoice")).toBe("VAT claimed without a VAT invoice");
    expect(checkLabel("something_new")).toBe("something new");
    expect(documentTypeLabel("payment_confirmation")).toBe("Payment confirmation");
    expect(documentTypeLabel(null)).toBe("Unknown");
  });

  it("formats money with its currency and dates without ordinals", () => {
    expect(money(1234.5, "GBP")).toBe("GBP 1,234.50");
    expect(money("17.99", null)).toBe("17.99");
    expect(money(null, "GBP")).toBe("-");
    expect(shortDate("2026-10-07T00:00:00")).toBe("7 Oct 2026");
    expect(shortDate(null)).toBe("-");
  });
});

describe("matchOptions", () => {
  const accounts = [
    { value: "442", label: "442 Legal and professional fees" },
    { value: "620", label: "620 Prepayments" },
    { value: "6200", label: "6200 Prepaid software" },
    { value: "429", label: "429 General expenses" },
  ];
  const labels = (q: string) => matchOptions(accounts, q).map((a) => a.value);

  it("finds an account by name as well as by number", () => {
    expect(labels("prep")).toEqual(["620", "6200"]);
    expect(labels("PREPAYMENTS")).toEqual(["620"]);
    expect(labels("620")).toEqual(["620", "6200"]);
  });

  it("needs every word, in any order, and puts a match at the start first", () => {
    expect(labels("fees legal")).toEqual(["442"]);
    expect(labels("expenses")).toEqual(["429"]);
    expect(labels("software prep")).toEqual(["6200"]);
  });

  it("shows everything when nothing is typed, and nothing for no match", () => {
    expect(labels("  ")).toEqual(["442", "620", "6200", "429"]);
    expect(labels("zzz")).toEqual([]);
  });
});

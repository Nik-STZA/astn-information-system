import { describe, expect, it } from "vitest";
import { AP_TABS, checkLabel, documentTypeLabel, money, shortDate } from "./ap-labels";

describe("ap-labels", () => {
  it("puts every queue state in exactly one tab, except superseded", () => {
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

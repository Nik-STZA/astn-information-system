import { describe, expect, it } from "vitest";
import { dateText, methodText, money, pickCompany, tieSummary } from "./fixed-assets";

describe("fixed assets helpers", () => {
  it("formats money and dates the house way", () => {
    expect(money(42629.32)).toBe("42,629.32");
    expect(money(null)).toBe("-");
    expect(dateText("2026-09-29")).toMatch(/^29 Sept? 2026$/);
    expect(dateText(null)).toBe("-");
  });

  it("words the depreciation method", () => {
    expect(methodText({ method: "StraightLine", life_years: 3, rate: null })).toBe("Straight line, 3 years");
    expect(methodText({ method: "DiminishingValue100", life_years: null, rate: 25 })).toBe("Diminishing 100%, 25% a year");
    expect(methodText({ method: null, life_years: 3, rate: null })).toBeNull();
  });

  it("shows the company asked for, else the first", () => {
    const cs = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }];
    expect(pickCompany(cs, "b")?.slug).toBe("b");
    expect(pickCompany(cs, "zzz")?.slug).toBe("a");
    expect(pickCompany([], undefined)).toBeNull();
  });

  it("sums up the tie", () => {
    const t = { as_at: "2026-11-08", rows: [], outside_register: [], untyped_count: 0 };
    expect(tieSummary({ ...t, differences: 0 })).toEqual({ tone: "s-green", label: "Ties to the ledger" });
    expect(tieSummary({ ...t, differences: 1 }).label).toBe("1 difference to explain");
    expect(tieSummary({ ...t, differences: 2 }).label).toBe("2 differences to explain");
  });
});

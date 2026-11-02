import { describe, expect, it } from "vitest";
import { ageText, amountText, filterCount, grouped, isFilter, type ReviewItem } from "./review";

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  kind: "bill", id: "x", title: "Sample Supplies Ltd, INV-1", company: "Alpha Ltd", amount: "120.00", currency: "GBP",
  waiting_on: "CFO", since: "2026-10-20T09:00:00.000Z", produced_by: "AP Clerk", status: "Clean, ready to approve",
  href: "/finance/clients/alpha-group/bills", for_you: true, ...over,
});

describe("the two groups", () => {
  const items = [
    item({ id: "j", kind: "journal", since: "2026-11-01T09:00:00.000Z" }),
    item({ id: "r", kind: "rec", since: "2026-10-01T09:00:00.000Z", waiting_on: "FC", for_you: false }),
    item({ id: "n", kind: "approval", since: null }),
    item({ id: "b", kind: "bill", since: "2026-10-15T09:00:00.000Z" }),
    item({ id: "rj", kind: "rec_journal", since: "2026-10-10T09:00:00.000Z" }),
  ];

  it("splits by whether it is the viewer's, oldest first, undated last", () => {
    const g = grouped(items);
    expect(g.forYou.map((i) => i.id)).toEqual(["rj", "b", "j", "n"]);
    expect(g.others.map((i) => i.id)).toEqual(["r"]);
  });

  it("filters by kind, with a rec's journal under Journals", () => {
    expect(grouped(items, "journals").forYou.map((i) => i.id)).toEqual(["rj", "j"]);
    expect(grouped(items, "recs").others.map((i) => i.id)).toEqual(["r"]);
    expect(grouped(items, "bills").forYou.map((i) => i.id)).toEqual(["b"]);
    expect(filterCount(items, "all")).toBe(5);
    expect(filterCount(items, "journals")).toBe(2);
    expect(filterCount(items, "approvals")).toBe(1);
  });

  it("does not reorder what it was given", () => {
    const before = items.map((i) => i.id).join();
    grouped(items);
    expect(items.map((i) => i.id).join()).toBe(before);
  });

  it("knows its filters", () => {
    expect(isFilter("bills")).toBe(true);
    expect(isFilter("work")).toBe(false);
    expect(isFilter(undefined)).toBe(false);
  });
});

describe("words", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  it("says how long it has waited", () => {
    expect(ageText("2026-11-02T11:30:00Z", now)).toBe("under an hour");
    expect(ageText("2026-11-02T11:00:00Z", now)).toBe("1 hour");
    expect(ageText("2026-11-02T02:00:00Z", now)).toBe("10 hours");
    expect(ageText("2026-11-01T11:00:00Z", now)).toBe("1 day");
    expect(ageText("2026-10-30T12:00:00Z", now)).toBe("3 days");
    expect(ageText(null, now)).toBe("-");
    expect(ageText("not a date", now)).toBe("-");
  });

  it("shows money with its currency, and nothing for no amount", () => {
    expect(amountText("1234.5", "GBP")).toBe("GBP 1,234.50");
    expect(amountText("600.00", null)).toBe("600.00");
    expect(amountText(null, null)).toBe("");
  });
});

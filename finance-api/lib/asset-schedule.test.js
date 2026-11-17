import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { schedule, xeroMonthCharge, previousPeriod } = require("./asset-schedule");

const A = { id: "a", accum_account_id: "acc" };
const B = { id: "b", accum_account_id: "acc" };
const line = (asset_id, line_date, amount, treatment = "capitalise") => ({ asset_id, line_date, amount, treatment });

describe("the month's schedule", () => {
  it("splits cost and accumulated amortisation, brought forward and in the month", () => {
    const s = schedule({
      assets: [A, B],
      lines: [line("a", "2024-03-01", 1000), line("a", "2026-10-22", 250), line("a", "2026-10-30", 99, "expense_admin"), line("b", "2026-11-02", 500)],
      events: [
        { id: "e1", asset_id: "a", period: "2026-08", kind: "opening", amount: 120 },
        { id: "e2", asset_id: "a", period: "2026-09", kind: "amortisation", amount: 10 },
        { id: "e3", asset_id: "a", period: "2026-10", kind: "amortisation", amount: 10 },
        { id: "e4", asset_id: "b", period: "2026-10", kind: "impairment", amount: 40 },
      ],
      period: "2026-10",
    });
    expect(s.get("a")).toMatchObject({ cost_bf: 1000, additions: 250, cost_cf: 1250, accumulated_bf: -130, charge: -10, accumulated_cf: -140, nbv_bf: 870, nbv_cf: 1110 });
    expect(s.get("b")).toMatchObject({ cost_bf: 0, additions: 0, impairment: -40, accumulated_cf: -40, nbv_cf: -40 });
  });

  it("an opening event dated in the month is brought forward, not a charge", () => {
    const s = schedule({ assets: [A], lines: [line("a", "2026-08-31", 1000)], events: [{ id: "o", asset_id: "a", period: "2026-08", kind: "opening", amount: 120 }], period: "2026-08" });
    expect(s.get("a")).toMatchObject({ additions: 1000, accumulated_bf: -120, charge: 0 });
  });

  it("a transfer moves cost within the month", () => {
    const s = schedule({ assets: [A], lines: [line("a", "2026-01-01", 500)],
      events: [{ id: "t", asset_id: "a", period: "2026-10", kind: "transfer", amount: 500, accounts: { from: "wip", to: "cost" } }], period: "2026-10" });
    expect(s.get("a")).toMatchObject({ cost_bf: 500, transfers: 0, cost_cf: 500 });
  });
});

describe("helpers", () => {
  it("Xero's charge in the month from the cumulative movement", () => {
    expect(xeroMonthCharge(-732.5, -366.25)).toBe(-366.25);
    expect(xeroMonthCharge(-366.25, null)).toBe(-366.25);
    expect(xeroMonthCharge(null, -1)).toBeNull();
  });
  it("the month before", () => {
    expect(previousPeriod("2026-10")).toBe("2026-09");
    expect(previousPeriod("2027-01")).toBe("2026-12");
  });
});

import { describe, expect, it } from "vitest";
import { columnsCover, normaliseProfitAndLossParams as norm } from "./pnl-periods.js";

describe("columnsCover", () => {
  // 11 Sep 2026: asked from April 2025, twelve columns reach back only to October.
  it("reports the earliest month the columns reach", () => {
    const p = norm({ fromDate: "2025-04-01", toDate: "2026-09-11", timeframe: "MONTH" });
    expect(columnsCover(p)).toEqual({ from: "2025-10-01", to: "2026-09-30" });
  });

  it("works in quarters", () => {
    expect(columnsCover({ toDate: "2026-08-31", timeframe: "QUARTER", periods: 2 })).toEqual({
      from: "2025-12-01",
      to: "2026-08-31",
    });
  });
});

describe("normaliseProfitAndLossParams", () => {
  it("turns a multi-month range into the last month plus prior months", () => {
    expect(
      norm({ fromDate: "2026-01-01", toDate: "2026-08-31", timeframe: "MONTH", periods: 8 })
    ).toMatchObject({ fromDate: "2026-08-01", toDate: "2026-08-31", periods: 7 });
  });

  // 11 Sep 2026: toDate was today, and every comparative came back as the 1st
  // to the 11th of its month.
  it("runs the base period to month end so comparatives are whole months", () => {
    expect(
      norm({ fromDate: "2025-10-01", toDate: "2026-09-11", timeframe: "MONTH" })
    ).toMatchObject({ fromDate: "2026-09-01", toDate: "2026-09-30", periods: 11 });
  });

  it("widens a part-month base to the whole month when comparatives are asked for", () => {
    expect(
      norm({ fromDate: "2026-08-05", toDate: "2026-08-20", timeframe: "MONTH", periods: 3 })
    ).toMatchObject({ fromDate: "2026-08-01", toDate: "2026-08-31", periods: 3 });
  });

  it("uses whole quarters for a quarterly view", () => {
    expect(
      norm({ fromDate: "2026-01-01", toDate: "2026-08-31", timeframe: "QUARTER" })
    ).toMatchObject({ fromDate: "2026-06-01", toDate: "2026-08-31", periods: 2 });
  });

  it("caps at the 11 comparatives Xero allows", () => {
    expect(
      norm({ fromDate: "2024-01-01", toDate: "2026-08-31", timeframe: "MONTH" })
    ).toMatchObject({ fromDate: "2026-08-01", periods: 11 });
  });

  it("leaves a request that is already right untouched", () => {
    const ok = { fromDate: "2026-08-01", toDate: "2026-08-31", timeframe: "MONTH", periods: 7 };
    expect(norm(ok)).toBe(ok);
  });

  it("leaves a range without comparatives as one column", () => {
    const single = { fromDate: "2026-08-01", toDate: "2026-08-31", timeframe: "MONTH" };
    expect(norm(single)).toBe(single);
    const range = { fromDate: "2026-01-01", toDate: "2026-08-31" };
    expect(norm(range)).toBe(range);
  });
});

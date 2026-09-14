import { describe, expect, it } from "vitest";
import { fiscalYear, fiscalYearOfPeriod, yearEndMonth } from "./fiscal.js";

describe("yearEndMonth", () => {
  it("takes the month of shared.clients.year_end, as a string or a Date", () => {
    expect(yearEndMonth("2025-03-31")).toBe(3);
    expect(yearEndMonth(new Date("2025-12-31T00:00:00Z"))).toBe(12);
  });

  it("treats a client with no year end as December, as the check did before", () => {
    expect(yearEndMonth(null)).toBe(12);
    expect(yearEndMonth("")).toBe(12);
  });
});

describe("financial years are named by the year they end in", () => {
  it("puts STZA's April 2026 to March 2027 in 2027", () => {
    expect(fiscalYear("2026-04-01T00:00:00Z", 3)).toBe(2027);
    expect(fiscalYear("2027-03-31T00:00:00Z", 3)).toBe(2027);
    expect(fiscalYear("2026-03-31T00:00:00Z", 3)).toBe(2026);
    expect(fiscalYearOfPeriod("2026-08", 3)).toBe(2027);
    expect(fiscalYearOfPeriod("2026-03", 3)).toBe(2026);
  });

  it("gives the calendar year for a December year end, so Feldspar is unchanged", () => {
    expect(fiscalYear("2026-01-01T00:00:00Z", 12)).toBe(2026);
    expect(fiscalYear("2026-12-31T00:00:00Z", 12)).toBe(2026);
    expect(fiscalYearOfPeriod("2026-07", 12)).toBe(2026);
  });
});

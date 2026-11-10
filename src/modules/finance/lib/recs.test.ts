import { describe, expect, it } from "vitest";
import { actorLabel, dayLabel, defaultPeriod, isRecPath, isStale, money, periodChoices } from "./recs";

const ID = "12345678-1234-1234-1234-123456789012";

describe("rec paths", () => {
  it("lets through what the screens use", () => {
    for (const p of ["recs/compose", "recs/settings", `recs/${ID}/prepare`, `recs/${ID}/sign-off`, `recs/${ID}/items`, `recs/${ID}/items/${ID}`, `recs/${ID}/journals/${ID}/approve`,
      `recs/${ID}/evidence`, `recs/${ID}/evidence/fetch`, `recs/${ID}/evidence/${ID}`, `recs/${ID}/counterpart`]) {
      expect(isRecPath(p), p).toBe(true);
    }
  });
  it("keeps the agents' routes and anything else out", () => {
    for (const p of [`recs/${ID}/journals`, `recs/journals/${ID}/drafted`, "recs/journals/by-run/" + ID, "tasks", "recs/../xero", `recs/${ID}`, `recs/${ID}/evidence/x`, `recs/${ID}/evidence/fetch/more`]) {
      expect(isRecPath(p), p).toBe(false);
    }
  });
});

describe("what the screens show", () => {
  it("brackets credits and thousands-separates", () => {
    expect(money("18000")).toBe("18,000.00");
    expect(money("-9300.5")).toBe("(9,300.50)");
    expect(money(0)).toBe("0.00");
    expect(money(null)).toBe("-");
  });
  it("shows dates as the house style has them", () => {
    expect(dayLabel("2026-10-31")).toBe("31 Oct 2026");
    expect(dayLabel(null)).toBe("-");
  });
  it("names an agent and leaves a person", () => {
    expect(actorLabel("agent:fm1")).toBe("FM1");
    expect(actorLabel("jo@example.com")).toBe("jo@example.com");
  });
  it("starts on the last complete month, and keeps an older month on the picker", () => {
    const today = new Date("2026-11-01T09:00:00Z");
    expect(defaultPeriod(today)).toBe("2026-10");
    expect(periodChoices("2026-10", 3, today)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(periodChoices("2025-01", 2, today)[0]).toBe("2025-01");
  });
  it("re-reads a list that has gone stale", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale("2026-11-01T11:30:00Z", now)).toBe(false);
    expect(isStale("2026-11-01T10:30:00Z", now)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { monthSpend, usdText } from "./agent-spend";
import type { AgentRunRow } from "./api";

let n = 0;
const run = (queued_at: string, cost_usd: string | null, status: AgentRunRow["status"] = "succeeded"): AgentRunRow => ({
  id: `r${++n}`, parent_run_id: null, agent: null, instruction: "x", status, session_id: null, output: null, error: null,
  tools_used: [], files_touched: [], duration_ms: null, cost_usd, wip_ref: null, requested_by_email: "jo@example.com",
  requested_by_role: null, queued_at, started_at: null, finished_at: null,
});

describe("monthSpend", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("adds this month's recorded costs and counts the runs without one", () => {
    const out = monthSpend(
      [
        run("2026-10-02T09:00:00Z", "0.120000"),
        run("2026-10-27T14:00:00Z", "0.080000"),
        run("2026-10-27T15:00:00Z", null, "failed"),
        run("2026-09-30T10:00:00Z", "0.500000"),
      ],
      now
    );
    expect(out.usd).toBeCloseTo(0.2, 6);
    expect(out).toMatchObject({ costed: 2, uncosted: 1 });
  });

  it("leaves out runs still going", () => {
    expect(monthSpend([run("2026-10-28T11:00:00Z", null, "running")], now)).toEqual({ usd: 0, costed: 0, uncosted: 0 });
  });

  it("uses UK time for the month boundary", () => {
    // 31 October 23:30 UTC is still October in London (GMT from 25 October).
    const out = monthSpend([run("2026-10-31T23:30:00Z", "0.100000")], new Date("2026-10-31T23:45:00Z"));
    expect(out.costed).toBe(1);
    // 31 August 23:30 UTC is already 1 September in London (BST).
    const sep = monthSpend([run("2026-08-31T23:30:00Z", "0.100000")], new Date("2026-09-15T12:00:00Z"));
    expect(sep.costed).toBe(1);
  });
});

describe("usdText", () => {
  it("shows dollars and cents, and a floor for tiny totals", () => {
    expect(usdText(0)).toBe("$0.00");
    expect(usdText(0.004)).toBe("<$0.01");
    expect(usdText(1.234)).toBe("$1.23");
  });
});

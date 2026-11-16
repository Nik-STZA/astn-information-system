import { describe, expect, it } from "vitest";
import { actorLabel, dayLabel, defaultPeriod, isRecPath, isStale, kindLabel, money, periodChoices, recGroups, sideLabel, type RecRow } from "./recs";

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

describe("reconciling item wording", () => {
  it("talks about the bank statement only on a bank rec", () => {
    expect(sideLabel("bank_only", true)).toBe("On the statement, not in Xero");
    expect(sideLabel("bank_only", false)).toBe("In the evidence, not in Xero");
    expect(sideLabel("xero_only", false)).toBe("In Xero, not in the evidence");
    expect(kindLabel("timing", true)).toMatch(/through the bank/);
    expect(kindLabel("timing", false)).not.toMatch(/bank/);
    expect(kindLabel("error", false)).toBe(kindLabel("error", true));
  });
});

describe("the month's list grouped and filtered", () => {
  const row = (id: string, name: string, line_key: string | null, by: Array<[string, string]>) => ({
    id, account_name: name, line_key, ledger: "100.00", support: "100.00", difference: "0.00", ties: true, mixed_currency: false, companies: by.length,
    by_entity: by.map(([entity_id, ledger]) => ({ entity_id, ledger, support: ledger, difference: "0.00", ties: true })),
  }) as unknown as RecRow;
  const lines = [{ key: "cash", line: "Cash and bank" }, { key: "ap", line: "Trade creditors" }];
  const rows = [row("1", "Accounts payable", "ap", [["e1", "40.00"], ["e2", "60.00"]]), row("2", "Business account", "cash", [["e1", "100.00"]]), row("3", "Suspense", null, [["e2", "5.00"]])];

  it("groups by line in the pack's order, unplaced last", () => {
    expect(recGroups(rows, lines, { order: "line", entity: "" }).map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["Cash and bank", ["2"]], ["Trade creditors", ["1"]], ["Not placed", ["3"]],
    ]);
    expect(recGroups(rows, lines, { order: "name", entity: "" })).toEqual([expect.objectContaining({ label: null, rows })]);
  });

  it("shows one company's own figures and leaves out what it does not hold", () => {
    const g = recGroups(rows, lines, { order: "line", entity: "e2" });
    expect(g.map((x) => x.label)).toEqual(["Trade creditors", "Not placed"]);
    expect(g[0].rows[0]).toMatchObject({ ledger: "60.00", companies: 1 });
  });

  it("puts intercompany receivables, payables and intercompany loans in one group where the receivables sit", () => {
    const icLines = [{ key: "ar", line: "Trade debtors" }, { key: "ic_asset", line: "Intercompany receivables" }, { key: "loans", line: "Loans" }, { key: "ic_liab", line: "Intercompany payables" }];
    const ic = [row("a", "Debtors", "ar", [["e1", "1.00"]]), row("b", "Beta intercompany", "ic_asset", [["e1", "1.00"]]), row("c", "Alpha intercompany", "ic_liab", [["e2", "1.00"]]),
      row("d", "Alpha Intercompany Loan", "loans", [["e1", "1.00"]]), row("e", "Bank loan", "loans", [["e1", "1.00"]])];
    expect(recGroups(ic, icLines, { order: "line", entity: "" }).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["ar", ["a"]], ["intercompany", ["b", "c", "d"]], ["loans", ["e"]],
    ]);
  });
});

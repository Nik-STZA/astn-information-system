import { describe, expect, it } from "vitest";
import { balanceOf, batchLines, batchable, blankLine, draftsIn, filtered, groupOf, grouped, isJournalPath, needsXeroCheck, pence, sourceKey, sourceLabel, toLines, type JournalRow } from "./journals";

const ID = "12345678-1234-1234-1234-123456789012";
const line = (account_code: string, debit = "", credit = "", description = "") => ({ account_code, description, debit, credit });

describe("journal paths", () => {
  it("lets through what the page uses", () => {
    for (const p of ["journals", "journals/refresh", `journals/${ID}/approve`, `journals/${ID}/reject`, "journals/approve-batch"]) expect(isJournalPath(p), p).toBe(true);
  });
  it("keeps anything else out", () => {
    for (const p of [`journals/${ID}`, "journals/../xero", `journals/${ID}/drafted`, "recs/compose", "journals/refresh/x"]) expect(isJournalPath(p), p).toBe(false);
  });
});

describe("the lines a person types", () => {
  it("reads money with commas, and refuses anything else", () => {
    expect(pence("1,250.5")).toBe(125050);
    expect(pence("")).toBe(0);
    expect(pence("12.345")).toBeNull();
    expect(pence("-5")).toBeNull();
  });

  it("checks the balance as it is typed", () => {
    const b = balanceOf([line("485", "250"), line("825", "", "240"), blankLine()]);
    expect(b).toMatchObject({ debits: 25000, credits: 24000, difference: 1000, issues: [] });
    expect(balanceOf([line("485", "250"), line("825", "", "250")]).difference).toBe(0);
  });

  it("says what is wrong with a line", () => {
    const b = balanceOf([line("485", "10", "10"), line("", "5"), line("825"), line("826", "x")]);
    expect(b.issues).toEqual([
      "Line 1: a debit or a credit, not both",
      "Line 2: needs an account code",
      "Line 3: needs an amount",
      "Line 4: an amount is not money",
    ]);
  });

  it("sends debits positive and credits negative, without blank rows", () => {
    expect(toLines([line("485", "250", "", "Audit fee"), blankLine(), line("825", "", "250")])).toEqual([
      { account_code: "485", description: "Audit fee", amount: 250 },
      { account_code: "825", description: "", amount: -250 },
    ]);
  });
});

describe("the list", () => {
  const row = (state: JournalRow["state"], extra: Partial<JournalRow> = {}) => ({ state, kind: "register", xero_checked_at: null, source: "person", ...extra }) as JournalRow;

  it("groups by where each journal is, and leaves out superseded ones", () => {
    expect(groupOf({ state: "proposed" })).toBe("waiting");
    expect(groupOf({ state: "draft_created" })).toBe("draft");
    expect(groupOf({ state: "superseded" })).toBeNull();
    const g = grouped([row("proposed"), row("posted"), row("superseded")]);
    expect(g.map((x) => x.rows.length)).toEqual([1, 0, 0, 1, 0]);
    expect(g[0].title).toBe("Waiting for you");
  });

  it("names where a journal came from", () => {
    expect(sourceLabel({ source: "person" })).toBe("Person");
    expect(sourceLabel({ source: "fm1" })).toBe("FM1");
    expect(sourceLabel({ source: "rec" })).toBe("From a reconciliation");
    expect(sourceLabel({ source: "schedule" })).toBe("Monthly release");
  });

  it("checks Xero for drafts not looked at lately, a rec's included", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(needsXeroCheck([row("draft_created")], now)).toBe(true);
    expect(needsXeroCheck([row("draft_created", { xero_checked_at: "2026-11-02T11:55:00Z" })], now)).toBe(false);
    expect(needsXeroCheck([row("draft_created", { xero_checked_at: "2026-11-02T11:00:00Z" })], now)).toBe(true);
    expect(needsXeroCheck([row("draft_created", { kind: "rec" })], now)).toBe(true);
    expect(needsXeroCheck([row("draft_created", { kind: "rec", xero_checked_at: "2026-11-02T11:55:00Z" })], now)).toBe(false);
    expect(needsXeroCheck([row("proposed")], now)).toBe(false);
  });
});

describe("accrual pairs, filters and batch approval", () => {
  const base = { kind: "register", id: "a", jnl: "JNL-60", entity_id: "e1", entity_name: "Alpha Ltd", period: "2026-11", journal_date: "2026-11-30",
    narration: "Accrual: Example, November 2026 services", lines: [], total: "750.00", reason: null, source: "accrual", proposed_by: "platform:accruals",
    state: "proposed", approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, xero_journal_no: null, xero_status: null, xero_checked_at: null,
    drafted_at: null, last_error: null, retry_state: null, can_retry: false, rec: null, created_at: "2026-11-19T09:00:00Z",
    pair: { reversal_date: "2026-12-01", reversal_narration: "Reversal: Example, November 2026 services", accrual_xero_journal_no: null, reversal_xero_journal_no: null, reversal_xero_status: null, accrual_item_id: "i1", backfill: false },
  } as JournalRow;
  const person = { ...base, id: "b", jnl: "JNL-61", entity_id: "e2", entity_name: "Beta Ltd", source: "person", narration: "Reclass", pair: null } as JournalRow;
  const fm1 = { ...person, id: "c", source: "fm1" } as JournalRow;
  const rec = { ...person, id: "d", kind: "rec", source: "rec" } as JournalRow;

  it("labels a pair and files any agent under one choice", () => {
    expect(sourceLabel(base)).toBe("Accrual pair");
    expect(sourceKey(fm1)).toBe("agent");
    expect(sourceKey(base)).toBe("accrual");
  });

  it("filters by source and company", () => {
    const rows = [base, person, fm1, rec];
    expect(filtered(rows, { source: "accrual" }).map((r) => r.id)).toEqual(["a"]);
    expect(filtered(rows, { source: "agent" }).map((r) => r.id)).toEqual(["c"]);
    expect(filtered(rows, { entity: "e2" }).map((r) => r.id)).toEqual(["b", "c", "d"]);
    expect(filtered(rows, {})).toHaveLength(4);
  });

  it("ticks only register journals still waiting, and lists a pair as two drafts", () => {
    expect([base, person, rec, { ...person, state: "approved" } as JournalRow].map(batchable)).toEqual([true, true, false, false]);
    expect(batchLines([base, person])).toEqual([
      "JNL-60 Alpha Ltd, 2026-11-30: Accrual: Example, November 2026 services, 750.00, reversed 2026-12-01 (two drafts)",
      "JNL-61 Beta Ltd, 2026-11-30: Reclass, 750.00",
    ]);
    expect(draftsIn([base, person])).toBe(3);
  });
});

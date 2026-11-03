import { describe, expect, it } from "vitest";
import { journalIssues, cleanLines, totalOf, ledgerIssues, journalKey, attemptState, presentedText, approvalFor, failureText, stateFromXero, sourceOf, registerGate } from "./journals";
import { checkApprovalText } from "./journal";
import { agentJournals } from "./agent-journals";

const GOOD = {
  entity: "alpha-ltd", date: "2026-10-31", narration: "October audit fee accrual", reason: "The audit fee for the year is accrued monthly.",
  lines: [{ account_code: "485", description: "Audit fee", amount: 250 }, { account_code: "825", description: "Accruals", amount: -250 }],
};

describe("a proposal", () => {
  it("passes when it balances and says what it is", () => {
    expect(journalIssues(GOOD, { source: "person" })).toEqual([]);
    expect(journalIssues(GOOD, { source: "agent" })).toEqual([]);
  });

  it("refuses one that does not balance, and says by how much", () => {
    const issues = journalIssues({ ...GOOD, lines: [{ account_code: "485", amount: 250 }, { account_code: "825", amount: -240.5 }] }, { source: "person" });
    expect(issues).toEqual(["the journal does not balance: it is out by 9.50"]);
  });

  it("refuses a single line, a nil line, fractions of a penny and a missing code", () => {
    expect(journalIssues({ ...GOOD, lines: [GOOD.lines[0]] }, { source: "person" })).toContain("at least 2 lines are required");
    const issues = journalIssues({ ...GOOD, lines: [{ account_code: "485", amount: 0 }, { account_code: "", amount: 10.001 }, null] }, { source: "person" });
    expect(issues).toContain("line 1: amount must be money, and not zero");
    expect(issues).toContain("line 2: amount must be money, and not zero");
    expect(issues).toContain("line 2: account code is required");
    expect(issues).toContain("line 3: is not a journal line");
    // A net is not worked out from lines that are not money.
    expect(issues.some((i) => /balance/.test(i))).toBe(false);
  });

  it("needs a company, a real date and a short narration", () => {
    const issues = journalIssues({ ...GOOD, entity: "", date: "2026-02-30", narration: "x".repeat(121) }, { source: "person" });
    expect(issues).toContain("choose the company");
    expect(issues).toContain("date must be a real date, YYYY-MM-DD");
    expect(issues.some((i) => /narration to 120/.test(i))).toBe(true);
  });

  it("asks an agent for its reason, and lets a person leave it out", () => {
    const { reason, ...noReason } = GOOD;
    expect(reason).toBeTruthy();
    expect(journalIssues(noReason, { source: "agent" })).toEqual(["reason is required"]);
    expect(journalIssues(noReason, { source: "person" })).toEqual([]);
  });

  it("stores lines to the penny, with a tax type", () => {
    expect(cleanLines([{ account_code: " 485 ", amount: "250.10" }])).toEqual([{ account_code: "485", description: "", amount: 250.1, tax_type: "NONE" }]);
    expect(totalOf(GOOD.lines)).toBe("250.00");
  });
});

describe("the ledger checks", () => {
  const accounts = [
    { Code: "485", Name: "Audit", Status: "ACTIVE", Class: "EXPENSE", Type: "OVERHEADS" },
    { Code: "825", Name: "Accruals", Status: "ACTIVE", Class: "LIABILITY", Type: "CURRLIAB" },
    { Code: "090", Name: "Bank", Status: "ACTIVE", Class: "ASSET", Type: "BANK" },
    { Code: "999", Name: "Old", Status: "ARCHIVED", Class: "EXPENSE", Type: "OVERHEADS" },
  ];
  it("passes a journal on live accounts in an open month", () => {
    expect(ledgerIssues(GOOD, { accounts, lockDates: {}, entityNames: ["alpha-ltd"] })).toEqual([]);
  });
  it("refuses an unknown, archived or bank account, and a locked month, with the journal write's own words", () => {
    const body = { ...GOOD, lines: [{ account_code: "123", amount: 1 }, { account_code: "999", amount: 1 }, { account_code: "090", amount: -2 }] };
    const issues = ledgerIssues(body, { accounts, lockDates: { periodLockDate: "2026-10-31" }, entityNames: ["alpha-ltd"] });
    expect(issues.length).toBe(4);
    expect(issues.join(" ")).toMatch(/123 does not exist/);
    expect(issues.join(" ")).toMatch(/ARCHIVED/);
    expect(issues.join(" ")).toMatch(/bank account/);
    expect(issues.join(" ")).toMatch(/lock date 2026-10-31/);
  });
  it("does not ask for an approval that cannot exist yet", () => {
    expect(ledgerIssues(GOOD, { accounts, entityNames: ["alpha-ltd"] }).some((i) => /approval/i.test(i))).toBe(false);
  });
});

describe("going to Xero", () => {
  it("keys a draft on the journal and its attempt, never on the run or the click", () => {
    expect(journalKey({ id: "abc", attempts: 1 })).toBe("journal-abc-1");
    expect(journalKey({ id: "abc", attempts: 3 })).toBe("journal-abc-3");
  });

  it("knows when approving again is safe", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(attemptState(null, now)).toBe("go");
    expect(attemptState({ outcome: "pending", created_at: "2026-11-02T11:59:00Z" }, now)).toBe("live");
    // A claim left pending is a crash part-way: it may be in Xero.
    expect(attemptState({ outcome: "pending", created_at: "2026-11-02T11:00:00Z" }, now)).toBe("unknown");
    expect(attemptState({ outcome: "draft" }, now)).toBe("drafted");
    expect(attemptState({ outcome: "failed", http_status: 400 }, now)).toBe("retry");
    expect(attemptState({ outcome: "failed", http_status: 0 }, now)).toBe("unknown");
    expect(attemptState({ outcome: "failed", http_status: 503 }, now)).toBe("unknown");
    expect(attemptState({ outcome: "failed", http_status: 429 }, now)).toBe("unknown");
  });

  it("records an approval the journal write accepts: company, date, every code and amount", () => {
    const j = { journal_date: "2026-10-31", narration: GOOD.narration, lines: GOOD.lines };
    const text = presentedText(j, "Alpha Ltd");
    expect(checkApprovalText(text, { entityNames: ["alpha-ltd", "Alpha Ltd"], date: "2026-10-31", lines: GOOD.lines })).toEqual([]);
    const a = approvalFor(j, { entityName: "Alpha Ltd", actorEmail: "cfo@example.com", now: new Date("2026-11-02T12:00:00Z") });
    expect(a).toMatchObject({ approved_by: "cfo@example.com", approved_at: "2026-11-02T12:00:00.000Z" });
    expect(a.agreed_text).toMatch(/Xero draft/);
  });

  it("says why an approval did not end in a draft", () => {
    expect(failureText({ status: 422, body: { issues: [{ code: "PERIOD_LOCKED", detail: "date 2026-10-31 falls on or before the lock date 2026-10-31" }] } })).toMatch(/lock date/);
    expect(failureText({ status: 502, body: { stage: "xero", http_status: 400, xero_error: { Elements: [{ ValidationErrors: [{ Message: "Account code is not valid" }] }] } } }))
      .toBe("Xero refused it (400): Account code is not valid.");
    expect(failureText({ status: 404, body: { error: "entity not found or not connected" } })).toBe("entity not found or not connected");
  });

  it("moves to posted only when Xero says POSTED", () => {
    expect(stateFromXero("POSTED")).toBe("posted");
    expect(stateFromXero("DRAFT")).toBeNull();
    expect(stateFromXero("VOIDED")).toBeNull();
  });

  it("names where a journal came from", () => {
    expect(sourceOf({ kind: "register", source: "person", proposed_by: "jo@example.com" })).toBe("person");
    expect(sourceOf({ kind: "register", source: "agent", proposed_by: "agent:fm1" })).toBe("fm1");
    expect(sourceOf({ kind: "rec", proposed_by: "agent:fm1" })).toBe("rec");
  });
});

describe("the gate for every other caller", () => {
  const p = (state, journal_date = "2026-10-31", lines = GOOD.lines) => ({ state, journal_date, lines });
  const input = { date: "2026-10-31", lines: GOOD.lines };
  it("holds a journal waiting or approved on the Journals page, on any date", () => {
    expect(registerGate({ proposals: [p("proposed")], input }).refuse).toMatch(/Journals page/);
    expect(registerGate({ proposals: [p("approved", "2026-09-30")], input }).refuse).toMatch(/Journals page/);
  });
  it("holds the month's rejected or drafted one, so it cannot go round the side or twice", () => {
    expect(registerGate({ proposals: [p("rejected")], input }).refuse).toMatch(/rejected/);
    expect(registerGate({ proposals: [p("draft_created")], input }).refuse).toBeTruthy();
    expect(registerGate({ proposals: [p("rejected", "2026-09-30")], input })).toEqual({});
  });
  it("leaves any other journal alone", () => {
    const other = [{ account_code: "485", amount: 99 }, { account_code: "825", amount: -99 }];
    expect(registerGate({ proposals: [p("proposed")], input: { ...input, lines: other } })).toEqual({});
    expect(registerGate({ proposals: [], input })).toEqual({});
  });
});

describe("the agent tool", () => {
  const sent = [];
  const tool = agentJournals({
    apiRequest: async (method, path, body, headers) => { sent.push({ method, path, body, headers }); return { ok: true, status: 201, body: { id: "j1" } }; },
    requesterOf: async () => "jo@example.com",
  });

  it("proposes as the person who asked, naming the agent and the run", async () => {
    const r = await tool.call({ id: "11111111-1111-1111-1111-111111111111", agent: "fm1", client: { slug: "sample-group" } }, "propose_journal", GOOD);
    expect(r.saved).toBe(true);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/api/finance/clients/sample-group/journals" });
    expect(sent[0].headers).toEqual({ "X-Actor-Email": "jo@example.com", "X-Work-Via": "agent:fm1:11111111-1111-1111-1111-111111111111" });
  });

  it("refuses any other agent before asking finance-api", async () => {
    const before = sent.length;
    const r = await tool.call({ id: "x", agent: "ap-clerk", client: { slug: "sample-group" } }, "propose_journal", GOOD);
    expect(r.error).toMatch(/FM1 or the FC/);
    expect(sent.length).toBe(before);
  });
});

describe("journal numbers", () => {
  it("names a journal JNL-n, and nothing when it has no number", async () => {
    const { jnlRef } = await import("./journals");
    expect(jnlRef(7)).toBe("JNL-7");
    expect(jnlRef(null)).toBeNull();
  });

  it("lists a month's journals for an agent with their numbers", async () => {
    const calls = [];
    const tool = agentJournals({
      apiRequest: async (method, path) => {
        calls.push({ method, path });
        return { ok: true, status: 200, body: { period: "2026-10", journals: [
          { jnl: "JNL-3", entity_name: "Example Ltd", journal_date: "2026-10-31", narration: "Accrual", total: "100.00", state: "proposed", lines: [], rec: null },
          { jnl: "JNL-4", entity_name: "Example Ltd", journal_date: "2026-10-31", narration: "Release", total: "50.00", state: "draft_created", xero_journal_no: "88", lines: [], rec: { id: "r1", account_name: "Prepayments" } },
        ] } };
      },
      requesterOf: async () => "jo@example.com",
    });
    const r = await tool.call({ id: "x", agent: "fc", client: { slug: "sample-group" } }, "list_journals", { period: "2026-10" });
    expect(calls).toEqual([{ method: "GET", path: "/api/finance/clients/sample-group/journals?period=2026-10" }]);
    expect(r.journals.map((j) => j.jnl)).toEqual(["JNL-3", "JNL-4"]);
    expect(r.journals[1]).toMatchObject({ xero_journal_no: "88", on_rec: "Prepayments" });
    expect((await tool.call({ id: "x", agent: "fc", client: { slug: "s" } }, "list_journals", { period: "Oct" })).error).toMatch(/YYYY-MM/);
  });

  it("tells the agent the number of the journal it proposed", async () => {
    const tool = agentJournals({
      apiRequest: async () => ({ ok: true, status: 201, body: { id: "j1", jnl: "JNL-9" } }),
      requesterOf: async () => "jo@example.com",
    });
    const r = await tool.call({ id: "11111111-1111-1111-1111-111111111111", agent: "fm1", client: { slug: "sample-group" } }, "propose_journal", GOOD);
    expect(r.jnl).toBe("JNL-9");
    expect(r.note).toMatch(/JNL-9/);
  });
});


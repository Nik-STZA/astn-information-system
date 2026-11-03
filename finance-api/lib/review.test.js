import { describe, expect, it } from "vitest";
import { waitsAs, producedBy, billAgent, billItem, recItem, recJournalItem, journalItem, approvalItem, combine, counts } from "./review";

const slug = "alpha-group";
const NOW = Date.parse("2026-11-02T12:00:00Z");

const bill = (over = {}) => ({
  id: "b1", state: "exception", file_name: "inv.pdf", source: "files_inbox", created_at: "2026-10-20T09:00:00Z", decided_at: null,
  entity_slug: "alpha-ltd", entity_name: "Alpha Ltd", supplier: "Sample Supplies Ltd", number: "INV-1", total: "120.00", currency: "GBP",
  reasons: [{ check: "duplicate" }], recommended: true, recommendation_agent: "ap-clerk", recommended_at: "2026-10-21T09:00:00Z",
  reviewed_at: "2026-10-22T09:00:00Z", review_verdict: "agree", review_agents: ["fm2"], ...over,
});

describe("the viewer's queue", () => {
  it("reads CFO and FC roles, and nothing else", () => {
    expect(waitsAs("Fractional CFO")).toBe("CFO");
    expect(waitsAs("Finance Director")).toBe("CFO");
    expect(waitsAs("Financial Controller")).toBe("FC");
    expect(waitsAs("FC")).toBe("FC");
    expect(waitsAs("Bookkeeper")).toBeNull();
    expect(waitsAs(null)).toBeNull();
  });

  it("names agents and keeps people", () => {
    expect(producedBy("agent:fm1")).toBe("FM1");
    expect(producedBy("ap-clerk")).toBe("AP Clerk");
    expect(producedBy("jo.bloggs@example.com")).toBe("jo.bloggs@example.com");
    expect(producedBy(null)).toBeNull();
  });
});

describe("bills", () => {
  it("an open bill no agent is working on waits on the CFO", () => {
    const i = billItem(bill(), { slug, activeAgents: [] });
    expect(i).toMatchObject({ kind: "bill", waiting_on: "CFO", company: "Alpha Ltd", amount: "120.00", currency: "GBP", produced_by: "AP Clerk", title: "Sample Supplies Ltd, INV-1" });
    expect(i.since).toBe("2026-10-22T09:00:00.000Z");
    expect(i.status).toMatch(/1 check to look at/);
    expect(i.href).toBe("/finance/clients/alpha-group/bills?entity=alpha-ltd&tab=exceptions&item=b1");
  });

  it("a bill an agent is working on is with the preparer, on the agents tab", () => {
    const row = bill({ recommended: false, review_agents: [], review_verdict: null });
    expect(billAgent(row, ["ap-clerk"])).toBe("ap");
    const i = billItem(row, { slug, activeAgents: ["ap-clerk"] });
    expect(i.waiting_on).toBe("Preparer");
    expect(i.status).toBe("With AP Clerk now");
    expect(i.href).toContain("tab=agents");
    // The same bill, the clerk not running: the CFO, so nothing is left unseen.
    expect(billItem(row, { slug, activeAgents: [] }).waiting_on).toBe("CFO");
  });

  it("FM2 next once recommended, and the FC only when running", () => {
    expect(billAgent(bill({ review_agents: [], review_verdict: null }), ["fm2"])).toBe("fm2");
    expect(billAgent(bill(), ["fc"])).toBe("fc");
    expect(billAgent(bill({ review_agents: ["fm2", "fc"] }), ["fc"])).toBeNull();
  });

  it("an approved bill waits to be sent, from its decision", () => {
    const i = billItem(bill({ state: "approved", decided_at: "2026-10-25T09:00:00Z" }), { slug });
    expect(i.status).toMatch(/sent to Xero/);
    expect(i.since).toBe("2026-10-25T09:00:00.000Z");
  });

  it("written, skipped and rejected bills are not waiting", () => {
    for (const state of ["written", "skipped", "rejected", "superseded"]) expect(billItem(bill({ state }), { slug })).toBeNull();
  });
});

describe("reconciliations", () => {
  const rec = (over = {}) => ({
    id: "r1", period: "2026-10", status: "with_fc", owner: "FM1", prepared_by: "agent:fm1", prepared_at: "2026-11-01T10:00:00Z",
    reviewed_at: null, review_note: null, recheck_reason: null, dropped_at: null, updated_at: "2026-11-01T11:00:00Z", account_name: "Prepayments", ...over,
  });

  it("with the FC, with the CFO, and sent back", () => {
    expect(recItem(rec(), { slug })).toMatchObject({ kind: "rec", waiting_on: "FC", title: "Prepayments, October 2026", produced_by: "FM1", since: "2026-11-01T10:00:00.000Z", href: "/finance/clients/alpha-group/reconciliations/r1" });
    expect(recItem(rec({ status: "with_cfo", reviewed_at: "2026-11-01T12:00:00Z" }), { slug })).toMatchObject({ waiting_on: "CFO", since: "2026-11-01T12:00:00.000Z" });
    const back = recItem(rec({ status: "sent_back", review_note: "Item 3 is missing its invoice" }), { slug });
    expect(back.waiting_on).toBe("Preparer");
    expect(back.status).toMatch(/Item 3 is missing/);
  });

  it("says when a figure moved", () => {
    expect(recItem(rec({ recheck_reason: "moved" }), { slug }).status).toMatch(/figure moved/);
  });

  it("not started, in progress, signed off and dropped are not waiting on review", () => {
    for (const status of ["not_started", "in_progress", "signed_off"]) expect(recItem(rec({ status }), { slug })).toBeNull();
    expect(recItem(rec({ dropped_at: "2026-11-01T00:00:00Z" }), { slug })).toBeNull();
  });
});

describe("journals", () => {
  const lines = [{ account_code: "485", amount: 250 }, { account_code: "825", amount: -250 }];
  const rj = (over = {}) => ({
    id: "j1", state: "proposed", narration: "Insurance release October", lines, proposed_by: "agent:fm1", approved_at: null, created_at: "2026-11-01T09:00:00Z",
    entity_name: "Alpha Ltd", rec_id: "r1", period: "2026-10", account_name: "Prepayments", run_status: null, run_queued_at: null, post_outcome: null, post_http: null, ...over,
  });

  it("a rec's proposal waits on the CFO, acted on at its rec", () => {
    const i = recJournalItem(rj(), { slug, now: NOW });
    expect(i).toMatchObject({ kind: "rec_journal", waiting_on: "CFO", amount: "250.00", produced_by: "FM1", href: "/finance/clients/alpha-group/reconciliations/r1" });
    expect(i.status).toMatch(/Proposed on Prepayments, October 2026/);
  });

  it("names a journal by its number", () => {
    expect(recJournalItem(rj({ jnl_no: 12 }), { slug, now: NOW })).toMatchObject({ jnl: "JNL-12", title: "JNL-12 Insurance release October" });
    expect(recJournalItem(rj(), { slug, now: NOW })).toMatchObject({ jnl: null, title: "Insurance release October" });
  });

  it("an approved rec journal: hidden while its run is live, listed when it needs a decision", () => {
    const live = rj({ state: "approved", approved_at: "2026-11-02T11:58:00Z", run_status: "running", run_queued_at: "2026-11-02T11:58:00Z" });
    expect(recJournalItem(live, { slug, now: NOW })).toBeNull();
    const unknown = rj({ state: "approved", approved_at: "2026-11-01T10:00:00Z", run_status: "failed", post_outcome: "failed", post_http: "502" });
    expect(recJournalItem(unknown, { slug, now: NOW }).status).toMatch(/Check Xero/);
    const refused = rj({ state: "approved", approved_at: "2026-11-01T10:00:00Z", run_status: "succeeded", post_outcome: "failed", post_http: "400" });
    expect(recJournalItem(refused, { slug, now: NOW }).status).toMatch(/refused/);
  });

  const j = (over = {}) => ({
    id: "g1", state: "proposed", period: "2026-10", narration: "October audit fee accrual", lines, source: "person", proposed_by: "jo.bloggs@example.com",
    approved_at: null, created_at: "2026-11-01T08:00:00Z", last_error: null, entity_name: "Alpha Ltd", post_outcome: null, post_http: null, post_at: null, ...over,
  });

  it("a register journal waits on the CFO, on the Journals page for its month", () => {
    const i = journalItem(j(), { slug, now: NOW });
    expect(i).toMatchObject({ kind: "journal", waiting_on: "CFO", produced_by: "jo.bloggs@example.com", href: "/finance/clients/alpha-group/journals?period=2026-10" });
    expect(journalItem(j({ source: "agent", proposed_by: "agent:fc" }), { slug, now: NOW }).produced_by).toBe("FC");
  });

  it("an approved register journal in flight is not listed; a stale claim is", () => {
    const pending = j({ state: "approved", approved_at: "2026-11-02T11:59:00Z", post_outcome: "pending", post_at: "2026-11-02T11:59:00Z" });
    expect(journalItem(pending, { slug, now: NOW })).toBeNull();
    const stale = j({ state: "approved", approved_at: "2026-11-01T11:59:00Z", post_outcome: "pending", post_at: "2026-11-01T11:59:00Z" });
    expect(journalItem(stale, { slug, now: NOW }).status).toMatch(/may be in Xero/);
  });

  it("drafted, posted and rejected journals are not waiting", () => {
    for (const state of ["draft_created", "posted", "rejected", "superseded"]) {
      expect(journalItem(j({ state }), { slug, now: NOW })).toBeNull();
      expect(recJournalItem(rj({ state }), { slug, now: NOW })).toBeNull();
    }
  });
});

describe("the Approvals folders", () => {
  const w = (over = {}) => ({
    id: "w1", ref: "AP-2026-10-001", type: "ap", status: "pending-cfo", panel: "awaiting-decision", title: "October AP batch", amount_total: "1500.00",
    blocked_on: null, drafter_role: "clerk", drafter_email: null, drafter_agent: "ap-clerk", drafted_at: "2026-10-30T09:00:00Z", updated_at: "2026-10-31T09:00:00Z",
    created_at: "2026-10-30T09:00:00Z", entity_name: null, ...over,
  });

  it("each live folder maps to who has it", () => {
    expect(approvalItem(w(), { slug })).toMatchObject({ kind: "approval", waiting_on: "CFO", company: "Group", produced_by: "AP Clerk", href: "/finance/clients/alpha-group/approvals?item=AP-2026-10-001" });
    expect(approvalItem(w({ status: "pending-fc", panel: "in-progress-upstream" }), { slug }).waiting_on).toBe("FC");
    expect(approvalItem(w({ status: "pending-fm", panel: "in-progress-upstream" }), { slug }).waiting_on).toBe("FM");
    expect(approvalItem(w({ status: "sent-back", panel: "in-progress-upstream" }), { slug }).waiting_on).toBe("Preparer");
    const out = approvalItem(w({ panel: "blocked-external", blocked_on: "the bank" }), { slug });
    expect(out.waiting_on).toBe("Outside");
    expect(out.status).toMatch(/the bank/);
  });

  it("opens the item's Work task, where it is answered and closed", () => {
    expect(approvalItem(w({ task_id: "t1" }), { slug }).href).toBe("/finance/clients/alpha-group/work?task=t1");
  });

  it("finished and upcoming items stay on the board, not in the inbox", () => {
    expect(approvalItem(w({ status: "posted", panel: "activity" }), { slug })).toBeNull();
    expect(approvalItem(w({ panel: "upcoming" }), { slug })).toBeNull();
  });
});

describe("one list", () => {
  const item = (kind, since, waiting_on, title = kind) => ({ kind, since, waiting_on, title });

  it("oldest first, undated last, and marked for the viewer's role", () => {
    const out = combine([
      item("journal", "2026-11-01T00:00:00.000Z", "CFO"),
      null,
      item("rec", "2026-10-01T00:00:00.000Z", "FC"),
      item("approval", null, "CFO"),
      item("bill", "2026-10-15T00:00:00.000Z", "Preparer"),
    ], "CFO");
    expect(out.map((i) => i.kind)).toEqual(["rec", "bill", "journal", "approval"]);
    expect(out.filter((i) => i.for_you).map((i) => i.kind)).toEqual(["journal", "approval"]);
    expect(counts(out)).toEqual({ total: 4, for_you: 2, by_kind: { rec: 1, bill: 1, journal: 1, approval: 1 } });
  });

  it("a viewer with no review role has nothing for them", () => {
    expect(combine([item("bill", "2026-10-15T00:00:00.000Z", "CFO")], null)[0].for_you).toBe(false);
  });
});

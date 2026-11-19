import { describe, expect, it } from "vitest";
import {
  proposalIssues, accountIssues, applicablePrecedents, citeOrDepart, decisionPlan, accruesIn, scheduleAt, tieOut,
  continuity, pairFor, reversalLines, reversalNarration, pairKeys, pairAttempt, matchClearings, historyView,
  promoteText, accrualAccountFor, MAX_NARRATION,
} from "./accruals";

const ALPHA = "e-alpha";
const BETA = "e-beta";

const GOOD = {
  entity: "alpha-ltd", period: "2026-11", supplier: "Jo Bloggs Consulting", contact_id: "c-jb", test: "continuity",
  lines: [{ account_code: "412", amount: 750, description: "November services" }],
  service_from: "2026-11-01", service_to: "2026-11-30", basis_kind: "last_bill", basis: "JB/011 for October, 750.00 a month",
  evidence: [{ invoice_id: "inv-11", ref: "JB/011" }], confidence: "high", precedent_ids: [],
};

describe("a proposal", () => {
  it("passes when it says what, why and on what evidence", () => {
    expect(proposalIssues(GOOD)).toEqual([]);
  });

  it("refuses an unknown test, basis kind or confidence, and a missing basis", () => {
    const issues = proposalIssues({ ...GOOD, test: "hunch", basis_kind: "feeling", confidence: "sure", basis: " " });
    expect(issues).toContain("test must be one of continuity, backward, gap, forward, reverse_cutoff");
    expect(issues).toContain("basis kind must be one of contract, purchase_order, last_bill, estimate");
    expect(issues).toContain("confidence must be one of high, medium, open");
    expect(issues).toContain("basis is required: what the amount rests on");
  });

  it("takes debits only, net of VAT, to the penny", () => {
    const issues = proposalIssues({ ...GOOD, lines: [{ account_code: "412", amount: -750 }, { account_code: "", amount: 10.005 }] });
    expect(issues).toContain("line 1: give the cost as a positive amount, net of VAT; the credit to accruals is added for you");
    expect(issues).toContain("line 2: account code is required");
    expect(issues).toContain("line 2: amount must be money, to the penny");
    expect(proposalIssues({ ...GOOD, lines: [] })).toContain("give at least one cost line, or make it an open question (confidence open)");
  });

  it("does not let a tax type through: accruals are net and TaxType NONE", () => {
    expect(proposalIssues({ ...GOOD, lines: [{ account_code: "412", amount: 750, tax_type: "INPUT2" }] }))
      .toContain("line 1: accruals are net of VAT with no tax type; leave tax_type out");
  });

  it("keeps an open question out of a journal: no amount is estimated", () => {
    expect(proposalIssues({ ...GOOD, confidence: "open", lines: [], basis_kind: "estimate", basis: "Needs their WIP at 31 October" })).toEqual([]);
    expect(proposalIssues({ ...GOOD, confidence: "open" }))
      .toContain("an open question carries no amount: it goes to the CFO as a question, never into a journal");
  });

  it("needs a month and a service period inside sense", () => {
    expect(proposalIssues({ ...GOOD, period: "2026-13" })).toContain("period must be a month (YYYY-MM)");
    expect(proposalIssues({ ...GOOD, service_from: "2026-11-30", service_to: "2026-11-01" })).toContain("the service ends before it starts");
  });

  it("never codes a cost to the accruals account itself", () => {
    expect(accountIssues(GOOD.lines, "805")).toEqual([]);
    expect(accountIssues([{ account_code: "805", amount: 10 }], "805")).toEqual(["line 1: 805 is the accruals account; code the cost to where it belongs"]);
  });
});

describe("the accruals account", () => {
  it("comes from the CFO's setting, then the account on the Accruals rec line, and never from code", () => {
    expect(accrualAccountFor({ settings: [{ entity_id: ALPHA, account_code: "805" }], recAccounts: [{ entity_id: ALPHA, account_code: "888" }], entityId: ALPHA })).toBe("805");
    expect(accrualAccountFor({ settings: [], recAccounts: [{ entity_id: ALPHA, account_code: "805" }], entityId: ALPHA })).toBe("805");
    // Item 71: 830 is Corporation Tax. Nothing falls back to a number.
    expect(accrualAccountFor({ settings: [], recAccounts: [], entityId: ALPHA })).toBeNull();
    expect(accrualAccountFor({ settings: [], recAccounts: [{ entity_id: ALPHA, account_code: "805" }, { entity_id: ALPHA, account_code: "806" }], entityId: ALPHA })).toBeNull();
  });
});

const P = (over) => ({
  id: "p-1", entity_id: ALPHA, supplier: "Example Solicitors", contact_id: "c-es", test: "gap", decision: "no_accrual",
  reason: "Fully billed as at 18 Nov", applies_to: "until_changed", period: "2026-10", ended_at: null, decided_at: "2026-11-18T20:55:00Z", ...over,
});

describe("cite or depart", () => {
  it("finds the precedents that apply: until changed from their month on, this month only in it", () => {
    const list = [P({ id: "a" }), P({ id: "b", applies_to: "this_month" }), P({ id: "c", ended_at: "2026-11-19" }), P({ id: "d", entity_id: BETA }), P({ id: "e", supplier: "Example Facilities", contact_id: "c-fac" })];
    expect(applicablePrecedents(list, { entity_id: ALPHA, supplier: "EXAMPLE SOLICITORS LTD", contact_id: null, period: "2026-11" }).map((p) => p.id)).toEqual(["a"]);
    expect(applicablePrecedents(list, { entity_id: ALPHA, supplier: "x", contact_id: "c-es", period: "2026-10" }).map((p) => p.id)).toEqual(["a", "b"]);
    expect(applicablePrecedents(list, { entity_id: ALPHA, supplier: "Example Solicitors", contact_id: "c-es", period: "2026-09" })).toEqual([]);
  });

  it("raises a supplier with no precedent freely", () => {
    expect(citeOrDepart({ precedent_ids: [] }, [])).toEqual({ ok: true });
  });

  it("does not raise a proposal that follows a no-accrual precedent: it goes in the run note", () => {
    const out = citeOrDepart({ precedent_ids: ["a"] }, [P({ id: "a" })]);
    expect(out.not_raised).toBe(true);
    expect(out.refuse).toMatch(/^Not raised: the CFO decided no accrual for Example Solicitors on 18 November 2026 \(Fully billed as at 18 Nov\)/);
  });

  it("refuses a proposal that ignores a precedent that applies", () => {
    const out = citeOrDepart({ precedent_ids: [] }, [P({ id: "a" })]);
    expect(out.refuse).toMatch(/cite it in precedent_ids, or say in departs_reason what is different this month/);
    expect(out.not_raised).toBeFalsy();
  });

  it("raises one that says why this month differs", () => {
    expect(citeOrDepart({ precedent_ids: [], departs_reason: "An Example Solicitors bill dated 20 Nov for October work is now in Xero" }, [P({ id: "a" })])).toEqual({ ok: true });
  });

  it("raises one that follows an accept or standing precedent", () => {
    expect(citeOrDepart({ precedent_ids: ["s"] }, [P({ id: "s", decision: "standing", supplier: "Jo Bloggs Consulting" })])).toEqual({ ok: true });
  });
});

describe("the CFO's decision", () => {
  const proposal = { id: "p-9", client_id: "cl", entity_id: ALPHA, period: "2026-11", supplier: "Jo Bloggs Consulting", contact_id: "c-jb", test: "continuity",
    lines: GOOD.lines, basis_kind: "last_bill", basis: GOOD.basis, service_from: "2026-11-01", service_to: "2026-11-30", confidence: "high", decision: "pending" };

  it("accepts into a one-off item and keeps a precedent", () => {
    const out = decisionPlan({ proposal, body: { decision: "accept" }, actor: "nik@stza.io" });
    expect(out.issues).toEqual([]);
    expect(out.item).toMatchObject({ entity_id: ALPHA, supplier: "Jo Bloggs Consulting", amount: "750.00", period_from: "2026-11", standing: false, bill_lag_months: 1 });
    expect(out.precedent).toMatchObject({ decision: "accept", applies_to: "this_month", supplier: "Jo Bloggs Consulting" });
    expect(out.precedent.facts).toMatchObject({ service_month: "2026-11", amount: "750.00", basis_kind: "last_bill" });
  });

  it("makes a standing item that recurs until its end month", () => {
    const out = decisionPlan({ proposal, body: { decision: "standing", reason: "Monthly fee, billed on the 1st", end_period: "2027-06", applies_to: "until_changed" }, actor: "nik@stza.io" });
    expect(out.item).toMatchObject({ standing: true, end_period: "2027-06" });
    expect(out.precedent.applies_to).toBe("until_changed");
  });

  it("needs the reason for no accrual, and keeps it as the precedent", () => {
    expect(decisionPlan({ proposal, body: { decision: "no_accrual" }, actor: "nik@stza.io" }).issues).toContain("say why there is no accrual: it becomes the precedent the agents follow");
    const out = decisionPlan({ proposal, body: { decision: "no_accrual", reason: "Fully billed" }, actor: "nik@stza.io" });
    expect(out.item).toBeNull();
    expect(out.precedent).toMatchObject({ decision: "no_accrual", reason: "Fully billed" });
  });

  it("keeps a question open, with no precedent and no item", () => {
    const out = decisionPlan({ proposal, body: { decision: "question", reason: "When did the candidate start?" }, actor: "nik@stza.io" });
    expect(out).toMatchObject({ issues: [], item: null, precedent: null });
    expect(out.proposal.decision).toBe("question");
  });

  it("takes the CFO's amount on an edit, and refuses to accept an open question as it stands", () => {
    const edited = decisionPlan({ proposal, body: { decision: "accept_edited", lines: [{ account_code: "412", amount: 700 }] }, actor: "nik@stza.io" });
    expect(edited.item.amount).toBe("700.00");
    const open = decisionPlan({ proposal: { ...proposal, confidence: "open", lines: [] }, body: { decision: "accept" }, actor: "nik@stza.io" });
    expect(open.issues[0]).toMatch(/an open question has no amount to accept/);
  });

  it("decides only once, and never as superseded", () => {
    expect(decisionPlan({ proposal: { ...proposal, decision: "no_accrual" }, body: { decision: "accept" }, actor: "x" }).issues).toEqual(["this proposal is already decided"]);
    expect(decisionPlan({ proposal, body: { decision: "superseded" }, actor: "x" }).issues[0]).toMatch(/decision must be one of/);
  });
});

const SB = { id: "i-sb", entity_id: ALPHA, supplier: "Jo Bloggs Consulting", contact_id: "c-jb", lines: [{ account_code: "412", amount: 750 }], amount: "750.00",
  period_from: "2026-07", standing: true, end_period: null, stopped_period: null, bill_lag_months: 1 };
const ACP = { id: "i-acp", entity_id: BETA, supplier: "Example Travel", contact_id: "c-acp", lines: [{ account_code: "510", amount: 1872.07 }, { account_code: "515", amount: 1570.27 }], amount: "3442.34",
  period_from: "2026-09", standing: false, bill_lag_months: 1 };

describe("the schedule", () => {
  it("accrues a one-off in its month and a standing item every month until it ends or stops", () => {
    expect(accruesIn(ACP, "2026-09")).toBe(true);
    expect(accruesIn(ACP, "2026-10")).toBe(false);
    expect(accruesIn(SB, "2026-06")).toBe(false);
    expect(accruesIn(SB, "2026-11")).toBe(true);
    expect(accruesIn({ ...SB, end_period: "2026-10" }, "2026-11")).toBe(false);
    expect(accruesIn({ ...SB, stopped_period: "2026-11" }, "2026-11")).toBe(false);
  });

  it("holds each company's accruals at the month end: last month's reversed on the 1st", () => {
    const at = scheduleAt([SB, ACP], "2026-09");
    expect(at.get(ALPHA)).toBe(75000);
    expect(at.get(BETA)).toBe(344234);
    expect(scheduleAt([SB, ACP], "2026-10").get(BETA) ?? 0).toBe(0);
  });
});

describe("the 805 tie-out", () => {
  it("ties the ledger (a credit, so negative) to the schedule to the penny", () => {
    const out = tieOut({ items: [SB, ACP], period: "2026-09", ledger: [{ entity_id: ALPHA, closing: -750 }, { entity_id: BETA, closing: -3442.34 }] });
    expect(out.ties).toBe(true);
    expect(out.rows.map((r) => r.variance)).toEqual([0, 0]);
  });

  it("names a pair not yet posted as the reason for a gap, and does not call it tied", () => {
    const out = tieOut({ items: [SB], period: "2026-11", ledger: [{ entity_id: ALPHA, closing: 0 }], pending: [{ entity_id: ALPHA, total: "750.00", state: "proposed", jnl: "JNL-60" }] });
    expect(out.ties).toBe(false);
    expect(out.rows[0]).toMatchObject({ ledger: 0, schedule: -75000, variance: 75000 });
    expect(out.rows[0].note).toBe("JNL-60 (750.00) is waiting for approval; once posted in Xero the ledger should tie.");
  });

  it("puts a company with ledger but no schedule on the tie, as a variance", () => {
    const out = tieOut({ items: [], period: "2026-11", ledger: [{ entity_id: BETA, closing: -65.25 }] });
    expect(out.rows[0]).toMatchObject({ variance: -6525, ties: false });
  });
});

const pair = (item, period, state = "posted") => ({ accrual_item_id: item.id, period, state });

describe("continuity", () => {
  it("raises this month's pair for a standing item, unprompted", () => {
    const out = continuity({ items: [SB], pairs: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => pair(SB, m)), clearings: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => ({ item_id: "i-sb", period: m })), period: "2026-11", lockDate: "2026-06-30", today: "2026-11-19" });
    expect(out.propose).toEqual([{ item_id: "i-sb", period: "2026-11", backfill: false }]);
    expect(out.findings).toEqual([]);
  });

  it("backfills a missed month into its own month, never a catch-up in this one", () => {
    const out = continuity({ items: [SB], pairs: [pair(SB, "2026-07"), pair(SB, "2026-10")], clearings: [], period: "2026-11", lockDate: "2026-06-30", today: "2026-11-19" });
    expect(out.propose).toEqual([
      { item_id: "i-sb", period: "2026-08", backfill: true },
      { item_id: "i-sb", period: "2026-09", backfill: true },
      { item_id: "i-sb", period: "2026-11", backfill: false },
    ]);
  });

  it("asks the CFO to open a locked month rather than put it anywhere else", () => {
    const out = continuity({ items: [SB], pairs: [pair(SB, "2026-08"), pair(SB, "2026-09"), pair(SB, "2026-10")], clearings: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => ({ item_id: "i-sb", period: m })), period: "2026-11", lockDate: "2026-08-31", today: "2026-11-19" });
    expect(out.propose).toEqual([{ item_id: "i-sb", period: "2026-11", backfill: false }]);
    expect(out.findings).toEqual([{ kind: "locked", item_id: "i-sb", period: "2026-07",
      text: "Jo Bloggs Consulting: July 2026 has no accrual and the month is locked (lock date 31 August 2026). Open the month in Xero to backfill it; it is not caught up in another month." }]);
  });

  it("treats a rejected pair as missing and a waiting one as there", () => {
    const out = continuity({ items: [SB], pairs: [pair(SB, "2026-07"), pair(SB, "2026-08", "proposed"), pair(SB, "2026-09"), pair(SB, "2026-10", "rejected")], clearings: [], period: "2026-10", lockDate: null, today: "2026-11-19" });
    expect(out.propose).toEqual([{ item_id: "i-sb", period: "2026-10", backfill: false }]);
  });

  it("needs no accrual where the bill is billed in the month and arrived in it", () => {
    const inMonth = { ...SB, bill_lag_months: 0 };
    const out = continuity({ items: [inMonth], pairs: [], clearings: [{ item_id: "i-sb", period: "2026-07", bill_date: "2026-07-28" }], period: "2026-07", lockDate: null, today: "2026-08-01" });
    expect(out.propose).toEqual([]);
  });

  it("flags a bill that has not arrived by the 15th of the month it was expected", () => {
    const out = continuity({ items: [SB], pairs: ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((m) => pair(SB, m)),
      clearings: ["2026-07", "2026-08", "2026-09"].map((m) => ({ item_id: "i-sb", period: m })), period: "2026-11", lockDate: null, today: "2026-11-19" });
    expect(out.findings).toEqual([{ kind: "bill_late", item_id: "i-sb", period: "2026-10",
      text: "Jo Bloggs Consulting: the bill for October 2026 was expected in November 2026 and is not in Xero by 15 November 2026." }]);
  });

  it("leaves a stopped item alone", () => {
    const out = continuity({ items: [{ ...SB, stopped_period: "2026-11" }], pairs: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => pair(SB, m)), clearings: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => ({ item_id: "i-sb", period: m })), period: "2026-11", lockDate: null, today: "2026-11-02" });
    expect(out).toEqual({ propose: [], findings: [] });
  });
});

describe("the journal pair", () => {
  it("accrues on the month end and reverses on the 1st, Cr the accruals account, TaxType NONE", () => {
    const j = pairFor({ item: SB, period: "2026-11", accrualAccount: "805" });
    expect(j).toMatchObject({ journal_date: "2026-11-30", reversal_date: "2026-12-01", narration: "Accrual: Jo Bloggs Consulting, November 2026 services" });
    expect(j.lines).toEqual([
      { account_code: "412", description: "Accrual: Jo Bloggs Consulting", amount: 750, tax_type: "NONE" },
      { account_code: "805", description: "Accrual: Jo Bloggs Consulting", amount: -750, tax_type: "NONE" },
    ]);
    expect(reversalLines(j.lines).map((l) => l.amount)).toEqual([-750, 750]);
    expect(reversalNarration(j.narration)).toBe("Reversal: Jo Bloggs Consulting, November 2026 services");
  });

  it("keeps the narration under 120 characters, and nothing else goes to Xero", () => {
    const long = pairFor({ item: { ...ACP, supplier: "A".repeat(200) }, period: "2026-09", accrualAccount: "805" });
    expect(long.narration.length).toBeLessThan(MAX_NARRATION);
    expect(reversalNarration(long.narration).length).toBeLessThan(MAX_NARRATION);
    expect(Object.keys(long).sort()).toEqual(["journal_date", "lines", "narration", "reversal_date"]);
  });

  it("refuses a pair with no accruals account rather than guessing one", () => {
    expect(() => pairFor({ item: SB, period: "2026-11", accrualAccount: null })).toThrow(/no accruals account/);
  });

  it("reaches Xero under one key per leg: journal id, the leg's attempt, and the leg", () => {
    expect(pairKeys({ id: "j1", attempts: 1, reversal_attempts: 1 })).toEqual({ accrual: "journal-j1-1", reversal: "journal-j1-1-reversal" });
    // A refused reversal moves only the reversal on, so the accrual already in Xero is never made twice.
    expect(pairKeys({ id: "j1", attempts: 1, reversal_attempts: 2 })).toEqual({ accrual: "journal-j1-1", reversal: "journal-j1-2-reversal" });
  });

  it("is one approval: safe to approve again only while neither leg could be in Xero twice", () => {
    expect(pairAttempt({ accrual: "go", reversal: "go" })).toEqual({ state: "go", legs: ["accrual", "reversal"] });
    expect(pairAttempt({ accrual: "drafted", reversal: "retry" })).toEqual({ state: "retry", legs: ["reversal"] });
    expect(pairAttempt({ accrual: "drafted", reversal: "drafted" })).toEqual({ state: "drafted", legs: [] });
    expect(pairAttempt({ accrual: "unknown", reversal: "go" }).state).toBe("unknown");
    expect(pairAttempt({ accrual: "drafted", reversal: "live" }).state).toBe("live");
  });
});

const bill = (id, number, date, net, contact = "c-jb", status = "AUTHORISED") => ({ id, number, date, net, contact_id: contact, contact_name: "Jo Bloggs Consulting", status });

describe("matching the reversal to the bill", () => {
  const bills = [
    bill("b7", "SB/007", "2026-07-01", 750), bill("b8", "SB/008", "2026-08-01", 750), bill("b9", "SB/009", "2026-09-01", 750),
    bill("b10", "SB/010", "2026-10-01", 750), bill("b11", "JB/011", "2026-11-01", 750),
  ];
  const pairs = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((m) => pair(SB, m));

  it("matches each month to the bill dated the month after, with the difference", () => {
    const out = matchClearings({ items: [SB], bills, clearings: [], pairs, period: "2026-11" });
    expect(out.map((c) => [c.period, c.bill_number, c.difference])).toEqual([
      ["2026-07", "SB/008", 0], ["2026-08", "SB/009", 0], ["2026-09", "SB/010", 0], ["2026-10", "JB/011", 0],
    ]);
  });

  it("never matches SB/007, June's bill dated 1 July, to July", () => {
    const out = matchClearings({ items: [SB], bills: bills.filter((b) => b.number !== "SB/008"), clearings: [], pairs, period: "2026-07" });
    expect(out).toEqual([]);
  });

  it("skips months already matched, bills already used, drafts and voided bills, and other suppliers", () => {
    const out = matchClearings({
      items: [SB],
      bills: [bill("b10", "SB/010", "2026-10-01", 750, "c-jb", "DRAFT"), bill("bx", "X", "2026-10-02", 750, "c-other"), bill("b10b", "SB/010", "2026-10-03", 800)],
      clearings: [{ item_id: "i-sb", period: "2026-07", bill_id: "b8" }, { item_id: "i-sb", period: "2026-08", bill_id: "b9" }],
      pairs, period: "2026-09",
    });
    expect(out).toEqual([{ item_id: "i-sb", period: "2026-09", bill_id: "b10b", bill_number: "SB/010", bill_date: "2026-10-03", bill_net: "800.00", difference: 5000 }]);
  });

  it("matches only months that were accrued", () => {
    expect(matchClearings({ items: [SB], bills, clearings: [], pairs: [pair(SB, "2026-09", "rejected")], period: "2026-09" })).toEqual([]);
  });
});

describe("history for the agent", () => {
  it("groups by supplier with decisions, comments, standing items and a calibration line", () => {
    const view = historyView({
      proposals: [{ id: "p1", entity_id: ALPHA, supplier: "Gradi", period: "2026-09", decision: "accept", decision_reason: null, total: "1000.00", test: "forward", basis: "sprint" }],
      comments: [{ proposal_id: "p1", author: "nik@stza.io", body: "Fine", created_at: "2026-10-02T09:00:00Z" }],
      precedents: [P({ id: "pr", supplier: "Gradi", contact_id: null, decision: "accept", applies_to: "this_month", reason: null, period: "2026-09" })],
      items: [{ ...SB }],
      clearings: [{ item_id: "i-gr", period: "2026-07", difference: 25000, accrued: 100000, supplier: "Gradi" }, { item_id: "i-gr", period: "2026-08", difference: 20000, accrued: 100000, supplier: "Gradi" }],
      names: new Map([[ALPHA, "Alpha Ltd"]]),
    });
    const gradi = view.suppliers.find((s) => s.supplier === "Gradi");
    expect(gradi.proposals[0].comments).toEqual([{ by: "nik@stza.io", at: "2026-10-02T09:00:00Z", body: "Fine" }]);
    expect(gradi.calibration).toBe("Accruals ran under the bill in 2 of 2 months, by 22.5% on average. Adjust the basis.");
    expect(view.suppliers.find((s) => s.supplier === "Jo Bloggs Consulting").standing).toEqual([{ item_id: "i-sb", company: "Alpha Ltd", monthly: "750.00", from: "2026-07", to: null, stopped: null }]);
  });
});

describe("promoting a precedent to a rule", () => {
  it("writes one line the CFO approves on the Procedures page", () => {
    expect(promoteText(P({ decision: "no_accrual", reason: "Fully billed as at 18 Nov" }), "Alpha Ltd"))
      .toBe("- Example Solicitors (Alpha Ltd): no accrual. Fully billed as at 18 Nov. (CFO, 18 November 2026; from accrual precedent p-1.)");
  });
});

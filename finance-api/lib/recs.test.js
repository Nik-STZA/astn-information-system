import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  accountKey, approvalInstruction, composeAccounts, cover, entityLines, finishItem, itemAt, journalChecks, journalMatches,
  journalProposalIssues, matrixFields, namesRecProposal, monthEnd, nextPeriod, priorPeriod, recheckReason, releaseIn, releaseProfile, scheduleItemInput,
  scheduleMonths, scheduleTotals, snapshotOf, stepIssues, workable, prepareInstruction,
  CFO_ROLE, approvalIssues, draftFailure, hasRows, journalAgrees, recJournalGate, recJournalKey, retryState, runIsLive, unidentifiedRows,
} from "./recs";
import { approvalFromThread } from "./draft-approval";
import { checkApprovalText } from "./journal";
import { agentRecs } from "./agent-recs";

const A = "entity-a";
const B = "entity-b";

// A Xero trial balance row: month Dr and Cr, then YTD Dr and Cr (the closing
// balance for a balance sheet account).
const tbRow = (id, name, dr, cr, ydr, ycr) => ({
  RowType: "Row",
  Cells: [{ Value: name, Attributes: [{ Id: "account", Value: id }] }, { Value: String(dr) }, { Value: String(cr) }, { Value: String(ydr) }, { Value: String(ycr) }],
});
const tb = (...rows) => ({ Rows: [{ RowType: "Section", Rows: rows }] });

const CHART = [
  { AccountID: "pre", Code: "620", Name: "Prepayments", Class: "ASSET", Type: "PREPAYMENT" },
  { AccountID: "bank", Code: "090", Name: "Business Bank", Class: "ASSET", Type: "BANK" },
  { AccountID: "sus", Code: "850", Name: "Suspense", Class: "ASSET", Type: "CURRENT" },
  { AccountID: "odd", Code: "860", Name: "Odd thing", Class: "LIABILITY", Type: "CURRLIAB" },
  { AccountID: "pl", Code: "400", Name: "Advertising", Class: "EXPENSE", Type: "OVERHEADS" },
];

describe("the list comes from the trial balance", () => {
  const lines = entityLines({
    accounts: CHART,
    closeTb: tb(
      tbRow("pre", "Prepayments (620)", 0, 500, 1500, 0),
      tbRow("bank", "Business Bank (090)", 100, 100, 0, 0), // up and back within the month
      tbRow("sus", "Suspense (850)", 0, 250, 0, 0), // cleared this month
      tbRow("odd", "Odd thing (860)", 0, 0, 0, 0), // nothing at all
      tbRow("pl", "Advertising (400)", 700, 0, 7000, 0), // not the balance sheet
      tbRow("gone", "Old loan (999)", 0, 0, 0, 80), // not in the chart: kept
    ),
    openTb: tb(tbRow("pre", "Prepayments (620)", 0, 500, 2000, 0), tbRow("sus", "Suspense (850)", 0, 0, 250, 0)),
  });
  const byKey = Object.fromEntries(lines.map((l) => [accountKey(l.name), l]));

  it("takes every balance sheet account with a balance, and leaves out the P&L", () => {
    expect(Object.keys(byKey).sort()).toEqual(["businessbank", "oldloan", "prepayments", "suspense"]);
    expect(byKey.prepayments).toMatchObject({ code: "620", opening: 200000, closing: 150000, movement: -50000 });
  });
  it("keeps an account that ended at zero after moving", () => {
    expect(byKey.suspense).toMatchObject({ closing: 0, opening: 25000, zero_after_movement: true });
    expect(byKey.businessbank).toMatchObject({ closing: 0, opening: 0, movement: 0 });
  });
  it("keeps a balance it cannot find in the chart, and never lets it pass unseen", () => {
    expect(byKey.oldloan).toMatchObject({ closing: -8000, name: "Old loan" });
  });
  it("uses the closing columns, not the month's movement", () => {
    expect(byKey.prepayments.closing).not.toBe(-50000);
  });
});

describe("a group rec joins companies by account name", () => {
  const entities = [
    { id: A, lines: [{ key: "prepayments", code: "620", name: "Prepayments", opening: 100, closing: 200, movement: 100, chart: CHART[0] }] },
    { id: B, lines: [
      { key: "prepayments", code: "1400", name: "Prepayments", opening: 0, closing: 50, movement: 50, chart: { Name: "Prepayments", Type: "PREPAYMENT" } },
      { key: "oddthing", code: "860", name: "Odd thing", opening: 0, closing: -9, movement: -9, chart: { Name: "Odd thing", Type: "CURRLIAB" } },
    ] },
  ];
  const { accounts: out } = composeAccounts(entities);

  it("gives one rec across companies, even with different codes", () => {
    const pre = out.find((a) => a.key === "prepayments");
    expect(pre.by_entity.map((e) => [e.entity_id, e.code])).toEqual([[A, "620"], [B, "1400"]]);
    expect(pre).toMatchObject({ line_key: "prepay", proof: "schedule" });
  });
  it("leaves what it cannot place for a person, rather than guess", () => {
    expect(out.find((a) => a.key === "oddthing")).toMatchObject({ line_key: null, proof: "ledger_review" });
    expect(matrixFields(null)).toEqual({ owner: null, challenge: null, class: null, artefact: null });
  });
  it("normalises spacing and case in the key", () => expect(accountKey(" Pre-Payments ")).toBe(accountKey("prepayments")));
  it("takes owner, challenge and class from the matrix", () => {
    expect(matrixFields("prepay")).toMatchObject({ owner: "FM1", challenge: null, class: "M" });
    expect(matrixFields("accruals")).toMatchObject({ owner: "FM1", challenge: "FC", class: "J" });
  });
  it("works end to end only for prepayments, for now", () => {
    expect(workable("prepay", "schedule")).toBe(true);
    expect(workable("accruals", "schedule")).toBe(false);
  });
});

describe("H6: keys never lose a balance", () => {
  const l = (key, code, name, closing) => ({ key, code, name, closing, opening: 0, movement: closing, account_id: code });
  it("keeps two accounts in one company that reduce to one key, and says so", () => {
    const { accounts, notes } = composeAccounts([{ id: A, name: "Acme Ltd", lines: [l("asset:staffloan", "612", "Staff loan", 100), l("asset:staffloan", "613", "Staff Loan!", 40)] }]);
    expect(accounts).toHaveLength(2);
    expect(accounts.flatMap((x) => x.by_entity).map((b) => b.closing).sort()).toEqual([100, 40].sort());
    for (const a of accounts) expect(a.by_entity).toHaveLength(1);
    expect(notes[0]).toMatch(/more than one account named like/);
  });
  it("gives each company at most one row on a rec", () => {
    const { accounts } = composeAccounts([{ id: A, name: "Acme", lines: [l("k", "1", "N", 1), l("k", "2", "N", 2)] }, { id: B, name: "Beta", lines: [l("k", "3", "N", 3)] }]);
    for (const a of accounts) expect(new Set(a.by_entity.map((b) => b.entity_id)).size).toBe(a.by_entity.length);
    expect(accounts.flatMap((x) => x.by_entity)).toHaveLength(3);
  });
  it("does not merge across class, or merge bank accounts", () => {
    const chart = [{ AccountID: "x", Code: "1", Name: "Deposits", Class: "ASSET", Type: "CURRENT" }];
    const lb = [{ AccountID: "y", Code: "2", Name: "Deposits", Class: "LIABILITY", Type: "CURRLIAB" }];
    const a = entityLines({ accounts: chart, closeTb: tb(tbRow("x", "Deposits (1)", 0, 0, 5, 0)), openTb: tb() });
    const b = entityLines({ accounts: lb, closeTb: tb(tbRow("y", "Deposits (2)", 0, 0, 0, 5)), openTb: tb() });
    expect(a[0].key).not.toBe(b[0].key);
    const bank = (id) => entityLines({ accounts: [{ AccountID: id, Code: id, Name: "Bank", Class: "ASSET", Type: "BANK" }], closeTb: tb(tbRow(id, "Bank", 0, 0, 5, 0)), openTb: tb() })[0].key;
    expect(bank("p")).not.toBe(bank("q"));
  });
  it("keeps an account whose name has no letters or digits", () => {
    const r = entityLines({ accounts: [{ AccountID: "x", Code: "1", Name: "***", Class: "ASSET", Type: "CURRENT" }], closeTb: tb(tbRow("x", "*** (1)", 0, 0, 5, 0)), openTb: tb() });
    expect(r[0].key).toBe("asset:id-x");
    expect(composeAccounts([{ id: A, name: "Acme", lines: r }]).notes[0]).toMatch(/no letters or digits/);
  });
});

describe("what counts as a read", () => {
  it("treats a report with no rows as failed, not as an empty company", () => {
    expect(hasRows({ Rows: [] })).toBe(false);
    expect(hasRows({})).toBe(false);
    expect(hasRows(tb(tbRow("x", "A", 0, 0, 0, 0)))).toBe(true);
  });
  it("reports a row with figures and no account id", () => {
    expect(unidentifiedRows(tb({ RowType: "Row", Cells: [{ Value: "Mystery" }, { Value: "5.00" }] }))).toEqual(["Mystery"]);
    expect(unidentifiedRows(tb({ RowType: "Row", Cells: [{ Value: "Blank" }, { Value: "0" }] }))).toEqual([]);
  });
});

describe("periods", () => {
  it("rolls months and year ends", () => {
    expect(priorPeriod("2026-01")).toBe("2025-12");
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
  });
});

const item = (over = {}) => ({
  id: "i1", entity_id: A, supplier: "Insurer Ltd", pl_account_code: "400", total_cost: "7200.00", treatment: "amortise",
  service_start: "2026-01-01", service_end: "2026-12-31", amort_commenced: "2026-01-01", invoice_date: "2026-01-05", ended_period: null, ...over,
});

describe("the schedule, as the existing workbook works it out", () => {
  it("takes months from the days over 30.4375, and the monthly from that", () => {
    expect(releaseProfile(item())).toMatchObject({ months: 12, monthly: 60000, first: "2026-01", last: "2026-12" });
  });
  it("releases within the window only", () => {
    expect(releaseIn(item(), "2025-12")).toBe(0);
    expect(releaseIn(item(), "2026-10")).toBe(60000);
    expect(releaseIn(item(), "2027-01")).toBe(0);
  });
  it("gives released and balance at a month end", () => {
    expect(itemAt(item(), "2026-10")).toMatchObject({ released: 600000, balance: 120000, this_month: 60000 });
  });
  it("clears the rounding pence in the last month, so nothing is stranded", () => {
    const i = item({ total_cost: "1000.00", service_end: "2026-03-31" });
    expect(releaseProfile(i)).toMatchObject({ months: 3, monthly: 33333 });
    expect(releaseIn(i, "2026-03")).toBe(33334);
    expect(itemAt(i, "2026-03").balance).toBe(0);
    expect(itemAt(i, "2026-02").balance).toBe(33334);
  });
  it("gives a short item one month", () => {
    expect(releaseProfile(item({ service_end: "2026-01-10" })).months).toBe(1);
  });
  it("holds a held item at cost until it is ended", () => {
    const h = item({ treatment: "held" });
    expect(itemAt(h, "2026-10")).toMatchObject({ released: 0, balance: 720000, this_month: 0 });
    expect(itemAt({ ...h, ended_period: "2026-10" }, "2026-10").balance).toBe(0);
    expect(itemAt({ ...h, ended_period: "2026-11" }, "2026-10").balance).toBe(720000);
  });
  it("takes an ended item off the schedule from that month", () => {
    const e = item({ ended_period: "2026-06" });
    expect(releaseIn(e, "2026-06")).toBe(0);
    expect(itemAt(e, "2026-06").balance).toBe(0);
  });
  it("leaves out an item invoiced after the month", () => {
    expect(itemAt(item({ invoice_date: "2026-11-02", service_start: "2026-12-01", amort_commenced: "2026-12-01" }), "2026-10").balance).toBe(0);
  });
  it("totals by company, and lists the months the columns need", () => {
    const items = [item(), item({ id: "i2", entity_id: B, total_cost: "120.00" })];
    expect(scheduleTotals(items, "2026-10").get(B)).toBe(2000);
    expect(scheduleMonths(items, "2026-10")).toHaveLength(12);
  });
});

describe("what a schedule item must have", () => {
  it("wants the basics", () => {
    const { issues } = scheduleItemInput({});
    expect(issues).toEqual(expect.arrayContaining(["supplier is required", "pl account code is required", "total cost is required"]));
  });
  it("refuses a third decimal place rather than round it", () => {
    expect(scheduleItemInput({ supplier: "x", pl_account_code: "1", total_cost: "1.234" }).issues[0]).toMatch(/2 decimal/);
  });
  it("defaults the first release to the first of the service month", () => {
    const { row, issues } = finishItem({ service_start: "2026-03-15", service_end: "2026-09-14" });
    expect(issues).toEqual([]);
    expect(row.amort_commenced).toBe("2026-03-01");
  });
  it("wants dates for an amortised item, not for a held one", () => {
    expect(finishItem({}).issues).toHaveLength(2);
    expect(finishItem({ treatment: "held" }).issues).toEqual([]);
    expect(finishItem({ service_start: "2026-03-15", service_end: "2026-01-01" }).issues).toContain("service end is before service start");
  });
});

describe("the cover", () => {
  const bal = [{ entity_id: A, closing: "1000.40" }, { entity_id: B, closing: "500.00" }];
  it("ties each company within the tolerance", () => {
    const c = cover(bal, new Map([[A, 100000], [B, 50000]]), 100);
    expect(c.ties).toBe(true);
    expect(c.group).toEqual({ gl: 150040, schedule: 150000, variance: 40 });
  });
  it("does not let two companies' differences net off at group level", () => {
    const c = cover(bal, new Map([[A, 90040], [B, 60000]]), 100);
    expect(c.group.variance).toBe(0);
    expect(c.ties).toBe(false);
  });
  it("H3: keeps a company with schedule items and no ledger row, as a variance", () => {
    const c = cover([bal[0]], new Map([[A, 100040], [B, 50000]]), 100);
    expect(c.rows.find((r) => r.entity_id === B)).toMatchObject({ gl: 0, schedule: 50000, variance: -50000, ties: false, no_ledger: true });
    expect(c.group).toEqual({ gl: 100040, schedule: 150040, variance: -50000 });
    expect(c.ties).toBe(false);
  });
  it("does not add up companies in different currencies, but still ties each", () => {
    const c = cover([{ ...bal[0], currency: "GBP" }, { ...bal[1], currency: "USD" }], new Map([[A, 100040], [B, 50000]]), 0);
    expect(c.group).toEqual({ gl: null, schedule: null, variance: null });
    expect(c.mixed_currency).toBe(true);
    expect(c.ties).toBe(true);
  });
  it("reports every variance with a nil tolerance", () => {
    expect(cover([{ entity_id: A, closing: "100.01" }], new Map([[A, 10000]]), 0).ties).toBe(false);
  });
  it("says nothing ties where the proof has no figure yet", () => {
    expect(cover(bal, null, 100)).toMatchObject({ ties: false, group: { schedule: null, variance: null } });
  });
});

describe("re-check when a figure moves after preparation", () => {
  const was = [{ entity_id: A, opening: "100.00", closing: "200.00" }];
  const snapshot = { balances: snapshotOf(was) };
  const names = new Map([[A, "Acme Ltd"]]);
  const ctx = { priorLabel: "September 2026", names };

  it("is quiet while nothing moved", () => expect(recheckReason(snapshot, was, ctx)).toBeNull());
  it("is quiet before anything is prepared", () => expect(recheckReason(null, was, ctx)).toBeNull());
  it("names the prior month's closing figure when that moves", () => {
    expect(recheckReason(snapshot, [{ ...was[0], opening: "130.00", closing: "230.00" }], ctx))
      .toBe("Acme Ltd: the September 2026 closing figure moved from 100.00 to 130.00 after this was prepared.");
  });
  it("catches this month's ledger moving too", () => {
    expect(recheckReason(snapshot, [{ ...was[0], closing: "210.00" }], ctx)).toMatch(/the ledger moved from 200.00 to 210.00/);
  });
  it("catches a company that left the account", () => {
    expect(recheckReason(snapshot, [], ctx)).toMatch(/Acme Ltd: it held 200.00/);
  });
  it("H5: catches a schedule edit that moves this month's figures", () => {
    const i = item();
    const snap = { balances: {}, schedule: [{ id: "i1", supplier: "Insurer Ltd", ...itemAt(i, "2026-10") }] };
    const c = { ...ctx, period: "2026-10" };
    expect(recheckReason(snap, [], { ...c, items: [i] })).toBeNull();
    expect(recheckReason(snap, [], { ...c, items: [{ ...i, total_cost: "8400.00" }] })).toMatch(/The schedule changed after this was prepared: Insurer Ltd moved from 1,200.00 to 1,400.00/);
    expect(recheckReason(snap, [], { ...c, items: [] })).toMatch(/moved from 1,200.00 to 0.00/);
  });
  it("H5: leaves alone an edit that does not reach this month", () => {
    const i = item();
    const snap = { balances: {}, schedule: [{ id: "i1", supplier: "x", ...itemAt(i, "2026-10") }] };
    const later = item({ id: "i9", invoice_date: "2026-11-02", service_start: "2026-11-01", service_end: "2026-12-31", amort_commenced: "2026-11-01" });
    expect(recheckReason(snap, [], { ...ctx, period: "2026-10", items: [i, later] })).toBeNull();
  });
  it("catches a company new to the account", () => {
    expect(recheckReason(snapshot, [...was, { entity_id: B, opening: "0", closing: "5.00" }], ctx)).toMatch(/A company/);
  });
});

const mj = (status, lines, number = 1) => ({ Status: status, JournalNumber: number, DateString: "2026-10-31T00:00:00", JournalLines: lines.map(([code, amount, d]) => ({ AccountCode: code, LineAmount: amount, Description: d })) });

describe("the monthly release journals, inferred from manual journals", () => {
  const base = { accountCode: "620", period: "2026-10", tolerancePence: 100 };
  const rent = item({ id: "i2", supplier: "Landlord Ltd", pl_account_code: "469", total_cost: "1800.00", service_start: "2026-10-01", service_end: "2026-12-31", amort_commenced: "2026-10-01" });

  it("says it is an inference", () => {
    const r = journalChecks({ ...base, items: [], journals: [] });
    expect(r.inferred).toBe(true);
    expect(r.note).toMatch(/does not let us read repeating journals/);
  });
  it("finds the item that did not run, as well as the one that did", () => {
    const r = journalChecks({ ...base, items: [item(), rent], journals: [mj("POSTED", [["469", 600], ["620", -600]])] });
    expect(r.missing).toBe(1);
    expect(r.items.find((i) => i.item_id === "i1").journal).toBe("missing");
    expect(r.items.find((i) => i.item_id === "i2").journal).toBe("posted");
  });
  it("accepts one journal releasing several items on one account", () => {
    const two = item({ id: "i3", supplier: "Other Ltd", total_cost: "1200.00" });
    const r = journalChecks({ ...base, items: [item(), two], journals: [mj("POSTED", [["400", 700], ["620", -700]])] });
    expect(r.missing).toBe(0);
    expect(r.items[0].combined).toBe(true);
  });
  it("does not count a P&L debit that did not come off prepayments", () => {
    const r = journalChecks({ ...base, items: [item()], journals: [mj("POSTED", [["400", 600], ["800", -600]])] });
    expect(r.missing).toBe(1);
  });
  it("tells a draft from a release that is missing", () => {
    const r = journalChecks({ ...base, items: [item()], journals: [mj("DRAFT", [["400", 600], ["620", -600]])] });
    expect(r.in_draft).toBe(1);
    expect(r.missing).toBe(0);
    expect(r.items[0].journal).toBe("draft");
  });
  it("ignores a voided journal", () => {
    expect(journalChecks({ ...base, items: [item()], journals: [mj("VOIDED", [["400", 600], ["620", -600]])] }).missing).toBe(1);
  });
  it("warns near the end and at the last release", () => {
    const soon = journalChecks({ ...base, items: [item()], journals: [] });
    expect(soon.warnings[0]).toMatchObject({ kind: "ending" });
    expect(soon.warnings[0].text).toMatch(/last release is December 2026/);
    const last = journalChecks({ ...base, period: "2026-12", items: [item()], journals: [] });
    expect(last.warnings[0].text).toMatch(/this is the last release/);
    expect(journalChecks({ ...base, period: "2026-02", items: [item()], journals: [] }).warnings).toEqual([]);
  });
  it("spots a release still running after the item ended", () => {
    const r = journalChecks({ ...base, period: "2027-01", items: [item()], journals: [mj("POSTED", [["400", 600], ["620", -600]])] });
    expect(r.warnings.map((w) => w.kind)).toContain("overrun");
  });
});

describe("moving a rec along", () => {
  const rec = (over) => ({ line_key: "prepay", proof: "schedule", status: "in_progress", prepared_by: "agent:fm1", recheck_reason: null, ...over });
  const person = { via: null, role: "Fractional CFO", actor: "cfo@example.com", reads: [] };

  it("lets FM1 prepare, with a note and comments if it does not tie", () => {
    const fm1 = { via: { kind: "agent", agent: "fm1" }, role: "x", actor: "agent:fm1" };
    expect(stepIssues("prepare", { rec: rec(), tied: true, ...fm1 })).toEqual([]);
    expect(stepIssues("prepare", { rec: rec(), tied: false, note: "", ...fm1 })).toHaveLength(2);
    expect(stepIssues("prepare", { rec: rec(), tied: false, note: "Why", comments: true, ...fm1 })).toEqual([]);
  });
  it("keeps every other agent off preparing", () => {
    expect(stepIssues("prepare", { rec: rec(), tied: true, via: { agent: "fc" } })).toContain("Only FM1 or a person prepares a reconciliation");
  });
  it("refuses a line that is not built yet", () => {
    expect(stepIssues("prepare", { rec: rec({ line_key: "accruals" }), tied: true, via: null })[0]).toMatch(/only Prepayments/);
  });
  it("keeps review to the FC, and the preparer off their own work", () => {
    const r = rec({ status: "with_fc" });
    expect(stepIssues("review_pass", { rec: r, via: { agent: "fc" }, actor: "agent:fc" })).toEqual([]);
    expect(stepIssues("review_pass", { rec: r, via: { agent: "fm1" }, actor: "agent:fm1" })).toHaveLength(1);
    const own = { rec: rec({ status: "with_fc", prepared_by_person: "cfo@example.com" }), ...person, person: "cfo@example.com" };
    expect(stepIssues("review_pass", own).join()).toMatch(/preparer cannot review/);
    expect(stepIssues("review_pass", { ...own, sole: true })).toEqual([]);
    expect(stepIssues("review_pass", { rec: r, via: null, role: "Bookkeeper", actor: "b" }).join()).toMatch(/Only the FC or the CFO/);
    expect(stepIssues("review_back", { rec: r, via: { agent: "fc" }, note: " " })).toContain("Say what needs changing");
  });
  it("lets only a person with the CFO role sign off, once it ties", () => {
    const r = rec({ status: "with_cfo" });
    expect(stepIssues("sign_off", { rec: r, tied: true, ...person })).toEqual([]);
    expect(stepIssues("sign_off", { rec: r, tied: true, via: { kind: "agent", agent: "fc" }, role: "Fractional CFO" })).toContain("Only a person signs off, in os.stza.io");
    expect(stepIssues("sign_off", { rec: r, tied: true, via: null, role: "Bookkeeper" })).toContain("Only the CFO signs off");
    expect(stepIssues("sign_off", { rec: r, tied: false, ...person })[0]).toMatch(/does not tie/);
    expect(stepIssues("sign_off", { rec: rec({ status: "with_fc" }), tied: true, ...person })).toContain("This has not passed FC review");
  });
  it("needs a visible flag when the signer prepared, reviewed, or started the agents", () => {
    const signer = { ...person, person: "cfo@example.com", tied: true };
    for (const seat of ["prepared_by_person", "reviewed_by_person"]) {
      const r = rec({ status: "with_cfo", [seat]: "CFO@example.com" });
      expect(stepIssues("sign_off", { rec: r, ...signer }).join()).toMatch(/sole reviewer/);
      expect(stepIssues("sign_off", { rec: r, ...signer, sole: true })).toEqual([]);
    }
    expect(stepIssues("sign_off", { rec: rec({ status: "with_cfo", prepared_by_person: "other@example.com" }), ...signer })).toEqual([]);
  });
  it("L1: will not sign off unless the read ran", () => {
    expect(stepIssues("sign_off", { rec: rec({ status: "with_cfo" }), tied: true, ...person, reads: null }).join()).toMatch(/not read at sign-off/);
  });
  it("H4: will not sign off on a read that cannot be relied on", () => {
    expect(stepIssues("sign_off", { rec: rec({ status: "with_cfo" }), tied: true, ...person, reads: ["Not complete"] })).toEqual(["Not complete"]);
  });
  it("keeps send back and reopening a signed rec to the CFO", () => {
    const clerk = { via: null, role: "Bookkeeper", actor: "b", note: "x" };
    expect(stepIssues("send_back", { rec: rec({ status: "with_cfo" }), ...clerk }).join()).toMatch(/Only the CFO/);
    expect(stepIssues("reopen", { rec: rec({ status: "signed_off" }), ...clerk }).join()).toMatch(/Only the CFO/);
    expect(stepIssues("reopen", { rec: rec({ status: "with_fc" }), ...clerk })).toEqual([]);
  });
  it("reads the whole role, not a word in it", () => {
    for (const r of ["CFO", "Fractional CFO", "Fractional Finance Director", "Chief Financial Officer"]) expect(CFO_ROLE.test(r), r).toBe(true);
    for (const r of ["Assistant to the CFO", "Not CFO", "Bookkeeper", "CFO Assistant"]) expect(CFO_ROLE.test(r), r).toBe(false);
  });
  it("will not sign off what is marked to re-check", () => {
    expect(stepIssues("sign_off", { rec: rec({ status: "with_cfo", recheck_reason: "moved" }), tied: true, ...person })[0]).toMatch(/preparing again/);
  });
});

describe("a proposed journal", () => {
  const ok = { date: "2026-10-31", narration: "Release", reason: "Missed", lines: [{ account_code: "400", amount: 600 }, { account_code: "620", amount: -600 }] };
  const ctx = { period: "2026-10", recAccountCode: "620" };

  it("passes when sound", () => expect(journalProposalIssues(ok, ctx)).toEqual([]));
  it("must balance", () => {
    expect(journalProposalIssues({ ...ok, lines: [{ account_code: "400", amount: 600 }, { account_code: "620", amount: -500 }] }, ctx).join()).toMatch(/does not balance/);
  });
  it("must be dated in the month, and touch the account", () => {
    expect(journalProposalIssues({ ...ok, date: "2026-09-30" }, ctx).join()).toMatch(/dated in October 2026/);
    expect(journalProposalIssues(ok, { ...ctx, recAccountCode: "999" }).join()).toMatch(/account being reconciled/);
  });
  it("fails, not skips, when the company has no account code", () => {
    for (const code of [null, undefined, " "]) expect(journalProposalIssues(ok, { ...ctx, recAccountCode: code }).join()).toMatch(/no ledger account/);
  });
  it("copes with lines that are not lines", () => {
    expect(journalProposalIssues({ ...ok, lines: [null, null] }, ctx).join()).toMatch(/not a journal line/);
  });
  it("keeps the narration short: the reasoning stays out of Xero", () => {
    expect(journalProposalIssues({ ...ok, narration: "x".repeat(121) }, ctx).join()).toMatch(/120 characters/);
  });
  it("needs a reason", () => expect(journalProposalIssues({ ...ok, reason: "" }, ctx)).toContain("reason is required"));

  const approved = { journal_date: "2026-10-31", narration: "Release", lines: ok.lines };
  it("matches exactly, in any line order", () => {
    expect(journalMatches(approved, { ...ok, lines: [...ok.lines].reverse() })).toBe(true);
    expect(journalMatches(approved, { ...ok, lines: [{ account_code: "400", amount: "600.00" }, { account_code: "620", amount: "-600.00" }] })).toBe(true);
  });
  it("M7: refuses a changed description or tax type, which the model may vary but the run may not", () => {
    const stored = { ...approved, lines: [{ account_code: "400", amount: 600, description: "A", tax_type: "NONE" }, { account_code: "620", amount: -600, description: "B", tax_type: "NONE" }] };
    expect(journalMatches(stored, { ...ok, lines: stored.lines })).toBe(true);
    expect(journalMatches(stored, { ...ok, lines: [{ ...stored.lines[0], description: "Z" }, stored.lines[1]] })).toBe(false);
    expect(journalMatches(stored, { ...ok, lines: [{ ...stored.lines[0], tax_type: "INPUT2" }, stored.lines[1]] })).toBe(false);
    expect(journalAgrees(stored, { ...ok, lines: [{ account_code: "400", amount: 600 }, { account_code: "620", amount: -600 }] })).toBe(true);
    expect(journalAgrees(stored, { ...ok, lines: [{ account_code: "400", amount: 601 }, { account_code: "620", amount: -601 }] })).toBe(false);
  });
  it("refuses any change to what was approved", () => {
    expect(journalMatches(approved, { ...ok, date: "2026-10-30" })).toBe(false);
    expect(journalMatches(approved, { ...ok, narration: "Other" })).toBe(false);
    expect(journalMatches(approved, { ...ok, lines: [{ account_code: "400", amount: 601 }, { account_code: "620", amount: -601 }] })).toBe(false);
    expect(journalMatches(approved, { ...ok, lines: [{ account_code: "401", amount: 600 }, { account_code: "620", amount: -600 }] })).toBe(false);
  });
});

describe("H1: a journal proposed on a rec reaches Xero only through the CFO's approval", () => {
  const lines = [{ account_code: "485", amount: 600 }, { account_code: "620", amount: -600 }];
  const input = { date: "2026-10-31", narration: "Release", status: "DRAFT", lines };
  const proposal = { id: "j1", state: "proposed", attempts: 1, approved_run_id: null, journal_date: "2026-10-31", narration: "Release", lines };
  const approved = { ...proposal, state: "approved", approved_run_id: "run-2" };

  it("refuses a chat reply in a rec thread, whatever the journal", () => {
    expect(recJournalGate({ runId: "run-1", inRecThread: true, proposals: [proposal], input }).refuse).toMatch(/approved on the reconciliation/);
    expect(recJournalGate({ runId: "run-1", inRecThread: true, proposals: [], input }).refuse).toBeTruthy();
  });
  it("refuses another run while one is approved", () => {
    expect(recJournalGate({ runId: "run-9", inRecThread: true, proposals: [approved], input }).refuse).toBeTruthy();
  });
  it("refuses the same lines from a caller that names no run", () => {
    expect(recJournalGate({ proposals: [proposal], input, inRecThread: false }).refuse).toMatch(/proposed on a reconciliation/);
  });
  it("lets the approved run through, on the proposal's key", () => {
    expect(recJournalGate({ runId: "run-2", inRecThread: true, proposals: [approved], input })).toMatchObject({ journal: approved, key: "rec-journal-j1-1" });
  });
  it("holds even the approved run to the exact journal, as a draft", () => {
    expect(recJournalGate({ runId: "run-2", inRecThread: true, proposals: [approved], input: { ...input, status: "POSTED" } }).refuse).toMatch(/DRAFT/);
    expect(recJournalGate({ runId: "run-2", inRecThread: true, proposals: [approved], input: { ...input, narration: "Other" } }).refuse).toMatch(/differs/);
  });
  it("leaves a journal nothing to do with a rec alone", () => {
    expect(recJournalGate({ proposals: [], input, inRecThread: false })).toEqual({});
    expect(recJournalGate({ runId: "run-1", proposals: [proposal], input: { ...input, lines: [{ account_code: "1", amount: 5 }, { account_code: "2", amount: -5 }] }, inRecThread: false })).toEqual({});
  });
  it("M3: holds other callers on the rec's account, and only there", () => {
    const live = { ...proposal, rec_code: "620" };
    const other = (over) => recJournalGate({ proposals: [live], inRecThread: false, input: { ...input, ...over } });
    expect(other({ lines: [{ account_code: "485", amount: 601 }, { account_code: "620", amount: -601 }] }).refuse).toMatch(/Account 620/);
    expect(other({ lines: [{ account_code: "485", amount: 300 }, { account_code: "486", amount: 300 }, { account_code: "620", amount: -600 }] }).refuse).toMatch(/Account 620/);
    expect(other({ date: "2026-11-02" }).refuse).toMatch(/proposed on a reconciliation/);
    expect(other({ date: "2026-11-02", lines: [{ account_code: "485", amount: 9 }, { account_code: "620", amount: -9 }] })).toEqual({});
    expect(other({ lines: [{ account_code: "485", amount: 5 }, { account_code: "090", amount: -5 }] })).toEqual({});
  });
  it("M3: remembers superseded and rejected lines for their month only", () => {
    const old = { ...proposal, state: "superseded", rec_code: "620" };
    const g = (over) => recJournalGate({ proposals: [old], inRecThread: false, input: { ...input, ...over } });
    expect(g({}).refuse).toBeTruthy();
    expect(g({ date: "2026-11-30" })).toEqual({});
    expect(g({ lines: [{ account_code: "485", amount: 601 }, { account_code: "620", amount: -601 }] })).toEqual({});
  });
  it("L9: checks the rec again for the approved run", () => {
    expect(recJournalGate({ runId: "run-2", inRecThread: true, proposals: [{ ...approved, recheck_reason: "moved" }], input }).refuse).toMatch(/moved/);
    expect(recJournalGate({ runId: "run-2", inRecThread: true, proposals: [{ ...approved, status: "signed_off" }], input }).refuse).toMatch(/signed off/);
  });
  it("survives a malformed journal", () => {
    expect(recJournalGate({ proposals: [proposal], input: { lines: [null] }, inRecThread: false })).toEqual({});
  });
});

describe("H2: one approval, one draft", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("keys on the proposal, moving on only by attempt", () => {
    expect(recJournalKey({ id: "j", attempts: 1 })).toBe("rec-journal-j-1");
    expect(recJournalKey({ id: "j", attempts: 2 })).toBe("rec-journal-j-2");
  });
  it("treats a recent queued or running run as live, and one past the approval's age as not", () => {
    expect(runIsLive({ status: "queued", queued_at: "2026-11-01T11:50:00Z" }, now)).toBe(true);
    expect(runIsLive({ status: "running", queued_at: "2026-11-01T11:00:00Z" }, now)).toBe(false);
    expect(runIsLive({ status: "failed", queued_at: "2026-11-01T11:59:00Z" }, now)).toBe(false);
    expect(runIsLive(null, now)).toBe(false);
  });
  it("retries only when a second draft cannot result", () => {
    expect(retryState({ runLive: true, post: null })).toBe("live");
    expect(retryState({ runLive: false, post: null })).toBe("go");
    expect(retryState({ runLive: false, post: { outcome: "draft" } })).toBe("drafted");
    expect(retryState({ runLive: false, post: { outcome: "failed", http_status: 400 } })).toBe("retry");
    for (const post of [{ outcome: "pending" }, { outcome: "failed", http_status: 0 }, { outcome: "failed", http_status: 503 }, { outcome: "failed", http_status: 429 }]) {
      expect(retryState({ runLive: false, post }), JSON.stringify(post)).toBe("unknown");
    }
  });
  it("M2: says nothing was created only after a definite refusal", () => {
    for (const [s, b] of [[422, {}], [404, {}], [502, { stage: "xero", http_status: 400 }], [200, { ok: false, http_status: 403 }]]) {
      expect(draftFailure(s, b), `${s}`).toMatch(/Nothing was created/);
    }
    for (const [s, b] of [[0, null], [409, { stage: "idempotency" }], [502, { stage: "xero", http_status: 0 }], [502, { stage: "xero", http_status: 503 }], [502, { stage: "xero", http_status: 429 }], [500, {}], [200, { ok: false, http_status: 0 }]]) {
      expect(draftFailure(s, b), `${s}`).toMatch(/may be in Xero/);
      expect(draftFailure(s, b)).not.toMatch(/Nothing was created/);
    }
  });
  it("refuses approval on a signed, dropped, or re-check rec", () => {
    expect(approvalIssues({ status: "signed_off" })).toMatch(/signed off/);
    expect(approvalIssues({ status: "in_progress", dropped_at: "x" })).toMatch(/no longer/);
    expect(approvalIssues({ status: "in_progress", recheck_reason: "x" })).toMatch(/moved/);
    expect(approvalIssues({ status: "in_progress" })).toBeNull();
  });
});

describe("the approval goes through the one existing path", () => {
  const id = "ab12cd34-0000-4000-8000-1234567890ab";
  const answer = "Proposed journal (draft)\n\nCompany: acme-ltd\nDate: 2026-10-31\nNarration: Release\n\n400 Insurance Dr 600.00\n620 Prepayments Cr 600.00";

  it("is read as a plain approval by lib/draft-approval.js", () => {
    const current = { instruction: approvalInstruction(id), requested_by_email: "cfo@example.com", queued_at: "2026-11-01T09:00:00Z" };
    const a = approvalFromThread({ current, parent: { output: answer } });
    expect(a.error).toBeUndefined();
    expect(a.approval.presented_text).toBe(answer);
    expect(a.approval.approved_by).toBe("cfo@example.com");
  });
  it("marks a run started by that approval, and no ordinary run", () => {
    expect(namesRecProposal(approvalInstruction(id))).toBe(true);
    expect(namesRecProposal("Approved")).toBe(false);
  });
  it("is checked against what the agent's answer showed", () => {
    const lines = [{ account_code: "400", amount: 600 }, { account_code: "620", amount: -600 }];
    expect(checkApprovalText(answer, { entityNames: ["acme-ltd"], date: "2026-10-31", lines })).toEqual([]);
    expect(checkApprovalText("A journal for you.", { entityNames: ["acme-ltd"], date: "2026-10-31", lines }).length).toBeGreaterThan(0);
  });
});

describe("M1: the base prompt", () => {
  it("does not offer a text proposal for reconciliation work", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "runner.js"), "utf8");
    expect(src).toMatch(/Do not follow the steps above for it\. Record it with propose_rec_journal/);
  });
});

describe("the agent's tools", () => {
  const job = { id: "11111111-1111-4111-8111-111111111111", agent: "fm1", client: { slug: "acme" } };
  const recId = "22222222-2222-4222-8222-222222222222";
  const setup = () => {
    const calls = [];
    const api = agentRecs({
      apiCall: async (m, p) => { calls.push([m, p]); return { recs: [] }; },
      apiRequest: async (m, p, body, headers) => { calls.push([m, p, body, headers]); return { ok: true, status: 200, body: {} }; },
      requesterOf: async () => "cfo@example.com",
    });
    return { api, calls };
  };

  it("offers no way to sign off, approve, or set a class", () => {
    const names = setup().api.names;
    expect(names.join()).not.toMatch(/sign|approve|class/);
    const props = setup().api.tools(["acme-ltd"]).flatMap((t) => Object.keys(t.input_schema.properties));
    expect(props).not.toContain("class");
    expect(props).not.toContain("line_key");
  });
  it("acts as the person who asked, named as the agent and run", async () => {
    const { api, calls } = setup();
    await api.call(job, [], "review_rec", { rec_id: recId, pass: true, note: "Fine" });
    expect(calls[0][3]).toEqual({ "X-Actor-Email": "cfo@example.com", "X-Work-Via": `agent:fm1:${job.id}` });
  });
  it("puts comments on before handing over", async () => {
    const { api, calls } = setup();
    await api.call(job, [], "submit_rec", { rec_id: recId, note: "n", comments: [{ entity_id: "e", comment: "c" }] });
    expect(calls.map((c) => c[1].split("/").pop())).toEqual(["comment", "prepare"]);
  });
  it("refuses an id that is not one", async () => {
    expect((await setup().api.call(job, [], "get_rec", { rec_id: "../xero" })).error).toMatch(/reconciliation id/);
  });
  it("asks FM1 to read the procedure, and not to create the journal", () => {
    const text = prepareInstruction({ id: recId, account_name: "Prepayments", period: "2026-10" });
    expect(text).toMatch(/accruals-and-prepayments/);
    expect(text).toMatch(/Do not create it/);
  });
});

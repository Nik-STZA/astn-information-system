import { describe, it, expect } from "vitest";
import {
  lockIssue, accountOwners, mapIssues, sliceIssues, lineFindings, startPeriod, expectedCharge,
  roll, tbFooting, tie, expectedChargeControl, xeroRunControl, addMonths, monthEnd,
} from "./asset-register";

const E = "ent-1";
const WIP = "aaaaaaaa-0000-0000-0000-000000000789";
const COST = "aaaaaaaa-0000-0000-0000-000000000787";
const ACC = "aaaaaaaa-0000-0000-0000-000000000788";
const TM = "aaaaaaaa-0000-0000-0000-000000000775";

// A Xero trial balance report: [account id, name, ytd debit, ytd credit].
const report = (rows) => ({ Rows: [{ RowType: "Section", Rows: rows.map(([id, name, dr, cr]) => ({
  RowType: "Row", Cells: [{ Value: name, Attributes: [{ Id: "account", Value: id }] }, { Value: "0" }, { Value: "0" }, { Value: String(dr) }, { Value: String(cr) }],
})) }] });

const line = (o) => ({ id: o.id ?? "l1", state: "approved", treatment: "capitalise", source_type: "invoice", xero_source_id: "inv-1", xero_line_id: "li-1",
  source_net: 100, amount: 100, line_date: "2026-09-10", asset_id: "a1", owning_entity_id: E, posted_account_id: WIP, ...o });

describe("periods and the signed-month lock", () => {
  it("counts months", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
  });

  it("refuses a write into a signed month of the same grouping only", () => {
    const periods = [{ grouping: "dev_project", period: "2026-09", status: "signed" }, { grouping: "dev_project", period: "2026-10", status: "prepared" }];
    expect(lockIssue(periods, "dev_project", "2026-09-30")).toMatch(/signed for 2026-09/);
    expect(lockIssue(periods, "dev_project", "2026-10-01")).toBeNull();
    expect(lockIssue(periods, "ip_registered", "2026-09-30")).toBeNull();
  });
});

describe("who amortises an account", () => {
  const map = [
    { entity_id: E, grouping: "dev_project", xero_account_id: WIP, account_code: "789", amortised_by: "register", effective_from: "2026-08-31", effective_to: null },
    { entity_id: E, grouping: "software_internal", xero_account_id: WIP, account_code: "789", amortised_by: "register", effective_from: "2026-08-31", effective_to: null },
    { entity_id: E, grouping: "ip_registered", xero_account_id: TM, account_code: "775", amortised_by: "xero", effective_from: "2026-08-31", effective_to: "2026-12-31" },
    { entity_id: E, grouping: "ip_registered", xero_account_id: TM, account_code: "775", amortised_by: "register", effective_from: "2027-01-01", effective_to: null },
  ];

  it("lets two groupings share an account (789)", () => {
    const o = accountOwners(map, E, WIP, "2026-10-31");
    expect(o.groupings).toEqual(["dev_project", "software_internal"]);
    expect(o.amortised_by).toBe("register");
    expect(o.issue).toBeNull();
  });

  it("moves an account from Xero to the register at the planned cut-off", () => {
    expect(accountOwners(map, E, TM, "2026-12-31").amortised_by).toBe("xero");
    expect(accountOwners(map, E, TM, "2027-01-01").amortised_by).toBe("register");
    expect(mapIssues(map)).toEqual([]);
  });

  it("finds two mappings that disagree on who amortises", () => {
    const bad = [...map, { entity_id: E, grouping: "software_internal", xero_account_id: TM, account_code: "775", amortised_by: "register", effective_from: "2026-11-01", effective_to: null }];
    expect(mapIssues(bad)[0]).toMatch(/775 is mapped as amortised by both/);
  });
});

describe("cost lines", () => {
  it("checks that slices of a source line sum to its net, to the penny", () => {
    expect(sliceIssues([line({ id: "a", amount: 60 }), line({ id: "b", amount: 40 })])).toEqual([]);
    const off = sliceIssues([line({ id: "a", amount: 60 }), line({ id: "b", amount: 36 })]);
    expect(off[0].difference).toBe(4);
    expect(off[0].issue).toMatch(/96.00 against 100.00/);
    // Withdrawn slices do not count.
    expect(sliceIssues([line({ id: "a", amount: 60 }), line({ id: "b", amount: 40 }), line({ id: "c", amount: 5, state: "withdrawn" })])).toEqual([]);
  });

  it("lists old unallocated lines unless they carry a question, and posted-account mismatches", () => {
    const f = lineFindings([
      line({ id: "u1", asset_id: null, treatment: null, line_date: "2026-09-01" }),
      line({ id: "u2", asset_id: null, treatment: null, line_date: "2026-09-01", fields: { question: "Which phase?" } }),
      line({ id: "u3", asset_id: null, treatment: null, line_date: "2026-10-05" }),
      line({ id: "m1", expected_account_id: "x-786", posted_account_id: "x-787" }),
    ], "2026-10");
    expect(f.unallocated.map((x) => x.id)).toEqual(["u1"]);
    expect(f.mismatched).toEqual([expect.objectContaining({ id: "m1", fix_route: "edit_bill" })]);
  });
});

describe("amortisation", () => {
  it("starts from the signed date by the policy's convention, and never without one", () => {
    expect(startPeriod("2026-11-15", "month_following")).toBe("2026-12");
    expect(startPeriod("2026-11-15", "same_month")).toBe("2026-11");
    expect(startPeriod(null, "same_month")).toBeNull();
    expect(expectedCharge({ cost: 3600, lifeMonths: 36, start: null, period: "2026-12" })).toBe(0);
  });

  it("charges straight line over the remaining life and puts the pence in the final month", () => {
    const base = { cost: 1000, lifeMonths: 3, start: "2027-01" };
    expect(expectedCharge({ ...base, period: "2026-12" })).toBe(0);
    expect(expectedCharge({ ...base, period: "2027-01", accumulated: 0 })).toBe(333.33);
    expect(expectedCharge({ ...base, period: "2027-02", accumulated: -333.33 })).toBe(333.34);
    expect(expectedCharge({ ...base, period: "2027-03", accumulated: -666.67 })).toBe(333.33);
    expect(expectedCharge({ ...base, period: "2027-04", accumulated: -1000 })).toBe(0);
    expect(expectedCharge({ ...base, period: "2027-01", lifeKind: "indefinite" })).toBe(0);
  });
});

describe("the roll-forward", () => {
  const assets = [{ id: "a1", entity_id: E, cost_account_id: COST, accum_account_id: ACC }];
  const lines = [
    line({ id: "open", line_date: "2026-05-01", amount: 1000, source_net: 1000, xero_source_id: "inv-0" }),
    line({ id: "sep", line_date: "2026-09-10", amount: 100 }),
    line({ id: "prop", line_date: "2026-09-12", amount: 50, state: "proposed", xero_source_id: "inv-9" }),
    line({ id: "exp", line_date: "2026-09-12", amount: 70, treatment: "expense_research", xero_source_id: "inv-8" }),
  ];

  it("adds approved capitalised lines in the month of their date, on the account Xero posted them to", () => {
    const r = roll({ assets, lines, events: [], period: "2026-09" });
    const wip = r.accounts.find((a) => a.account_id === WIP);
    expect(wip).toMatchObject({ opening: 1000, additions: 100, closing: 1100 });
    expect(r.assets.get("a1")).toMatchObject({ cost: 1100, accumulated: 0 });
    expect(roll({ assets, lines, events: [], period: "2026-08" }).accounts[0].closing).toBe(1000);
  });

  it("applies opening, transfer, amortisation and reversal events", () => {
    const events = [
      { id: "e0", asset_id: "a1", entity_id: E, kind: "opening", period: "2026-08", amount: 0 },
      { id: "e1", asset_id: "a1", entity_id: E, kind: "transfer", period: "2026-10", amount: 1100, accounts: { from: WIP, to: COST } },
      { id: "e2", asset_id: "a1", entity_id: E, kind: "amortisation", period: "2026-11", amount: 30.56 },
      { id: "e3", asset_id: "a1", entity_id: E, kind: "amortisation", period: "2026-11", amount: 99 },
      { id: "e4", asset_id: "a1", entity_id: E, kind: "reversal", period: "2026-11", reverses_event_id: "e3" },
    ];
    const r = roll({ assets, lines, events, period: "2026-11" });
    const by = Object.fromEntries(r.accounts.map((a) => [a.account_id, a.closing]));
    expect(by).toEqual({ [WIP]: 0, [COST]: 1100, [ACC]: -30.56 });
    expect(r.assets.get("a1")).toMatchObject({ cost: 1100, accumulated: -30.56, amortisation: -30.56 });
  });

  it("refuses a malformed period", () => {
    expect(() => roll({ assets, lines, events: [], period: "Sep 2026" })).toThrow(/YYYY-MM/);
  });
});

describe("controls", () => {
  it("fails a trial balance that does not foot, or disagrees with Xero's own report", () => {
    expect(tbFooting(report([[WIP, "Software (WIP) (789)", 1100, 0], ["x", "Bank", 0, 1100]])).foots).toBe(true);
    expect(tbFooting(report([[WIP, "Software (WIP) (789)", 1100, 0], ["x", "Bank", 0, 1000]])).issues[0]).toMatch(/does not foot/);
    const typo = tbFooting(report([[WIP, "Software (WIP) (789)", 1100, 0], ["x", "Bank", 0, 1100]]), { [WIP]: 1010 });
    expect(typo.foots).toBe(false);
    expect(typo.issues[0]).toMatch(/1,100.00 against Xero's report 1,010.00/);
  });

  it("checks the read against Xero's own total, and a penny inside Xero's report only when acknowledged", () => {
    const withTotal = (rows, dr, cr) => ({ Rows: [...report(rows).Rows, { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "0" }, { Value: "0" }, { Value: String(dr) }, { Value: String(cr) }] }] });
    const rows = [[WIP, "Software (WIP) (789)", 1100.01, 0], ["x", "Bank", 0, 1100.02]];
    const out = tbFooting(withTotal(rows, 1100.01, 1100.02));
    expect(out).toMatchObject({ foots: false, difference: -0.01, xero_totals: { debits: 1100.01, credits: 1100.02 } });
    const ok = tbFooting(withTotal(rows, 1100.01, 1100.02), null, { difference: -0.01, reason: "Xero's foreign-currency rounding" });
    expect(ok).toMatchObject({ foots: true, acknowledged: { difference: -0.01 } });
    const wrong = tbFooting(withTotal(rows, 1100.01, 1100.02), null, { difference: -0.02, reason: "Xero's foreign-currency rounding" });
    expect(wrong.foots).toBe(false);
    expect(wrong.issues[0]).toMatch(/acknowledgement names -0.02/);
    // A partial read never passes, acknowledged or not.
    const partial = tbFooting(withTotal(rows, 1200.01, 1200.02), null, { difference: -0.01, reason: "rounding" });
    expect(partial.foots).toBe(false);
    expect(partial.issues[0]).toMatch(/do not add up to Xero's own total/);
  });

  it("ties per company and account and shows a named item beside the difference, never netted away", () => {
    const rolled = roll({ assets: [{ id: "a1", entity_id: E }], lines: [line({ amount: 100 })], events: [], period: "2026-09" });
    const tb = { [E]: report([[WIP, "Software (WIP) (789)", 101.37, 0]]) };
    const [row] = tie({ rolled, trialBalances: tb, namedItems: [{ entity_id: E, account_id: WIP, label: "Unexplained residual carried from August", amount: 1.37 }] });
    expect(row).toMatchObject({ register: 100, ledger: 101.37, difference: 1.37, unexplained: 0, ties: true });
    expect(row.named_items[0].label).toMatch(/residual/);
    const [bare] = tie({ rolled, trialBalances: tb });
    expect(bare).toMatchObject({ difference: 1.37, unexplained: 1.37, ties: false });
    expect(tie({ rolled, trialBalances: tb, tolerance: 2 })[0].ties).toBe(true);
  });

  it("fails the expected charge when register and ledger have both stopped", () => {
    const assets = [{ id: "a1", entity_id: E, accum_account_id: ACC, policy_id: "p1", available_for_use_date: "2026-09-15" }];
    const policies = { p1: { life_months: 36, life_kind: "finite", residual_value: 0, start_convention: "month_following" } };
    const map = [{ entity_id: E, grouping: "dev_project", xero_account_id: ACC, amortised_by: "register", effective_from: "2026-08-31", effective_to: null }];
    const before = new Map([["a1", { cost: 3600, accumulated: 0 }]]);
    const frozen = expectedChargeControl({ assets, policies, period: "2026-10", before, map, trialBalances: { [E]: report([[ACC, "Software Accumulated Amortisation (788)", 0, 0]]) } });
    expect(frozen[0]).toMatchObject({ charge: 100, expected: -100, ledger: 0, passes: false });
    const charged = expectedChargeControl({ assets, policies, period: "2026-10", before, map, trialBalances: { [E]: report([[ACC, "Software Accumulated Amortisation (788)", 0, 100]]) } });
    expect(charged[0].passes).toBe(true);
    // An account Xero amortises is not this control's: it is xeroRunControl's.
    const xeroMap = [{ ...map[0], amortised_by: "xero" }];
    expect(expectedChargeControl({ assets, policies, period: "2026-10", before, map: xeroMap, trialBalances: {} })).toEqual([]);
  });

  it("reads whether Xero's depreciation ran for the month from its last run date", () => {
    expect(xeroRunControl("2026-08-31T00:00:00", "2026-10")).toMatchObject({ passes: false, months_not_run: ["Sep 2026", "Oct 2026"] });
    expect(xeroRunControl("2026-10-31T00:00:00", "2026-10").passes).toBe(true);
    expect(xeroRunControl(null, "2026-10").passes).toBe(false);
  });
});

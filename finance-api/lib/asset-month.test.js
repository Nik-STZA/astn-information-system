import { describe, it, expect } from "vitest";
import { prepareMonth, monthsAfter } from "./asset-month";

const E = "e1";
const WIP = "acc-783";
const TM = "acc-775";
const TMACC = "acc-776";
const report = (rows) => ({ Rows: [{ RowType: "Section", Rows: [...rows, ["bank", "Bank", 0, rows.reduce((s, r) => s + r[2] - r[3], 0)]].map(([id, name, dr, cr]) => ({
  RowType: "Row", Cells: [{ Value: name, Attributes: [{ Id: "account", Value: id }] }, { Value: "0" }, { Value: "0" }, { Value: String(dr > 0 ? dr : 0) }, { Value: String(cr > 0 ? cr : 0) }],
})) }] });
const map = [
  { entity_id: E, grouping: "g", role: "wip", xero_account_id: WIP, account_code: "783", amortised_by: "register", effective_from: "2026-08-31", effective_to: null },
  { entity_id: E, grouping: "g", role: "cost", xero_account_id: TM, account_code: "775", amortised_by: "xero", effective_from: "2026-08-31", effective_to: "2026-12-31" },
  { entity_id: E, grouping: "g", role: "accumulated", xero_account_id: TMACC, account_code: "776", amortised_by: "xero", effective_from: "2026-08-31", effective_to: "2026-12-31" },
];
const assets = [
  { id: "a1", entity_id: E, asset_no: "IA-003", cost_account_id: WIP },
  { id: "a2", entity_id: E, asset_no: "TM-1", cost_account_id: TM, accum_account_id: TMACC },
];
const line = (o) => ({ id: o.id, state: "approved", treatment: "capitalise", source_type: "workbook", asset_id: "a1", owning_entity_id: E,
  amount: 100, source_net: 100, line_date: "2026-08-31", posted_account_id: WIP, fields: { source_key: o.id }, ...o });
const lines = [
  line({ id: "bf", amount: 1000, source_net: 1000 }),
  line({ id: "tm", amount: 920, source_net: 920, asset_id: "a2", posted_account_id: TM }),
  line({ id: "sep", amount: 216.67, source_net: 216.67, line_date: "2026-09-30", source_type: "manual_journal", xero_source_id: "mj", xero_line_id: "l1", fields: {} }),
];
const events = [{ id: "o1", asset_id: "a2", entity_id: E, kind: "opening", period: "2026-08", amount: 253.11, accounts: { accumulated: TMACC } }];
const opening = report([[WIP, "WIP (783)", 1000, 0], [TM, "TM (775)", 920, 0], [TMACC, "TM acc (776)", 0, 253]]);
const sept = report([[WIP, "WIP (783)", 1216.67, 0], [TM, "TM (775)", 920, 0], [TMACC, "TM acc (776)", 0, 260.67]]);
const named = [{ entity_id: E, account_id: TMACC, label: "Rounding against Xero's register", amount: 0.11 }];

describe("preparing a month", () => {
  it("rolls the register forward and ties it, taking Xero's own movement on accounts Xero amortises", () => {
    const out = prepareMonth({ period: "2026-09", map, assets, lines, events, trialBalances: { [E]: sept }, openingTrialBalances: { [E]: opening },
      namedItems: named, lastDepreciation: { [E]: "2026-09-30T00:00:00" } });
    expect(out.issues).toEqual([]);
    expect(out.prepared).toBe(true);
    const wip = out.accounts.find((a) => a.account_id === WIP);
    expect(wip).toMatchObject({ opening: 1000, additions: 216.67, register: 1216.67, ledger: 1216.67, ties: true });
    const acc = out.accounts.find((a) => a.account_id === TMACC);
    expect(acc).toMatchObject({ by_xero: -7.67, register: -260.78, ledger: -260.67, difference: 0.11, unexplained: 0, ties: true });
    expect(out.xero_runs[0].passes).toBe(true);
  });

  it("reports Xero's depreciation not run as a finding, not a block", () => {
    const flat = report([[WIP, "WIP (783)", 1216.67, 0], [TM, "TM (775)", 920, 0], [TMACC, "TM acc (776)", 0, 253]]);
    const out = prepareMonth({ period: "2026-09", map, assets, lines, events, trialBalances: { [E]: flat }, openingTrialBalances: { [E]: opening },
      namedItems: named, lastDepreciation: { [E]: "2026-08-31T00:00:00" } });
    expect(out.prepared).toBe(true);
    expect(out.findings[0]).toMatchObject({ kind: "xero_depreciation_not_run" });
    expect(out.findings[0].issue).toMatch(/Sep 2026/);
  });

  it("blocks on a line still waiting for a decision, and on anything unexplained", () => {
    const waiting = [...lines, line({ id: "q", state: "proposed", amount: 50, source_net: 50, line_date: "2026-09-15", asset_id: null, treatment: null, invoice_no: "INV-9" })];
    const out = prepareMonth({ period: "2026-09", map, assets, lines: waiting, events, trialBalances: { [E]: sept }, openingTrialBalances: { [E]: opening },
      namedItems: named, lastDepreciation: { [E]: "2026-09-30" } });
    expect(out.prepared).toBe(false);
    expect(out.issues[0]).toMatch(/INV-9 \(50.00, 2026-09-15\) is still waiting/);
    const short = prepareMonth({ period: "2026-09", map, assets, lines: lines.slice(0, 2), events, trialBalances: { [E]: sept }, openingTrialBalances: { [E]: opening },
      namedItems: named, lastDepreciation: { [E]: "2026-09-30" } });
    expect(short.prepared).toBe(false);
    expect(short.issues.join(" ")).toMatch(/WIP \(783\).*216.67 unexplained/);
  });

  it("counts a line with no posted account on its asset's account", () => {
    const noAccount = lines.map((l) => (l.id === "bf" ? { ...l, posted_account_id: null } : l));
    const out = prepareMonth({ period: "2026-09", map, assets, lines: noAccount, events, trialBalances: { [E]: sept }, openingTrialBalances: { [E]: opening },
      namedItems: named, lastDepreciation: { [E]: "2026-09-30" } });
    expect(out.prepared).toBe(true);
    expect(out.accounts.find((a) => a.account_id === WIP)).toMatchObject({ opening: 1000, register: 1216.67, ties: true });
  });

  it("names a nil account by its code when the trial balance has no row for it", () => {
    const extra = [...map, { entity_id: E, grouping: "g", role: "wip", xero_account_id: "acc-786", account_code: "786", amortised_by: "register", effective_from: "2026-08-31", effective_to: null }];
    const out = prepareMonth({ period: "2026-09", map: extra, assets, lines, events, trialBalances: { [E]: sept }, openingTrialBalances: { [E]: opening },
      namedItems: named, lastDepreciation: { [E]: "2026-09-30" } });
    expect(out.accounts.find((a) => a.account_id === "acc-786")).toMatchObject({ account: "(786)", register: 0, ledger: 0, ties: true });
  });

  it("counts the months after the opening", () => {
    expect(monthsAfter("2026-08", "2026-10")).toEqual(["2026-09", "2026-10"]);
    expect(monthsAfter("2026-11", "2027-01")).toEqual(["2026-12", "2027-01"]);
  });
});

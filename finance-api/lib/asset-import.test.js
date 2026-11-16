import { describe, it, expect } from "vitest";
import { payloadIssues, resolveAccounts, plan, openingTie, isMonthEnd } from "./asset-import";

const companies = [
  { id: "e1", slug: "alpha-ltd", name: "Alpha Ltd", reporting_framework: "FRS 102" },
  { id: "e2", slug: "beta-ltd", name: "Beta Ltd", reporting_framework: "FRS 102 Section 1A" },
];
const ids = { "alpha-ltd": "e1", "beta-ltd": "e2" };
const ref = { file: "f.xlsx", sheet: "S", row: 4 };
const body = () => ({
  grouping: "dev_project", as_at: "2026-08-31",
  source: { original_sha256: "a", read_sha256: "b" },
  assets: [{ asset_no: "IA-001", entity: "alpha-ltd", name: "Track", status: "wip", cost_account: "780", source_ref: ref }],
  cost_lines: [
    { line_date: "2026-01-05", billed_entity: "alpha-ltd", owning_entity: "alpha-ltd", source_net: 100, amount: 60, asset_no: "IA-001", treatment: "capitalise", reason_text: "Development", posted_account: "780", fields: { source_key: "inv-1" }, source_ref: ref },
    { line_date: "2026-01-05", billed_entity: "alpha-ltd", owning_entity: "alpha-ltd", source_net: 100, amount: 40, asset_no: null, treatment: "expense_admin", reason_text: "Admin share", fields: { source_key: "inv-1" }, source_ref: ref },
  ],
  account_map: [{ entity: "alpha-ltd", code: "780", role: "wip", amortised_by: "register", effective_from: "2026-08-31" }],
  named_items: [],
});
const chart = { "alpha-ltd": [{ Code: "780", AccountID: "acc-780", Status: "ACTIVE" }], "beta-ltd": [] };
const tb = (v) => ({ Rows: [{ RowType: "Section", Rows: [
  { RowType: "Row", Cells: [{ Value: "WIP (780)", Attributes: [{ Id: "account", Value: "acc-780" }] }, { Value: "0" }, { Value: "0" }, { Value: String(v) }, { Value: "0" }] },
  { RowType: "Row", Cells: [{ Value: "Bank", Attributes: [{ Id: "account", Value: "bank" }] }, { Value: "0" }, { Value: "0" }, { Value: "0" }, { Value: String(v) }] },
] }] });

describe("the opening import payload", () => {
  it("accepts a clean payload and a month-end date only", () => {
    expect(payloadIssues(body(), companies)).toEqual([]);
    expect(isMonthEnd("2026-08-31")).toBe(true);
    expect(isMonthEnd("2026-08-30")).toBe(false);
    expect(payloadIssues({ ...body(), as_at: "2026-08-30" }, companies)[0]).toMatch(/month end/);
  });

  it("refuses unknown companies, capitalised cost with no asset, lines after the opening and stray named items", () => {
    const b = body();
    b.assets[0].entity = "gamma-ltd";
    expect(payloadIssues(b, companies).join(" ")).toMatch(/no company gamma-ltd/);
    const c = body();
    c.cost_lines[1].treatment = "capitalise";
    expect(payloadIssues(c, companies).join(" ")).toMatch(/capitalised with no asset/);
    const d = body();
    d.cost_lines[0].line_date = "2026-09-01";
    expect(payloadIssues(d, companies).join(" ")).toMatch(/after the opening date/);
    const e = body();
    e.named_items = [{ entity: "alpha-ltd", account: "775", amount: 0.5, label: "Rounding" }];
    expect(payloadIssues(e, companies).join(" ")).toMatch(/not an account this grouping uses/);
  });

  it("refuses a company whose framework has no template", () => {
    const fw = companies.map((c) => (c.slug === "alpha-ltd" ? { ...c, reporting_framework: "FRS 105" } : c));
    expect(payloadIssues(body(), fw).join(" ")).toMatch(/Alpha Ltd: FRS 105/);
  });

  it("needs every account in Xero's chart, and active", () => {
    expect(resolveAccounts(body(), chart).issues).toEqual([]);
    expect(resolveAccounts(body(), { "alpha-ltd": [] }).issues[0]).toMatch(/780 is not in Xero's chart/);
    expect(resolveAccounts(body(), { "alpha-ltd": [{ Code: "780", AccountID: "x", Status: "ARCHIVED" }] }).issues[0]).toMatch(/ARCHIVED/);
  });
});

describe("the opening tie", () => {
  const run = (b, ledger, named = []) => {
    const r = resolveAccounts(b, chart);
    const p = plan(b, { idOf: r.idOf, ids });
    return { p, t: openingTie(p, { trialBalances: { e1: tb(ledger) }, namedItems: named, idOf: r.idOf, ids }) };
  };

  it("ties when the register equals the ledger, and slices sum to their invoice", () => {
    const { p, t } = run(body(), 60);
    expect(p.lines.map((l) => l.state)).toEqual(["approved", "approved"]);
    expect(t.ties).toBe(true);
    expect(t.rows[0]).toMatchObject({ register: 60, ledger: 60 });
  });

  it("refuses a difference unless a named item explains it, and never nets it away", () => {
    expect(run(body(), 61.37).t.ties).toBe(false);
    const b = body();
    b.named_items = [{ entity: "alpha-ltd", account: "780", amount: 1.37, label: "Residual carried" }];
    const { t } = run(b, 61.37, b.named_items);
    expect(t.ties).toBe(true);
    expect(t.rows[0]).toMatchObject({ difference: 1.37, unexplained: 0 });
  });

  it("refuses an unbalanced trial balance unless that company's exact difference is acknowledged", () => {
    const b = body();
    const r = resolveAccounts(b, chart);
    const p = plan(b, { idOf: r.idOf, ids });
    const off = { Rows: [...tb(60).Rows, { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "0" }, { Value: "0" }, { Value: "60" }, { Value: "60.01" }] }] };
    off.Rows[0].Rows[1].Cells[4].Value = "60.01";
    expect(openingTie(p, { trialBalances: { e1: off }, idOf: r.idOf, ids }).ties).toBe(false);
    const acks = [{ entity: "alpha-ltd", difference: -0.01, reason: "Xero's foreign-currency rounding" }];
    const t = openingTie(p, { trialBalances: { e1: off }, idOf: r.idOf, ids, tbAcknowledgements: acks });
    expect(t.ties).toBe(true);
    expect(t.footing.e1.acknowledged).toEqual({ difference: -0.01, reason: "Xero's foreign-currency rounding" });
    expect(payloadIssues({ ...b, tb_acknowledgements: [{ entity: "alpha-ltd", difference: -0.01, reason: "" }] }, companies).join(" ")).toMatch(/needs a company, a difference/);
  });

  it("refuses slices that do not make their invoice", () => {
    const b = body();
    b.cost_lines[1].amount = 30;
    const { t } = run(b, 60);
    expect(t.ties).toBe(false);
    expect(t.issues.join(" ")).toMatch(/slices sum to 90.00 against 100.00/);
  });

  it("keeps evidence lines out of the balance and brings opening amortisation and write-offs in", () => {
    const b = body();
    b.assets[0].accum_account = "780";
    b.assets[0].opening_accumulated = 10;
    b.cost_lines.push({ line_date: "2025-01-01", billed_entity: "alpha-ltd", owning_entity: "alpha-ltd", source_net: 500, amount: 500, asset_no: "IA-001",
      treatment: "capitalise", reason_text: "Old invoice", state: "superseded", superseded_by_asset_no: "IA-001", fields: {}, source_ref: ref });
    const { p, t } = run(b, 50);
    expect(p.lines.find((l) => l.state === "superseded").superseded_by_asset_key).toBe("alpha-ltd|IA-001");
    expect(p.events).toEqual([expect.objectContaining({ kind: "opening", amount: 10, period: "2026-08" })]);
    expect(t.ties).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

const { readMasterTable, planMaster, changesToApply } = require("./master-mapping");
const { effectiveCategories } = require("./coa-mapping");
const { templateRows } = require("./pack-templates");

const STD = [
  ["turnover", "pnl", "turnover", 10], ["cost_of_sales", "pnl", "cost_of_sales", 20], ["staff_costs", "pnl", "overheads", 30],
  ["professional_fees", "pnl", "overheads", 50], ["administrative", "pnl", "overheads", 60], ["depreciation", "pnl", "overheads", 70, "non_cash"],
  ["fx", "pnl", "overheads", 80], ["other_income", "pnl", "finance", 90], ["interest_payable", "pnl", "finance", 100], ["taxation", "pnl", "taxation", 110],
  ["intangible_assets", "bs", "fixed_assets", 200, "capex"], ["tangible_assets", "bs", "fixed_assets", 210, "capex"],
  ["debtors", "bs", "current_assets", 310, "working_capital"], ["cash", "bs", "current_assets", 320, "cash"],
  ["creditors_lt1y", "bs", "creditors_lt1y", 400, "working_capital"], ["creditors_gt1y", "bs", "creditors_gt1y", 410, "loans"],
  ["provisions", "bs", "provisions", 420, "provisions"], ["retained_earnings", "bs", "equity", 510, "retained_earnings"],
].map(([key, statement, section, sort_order, cash_flow = null]) => ({ client_id: null, key, label: key, statement, section, sort_order, cash_flow, active: true }));
const categories = effectiveCategories([...STD, ...templateRows("feldspar_management")]);

const HEAD = ["Lookup", "*Code", "*Name", "*Type", "*Tax Code", "P&L Mapping 1", "P&L Mapping 2", "BS Mapping"];
const table = (...rows) => [["Group master mapping"], [], HEAD, ...rows.map(([code, name, type, p1 = "", p2 = "", bs = ""]) => [`${code} - ${name}`, code, name, type, "", p1, p2, bs])];
const acct = (id, Code, Name, Class, Status = "ACTIVE") => ({ AccountID: id, Code, Name, Class, Status });
const saved = (category_key, status = "approved", subline = null) => ({ category_key, status, subline });

describe("reading a master file", () => {
  it("finds the header row below a title and reads the columns by name", () => {
    const { rows, errors } = readMasterTable(table(["422", "Website costs", "Overhead", "IT Costs", "Website"]));
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "422", name: "Website costs", type: "Overhead", pnl1: "IT Costs", pnl2: "Website", bs: "", row: 4 }]);
  });

  it("refuses a file without the mapping columns", () => {
    expect(readMasterTable([["a", "b"], ["1", "2"]]).errors[0]).toMatch(/No header row/);
    expect(readMasterTable([]).errors[0]).toMatch(/no rows/);
  });
});

describe("planning a master file", () => {
  const rows = readMasterTable(table(
    ["422", "Website costs", "Overhead", "IT Costs", "Website"],
    ["400", "Advertising & Marketing", "Overhead", "Marketing", "Advertising"],
    ["415", "Impairment", "", "Impairment"],
    ["860", "Rounding", "Rounding", "Rounding", "", "Retained Earnings"],
    ["900", "Loan notes", "Current Liability", "", "", "Loan Notes"],
    ["620", "IC debtor", "Current Asset", "", "", "Inter Company Creditor"],
    ["999", "Lost account", "Overhead", "Marketing"],
    ["500", "Exceptional", "Overhead", "Exceptional items"],
    ["510", "No heading", "Overhead"],
    ["777", "Old name", "Fixed Asset", "", "", "Patents and Trademarks"],
  )).rows;
  const accounts = [
    acct("a422", "422", "Website costs", "EXPENSE"),
    acct("a400", "400", "Advertising & Marketing", "EXPENSE"),
    acct("a415", "415", "Impairment", "EXPENSE"),
    acct("a860", "860", "Rounding", "LIABILITY"),
    acct("a900", "900", "Loan notes", "LIABILITY"),
    acct("a620", "620", "IC debtor", "ASSET"),
    acct("a500", "500", "Exceptional", "EXPENSE"),
    acct("a510", "510", "No heading", "EXPENSE"),
    acct("a777", "777", "New name", "ASSET"),
    acct("a123", "123", "Not in the file", "EXPENSE"),
    acct("a124", "124", "Archived, not in the file", "EXPENSE", "ARCHIVED"),
  ];
  const stored = new Map([
    ["a422", saved("it_costs", "approved", "Website")],         // already right
    ["a400", saved("administrative")],                           // moves
    ["a415", saved("depreciation")],                             // moves to impairment
    ["a900", saved("creditors_lt1y")],                           // allowed by Loan Notes: kept
  ]);
  const plan = planMaster({ rows, template: "feldspar_management", categories, entities: [{ slug: "alpha", name: "Alpha", accounts, stored }], approve: true });
  const e = plan.entities[0];
  const change = (id) => e.changes.find((c) => c.accountId === id);

  it("leaves a right mapping alone", () => {
    expect(change("a422")).toBeUndefined();
    expect(e.unchanged).toBeGreaterThanOrEqual(2);
  });

  it("moves an account to the template line its heading names, with its sub-line", () => {
    expect(change("a400")).toMatchObject({ kind: "category", from: { category: "administrative" }, to: { category: "marketing", subline: "Advertising" } });
    expect(change("a415")).toMatchObject({ to: { category: "impairment", subline: null } });
  });

  it("keeps an account on a line the heading allows, and picks a line that fits the account's class", () => {
    expect(change("a900")).toBeUndefined();
    expect(change("a620")).toMatchObject({ kind: "new", to: { category: "debtors" } });
    expect(change("a860")).toMatchObject({ statement: "bs", to: { category: "retained_earnings" } });
  });

  it("reports what it cannot decide, never guessing", () => {
    expect(e.unknownHeading.map((x) => x.accountId)).toEqual(["a500"]);
    expect(e.noHeading.map((x) => x.accountId)).toEqual(["a510"]);
    expect(e.nameDiffers).toEqual([{ accountId: "a777", code: "777", xeroName: "New name", masterName: "Old name" }]);
    expect(e.notInMaster.map((x) => x.accountId)).toEqual(["a123"]);
    expect(plan.unmatched.map((x) => x.code)).toEqual(["999"]);
  });

  it("applies what was not unticked", () => {
    const out = changesToApply(e, ["alpha:a400"], true);
    expect(out.find((c) => c.accountId === "a400")).toBeUndefined();
    expect(out.find((c) => c.accountId === "a415")).toEqual({ accountId: "a415", category: "impairment", subline: null, approve: true });
  });

  it("asks to approve a saved, unapproved mapping only when approving", () => {
    const st = new Map([["a422", saved("it_costs", "proposed", "Website")]]);
    const ents = [{ slug: "alpha", name: "Alpha", accounts: [accounts[0]], stored: st }];
    expect(planMaster({ rows, template: "feldspar_management", categories, entities: ents, approve: true }).entities[0].changes[0].kind).toBe("approve");
    expect(planMaster({ rows, template: "feldspar_management", categories, entities: ents, approve: false }).entities[0].changes).toEqual([]);
  });

  it("refuses rows that disagree with themselves", () => {
    const dup = readMasterTable(table(["400", "Advertising & Marketing", "Overhead", "Marketing"], ["400", "Advertising & Marketing", "Overhead", "IT Costs"])).rows;
    const p = planMaster({ rows: dup, template: "feldspar_management", categories, entities: [{ slug: "alpha", name: "Alpha", accounts: [accounts[1]], stored: new Map() }] });
    expect(p.duplicates).toHaveLength(1);
    expect(p.entities[0].changes).toEqual([]);
  });
});

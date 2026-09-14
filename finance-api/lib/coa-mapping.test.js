import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountRows,
  effectiveCategories,
  planMappingChanges,
  proposeCategory,
  validateCategory,
} from "./coa-mapping.js";

const here = dirname(fileURLToPath(import.meta.url));
const shared = JSON.parse(
  readFileSync(join(here, "..", "..", "pack-engine", "tests", "mapping_rule_cases.json"), "utf8")
);

const STANDARD = [
  ["turnover", "pnl", "turnover", 10, null],
  ["staff_costs", "pnl", "overheads", 30, null],
  ["administrative", "pnl", "overheads", 60, null],
  ["depreciation", "pnl", "overheads", 70, "non_cash"],
  ["intangible_assets", "bs", "fixed_assets", 200, "capex"],
  ["debtors", "bs", "current_assets", 310, "working_capital"],
  ["cash", "bs", "current_assets", 320, "cash"],
  ["creditors_lt1y", "bs", "creditors_lt1y", 400, "working_capital"],
  ["retained_earnings", "bs", "equity", 510, "retained_earnings"],
].map(([key, statement, section, sort_order, cash_flow]) => ({
  client_id: null, key, label: key.replace(/_/g, " "), statement, section, sort_order, cash_flow, active: true,
}));

const acct = (id, Code, Name, Class, Type, ReportingCode = "") => ({ AccountID: id, Code, Name, Class, Type, ReportingCode, Status: "ACTIVE" });
const ACCOUNTS = [
  acct("a-rev", "200", "Sales", "REVENUE", "REVENUE", "REV"),
  acct("a-wage", "477", "Wages", "EXPENSE", "OVERHEADS", "EXP"),
  acct("a-bank", "090", "Bank", "ASSET", "BANK", "ASS"),
  acct("a-dev", "720", "Development costs", "ASSET", "FIXED", "ASS.NCA.INT"),
  acct("a-loan", "835", "Directors loan", "LIABILITY", "CURRLIAB", "LIA.CUR"),
];

describe("proposeCategory", () => {
  it.each(shared.cases)("$note", ({ account, expected }) => {
    expect(proposeCategory({ AccountID: "x", ...account }).category).toBe(expected);
  });

  it("drops a proposal the client has switched off", () => {
    const cats = effectiveCategories([
      ...STANDARD,
      { ...STANDARD.find((c) => c.key === "intangible_assets"), client_id: "c1", active: false },
    ]);
    const p = proposeCategory(ACCOUNTS[3], cats);
    expect(p.category).toBeNull();
    expect(p.reason).toMatch(/switched off/);
  });
});

describe("effectiveCategories", () => {
  it("lets a client rename a standard line and add its own, in sort order", () => {
    const cats = effectiveCategories([
      ...STANDARD,
      { ...STANDARD[1], client_id: "c1", label: "People costs" },
      { client_id: "c1", key: "dev_amortisation", label: "Amortisation of development costs", statement: "pnl", section: "overheads", sort_order: 75, cash_flow: "non_cash", active: true },
    ]);
    expect(cats.get("staff_costs")).toMatchObject({ label: "People costs", scope: "override" });
    expect(cats.get("dev_amortisation").scope).toBe("client");
    expect([...cats.keys()].indexOf("dev_amortisation")).toBe([...cats.keys()].indexOf("depreciation") + 1);
  });
});

describe("validateCategory", () => {
  const cats = effectiveCategories(STANDARD);

  it("accepts a new overheads line with no cash flow", () => {
    const { errors } = validateCategory("research", { label: "Research", statement: "pnl", section: "overheads", sortOrder: 65 });
    expect(errors).toEqual([]);
  });

  it("refuses a section from the other statement and a missing balance sheet cash flow", () => {
    const { errors } = validateCategory("odd", { label: "Odd", statement: "bs", section: "overheads", sortOrder: 1 });
    expect(errors.join(" ")).toMatch(/section must be one of/);
    expect(errors.join(" ")).toMatch(/needs a cash flow class/);
  });

  it("keeps cash and retained earnings to their standard categories", () => {
    expect(validateCategory("petty_cash", { label: "Petty cash", statement: "bs", section: "current_assets", sortOrder: 330, cashFlow: "cash" }).errors.join(" "))
      .toMatch(/only the cash category/);
    expect(validateCategory("cash", { active: false }, { current: cats.get("cash"), standard: cats.get("cash") }).errors.join(" "))
      .toMatch(/cannot be switched off/);
  });

  it("will not switch off a category accounts are mapped to", () => {
    const { errors } = validateCategory("staff_costs", { active: false }, { current: cats.get("staff_costs"), standard: cats.get("staff_costs"), inUse: 3 });
    expect(errors.join(" ")).toMatch(/remap them/);
  });
});

describe("planMappingChanges", () => {
  const cats = effectiveCategories(STANDARD);
  const none = new Map();

  it("approves the rule proposal when no category is given", () => {
    const { errors, writes } = planMappingChanges({ changes: [{ accountId: "a-wage", approve: true }], accounts: ACCOUNTS, categories: cats, stored: none });
    expect(errors).toEqual([]);
    expect(writes[0]).toMatchObject({ category: "staff_costs", status: "approved", source: "rule" });
    expect(writes[0].reason).toMatch(/payroll range/);
  });

  it("saves a manual choice as proposed unless approved", () => {
    const { writes } = planMappingChanges({ changes: [{ accountId: "a-dev", category: "intangible_assets" }], accounts: ACCOUNTS, categories: cats, stored: none });
    expect(writes[0]).toMatchObject({ status: "proposed", source: "manual", reason: "set in the portal" });
  });

  it("keeps the saved category, source and reason when approving what is saved", () => {
    const stored = new Map([["a-dev", { category_key: "intangible_assets", status: "proposed", source: "upload", reason: "uploaded from map.csv", cash_flow: null }]]);
    const { writes } = planMappingChanges({ changes: [{ accountId: "a-dev", approve: true }], accounts: ACCOUNTS, categories: cats, stored });
    expect(writes[0]).toMatchObject({ category: "intangible_assets", status: "approved", source: "upload", reason: "uploaded from map.csv" });
    expect(writes[0].before).toEqual({ category: "intangible_assets", status: "proposed", cashFlow: null });
  });

  it("refuses the whole request when any change is wrong", () => {
    const { errors, writes } = planMappingChanges({
      changes: [
        { accountId: "a-rev", category: "turnover", approve: true },
        { accountId: "a-bank", category: "staff_costs" },
        { accountId: "nope", category: "turnover" },
        { accountId: "a-rev", category: "turnover" },
      ],
      accounts: ACCOUNTS, categories: cats, stored: none, source: "upload",
    });
    expect(errors).toHaveLength(3);
    expect(errors.join("\n")).toMatch(/profit and loss category but this is a ASSET account/);
    expect(errors.join("\n")).toMatch(/not in this entity's Xero chart/);
    expect(errors.join("\n")).toMatch(/more than once/);
    expect(writes).toHaveLength(1);    // the caller writes nothing when errors is not empty
  });

  it("takes a cash flow override on a balance sheet account only", () => {
    const ok = planMappingChanges({ changes: [{ accountId: "a-loan", category: "creditors_lt1y", cashFlow: "loans" }], accounts: ACCOUNTS, categories: cats, stored: none });
    expect(ok.errors).toEqual([]);
    expect(ok.writes[0].cashFlow).toBe("loans");
    const bad = planMappingChanges({ changes: [{ accountId: "a-rev", category: "turnover", cashFlow: "loans" }], accounts: ACCOUNTS, categories: cats, stored: none });
    expect(bad.errors[0]).toMatch(/only balance sheet accounts/);
    const reserved = planMappingChanges({ changes: [{ accountId: "a-loan", category: "creditors_lt1y", cashFlow: "cash" }], accounts: ACCOUNTS, categories: cats, stored: none });
    expect(reserved.errors[0]).toMatch(/cash flow must be one of/);
  });
});

describe("accountRows", () => {
  it("flags renamed accounts and saved rows whose account left Xero, and proposes for the rest", () => {
    const cats = effectiveCategories(STANDARD);
    const stored = new Map([
      ["a-rev", { xero_account_id: "a-rev", account_code: "200", account_name: "Revenue", category_key: "turnover", status: "approved", source: "manual" }],
      ["gone", { xero_account_id: "gone", account_code: "999", account_name: "Old", category_key: "debtors", status: "approved", source: "manual" }],
    ]);
    const { rows, orphans } = accountRows({ accounts: ACCOUNTS, stored, categories: cats });
    expect(rows.find((r) => r.accountId === "a-rev").flags).toEqual(["renamed_in_xero"]);
    expect(rows.find((r) => r.accountId === "a-bank").proposal.category).toBe("cash");
    expect(orphans.map((o) => o.accountId)).toEqual(["gone"]);
    expect(rows.map((r) => r.code)).toEqual(["090", "200", "477", "720", "835"]);
  });
});

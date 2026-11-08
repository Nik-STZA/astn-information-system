import { describe, expect, it } from "vitest";
import { monthsNotRun, companyRegister } from "./fixed-assets";

describe("monthsNotRun", () => {
  it("lists the ended months after the last run, never the current one", () => {
    expect(monthsNotRun("2026-08-31T00:00:00", "2026-11-06")).toEqual(["Sep 2026", "Oct 2026"]);
    expect(monthsNotRun("2026-10-31T00:00:00", "2026-11-06")).toEqual([]);
    expect(monthsNotRun("2026-11-30", "2026-11-06")).toEqual([]);
  });
  it("crosses a year end", () => {
    expect(monthsNotRun("2025-11-30", "2026-02-01")).toEqual(["Dec 2025", "Jan 2026"]);
  });
  it("is null when depreciation has never run", () => {
    expect(monthsNotRun(null, "2026-11-06")).toBeNull();
  });
});

const T_COMP = "t-comp";
const T_SURF = "t-surf";
const register = {
  types: [
    { assetTypeId: T_COMP, assetTypeName: "Computer equipment", fixedAssetAccountId: "a1", accumulatedDepreciationAccountId: "a2", depreciationExpenseAccountId: "a3" },
    { assetTypeId: T_SURF, assetTypeName: "Performance surface", fixedAssetAccountId: "a4" },
  ],
  accounts: [{ AccountID: "a1", Code: "710", Name: "Computer equipment" }, { AccountID: "a2", Code: "711", Name: "Computer equipment depreciation" }],
  settings: { lastDepreciationDate: "2026-08-31T00:00:00" },
  assets: [
    { assetId: "1", assetNumber: "FA-0044", assetName: "Laptop\nPro", assetTypeId: T_COMP, assetStatus: "Registered", purchaseDate: "2026-08-03T00:00:00", purchasePrice: 2626.01, accountingBookValue: 2556.46, bookDepreciationSetting: { depreciationMethod: "StraightLine", effectiveLifeYears: 3 } },
    { assetId: "2", assetNumber: "FA-0001", assetName: "Old laptop", assetTypeId: T_COMP, assetStatus: "Registered", purchaseDate: "2023-10-26T00:00:00", purchasePrice: 1228.26, accountingBookValue: 96.4 },
    { assetId: "3", assetNumber: "FA-0058", assetName: "HP laptop", assetStatus: "Draft", purchaseDate: "2026-09-29T00:00:00", purchasePrice: 341.1, accountingBookValue: 0 },
    { assetId: "4", assetNumber: "FA-0003", assetName: "Sold", assetTypeId: T_COMP, assetStatus: "Disposed", purchasePrice: 500, accountingBookValue: 0 },
  ],
};

describe("companyRegister", () => {
  const out = companyRegister(register, { today: "2026-11-06", proposals: [{ id: "c1", summary: "Monitor", state: "proposed", proposed_by: "agent:fm1", created_at: "x", input: {} }] });

  it("totals registered assets by type, with the type's accounts", () => {
    expect(out.by_type).toEqual([{
      type: "Computer equipment", cost_account: "710 Computer equipment", accumulated_account: "711 Computer equipment depreciation", expense_account: null,
      count: 2, cost: 3854.27, accumulated: 1201.41, book_value: 2652.86,
    }]);
    expect(out.totals).toEqual({ count: 2, cost: 3854.27, accumulated: 1201.41, book_value: 2652.86 });
  });

  it("keeps drafts and disposals out of the totals", () => {
    expect(out.drafts.map((a) => a.number)).toEqual(["FA-0058"]);
    expect(out.disposed_count).toBe(1);
  });

  it("orders newest first and tidies names", () => {
    expect(out.registered.map((a) => a.number)).toEqual(["FA-0044", "FA-0001"]);
    expect(out.registered[0]).toMatchObject({ name: "Laptop Pro", accumulated: 69.55, method: "StraightLine", life_years: 3 });
  });

  it("says plainly which months depreciation has not been run for", () => {
    expect(out.depreciation).toEqual({ state: "behind", text: expect.stringMatching(/^Last run to 31 Aug 2026\. Not yet run for Sep 2026, Oct 2026\.$/) });
    expect(out.months_not_run).toEqual(["Sep 2026", "Oct 2026"]);
  });

  it("passes the open proposals through, without their input", () => {
    expect(out.proposals).toEqual([{ id: "c1", summary: "Monitor", state: "proposed", proposed_by: "agent:fm1", created_at: "x" }]);
  });

  it("never run, and nothing registered", () => {
    expect(companyRegister({ ...register, settings: {} }, { today: "2026-11-06" }).depreciation.state).toBe("never_run");
    expect(companyRegister({ types: [], assets: [], settings: {} }, { today: "2026-11-06" }).depreciation.state).toBe("nothing_registered");
  });

  it("an asset with no type is still counted", () => {
    const o = companyRegister({ types: [], assets: [register.assets[1]], settings: {} }, { today: "2026-11-06" });
    expect(o.by_type).toHaveLength(1);
    expect(o.by_type[0]).toMatchObject({ type: null, count: 1, cost: 1228.26 });
  });
});

// A trial balance as Xero's report returns it: ytd columns are the balance.
const tbRow = (id, name, dr, cr) => ({ RowType: "Row", Cells: [{ Value: name, Attributes: [{ Id: "account", Value: id }] }, { Value: "0" }, { Value: "0" }, { Value: String(dr) }, { Value: String(cr) }] });
const trialBalance = { Rows: [{ RowType: "Section", Rows: [
  tbRow("a1", "Computer equipment (710)", "4,195.37", 0),
  tbRow("a2", "Computer equipment depreciation (711)", 0, "1201.41"),
  tbRow("a9", "Track (WIP) (780)", "50000", 0),
  tbRow("a8", "Empty (790)", 0, 0),
] }] };
const withTb = {
  ...register,
  accounts: [...register.accounts,
    { AccountID: "a1", Code: "710", Name: "Computer equipment", Type: "FIXED" },
    { AccountID: "a9", Code: "780", Name: "Track (WIP)", Type: "FIXED" },
    { AccountID: "a8", Code: "790", Name: "Empty", Type: "FIXED" },
    { AccountID: "a7", Code: "200", Name: "Sales", Type: "REVENUE" }],
  trialBalance, trialBalanceDate: "2026-11-08",
};

describe("ledger tie", () => {
  const tie = companyRegister(withTb, { today: "2026-11-08" }).tie;

  it("one row per account: cost and accumulated against the ledger", () => {
    const cost = tie.rows.find((r) => r.kind === "cost" && r.account === "710 Computer equipment");
    expect(cost).toMatchObject({ register: 3854.27, ledger: 4195.37, difference: 341.1, ties: false, types: ["Computer equipment"] });
    const acc = tie.rows.find((r) => r.kind === "accumulated");
    expect(acc).toMatchObject({ account: "711 Computer equipment depreciation", register: 1201.41, ledger: 1201.41, difference: 0, ties: true });
    expect(tie.as_at).toBe("2026-11-08");
  });

  it("names a draft whose cost is the difference to the penny", () => {
    const cost = tie.rows.find((r) => r.account === "710 Computer equipment");
    expect(cost.drafts_matching).toEqual([{ number: "FA-0058", name: "HP laptop", cost: 341.1 }]);
  });

  it("an asset type with no registered assets still ties its account", () => {
    const surf = tie.rows.find((r) => r.types.includes("Performance surface"));
    expect(surf).toMatchObject({ kind: "cost", register: 0, ledger: 0, ties: true, account: "Account not in the chart of accounts" });
  });

  it("counts the differences and lists fixed asset accounts outside the register", () => {
    expect(tie.differences).toBe(1);
    expect(tie.outside_register).toEqual([{ account: "780 Track (WIP)", balance: 50000 }]);
  });

  it("no trial balance, no tie", () => {
    expect(companyRegister(register, { today: "2026-11-08" }).tie).toBeUndefined();
  });
});

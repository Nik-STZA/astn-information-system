import { describe, expect, it } from "vitest";
const { mappingAt, registerEvidence, xeroEvidence } = require("./rec-asset-evidence");

const ACC = "aaaaaaaa-1111-2222-3333-444444444444";
const map = [
  { entity_id: "fsl", grouping: "ip_registered", role: "cost", xero_account_id: ACC, account_code: "775", effective_from: "2026-08-31", effective_to: null, ended_at: null },
  { entity_id: "fsl", grouping: "ip_registered", role: "cost", xero_account_id: "old", account_code: "775", effective_from: "2026-01-01", effective_to: "2026-08-30", ended_at: null },
];
const signed = { grouping: "ip_registered", status: "signed", signed_by: "cfo@example.com",
  snapshot: { accounts: [{ entity_id: "fsl", account_id: ACC.toUpperCase(), register: 43549.32, named_items: [{ label: "Rounding", amount: 0.01 }] }] } };

describe("the asset reconciliations' evidence from the os.stza.io register", () => {
  it("finds the mapping in force at the month end", () => {
    expect(mappingAt(map, "fsl", "775", "2026-09-30").xero_account_id).toBe(ACC);
    expect(mappingAt(map, "fsl", "775", "2026-06-30").xero_account_id).toBe("old");
    expect(mappingAt(map, "fgh", "775", "2026-09-30")).toBeNull();
  });

  it("takes the signed month's figure for the company and account, with what it was tied after", () => {
    const out = registerEvidence({ balances: [{ entity_id: "fsl", entity_name: "FSL", account_code: "775" }], map, periods: [signed],
      names: { ip_registered: "IP Patents and Trademarks" }, period: "2026-09", date: "2026-09-30" });
    expect(out.rows).toEqual([expect.objectContaining({ entity_id: "fsl", amount: "43549.32" })]);
    expect(out.rows[0].source).toBe("IP Patents and Trademarks, signed for September 2026 by cfo@example.com: account 775");
    expect(out.rows[0].note).toMatch(/after: 0.01 Rounding/);
    expect(out.xero).toEqual([]);
  });

  it("is not evidence until the month is signed", () => {
    const out = registerEvidence({ balances: [{ entity_id: "fsl", entity_name: "FSL", account_code: "775" }], map,
      periods: [{ ...signed, status: "prepared" }], names: {}, period: "2026-09", date: "2026-09-30" });
    expect(out.rows).toEqual([]);
    expect(out.said[0]).toMatch(/ip_registered is prepared for September 2026, so it is not evidence yet/);
  });

  it("hands an account no register keeps to Xero's register", () => {
    const b = { entity_id: "udl", entity_name: "UDL", account_code: "720" };
    expect(registerEvidence({ balances: [b], map, periods: [signed], period: "2026-09", date: "2026-09-30" }).xero).toEqual([b]);
  });
});

describe("evidence from Xero's own fixed asset register", () => {
  const COST = "c0000000-0000-0000-0000-000000000001", ACCUM = "c0000000-0000-0000-0000-000000000002";
  const types = [{ assetTypeId: "t1", fixedAssetAccountId: COST, accumulatedDepreciationAccountId: ACCUM }];
  const assets = [
    { assetTypeId: "t1", assetStatus: "Registered", purchaseDate: "2026-02-01T00:00:00", purchasePrice: 1000, accountingBookValue: 800 },
    { assetTypeId: "t1", assetStatus: "Registered", purchaseDate: "2026-10-05T00:00:00", purchasePrice: 500, accountingBookValue: 500 },  // bought after September
    { assetTypeId: "t1", assetStatus: "Disposed", purchaseDate: "2025-01-01T00:00:00", purchasePrice: 300, disposalDate: "2026-08-01T00:00:00" },  // gone before
    { assetTypeId: "t1", assetStatus: "Draft", purchaseDate: "2026-01-01T00:00:00", purchasePrice: 99 },
  ];
  const b = (code) => ({ entity_id: "udl", entity_name: "UDL", account_code: code });

  it("proves cost at any month end from what was bought by then and not disposed of", () => {
    const out = xeroEvidence({ balance: b("720"), accountId: COST, types, assets, lastRun: "2026-10-31", date: "2026-09-30", period: "2026-09" });
    expect(out.row).toMatchObject({ amount: "1000.00" });
    expect(out.said).toMatch(/1,000.00 of cost on 720 at 2026-09-30 \(1 asset\)/);
  });

  it("proves accumulated depreciation only when Xero's last run is that month end", () => {
    const late = xeroEvidence({ balance: b("721"), accountId: ACCUM, types, assets, lastRun: "2026-10-31", date: "2026-09-30", period: "2026-09" });
    expect(late.row).toBeNull();
    expect(late.said).toMatch(/depreciated to 2026-10-31, not as at 2026-09-30/);
    const now = xeroEvidence({ balance: b("721"), accountId: ACCUM, types, assets, lastRun: "2026-10-31", date: "2026-10-31", period: "2026-10" });
    expect(now.row).toMatchObject({ amount: "-200.00" });
  });

  it("says when no register keeps the account", () => {
    expect(xeroEvidence({ balance: b("999"), accountId: "nope", types, assets, date: "2026-09-30", period: "2026-09" }).said).toMatch(/no register keeps account 999/);
  });
});

describe("the register behind the figure, asset by asset (migration 060)", () => {
  const COST = "c0000000-0000-0000-0000-000000000001", ACCUM = "c0000000-0000-0000-0000-000000000002";
  const types = [{ assetTypeId: "t1", fixedAssetAccountId: COST, accumulatedDepreciationAccountId: ACCUM }];
  const assets = [
    { assetNumber: "FA-0002", assetName: "Laptop B", assetTypeId: "t1", assetStatus: "Registered", purchaseDate: "2026-03-01T00:00:00", purchasePrice: 600, accountingBookValue: 450 },
    { assetNumber: "FA-0001", assetName: "Laptop A", assetTypeId: "t1", assetStatus: "Registered", purchaseDate: "2026-02-01T00:00:00", purchasePrice: 1000, accountingBookValue: 800 },
  ];
  const b = (code) => ({ entity_id: "udl", entity_name: "UDL", account_code: code });

  it("lists Xero's assets on a cost account, in number order, summing to the figure", () => {
    const d = xeroEvidence({ balance: b("720"), accountId: COST, types, assets, lastRun: "2026-09-30", date: "2026-09-30", period: "2026-09" }).row.detail;
    expect(d).toMatchObject({ register: "Xero fixed asset register", side: "cost", total: "1600.00", unlisted: "0.00" });
    expect(d.assets.map((a) => a.asset_no)).toEqual(["FA-0001", "FA-0002"]);
    expect(d.assets[0]).toMatchObject({ name: "Laptop A", date: "2026-02-01", cost: 1000, accumulated: 200, book_value: 800 });
  });

  it("lists depreciation as a credit summing to the figure", () => {
    const row = xeroEvidence({ balance: b("721"), accountId: ACCUM, types, assets, lastRun: "2026-09-30", date: "2026-09-30", period: "2026-09" }).row;
    expect(row.amount).toBe("-350.00");
    expect(row.detail).toMatchObject({ side: "accumulated", total: "-350.00", unlisted: "0.00" });
  });

  it("leaves depreciation and book value blank on a cost list when Xero has run past the month", () => {
    const d = xeroEvidence({ balance: b("720"), accountId: COST, types, assets, lastRun: "2026-10-31", date: "2026-09-30", period: "2026-09" }).row.detail;
    expect(d.assets[0]).toMatchObject({ cost: 1000, accumulated: null, book_value: null });
  });

  it("lists the os.stza.io register's assets on the account as signed, with what is not on an asset", () => {
    const snap = { ...signed, snapshot: { ...signed.snapshot, assets: [
      { asset_no: "TM-0001", cost: 40000, accumulated: -1000, additions: 500, amortisation: -250, impairment: 0 },
      { asset_no: "TM-0002", cost: 3549.31, accumulated: 0, additions: 0 },
    ] } };
    const regAssets = [
      { id: "1", entity_id: "fsl", asset_no: "TM-0001", name: "Mark one", status: "registered", cost_account_id: ACC, accum_account_id: "x" },
      { id: "2", entity_id: "fsl", asset_no: "TM-0002", name: "Mark two", status: "pending", cost_account_id: ACC.toUpperCase(), accum_account_id: "x" },
      { id: "3", entity_id: "fgh", asset_no: "TM-0003", name: "Elsewhere", status: "registered", cost_account_id: ACC, accum_account_id: "x" },
    ];
    const d = registerEvidence({ balances: [{ entity_id: "fsl", entity_name: "FSL", account_code: "775" }], map, periods: [snap],
      names: { ip_registered: "IP register" }, period: "2026-09", date: "2026-09-30", assets: regAssets }).rows[0].detail;
    expect(d.register).toBe("IP register, signed for September 2026");
    expect(d.assets.map((a) => a.asset_no)).toEqual(["TM-0001", "TM-0002"]);
    expect(d.assets[0]).toMatchObject({ cost: 40000, additions: 500, charge: 250, accumulated: 1000, book_value: 39000 });
    expect(d.assets[1].charge).toBeNull();   // signed before the month's charge was kept per asset
    expect(d.unlisted).toBe("0.01");
  });
});

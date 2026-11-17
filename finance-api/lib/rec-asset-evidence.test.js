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

import { describe, expect, it } from "vitest";
import { assetTotals, decidable, isAssetRegisterPath, monthEndText, monthText, reopenable, signable, tieState, type RegisterPeriod } from "./asset-register";

const p = (period: string, status: RegisterPeriod["status"]): RegisterPeriod =>
  ({ period, status, opening: false, prepared_by: null, prepared_at: null, signed_by: null, signed_at: null });

describe("months", () => {
  it("names the month and its end", () => {
    expect(monthText("2026-10")).toBe("October 2026");
    expect(monthEndText("2026-09")).toBe("30 September 2026");
    expect(monthEndText("2028-02")).toBe("29 February 2028");
  });

  it("signs only the earliest prepared month after the last signed one", () => {
    expect(signable([p("2026-08", "signed"), p("2026-09", "prepared"), p("2026-10", "prepared")])).toBe("2026-09");
    expect(signable([p("2026-08", "signed"), p("2026-09", "open"), p("2026-10", "prepared")])).toBeNull();
    expect(signable([p("2026-08", "signed"), p("2026-09", "signed")])).toBeNull();
  });

  it("reopens only the latest signed month", () => {
    expect(reopenable([p("2026-08", "signed"), p("2026-09", "signed"), p("2026-10", "prepared")])).toBe("2026-09");
    expect(reopenable([p("2026-08", "prepared")])).toBeNull();
  });
});

describe("figures", () => {
  it("totals cost, accumulated and net book value", () => {
    expect(assetTotals([{ asset_no: "A", cost: 1000.1, accumulated: -100.05, additions: 0 }, { asset_no: "B", cost: 500, accumulated: 0, additions: 500 }]))
      .toEqual({ count: 2, cost: 1500.1, accumulated: -100.05, nbv: 1400.05 });
  });

  it("says how many accounts do not tie", () => {
    const a = { company: "Alpha Ltd", account: "777", opening: 0, additions: 0, amortisation: 0, impairment: 0, by_xero: null, register: 1, ledger: 1, difference: 0, named_items: [], unexplained: 0, ties: true };
    expect(tieState([a]).tone).toBe("s-green");
    expect(tieState([a, { ...a, ties: false }, { ...a, ties: false }]).label).toBe("2 accounts do not tie");
  });

  it("offers only live assets for a decision", () => {
    const base = { name: "x", company: "Alpha Ltd", jurisdiction: null, parent_asset_no: null };
    expect(decidable([{ ...base, asset_no: "A", status: "pending" }, { ...base, asset_no: "B", status: "impaired" }, { ...base, asset_no: "C", status: "registered" }])
      .map((a) => a.asset_no)).toEqual(["A", "C"]);
  });
});

describe("the paths the portal may reach", () => {
  it("allows deciding, signing and reopening only", () => {
    expect(isAssetRegisterPath("asset-register/cost-lines/decide")).toBe(true);
    expect(isAssetRegisterPath("asset-register/periods/sign")).toBe(true);
    expect(isAssetRegisterPath("asset-register/periods/reopen")).toBe(true);
    expect(isAssetRegisterPath("asset-register/import")).toBe(false);
    expect(isAssetRegisterPath("asset-register/periods/prepare")).toBe(false);
    expect(isAssetRegisterPath("asset-register/intake")).toBe(false);
    expect(isAssetRegisterPath("asset-register/periods/sign/../import")).toBe(false);
  });
});

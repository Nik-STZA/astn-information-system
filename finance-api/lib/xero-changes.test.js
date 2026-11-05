import { describe, expect, it } from "vitest";
import { KINDS, fixedAssetProposal, nextAssetNumber, outcomeOf, failureText, tierWarning, changeKey } from "./xero-changes";
import { fixedAssetRequest } from "./xero-confirmed";
import { agentXeroChanges, toolsFor } from "./agent-xero-changes";
import { xeroChangeItem } from "./review";

const TYPE = "11111111-2222-3333-4444-555555555555";
const BILL = "99999999-8888-7777-6666-555555555555";
const register = {
  types: [{
    assetTypeId: TYPE, assetTypeName: "Computer equipment",
    bookDepreciationSetting: { depreciationMethod: "StraightLine", averagingMethod: "ActualDays", effectiveLifeYears: 3, depreciationCalculationMethod: "None", bookDepreciationSettingId: "x" },
  }],
  assets: [{ assetNumber: "FA-0009", assetName: "Old laptop", purchaseDate: "2025-04-01T00:00:00", purchasePrice: 900, assetStatus: "Registered" }],
  numbers: ["FA-0008", "FA-0009"],
};
const good = {
  asset_name: "Laptop", asset_type_id: TYPE, purchase_date: "2026-09-12", purchase_price: 1200,
  source_doc: BILL, reason: "Bill from Jo Bloggs Ltd coded to 0710 Computer equipment; above the capitalisation limit.",
};

describe("asset numbers", () => {
  it("carries on the register's own pattern", () => {
    expect(nextAssetNumber(["FA-0008", "FA-0009"])).toBe("FA-0010");
    expect(nextAssetNumber(["COMP-001", "COMP-007", "FA-0001"])).toBe("COMP-008");
    expect(nextAssetNumber([])).toBe("FA-0001");
  });
});

describe("a proposed fixed asset", () => {
  it("becomes exactly the body of the fixed asset write route, as a draft", () => {
    const p = fixedAssetProposal(good, register);
    expect(p.issues).toEqual([]);
    expect(p.input.what).toBe("asset");
    expect(p.input.record).toMatchObject({
      assetName: "Laptop", assetNumber: "FA-0010", assetTypeId: TYPE, purchaseDate: "2026-09-12", purchasePrice: 1200, assetStatus: "Draft",
      bookDepreciationSetting: { depreciationMethod: "StraightLine", effectiveLifeYears: 3 },
      bookDepreciationDetail: { depreciationStartDate: "2026-09-12" },
    });
    expect(p.input.record.bookDepreciationSetting).not.toHaveProperty("bookDepreciationSettingId");
    // The write route itself accepts it.
    expect(fixedAssetRequest(p.input.what, p.input.record, p.input).issues).toEqual([]);
    expect(p.summary).toContain("FA-0010 Laptop");
  });

  it("refuses what Xero or the register would not take", () => {
    expect(fixedAssetProposal({ ...good, purchase_date: "12/09/2026" }, register).issues[0]).toMatch(/purchase_date/);
    expect(fixedAssetProposal({ ...good, purchase_price: 0 }, register).issues[0]).toMatch(/purchase_price/);
    expect(fixedAssetProposal({ ...good, purchase_price: 10.555 }, register).issues[0]).toMatch(/decimal/);
    expect(fixedAssetProposal({ ...good, reason: "" }, register).issues[0]).toMatch(/reason/);
    expect(fixedAssetProposal({ ...good, asset_type_id: "22222222-2222-3333-4444-555555555555" }, register).issues[0]).toMatch(/No asset type/);
    expect(fixedAssetProposal({ ...good, asset_number: "FA-0009" }, register).issues[0]).toMatch(/already used/);
  });

  it("will not register the same purchase twice unless told why", () => {
    const again = { ...good, purchase_date: "2025-04-01", purchase_price: 900 };
    expect(fixedAssetProposal(again, register).issues[0]).toMatch(/already has FA-0009/);
    expect(fixedAssetProposal({ ...again, allow_duplicate: true }, register).issues).toEqual([]);
  });

  it("lets the agent override the type's life, and warns when there is no method", () => {
    expect(fixedAssetProposal({ ...good, effective_life_years: 5 }, register).input.record.bookDepreciationSetting.effectiveLifeYears).toBe(5);
    const bare = { ...register, types: [{ assetTypeId: TYPE, assetTypeName: "Computer equipment", bookDepreciationSetting: {} }] };
    const p = fixedAssetProposal(good, bare);
    expect(p.issues).toEqual([]);
    expect(p.warnings[0]).toMatch(/no depreciation method/);
  });
});

describe("reading the write route's answer", () => {
  it("knows written, refused and unknown apart", () => {
    expect(outcomeOf({ status: 201, body: { action: "WRITTEN" } })).toBe("written");
    expect(outcomeOf({ status: 422, body: { issues: ["The setup tier is switched off for this entity"] } })).toBe("refused");
    expect(outcomeOf({ status: 502, body: { http_status: 400 } })).toBe("refused");
    expect(outcomeOf({ status: 502, body: { http_status: 503 } })).toBe("unknown");
    expect(outcomeOf({ status: 500, body: { error: "fetch failed" } })).toBe("unknown");
    expect(failureText({ status: 422, body: { issues: ["a", "b"] } })).toBe("a b");
  });

  it("keys each attempt by the change and its attempt number", () => {
    expect(changeKey({ id: "abc", attempts: 2 })).toBe("xero-change-abc-2");
  });

  it("says up front when the tier is off", () => {
    expect(tierWarning("create_fixed_asset", { setup: false }, "Acme Ltd")).toMatch(/switched off for Acme Ltd/);
    expect(tierWarning("create_fixed_asset", { setup: true }, "Acme Ltd")).toBeNull();
    expect(KINDS.create_fixed_asset.proposers).toEqual(["fm1", "fc"]);
  });
});

describe("the agent tool", () => {
  it("is offered to FM1 and the FC only", () => {
    expect(toolsFor("fm1", ["udl"]).map((t) => t.name)).toEqual(["propose_fixed_asset", "list_xero_changes"]);
    expect(toolsFor("ap-clerk", ["udl"])).toEqual([]);
  });

  it("proposes as the person who asked, through the run, and never approves", async () => {
    const calls = [];
    const apiRequest = async (method, path, body, headers) => { calls.push({ method, path, body, headers }); return { ok: true, status: 201, body: { id: "c1", summary: "FA-0010 Laptop", warnings: [] } }; };
    const t = agentXeroChanges({ apiRequest, requesterOf: async () => "jo@example.com" });
    const job = { id: "run-1", agent: "fm1", client: { slug: "acme" } };
    const r = await t.call(job, "propose_fixed_asset", { entity: "udl", ...good });
    expect(r.saved).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/finance/clients/acme/xero-changes", headers: { "X-Actor-Email": "jo@example.com", "X-Work-Via": "agent:fm1:run-1" } });
    expect(calls[0].body.kind).toBe("create_fixed_asset");
    expect(calls.some((c) => /approve/.test(c.path))).toBe(false);
    expect(await t.call({ ...job, agent: "ap-clerk" }, "propose_fixed_asset", { entity: "udl", ...good })).toHaveProperty("error");
  });
});

describe("in the Review inbox", () => {
  const row = { id: "c1", kind: "create_fixed_asset", state: "proposed", summary: "FA-0010 Laptop", source: "agent", proposed_by: "agent:fm1", entity_name: "Acme Ltd", amount: "1200", created_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" };

  it("waits on the CFO and links to its screen", () => {
    expect(xeroChangeItem(row, { slug: "acme" })).toMatchObject({ kind: "xero_change", waiting_on: "CFO", produced_by: "FM1", href: "/finance/clients/acme/xero-changes?item=c1" });
  });

  it("leaves out one being made now, and keeps one that did not finish", () => {
    const now = Date.parse("2026-11-05T10:01:00Z");
    expect(xeroChangeItem({ ...row, state: "approved", attempt_outcome: null }, { slug: "acme", now })).toBeNull();
    expect(xeroChangeItem({ ...row, state: "approved", attempt_outcome: "unknown" }, { slug: "acme", now }).status).toMatch(/Check Xero/);
    expect(xeroChangeItem({ ...row, state: "written" }, { slug: "acme" })).toBeNull();
  });
});

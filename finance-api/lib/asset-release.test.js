import { describe, expect, it } from "vitest";
const { nextVersion, plan, monthCharges, transferLines, chargeLines } = require("./asset-release");

const wip = "acc-wip", cost = "acc-cost", accum = "acc-accum";
const assets = [
  { id: "p", entity_id: "e", asset_no: "IA-005", name: "Platform project", status: "wip", cost_account_id: wip },
  { id: "l1", entity_id: "e", asset_no: "SW-003", name: "L1 Venue Gateway V1", status: "wip", cost_account_id: wip, fields: { layer: "L1", version: "V1" } },
  { id: "l5", entity_id: "e", asset_no: "SW-007", name: "L5 Skills Library V1", status: "wip", cost_account_id: wip, fields: { layer: "L5", version: "V1" } },
];
const cost31Oct = new Map([["p", 153000], ["l1", 10890.9], ["l5", 0]]);

describe("releasing a version to use", () => {
  it("names the next version", () => {
    expect(nextVersion(assets[1])).toEqual({ asset_no: "SW-003-V2", name: "L1 Venue Gateway V2", version: "V2" });
    expect(nextVersion({ asset_no: "SW-003-V2", name: "L1 Venue Gateway V2", fields: { version: "V2" } }).asset_no).toBe("SW-003-V3");
    expect(nextVersion(assets[0])).toEqual({ asset_no: "IA-005-V2", name: "Platform project V2", version: "V2" });
  });

  it("moves each asset's cost out of WIP, makes it available and opens its next version", () => {
    const p = plan({ assets, cost: cost31Oct, date: "2026-11-01", accounts: { cost, accumulated: accum }, policyId: "pol", reason: "Released", evidence: "CFO 20 Nov 2026" });
    expect(p.issues).toEqual([]);
    expect(p.events.map((e) => [e.asset_no, e.amount, e.period, e.accounts.from, e.accounts.to])).toEqual([
      ["IA-005", 153000, "2026-11", wip, cost], ["SW-003", 10890.9, "2026-11", wip, cost], ["SW-007", 0, "2026-11", wip, cost]]);
    expect(p.updates.every((u) => u.status === "available" && u.available_for_use_date === "2026-11-01" && u.cost_account_id === cost)).toBe(true);
    expect(p.next.map((n) => [n.asset_no, n.cost_account_id, n.fields.version, n.fields.layer ?? null])).toEqual([
      ["IA-005-V2", wip, "V2", null], ["SW-003-V2", wip, "V2", "L1"], ["SW-007-V2", wip, "V2", "L5"]]);
  });

  it("refuses without evidence, or an asset not in progress, or a next version already held", () => {
    const p = plan({ assets: [{ ...assets[1], status: "available" }, assets[0]], cost: cost31Oct, date: "2026-11-01", accounts: { cost, accumulated: accum },
      evidence: "", held: new Set(["IA-005-V2"]) });
    expect(p.issues).toEqual(expect.arrayContaining([expect.stringMatching(/evidences the release/), "SW-003 is available, not in progress", "IA-005-V2 is already in the register"]));
  });

  it("charges straight line from the release month, and the last month takes the pence", () => {
    const policies = { pol: { life_months: 36, life_kind: "finite", residual_value: 0, start_convention: "same_month" } };
    const live = assets.map((a) => ({ ...a, status: "available", policy_id: "pol", available_for_use_date: "2026-11-01", accum_account_id: accum }));
    const before = new Map([["p", { cost: 153000, accumulated: 0 }], ["l1", { cost: 10890.9, accumulated: 0 }], ["l5", { cost: 0, accumulated: 0 }]]);
    const nov = monthCharges({ assets: live, policies, before, period: "2026-11" });
    expect(nov.map((c) => [c.asset_no, c.amount])).toEqual([["IA-005", 4250], ["SW-003", 302.52]]);
    const last = monthCharges({ assets: live, policies, period: "2029-10", before: new Map([["l1", { cost: 10890.9, accumulated: -10588.37 }]]) });
    expect(last.map((c) => [c.asset_no, c.amount])).toEqual([["SW-003", 302.53]]);
    expect(monthCharges({ assets: live, policies, before, period: "2026-10" })).toEqual([]);
    expect(monthCharges({ assets: live, policies, before, period: "2026-11", done: new Set(["p", "l1"]) })).toEqual([]);
    expect(chargeLines(nov, { charge: "417", accumulated: "788" })).toEqual([
      { account_code: "417", amount: 4552.52, description: "Amortisation: IA-005 4250.00, SW-003 302.52" },
      { account_code: "788", amount: -4552.52, description: "Accumulated amortisation" }]);
  });

  it("gives the release journal by account code", () => {
    const p = plan({ assets, cost: cost31Oct, date: "2026-11-01", accounts: { cost, accumulated: accum }, policyId: "pol", reason: "Released", evidence: "CFO" });
    expect(transferLines(p.events, { cost: "787", wip: "789" })).toEqual([
      { account_code: "787", amount: 163890.9, description: "Released to use: IA-005, SW-003" },
      { account_code: "789", amount: -163890.9, description: "Out of work in progress" }]);
  });
});

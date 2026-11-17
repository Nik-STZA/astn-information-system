import { describe, expect, it } from "vitest";
import { accountSubject, fig, lineWhat, monthEndName, monthName, passes, roll, addRolls, chargedInXero, xeroRoll, type ScheduleAsset, type ThreadEntry } from "./asset-schedule";

const asset = (over: Partial<ScheduleAsset>): ScheduleAsset => ({
  id: "a", asset_no: "A-1", name: "A", status: "wip", company: "Alpha", jurisdiction: null, parent_asset_no: null, account: "780", accumulated_account: null,
  cost_bf: 0, additions: 0, transfers: 0, cost_cf: 0, accumulated_bf: 0, charge: 0, impairment: 0, other: 0, accumulated_cf: 0, nbv_bf: 0, nbv_cf: 0, ...over,
});

describe("figures", () => {
  it("writes negatives in brackets and nil as a dash", () => {
    expect(fig(1234.5)).toBe("1,234.50");
    expect(fig(-45.48)).toBe("(45.48)");
    expect(fig(0.004)).toBe("-");
    expect(fig(null)).toBe("");
  });
  it("names months and month ends", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(monthEndName("2026-09")).toBe("30 September 2026");
  });
});

describe("the roll-forward", () => {
  it("casts: cost and accumulated, brought forward to carried forward, with impairment in the charge column", () => {
    const r = roll([
      asset({ cost_bf: 1000, additions: 250, accumulated_bf: -130, charge: -10 }),
      asset({ id: "b", cost_bf: 400, impairment: -400, transfers: 0 }),
    ]);
    expect(r).toEqual({ cost_bf: 1400, additions: 250, cost_cf: 1650, accumulated_bf: -130, charge: -410, accumulated_cf: -540, nbv_bf: 1270, nbv_cf: 1110 });
  });
});

describe("lines", () => {
  it("says what a line is for: Xero's description, else the workbook phase, else the reason", () => {
    expect(lineWhat({ description: "USP - Firmware", reason: "x" })).toBe("USP - Firmware");
    expect(lineWhat({ description: null, reason: "Workbook treatment: Capitalise; phase: Concept Development" })).toBe("Concept Development");
    expect(lineWhat({ description: null, reason: "Pending cost of the CA mark" })).toBe("Pending cost of the CA mark");
    expect(lineWhat({ description: null, reason: null })).toBe("-");
  });
  it("keys an account's thread by company and code", () => {
    expect(accountSubject({ entity_id: "e1", code: "776" })).toBe("e1:776");
    expect(accountSubject({ entity_id: null, code: "776" })).toBeNull();
  });
});

describe("the Activity filters", () => {
  const e = (over: Partial<ThreadEntry>): ThreadEntry => ({ id: "x", subject_kind: "asset", subject_key: "k", period: null, kind: "note", body: "b",
    needs_decision: false, open: false, created_at: "", by: { initials: "JB", name: "Jo Bloggs", on_behalf_of: null, role: null }, via_agent: null, ...over });
  it("filters by what needs you, decisions, questions, holds and agents", () => {
    const q = e({ kind: "question", needs_decision: true, open: true, via_agent: "fm1" });
    const done = e({ kind: "hold", needs_decision: true, open: false });
    const d = e({ kind: "decision" });
    expect(passes(q, "open")).toBe(true);
    expect(passes(done, "open")).toBe(false);
    expect(passes(done, "decisions")).toBe(true);
    expect(passes(d, "decisions")).toBe(true);
    expect(passes(q, "questions")).toBe(true);
    expect(passes(done, "holds")).toBe(true);
    expect(passes(q, "agents")).toBe(true);
    expect(passes(d, "agents")).toBe(false);
  });
});

describe("Xero's own amortisation in the roll-forward", () => {
  const fsl = { xero_charge_bf: -8577.43 + -366.25, xero_charge_in_month: -366.25 };
  const fgh = { xero_charge_bf: -45.47, xero_charge_in_month: -45.48 };
  it("adds the accounts Xero keeps as accumulated figures, with no cost", () => {
    const x = xeroRoll([fsl, fgh]);
    expect(x.cost_bf).toBe(0);
    expect(x.accumulated_bf).toBe(-8989.15);
    expect(x.charge).toBe(-411.73);
    expect(x.accumulated_cf).toBe(-9400.88);
    expect(x.nbv_cf).toBe(-9400.88);
  });
  it("so the total ties: the assets' roll plus Xero's", () => {
    const t = addRolls(roll([asset({ cost_bf: 102683.74, additions: 670, accumulated_bf: -8577.43 })]), xeroRoll([fgh]));
    expect(t.cost_cf).toBe(103353.74);
    expect(t.accumulated_cf).toBe(-8668.38);
    expect(t.nbv_cf).toBe(94685.36);
  });
  it("knows which accounts Xero charges", () => {
    expect(chargedInXero({ xero_charge_in_month: 0 })).toBe(true);
    expect(chargedInXero({ xero_charge_in_month: null })).toBe(false);
  });
});

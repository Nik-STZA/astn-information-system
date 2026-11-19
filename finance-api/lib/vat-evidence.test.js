import { describe, expect, it } from "vitest";
const { vatEvidence } = require("./vat-evidence");

// A group of three (made-up figures in the shape of October 2026): the
// representative and two members.
const balances = [{ entity_id: "rep", entity_name: "REP" }, { entity_id: "a", entity_name: "ALP" }, { entity_id: "b", entity_name: "BET" }];
const sep = { id: "s", kind: "group", representative_id: "rep", period_start: "2026-09-01", period_end: "2026-09-30",
  submitted_on: "2026-10-26", submitted_boxes: { 3: 135.28, 4: 8113.94 }, paid_on: null, clearing: ["posted", "posted", "posted"],
  own: { rep: { 3: 135.28, 4: 4210.07 }, a: { 3: 0, 4: 3057.75 }, b: { 3: 0, 4: 846.12 } } };
const oct = { id: "o", kind: "group", representative_id: "rep", period_start: "2026-10-01", period_end: "2026-10-31",
  submitted_on: null, submitted_boxes: null, paid_on: null, clearing: [],
  own: { rep: { 3: 1920.64, 4: 81612.18 }, a: { 3: 9.6, 4: 47.4 }, b: { 3: 2773.05, 4: 5608.04 } } };

describe("VAT control evidence from the returns in os.stza.io", () => {
  it("takes each company's own position on the return not yet filed at the month end", () => {
    const { rows } = vatEvidence({ balances, returns: [oct], date: "2026-10-31" });
    expect(rows.map((r) => [r.entity_id, r.amount])).toEqual([["rep", "79691.54"], ["a", "37.80"], ["b", "2834.99"]]);
    expect(rows[1].source).toBe("October 2026 VAT return, ALP's own box 5 (to reclaim), not yet filed at 31 October 2026");
  });

  it("holds a filed, unpaid group return on the representative only", () => {
    const { rows } = vatEvidence({ balances, returns: [sep, oct], date: "2026-10-31" });
    const rep = rows.filter((r) => r.entity_id === "rep");
    expect(rep.map((r) => r.amount)).toEqual(["7978.66", "79691.54"]);
    expect(rep[0].source).toMatch(/^September 2026 VAT return as filed on 26 October 2026: refund claimed, not yet paid by HMRC at 31 October 2026$/);
    expect(rows.filter((r) => r.entity_id === "a").map((r) => r.amount)).toEqual(["37.80"]);
  });

  it("drops a return once HMRC has paid it by the month end", () => {
    const { rows } = vatEvidence({ balances, returns: [{ ...sep, paid_on: "2026-10-30" }, oct], date: "2026-10-31" });
    expect(rows.filter((r) => r.entity_id === "rep").map((r) => r.amount)).toEqual(["79691.54"]);
    const later = vatEvidence({ balances, returns: [{ ...sep, paid_on: "2026-11-04" }, oct], date: "2026-10-31" }).rows;
    expect(later.filter((r) => r.entity_id === "rep")[0].source).toMatch(/paid 4 November 2026, after 31 October 2026/);
  });

  it("says when a member still holds a filed return because its clearing is not in Xero", () => {
    const { said } = vatEvidence({ balances, returns: [{ ...sep, clearing: ["proposed", "proposed", "proposed"] }, oct], date: "2026-10-31" });
    expect(said).toContain("ALP: the September 2026 return was filed on 26 October 2026 but its clearing journals are not yet in Xero, so ALP still holds its share in the ledger.");
  });

  it("holds a return filed before os.stza.io on the representative, with no clearing to wait for", () => {
    const q4 = { id: "q", kind: "group", representative_id: "rep", period_start: "2025-10-01", period_end: "2025-12-31", history: true,
      submitted_on: "2026-02-03", submitted_boxes: { 3: 3762.98, 4: 90600.14 }, paid_on: null, clearing: [], own: {} };
    const { rows, said } = vatEvidence({ balances, returns: [q4, oct], date: "2026-10-31" });
    const rep = rows.filter((r) => r.entity_id === "rep");
    expect(rep[0]).toMatchObject({ amount: "86837.16" });
    expect(rep[0].source).toBe("October 2025 to December 2025 VAT return as filed on 3 February 2026 (HMRC's record): refund claimed, not yet paid by HMRC at 31 October 2026");
    expect(said.some((x) => /clearing journals/.test(x))).toBe(false);
    const before = vatEvidence({ balances, returns: [q4], date: "2025-12-31" }).said;
    expect(before).toContain("ALP: the October 2025 to December 2025 return was filed before os.stza.io, on 3 February 2026; its own position before then is not held here. Record it as outside evidence.");
  });

  it("treats a return filed after the month end as not yet filed then", () => {
    const { rows } = vatEvidence({ balances, returns: [sep], date: "2026-09-30" });
    expect(rows.map((r) => [r.entity_id, r.amount])).toEqual([["rep", "4074.79"], ["a", "3057.75"], ["b", "846.12"]]);
  });

  it("asks for the month's return when there is none, and for a missing export", () => {
    const { said } = vatEvidence({ balances, returns: [{ ...oct, own: { rep: oct.own.rep } }], date: "2026-11-30" });
    expect(said[0]).toMatch(/No VAT return in os.stza.io ends on 30 November 2026 yet/);
    expect(said).toContain("ALP: no export uploaded for the October 2026 return, so nothing was taken for it.");
  });
});

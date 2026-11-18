import { describe, expect, it } from "vitest";
const { clearingJournals, returnLabel } = require("./vat-clearing");

// The September 2026 pattern, with made-up companies: two members reclaiming,
// cleared to the representative over their intercompany accounts.
const ret = { period_start: "2026-09-01", period_end: "2026-09-30", submitted_on: "2026-10-26" };
const columns = [
  { entity_id: "rep", entity_name: "Rep Ltd", representative: true, own: { 5: -4074.79 } },
  { entity_id: "a", entity_name: "Alpha Ltd", representative: false, own: { 5: -3057.75 } },
  { entity_id: "b", entity_name: "Beta Ltd", representative: false, own: { 5: -846.12 } },
];
const pairs = [
  { member_entity_id: "a", member_account_code: "621", representative_account_code: "641" },
  { member_entity_id: "b", member_account_code: "802", representative_account_code: "640" },
];
const vatCode = { rep: "820", a: "820", b: "820" };
const codes = { rep: "REP", a: "ALP", b: "BET" };

describe("VAT group clearing journals", () => {
  it("clears each member's reclaim to the representative, as booked by hand", () => {
    const { journals, issues } = clearingJournals({ ret, columns, pairs, vatCode, codes });
    expect(issues).toEqual([]);
    expect(journals.map((j) => j.entity_id)).toEqual(["a", "b", "rep"]);
    expect(journals[0]).toMatchObject({ journal_date: "2026-10-26", narration: "VAT group clearing: Sep 2026 return" });
    expect(journals[0].lines).toEqual([
      { account_code: "621", description: "Sep 2026 VAT return", amount: 3057.75, tax_type: "NONE" },
      { account_code: "820", description: "Sep 2026 VAT return", amount: -3057.75, tax_type: "NONE" },
    ]);
    expect(journals[2].lines).toEqual([
      { account_code: "820", description: "Sep 2026 VAT return", amount: 3903.87, tax_type: "NONE" },
      { account_code: "641", description: "Sep 2026 VAT return - ALP share", amount: -3057.75, tax_type: "NONE" },
      { account_code: "640", description: "Sep 2026 VAT return - BET share", amount: -846.12, tax_type: "NONE" },
    ]);
    for (const j of journals) expect(j.lines.reduce((s, l) => s + Math.round(l.amount * 100), 0)).toBe(0);
  });

  it("reverses the signs for a member that owes VAT, and skips one with nothing to clear", () => {
    const { journals } = clearingJournals({ ret, columns: [columns[0], { ...columns[1], own: { 5: 120 } }, { ...columns[2], own: { 5: 0 } }], pairs, vatCode, codes });
    expect(journals.map((j) => j.entity_id)).toEqual(["a", "rep"]);
    expect(journals[0].lines.map((l) => l.amount)).toEqual([-120, 120]);
    expect(journals[1].lines.map((l) => l.amount)).toEqual([-120, 120]);
  });

  it("proposes nothing while a member's intercompany accounts are not set", () => {
    const { journals, issues } = clearingJournals({ ret, columns, pairs: [pairs[0]], vatCode, codes });
    expect(journals).toEqual([]);
    expect(issues).toEqual(["BET has no intercompany accounts with the representative set for VAT clearing"]);
  });

  it("names the return by its months", () => {
    expect(returnLabel("2026-10-01", "2026-10-31")).toBe("Oct 2026");
    expect(returnLabel("2026-08-01", "2026-10-31")).toBe("Aug-Oct 2026");
    expect(returnLabel("2025-12-01", "2026-02-28")).toBe("Dec 2025-Feb 2026");
  });
});

describe("a clearing proposal already posted in Xero", () => {
  const { findPosted } = require("./vat-clearing");
  const proposal = { lines: [{ account_code: "621", amount: 3057.75 }, { account_code: "820", amount: -3057.75 }] };
  it("finds the posted journal with the same lines, in any order", () => {
    const xs = [
      { ManualJournalID: "draft", Status: "DRAFT", JournalLines: [{ AccountCode: "820", LineAmount: -3057.75 }, { AccountCode: "621", LineAmount: 3057.75 }] },
      { ManualJournalID: "other", Status: "POSTED", JournalLines: [{ AccountCode: "621", LineAmount: 3057.70 }, { AccountCode: "820", LineAmount: -3057.70 }] },
      { ManualJournalID: "it", Status: "POSTED", JournalLines: [{ AccountCode: "820", LineAmount: -3057.75 }, { AccountCode: "621", LineAmount: 3057.75 }] },
    ];
    expect(findPosted(proposal, xs).ManualJournalID).toBe("it");
    expect(findPosted(proposal, xs.slice(0, 2))).toBeNull();
  });
});

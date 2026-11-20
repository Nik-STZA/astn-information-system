import { describe, expect, it, vi } from "vitest";
const { matchKind, findPosted, postedAround, linkedNote } = require("./xero-posted-journals");

const proposal = { lines: [
  { account_code: "477", amount: 1000 }, { account_code: "479", amount: 120.5 },
  { account_code: "825", amount: -300.5 }, { account_code: "814", amount: -820 },
] };
const sameLines = { ManualJournalID: "same", Status: "POSTED", Narration: "Oct 2026 Payroll", JournalLines: [
  { AccountCode: "814", LineAmount: -820 }, { AccountCode: "825", LineAmount: -300.5 },
  { AccountCode: "477", LineAmount: 1000 }, { AccountCode: "479", LineAmount: 120.5 },
] };
// Net pay split over two lines by hand: same effect on every account.
const split = { ManualJournalID: "split", Status: "POSTED", JournalLines: [
  { AccountCode: "477", LineAmount: 1000 }, { AccountCode: "479", LineAmount: 120.5 },
  { AccountCode: "825", LineAmount: -300.5 }, { AccountCode: "814", LineAmount: -500 }, { AccountCode: "814", LineAmount: -320 },
] };
const offByAPenny = { ManualJournalID: "penny", Status: "POSTED", JournalLines: [
  { AccountCode: "477", LineAmount: 1000.01 }, { AccountCode: "479", LineAmount: 120.5 },
  { AccountCode: "825", LineAmount: -300.51 }, { AccountCode: "814", LineAmount: -820 },
] };

describe("journals already posted in Xero", () => {
  it("matches the same lines in any order", () => {
    expect(matchKind(proposal.lines, sameLines.JournalLines)).toBe("lines");
  });
  it("matches a hand journal that splits an account's lines differently", () => {
    expect(matchKind(proposal.lines, split.JournalLines)).toBe("accounts");
  });
  it("does not match a journal a penny out on any account", () => {
    expect(matchKind(proposal.lines, offByAPenny.JournalLines)).toBeNull();
  });
  it("prefers the same lines over the same accounts", () => {
    expect(findPosted(proposal, [split, sameLines]).journal.ManualJournalID).toBe("same");
    expect(findPosted(proposal, [split]).match).toBe("accounts");
  });
  it("never takes a draft, or a journal already linked to another proposal", () => {
    expect(findPosted(proposal, [{ ...sameLines, Status: "DRAFT" }])).toBeNull();
    expect(findPosted(proposal, [sameLines], new Set(["same"]))).toBeNull();
  });
  it("says how it matched in the reason", () => {
    expect(linkedNote(sameLines, "lines", "cfo@example.com")).toMatch(/Oct 2026 Payroll; same lines\), recorded by cfo@example.com: linked, not posted again/);
    expect(linkedNote(split, "accounts")).toMatch(/lines split differently\): linked/);
  });
  it("reads posted journals around the date, page by page", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ ManualJournalID: `p${i}`, Status: "POSTED" }));
    const xeroGet = vi.fn().mockResolvedValueOnce({ ManualJournals: page }).mockResolvedValueOnce({ ManualJournals: [sameLines] });
    const xeroEntityContext = vi.fn().mockResolvedValue({ accessToken: "t", tenantId: "x" });
    const got = await postedAround({ xeroEntityContext, xeroGet, clientSlug: "c", entitySlug: "e", date: "2026-10-23", days: 31 });
    expect(got).toHaveLength(101);
    expect(xeroGet.mock.calls[0][3].where).toBe('Date >= DateTime(2026,9,22) AND Date <= DateTime(2026,11,23) AND Status=="POSTED"');
  });
  it("refuses when the company is not connected to Xero", async () => {
    await expect(postedAround({ xeroEntityContext: async () => ({ error: "no token" }), xeroGet: vi.fn(), clientSlug: "c", entitySlug: "e", date: "2026-10-23" }))
      .rejects.toThrow("no token");
  });
});

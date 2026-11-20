import { describe, expect, it } from "vitest";
const { staffTimeEvidence, capitalisedTotal, MARK } = require("./rec-payroll-evidence");

// Made-up figures in the shape of the October 2026 tie: last month signed the
// register at 57,000.00 against a ledger of 81,855.35; this month's payroll
// capitalised 6,013.34; the register now signs 153,000.00 and the ledger holds
// 183,868.69. Staff time = 24,855.35 + 6,013.34 = 30,868.69, the difference.
const balance = { entity_id: "a", entity_name: "Alpha Ltd", opening: 81855.35, closing: 183868.69 };
const cap = { found: true, confirmed: true, issues: [], total: 6013.34, by_project: { P1: 1202.67, P2: 3608.01, P3: 601.33, P4: 601.33, P5: 0 },
  journals: [{ jnl: "JNL-70", state: "posted" }] };
const first = { period: "2026-09", signed: true, evidence: [{ entity_id: "a", amount: "57000.00", document_ref: null }] };
const base = { balance, cap, period: "2026-10", date: "2026-10-31" };

describe("staff time capitalised through payroll", () => {
  it("starts from last month's balance less what was signed for it, and ties the register's difference", () => {
    const { row, said } = staffTimeEvidence({ ...base, prior: first });
    expect(row.amount).toBe(30868.69);
    expect(row.amount + 153000).toBe(183868.69);
    expect(row.document_ref).toBe(MARK);
    expect(row.note).toMatch(/^Starting figure: the 2026-09 balance 81,855.35 less the 57,000.00 signed for it then\./);
    expect(row.note).toMatch(/P1 1,202.67, P2 3,608.01, P3 601.33, P4 601.33\. Journals: JNL-70 posted in Xero\./);
    expect(said[0]).toMatch(/\(starting figure\)/);
  });
  it("rolls last month's signed staff-time row forward after that", () => {
    const prior = { period: "2026-10", signed: true, evidence: [{ entity_id: "a", amount: "153000.00" }, { entity_id: "a", amount: "30868.69", document_ref: MARK }] };
    const { row } = staffTimeEvidence({ ...base, balance: { ...balance, opening: 183868.69 }, cap: { ...cap, total: 5000 }, prior, period: "2026-11", date: "2026-11-30" });
    expect(row.amount).toBe(35868.69);
    expect(row.note).not.toMatch(/Starting figure/);
  });
  it("does not count last month's staff time keyed by hand as the register's", () => {
    // Last month the preparer keyed the staff time as its own row (no method);
    // only the register's fetched row is taken off the opening.
    const prior = { period: "2026-09", signed: true, evidence: [
      { entity_id: "a", amount: "57000.00", document_ref: null, method: "asset_register" },
      { entity_id: "a", amount: "24855.35", document_ref: null, method: null },
    ] };
    const { row } = staffTimeEvidence({ ...base, prior });
    expect(row.amount).toBe(30868.69);
    expect(row.note).toMatch(/less the 57,000.00 signed for it then/);
  });
  it("takes nothing until payroll is loaded, confirmed and clean, or while last month is unsigned", () => {
    expect(staffTimeEvidence({ ...base, cap: { ...cap, found: false }, prior: first }).row).toBeNull();
    expect(staffTimeEvidence({ ...base, cap: { ...cap, confirmed: false }, prior: first }).said[0]).toMatch(/not confirmed yet/);
    expect(staffTimeEvidence({ ...base, cap: { ...cap, issues: ["employee code 14 has no role"] }, prior: first }).said[0]).toMatch(/\(employee code 14 has no role\)/);
    expect(staffTimeEvidence({ ...base, prior: { ...first, signed: false } }).said[0]).toMatch(/not signed/);
    expect(staffTimeEvidence({ ...base, prior: null }).row).toBeNull();
  });
  it("adds the account's lines of the staff and contractor capitalisation journals only", () => {
    const journals = [
      { kind: "capdev", entity: "a", lines: [{ account_code: "789", amount: 9000.1 }, { account_code: "789", amount: 3000 }, { account_code: "464", amount: -12000.1 }] },
      { kind: "capdev_contractor", entity: "a", lines: [{ account_code: "789", amount: 500.25 }, { account_code: "466", amount: -500.25 }] },
      { kind: "capdev_other", entity: "b", lines: [{ account_code: "789", amount: 1 }] },
      { kind: "payroll", entity: "a", lines: [{ account_code: "789", amount: 7 }] },
    ];
    expect(capitalisedTotal(journals, { entity: "a", accountCode: "789" })).toBe(12500.35);
  });
});

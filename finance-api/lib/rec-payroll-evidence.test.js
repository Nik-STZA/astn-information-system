import { describe, expect, it } from "vitest";
const { payrollCapEvidence, capitalisedTotal } = require("./rec-payroll-evidence");

const bal = { entity_id: "udl", entity_name: "Alpha Ltd", opening: 100000, closing: 112000 };
const cap = { entity_id: "udl", account_code: "789", found: true, confirmed: true, total: 12000, by_project: { P1: 9000, P2: 3000, P3: 0 },
  journals: [{ jnl: "JNL-70", kind: "capdev", state: "posted" }] };
const base = { period: "2026-10", date: "2026-10-31" };

describe("capitalised development from payroll", () => {
  it("rolls last month's signed figure forward by the month's capitalisation", () => {
    const out = payrollCapEvidence({ ...base, balances: [bal], cap, prior: { signed: true, period: "2026-09", by_entity: { udl: 100000 } } });
    expect(out.rows).toEqual([{ entity_id: "udl", amount: 112000,
      source: "Signed 2026-09 figure 100,000.00 plus 2026-10 payroll capitalisation 12,000.00 at 2026-10-31",
      note: "By project: P1 9,000.00, P2 3,000.00. Journals: JNL-70 posted in Xero." }]);
    expect(out.said[0]).toMatch(/which ties/);
  });
  it("uses the ledger's opening when last month is not signed, and says so", () => {
    const out = payrollCapEvidence({ ...base, balances: [{ ...bal, closing: 112500 }], cap, prior: null });
    expect(out.rows[0].amount).toBe(112000);
    expect(out.rows[0].note).toMatch(/not signed, so the ledger's opening balance is used/);
    expect(out.said[0]).toMatch(/500.00 more: other postings to the account to explain/);
  });
  it("takes nothing until the month is loaded and its shares confirmed", () => {
    expect(payrollCapEvidence({ ...base, balances: [bal], cap: { ...cap, found: false } }).rows).toEqual([]);
    const out = payrollCapEvidence({ ...base, balances: [bal], cap: { ...cap, confirmed: false } });
    expect(out.rows).toEqual([]);
    expect(out.said[0]).toMatch(/not confirmed yet/);
    expect(payrollCapEvidence({ ...base, balances: [bal], cap: { ...cap, issues: ["employee code 14 has no role"] } }).said[0]).toMatch(/cannot be worked out yet \(employee code 14 has no role\)/);
  });
  it("takes nothing for another company, or with no payroll set up", () => {
    expect(payrollCapEvidence({ ...base, balances: [{ ...bal, entity_id: "fgh" }], cap }).rows).toEqual([]);
    expect(payrollCapEvidence({ ...base, balances: [bal], cap: null }).said[0]).toMatch(/not set up/);
  });
  it("adds the account's lines of the staff and contractor capitalisation journals only", () => {
    const journals = [
      { kind: "capdev", entity: "udl", lines: [{ account_code: "789", amount: 9000.1 }, { account_code: "789", amount: 3000 }, { account_code: "464", amount: -12000.1 }] },
      { kind: "capdev_contractor", entity: "udl", lines: [{ account_code: "789", amount: 500.25 }, { account_code: "466", amount: -500.25 }] },
      { kind: "capdev_other", entity: "fgh", lines: [{ account_code: "789", amount: 1 }] },
      { kind: "payroll", entity: "udl", lines: [{ account_code: "789", amount: 7 }] },
    ];
    expect(capitalisedTotal(journals, { entity: "udl", accountCode: "789" })).toBe(12500.35);
  });
});

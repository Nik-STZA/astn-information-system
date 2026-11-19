import { describe, expect, it } from "vitest";
import { billsWhere, contractorsIssues, costsFromBills, fingerprint, wordsOf } from "./payroll-contractors";
import { payrollJournals, readSalaryReport } from "./payroll";

// All made up. The key stands in for the one kept in Secret Manager.
const KEY = "0".repeat(64);
const UMBRELLA = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";
const C1 = { code: "C1", contact_id: UMBRELLA, match: fingerprint(KEY, "bloggs") };

const bill = (over, lines) => ({
  Type: "ACCPAY", InvoiceID: "inv", InvoiceNumber: "1001", Status: "PAID", DateString: "2026-10-29T00:00:00",
  LineAmountTypes: "Exclusive", Contact: { ContactID: UMBRELLA }, LineItems: lines, ...over,
});
const line = (Description, LineAmount, TaxAmount = 0) => ({ Description, LineAmount, TaxAmount });

describe("matching a contractor's bills without keeping the name", () => {
  it("fingerprints each word the same way, whatever its case", () => {
    expect(fingerprint(KEY, "Bloggs")).toBe(fingerprint(KEY, "bloggs"));
    expect(fingerprint(KEY, "bloggs")).not.toBe(fingerprint("1".repeat(64), "bloggs"));
    expect(wordsOf("Umbrella Ltd - services of Miss Jo Bloggs")).toEqual(["umbrella", "ltd", "services", "of", "miss", "jo", "bloggs"]);
  });

  it("takes the net of the lines that name the contractor, on approved bills dated in the month", () => {
    const bills = [
      bill({}, [line("Umbrella Ltd - services of Miss Jo Bloggs", 1200, 240), line("Umbrella Ltd - services of Sam Sample", 900, 180)]),
      bill({ InvoiceNumber: "1002", LineAmountTypes: "Inclusive" }, [line("Expenses - Jo Bloggs", 120, 20)]),
      bill({ InvoiceNumber: "1003", Status: "DRAFT" }, [line("Jo Bloggs", 500)]),
      bill({ InvoiceNumber: "1004", DateString: "2026-09-30T00:00:00" }, [line("Jo Bloggs", 500)]),
      bill({ InvoiceNumber: "1005", Contact: { ContactID: OTHER } }, [line("Jo Bloggs", 500)]),
    ];
    expect(costsFromBills(bills, [C1], KEY, "2026-10")).toEqual({ C1: { cost: 1300, bills: ["1001", "1002"] } });
  });

  it("finds nil when there is no bill for the month", () => {
    expect(costsFromBills([], [C1], KEY, "2026-10")).toEqual({ C1: { cost: 0, bills: [] } });
  });

  it("refuses a setting that holds a name instead of a fingerprint", () => {
    expect(contractorsIssues([C1])).toEqual([]);
    expect(contractorsIssues([{ ...C1, match: "Bloggs" }])[0]).toMatch(/fingerprint, never the name/);
    expect(contractorsIssues([C1, C1])).toContain("contractor C1 is listed twice");
    expect(contractorsIssues([{ ...C1, code: "12" }])[0]).toMatch(/not a contractor code/);
  });

  it("asks Xero for one supplier's bills dated in the month", () => {
    expect(billsWhere(UMBRELLA, "2026-02")).toBe(`Type=="ACCPAY" AND Contact.ContactID==guid("${UMBRELLA}") AND Date>=DateTime(2026,2,1) AND Date<=DateTime(2026,2,28)`);
    expect(() => billsWhere('x") OR (1==1', "2026-02")).toThrow();
  });
});

const HEAD = ["EmpCode", "Basic", "EePension(BeforeTax)", "EeeNIC", "Tax", "NetPay", "EerNIC", "ErPension", "PayBill"];
const { employees } = readSalaryReport([HEAD, ["11", 5000, 250, 400, 900, 3450, 600, 300, 5000]]);
const SETTINGS = {
  payroll_entity: "alpha-ltd", projects: ["P1", "P2"],
  accounts: {
    payroll: { directors_salary: "478", paye: "825", pensions: "858", directors_net: "835", er_nic_direct: "479", er_pension_direct: "482" },
    capdev: { capdev: "789", capdev_credit: "464", recharge_cost: "481", recharge_ic: "641", contractor_credit: "466" },
  },
};
const month = (alloc, contractors) => payrollJournals({ employees, roles: { 11: "director" }, alloc, settings: SETTINGS, period: "2026-10", payDate: "2026-10-23", contractors });

describe("the contractors' journal", () => {
  it("capitalises the confirmed share of the contractor's cost in the payroll company, with no recharge", () => {
    const out = month({ C1: { P1: 30, P2: 10 } }, [{ code: "C1", cost: 1200 }]);
    expect(out.issues).toEqual([]);
    expect(out.capdev).toBeNull();
    expect(out.capdev_contractor).toMatchObject({ entity: "alpha-ltd", date: "2026-10-23", narration: "Oct 2026 Capitalised Development - Contractors", by_project: { P1: 360, P2: 120 } });
    expect(out.capdev_contractor.lines).toEqual([
      { account_code: "789", description: "Capitalised Development - Oct 2026 - P1 - contractors", amount: 360, tax_type: "NONE" },
      { account_code: "789", description: "Capitalised Development - Oct 2026 - P2 - contractors", amount: 120, tax_type: "NONE" },
      { account_code: "466", description: "Capitalised Contractor Costs - Oct 2026", amount: -480, tax_type: "NONE" },
    ]);
  });

  it("makes no journal while the contractor's share is nil", () => {
    const out = month({ C1: {} }, [{ code: "C1", cost: 1200 }]);
    expect(out.capdev_contractor).toBeNull();
    expect(out.issues).toEqual([]);
  });

  it("stops when the bills are not read, or there is no bill, for a share", () => {
    expect(month({ C1: { P1: 30 } }, [{ code: "C1", cost: null }]).issues).toContain("contractor C1: read the month's bills from Xero first");
    expect(month({ C1: { P1: 30 } }, [{ code: "C1", cost: 0 }]).issues).toContain("contractor C1: no approved bill dated in the month, so there is nothing to capitalise");
  });

  it("needs the contractors' account in the settings", () => {
    const bare = payrollJournals({ employees, roles: { 11: "director" }, alloc: { C1: { P1: 30 } }, period: "2026-10", payDate: "2026-10-23", contractors: [{ code: "C1", cost: 1200 }],
      settings: { ...SETTINGS, accounts: { ...SETTINGS.accounts, capdev: { capdev: "789" } } } });
    expect(bare.issues).toContain("no account set for Capitalised Contractor Costs");
  });
});

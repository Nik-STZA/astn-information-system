import { describe, expect, it } from "vitest";
import { carryForward, payrollJournals, readSalaryReport, rolesIssues } from "./payroll";

// A salary report in the provider's shape: title rows, headings on row 7,
// personal columns among the figures. All made up.
const HEAD = ["CompanyName", "BranchName", "DepartmentName", "EmpCode", "Forenames", "Surname", "TaxCode", "W1M1", "AnnualSalary", "Basic",
  "EePension(BeforeTax)", "EeeNIC", "Tax", "NetPay", "EerNIC", "ErPension", "PayBill", "NINumber", "Address1", "Email"];
const person = (code, basic, eeP, eeNic, tax, net, erNic, erP, bill) =>
  ["Sample Ltd", "", "", code, "JO", "BLOGGS", "1257L", "", basic * 12, basic, eeP, eeNic, tax, net, erNic, erP, bill, "AB123456C", "1 Example Street", "jo@example.com"];
const REPORT = [
  ["Company Name", "Sample Ltd"], ["Report Name", "Salary Report"], [], [], [], [],
  HEAD,
  // PayBill is gross pay in this provider's report (it equals Basic with no bonus).
  person("11", 5000, 250, 400, 900, 3450, 600, 300, 5000),
  person("12", 4000, 200, 300, 700, 2800, 450, 240, 4000),
  person("13", 3000, 150, 200, 400, 2250, 300, 180, 3000),
];

describe("reading the salary report", () => {
  it("keeps the employee code and the payroll figures, by heading, and nothing personal", () => {
    const r = readSalaryReport(REPORT);
    expect(r.issues).toEqual([]);
    expect(r.header_row).toBe(7);
    expect(r.employees).toHaveLength(3);
    expect(r.employees[0]).toEqual({ emp_code: "11", basic: 5000, bonus: 0, ee_pension: 250, ee_nic: 400, tax: 900, net_pay: 3450, er_nic: 600, er_pension: 300, pay_bill: 5000 });
    const kept = JSON.stringify(r);
    for (const personal of ["JO", "BLOGGS", "1257L", "AB123456C", "Example Street", "jo@example.com"]) expect(kept.includes(personal), personal).toBe(false);
  });

  it("takes a column missing from this month's export as nil, and says so", () => {
    expect(readSalaryReport(REPORT).missing).toEqual(["Bonus Pensionable"]);
  });

  it("finds the columns wherever they sit, as a working file adds one", () => {
    const shifted = REPORT.map((row, i) => (i >= 6 ? [...row.slice(0, 10), i === 6 ? "Bonus Pensionable" : 100, ...row.slice(10)] : row));
    const r = readSalaryReport(shifted);
    expect(r.missing).toEqual([]);
    expect(r.employees[1]).toMatchObject({ basic: 4000, bonus: 100, ee_pension: 200 });
  });

  it("leaves out the provider's totals row, and keeps Excel's tails to the penny", () => {
    const tot = ["Sample Ltd", "", "", 3, "", "", "", "", 0, 12000, 600, 900, 2000, 8500, 1350, 720, 12000, "", "", ""];
    const tails = REPORT.map((row, i) => (i === 7 ? [...row.slice(0, 12), 900.0000000001, ...row.slice(13)] : row));
    const r = readSalaryReport([...tails, tot]);
    expect(r.employees.map((e) => e.emp_code)).toEqual(["11", "12", "13"]);
    expect(r.issues).toEqual([]);
    expect(r.employees[0].tax).toBe(900);
  });

  it("refuses something that is not the report, and a code twice", () => {
    expect(readSalaryReport([["a", "b"]]).issues[0]).toMatch(/EmpCode/);
    expect(readSalaryReport([...REPORT, person("11", 1, 0, 0, 0, 1, 0, 0, 1)]).issues).toContain("employee code 11 appears twice");
  });
});

const SETTINGS = {
  payroll_entity: "alpha-ltd", contracted_entity: "beta-ltd",
  projects: ["P1", "P2"],
  accounts: {
    payroll: { directors_salary: "478", direct_salary: "477", ic_salary: "641", bonus: "484", er_nic_direct: "479", er_nic_ic: "641",
      er_pension_direct: "482", er_pension_ic: "641", paye: "825", net_pay: "814", pensions: "858", directors_net: "835" },
    contracted: { c_salary: "477", c_bonus: "484", c_er_nic: "479", c_er_pension: "482", c_intercompany: "621" },
    capdev: { capdev: "789", capdev_credit: "464", recharge_cost: "481", recharge_ic: "641", other_recharge_ic: "621", other_recharge_cost: "481" },
  },
};
const ROLES = { 11: "director", 12: "direct", 13: "intercompany" };

describe("the month's journals", () => {
  const { employees } = readSalaryReport(REPORT);

  it("stops when someone has no role", () => {
    expect(rolesIssues(employees, { 11: "director" })[0]).toBe("no role for employee codes 12, 13: set director, direct or intercompany first");
    expect(payrollJournals({ employees, roles: { 11: "director" }, settings: SETTINGS, period: "2026-10", payDate: "2026-10-23" }).journals).toEqual([]);
  });

  it("builds the payroll journal as the working file does, and it balances", () => {
    const out = payrollJournals({ employees, roles: ROLES, settings: SETTINGS, period: "2026-10", payDate: "2026-10-23" });
    expect(out.issues).toEqual([]);
    const pay = out.journals[0];
    expect(pay).toMatchObject({ entity: "alpha-ltd", narration: "Oct 2026 Payroll", date: "2026-10-23" });
    const by = Object.fromEntries(pay.lines.map((l) => [l.description, l.amount]));
    expect(by).toEqual({
      "Directors Salary": 5000, "Salaries - Direct Staff": 4000, "Salaries - Intercompany Staff": 3000,
      "Employers NI - Direct Staff": 1050, "Employers NI - Intercompany Staff": 300,
      "Employer Pension Cost - Direct Staff": 540, "Employer Pension Cost - Intercompany Staff": 180,
      "HMRC - PAYE and Employee NIC": -(900 + 400 + 600 + 700 + 300 + 450 + 400 + 200 + 300),
      "Net Pay - Payroll": -(2800 + 2250), "Pensions Payable": -(250 + 300 + 200 + 240 + 150 + 180), "Directors Net Wages Payable": -3450,
    });
    expect(pay.lines.every((l) => l.tax_type === "NONE")).toBe(true);
  });

  it("puts the intercompany staff's costs in the other company, against its intercompany account", () => {
    const out = payrollJournals({ employees, roles: ROLES, settings: SETTINGS, period: "2026-10", payDate: "2026-10-23" });
    const c = out.journals[1];
    expect(c.entity).toBe("beta-ltd");
    expect(c.lines.map((l) => [l.account_code, l.amount])).toEqual([["477", 3000], ["479", 300], ["482", 180], ["621", -3480]]);
  });

  it("capitalises employer cost by project, with the recharge in both companies", () => {
    const out = payrollJournals({ employees, roles: ROLES, alloc: { 11: { P1: 50 }, 12: { P1: 25, P2: 25 } }, settings: SETTINGS, period: "2026-10", payDate: "2026-10-23" });
    // Employer cost: 11 = 5000 + 600 + 300 = 5900; 12 = 4000 + 450 + 240 = 4690.
    expect(out.capdev.by_project).toEqual({ P1: 2950 + 1172.5, P2: 1172.5 });
    const total = 2950 + 1172.5 + 1172.5;
    expect(out.capdev.lines.map((l) => [l.account_code, l.amount])).toEqual([["789", 4122.5], ["789", 1172.5], ["464", -total], ["481", total], ["641", -total]]);
    expect(out.capdev.other.map((l) => [l.account_code, l.amount])).toEqual([["621", total], ["481", -total]]);
    expect(out.capdev.lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(0, 2);
  });

  it("refuses a share over 100% or an unknown project, and an account the settings do not name", () => {
    const out = payrollJournals({ employees, roles: ROLES, alloc: { 11: { P1: 80, P9: 30 } }, settings: SETTINGS, period: "2026-10", payDate: "2026-10-23" });
    expect(out.issues).toEqual(expect.arrayContaining(["employee 11: capitalised share adds to 110%, over 100%", "employee 11: P9 is not a project"]));
    const bare = payrollJournals({ employees, roles: ROLES, settings: { ...SETTINGS, accounts: { ...SETTINGS.accounts, payroll: { ...SETTINGS.accounts.payroll, paye: undefined } } }, period: "2026-10", payDate: "2026-10-23" });
    expect(bare.issues).toContain("no account set for HMRC - PAYE and Employee NIC");
  });

  it("carries last month's shares forward: a new starter at nil, a leaver dropped", () => {
    expect(carryForward({ 11: { P1: 50 }, 99: { P2: 10 } }, employees)).toEqual({ 11: { P1: 50 }, 12: {}, 13: {} });
  });
});

describe("layer rules", () => {
  const { layerIssues, layersShapeIssues } = require("./payroll");
  const layers = {
    H1: { name: "Hardware", capitalise: false, why: "tangible, kept in the hardware register" },
    S1: { name: "Surface", from: "2026-11", why: "until the IP transfers" },
    A1: { name: "Application" },
  };
  it("refuses a share on a layer never capitalised to the software account", () => {
    expect(layerIssues({ 12: { H1: 10, A1: 5 } }, layers, "2026-10")).toEqual(["12: H1 Hardware is not capitalised to the software account (tangible, kept in the hardware register)"]);
  });
  it("refuses a share before the layer's first month, and allows it from then", () => {
    expect(layerIssues({ C1: { S1: 20 } }, layers, "2026-10")).toEqual(["C1: S1 Surface cannot be capitalised before 2026-11 (until the IP transfers)"]);
    expect(layerIssues({ C1: { S1: 20 } }, layers, "2026-11")).toEqual([]);
  });
  it("ignores nil shares and layers with no rule", () => {
    expect(layerIssues({ 12: { H1: 0, A1: 50, Z9: 5 } }, layers, "2026-10")).toEqual([]);
    expect(layerIssues({ 12: { H1: 10 } }, undefined, "2026-10")).toEqual([]);
  });
  it("checks the rules as set", () => {
    expect(layersShapeIssues(layers, ["H1", "S1", "A1"])).toEqual([]);
    expect(layersShapeIssues({ X1: { capitalise: "no", from: "Nov" } }, ["H1"])).toEqual([
      "layers: X1 is not a project", "layers.X1.capitalise must be true or false", "layers.X1.from must be YYYY-MM",
    ]);
    expect(layersShapeIssues([], [])).toEqual(["layers must be { project: { name, capitalise, from, why } }"]);
  });
  it("shows a share against the rules as an issue on the month's journals", () => {
    const employees = [{ emp_code: "12", basic: 1000, er_nic: 100, er_pension: 30, bonus: 0, pay_bill: 1130, tax: 200, ee_nic: 80, net_pay: 700, ee_pension: 20 }];
    const out = payrollJournals({ employees, roles: { 12: "intercompany" }, alloc: { 12: { H1: 10 } }, period: "2026-10", payDate: "2026-10-23",
      settings: { payroll_entity: "a", contracted_entity: "b", accounts: {}, projects: ["H1", "S1", "A1"], layers } });
    expect(out.issues).toContain("12: H1 Hardware is not capitalised to the software account (tangible, kept in the hardware register)");
  });
});

// Payroll: the provider's monthly salary report in, staff details out, and
// the month's journals proposed for the CFO (19 Nov 2026 design). Pure:
// lib/payroll-routes.js reads and writes.
//
// Staff details never reach os.stza.io. The report is read in memory and only
// the employee code and an allow-list of payroll figures are kept: names,
// addresses, emails, NI numbers, tax codes and everything else are dropped
// before anything is stored or logged. Columns are found by heading, because a
// working file can carry an extra column the export does not.
//
// Each person's role (director, direct staff, intercompany) is held here by
// employee code; a code with no role stops the build. Capitalised development
// percentages carry forward from last month for the CFO to confirm.
//
// Three journals, as the client's working file built them (accounts come from
// the client's payroll settings, never from code):
//   the payroll journal         costs by role, and the liabilities
//   the contracted staff journal  the intercompany staff's costs in the other company
//   capitalised development     employer cost x project %, and the recharge

const { toPence, fromPence } = require("./journal");

// The figures kept, by heading in the salary report. Nothing else is read.
const FIGURES = {
  basic: "Basic",
  bonus: "Bonus Pensionable",
  ee_pension: "EePension(BeforeTax)",
  ee_nic: "EeeNIC",
  tax: "Tax",
  net_pay: "NetPay",
  er_nic: "EerNIC",
  er_pension: "ErPension",
  pay_bill: "PayBill",
};
const CODE = "EmpCode";
const ROLES = ["director", "direct", "intercompany"];
const PROJECT = /^[A-Za-z0-9]{1,8}$/;

const norm = (h) => String(h ?? "").replace(/\s+/g, "").toLowerCase();
// Pence from a cell. Excel keeps tails such as 15570.300000000001, so a number
// is rounded to the penny, never refused; text is read as a figure or refused.
function cellPence(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const n = Number(String(v).replace(/[,\s£]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// The report's rows (each a list of cell values, as the browser or a script
// reads the sheet) to { employees, missing, issues, header_row }.
//   employees  [{ emp_code, basic, bonus, ... }] in pounds, two decimals
//   missing    figures whose heading is not in this report: taken as nil
function readSalaryReport(rows) {
  const issues = [];
  const at = (rows ?? []).findIndex((r) => Array.isArray(r) && r.some((c) => norm(c) === norm(CODE)));
  if (at < 0) return { employees: [], missing: [], issues: ["no EmpCode heading: is this the salary report?"], header_row: null };
  const head = rows[at].map(norm);
  const col = Object.fromEntries(Object.entries(FIGURES).map(([k, h]) => [k, head.indexOf(norm(h))]));
  const codeAt = head.indexOf(norm(CODE));
  const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => FIGURES[k]);
  for (const need of ["basic", "net_pay", "er_nic", "tax"]) if (col[need] < 0) issues.push(`the report has no ${FIGURES[need]} column`);
  const employees = [];
  const seen = new Set();
  for (const r of rows.slice(at + 1)) {
    if (!Array.isArray(r)) continue;
    const code = String(r[codeAt] ?? "").trim();
    if (!code || /total/i.test(code)) continue;
    if (seen.has(code)) { issues.push(`employee code ${code} appears twice`); continue; }
    seen.add(code);
    const e = { emp_code: code };
    for (const [k, i] of Object.entries(col)) {
      const p = i < 0 ? 0 : cellPence(r[i]);
      if (p === null) { issues.push(`employee ${code}: ${FIGURES[k]} is not a figure`); e[k] = 0; } else e[k] = p / 100;
    }
    employees.push(e);
  }
  // The provider's totals row carries the head count in the code column (5
  // for five people, 19 Nov 2026) and the sum of everyone's figures. A row
  // whose basic and net pay are each the sum of all the others is that row.
  const pen = (e, k) => Math.round(e[k] * 100);
  const totals = employees.filter((t) => employees.length > 2
    && ["basic", "net_pay"].every((k) => pen(t, k) === employees.filter((o) => o !== t).reduce((a, o) => a + pen(o, k), 0))
    && pen(t, "basic") !== 0);
  for (const t of totals) employees.splice(employees.indexOf(t), 1);
  if (!employees.length) issues.push("the report has no employees");
  return { employees, missing, issues, header_row: at + 1 };
}

// Pence, added as pence: adding pounds first gives tails that do not convert.
const sum = (list, f) => list.reduce((a, e) => a + [].concat(f(e)).reduce((b, v) => b + Math.round(Number(v || 0) * 100), 0), 0);

// Every employee's role, or the codes with none.
function rolesIssues(employees, roles) {
  const missing = employees.filter((e) => !ROLES.includes(roles[e.emp_code]));
  return missing.length ? [`no role for employee code${missing.length === 1 ? "" : "s"} ${missing.map((e) => e.emp_code).join(", ")}: set director, direct or intercompany first`] : [];
}

// A journal from (account key, pence) pairs, dropping nil lines. The settings
// name the account codes; a missing one is an issue, never a default.
function journalFrom(lines, accounts, { narration, date, entity, describe }) {
  const issues = [];
  const out = [];
  for (const [key, p] of lines) {
    if (!p) continue;
    const code = accounts?.[key];
    if (!code) { issues.push(`no account set for ${describe[key] ?? key}`); continue; }
    out.push({ account_code: String(code), description: describe[key] ?? key, amount: Number(fromPence(p)), tax_type: "NONE" });
  }
  const net = out.reduce((a, l) => a + toPence(l.amount), 0);
  if (!issues.length && net !== 0) issues.push(`the ${entity} journal does not balance: out by ${fromPence(Math.abs(net))}`);
  return { entity, date, narration, lines: out, issues };
}

const DESCRIBE = {
  directors_salary: "Directors Salary", direct_salary: "Salaries - Direct Staff", ic_salary: "Salaries - Intercompany Staff",
  bonus: "Bonuses", er_nic_direct: "Employers NI - Direct Staff", er_nic_ic: "Employers NI - Intercompany Staff",
  er_pension_direct: "Employer Pension Cost - Direct Staff", er_pension_ic: "Employer Pension Cost - Intercompany Staff",
  paye: "HMRC - PAYE and Employee NIC", net_pay: "Net Pay - Payroll", pensions: "Pensions Payable", directors_net: "Directors Net Wages Payable",
  c_salary: "Salaries - Contracted Staff", c_bonus: "Bonuses", c_er_nic: "Employers NI - Contracted Staff", c_er_pension: "Employer Pension Cost - Contracted Staff",
  c_intercompany: "Intercompany account",
  capdev: "Capitalised Development", capdev_credit: "Capitalised Development", recharge_cost: "Interco Payroll Recharge", recharge_ic: "Interco Payroll Recharge",
  other_recharge_ic: "Interco Payroll Recharge", other_recharge_cost: "Interco Payroll Recharge",
};

// The month's journals. settings: { payroll_entity, contracted_entity, accounts: { payroll: {...}, contracted: {...}, capdev: {...} }, projects: [...] }
//   roles   { emp_code: role }
//   alloc   { emp_code: { project: percent 0-100 } }
function payrollJournals({ employees, roles, alloc = {}, settings, period, payDate }) {
  const issues = [...rolesIssues(employees, roles)];
  if (issues.length) return { journals: [], issues, capdev: null };
  const of = (role) => employees.filter((e) => roles[e.emp_code] === role);
  const notIc = employees.filter((e) => roles[e.emp_code] !== "intercompany");
  const ic = of("intercompany");
  const directors = of("director");
  const [y, m] = period.split("-").map(Number);
  const narration = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y} Payroll`;
  const date = payDate;
  const A = settings?.accounts ?? {};

  const payroll = journalFrom([
    ["directors_salary", sum(directors, (e) => e.basic)],
    ["direct_salary", sum(of("direct"), (e) => e.basic)],
    ["ic_salary", sum(ic, (e) => e.pay_bill)],
    ["bonus", sum(notIc, (e) => e.bonus)],
    ["er_nic_direct", sum(notIc, (e) => e.er_nic)],
    ["er_nic_ic", sum(ic, (e) => e.er_nic)],
    ["er_pension_direct", sum(notIc, (e) => e.er_pension)],
    ["er_pension_ic", sum(ic, (e) => e.er_pension)],
    ["paye", -sum(employees, (e) => [e.tax, e.ee_nic, e.er_nic])],
    ["net_pay", -sum(employees.filter((e) => roles[e.emp_code] !== "director"), (e) => e.net_pay)],
    ["pensions", -sum(employees, (e) => [e.ee_pension, e.er_pension])],
    ["directors_net", -sum(directors, (e) => e.net_pay)],
  ], A.payroll, { narration, date, entity: settings?.payroll_entity, describe: DESCRIBE });

  const contractedLines = [
    ["c_salary", sum(ic, (e) => e.basic)],
    ["c_bonus", sum(ic, (e) => e.bonus)],
    ["c_er_nic", sum(ic, (e) => e.er_nic)],
    ["c_er_pension", sum(ic, (e) => e.er_pension)],
  ];
  const contracted = ic.length ? journalFrom([...contractedLines, ["c_intercompany", -contractedLines.reduce((a, [, p]) => a + p, 0)]],
    A.contracted, { narration, date, entity: settings?.contracted_entity, describe: DESCRIBE }) : null;

  // Capitalised development: employer cost x each project's percentage.
  const projects = settings?.projects ?? [];
  const byProject = Object.fromEntries(projects.map((p) => [p, 0]));
  const allocIssues = [];
  for (const e of employees) {
    const pct = alloc[e.emp_code] ?? {};
    const total = Object.values(pct).reduce((a, v) => a + Number(v || 0), 0);
    if (total > 100.0001) allocIssues.push(`employee ${e.emp_code}: capitalised share adds to ${total}%, over 100%`);
    const cost = Math.round(e.basic * 100) + Math.round(e.er_nic * 100) + Math.round(e.er_pension * 100);
    for (const [p, v] of Object.entries(pct)) {
      if (!projects.includes(p)) { allocIssues.push(`employee ${e.emp_code}: ${p} is not a project`); continue; }
      byProject[p] += Math.round((cost * Number(v || 0)) / 100);
    }
  }
  const capTotal = Object.values(byProject).reduce((a, p) => a + p, 0);
  let capdev = null;
  if (capTotal) {
    const C = A.capdev ?? {};
    const lines = [];
    const cIssues = [];
    for (const [p, amt] of Object.entries(byProject)) {
      if (!amt) continue;
      if (!C.capdev) { cIssues.push("no account set for Capitalised Development"); break; }
      lines.push({ account_code: String(C.capdev), description: `Capitalised Development - ${narration.replace(" Payroll", "")} - ${p}`, amount: Number(fromPence(amt)), tax_type: "NONE" });
    }
    const pair = (key, p, label) => (C[key] ? { account_code: String(C[key]), description: `${label} - ${narration.replace(" Payroll", "")}`, amount: Number(fromPence(p)), tax_type: "NONE" } : (cIssues.push(`no account set for ${DESCRIBE[key]}`), null));
    lines.push(pair("capdev_credit", -capTotal, "Capitalised Development"));
    lines.push(pair("recharge_cost", capTotal, "Interco Payroll Recharge"));
    lines.push(pair("recharge_ic", -capTotal, "Interco Payroll Recharge"));
    // The other company's side of the recharge, where the client has one.
    const other = C.other_recharge_ic ? [pair("other_recharge_ic", capTotal, "Interco Payroll Recharge"), pair("other_recharge_cost", -capTotal, "Interco Payroll Recharge")] : [];
    capdev = {
      entity: settings?.payroll_entity, date, narration: `${narration.replace(" Payroll", "")} Capitalised Development`,
      lines: lines.filter(Boolean), other: other.filter(Boolean), other_entity: settings?.contracted_entity,
      by_project: Object.fromEntries(Object.entries(byProject).map(([p, v]) => [p, Number(fromPence(v))])), issues: cIssues,
    };
  }

  const journals = [payroll, contracted].filter(Boolean);
  return {
    journals, capdev,
    issues: [...issues, ...allocIssues, ...journals.flatMap((j) => j.issues), ...(capdev?.issues ?? [])],
  };
}

// Last month's percentages proposed for this month: the same people, the same
// shares; a new employee starts at nil, someone who left drops out.
function carryForward(previous, employees) {
  return Object.fromEntries(employees.map((e) => [e.emp_code, { ...(previous?.[e.emp_code] ?? {}) }]));
}

module.exports = { FIGURES, ROLES, readSalaryReport, rolesIssues, payrollJournals, carryForward, PROJECT };

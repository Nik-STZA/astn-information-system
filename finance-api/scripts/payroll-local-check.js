// Payroll end to end (migration 065): the real server.js on a real, local,
// throwaway Postgres, with Secret Manager faked and every outside host blocked.
// The salary report is made up (Sample Ltd).
//
// Not part of `npm test`. To run:
//   1. A scratch cluster on port 54329, database t, migrations through 065.
//   2. node scripts/payroll-local-check.js        (or `serve` for the screens, on 8788)

const Module = require("module");
const FAKE_SM = "export class SecretManagerServiceClient { async accessSecretVersion() { return [{ payload: { data: Buffer.from('x') } }]; } async addSecretVersion() { return [{}]; } async listSecretVersions() { return [[]]; } async getSecret() { return [{}]; } }";
Module.registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@google-cloud/secret-manager") return { url: `data:text/javascript,${encodeURIComponent(FAKE_SM)}`, shortCircuit: true, format: "module" };
    return next(spec, ctx);
  },
});
if (process.env.DB_HOST && process.env.DB_HOST !== "127.0.0.1") throw new Error("This check runs only against a local database");
process.env.DB_HOST = "127.0.0.1";
Object.assign(process.env, { FINANCE_API_KEY: "k", DB_PORT: process.env.DB_PORT || "54329", DB_USER: process.env.DB_USER || "postgres", DB_NAME: "t", DB_PASSWORD: "x" });
delete process.env.PACK_ENGINE_JOB;
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  throw new Error(`blocked host ${u.hostname}`);
};
const { app, pool } = require("../server.js");

const SLUG = "sample-payroll";
const CFO = "cfo@example.com";
const FCP = "fc@example.com";
let base, CID;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : "");
};
const api = async (method, p, body, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${p}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const agentRun = async (agent) => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Payroll','running') RETURNING id", [CID, CFO, agent])).rows[0].id;

// What the browser sends: headings and rows cut to the code and the figures.
const HEAD = ["EmpCode", "Basic", "EePension(BeforeTax)", "EeeNIC", "Tax", "NetPay", "EerNIC", "ErPension", "PayBill"];
const ROWS = [HEAD,
  ["11", 5000, 250, 400, 900, 3450, 600, 300, 5000],
  ["12", 4000, 200, 300, 700, 2800, 450, 240, 4000],
  ["13", 3000, 150, 200, 400, 2250, 300, 180, 3000],
];
const SHA = (c) => c.repeat(64);
const SETTINGS = {
  payroll_entity: "alpha-ltd", contracted_entity: "beta-ltd", projects: ["P1", "P2"],
  drive_id: "0AExampleDrive", drive_path: ["Sample Ltd", "Payroll", "{yymm}"],
  accounts: {
    payroll: { directors_salary: "478", direct_salary: "477", ic_salary: "641", bonus: "484", er_nic_direct: "479", er_nic_ic: "641",
      er_pension_direct: "482", er_pension_ic: "641", paye: "825", net_pay: "814", pensions: "858", directors_net: "835" },
    contracted: { c_salary: "477", c_bonus: "484", c_er_nic: "479", c_er_pension: "482", c_intercompany: "621" },
    capdev: { capdev: "789", capdev_credit: "464", recharge_cost: "481", recharge_ic: "641", other_recharge_ic: "621", other_recharge_cost: "481" },
  },
};

async function setup() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Financial Controller')", [CID, CFO, FCP]);
  for (const [s, n] of [["alpha-ltd", "Alpha Ltd"], ["beta-ltd", "Beta Ltd"]]) {
    await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,$2,$3,$4)", [CID, s, n, JSON.stringify({ tenant_id: `t-${s}`, tenant_name: n })]);
  }
}

async function scenario() {
  await setup();
  const P = "2026-10";

  console.log("settings and roles");
  let r = await api("GET", `payroll?period=${P}`);
  ok("an empty month says so", r.status === 200 && r.body.settings === null && r.body.run === null, r.body);
  r = await api("PUT", "payroll/settings", SETTINGS, { "X-Actor-Email": FCP });
  ok("only the CFO sets the settings", r.status === 403, r);
  r = await api("PUT", "payroll/settings", { ...SETTINGS, payroll_entity: "nope" });
  ok("an unknown company is refused", r.status === 422, r);
  r = await api("PUT", "payroll/settings", SETTINGS);
  ok("the CFO sets them", r.status === 200, r);
  r = await api("PUT", "payroll/roles", { roles: { 11: "director", 12: "boss" } });
  ok("a role that is not one of the three is refused", r.status === 422, r);
  r = await api("PUT", "payroll/roles", { roles: { 11: "director", 12: "direct" } });
  ok("the CFO sets two roles", r.status === 200 && r.body.changed === 2, r);

  console.log("upload");
  const up = (rows, extra = {}) => api("POST", "payroll/runs", { period: P, pay_date: "2026-10-23", source_name: "Salary report M07.xlsx", source_sha256: SHA("a"), rows, ...extra });
  r = await up([[...HEAD, "Surname"], ...ROWS.slice(1).map((x) => [...x, "BLOGGS"])]);
  ok("a column that is not a figure is refused, and not echoed back", r.status === 422 && /refused/.test(r.body.issues?.[0]) && !JSON.stringify(r.body).includes("BLOGGS"), r);
  r = await up([HEAD, ["11", "Jo Bloggs, 1 Example Street, Anytown", 1, 1, 1, 1, 1, 1, 1]]);
  ok("a cell with words in it is refused", r.status === 422, r);
  r = await up(ROWS, { pay_date: "2026-11-01" });
  ok("a pay date outside the month is refused", r.status === 422, r);
  const fpaRun = await agentRun("fm1");
  r = await up(ROWS, {});
  ok("a person uploads the report", r.status === 201 && r.body.employees === 3 && r.body.missing.includes("Bonus Pensionable"), r);
  const runId = r.body.id;
  r = await up(ROWS);
  ok("the same file again changes nothing", r.status === 200 && r.body.unchanged === true && r.body.id === runId, r);
  r = await api("POST", "payroll/runs", { period: P, pay_date: "2026-10-23", source_name: "x.xlsx", source_sha256: SHA("b"), rows: ROWS }, { "X-Work-Via": `agent:fm1:${fpaRun}` });
  ok("an agent cannot upload", r.status === 403, r);

  r = await api("GET", `payroll?period=${P}`);
  ok("the month shows the code without a role", r.body.run?.no_role?.join() === "13", r.body.run);
  ok("and stores no names", !JSON.stringify(r.body).match(/Bloggs|Surname/i), null);
  ok("the folder is the month's", r.body.settings.folder === "Sample Ltd / Payroll / 2610", r.body.settings);
  r = await api("POST", `payroll/runs/${runId}/propose`);
  ok("journals wait for the roles", r.status === 422, r);
  await api("PUT", "payroll/roles", { roles: { 13: "intercompany" } });
  r = await api("POST", `payroll/runs/${runId}/propose`);
  ok("and for the shares to be confirmed", r.status === 422 && /confirm/.test(r.body.issues?.[0]), r);

  console.log("shares");
  r = await api("POST", `payroll/runs/${runId}/alloc`, { alloc: { 11: { P1: 80, P9: 30 } } });
  ok("an unknown project or over 100% is refused", r.status === 422 && r.body.issues.length === 2, r);
  r = await api("POST", `payroll/runs/${runId}/alloc`, { alloc: { 11: { P1: 50 } } }, { "X-Actor-Email": FCP });
  ok("only the CFO confirms the shares", r.status === 403, r);
  r = await api("POST", `payroll/runs/${runId}/alloc`, { alloc: { 11: { P1: 50 }, 12: { P1: 25, P2: 25 } } });
  ok("the CFO confirms them", r.status === 200, r);

  console.log("journals");
  r = await api("GET", `payroll?period=${P}`);
  const kinds = r.body.run.preview.journals.map((j) => `${j.kind}:${j.entity}`);
  ok("four journals in preview", kinds.join() === "payroll:alpha-ltd,contracted:beta-ltd,capdev:alpha-ltd,capdev_other:beta-ltd", kinds);
  ok("with no issues", r.body.run.preview.issues.length === 0, r.body.run.preview.issues);
  const fm1 = await agentRun("fm1");
  r = await api("POST", `payroll/runs/${runId}/propose`, {}, { "X-Work-Via": `agent:fm1:${fm1}` });
  ok("FM1 proposes them", r.status === 201 && r.body.proposed.length === 4, r);
  r = await api("POST", `payroll/runs/${runId}/propose`);
  ok("proposing again adds nothing", r.status === 200 && r.body.proposed.length === 0, r);
  const js = (await pool.query("SELECT payroll_kind, state, lines, proposed_by FROM finance.journals WHERE payroll_run_id = $1 ORDER BY jnl_no", [runId])).rows;
  ok("they sit on the Journals page as proposed, by FM1", js.length === 4 && js.every((j) => j.state === "proposed" && j.proposed_by === "agent:fm1"), js.map((j) => [j.payroll_kind, j.state, j.proposed_by]));
  const sum = (lines) => Math.round(lines.reduce((a, l) => a + l.amount * 100, 0));
  ok("every one balances", js.every((j) => sum(j.lines) === 0), js.map((j) => sum(j.lines)));

  console.log("replacing the report");
  r = await api("POST", `payroll/runs/${runId}/alloc`, { alloc: { 11: { P1: 40 } } });
  ok("shares cannot change under a proposed capitalisation journal", r.status === 409, r);
  r = await up(ROWS.map((x, i) => (i === 1 ? ["11", 5100, 250, 400, 900, 3550, 600, 300, 5100] : x)), { source_sha256: SHA("c") });
  ok("a corrected report replaces it", r.status === 201 && r.body.replaced === true, r);
  const newRun = r.body.id;
  const old = (await pool.query("SELECT state, rejected_by FROM finance.journals WHERE payroll_run_id = $1", [runId])).rows;
  ok("the old proposals are closed by the platform", old.every((j) => j.state === "rejected" && j.rejected_by === "platform:payroll"), old);
  r = await api("GET", `payroll?period=${P}`);
  ok("the shares carry forward, unconfirmed", r.body.run.id === newRun && r.body.run.alloc["12"]?.P2 === 25 && !r.body.run.alloc_confirmed_at, r.body.run);
  r = await api("POST", `payroll/runs/${newRun}/alloc`, {});
  ok("the CFO confirms the carried-forward shares as they are", r.status === 200, r);
  r = await api("POST", `payroll/runs/${newRun}/propose`);
  ok("the corrected month's journals are proposed", r.status === 201 && r.body.proposed.length === 4, r);
  await pool.query("UPDATE finance.journals SET state = 'approved', approved_by = $2, approved_at = now() WHERE payroll_run_id = $1 AND payroll_kind = 'payroll'", [newRun, CFO]);
  r = await up(ROWS, { source_sha256: SHA("d") });
  ok("an approved journal blocks a replacement", r.status === 409, r);

  console.log("next month");
  r = await api("POST", "payroll/runs", { period: "2026-11", pay_date: "2026-11-23", source_name: "Salary report M08.xlsx", source_sha256: SHA("e"),
    rows: [...ROWS.slice(0, 3), ["14", 2000, 100, 100, 200, 1600, 150, 60, 2000]] });
  ok("November uploads", r.status === 201, r);
  r = await api("GET", "payroll?period=2026-11");
  ok("October's shares carry forward; the leaver drops, the starter is nil", JSON.stringify(r.body.run.alloc) === JSON.stringify({ 11: { P1: 50 }, 12: { P1: 25, P2: 25 }, 14: {} }), r.body.run.alloc);
  ok("the starter has no role yet", r.body.run.no_role.join() === "14", r.body.run.no_role);

  console.log("working file");
  r = await api("POST", `payroll/runs/${newRun}/workbook`);
  ok("without the pack engine configured it says so", r.status === 503, r);
  r = await api("GET", `payroll/runs/${newRun}/workbook-data`);
  ok("the pack engine gets codes, roles and journals", r.status === 200 && r.body.yymm === "2610" && r.body.employees[0].role === "director" && r.body.journals.length === 4 && r.body.drive.path.join("/") === "Sample Ltd/Payroll/2610", r.body);
  r = await api("POST", `payroll/runs/${newRun}/workbook-saved`, { file_id: "1AbcdefGhijkLmnop", name: "Payroll workings - 2610.xlsx", link: "https://drive.google.com/file/d/1AbcdefGhijkLmnop" });
  ok("and reports the file back", r.status === 200, r);
  r = await api("GET", `payroll?period=${P}`);
  ok("the page shows the link", r.body.run.workbook.link?.startsWith("https://drive.google.com/"), r.body.run.workbook);

  const audits = (await pool.query("SELECT action FROM finance.audit_log WHERE client_id = $1 ORDER BY occurred_at", [CID])).rows.map((x) => x.action);
  for (const a of ["payroll_settings_set", "payroll_roles_set", "payroll_uploaded", "payroll_alloc_confirmed", "journal_proposed", "payroll_workbook_saved"]) ok(`audited: ${a}`, audits.includes(a), audits);
}

async function serve() {
  const server = app.listen(8788, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:8788";
  await setup();
  await api("PUT", "payroll/settings", SETTINGS);
  await api("PUT", "payroll/roles", { roles: { 11: "director", 12: "direct" } });
  const r = await api("POST", "payroll/runs", { period: "2026-09", pay_date: "2026-09-23", source_name: "Salary report M06.xlsx", source_sha256: SHA("f"), rows: ROWS });
  await api("PUT", "payroll/roles", { roles: { 13: "intercompany" } });
  await api("POST", `payroll/runs/${r.body.id}/alloc`, { alloc: { 11: { P1: 50 }, 12: { P1: 25, P2: 25 } } });
  console.log("serving on 8788");
}

if (process.argv.includes("serve")) serve();
else (async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  try { await scenario(); } catch (e) { failures.push("threw"); console.log("  FAIL threw:", e.stack); }
  finally { server.close(); await pool.end(); }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exitCode = 1; }
})();

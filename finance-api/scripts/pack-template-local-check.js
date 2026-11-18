// Management pack templates, end to end: the real server.js on a real, local,
// throwaway Postgres, with Secret Manager faked and every other network host
// blocked.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. A scratch cluster with database t and migrations applied up to 055.
//   2. DB_PORT=<port> node scripts/pack-template-local-check.js   (from finance-api)

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
Object.assign(process.env, {
  FINANCE_API_KEY: "k", DB_PORT: process.env.DB_PORT || "54329", DB_USER: process.env.DB_USER || "postgres", DB_NAME: "t", DB_PASSWORD: "x",
});

const SLUG = "sample-templates";
const CFO = "cfo@example.com";
const FM = "fm@example.com";

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  throw new Error(`blocked host ${u.hostname}`);
};
process.env.XERO_READS_PER_MINUTE = "100000";
const { app, pool } = require("../server.js");

let base;
let CID;
let ENTITY;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : "");
};
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: threw`); console.log("  FAIL", name, "threw:", e.stack); }
}
const call = async (method, path, body, headers = {}) => {
  const r = await realFetch(`${base}${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const api = (method, path, body, headers) => call(method, `/api/finance/clients/${SLUG}/${path}`, body, headers);

async function seed() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'), ($1,$3,'Finance Manager')", [CID, CFO, FM]);
  ENTITY = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-ltd','Alpha Ltd','{}') RETURNING id", [CID])).rows[0].id;
}

const mapTo = (account, category) => pool.query(
  `INSERT INTO finance.account_mappings (client_id, entity_id, xero_account_id, account_code, account_name, account_class, category_key, status, source, proposed_by_email)
   VALUES ($1,$2,$3,$3,$3,'EXPENSE',$4,'proposed','manual',$5)`, [CID, ENTITY, account, category, CFO]);

async function scenario() {
  await seed();

  await section("the default", async () => {
    const r = await api("GET", "pack-template");
    ok("a new client starts on standard management, three templates offered", r.status === 200 && r.body.current === "standard_management"
      && r.body.templates.map((t) => t.key).join(",") === "standard_management,standard_statutory,feldspar_management", r.body);
    const m = await api("GET", "entities/alpha-ltd/account-mapping");
    ok("the pack is told the layout: EBITDA on, standard labels", m.status === 200 && m.body.layout.template === "standard_management"
      && m.body.layout.ebitda === true && m.body.layout.labels.total_overheads === "Total overheads", m.body.layout);
    ok("and the standard categories only", !m.body.categories.some((c) => c.key === "marketing")
      && m.body.categories.find((c) => c.key === "turnover").label === "Turnover", m.body.categories);
  });

  await section("who may choose", async () => {
    let r = await api("PUT", "pack-template", { template: "standard_statutory" }, { "X-Actor-Email": FM });
    ok("a finance manager cannot choose the template", r.status === 403, r.body);
    r = await api("PUT", "pack-template", { template: "nope" });
    ok("an unknown template is refused", r.status === 422, r.body);
  });

  await section("a template with its own lines", async () => {
    let r = await api("PUT", "pack-template", { template: "feldspar_management" });
    ok("the CFO chooses one", r.status === 200 && r.body.current === "feldspar_management" && r.body.layout.sublineOrder.it_costs.length === 5, r.body);
    const cats = await api("GET", "reporting-categories");
    const byKey = Object.fromEntries(cats.body.data.map((c) => [c.key, c]));
    ok("its lines appear, marked as the template's", byKey.marketing?.scope === "template" && byKey.turnover.label === "Revenue"
      && byKey.turnover.scope === "template" && byKey.depreciation.scope === "standard", byKey);

    r = await api("PUT", "reporting-categories/marketing", { label: "Marketing & PR" });
    ok("the client can still rename a template line", r.status === 200 && r.body.label === "Marketing & PR" && r.body.scope === "override", r.body);
    r = await api("DELETE", "reporting-categories/marketing");
    ok("and reset it to the template's", r.status === 200 && r.body.reset === true, r.body);
    const after = await api("GET", "reporting-categories");
    ok("the template's label is back", after.body.data.find((c) => c.key === "marketing").label === "Marketing", after.body);

    await mapTo("acc-mkt", "marketing");
    r = await api("PUT", "pack-template", { template: "standard_management" });
    ok("moving to a template without a line accounts use is refused, naming it", r.status === 409 && /marketing \(1 account/.test(r.body.error), r.body);
    r = await api("PUT", "reporting-categories/marketing", { label: "Marketing", statement: "pnl", section: "overheads", sortOrder: 30, cashFlow: null, active: true });
    ok("the client keeps the line as its own", r.status === 200, r.body);
    r = await api("PUT", "pack-template", { template: "standard_statutory" });
    ok("and then can move", r.status === 200 && r.body.layout.ebitda === false && r.body.layout.labels.total_overheads === "Total administrative expenses", r.body);
    const g = await api("GET", "pack-template");
    ok("its own lines are listed for the picker", g.body.current === "standard_statutory" && g.body.ownLines.some((l) => l.key === "marketing"), g.body);
  });

  await section("audit", async () => {
    const rows = (await pool.query("SELECT payload FROM finance.audit_log WHERE client_id = $1 AND action = 'set_pack_template' ORDER BY occurred_at, id", [CID])).rows;
    ok("each choice is audited with before and after", rows.length === 2 && rows[0].payload.before === "standard_management"
      && rows[1].payload.after === "standard_statutory", rows);
  });
}

const server = app.listen(0, "127.0.0.1", async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await scenario();
  } finally {
    console.log(`\n${pass} passed, ${failures.length} failed`);
    if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
    server.close();
    await pool.end();
    process.exit(failures.length ? 1 : 0);
  }
});

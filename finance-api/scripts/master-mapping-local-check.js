// Master mapping file upload, end to end: the real server.js routes on a real,
// local, throwaway Postgres, with Xero and Secret Manager faked inside this
// process. Any other network host throws. Proves the routes never write to Xero.
//
// Not part of `npm test`, because it needs Postgres. A scratch cluster on port
// 54329, database t, migrations applied up to 055; then from finance-api:
//   node scripts/master-mapping-local-check.js

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

const SLUG = "sample-master";
const CFO = "cfo@example.com";
const FM = "fm@example.com";
const ACCOUNTS = {
  "tenant-a": [
    { AccountID: "a-400", Code: "400", Name: "Advertising & Marketing", Class: "EXPENSE", Type: "OVERHEADS", Status: "ACTIVE" },
    { AccountID: "a-422", Code: "422", Name: "Website costs", Class: "EXPENSE", Type: "OVERHEADS", Status: "ACTIVE" },
    { AccountID: "a-738", Code: "738", Name: "Performance surface", Class: "ASSET", Type: "FIXED", Status: "ACTIVE" },
  ],
  "tenant-b": [
    { AccountID: "b-422", Code: "422", Name: "Website costs", Class: "EXPENSE", Type: "OVERHEADS", Status: "ACTIVE" },
    { AccountID: "b-500", Code: "500", Name: "Renamed in Xero", Class: "EXPENSE", Type: "OVERHEADS", Status: "ACTIVE" },
  ],
};
const HEAD = ["Lookup", "*Code", "*Name", "*Type", "P&L Mapping 1", "P&L Mapping 2", "BS Mapping"];
const TABLE = [
  ["Sample Group master"], HEAD,
  ["400 - Advertising & Marketing", "400", "Advertising & Marketing", "Overhead", "Marketing", "Advertising", ""],
  ["422 - Website costs", "422", "Website costs", "Overhead", "IT Costs", "Website", ""],
  ["738 - Performance surface", "738", "Performance surface", "Fixed Asset", "", "", "Software"],
  ["500 - Old name", "500", "Old name", "Overhead", "Marketing", "", ""],
  ["999 - Gone", "999", "Gone", "Overhead", "Marketing", "", ""],
];

let nonGet = 0;
const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") { nonGet += 1; return json({}, 500); }
  const tenant = new Headers(opts.headers).get("xero-tenant-id");
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: ACCOUNTS[tenant] ?? [] });
  return json({}, 404);
};
process.env.XERO_READS_PER_MINUTE = "100000";
const { app, pool } = require("../server.js");

let base;
let CID;
const ENT = {};
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : "");
};
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: threw`); console.log("  FAIL", name, "threw:", e.stack); }
}
const api = async (path, body, actor = CFO) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, {
    method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": actor, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const mapping = async (entity, account) => (await pool.query(
  "SELECT category_key, subline, status, source, reason, approved_by_email FROM finance.account_mappings WHERE entity_id = $1 AND xero_account_id = $2",
  [ENT[entity], account])).rows[0];

async function seed() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name, pack_template) VALUES ($1,'Sample Group','feldspar_management') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'), ($1,$3,'Finance Manager')", [CID, CFO, FM]);
  for (const [slug, name, tenant] of [["alpha-ltd", "Alpha Ltd", "tenant-a"], ["beta-ltd", "Beta Ltd", "tenant-b"]]) {
    ENT[slug] = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,$2,$3,$4) RETURNING id",
      [CID, slug, name, JSON.stringify({ tenant_id: tenant, tenant_name: name })])).rows[0].id;
  }
  // Alpha 400 approved on the wrong line; 738 tangible by the CFO's ruling.
  for (const [acc, code, name, klass, cat] of [["a-400", "400", "Advertising & Marketing", "EXPENSE", "administrative"], ["a-738", "738", "Performance surface", "ASSET", "tangible_assets"]]) {
    await pool.query(
      `INSERT INTO finance.account_mappings (client_id, entity_id, xero_account_id, account_code, account_name, account_class, category_key, status, source, proposed_by_email, approved_by_email, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved','manual',$8,$8,now())`, [CID, ENT["alpha-ltd"], acc, code, name, klass, cat, CFO]);
  }
}

async function scenario() {
  await seed();
  const body = { fileName: "Sample master 18 Nov.xlsx", table: TABLE };
  let plan;

  await section("preview", async () => {
    const r = await api("coa-mapping-master/preview", body);
    plan = r.body;
    const a = plan.entities?.find((e) => e.slug === "alpha-ltd");
    const b = plan.entities?.find((e) => e.slug === "beta-ltd");
    ok("plans every company", r.status === 200 && plan.entities.length === 2 && plan.template === "feldspar_management", r.body);
    ok("moves alpha 400 to Marketing > Advertising", a.changes.some((c) => c.accountId === "a-400" && c.to.category === "marketing" && c.to.subline === "Advertising" && c.kind === "category"), a);
    ok("proposes 738 to intangible, as the file says", a.changes.some((c) => c.accountId === "a-738" && c.to.category === "intangible_assets"), a);
    ok("new mappings for 422 in both companies", a.changes.some((c) => c.accountId === "a-422" && c.kind === "new") && b.changes.some((c) => c.accountId === "b-422"), b);
    ok("a renamed account is reported, not changed", b.nameDiffers.length === 1 && b.nameDiffers[0].xeroName === "Renamed in Xero" && !b.changes.some((c) => c.accountId === "b-500"), b);
    ok("a row no company has is reported", plan.unmatched.length === 1 && plan.unmatched[0].code === "999", plan.unmatched);
    const saved = (await pool.query("SELECT count(*)::int AS n FROM finance.account_mappings WHERE client_id = $1", [CID])).rows[0].n;
    ok("preview saves nothing", saved === 2, saved);
  });

  await section("who may apply", async () => {
    let r = await api("coa-mapping-master/apply", { ...body, approve: true }, FM);
    ok("a finance manager cannot approve a master file", r.status === 403, r.body);
    r = await api("coa-mapping-master/apply", { ...body, approve: true }, "someone@example.com");
    ok("someone with no role cannot apply", r.status === 403, r.body);
  });

  await section("apply", async () => {
    const r = await api("coa-mapping-master/apply", { ...body, approve: true, exclude: ["alpha-ltd:a-738"] });
    ok("the CFO applies, less what was unticked", r.status === 200 && r.body.excluded === 1
      && r.body.saved.find((s) => s.entity === "alpha-ltd").saved === 2 && r.body.saved.find((s) => s.entity === "beta-ltd").saved === 1, r.body);
    const m400 = await mapping("alpha-ltd", "a-400");
    ok("400 is on Marketing > Advertising, approved, from the file", m400.category_key === "marketing" && m400.subline === "Advertising"
      && m400.status === "approved" && m400.source === "upload" && /Sample master 18 Nov\.xlsx/.test(m400.reason) && m400.approved_by_email === CFO, m400);
    const m738 = await mapping("alpha-ltd", "a-738");
    ok("the unticked 738 is untouched", m738.category_key === "tangible_assets" && m738.source === "manual", m738);
    const b422 = await mapping("beta-ltd", "b-422");
    ok("beta 422 is on IT Costs > Website", b422.category_key === "it_costs" && b422.subline === "Website", b422);
    const again = await api("coa-mapping-master/preview", body);
    const a = again.body.entities.find((e) => e.slug === "alpha-ltd");
    ok("a second preview shows only what was unticked", a.changes.length === 1 && a.changes[0].accountId === "a-738", a.changes);
    const audits = (await pool.query("SELECT payload FROM finance.audit_log WHERE client_id = $1 AND action = 'map_accounts' ORDER BY occurred_at", [CID])).rows;
    ok("each company's save is audited, with the file named", audits.length === 2 && audits.every((x) => x.payload.source === "upload" && x.payload.note === "Sample master 18 Nov.xlsx"), audits);
  });

  await section("bad files", async () => {
    let r = await api("coa-mapping-master/preview", { fileName: "x.csv", table: [["a", "b"], ["1", "2"]] });
    ok("a file without mapping columns is refused", r.status === 422 && /No header row/.test(r.body.error), r.body);
    r = await api("coa-mapping-master/preview", { table: TABLE });
    ok("the file name is required", r.status === 422, r.body);
  });

  ok("never writes to Xero", nonGet === 0, nonGet);
}

const server = app.listen(0, "127.0.0.1", async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await scenario();
  } finally {
    console.log(`\n${pass} passed, ${failures.length} failed`);
    if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
    server.close();
    await new Promise((r) => setTimeout(r, 1000));
    await pool.end();
    process.exit(failures.length ? 1 : 0);
  }
});

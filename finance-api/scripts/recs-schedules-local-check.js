// Refreshing a month's balances does the schedule work itself (19 Nov 2026):
// evidence kept in os.stza.io (the accruals schedule here) is taken onto the
// rec without anyone pressing Fetch, and an open reconciling item on last
// month's rec comes onto this month's until a person clears it. The real
// server.js on a local throwaway Postgres; Xero and Secret Manager faked; any
// other host throws. Sample data only.
//
// Not part of `npm test`. To run:
//   1. A scratch cluster on port 54329, database t, migrations through 067.
//   2. node scripts/recs-schedules-local-check.js      (from finance-api)

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
Object.assign(process.env, { FINANCE_API_KEY: "k", DB_PORT: process.env.DB_PORT || "54329", DB_USER: process.env.DB_USER || "postgres", DB_NAME: "t", DB_PASSWORD: "x", XERO_READS_PER_MINUTE: "100000" });

const row = (id, name, code, dr, cr, ydr, ycr) => ({ RowType: "Row", Cells: [
  { Value: `${name} (${code})`, Attributes: [{ Id: "account", Value: id }] }, { Value: String(dr) }, { Value: String(cr) }, { Value: String(ydr) }, { Value: String(ycr) }] });
const CHART = [
  { AccountID: "a-acc", Code: "805", Name: "Accruals", Class: "LIABILITY", Type: "CURRLIAB", Status: "ACTIVE" },
  { AccountID: "a-cap", Code: "950", Name: "Capital - Ordinary Shares", Class: "EQUITY", Type: "EQUITY", Status: "ACTIVE" },
];
const tb = (accrued) => [row("a-acc", "Accruals", "805", 0, 0, 0, accrued), row("a-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 100)];
const TBS = { "2026-09-30": tb(750), "2026-10-31": tb(750), "2026-11-30": tb(750), "2026-12-31": tb(750) };

const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") throw new Error("only reads");
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: CHART });
  if (u.pathname.endsWith("/Reports/TrialBalance")) return json({ Reports: [{ Rows: [{ RowType: "Section", Rows: TBS[u.searchParams.get("date")] ?? [] }] }] });
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ BaseCurrency: "GBP" }] });
  return json({}, 404);
};
const { app, pool } = require("../server.js");

const SLUG = "sample-schedules";
const CFO = "cfo@example.com";
let base, CID, EA;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : "");
};
const api = async (method, path, body) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const accrualsRec = async (period) => (await api("GET", `recs?period=${period}`)).body.recs.find((r) => r.account_name === "Accruals");

async function scenario() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO')", [CID, CFO]);
  EA = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-ltd','Alpha Ltd',$2) RETURNING id",
    [CID, JSON.stringify({ tenant_id: "tenant-a", tenant_name: "Alpha Ltd" })])).rows[0].id;
  await pool.query(
    `INSERT INTO finance.accrual_items (client_id, entity_id, supplier, lines, amount, period_from, standing, created_by)
     VALUES ($1,$2,'Sample Supplier Ltd',$3,750,'2026-07',true,$4)`, [CID, EA, JSON.stringify([{ account_code: "412", amount: 750, description: "Monthly services" }]), CFO]);

  console.log("refresh takes the accruals schedule");
  let r = await api("POST", "recs/compose", { period: "2026-10" });
  ok("October refreshes", r.status === 200, r);
  ok("and says it took the schedule for Accruals", r.body.evidence?.some((e) => e.account === "Accruals" && e.ok && e.fetched === 1), r.body);
  const oct = await accrualsRec("2026-10");
  const ev = (await pool.query("SELECT amount::text, method, source FROM finance.rec_evidence WHERE rec_id = $1", [oct.id])).rows;
  ok("the Accruals rec holds the schedule, fetched, not keyed", ev.length === 1 && ev[0].method === "accrual_schedule" && ev[0].amount === "-750.00" && /Sample Supplier Ltd/.test(ev[0].source), ev);
  ok("and ties without anyone pressing Fetch", oct.ties === true, oct);
  r = await api("POST", "recs/compose", { period: "2026-10" });
  const again = (await pool.query("SELECT count(*)::int AS n FROM finance.rec_evidence WHERE rec_id = $1", [oct.id])).rows[0].n;
  ok("refreshing again replaces it rather than adding a second", again === 1, again);

  console.log("open reconciling items carry forward");
  r = await api("POST", `recs/${oct.id}/reconciling`, { entity_id: EA, side: "xero_only", kind: "timing", amount: 543, description: "Late claim held for the next return" });
  ok("an item is recorded on October", r.status === 201, r);
  const itemId = r.body.id;
  r = await api("POST", "recs/compose", { period: "2026-11" });
  ok("November refreshes and says one item was carried", r.status === 200 && r.body.carried === 1, r.body);
  const nov = await accrualsRec("2026-11");
  let carried = (await pool.query("SELECT id, source, carried_from, amount::text, kind, note FROM finance.rec_reconciling_items WHERE rec_id = $1", [nov.id])).rows;
  ok("November holds it, carried from October's", carried.length === 1 && carried[0].source === "carried" && carried[0].carried_from === itemId && carried[0].amount === "543.00" && /Carried from October 2026/.test(carried[0].note), carried);
  r = await api("POST", "recs/compose", { period: "2026-11" });
  carried = (await pool.query("SELECT id FROM finance.rec_reconciling_items WHERE rec_id = $1", [nov.id])).rows;
  ok("refreshing November again carries it once only", r.body.carried === 0 && carried.length === 1, { carried: r.body.carried, n: carried.length });
  r = await api("DELETE", `recs/${nov.id}/reconciling/${carried[0].id}`);
  ok("a carried item cannot be deleted, only cleared", r.status === 409 && /carried from last month/.test(r.body.error), r);
  r = await api("PATCH", `recs/${nov.id}/reconciling/${carried[0].id}`, { state: "cleared", cleared_note: "Claimed on the November return" });
  ok("it is cleared in November with a note", r.status === 200, r);
  r = await api("POST", "recs/compose", { period: "2026-12" });
  const dec = await accrualsRec("2026-12");
  const decItems = (await pool.query("SELECT count(*)::int AS n FROM finance.rec_reconciling_items WHERE rec_id = $1", [dec.id])).rows[0].n;
  ok("once cleared it stops: December has nothing carried", r.body.carried === 0 && decItems === 0, { carried: r.body.carried, decItems });

  console.log("a rec past preparation is left alone");
  await pool.query("UPDATE finance.recs SET status = 'with_cfo' WHERE id = $1", [dec.id]);
  await pool.query("DELETE FROM finance.rec_evidence WHERE rec_id = $1", [dec.id]);
  r = await api("POST", "recs/compose", { period: "2026-12" });
  const decEv = (await pool.query("SELECT count(*)::int AS n FROM finance.rec_evidence WHERE rec_id = $1", [dec.id])).rows[0].n;
  ok("a rec with the CFO is not changed by a refresh", decEv === 0 && !r.body.evidence?.some((e) => e.rec_id === dec.id), r.body.evidence);
}

(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((res) => server.once("listening", res));
  base = `http://127.0.0.1:${server.address().port}`;
  try { await scenario(); } catch (e) { failures.push("threw"); console.log("  FAIL threw:", e.stack); }
  finally { server.close(); await pool.end(); }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exitCode = 1; }
})();

// Pack commentary end to end (migration 063): the real server.js on a real,
// local, throwaway Postgres, with Secret Manager faked and every outside host
// blocked.
//
// Not part of `npm test`. To run:
//   1. A scratch cluster on port 54329, database t, migrations through 063.
//   2. node scripts/pack-commentary-local-check.js [highlights.json]
//      A client's own highlights file stays on this machine; without one a
//      small sample is used.

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
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  throw new Error(`blocked host ${u.hostname}`);
};
const fs = require("fs");
const { app, pool } = require("../server.js");

const SAMPLE = {
  period_label: "October 2026",
  commentary: "Notably, the loss widened by GBP 24.0k.",
  kpis: [{ label: "Cash", value: 125000, note: "Down on September." }],
  compliance: [{ item: "Bank reconciliations", status: "GREEN", detail: "All signed." }],
  risks: [{ title: "Funding", description: "Next drawdown due in January." }],
};
const fromFile = process.argv.slice(2).find((a) => a.endsWith(".json"));
const H = fromFile ? JSON.parse(fs.readFileSync(fromFile, "utf8")) : SAMPLE;
const SLUG = "sample-commentary";
const CFO = "cfo@example.com";
const FCP = "fc@example.com";
let base, CID;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : "");
};
const api = async (method, p, body, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${p}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const run = async (agent) => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Commentary','running') RETURNING id", [CID, CFO, agent])).rows[0].id;

async function scenario() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Financial Controller')", [CID, CFO, FCP]);
  const P = "2026-10";

  console.log("drafting");
  let r = await api("GET", `commentary?period=${P}`);
  ok("an empty month says so", r.status === 200 && r.body.highlights === null && r.body.pack.ready === false, r.body);
  r = await api("GET", `commentary/${P}/files`);
  ok("the pack gets nothing yet", r.status === 404, r);
  const fpa = await run("fpa");
  r = await api("POST", "commentary/import", { period: P, kind: "highlights", content: H, note: "First draft" }, { "X-Work-Via": `agent:fpa:${fpa}` });
  ok("FP&A loads the month's highlights", r.status === 201 && r.body.version === 1, r);
  const ap = await run("ap-clerk");
  r = await api("POST", "commentary/import", { period: P, kind: "highlights", content: H }, { "X-Work-Via": `agent:ap-clerk:${ap}` });
  ok("the AP Clerk cannot", r.status === 403, r);
  r = await api("POST", "commentary/import", { period: P, kind: "highlights", content: { pnl_trend: [] } });
  ok("a dashboard file sent as highlights is refused", r.status === 422, r);
  r = await api("POST", "commentary/import", { period: P, kind: "dashboard", content: { pnl_trend: [["Oct", 1, 2, 3]] } });
  ok("a person loads the dashboard", r.status === 201, r);

  const view = await api("GET", `commentary?period=${P}`);
  const fields = view.body.highlights.sections.flatMap((s) => s.fields);
  ok("the page lists the text fields by section", fields.length > 0 && fields.some((f) => f.path === "commentary"), view.body.highlights.sections.map((s) => s.key));
  ok("the version is kept", view.body.versions.length === 2, view.body.versions);

  console.log("editing");
  const fc = await run("fc");
  r = await api("POST", "commentary/edit", { period: P, version: 1, edits: [{ path: "commentary", text: "The loss grew in October, mainly because professional fees rose." }], note: "Rewritten to the standard" }, { "X-Work-Via": `agent:fc:${fc}` });
  ok("the FC edits the words", r.status === 200 && r.body.version === 2 && r.body.changed.length === 1, r);
  r = await api("POST", "commentary/edit", { period: P, version: 1, edits: [{ path: "commentary", text: "x" }] });
  ok("an edit on an old version is refused", r.status === 409 && r.body.version === 2, r);
  r = await api("POST", "commentary/edit", { period: P, version: 2, edits: [{ path: "kpis.0.value", text: "1" }] });
  ok("a figure cannot be edited", r.status === 422 && /figures are not edited here/.test(r.body.issues?.[0]), r);

  console.log("approving");
  r = await api("POST", "commentary/approve", { period: P }, { "X-Actor-Email": FCP });
  ok("the FC cannot approve", r.status === 403, r);
  r = await api("POST", "commentary/approve", { period: P }, { "X-Work-Via": `agent:fpa:${fpa}` });
  ok("an agent cannot approve", r.status === 403, r);
  r = await api("POST", "commentary/approve", { period: P });
  ok("the CFO approves both", r.status === 200 && r.body.approved.length === 2, r);
  r = await api("GET", `commentary/${P}/files`);
  ok("the pack now gets the approved words and figures", r.status === 200 && r.body.ready && r.body.highlights.commentary.startsWith("The loss grew") && r.body.dashboard && r.body.highlights_version === 2, r.body);

  r = await api("POST", "commentary/edit", { period: P, version: 2, edits: [{ path: "commentary", text: "The loss grew in October." }] });
  ok("changing approved words makes it a draft again", r.status === 200 && r.body.status === "draft" && r.body.was_approved === true, r);
  r = await api("GET", `commentary/${P}/files`);
  ok("and the pack waits for approval again", r.status === 404, r);
  const audits = (await pool.query("SELECT action FROM finance.audit_log WHERE client_id = $1 AND target_type = 'pack_commentary' ORDER BY occurred_at", [CID])).rows.map((x) => x.action);
  ok("every step is audited", audits.includes("pack_commentary_imported") && audits.includes("pack_commentary_edited") && audits.includes("pack_commentary_approved"), audits);
}

// serve: the month loaded as FP&A's draft, then stays up on 8788 for the screens.
async function serve() {
  const server = app.listen(8788, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:8788";
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO')", [CID, CFO]);
  const fpa = await run("fpa");
  await api("POST", "commentary/import", { period: "2026-10", kind: "highlights", content: H, note: "First draft" }, { "X-Work-Via": `agent:fpa:${fpa}` });
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

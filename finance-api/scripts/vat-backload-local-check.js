// The VAT back-load end to end (scripts/vat-backload.js): the real server.js
// on a real, local, throwaway Postgres, with Secret Manager faked and every
// outside host blocked. It reads a folder of pages saved from HMRC's VAT
// account, which stay on this machine.
//
// Not part of `npm test`. To run:
//   1. A scratch cluster on port 54329, database t, migrations through 062.
//   2. node scripts/vat-backload-local-check.js <folder of HMRC pages>

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
const { app, pool } = require("../server.js");
const { applyVatBackload } = require("./vat-backload");

const FOLDER = process.argv[2];
const SLUG = "sample-vat-backload";
const CFO = "cfo@example.com";
let base, CID;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : "");
};
const call = async (method, p, body) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${p}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const load = async (apply) => {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const said = await applyVatBackload(conn, { client: SLUG, folder: FOLDER, from: "2025-10", by: CFO, apply });
    await conn.query(apply ? "COMMIT" : "ROLLBACK");
    return said;
  } finally { conn.release(); }
};

async function scenario() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO')", [CID, CFO]);
  const rep = (await pool.query("INSERT INTO finance.entities (client_id, slug, name) VALUES ($1,'rep-ltd','Rep Ltd') RETURNING id", [CID])).rows[0].id;
  await pool.query("INSERT INTO finance.vat_registrations (client_id, vat_number, kind, representative_id, created_by) VALUES ($1,'123456789','group',$2,$3)", [CID, rep, CFO]);

  console.log("the back-load");
  const dry = await load(false);
  const n = async () => (await pool.query("SELECT count(*)::int AS n FROM finance.vat_returns WHERE client_id = $1", [CID])).rows[0].n;
  ok("a dry run writes nothing", (await n()) === 0, dry);
  const said = await load(true);
  const rows = (await pool.query(
    `SELECT v.id, v.period_start::text AS ps, v.status, v.submitted_boxes, v.history_note,
            (SELECT count(*)::int FROM finance.vat_payments p WHERE p.return_id = v.id) AS pays
       FROM finance.vat_returns v WHERE v.client_id = $1 ORDER BY v.period_start`, [CID])).rows;
  ok("ten returns from October 2025 to October 2026", rows.length === 10 && rows[0].ps === "2025-10-01", rows.map((r) => r.ps));
  const q4 = rows[0];
  ok("Oct-Dec 2025: filed, unpaid, as HMRC shows it", q4.status === "submitted" && q4.pays === 0 && Number(q4.submitted_boxes[5]) === 86837.16 && Number(q4.submitted_boxes[4]) === 90600.14, q4);
  ok("each later one paid exactly", rows.slice(1).every((r) => r.status === "paid" && r.pays === 1), rows.map((r) => [r.ps, r.status, r.pays]));
  ok("each says where it came from", rows.every((r) => /^Filed before os\.stza\.io/.test(r.history_note ?? "")));
  const again = await load(true);
  ok("again: every return kept, none added", again.filter((l) => l.startsWith("return:")).length === 0 && (await n()) === 10, again);

  console.log("the return page");
  const view = await call("GET", `vat/returns/${q4.id}`);
  ok("shows the history and no clearing", view.status === 200 && /^Filed before os\.stza\.io/.test(view.body.return?.history_note ?? "") && view.body.clearing === null, view.body.return);
  ok("expects the refund", view.body.payment?.expected === 86837.16, view.body.payment);
  const clear = await call("POST", `vat/returns/${q4.id}/clearing`, {});
  ok("refuses to propose clearing for it", clear.status === 409 && /cleared by hand/.test(clear.body.error), clear);
  ok(`(${said.length} lines said)`, true);
}

(async () => {
  if (!FOLDER) { console.error("usage: node scripts/vat-backload-local-check.js <folder of HMRC pages>"); process.exit(2); }
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  try { await scenario(); } catch (e) { failures.push("threw"); console.log("  FAIL threw:", e.stack); }
  finally { server.close(); await pool.end(); }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exitCode = 1; }
})();

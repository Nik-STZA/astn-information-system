// Run all leaves alone a rec FM1 finished on when nothing has moved since
// (lib/rec-inputs.js), end to end: the real server.js on a real, local,
// throwaway Postgres, with Secret Manager faked and every outside host
// blocked, so this cannot reach Xero or a live database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. A scratch cluster on port 54329, database t, migrations through 062.
//   2. node scripts/rec-inputs-local-check.js          (from finance-api)

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

const SLUG = "sample-rec-inputs";
const CFO = "cfo@example.com";
let base, CID, EA, REC;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : "");
};
const call = async (method, path, body, headers = {}) => {
  const r = await realFetch(`${base}${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const runAll = () => call("POST", `/api/finance/clients/${SLUG}/recs/agent-all`, { period: "2026-10" });
const queuedFor = (r) => (r.body.queued ?? []).find((q) => q.id === REC);
const skippedFor = (r) => (r.body.skipped ?? []).find((q) => q.id === REC);

async function seed() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Ltd') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO')", [CID, CFO]);
  EA = (await pool.query("INSERT INTO finance.entities (client_id, slug, name) VALUES ($1,'alpha-ltd','Alpha Ltd') RETURNING id", [CID])).rows[0].id;
  const acct = (await pool.query(
    "INSERT INTO finance.rec_accounts (client_id, account_key, account_name, line_key, proof) VALUES ($1,'assetprepayments','Prepayments','prepay','schedule') RETURNING id", [CID])).rows[0].id;
  REC = (await pool.query(
    `INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, status, line_key, owner, class, proof)
     VALUES ($1,$2,'2026-10','2026-10-31','not_started','prepay','FM1','M','schedule') RETURNING id`, [CID, acct])).rows[0].id;
  await pool.query("INSERT INTO finance.rec_balances (rec_id, entity_id, account_code, account_name, opening, closing, movement) VALUES ($1,$2,'620','Prepayments',100,250,150)", [REC, EA]);
}

// What the runner does when FM1's run on the rec ends.
async function finish(runId, status = "succeeded") {
  await pool.query("UPDATE finance.recs SET status = 'in_progress' WHERE id = $1 AND status = 'not_started'", [REC]);
  await pool.query("UPDATE finance.agent_runs SET status = 'running', started_at = now() WHERE id = $1", [runId]);
  return call("POST", `/api/finance/agent-runs/${runId}/complete`, { status, output: status === "succeeded" ? "Prepared; one item needs the CFO." : null, error: status === "failed" ? "stopped" : null });
}

async function scenario() {
  console.log("Run all and a rec FM1 already finished on");
  await seed();
  let r = await runAll();
  ok("a rec not started is run", r.status === 200 && queuedFor(r), r.body);
  const done = await finish(queuedFor(r).run_id);
  ok("the run finishes", done.status === 200, done.body);
  ok("its answer does not leak the run's rec or client", done.body.rec_id === undefined && done.body.client_id === undefined, done.body);
  const ev = (await pool.query("SELECT detail FROM finance.rec_events WHERE rec_id = $1 AND action = 'agent_finished'", [REC])).rows;
  ok("what it worked from is recorded", ev.length === 1 && /^[0-9a-f]{16}$/.test(ev[0].detail.inputs) && ev[0].detail.status === "succeeded", ev);

  r = await runAll();
  ok("Run all again: left alone, and says why", !queuedFor(r) && /nothing has moved since/.test(skippedFor(r)?.why ?? ""), r.body);

  r = await call("POST", `/api/finance/clients/${SLUG}/recs/agent-all`, { period: "2026-10", include_unchanged: true });
  ok("asked to include it: run", Boolean(queuedFor(r)), r.body);
  await finish(queuedFor(r).run_id);

  await pool.query(
    "INSERT INTO finance.thread_entries (client_id, subject_kind, subject_key, period, kind, body, author_email) VALUES ($1,'reconciliation',$2,'2026-10','note','The October bill is in now.',$3)", [CID, REC, CFO]);
  r = await runAll();
  ok("after a person's note on the thread: run", Boolean(queuedFor(r)), r.body);
  await finish(queuedFor(r).run_id);

  await pool.query(
    `INSERT INTO finance.thread_entries (client_id, subject_kind, subject_key, period, kind, body, author_email, via_agent, via_run_id)
     VALUES ($1,'reconciliation',$2::text,'2026-10','note','FM1 notes its own work.',$3,'fm1',(SELECT id FROM finance.agent_runs WHERE rec_id = $2::uuid ORDER BY queued_at DESC LIMIT 1))`, [CID, REC, CFO]);
  r = await runAll();
  ok("FM1's own note does not count as a change", !queuedFor(r), r.body);

  await pool.query("UPDATE finance.rec_balances SET closing = 260, movement = 160 WHERE rec_id = $1", [REC]);
  r = await runAll();
  ok("after the ledger moved: run", Boolean(queuedFor(r)), r.body);
  await finish(queuedFor(r).run_id, "failed");

  r = await runAll();
  ok("after a failed run: run again", Boolean(queuedFor(r)), r.body);
  await finish(queuedFor(r).run_id);

  await pool.query("UPDATE finance.recs SET status = 'sent_back', review_note = 'Check the release' WHERE id = $1", [REC]);
  r = await runAll();
  ok("sent back by a reviewer: run", Boolean(queuedFor(r)), r.body);
}

(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await scenario();
  } catch (e) {
    failures.push("threw");
    console.log("  FAIL threw:", e.stack);
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exitCode = 1; }
})();

// Threads and people, end to end: the real server.js on a real, local,
// throwaway Postgres, with Secret Manager faked and every other network host
// blocked.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. A scratch cluster with database t and migrations applied up to 050.
//   2. DB_PORT=<port> node scripts/threads-local-check.js   (from finance-api)

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

const SLUG = "sample-threads";
const CFO = "cfo@example.com";
const STRANGER = "someone@example.com";
const RUN = "33333333-0000-0000-0000-000000000003";

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  throw new Error(`blocked host ${u.hostname}`);
};

// The fake Xero has no rate limit: do not pace calls to it.
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
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO')", [CID, CFO]);
  ENTITY = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-ltd','Alpha Ltd','{}') RETURNING id", [CID])).rows[0].id;
}

async function scenario() {
  await seed();
  const ACC = `${ENTITY}:776`;

  await section("people", async () => {
    let r = await call("GET", "/api/finance/people");
    ok("the agents are listed with initials", r.status === 200 && r.body.people.some((p) => p.email === "fm1@agents.stza.io" && p.initials === "FM1"), r.body);
    r = await call("PUT", "/api/finance/people/me", { display_name: "Jo Bloggs", title: "CFO" });
    ok("a person sets their profile; initials from the name", r.status === 200 && r.body.person.initials === "JB" && r.body.person.email === CFO, r.body);
    r = await call("PUT", "/api/finance/people/me", { display_name: "Jo Bloggs", initials: "JOB", title: "CFO" });
    ok("and can choose their initials", r.status === 200 && r.body.person.initials === "JOB", r.body);
    r = await call("PUT", "/api/finance/people/me", { display_name: "Jo Bloggs" }, { "X-Work-Via": `agent:fm1:${RUN}` });
    ok("an agent cannot set a person's profile", r.status === 403, r.body);
    r = await call("PUT", "/api/finance/people/me", { display_name: "", initials: "TOOLONG" });
    ok("a bad profile is refused with reasons", r.status === 422 && r.body.issues.length === 2, r.body);
  });

  let question;
  await section("threads", async () => {
    let r = await api("POST", "threads", { subject_kind: "account", subject_key: ACC, period: "2026-10", kind: "finding", body: "Xero's charge differs by 1.40" });
    ok("a person cannot record a finding", r.status === 422 && /only an agent/.test(r.body.issues[0]), r.body);
    r = await api("POST", "threads", { subject_kind: "account", subject_key: ACC, period: "2026-10", kind: "finding", body: "Xero's charge differs by 1.40 from the schedule" },
      { "X-Work-Via": `agent:fm1:${RUN}` });
    ok("an agent records a finding, as the person who asked", r.status === 201, r.body);
    r = await api("POST", "threads", { subject_kind: "account", subject_key: ACC, period: "2026-10", kind: "question", needs_decision: true,
      body: "Keep the 1.40 as rounding until cut-over?" }, { "X-Work-Via": `agent:fm1:${RUN}` });
    question = r.body.id;
    ok("an agent asks a question that waits on a decision", r.status === 201 && question, r.body);
    r = await api("POST", "threads", { subject_kind: "account", subject_key: ACC, period: "2026-10", body: "Looking" }, { "X-Actor-Email": STRANGER });
    ok("someone with no role on the client cannot write", r.status === 403, r.body);

    r = await api("GET", `threads?s=${encodeURIComponent(`account|${ACC}`)}&period=2026-10`);
    const q = r.body.threads?.find((e) => e.id === question);
    ok("the thread reads back, the open question first, the agent shown for the person", r.status === 200 && r.body.open === 1 && r.body.threads[0].id === question
      && q.by.initials === "FM1" && q.by.on_behalf_of === "JOB" && q.by.role === "Fractional CFO", r.body);

    r = await api("POST", "threads", { subject_kind: "asset", subject_key: ENTITY, parent_id: question, kind: "decision", body: "Yes" });
    ok("a reply must stay in its thread", r.status === 422 && /same thread/.test(r.body.issues[0]), r.body);
    r = await api("POST", "threads", { subject_kind: "account", subject_key: ACC, period: "2026-10", parent_id: question, kind: "note", body: "Checking the schedule first" });
    ok("a note in reply leaves it open", r.status === 201, r.body);
    r = await api("GET", "threads?open=true");
    ok("still open", r.body.open === 1 && r.body.threads.length === 1, r.body);
    r = await api("POST", "threads", { subject_kind: "account", subject_key: ACC, period: "2026-10", parent_id: question, kind: "decision", body: "Agreed. Keep it named until cut-over." });
    ok("a decision in reply answers it", r.status === 201, r.body);
    r = await api("GET", `threads?s=${encodeURIComponent(`account|${ACC}`)}`);
    const answered = r.body.threads.find((e) => e.id === question);
    ok("now decided, with both replies under it in order", r.body.open === 0 && !answered.open && answered.replies.map((x) => x.kind).join(",") === "note,decision"
      && answered.replies[1].by.initials === "JOB", r.body);

    r = await api("GET", "threads?period=2026-11");
    ok("another month shows none of October's account thread", r.status === 200 && r.body.threads.length === 0, r.body);
    r = await api("GET", "threads?s=invoice|x");
    ok("an unknown subject is refused", r.status === 422, r.body);
  });

  await section("append only", async () => {
    let threw = null;
    try { await pool.query("UPDATE finance.thread_entries SET body = 'changed' WHERE id = $1", [question]); } catch (e) { threw = e.message; }
    ok("an entry cannot be edited", /append only/.test(threw ?? ""), threw);
    threw = null;
    try { await pool.query("DELETE FROM finance.thread_entries WHERE id = $1", [question]); } catch (e) { threw = e.message; }
    ok("or deleted", /append only/.test(threw ?? ""), threw);
    const audit = (await pool.query("SELECT count(*)::int AS n FROM finance.audit_log WHERE client_id = $1 AND action = 'thread_entry_added'", [CID])).rows[0].n;
    ok("every entry is audited", audit === 4, audit);
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

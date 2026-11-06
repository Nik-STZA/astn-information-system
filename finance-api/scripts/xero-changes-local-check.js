// Xero changes (fixed assets), end to end: the real server.js on a real, local,
// throwaway Postgres, with Xero and Secret Manager faked inside this process.
// Any other network host throws, so this cannot reach Xero or a live database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it on port 54329, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 039.
//   3. node scripts/xero-changes-local-check.js          (from finance-api)

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

const TYPE = "11111111-2222-3333-4444-555555555555";
const BILL = "99999999-8888-7777-6666-555555555555";
const TYPES = [{ assetTypeId: TYPE, assetTypeName: "Computer equipment", bookDepreciationSetting: { depreciationMethod: "StraightLine", averagingMethod: "ActualDays", effectiveLifeYears: 3 } }];
const REGISTERED = [{ assetId: "a-9", assetNumber: "FA-0009", assetName: "Old laptop", purchaseDate: "2025-04-01T00:00:00", purchasePrice: 900, assetStatus: "Registered" }];

const fresh = () => ({ posts: [], keys: [], postFails: null, readsFail: false });
let state = fresh();
const realFetch = global.fetch;
const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  const method = opts.method ?? "GET";
  if (u.pathname === "/assets.xro/1.0/Assets" && method === "POST") {
    state.keys.push(opts.headers?.["Idempotency-Key"]);
    if (state.postFails) return json({ message: "no" }, state.postFails, { "retry-after": "0" });
    const sent = JSON.parse(opts.body);
    state.posts.push(sent);
    return json({ ...sent, assetId: `new-${state.posts.length}` });
  }
  if (method !== "GET") return json({}, 404);
  if (state.readsFail) return json({ Message: "down" }, 400);
  if (u.pathname === "/assets.xro/1.0/AssetTypes") return json(TYPES);
  if (u.pathname === "/assets.xro/1.0/Assets") {
    const status = u.searchParams.get("status");
    const items = status === "REGISTERED" ? REGISTERED : status === "DRAFT" ? state.posts.map((p, i) => ({ ...p, assetId: `new-${i + 1}` })) : [];
    return json({ pagination: { page: 1, pageSize: 200, itemCount: items.length }, items });
  }
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ BaseCurrency: "GBP" }] });
  return json({}, 404);
};

const { app, pool } = require("../server.js");

const SLUG = "sample-changes";
const CFO = "cfo@example.com";
const BOOK = "clerk@example.com";
let base, CID, EA;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : "");
};
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: threw`); console.log("  FAIL", name, "threw:", e.stack); }
}
const api = async (method, path, body, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function seed({ setup = false } = {}) {
  state = fresh();
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Ltd') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper')", [CID, CFO, BOOK]);
  const config = { tenant_id: `tenant-${CID}`, tenant_name: "Alpha Ltd", ...(setup ? { write_policy: { setup: true } } : {}) };
  EA = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-ltd','Alpha Ltd',$2) RETURNING id",
    [CID, JSON.stringify(config)])).rows[0].id;
}
const switchSetup = (on) => pool.query(
  "UPDATE finance.entities SET accounting_system_config = jsonb_set(accounting_system_config, '{write_policy}', $2::jsonb) WHERE id = $1",
  [EA, JSON.stringify({ setup: on })]);
const run = async (agent, status = "running") => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Close October',$4) RETURNING id", [CID, CFO, agent, status])).rows[0].id;
const row = async (id) => (await pool.query("SELECT * FROM finance.xero_changes WHERE id = $1", [id])).rows[0];

const ASSET = {
  kind: "create_fixed_asset", entity: "alpha-ltd", asset_name: "Laptop", asset_type_id: TYPE, purchase_date: "2026-09-12", purchase_price: 1200,
  source_doc: BILL, reason: "Bill from Jo Bloggs Ltd coded to 0710 Computer equipment; above the capitalisation limit.",
};
const propose = async (body = ASSET, headers = {}) => api("POST", "xero-changes", body, headers);
const agentPropose = async (agent = "fm1", body = ASSET) => propose(body, { "X-Work-Via": `agent:${agent}:${await run(agent)}` });

async function scenario() {
  await section("FM1 proposes from a live run; nothing reaches Xero", async () => {
    await seed();
    const r = await agentPropose();
    ok("201", r.status === 201 && r.body.id, r);
    ok("warns that the setup tier is off", (r.body.warnings || []).some((w) => /switched off for Alpha Ltd/.test(w)), r.body);
    const c = await row(r.body.id);
    ok("stored as an agent's proposal", c.state === "proposed" && c.source === "agent" && c.proposed_by === "agent:fm1" && c.source_doc === BILL, c);
    ok("the next number and a draft", c.input.record.assetNumber === "FA-0010" && c.input.record.assetStatus === "Draft" && c.input.record.bookDepreciationSetting.effectiveLifeYears === 3, c.input);
    ok("nothing posted to Xero", state.posts.length === 0);
    const again = await agentPropose();
    ok("the same asset twice is refused", again.status === 409, again);
    const list = await api("GET", "xero-changes");
    ok("listed, waiting", list.status === 200 && list.body.changes.length === 1 && list.body.counts.waiting === 1, list.body);
    const inbox = await api("GET", "review");
    ok("in the CFO's Review inbox", inbox.body.items.some((i) => i.kind === "xero_change" && i.for_you && i.waiting_on === "CFO"), inbox.body.items);
  });

  await section("refusals", async () => {
    await seed();
    let r = await agentPropose("ap-clerk");
    ok("AP clerk refused", r.status === 403, r);
    r = await propose(ASSET, { "X-Work-Via": `agent:fm1:${await run("fm1", "succeeded")}` });
    ok("a finished run refused", r.status === 403, r);
    r = await agentPropose("fm1", { ...ASSET, asset_type_id: "22222222-2222-3333-4444-555555555555" });
    ok("an unknown asset type refused", r.status === 422 && /No asset type/.test(r.body.issues[0]), r);
    r = await agentPropose("fm1", { ...ASSET, purchase_date: "2025-04-01", purchase_price: 900 });
    ok("a purchase already in the register refused", r.status === 422 && /already has FA-0009/.test(r.body.issues[0]), r);
    r = await agentPropose("fm1", { ...ASSET, kind: "upsert_contact" });
    ok("a kind not built refused", r.status === 422, r);
    r = await propose(ASSET, { "X-Actor-Email": "stranger@example.com" });
    ok("no engagement role refused", r.status === 403, r);
    state.readsFail = true;
    r = await agentPropose();
    state.readsFail = false;
    ok("Xero unreadable: refused, not guessed", r.status === 503, r);
    ok("nothing stored", (await pool.query("SELECT count(*)::int AS n FROM finance.xero_changes WHERE client_id = $1", [CID])).rows[0].n === 0);
  });

  await section("only the CFO approves, and only a person", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    let r = await api("POST", `xero-changes/${id}/approve`, {}, { "X-Actor-Email": BOOK });
    ok("bookkeeper refused", r.status === 403 && /Only the CFO/.test(r.body.error), r);
    r = await api("POST", `xero-changes/${id}/approve`, {}, { "X-Work-Via": `agent:fm1:${await run("fm1")}` });
    ok("an agent refused, even as the CFO", r.status === 403, r);
    ok("still proposed, nothing in Xero", (await row(id)).state === "proposed" && state.posts.length === 0);
  });

  await section("tier off: the approval is refused and nothing is sent", async () => {
    await seed();
    const { body: { id } } = await agentPropose();
    const r = await api("POST", `xero-changes/${id}/approve`, {});
    ok("422 naming the tier", r.status === 422 && /setup tier is switched off/.test(r.body.error), r);
    const c = await row(id);
    ok("back to waiting, with why", c.state === "proposed" && c.attempt_outcome === "refused" && /setup tier/.test(c.last_error), c);
    ok("nothing posted", state.posts.length === 0 && state.keys.length === 0);

    await switchSetup(true);
    const again = await api("POST", `xero-changes/${id}/approve`, {});
    ok("once switched on, approving makes it", again.status === 200 && again.body.written === true && again.body.xero_id === "new-1", again);
    ok("under the next attempt's key", state.keys[0] === `xero-change-${id}-2`, state.keys);
  });

  await section("approve makes exactly one draft asset, through the write route", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    let r = await api("POST", `xero-changes/${id}/approve`, {});
    ok("written", r.status === 200 && r.body.written === true && /draft/.test(r.body.after), r);
    ok("one POST, as a draft, with the stored record", state.posts.length === 1 && state.posts[0].assetStatus === "Draft" && state.posts[0].assetNumber === "FA-0010" && state.posts[0].purchasePrice === 1200, state.posts);
    ok("under the change's key", state.keys[0] === `xero-change-${id}-1`, state.keys);
    const c = await row(id);
    ok("recorded", c.state === "written" && c.xero_id === "new-1" && c.approved_by === CFO, c);
    r = await api("POST", `xero-changes/${id}/approve`, {});
    ok("approving again refused", r.status === 409 && state.posts.length === 1, r);
    r = await api("POST", `xero-changes/${id}/reject`, {});
    ok("a made change cannot be rejected", r.status === 409, r);
    const audit = (await pool.query("SELECT action FROM finance.audit_log WHERE client_id = $1 ORDER BY occurred_at", [CID])).rows.map((a) => a.action);
    ok("audited end to end", ["xero_change_proposed", "xero_change_approved", "create_fixed_asset_dry_run", "create_fixed_asset_written"].every((a) => audit.includes(a)), audit);
    const inbox = await api("GET", "review");
    ok("gone from Review", !inbox.body.items.some((i) => i.kind === "xero_change"), inbox.body.items);
  });

  await section("two approvals at once make one asset", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    const [a, b] = await Promise.all([api("POST", `xero-changes/${id}/approve`, {}), api("POST", `xero-changes/${id}/approve`, {})]);
    ok("one written, the other refused", [a, b].filter((x) => x.body.written).length === 1 && [a, b].some((x) => x.status === 409), [a, b]);
    ok("one asset in Xero", state.posts.length === 1, state.posts.length);
  });

  await section("Xero says no: back to waiting, safe to try again", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    state.postFails = 400;
    const r = await api("POST", `xero-changes/${id}/approve`, {});
    ok("refused", r.status === 422, r);
    ok("waiting again, with why", (await row(id)).state === "proposed" && (await row(id)).attempt_outcome === "refused");
    state.postFails = null;
    const again = await api("POST", `xero-changes/${id}/approve`, {});
    ok("then written, under a new key", again.body.written === true && state.keys.at(-1) === `xero-change-${id}-2`, { again, keys: state.keys });
  });

  await section("no clear answer: someone must look in Xero", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    state.postFails = 503;
    let r = await api("POST", `xero-changes/${id}/approve`, {});
    state.postFails = null;
    ok("502, may be in Xero", r.status === 502 && /check there/.test(r.body.error), r);
    let c = await row(id);
    ok("held as unknown", c.state === "approved" && c.attempt_outcome === "unknown", c);
    r = await api("POST", `xero-changes/${id}/approve`, {});
    ok("approving again without looking refused", r.status === 409 && /Check Xero/.test(r.body.error), r);
    r = await api("POST", `xero-changes/${id}/reject`, {});
    ok("rejecting without looking refused", r.status === 409, r);
    const inbox = await api("GET", "review");
    ok("in Review as check Xero", inbox.body.items.some((i) => i.kind === "xero_change" && /Check Xero/.test(i.status)), inbox.body.items);
    r = await api("POST", `xero-changes/${id}/approve`, { confirmed_in_xero: true });
    c = await row(id);
    ok("seen in Xero: recorded as made, nothing sent", r.status === 200 && c.state === "written" && state.posts.length === 0, { r, c });
  });

  await section("reject", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    let r = await api("POST", `xero-changes/${id}/reject`, {}, { "X-Actor-Email": BOOK });
    ok("bookkeeper refused", r.status === 403, r);
    r = await api("POST", `xero-changes/${id}/reject`, {});
    ok("rejected", r.status === 200 && (await row(id)).state === "rejected", r);
    r = await api("POST", `xero-changes/${id}/approve`, {});
    ok("a rejected change cannot be approved", r.status === 409 && state.posts.length === 0, r);
    const fresh2 = await agentPropose();
    ok("the same asset can be proposed again after a rejection", fresh2.status === 201, fresh2);
  });

  await section("each waiting change is a Work task that follows the decision", async () => {
    await seed({ setup: true });
    const { body: { id } } = await agentPropose();
    const tasksFor = async (cid) => (await api("GET", "tasks")).body.tasks.filter((t) => t.source === "xero_change" && t.source_ref === cid);
    let ts = await tasksFor(id);
    ok("one task, for review, on the company", ts.length === 1 && ts[0].status === "review" && /^Approve in Xero: /.test(ts[0].title) && ts[0].entity_id === EA, ts);
    ok("read again: still one", (await tasksFor(id)).length === 1);
    const task = ts[0];
    let r = await api("PATCH", `tasks/${task.id}`, { status: "done" });
    ok("marking it done is refused while it waits", r.status === 409 && /Approve or reject this change in Xero changes/.test(r.body.issues?.[0]), r);
    r = await api("DELETE", `tasks/${task.id}`);
    ok("deleting it is refused while it waits", r.status === 409, r);
    r = await api("PATCH", `tasks/${task.id}`, { priority: "P1" });
    ok("other fields still change", r.status === 200 && r.body.priority === "P1", r);
    await api("POST", `xero-changes/${id}/approve`, {});
    ts = await tasksFor(id);
    ok("approved and made: the task is done", ts.length === 1 && ts[0].status === "done" && ts[0].closed_at, ts);
    const ev = (await pool.query("SELECT detail FROM finance.task_events WHERE task_id = $1 AND action = 'status'", [task.id])).rows;
    ok("its history says why", ev.some((e) => /made in Xero after cfo@example.com approved it/.test(e.detail?.reason)), ev);
    r = await api("PATCH", `tasks/${task.id}`, { status: "todo" });
    ok("reopening a decided one is refused", r.status === 409 && /stays done/.test(r.body.issues?.[0]), r);
    r = await api("DELETE", `tasks/${task.id}`);
    ok("once decided it can be deleted", r.status === 200, r);

    const other = await agentPropose("fm1", { ...ASSET, asset_name: "Monitor", purchase_price: 300 });
    ok("a second proposal gets its own task", (await tasksFor(other.body.id)).length === 1, other);
    await api("POST", `xero-changes/${other.body.id}/reject`, {});
    ts = await tasksFor(other.body.id);
    ok("rejected: the task is done", ts.length === 1 && ts[0].status === "done", ts);
    ok("approving it did not open a new task for the first", (await tasksFor(id)).length === 0);
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

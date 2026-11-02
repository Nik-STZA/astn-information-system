// Reconciliations, end to end: the real server.js on a real, local, throwaway
// Postgres, with Xero and Secret Manager faked inside this process. Any other
// network host throws, so this cannot reach Xero or a live database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it on port 54329, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 032.
//   3. node finance-api/scripts/recs-local-check.js          (run from finance-api: node scripts/...)
// DB_USER may name a role that holds only migration 032's grants.
// `serve` as an argument leaves a sample month running on port 8788.

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

const row = (id, name, code, dr, cr, ydr, ycr) => ({ RowType: "Row", Cells: [
  { Value: `${name} (${code})`, Attributes: [{ Id: "account", Value: id }] }, { Value: String(dr) }, { Value: String(cr) }, { Value: String(ydr) }, { Value: String(ycr) }] });
const row2 = (id) => row(id, "Business Bank", "090", 0, 0, 100, 0);
const accounts = (rows) => rows.map(([AccountID, Code, Name, Class, Type]) => ({ AccountID, Code, Name, Class, Type, Status: "ACTIVE" }));

const CHART = {
  a: accounts([
    ["a-pl2", "486", "Insurance two", "EXPENSE", "OVERHEADS"],
    ["a-pre", "620", "Prepayments", "ASSET", "PREPAYMENT"], ["a-acc", "825", "Accruals", "LIABILITY", "CURRLIAB"], ["a-bank", "090", "Business Bank", "ASSET", "BANK"],
    ["a-sus", "850", "Suspense", "ASSET", "CURRENT"], ["a-sun", "610", "Sundry debtors", "ASSET", "CURRENT"], ["a-dep", "611", "Deposits", "ASSET", "CURRENT"],
    ["a-st1", "612", "Staff loan", "ASSET", "CURRENT"], ["a-st2", "613", "Staff Loan!", "ASSET", "CURRENT"],
    ["a-pl", "485", "Insurance", "EXPENSE", "OVERHEADS"],
  ]),
  b: accounts([["b-pre", "1400", "Prepayments", "ASSET", "PREPAYMENT"], ["b-acc", "825", "Accruals", "LIABILITY", "CURRLIAB"], ["b-bank", "091", "Business Bank", "ASSET", "BANK"], ["b-dep", "700", "Deposits", "LIABILITY", "CURRLIAB"], ["b-pl", "469", "Rent", "EXPENSE", "OVERHEADS"]]),
};
const fresh = () => ({ preA: 9000, sepPreA: 10440, tbFails: null, tbEmpty: null, draftsPosted: [], xeroFails: null, currency: { a: "GBP", b: "GBP" }, extraA: [] });
let state = fresh();
const tbs = {
  "a:2026-10-31": () => [row("a-pre", "Prepayments", "620", 0, 1440, state.preA, 0), row("a-acc", "Accruals", "825", 0, 300, 0, 9300), row("a-bank", "Business Bank", "090", 5000, 4000, 42100, 0),
    row("a-sus", "Suspense", "850", 0, 250, 0, 0), row("a-sun", "Sundry debtors", "610", 0, 0, 1120, 0), row("a-dep", "Deposits", "611", 0, 0, 500, 0),
    row("a-st1", "Staff loan", "612", 0, 0, 100, 0), row("a-st2", "Staff Loan!", "613", 0, 0, 40, 0), row("a-pl", "Insurance", "485", 0, 0, 6000, 0), ...state.extraA],
  "a:2026-09-30": () => [row("a-pre", "Prepayments", "620", 0, 2040, state.sepPreA, 0), row("a-acc", "Accruals", "825", 0, 0, 0, 9000), row("a-bank", "Business Bank", "090", 0, 0, 41100, 0),
    row("a-sus", "Suspense", "850", 0, 0, 250, 0), row("a-sun", "Sundry debtors", "610", 0, 0, 1120, 0), row("a-dep", "Deposits", "611", 0, 0, 500, 0),
    row("a-st1", "Staff loan", "612", 0, 0, 100, 0), row("a-st2", "Staff Loan!", "613", 0, 0, 40, 0)],
  "b:2026-10-31": () => [row("b-pre", "Prepayments", "1400", 13500, 4500, 9000, 0), row("b-acc", "Accruals", "825", 0, 0, 0, 0), row("b-bank", "Business Bank", "091", 0, 13500, 500, 0), row("b-dep", "Deposits", "700", 0, 0, 0, 200)],
  "b:2026-09-30": () => [row("b-bank", "Business Bank", "091", 0, 0, 14000, 0), row("b-dep", "Deposits", "700", 0, 0, 0, 200)],
  "a:2026-08-31": () => [row("a-bank", "Business Bank", "090", 0, 0, 41100, 0)],
  "b:2026-08-31": () => [row("b-bank", "Business Bank", "091", 0, 0, 14000, 0)],
};
const JOURNALS = {
  a: [{ ManualJournalID: "mj1", JournalNumber: 41, Status: "POSTED", DateString: "2026-10-31T00:00:00", Narration: "Monthly release", JournalLines: [{ AccountCode: "463", LineAmount: 1440 }, { AccountCode: "620", LineAmount: -1440 }] }],
  b: [{ ManualJournalID: "mj2", JournalNumber: 9, Status: "POSTED", DateString: "2026-10-31T00:00:00", Narration: "Rent release", JournalLines: [{ AccountCode: "469", LineAmount: 4500 }, { AccountCode: "1400", LineAmount: -4500 }] }],
};
const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") {
    if (state.xeroFails) return json({ Message: "refused" }, state.xeroFails);
    state.lastKey = opts.headers?.["Idempotency-Key"];
    state.draftsPosted.push(JSON.parse(opts.body));
    return json({ ManualJournals: [{ ManualJournalID: `mj-new-${state.draftsPosted.length}`, JournalNumber: 98 + state.draftsPosted.length, Status: "DRAFT" }] });
  }
  const h = opts.headers ?? {};
  const t = String(h["Xero-Tenant-Id"] ?? h["xero-tenant-id"] ?? h["Xero-tenant-id"] ?? "").replace("tenant-", "");
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: CHART[t] });
  if (u.pathname.endsWith("/Reports/TrialBalance")) {
    if (state.tbFails === t) return json({ Message: "down" }, 503);
    if (state.tbEmpty === t) return json({ Reports: [{ Rows: [] }] });
    const f = tbs[`${t}:${u.searchParams.get("date")}`];
    return json({ Reports: [{ Rows: [{ RowType: "Section", Rows: f ? f() : [] }] }] });
  }
  if (u.pathname.endsWith("/ManualJournals")) return json({ ManualJournals: JOURNALS[t] });
  if (u.pathname.endsWith("/TaxRates")) return json({ TaxRates: [{ Name: "No VAT", TaxType: "NONE", Status: "ACTIVE" }] });
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ PeriodLockDate: null, BaseCurrency: state.currency[t] }] });
  return json({}, 404);
};

const { app, pool } = require("../server.js");
const { approvalFromThread } = require("../lib/draft-approval");

const CFO = "cfo@example.com";
const BOOK = "clerk@example.com";
const FC = "fc@example.com";
let base, CID, EA, EB;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "");
};
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: threw`); console.log("  FAIL", name, "threw:", e.message); }
}
const api = async (method, path, body, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/sample-group/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function seed() {
  state = fresh();
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = 'sample-group'");
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ('sample-group','Sample Group') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper'),($1,$4,'Financial Controller')", [CID, CFO, BOOK, FC]);
  const ent = async (slug, name, t) => (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,$2,$3,$4) RETURNING id", [CID, slug, name, JSON.stringify({ tenant_id: `tenant-${t}`, tenant_name: name })])).rows[0].id;
  EA = await ent("alpha-ltd", "Alpha Ltd", "a");
  EB = await ent("beta-ltd", "Beta Ltd", "b");
}
const finishedRun = async (output, parent = null, instruction = "Prepare") => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status, output, finished_at, parent_run_id) VALUES ($1,$2,'fm1',$3,'succeeded',$4,now(),$5) RETURNING id", [CID, CFO, instruction, output, parent])).rows[0].id;
const openRun = async (parent, instruction) => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status, parent_run_id) VALUES ($1,$2,'fm1',$3,'running',$4) RETURNING *", [CID, CFO, instruction, parent])).rows[0];
const journalPost = async (body, run) => {
  const r = await realFetch(`${base}/api/finance/clients/sample-group/xero/alpha-ltd/journals`, {
    method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...(run ? { "X-Agent-Run": run } : {}) }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const ANSWER = "Proposed journal (draft)\n\nCompany: alpha-ltd\nDate: 2026-10-31\nNarration: Insurance release October\n\n| 485 | Insurance | Dr 600.00 |\n| 620 | Prepayments | Cr 600.00 |";
const PROPOSAL = { entity: "alpha-ltd", date: "2026-10-31", narration: "Insurance release October", reason: "The October release is missing from the ledger.", lines: [{ account_code: "485", description: "Insurance", amount: 600 }, { account_code: "620", description: "Prepayments", amount: -600 }] };
const INPUT = { entity: "alpha-ltd", date: "2026-10-31", narration: "Insurance release October", lines: PROPOSAL.lines };

const items = (id) => [
  [EA, { supplier: "Sample Insurer Ltd", description: "Insurance", pl_account_code: "485", invoice_ref: "INV-1", invoice_date: "2026-01-02", total_cost: "7200.00", service_start: "2026-01-01", service_end: "2026-12-31", document_ref: "Xero bill" }],
  [EA, { supplier: "Sample Software Inc", description: "Software", pl_account_code: "463", invoice_ref: "INV-2", invoice_date: "2026-04-01", total_cost: "17280.00", service_start: "2026-04-01", service_end: "2027-03-31", document_ref: "Xero bill" }],
  [EB, { supplier: "Sample Landlord Ltd", description: "Office rent", pl_account_code: "469", invoice_ref: "INV-3", invoice_date: "2026-10-01", total_cost: "13500.00", service_start: "2026-10-01", service_end: "2026-12-31", document_ref: "Xero bill" }],
].map(([e, b]) => api("POST", `recs/${id}/items`, { entity_id: e, ...b }));

// A rec with its schedule and a proposed journal, as FM1 would leave it.
async function prepared({ period = "2026-10" } = {}) {
  await seed();
  await api("POST", "recs/compose", { period });
  const list = (await api("GET", `recs?period=${period}`)).body;
  const id = list.recs.find((x) => x.account_name === "Prepayments").id;
  for (const p of items(id)) await p;
  const runId = await finishedRun(ANSWER);
  const via = { "X-Work-Via": `agent:fm1:${runId}` };
  const j = await api("POST", `recs/${id}/journals`, PROPOSAL, via);
  return { id, runId, via, jid: j.body.id };
}
// As far as the CFO: ledger fixed, tied, FM1 prepared, the FC passed.
async function toCfo() {
  const ctx = await prepared();
  await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/reject`, {});
  state.preA = 8400;
  await api("POST", "recs/compose", { period: "2026-10" });
  await api("POST", `recs/${ctx.id}/prepare`, { note: "Ties." }, ctx.via);
  await api("POST", `recs/${ctx.id}/review`, { pass: true, note: "Agreed." }, { "X-Work-Via": `agent:fc:${ctx.runId}`, "X-Actor-Email": FC });
  return ctx;
}
const sign = (id, body = {}, headers = {}) => api("POST", `recs/${id}/sign-off`, body, headers);
const name = (list, n) => list.recs.filter((x) => x.account_name.startsWith(n));

async function scenario() {
  await section("compose", async () => {
    await seed();
    let r = await api("POST", "recs/compose", { period: "2026-10" });
    ok("compose 200 and complete", r.status === 200 && r.body.complete === true, r);
    const list = (await api("GET", "recs?period=2026-10")).body;
    ok("cleared account kept", name(list, "Suspense")[0]?.ledger === "0.00");
    ok("P&L left out", !list.recs.some((x) => x.account_name === "Insurance"));
    const pre = name(list, "Prepayments")[0];
    ok("group ledger across companies, codes joined", pre.ledger === "18000.00" && pre.companies === 2 && pre.codes.join() === "1400,620", pre);
    ok("matrix sets owner and class", pre.owner === "FM1" && pre.class === "M" && name(list, "Accruals")[0].class === "J");
    ok("unplaced left for a person", name(list, "Sundry debtors")[0].placed === false);
    r = await api("POST", "recs/compose", { period: "2026-10" });
    ok("a second compose adds nothing", r.body.added === 0, r.body);
  });

  await section("medium: same name, different nature", async () => {
    const list = (await api("GET", "recs?period=2026-10")).body;
    ok("asset and liability of one name stay apart", name(list, "Deposits").length === 2, name(list, "Deposits"));
    ok("bank accounts do not merge", name(list, "Business Bank").length === 2, name(list, "Business Bank"));
  });

  await section("H6: two accounts in one company reduce to one key", async () => {
    const list = (await api("GET", "recs?period=2026-10")).body;
    const staff = name(list, "Staff");
    ok("both kept", staff.length === 2, staff);
    ok("neither balance lost", staff.map((s) => Number(s.ledger)).reduce((a, b) => a + b, 0) === 140, staff);
    ok("surfaced on the list", (list.notes ?? []).some((n) => /Staff/i.test(n)), list.notes);
  });

  await section("schedule and checks", async () => {
    const ctx = await prepared();
    const d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("cover by company", d.cover.rows.find((x) => x.entity === "Alpha Ltd").variance === "600.00", d.cover);
    ok("group difference", d.cover.group.schedule === "17400.00" && d.cover.group.variance === "600.00", d.cover.group);
    const r = await api("POST", `recs/${ctx.id}/checks`, {});
    const alpha = r.body.entities.find((e) => e.entity === "Alpha Ltd");
    ok("missing release found", alpha.missing === 1, alpha);
    ok("end warning, labelled inference", alpha.warnings.some((w) => /December 2026/.test(w.text)) && /does not let us read repeating journals/.test(r.body.note));
    ok("another client's company refused", (await api("POST", `recs/${ctx.id}/items`, { entity_id: "00000000-0000-4000-8000-000000000000", supplier: "x", pl_account_code: "1", total_cost: "1", service_start: "2026-01-01", service_end: "2026-02-01" })).status === 422);
    const again = await api("POST", `recs/${ctx.id}/items`, { entity_id: EA, supplier: " sample insurer ltd ", pl_account_code: "485", invoice_ref: "inv-1", total_cost: "7200.00", service_start: "2026-01-01", service_end: "2026-12-31" });
    ok("the same invoice twice refused", again.status === 409 && /already on the schedule as item \d+\./.test(again.body.error) && again.body.item_id, again);
    const other = await api("POST", `recs/${ctx.id}/items`, { entity_id: EA, supplier: "Sample Insurer Ltd", pl_account_code: "485", invoice_ref: "INV-9", total_cost: "7200.00", service_start: "2026-01-01", service_end: "2026-12-31" });
    ok("a different invoice from the same supplier is kept", other.status === 201, other);
  });

  await section("H1: a typed reply cannot get round the rec approval", async () => {
    const ctx = await prepared();
    const child = await openRun(ctx.runId, "approved");
    const a = approvalFromThread({ current: child, parent: { output: ANSWER } });
    ok("the old path would accept the words", !a.error, a);
    let r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, dry_run: true }, child.id);
    ok("dry run refused at the route", r.status === 422, r);
    r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, idempotency_key: `agent-run-${child.id}` }, child.id);
    ok("refused at the route with the run named", r.status === 422 && state.draftsPosted.length === 0, r);
    r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, idempotency_key: "no-run" });
    ok("refused with no run named", r.status === 422 && state.draftsPosted.length === 0, r);
    const other = { ...INPUT, narration: "Something else", lines: [{ account_code: "485", amount: 601 }, { account_code: "620", amount: -601 }] };
    r = await journalPost({ ...other, status: "DRAFT", approval: { ...a.approval, presented_text: `${ANSWER}\n601.00` }, idempotency_key: "changed" }, child.id);
    ok("a changed journal in a rec thread is refused too", r.status === 422 && state.draftsPosted.length === 0, r);
    const conf = await realFetch(`${base}/api/finance/clients/sample-group/xero/alpha-ltd/write/journals`, { method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json" }, body: JSON.stringify({ ...INPUT, status: "DRAFT", audit_note: "x", dry_run: false }) });
    ok("the other journal route refuses it", conf.status === 422 && state.draftsPosted.length === 0, conf.status);
  });

  await section("approve to draft", async () => {
    const ctx = await prepared();
    let r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {}, ctx.via);
    ok("agent cannot approve", r.status === 403, r);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {}, { "X-Actor-Email": BOOK });
    ok("non-CFO cannot approve", r.status === 403, r);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("CFO approves", r.status === 200 && r.body.run_id, r);
    const childId = r.body.run_id;
    const child = (await pool.query("SELECT * FROM finance.agent_runs WHERE id = $1", [childId])).rows[0];
    const by = (await api("GET", `recs/journals/by-run/${childId}`)).body;
    ok("run finds its journal and key", by.state === "approved" && by.entity_slug === "alpha-ltd" && String(by.key).includes(ctx.jid), by);
    const a = approvalFromThread({ current: child, parent: { output: ANSWER } });
    r = await journalPost({ ...INPUT, lines: [{ account_code: "485", amount: 700 }, { account_code: "620", amount: -700 }], status: "DRAFT", approval: a.approval, dry_run: true }, childId);
    ok("the approved run cannot change it", r.status === 422, r);
    r = await journalPost({ ...INPUT, status: "POSTED", approval: a.approval, dry_run: true }, childId);
    ok("the approved run cannot post it", r.status === 422, r);
    r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, dry_run: true }, childId);
    ok("dry run passes", r.status === 200, r);
    r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, idempotency_key: `agent-run-${childId}` }, childId);
    ok("draft created (fake Xero)", r.status === 201 && state.draftsPosted.length === 1, r);
    const d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("the route records it on the proposal", d.journals.find((j) => j.id === ctx.jid).state === "draft_created", d.journals);
    r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, idempotency_key: "again" }, childId);
    ok("a second draft is refused", r.status === 422 && state.draftsPosted.length === 1, r);
  });

  await section("H2: one approval, one draft", async () => {
    const ctx = await prepared();
    let r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    const first = r.body.run_id;
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("no retry while a run is live", r.status === 409, r);
    let d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("screen offers no retry while live", d.journals[0].can_retry === false, d.journals[0]);
    const run = (await pool.query("SELECT * FROM finance.agent_runs WHERE id = $1", [first])).rows[0];
    const a = approvalFromThread({ current: run, parent: { output: ANSWER } });
    state.xeroFails = 503;
    r = await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, idempotency_key: "x" }, first);
    ok("Xero fails", r.status === 502, r);
    state.xeroFails = null;
    await pool.query("UPDATE finance.agent_runs SET status = 'failed', finished_at = now() WHERE id = $1", [first]);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("no retry when a draft may exist", r.status === 409 && /Check Xero/i.test(r.body.error ?? ""), r);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/reject`, { confirmed_not_in_xero: true });
    ok("an approved journal that failed can be rejected", r.status === 200, r);
  });

  await section("H2: a definite refusal can be retried, on the proposal's key", async () => {
    const ctx = await prepared();
    let r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    const first = r.body.run_id;
    const run = (await pool.query("SELECT * FROM finance.agent_runs WHERE id = $1", [first])).rows[0];
    const a = approvalFromThread({ current: run, parent: { output: ANSWER } });
    state.xeroFails = 400;
    await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval, idempotency_key: "ignored" }, first);
    state.xeroFails = null;
    const keys = (await pool.query("SELECT idempotency_key FROM finance.journal_posts WHERE client_id = $1", [CID])).rows.map((x) => x.idempotency_key);
    ok("key comes from the proposal, not the caller", keys.length === 1 && keys[0].includes(ctx.jid), keys);
    await pool.query("UPDATE finance.agent_runs SET status = 'failed', finished_at = now() WHERE id = $1", [first]);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("retry allowed after a definite refusal", r.status === 200, r);
  });

  await section("H2b: one live proposal per rec and company", async () => {
    const ctx = await prepared();
    const r = await api("POST", `recs/${ctx.id}/journals`, { ...PROPOSAL, reason: "Second go" }, ctx.via);
    ok("a new proposal is accepted", r.status === 201, r);
    const d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("old one superseded, one live", d.journals.filter((j) => j.state === "proposed").length === 1 && d.journals.some((j) => j.state === "superseded"), d.journals);
    await api("POST", `recs/${ctx.id}/journals/${r.body.id}/approve`, {});
    const again = await api("POST", `recs/${ctx.id}/journals`, { ...PROPOSAL, reason: "Third" }, ctx.via);
    ok("refused while one is approved", again.status === 409, again);
  });

  await section("H3: a company with schedule items and no ledger row", async () => {
    await seed();
    await api("POST", "recs/compose", { period: "2026-10" });
    const list = (await api("GET", "recs?period=2026-10")).body;
    const acc = name(list, "Prepayments")[0].id;
    await pool.query("DELETE FROM finance.rec_balances WHERE rec_id = $1 AND entity_id = $2", [acc, EB]);
    await api("POST", `recs/${acc}/items`, { entity_id: EB, supplier: "Sample Landlord Ltd", pl_account_code: "469", total_cost: "13500.00", service_start: "2026-10-01", service_end: "2026-12-31" });
    const r = await api("GET", `recs/${acc}`);
    const beta = r.body.cover?.rows?.find((x) => x.entity === "Beta Ltd");
    ok("the company shows, as a variance", r.status === 200 && beta?.variance === "-9000.00", r.body.cover ?? r.body);
    ok("it is in the group total", r.body.cover?.group?.schedule === "9000.00", r.body.cover?.group);
    ok("it does not tie", r.body.cover?.ties === false);
  });

  await section("H4: sign-off on a partial or stale read", async () => {
    const ctx = await toCfo();
    state.tbFails = "b";
    await api("POST", "recs/compose", { period: "2026-10" });
    state.tbFails = null;
    let r = await sign(ctx.id, { sole_reviewer: true });
    ok("refused while a company could not be read", r.status === 422, r);
    await api("POST", "recs/compose", { period: "2026-10" });
    state.preA = 8300;
    r = await sign(ctx.id, { sole_reviewer: true });
    ok("refused if the ledger moved since the last read", r.status === 422 && state.preA === 8300, r);
    state.preA = 8400;
    state.tbFails = "a";
    r = await sign(ctx.id, { sole_reviewer: true });
    ok("refused if the read at sign-off fails", r.status >= 400, r);
    state.tbFails = null;
    r = await sign(ctx.id, { sole_reviewer: true });
    ok("signs off on a clean read", r.status === 200, r);
  });

  await section("H5: months sharing a schedule", async () => {
    const ctx = await toCfo();
    await api("POST", `recs/${ctx.id}/sign-off`, { sole_reviewer: true });
    const signed = (await api("GET", `recs/${ctx.id}`)).body;
    const itemId = signed.schedule.items[0].id;
    const nov = (await api("POST", "recs/compose", { period: "2026-11" })).body;
    const later = (await api("GET", "recs?period=2026-11")).body;
    ok("november list exists", nov.period === "2026-11", nov);
    let target = later.recs.find((x) => x.account_name === "Prepayments")?.id;
    if (!target) {
      // Nothing on November's trial balance in this sample: make the rec by hand.
      target = (await pool.query(
        `INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, proof) SELECT client_id, rec_account_id, '2026-11', '2026-11-30', proof FROM finance.recs WHERE id = $1 RETURNING id`, [ctx.id])).rows[0].id;
    }
    const r = await api("PATCH", `recs/${target}/items/${itemId}`, { total_cost: "8400.00" });
    ok("the edit lands on the later month", r.status === 200, r);
    const after = (await api("GET", `recs/${ctx.id}`)).body;
    ok("the signed month is flagged", /schedule/i.test(after.rec.recheck_reason ?? ""), after.rec.recheck_reason);
    ok("the signed month still shows what was signed", after.schedule.items.find((i) => i.id === itemId)?.total_cost === signed.schedule.items.find((i) => i.id === itemId)?.total_cost, after.schedule.items[0]);
    ok("the signed cover is unchanged", after.cover.group.schedule === signed.cover.group.schedule, after.cover.group);
  });

  await section("re-check when a figure moves", async () => {
    const ctx = await toCfo();
    await sign(ctx.id, { sole_reviewer: true });
    state.sepPreA = 10540;
    await api("POST", "recs/compose", { period: "2026-10" });
    let d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("signed rec flagged", d.rec.status === "signed_off" && /September 2026 closing figure moved/.test(d.rec.recheck_reason ?? ""), d.rec.recheck_reason);
    ok("signed figures stay on screen", d.cover.group.gl === "17400.00", d.cover.group);
    state.sepPreA = 10440;
    await api("POST", "recs/compose", { period: "2026-10" });
    d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("flag clears if the figure goes back", d.rec.recheck_reason === null, d.rec.recheck_reason);
    state.sepPreA = 10540;
    await api("POST", "recs/compose", { period: "2026-09" });
    await api("POST", "recs/compose", { period: "2026-09" });
    d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("refreshing September flags October", /September 2026 closing figure moved/.test(d.rec.recheck_reason ?? ""), d.rec.recheck_reason);
  });

  await section("medium: re-check catches a company that left", async () => {
    const ctx = await toCfo();
    const old = tbs["b:2026-10-31"];
    tbs["b:2026-10-31"] = () => old().filter((x) => x.Cells[0].Attributes[0].Value !== "b-pre");
    await api("POST", "recs/compose", { period: "2026-10" });
    tbs["b:2026-10-31"] = old;
    const d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("flagged", /Beta Ltd/.test(d.rec.recheck_reason ?? ""), d.rec.recheck_reason);
  });

  await section("medium: separation of duties", async () => {
    const ctx = await toCfo();
    let r = await sign(ctx.id);
    ok("the person who started the agents cannot sign silently", r.status === 422 && /sole reviewer/i.test(r.body.issues?.join() ?? ""), r);
    r = await sign(ctx.id, {}, { "X-Actor-Email": BOOK });
    ok("non-CFO cannot sign", r.status === 422, r);
    r = await sign(ctx.id, {}, ctx.via);
    ok("agent cannot sign", r.status === 403, r);
    r = await api("POST", `recs/${ctx.id}/send-back`, { note: "x" }, { "X-Actor-Email": BOOK });
    ok("non-CFO cannot send back", r.status === 422, r);
    r = await sign(ctx.id, { sole_reviewer: true });
    ok("sole reviewer signs, with the flag", r.status === 200, r);
    const d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("flag shows on the rec", d.rec.sole_reviewer === true, d.rec);
    const list = (await api("GET", "recs?period=2026-10")).body;
    ok("flag shows on the list", name(list, "Prepayments")[0].sole_reviewer === true);
    r = await api("POST", `recs/${ctx.id}/reopen`, {}, { "X-Actor-Email": BOOK });
    ok("non-CFO cannot reopen a signed rec", r.status === 422, r);
    const log = (await pool.query("SELECT action, actor_role FROM finance.audit_log WHERE client_id = $1 AND target_type = 'reconciliation'", [CID])).rows;
    ok("sign-off written to audit_log", log.some((x) => x.action === "rec_signed_off" && x.actor_role === "Fractional CFO"), log);
  });

  await section("medium: review needs a role", async () => {
    const ctx = await prepared();
    await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/reject`, {});
    state.preA = 8400;
    await api("POST", "recs/compose", { period: "2026-10" });
    await api("POST", `recs/${ctx.id}/prepare`, { note: "Ties." }, ctx.via);
    let r = await api("POST", `recs/${ctx.id}/review`, { pass: true, note: "ok" }, { "X-Actor-Email": BOOK });
    ok("a bookkeeper cannot review", r.status === 422, r);
    r = await api("POST", `recs/${ctx.id}/review`, { pass: true, note: "ok" }, { "X-Actor-Email": FC });
    ok("a person with the FC role can", r.status === 200, r);
  });

  await section("medium: approval checks the rec", async () => {
    const ctx = await prepared();
    await pool.query("UPDATE finance.recs SET recheck_reason = 'moved' WHERE id = $1", [ctx.id]);
    let r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("refused on re-check", r.status === 409 || r.status === 422, r);
    await pool.query("UPDATE finance.recs SET recheck_reason = NULL, status = 'signed_off' WHERE id = $1", [ctx.id]);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("refused on signed off", r.status === 409 || r.status === 422, r);
    await pool.query("UPDATE finance.recs SET status = 'in_progress', dropped_at = now() WHERE id = $1", [ctx.id]);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {});
    ok("refused on dropped", r.status === 409 || r.status === 422, r);
  });

  await section("medium: compose keeps history", async () => {
    const ctx = await prepared();
    const old = { a: tbs["a:2026-10-31"], b: tbs["b:2026-10-31"], c: tbs["a:2026-09-30"], d: tbs["b:2026-09-30"] };
    const strip = (f) => () => f().filter((x) => !String(x.Cells[0].Attributes[0].Value).endsWith("-pre"));
    tbs["a:2026-10-31"] = strip(old.a); tbs["b:2026-10-31"] = strip(old.b); tbs["a:2026-09-30"] = strip(old.c); tbs["b:2026-09-30"] = strip(old.d);
    await api("POST", "recs/compose", { period: "2026-10" });
    Object.assign(tbs, { "a:2026-10-31": old.a, "b:2026-10-31": old.b, "a:2026-09-30": old.c, "b:2026-09-30": old.d });
    const still = (await pool.query("SELECT id FROM finance.recs WHERE id = $1", [ctx.id])).rows[0];
    ok("kept, with its journal", Boolean(still), still);
  });

  await section("medium: a rec with only a proposal is started, and kept", async () => {
    await seed();
    await api("POST", "recs/compose", { period: "2026-10" });
    const list = (await api("GET", "recs?period=2026-10")).body;
    const id = name(list, "Prepayments")[0].id;
    const runId = await finishedRun(ANSWER);
    await api("POST", `recs/${id}/journals`, PROPOSAL, { "X-Work-Via": `agent:fm1:${runId}` });
    const d = (await pool.query("SELECT status FROM finance.recs WHERE id = $1", [id])).rows[0];
    ok("proposing started it", d.status === "in_progress", d);
    await pool.query("UPDATE finance.recs SET status = 'not_started' WHERE id = $1", [id]);
    const old = { a: tbs["a:2026-10-31"], b: tbs["b:2026-10-31"], c: tbs["a:2026-09-30"], d: tbs["b:2026-09-30"] };
    const strip = (f) => () => f().filter((x) => !String(x.Cells[0].Attributes[0].Value).endsWith("-pre"));
    tbs["a:2026-10-31"] = strip(old.a); tbs["b:2026-10-31"] = strip(old.b); tbs["a:2026-09-30"] = strip(old.c); tbs["b:2026-09-30"] = strip(old.d);
    await api("POST", "recs/compose", { period: "2026-10" });
    Object.assign(tbs, { "a:2026-10-31": old.a, "b:2026-10-31": old.b, "a:2026-09-30": old.c, "b:2026-09-30": old.d });
    const kept = (await pool.query("SELECT dropped_at FROM finance.recs WHERE id = $1", [id])).rows[0];
    ok("not deleted while it holds a journal", kept?.dropped_at, kept);
  });

  await section("medium: mixed currencies are not summed", async () => {
    await seed();
    state.currency.b = "USD";
    await api("POST", "recs/compose", { period: "2026-10" });
    const list = (await api("GET", "recs?period=2026-10")).body;
    const pre = name(list, "Prepayments")[0];
    ok("no group total on the list", pre.ledger === null && pre.mixed_currency === true, pre);
    const d = (await api("GET", `recs/${pre.id}`)).body;
    ok("per company stays", d.cover.group.gl === null && d.cover.rows.length === 2 && d.cover.rows.every((x) => x.gl !== null), d.cover);
  });

  await section("medium: default tolerance is nil", async () => {
    await seed();
    await api("POST", "recs/compose", { period: "2026-10" });
    const list = (await api("GET", "recs?period=2026-10")).body;
    ok("nil", list.tolerance === "0.00", list.tolerance);
  });

  await section("M1: a dock chat on a rec page carries the rec", async () => {
    const ctx = await prepared();
    await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/reject`, {});
    const r = await api("POST", "agent-runs", { agent: "fm1", instruction: "What should we do?", recId: ctx.id });
    ok("the run is saved with the rec", r.status === 201, r);
    const dock = (await pool.query("SELECT id, rec_id FROM finance.agent_runs WHERE id = $1", [r.body.id])).rows[0];
    ok("rec_id stored", dock?.rec_id === ctx.id, dock);
    await pool.query("UPDATE finance.agent_runs SET status = 'succeeded', output = $2, finished_at = now() WHERE id = $1", [r.body.id, ANSWER.replace("600.00", "610.00").replace("600.00", "610.00")]);
    const child = await openRun(r.body.id, "approved");
    const a = approvalFromThread({ current: child, parent: { output: ANSWER.replace("600.00", "610.00").replace("600.00", "610.00") } });
    const j = await journalPost({ ...INPUT, narration: "Typed in chat", lines: [{ account_code: "485", amount: 610 }, { account_code: "620", amount: -610 }], status: "DRAFT", approval: a.approval, idempotency_key: "dock" }, child.id);
    ok("a text proposal and a typed approved are refused", j.status === 422 && state.draftsPosted.length === 0, j);
    const bad = await api("POST", "agent-runs", { agent: "fm1", instruction: "x", recId: "00000000-0000-4000-8000-000000000000" });
    ok("a rec that is not this client's is refused", bad.status === 404, bad);
  });

  await section("M2: an unknown outcome needs someone to check Xero", async () => {
    const ctx = await prepared();
    const first = (await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {})).body.run_id;
    const run = (await pool.query("SELECT * FROM finance.agent_runs WHERE id = $1", [first])).rows[0];
    const a = approvalFromThread({ current: run, parent: { output: ANSWER } });
    state.xeroFails = 503;
    await journalPost({ ...INPUT, status: "DRAFT", approval: a.approval }, first);
    state.xeroFails = null;
    await pool.query("UPDATE finance.agent_runs SET status = 'failed', finished_at = now() WHERE id = $1", [first]);
    let r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/reject`, {});
    ok("reject refused until someone confirms", r.status === 409 && /Check Xero/i.test(r.body.error ?? ""), r);
    r = await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/reject`, { confirmed_not_in_xero: true });
    ok("reject allowed once confirmed", r.status === 200, r);
    const row = (await pool.query("SELECT approved_run_id, attempts FROM finance.rec_journals WHERE id = $1", [ctx.jid])).rows[0];
    ok("L5: rejecting keeps the link to the attempt", row.approved_run_id === first, row);
  });

  await section("M3: other callers on a rec's account", async () => {
    const ctx = await prepared();
    const conf = (body) => realFetch(`${base}/api/finance/clients/sample-group/xero/alpha-ltd/write/journals`, { method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json" }, body: JSON.stringify({ status: "DRAFT", audit_note: "x", narration: "Other", date: "2026-10-30", dry_run: true, ...body }) });
    const tax = { tax_type: "NONE" };
    let r = await conf({ lines: [{ account_code: "485", amount: "601", ...tax }, { account_code: "620", amount: "-601", ...tax }] });
    ok("a penny-changed journal on the account is held", r.status === 422, r.status);
    r = await conf({ lines: [{ account_code: "485", amount: "300", ...tax }, { account_code: "486", amount: "300", ...tax }, { account_code: "620", amount: "-600", ...tax }] });
    ok("a split on the account is held", r.status === 422 && /reconciliation/i.test(JSON.stringify(await r.json())), r.status);
    r = await conf({ date: "2026-11-02", lines: [{ account_code: "485", amount: "600", ...tax }, { account_code: "620", amount: "-600", ...tax }] });
    ok("the same lines on another date are held", r.status === 422, r.status);
    r = await conf({ lines: [{ account_code: "485", amount: "50", ...tax }, { account_code: "090", amount: "-50", ...tax }] });
    ok("a normal journal on other accounts is not held", r.status !== 422 || !/reconciliation/i.test(JSON.stringify(await r.json())), r.status);
    const second = await api("POST", `recs/${ctx.id}/journals`, { ...PROPOSAL, reason: "Replaced", lines: [{ account_code: "485", amount: 650 }, { account_code: "620", amount: -650 }] }, ctx.via);
    await api("POST", `recs/${ctx.id}/journals/${second.body.id}/reject`, {});
    r = await conf({ lines: [{ account_code: "485", amount: "600", ...tax }, { account_code: "620", amount: "-600", ...tax }] });
    ok("the lines of a superseded proposal are held", r.status === 422, r.status);
  });

  await section("M4: signed recs stay as signed", async () => {
    const ctx = await toCfo();
    await sign(ctx.id, { sole_reviewer: true });
    const before = (await api("GET", `recs/${ctx.id}`)).body;
    let r = await api("POST", `recs/${ctx.id}/place`, { line_key: "accruals" });
    ok("place refused on a signed rec", r.status === 409 || r.status === 422, r);
    await api("POST", "recs/compose", { period: "2026-10" });
    await pool.query("UPDATE finance.rec_accounts SET line_key = 'accruals' WHERE id = (SELECT rec_account_id FROM finance.recs WHERE id = $1)", [ctx.id]);
    await api("POST", "recs/compose", { period: "2026-10" });
    let d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("compose leaves the matrix fields on a signed rec", d.rec.class === before.rec.class && d.rec.challenge === before.rec.challenge && d.rec.owner === before.rec.owner, d.rec);
    ok("a shared row cannot change a signed month", d.cover.group.schedule === before.cover.group.schedule && d.rec.line === before.rec.line, d.cover.group);
    await pool.query("UPDATE finance.rec_accounts SET line_key = 'prepay' WHERE id = (SELECT rec_account_id FROM finance.recs WHERE id = $1)", [ctx.id]);
    r = await api("POST", `recs/${ctx.id}/checks`, {});
    ok("checks do not overwrite a signed rec", r.status === 409, r.status);
    await api("POST", `recs/${ctx.id}/reopen`, {});
    await api("POST", `recs/${ctx.id}/prepare`, { note: "Again." });
    const hist = (await pool.query("SELECT signed_history FROM finance.recs WHERE id = $1", [ctx.id]).catch(() => ({ rows: [{}] }))).rows[0];
    ok("the first signed snapshot stays in history", hist.signed_history?.length === 1 && hist.signed_history[0].snapshot?.balances?.length === 2, hist);
    const un = (await api("GET", "recs?period=2026-10")).body.recs.find((x) => x.line === null);
    r = await api("POST", `recs/${un.id}/place`, { line_key: "ar" }, { "X-Actor-Email": FC });
    ok("place needs the CFO", r.status === 403, r);
  });

  await section("M5: compose never silently drops a signed rec", async () => {
    const ctx = await toCfo();
    await sign(ctx.id, { sole_reviewer: true });
    const old = { a: tbs["a:2026-10-31"], b: tbs["b:2026-10-31"], c: tbs["a:2026-09-30"], d: tbs["b:2026-09-30"] };
    const strip = (f) => () => f().filter((x) => !String(x.Cells[0].Attributes[0].Value).endsWith("-pre"));
    tbs["a:2026-10-31"] = strip(old.a); tbs["b:2026-10-31"] = strip(old.b); tbs["a:2026-09-30"] = strip(old.c); tbs["b:2026-09-30"] = strip(old.d);
    await pool.query("UPDATE finance.rec_schedule_items SET deleted_at = now(), deleted_by = 'x' WHERE client_id = $1", [CID]);
    await api("POST", "recs/compose", { period: "2026-10" });
    Object.assign(tbs, { "a:2026-10-31": old.a, "b:2026-10-31": old.b, "a:2026-09-30": old.c, "b:2026-09-30": old.d });
    const row = (await pool.query("SELECT dropped_at, recheck_reason, status FROM finance.recs WHERE id = $1", [ctx.id])).rows[0];
    ok("flagged, not dropped", !row.dropped_at && /no longer on the trial balance/.test(row.recheck_reason ?? ""), row);
    const ev = (await pool.query("SELECT action FROM finance.rec_events WHERE rec_id = $1 AND action = 'recheck'", [ctx.id])).rows;
    ok("with an event", ev.length === 1, ev);
    const au = (await pool.query("SELECT action FROM finance.audit_log WHERE client_id = $1 AND action = 'rec_left_trial_balance'", [CID])).rows;
    ok("with an audit row", au.length === 1, au);
    tbs["a:2026-11-30"] = () => [row2("a-bank")];
    tbs["b:2026-11-30"] = () => [row2("b-bank")];
    await api("POST", "recs/compose", { period: "2026-11" });
    delete tbs["a:2026-11-30"]; delete tbs["b:2026-11-30"];
    const nov = (await api("GET", "recs?period=2026-11")).body;
    ok("the next month says this one is still open", nov.prior.open === true, nov.prior);
  });

  await section("M6: schedule items with a nil, unmoved ledger stay listed", async () => {
    await seed();
    await api("POST", "recs/compose", { period: "2026-10" });
    let list = (await api("GET", "recs?period=2026-10")).body;
    const id = name(list, "Prepayments")[0].id;
    await api("POST", `recs/${id}/items`, { entity_id: EA, supplier: "Sample Insurer Ltd", pl_account_code: "485", total_cost: "7200.00", service_start: "2026-01-01", service_end: "2026-12-31" });
    const old = { a: tbs["a:2026-10-31"], b: tbs["b:2026-10-31"], c: tbs["a:2026-09-30"], d: tbs["b:2026-09-30"] };
    const strip = (f) => () => f().filter((x) => !String(x.Cells[0].Attributes[0].Value).endsWith("-pre"));
    tbs["a:2026-10-31"] = strip(old.a); tbs["b:2026-10-31"] = strip(old.b); tbs["a:2026-09-30"] = strip(old.c); tbs["b:2026-09-30"] = strip(old.d);
    await api("POST", "recs/compose", { period: "2026-10" });
    Object.assign(tbs, { "a:2026-10-31": old.a, "b:2026-10-31": old.b, "a:2026-09-30": old.c, "b:2026-09-30": old.d });
    list = (await api("GET", "recs?period=2026-10")).body;
    const pre = name(list, "Prepayments")[0];
    ok("still listed, as a variance", pre && pre.support === "1200.00" && pre.difference === "-1200.00" && !pre.ties, pre);
  });

  await section("M7: the stored journal is what goes", async () => {
    const ctx = await prepared();
    const first = (await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {})).body.run_id;
    const run = (await pool.query("SELECT * FROM finance.agent_runs WHERE id = $1", [first])).rows[0];
    const a = approvalFromThread({ current: run, parent: { output: ANSWER } });
    const stored = (await api("GET", `recs/journals/by-run/${first}`)).body;
    ok("the run is given the stored lines with tax", stored.lines?.every((l) => l.tax_type), stored.lines);
    let r = await journalPost({ ...INPUT, lines: PROPOSAL.lines.map((l, i) => (i ? l : { ...l, description: "Changed" })), status: "DRAFT", approval: a.approval, dry_run: true }, first);
    ok("a changed description is refused", r.status === 422, r);
    r = await journalPost({ ...INPUT, lines: PROPOSAL.lines.map((l, i) => (i ? { ...l, tax_type: "NONE" } : { ...l, tax_type: "INPUT2" })), status: "DRAFT", approval: a.approval, dry_run: true }, first);
    ok("a changed tax type is refused", r.status === 422, r);
    r = await journalPost({ ...INPUT, lines: stored.lines, status: "DRAFT", approval: a.approval }, first);
    ok("the stored lines pass", r.status === 201, r);
    ok("L4: Xero gets the proposal's Idempotency-Key", String(state.lastKey).includes(ctx.jid), state.lastKey);
  });

  await section("L2 and L9", async () => {
    const ctx = await prepared();
    const first = (await api("POST", `recs/${ctx.id}/journals/${ctx.jid}/approve`, {})).body.run_id;
    const run = (await pool.query("SELECT * FROM finance.agent_runs WHERE id = $1", [first])).rows[0];
    const a = approvalFromThread({ current: run, parent: { output: ANSWER } });
    await pool.query("UPDATE finance.recs SET recheck_reason = 'moved' WHERE id = $1", [ctx.id]);
    let r = await journalPost({ ...INPUT, lines: PROPOSAL.lines.map((l) => ({ ...l, tax_type: "NONE" })), status: "DRAFT", approval: a.approval }, first);
    ok("L9: rec state is checked again at the post", r.status === 422 && state.draftsPosted.length === 0, r);
    await pool.query("UPDATE finance.recs SET recheck_reason = NULL WHERE id = $1", [ctx.id]);
    r = await journalPost({ ...INPUT, lines: PROPOSAL.lines.map((l) => ({ ...l, tax_type: "NONE" })), status: "DRAFT", approval: a.approval }, first);
    ok("posts once the rec is clear", r.status === 201, r);
    r = await api("POST", `recs/${ctx.id}/journals`, PROPOSAL, ctx.via);
    ok("L2: an exact re-proposal of a draft in Xero is refused", r.status === 409, r);
    await api("PUT", "recs/settings", { tolerance: 3 });
    const au = (await pool.query("SELECT action FROM finance.audit_log WHERE client_id = $1 AND action = 'rec_tolerance_changed'", [CID])).rows;
    ok("L9: tolerance changes are audited", au.length === 1, au);
    await api("PUT", "recs/settings", { tolerance: 0 });
    const c2 = await toCfo();
    r = await api("POST", `recs/${c2.id}/reopen`, {}, { "X-Actor-Email": FC });
    ok("L9: only the CFO reopens a rec with the CFO", r.status === 422, r);
  });

  await section("L5: a retired company does not block forever", async () => {
    const ctx = await toCfo();
    await pool.query("UPDATE finance.entities SET retired_at = now() WHERE id = $1", [EB]);
    await api("POST", "recs/compose", { period: "2026-10" });
    const d = (await api("GET", `recs/${ctx.id}`)).body;
    ok("its rows are gone", d.cover.rows.every((x) => x.entity !== "Beta Ltd"), d.cover.rows);
    await api("POST", `recs/${ctx.id}/reopen`, {});
    await api("POST", `recs/${ctx.id}/prepare`, { note: "Beta retired." });
    await api("POST", `recs/${ctx.id}/review`, { pass: true, note: "ok" }, { "X-Work-Via": `agent:fc:${ctx.runId}`, "X-Actor-Email": FC });
    const r = await sign(ctx.id, { sole_reviewer: true });
    ok("it can be signed", r.status === 200, r);
  });

  await section("L6: sign-off compares opening, and blocks on unidentified rows", async () => {
    const ctx = await toCfo();
    state.sepPreA = 10500;
    let r = await sign(ctx.id, { sole_reviewer: true });
    ok("a moved opening refuses", r.status === 422 && /moved/.test(r.body.issues?.join() ?? ""), r);
    state.sepPreA = 10440;
    state.extraA = [{ RowType: "Row", Cells: [{ Value: "Mystery" }, { Value: "0" }, { Value: "0" }, { Value: "5" }, { Value: "0" }] }];
    r = await sign(ctx.id, { sole_reviewer: true });
    ok("a row with no account id refuses, with a count", r.status === 422 && /1 trial balance row/.test(r.body.issues?.join() ?? ""), r);
    state.extraA = [];
  });

  await section("L7 and new companies", async () => {
    await seed();
    const saved = CHART.b;
    CHART.b = [];
    let r = await api("POST", "recs/compose", { period: "2026-10" });
    CHART.b = saved;
    ok("L7: an empty chart is a failed read", r.body.complete === false, r.body);
    const old = tbs["b:2026-09-30"];
    tbs["b:2026-09-30"] = () => [];
    r = await api("POST", "recs/compose", { period: "2026-10" });
    tbs["b:2026-09-30"] = old;
    ok("a first-month company says why and what to do", /started this month/.test(r.body.entity_errors?.[0]?.error ?? "") && /30 September 2026|2026-09-30/.test(r.body.entity_errors?.[0]?.error ?? ""), r.body.entity_errors);
  });

  await section("low and refusals", async () => {
    await seed();
    await api("POST", "recs/compose", { period: "2026-10" });
    const list = (await api("GET", "recs?period=2026-10")).body;
    const id = name(list, "Prepayments")[0].id;
    let r = await api("POST", "recs/compose", { period: "2026-10" }, { "X-Actor-Email": "stranger@example.com" });
    ok("compose: no role, refused", r.status === 403, r);
    r = await api("POST", `recs/${id}/comment`, { entity_id: "not-an-id", comment: "x" });
    ok("bad entity_id is 400", r.status === 400, r);
    r = await api("POST", `recs/${id}/items`, { entity_id: "not-an-id", supplier: "x", pl_account_code: "1", total_cost: "1", service_start: "2026-01-01", service_end: "2026-02-01" });
    ok("bad entity_id on an item is 400", r.status === 400, r);
    const runId = await finishedRun(ANSWER);
    r = await api("POST", `recs/${id}/journals`, { ...PROPOSAL, lines: [null, null] }, { "X-Work-Via": `agent:fm1:${runId}` });
    ok("null lines are 422, not 500", r.status === 422, r);
    state.tbEmpty = "b";
    r = await api("POST", "recs/compose", { period: "2026-10" });
    state.tbEmpty = null;
    ok("a report with no rows is a failed read", r.body.complete === false, r.body);
    state.extraA = [{ RowType: "Row", Cells: [{ Value: "Mystery" }, { Value: "0" }, { Value: "0" }, { Value: "5" }, { Value: "0" }] }];
    await api("POST", "recs/compose", { period: "2026-10" });
    state.extraA = [];
    const l2 = (await api("GET", "recs?period=2026-10")).body;
    ok("a row with no account id is reported", (l2.notes ?? []).some((n) => /Mystery/.test(n)), l2.notes);
    r = await api("PUT", "recs/settings", { tolerance: 2.5 });
    ok("CFO sets tolerance", r.status === 200, r);
    r = await api("PUT", "recs/settings", { tolerance: 2.5 }, { "X-Actor-Email": BOOK });
    ok("others cannot", r.status === 403, r);
    ok("bad id 400", (await api("GET", "recs/not-an-id")).status === 400);
    ok("bad period 400", (await api("GET", "recs?period=2026-13")).status === 400);
  });

  await section("missing table is tolerated", async () => {
    // Renaming needs the table's owner, which the app role is not.
    const { Pool } = require("pg");
    const owner = new Pool({ host: "127.0.0.1", port: Number(process.env.DB_PORT), user: "postgres", password: "x", database: "t" });
    await owner.query("ALTER TABLE finance.recs RENAME TO recs_hidden");
    try {
      const r = await api("GET", "recs?period=2026-10");
      ok("list says migration missing", r.status === 200 && r.body.migration_missing === true, r);
      const w = await api("POST", "recs/compose", { period: "2026-10" });
      ok("write says 503", w.status === 503 && w.body.migration_missing === true, w);
    } finally {
      await owner.query("ALTER TABLE finance.recs_hidden RENAME TO recs");
      await owner.end();
    }
  });

  console.log(`\n${pass} passed, ${failures.length} failed`);
}

(async () => {
  await new Promise((done) => { app.listen(8788, "127.0.0.1", done); });
  base = "http://127.0.0.1:8788";
  await scenario();
  if (process.argv[2] === "serve") {
    const ctx = await prepared();
    await api("POST", `recs/${ctx.id}/comment`, { entity_id: EA, comment: "October insurance release missing; journal proposed" });
    await api("POST", `recs/${ctx.id}/checks`, {});
    await api("POST", `recs/${ctx.id}/prepare`, { note: "The 600.00 is October's insurance release, missing from the ledger." }, ctx.via);
    await api("POST", `recs/${ctx.id}/review`, { pass: true, note: "Agrees with the difference." }, { "X-Work-Via": `agent:fc:${ctx.runId}`, "X-Actor-Email": FC });
    console.log("serving", ctx.id);
    return;
  }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

// Journals, end to end: the real server.js on a real, local, throwaway
// Postgres, with Xero and Secret Manager faked inside this process. Any other
// network host throws, so this cannot reach Xero or a live database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it on port 54329, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 033.
//   3. node scripts/journals-local-check.js          (from finance-api)
// DB_USER may name a role that holds only the migrations' grants.

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

const CHART = [
  ["a-fee", "485", "Audit fees", "EXPENSE", "OVERHEADS"], ["a-acc", "825", "Accruals", "LIABILITY", "CURRLIAB"],
  ["a-pre", "620", "Prepayments", "ASSET", "PREPAYMENT"], ["a-bank", "090", "Business Bank", "ASSET", "BANK"],
].map(([AccountID, Code, Name, Class, Type]) => ({ AccountID, Code, Name, Class, Type, Status: "ACTIVE" }));

const fresh = () => ({ drafts: [], keys: [], xeroFails: null, lock: null, status: {}, accountsFail: false });
let state = fresh();
const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") {
    if (!u.pathname.endsWith("/ManualJournals")) return json({}, 404);
    if (state.xeroFails) return json({ Elements: [{ ValidationErrors: [{ Message: "refused" }] }] }, state.xeroFails);
    const sent = JSON.parse(opts.body).ManualJournals[0];
    state.keys.push(opts.headers?.["Idempotency-Key"]);
    state.drafts.push(sent);
    const id = `mj-${state.drafts.length}`;
    state.status[id] = sent.Status;
    return json({ ManualJournals: [{ ManualJournalID: id, JournalNumber: 200 + state.drafts.length, Status: sent.Status }] });
  }
  const one = /\/ManualJournals\/([^/]+)$/.exec(u.pathname);
  if (one) return state.status[one[1]] ? json({ ManualJournals: [{ ManualJournalID: one[1], Status: state.status[one[1]] }] }) : json({}, 404);
  if (u.pathname.endsWith("/Accounts")) return state.accountsFail ? json({ Message: "down" }, 503) : json({ Accounts: CHART });
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ PeriodLockDate: state.lock, BaseCurrency: "GBP" }] });
  if (u.pathname.endsWith("/Reports/TrialBalance")) return json({ Reports: [{ Rows: [] }] });
  return json({}, 404);
};

const { app, pool } = require("../server.js");

const SLUG = "sample-journals";
const CFO = "cfo@example.com";
const BOOK = "clerk@example.com";
let base, CID, EA;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
};
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: threw`); console.log("  FAIL", name, "threw:", e.stack); }
}
const api = async (method, path, body, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function seed() {
  state = fresh();
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Ltd') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper')", [CID, CFO, BOOK]);
  EA = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-ltd','Alpha Ltd',$2) RETURNING id",
    [CID, JSON.stringify({ tenant_id: "tenant-a", tenant_name: "Alpha Ltd" })])).rows[0].id;
}
const run = async (agent, status = "running") => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Close October',$4) RETURNING id", [CID, CFO, agent, status])).rows[0].id;
const row = async (id) => (await pool.query("SELECT * FROM finance.journals WHERE id = $1", [id])).rows[0];

const ACCRUAL = {
  entity: "alpha-ltd", date: "2026-10-31", narration: "October audit fee accrual", reason: "The year's audit fee is accrued monthly; October is missing.",
  lines: [{ account_code: "485", description: "Audit fee", amount: 250 }, { account_code: "825", description: "Accruals", amount: -250 }],
};
const varied = (n) => ({ ...ACCRUAL, lines: [{ ...ACCRUAL.lines[0], amount: 250 + n }, { ...ACCRUAL.lines[1], amount: -(250 + n) }] });
const propose = async (body = ACCRUAL, headers = {}) => api("POST", "journals", body, headers);

async function scenario() {
  await section("a person proposes", async () => {
    await seed();
    let r = await propose(ACCRUAL, { "X-Actor-Email": BOOK });
    ok("201", r.status === 201 && r.body.id, r);
    const j = await row(r.body.id);
    ok("stored as proposed, by a person, in its month", j.state === "proposed" && j.source === "person" && j.proposed_by === BOOK && j.period === "2026-10", j);
    r = await propose(ACCRUAL, { "X-Actor-Email": BOOK });
    ok("the same journal twice is refused", r.status === 409 && /waiting for the CFO/.test(r.body.error), r);
    ok("nothing went to Xero", state.drafts.length === 0);
  });

  await section("refusals before anything is stored", async () => {
    await seed();
    let r = await propose({ ...ACCRUAL, lines: [{ account_code: "485", amount: 250 }, { account_code: "825", amount: -249.99 }] });
    ok("unbalanced refused", r.status === 422 && r.body.issues.some((i) => /does not balance: it is out by 0.01/.test(i)), r);
    r = await propose({ ...ACCRUAL, lines: [{ account_code: "486", amount: 250 }, { account_code: "825", amount: -250 }] });
    ok("unknown account refused", r.status === 422 && r.body.issues.some((i) => /486 does not exist/.test(i)), r);
    r = await propose({ ...ACCRUAL, lines: [{ account_code: "485", amount: 250 }, { account_code: "090", amount: -250 }] });
    ok("bank account refused", r.status === 422 && r.body.issues.some((i) => /bank account/.test(i)), r);
    state.lock = "2026-10-31";
    r = await propose();
    state.lock = null;
    ok("locked month refused", r.status === 422 && r.body.issues.some((i) => /lock date/.test(i)), r);
    r = await propose({ ...ACCRUAL, entity: "gamma-ltd" });
    ok("unknown company refused", r.status === 422, r);
    r = await propose(ACCRUAL, { "X-Actor-Email": "stranger@example.com" });
    ok("no engagement role refused", r.status === 403, r);
    state.accountsFail = true;
    r = await propose();
    state.accountsFail = false;
    ok("Xero unreadable: kept, with a warning", r.status === 201 && r.body.warnings.length === 1, r);
    const n = (await pool.query("SELECT count(*)::int AS n FROM finance.journals WHERE client_id = $1", [CID])).rows[0].n;
    ok("only that one stored", n === 1, n);
  });

  await section("an agent proposes, and only FM1 or the FC", async () => {
    await seed();
    const fm1 = await run("fm1");
    let r = await propose(ACCRUAL, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("FM1 from a live run: 201", r.status === 201, r);
    const j = await row(r.body.id);
    ok("stored as an agent's, with its run", j.source === "agent" && j.proposed_by === "agent:fm1" && j.proposed_run_id === fm1, j);
    const fc = await run("fc");
    r = await propose(varied(1), { "X-Work-Via": `agent:fc:${fc}` });
    ok("the FC: 201", r.status === 201, r);
    const ap = await run("ap-clerk");
    r = await propose(varied(2), { "X-Work-Via": `agent:ap-clerk:${ap}` });
    ok("AP clerk refused", r.status === 403, r);
    r = await propose(varied(3), { "X-Work-Via": "claude" });
    ok("Claude through the MCP refused", r.status === 403, r);
    r = await propose(varied(4), { "X-Work-Via": `agent:fm1:${fc}` });
    ok("a run of another agent refused", r.status === 403, r);
    const done = await run("fm1", "succeeded");
    r = await propose(varied(5), { "X-Work-Via": `agent:fm1:${done}` });
    ok("a finished run refused", r.status === 403, r);
    const { reason, ...noReason } = varied(6);
    r = await propose(noReason, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("an agent must give its reason", r.status === 422 && reason, r);
  });

  await section("only the CFO approves, and only a person", async () => {
    await seed();
    const fm1 = await run("fm1");
    const { body: { id } } = await propose(ACCRUAL, { "X-Work-Via": `agent:fm1:${fm1}` });
    let r = await api("POST", `journals/${id}/approve`, {}, { "X-Actor-Email": BOOK });
    ok("bookkeeper refused", r.status === 403 && /Only the CFO/.test(r.body.error), r);
    r = await api("POST", `journals/${id}/approve`, {}, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("an agent cannot approve, even as the CFO", r.status === 403, r);
    r = await api("POST", `journals/${id}/reject`, {}, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("an agent cannot reject", r.status === 403, r);
    ok("still proposed, nothing in Xero", (await row(id)).state === "proposed" && state.drafts.length === 0);
  });

  await section("approve creates exactly one Xero draft", async () => {
    await seed();
    const { body: { id } } = await propose();
    let r = await api("POST", `journals/${id}/approve`, {});
    ok("approved: drafted", r.status === 200 && r.body.drafted === true && r.body.journal_number === 201, r);
    ok("one draft, as DRAFT, under the journal's key", state.drafts.length === 1 && state.drafts[0].Status === "DRAFT" && state.keys[0] === `journal-${id}-1`, { d: state.drafts, k: state.keys });
    ok("the stored lines went", state.drafts[0].JournalLines.map((l) => `${l.AccountCode}:${l.LineAmount}`).join() === "485:250,825:-250", state.drafts[0]);
    const j = await row(id);
    ok("recorded", j.state === "draft_created" && j.xero_journal_id === "mj-1" && j.xero_journal_no === "201" && j.approved_by === CFO, j);
    r = await api("POST", `journals/${id}/approve`, {});
    ok("approving again is refused", r.status === 409, r);
    ok("still one draft", state.drafts.length === 1);
    r = await api("POST", `journals/${id}/reject`, {});
    ok("a draft cannot be rejected here", r.status === 409, r);
    const audit = (await pool.query("SELECT action FROM finance.audit_log WHERE target_id = $1 ORDER BY occurred_at", [id])).rows.map((a) => a.action);
    ok("audited", audit.includes("journal_proposed") && audit.includes("journal_approved"), audit);
  });

  await section("two approvals at once make one draft", async () => {
    await seed();
    const { body: { id } } = await propose();
    const [a, b] = await Promise.all([api("POST", `journals/${id}/approve`, {}), api("POST", `journals/${id}/approve`, {})]);
    ok("one drafted, the other refused", [a, b].filter((x) => x.body.drafted).length === 1 && [a, b].some((x) => x.status === 409), [a, b]);
    ok("one draft in Xero", state.drafts.length === 1, state.drafts.length);
    ok("recorded once", (await row(id)).state === "draft_created");
  });

  await section("reject", async () => {
    await seed();
    const { body: { id } } = await propose();
    let r = await api("POST", `journals/${id}/reject`, {}, { "X-Actor-Email": BOOK });
    ok("bookkeeper refused", r.status === 403, r);
    r = await api("POST", `journals/${id}/reject`, {});
    ok("CFO rejects", r.status === 200 && (await row(id)).state === "rejected", r);
    r = await api("POST", `journals/${id}/approve`, {});
    ok("a rejected journal cannot be approved", r.status === 409 && state.drafts.length === 0, r);
    r = await propose();
    ok("and can be proposed again", r.status === 201, r);
  });

  await section("Xero definitely refused: approve again on a new key", async () => {
    await seed();
    const { body: { id } } = await propose();
    state.xeroFails = 400;
    let r = await api("POST", `journals/${id}/approve`, {});
    state.xeroFails = null;
    ok("reported", r.status === 502 && /Xero refused it \(400\): refused/.test(r.body.error), r);
    let j = await row(id);
    ok("stays approved, with why", j.state === "approved" && /refused/.test(j.last_error) && j.attempts === 1, j);
    const list = (await api("GET", "journals?period=2026-10")).body;
    ok("the list says it can be tried again", list.journals[0].retry_state === "retry" && list.journals[0].can_retry === true, list.journals[0]);
    r = await api("POST", `journals/${id}/approve`, {});
    j = await row(id);
    ok("second attempt drafted", r.status === 200 && j.state === "draft_created" && j.attempts === 2, { r, j });
    ok("on the next key", state.keys[0] === `journal-${id}-2` && state.drafts.length === 1, state.keys);
  });

  await section("an unknown outcome: not created twice", async () => {
    await seed();
    const { body: { id } } = await propose();
    state.xeroFails = 503;
    let r = await api("POST", `journals/${id}/approve`, {});
    state.xeroFails = null;
    ok("reported", r.status === 502, r);
    r = await api("POST", `journals/${id}/approve`, {});
    ok("approving again refused: check Xero", r.status === 409 && /may already be in Xero/.test(r.body.error), r);
    ok("nothing new sent", state.drafts.length === 0);
    r = await api("POST", `journals/${id}/reject`, {});
    ok("reject needs the check", r.status === 409, r);
    r = await api("POST", `journals/${id}/reject`, { confirmed_not_in_xero: true });
    const j = await row(id);
    ok("rejected after the check", r.status === 200 && j.state === "rejected" && j.rejected_after_check === true, j);
  });

  await section("refused before Xero: back to waiting", async () => {
    await seed();
    const { body: { id } } = await propose();
    state.lock = "2026-10-31";
    const r = await api("POST", `journals/${id}/approve`, {});
    state.lock = null;
    const j = await row(id);
    ok("422 with the reason", r.status === 422 && /lock date/.test(r.body.error), r);
    ok("proposed again, with why, no approver", j.state === "proposed" && /lock date/.test(j.last_error) && !j.approved_by, j);
    ok("nothing sent", state.drafts.length === 0);
  });

  await section("posted in Xero is noticed", async () => {
    await seed();
    const { body: { id } } = await propose();
    await api("POST", `journals/${id}/approve`, {});
    let r = await api("POST", "journals/refresh", { period: "2026-10" });
    ok("still a draft", r.status === 200 && r.body.checked === 1 && r.body.posted === 0 && (await row(id)).state === "draft_created", r);
    state.status["mj-1"] = "POSTED";
    r = await api("POST", "journals/refresh", { period: "2026-10" });
    const j = await row(id);
    ok("posted", r.body.posted === 1 && j.state === "posted" && j.xero_status === "POSTED" && j.xero_checked_at, { r, j });
    r = await api("POST", "journals/refresh", { period: "2026-13" });
    ok("bad period 400", r.status === 400, r);
  });

  await section("the list combines rec journals", async () => {
    await seed();
    const { body: { id } } = await propose();
    const acct = (await pool.query("INSERT INTO finance.rec_accounts (client_id, account_key, account_name) VALUES ($1,'assetprepayments','Prepayments') RETURNING id", [CID])).rows[0].id;
    const rec = (await pool.query("INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, proof) VALUES ($1,$2,'2026-10','2026-10-31','schedule') RETURNING id", [CID, acct])).rows[0].id;
    const r1 = await run("fm1", "succeeded");
    await pool.query(
      `INSERT INTO finance.rec_journals (client_id, rec_id, entity_id, journal_date, narration, lines, reason, proposed_by, proposed_run_id)
       VALUES ($1,$2,$3,'2026-10-31','Insurance release October',$4,'Release missing','agent:fm1',$5)`,
      [CID, rec, EA, JSON.stringify([{ account_code: "485", amount: 600 }, { account_code: "620", amount: -600 }]), r1]);
    const list = (await api("GET", "journals?period=2026-10")).body;
    ok("both listed", list.journals.length === 2 && list.counts.waiting === 2, list);
    const fromRec = list.journals.find((j) => j.kind === "rec");
    ok("the rec's, read-only, with its rec", fromRec.source === "rec" && fromRec.rec.id === rec && fromRec.rec.account_name === "Prepayments" && fromRec.total === "600.00", fromRec);
    const own = list.journals.find((j) => j.kind === "register");
    ok("the register's, with source and total", own.id === id && own.source === "person" && own.total === "250.00" && own.entity_name === "Alpha Ltd", own);
    ok("companies for the form", list.entities.length === 1 && list.entities[0].slug === "alpha-ltd", list.entities);
    const other = (await api("GET", "journals?period=2026-09")).body;
    ok("another month is empty", other.journals.length === 0, other);
    ok("bad period 400", (await api("GET", "journals?period=2026-13")).status === 400);
    // The rec's journal cannot be decided here: it is not in the register.
    const fromHere = await api("POST", `journals/${fromRec.id}/approve`, {});
    ok("a rec journal is approved on its rec, not here", fromHere.status === 404 && state.drafts.length === 0, fromHere);
  });

  await section("the rec gate still holds for the register", async () => {
    await seed();
    const acct = (await pool.query("INSERT INTO finance.rec_accounts (client_id, account_key, account_name) VALUES ($1,'assetprepayments','Prepayments') RETURNING id", [CID])).rows[0].id;
    const rec = (await pool.query("INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, proof) VALUES ($1,$2,'2026-10','2026-10-31','schedule') RETURNING id", [CID, acct])).rows[0].id;
    await pool.query("INSERT INTO finance.rec_balances (rec_id, entity_id, account_code, account_name) VALUES ($1,$2,'620','Prepayments')", [rec, EA]);
    const r1 = await run("fm1", "succeeded");
    const lines = [{ account_code: "485", amount: 600 }, { account_code: "620", amount: -600 }];
    await pool.query(
      `INSERT INTO finance.rec_journals (client_id, rec_id, entity_id, journal_date, narration, lines, proposed_by, proposed_run_id)
       VALUES ($1,$2,$3,'2026-10-31','Insurance release October',$4,'agent:fm1',$5)`, [CID, rec, EA, JSON.stringify(lines), r1]);
    const { body: { id } } = await propose({ ...ACCRUAL, narration: "Insurance release", lines });
    const r = await api("POST", `journals/${id}/approve`, {});
    ok("the same journal waiting on a rec is not drafted from here", r.status === 422 && /reconciliation/.test(r.body.error) && state.drafts.length === 0, r);
    ok("back to waiting", (await row(id)).state === "proposed");
  });

  await section("a chat approval cannot send a journal waiting here", async () => {
    await seed();
    const { body: { id } } = await propose();
    const raw = async (body) => {
      const r = await realFetch(`${base}/api/finance/clients/${SLUG}/xero/alpha-ltd/journals`, {
        method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body, status: "DRAFT",
          approval: { approved_by: CFO, approved_at: new Date().toISOString(), presented_text: `Alpha Ltd ${body.date} ${body.lines.map((l) => `${l.account_code} ${Math.abs(l.amount).toFixed(2)}`).join(" ")}`, agreed_text: "approved" },
        }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    let r = await raw(ACCRUAL);
    ok("held at the journal write", r.status === 422 && r.body.issues?.[0]?.code === "JOURNAL_APPROVAL_REQUIRED", r);
    ok("nothing sent", state.drafts.length === 0);
    await api("POST", `journals/${id}/reject`, {});
    r = await raw(ACCRUAL);
    ok("a rejected one is held too", r.status === 422 && /rejected/.test(r.body.issues?.[0]?.detail), r);
    r = await raw(varied(9));
    ok("another journal goes as before", r.status === 201 && state.drafts.length === 1, r);
  });

  await section("missing table is tolerated", async () => {
    await seed();
    const { Pool } = require("pg");
    const owner = new Pool({ host: "127.0.0.1", port: Number(process.env.DB_PORT), user: "postgres", password: "x", database: "t" });
    await owner.query("ALTER TABLE finance.journals RENAME TO journals_hidden");
    try {
      const r = await api("GET", "journals?period=2026-10");
      ok("list says migration missing", r.status === 200 && r.body.migration_missing === true, r);
      const w = await propose();
      ok("write says 503", w.status === 503 && w.body.migration_missing === true, w);
    } finally {
      await owner.query("ALTER TABLE finance.journals_hidden RENAME TO journals");
      await owner.end();
    }
  });

  console.log(`\n${pass} passed, ${failures.length} failed`);
}

(async () => {
  await new Promise((done) => { app.listen(8789, "127.0.0.1", done); });
  base = "http://127.0.0.1:8789";
  await scenario();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

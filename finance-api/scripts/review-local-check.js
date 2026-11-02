// The Review inbox, end to end: the real server.js on a real, local, throwaway
// Postgres. Rows are put straight into each source table, as the source screens
// would leave them, and the inbox is read back as the CFO, the FC, and someone
// with no role. Xero and Secret Manager are faked; any other network host
// throws, so this cannot reach Xero or a live database. The inbox writes
// nothing, and this checks that too.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it on port 54329, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 033.
//   3. node scripts/review-local-check.js          (from finance-api)

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

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  throw new Error(`blocked host ${u.hostname}`);
};

const { app, pool } = require("../server.js");

const SLUG = "sample-review";
const CFO = "cfo@example.com";
const FC = "fc@example.com";
const BOOK = "clerk@example.com";
let base, CID, EA;
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
const api = async (method, path, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, { method, headers: { "X-API-Key": "k", ...headers } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const as = (email) => api("GET", "review", email ? { "X-Actor-Email": email } : {});

async function seed() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Ltd') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Financial Controller'),($1,$4,'Bookkeeper')", [CID, CFO, FC, BOOK]);
  EA = (await pool.query("INSERT INTO finance.entities (client_id, slug, name) VALUES ($1,'alpha-ltd','Alpha Ltd') RETURNING id", [CID])).rows[0].id;
}
const run = async (agent, status) => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Close October',$4) RETURNING id", [CID, CFO, agent, status])).rows[0].id;
const sha = (n) => String(n).repeat(64).slice(0, 64);

// One of everything, each at a known age, plus what must stay out.
async function fill() {
  const runId = await run("ap-clerk", "succeeded");
  const bill = (n, state, extra = {}) => pool.query(
    `INSERT INTO finance.ap_items (client_id, entity_id, xero_file_id, file_name, file_sha256, document_index, run_id, state, state_reason, proposed_bill,
                                   review, recommendation, decided_by_email, decided_at, xero_invoice_id, written_at, decision_note, created_at)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [CID, EA, `file-${n}`, `bill-${n}.pdf`, sha(n), runId, state, extra.reason ?? null,
      JSON.stringify({ Contact: { Name: `Supplier ${n}` }, InvoiceNumber: `INV-${n}`, Total: "120.00", CurrencyCode: "GBP" }),
      JSON.stringify({ reasons: [{ check: "duplicate", detail: "x" }] }),
      extra.recommendation ? JSON.stringify(extra.recommendation) : null,
      extra.decided ? CFO : null, extra.decided ? "2026-10-25T09:00:00Z" : null,
      state === "written" ? "inv-x" : null, state === "written" ? "2026-10-26T09:00:00Z" : null,
      state === "rejected" ? "not ours" : null, extra.created ?? "2026-10-10T09:00:00Z"]).then((r) => r.rows[0].id);
  const reviewed = { agent: "ap-clerk", at: "2026-10-12T09:00:00Z", lines: [], note: "coded", review: { verdict: "agree", agent: "fm2", at: "2026-10-13T09:00:00Z" }, reviews: [{ verdict: "agree", agent: "fm2", at: "2026-10-13T09:00:00Z" }] };
  const ids = {};
  ids.billCfo = await bill(1, "exception", { recommendation: reviewed });
  ids.billApproved = await bill(2, "approved", { recommendation: reviewed, decided: true });
  ids.billWritten = await bill(3, "written", { recommendation: reviewed, decided: true });
  ids.billSkipped = await bill(4, "skipped", { reason: "a statement" });

  const acct = (await pool.query("INSERT INTO finance.rec_accounts (client_id, account_key, account_name) VALUES ($1,'k-pre','Prepayments') RETURNING id", [CID])).rows[0].id;
  const acct2 = (await pool.query("INSERT INTO finance.rec_accounts (client_id, account_key, account_name) VALUES ($1,'k-acc','Accruals') RETURNING id", [CID])).rows[0].id;
  const acct3 = (await pool.query("INSERT INTO finance.rec_accounts (client_id, account_key, account_name) VALUES ($1,'k-vat','VAT') RETURNING id", [CID])).rows[0].id;
  const rec = (a, period, status, extra = {}) => pool.query(
    `INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, proof, status, prepared_by, prepared_at, reviewed_at, review_note, dropped_at)
     VALUES ($1,$2,$3,$4,'schedule',$5,$6,$7,$8,$9,$10) RETURNING id`,
    [CID, a, period, `${period}-28`, status, extra.prepared_by ?? "agent:fm1", extra.prepared_at ?? null, extra.reviewed_at ?? null, extra.note ?? null, extra.dropped ?? null]).then((r) => r.rows[0].id);
  ids.recFc = await rec(acct, "2026-10", "with_fc", { prepared_at: "2026-11-01T09:00:00Z" });
  ids.recCfo = await rec(acct2, "2026-10", "with_cfo", { prepared_at: "2026-10-20T09:00:00Z", reviewed_at: "2026-10-21T09:00:00Z" });
  ids.recBack = await rec(acct3, "2026-10", "sent_back", { note: "Item 3 needs its invoice" });
  ids.recSigned = await rec(acct, "2026-09", "signed_off");
  ids.recDropped = await rec(acct2, "2026-09", "with_cfo", { dropped: "2026-10-01T00:00:00Z" });

  const fm1 = await run("fm1", "succeeded");
  const lines = JSON.stringify([{ account_code: "485", amount: 600 }, { account_code: "620", amount: -600 }]);
  const rj = (state, extra = {}) => pool.query(
    `INSERT INTO finance.rec_journals (client_id, rec_id, entity_id, journal_date, narration, lines, proposed_by, proposed_run_id, state, approved_by, approved_at, approved_run_id, created_at)
     VALUES ($1,$2,$3,'2026-10-31',$4,$5,'agent:fm1',$6,$7,$8,$9,$10,$11) RETURNING id`,
    [CID, extra.rec ?? ids.recFc, EA, extra.narration ?? "Insurance release October", lines, fm1, state,
      state === "proposed" ? null : CFO, state === "proposed" ? null : "2026-10-28T09:00:00Z", extra.runId ?? null, extra.created ?? "2026-10-27T09:00:00Z"]).then((r) => r.rows[0].id);
  ids.rjProposed = await rj("proposed");
  // Approved, its follow-up run still going: not waiting on anyone yet.
  const live = (await pool.query(
    "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status, queued_at) VALUES ($1,$2,'fm1','approve','running', now()) RETURNING id", [CID, CFO])).rows[0].id;
  ids.rjLive = await rj("approved", { narration: "Rent release October", runId: live, rec: ids.recCfo });
  // Approved, the run finished without a draft: the CFO approves again.
  const done = await run("fm1", "succeeded");
  ids.rjGo = await rj("approved", { narration: "Software release October", runId: done, rec: ids.recBack });

  const j = (state, extra = {}) => pool.query(
    `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, source, proposed_by, state, approved_by, approved_at, last_error, created_at)
     VALUES ($1,$2,'2026-10','2026-10-31',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [CID, EA, extra.narration ?? "October audit fee accrual", lines, extra.source ?? "person", extra.by ?? BOOK, state,
      state === "proposed" ? null : CFO, state === "proposed" ? null : "2026-10-29T09:00:00Z", extra.error ?? null, extra.created ?? "2026-10-30T09:00:00Z"]).then((r) => r.rows[0].id);
  ids.jProposed = await j("proposed");
  ids.jRefused = await j("approved", { narration: "Bonus accrual", error: "Xero refused it" });
  await pool.query(
    `INSERT INTO finance.journal_posts (client_id, entity_id, idempotency_key, actor_email, request_fingerprint, outcome, response_body)
     VALUES ($1,$2,$3,$4,'fp','failed','{"http_status":400}')`, [CID, EA, `journal-${ids.jRefused}-1`, CFO]);
  ids.jDraft = await j("draft_created", { narration: "Already in Xero" });
  ids.jRejected = await j("rejected", { narration: "Not wanted" });

  const wip = (ref, status, panel, extra = {}) => pool.query(
    `INSERT INTO finance.wip_items (client_id, ref, type, status, panel, title, folder_path, entity_scope, blocked_on, drafter_agent, updated_at)
     VALUES ($1,$2,'ap',$3,$4,$5,$6,'group',$7,'ap-clerk',$8) RETURNING id`,
    [CID, ref, status, panel, extra.title ?? `Batch ${ref}`, `wip/${status}/ap/${ref}`, extra.blocked ?? null, extra.updated ?? "2026-10-05T09:00:00Z"]).then((r) => r.rows[0].id);
  ids.wCfo = await wip("AP-1", "pending-cfo", "awaiting-decision");
  ids.wFm = await wip("AP-2", "pending-fm", "in-progress-upstream");
  ids.wOut = await wip("AP-3", "pending-cfo", "blocked-external", { blocked: "the bank" });
  ids.wDone = await wip("AP-4", "posted", "activity");
  ids.wSoon = await wip("AP-5", "drafting", "upcoming");
  return ids;
}

async function scenario() {
  let ids;
  await section("an empty client", async () => {
    await seed();
    const r = await as(CFO);
    ok("200 and nothing waiting", r.status === 200 && r.body.items.length === 0 && r.body.counts.total === 0 && r.body.missing.length === 0, r.body);
    ok("the viewer is read", r.body.viewer.role === "Fractional CFO" && r.body.viewer.waits_as === "CFO", r.body.viewer);
  });

  await section("every source, as the CFO", async () => {
    await seed();
    ids = await fill();
    const r = await as(CFO);
    const by = new Map(r.body.items.map((i) => [i.id, i]));
    ok("200", r.status === 200, r);
    const want = [ids.billCfo, ids.billApproved, ids.recFc, ids.recCfo, ids.recBack, ids.rjProposed, ids.rjGo, ids.jProposed, ids.jRefused, ids.wCfo, ids.wFm, ids.wOut];
    ok("each waiting item is listed once", want.every((id) => by.has(id)) && r.body.items.length === want.length, r.body.items.map((i) => [i.kind, i.title]));
    const out = [ids.billWritten, ids.billSkipped, ids.recSigned, ids.recDropped, ids.rjLive, ids.jDraft, ids.jRejected, ids.wDone, ids.wSoon];
    ok("finished, dropped, in-flight and upcoming are left out", out.every((id) => !by.has(id)));
    ok("oldest first", r.body.items.every((i, n, a) => n === 0 || !i.since || !a[n - 1].since || a[n - 1].since <= i.since), r.body.items.map((i) => i.since));
    ok("a bill no agent is on waits on the CFO", by.get(ids.billCfo).waiting_on === "CFO" && by.get(ids.billCfo).for_you === true && by.get(ids.billCfo).amount === "120.00");
    ok("bill links to its item on Bills", by.get(ids.billCfo).href === `/finance/clients/${SLUG}/bills?entity=alpha-ltd&tab=exceptions&item=${ids.billCfo}`, by.get(ids.billCfo).href);
    ok("rec with the FC is not the CFO's", by.get(ids.recFc).waiting_on === "FC" && by.get(ids.recFc).for_you === false);
    ok("rec for sign-off is the CFO's", by.get(ids.recCfo).waiting_on === "CFO" && by.get(ids.recCfo).for_you === true && by.get(ids.recCfo).since === "2026-10-21T09:00:00.000Z");
    ok("sent back says why", by.get(ids.recBack).waiting_on === "Preparer" && /Item 3/.test(by.get(ids.recBack).status));
    ok("rec journal links to its rec", by.get(ids.rjProposed).kind === "rec_journal" && by.get(ids.rjProposed).href.endsWith(`/reconciliations/${ids.recFc}`) && by.get(ids.rjProposed).amount === "600.00");
    ok("rec journal whose run ended asks again", /Approve again/.test(by.get(ids.rjGo).status), by.get(ids.rjGo));
    ok("register journal links to its month", by.get(ids.jProposed).href === `/finance/clients/${SLUG}/journals?period=2026-10` && by.get(ids.jProposed).produced_by === BOOK);
    ok("refused register journal says so", /refused/.test(by.get(ids.jRefused).status) && /Xero refused it/.test(by.get(ids.jRefused).status), by.get(ids.jRefused));
    ok("Approvals folders: CFO, FM and outside", by.get(ids.wCfo).waiting_on === "CFO" && by.get(ids.wFm).waiting_on === "FM" && by.get(ids.wOut).waiting_on === "Outside");
    ok("Approvals item links to the board", by.get(ids.wCfo).href === `/finance/clients/${SLUG}/approvals?item=AP-1`);
    const mine = r.body.items.filter((i) => i.for_you).length;
    ok("counts agree with the list", r.body.counts.total === want.length && r.body.counts.for_you === mine && r.body.counts.by_kind.bill === 2, r.body.counts);
  });

  await section("the same inbox as the FC and as someone without a review role", async () => {
    const fc = await as(FC);
    ok("the FC's own queue is the FC rec", fc.body.viewer.waits_as === "FC" && fc.body.items.filter((i) => i.for_you).map((i) => i.id).join() === ids.recFc, fc.body.items.filter((i) => i.for_you));
    const book = await as(BOOK);
    ok("a bookkeeper sees it all, none marked theirs", book.body.items.length === fc.body.items.length && book.body.items.every((i) => !i.for_you));
    const none = await as(null);
    ok("no viewer: the list, nothing marked", none.status === 200 && none.body.viewer.role === null && none.body.items.every((i) => !i.for_you));
  });

  await section("an agent at work moves a bill off the CFO", async () => {
    await pool.query("UPDATE finance.ap_items SET recommendation = NULL WHERE id = $1", [ids.billCfo]);
    let r = await as(CFO);
    let b = r.body.items.find((i) => i.id === ids.billCfo);
    ok("not recommended and no clerk running: still the CFO's", b.waiting_on === "CFO", b);
    await run("ap-clerk", "running");
    r = await as(CFO);
    b = r.body.items.find((i) => i.id === ids.billCfo);
    ok("the clerk running: with the preparer, on the agents tab", b.waiting_on === "Preparer" && b.for_you === false && /tab=agents/.test(b.href), b);
  });

  await section("the badge", async () => {
    const full = await as(CFO);
    const c = await api("GET", "review/count", { "X-Actor-Email": CFO });
    ok("count matches the list", c.status === 200 && c.body.total === full.body.counts.total && c.body.for_you === full.body.counts.for_you && Array.isArray(c.body.missing), c.body);
    const nf = await realFetch(`${base}/api/finance/clients/no-such-client/review`, { headers: { "X-API-Key": "k" } });
    ok("unknown client 404", nf.status === 404);
    const nokey = await realFetch(`${base}/api/finance/clients/${SLUG}/review`);
    ok("no key 401", nokey.status === 401);
  });

  await section("read-only", async () => {
    const before = (await pool.query(
      `SELECT (SELECT count(*) FROM finance.audit_log WHERE client_id = $1) + (SELECT count(*) FROM finance.rec_events WHERE client_id = $1) AS n,
              (SELECT string_agg(state, ',' ORDER BY id) FROM finance.ap_items WHERE client_id = $1) AS bills,
              (SELECT string_agg(status, ',' ORDER BY id) FROM finance.recs WHERE client_id = $1) AS recs,
              (SELECT string_agg(state, ',' ORDER BY id) FROM finance.journals WHERE client_id = $1) AS js`, [CID])).rows[0];
    await as(CFO);
    await api("GET", "review/count", { "X-Actor-Email": CFO });
    const after = (await pool.query(
      `SELECT (SELECT count(*) FROM finance.audit_log WHERE client_id = $1) + (SELECT count(*) FROM finance.rec_events WHERE client_id = $1) AS n,
              (SELECT string_agg(state, ',' ORDER BY id) FROM finance.ap_items WHERE client_id = $1) AS bills,
              (SELECT string_agg(status, ',' ORDER BY id) FROM finance.recs WHERE client_id = $1) AS recs,
              (SELECT string_agg(state, ',' ORDER BY id) FROM finance.journals WHERE client_id = $1) AS js`, [CID])).rows[0];
    ok("reading changes nothing", JSON.stringify(before) === JSON.stringify(after), { before, after });
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await realFetch(`${base}/api/finance/clients/${SLUG}/review`, { method: m, headers: { "X-API-Key": "k", "X-Actor-Email": CFO } });
      ok(`${m} /review does not exist`, r.status === 404);
    }
  });

  await section("a source not migrated is skipped and named", async () => {
    const { Pool } = require("pg");
    const owner = new Pool({ host: "127.0.0.1", port: Number(process.env.DB_PORT), user: "postgres", password: "x", database: "t" });
    await owner.query("ALTER TABLE finance.journals RENAME TO journals_hidden");
    await owner.query("ALTER TABLE finance.wip_items RENAME TO wip_items_hidden");
    try {
      const r = await as(CFO);
      const names = r.body.missing.map((m) => m.source).sort().join();
      ok("200, journals and approvals named", r.status === 200 && names === "approvals,journals", r.body.missing);
      ok("the rest still listed", r.body.items.some((i) => i.kind === "bill") && r.body.items.some((i) => i.kind === "rec") && r.body.items.some((i) => i.kind === "rec_journal")
        && !r.body.items.some((i) => i.kind === "journal" || i.kind === "approval"), r.body.items.map((i) => i.kind));
      const c = await api("GET", "review/count", { "X-Actor-Email": CFO });
      ok("the badge names them too", c.body.missing.sort().join() === "approvals,journals", c.body);
    } finally {
      await owner.query("ALTER TABLE finance.journals_hidden RENAME TO journals");
      await owner.query("ALTER TABLE finance.wip_items_hidden RENAME TO wip_items");
      await owner.end();
    }
  });

  console.log(`\n${pass} passed, ${failures.length} failed`);
}

(async () => {
  await new Promise((done) => { app.listen(8790, "127.0.0.1", done); });
  base = "http://127.0.0.1:8790";
  await scenario();
  process.exit(failures.length ? 1 : 0);
})();

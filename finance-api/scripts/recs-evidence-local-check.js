// Reconciliations proved by evidence, end to end: the real server.js on a real,
// local, throwaway Postgres, with Xero and Secret Manager faked inside this
// process. Any other network host throws, so this cannot reach Xero or a live
// database. Sample data only.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it on port 54329, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 042.
//   3. node scripts/recs-evidence-local-check.js      (from finance-api)

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
const accounts = (rows) => rows.map(([AccountID, Code, Name, Class, Type, SystemAccount]) => ({ AccountID, Code, Name, Class, Type, SystemAccount, Status: "ACTIVE" }));

const CHART = {
  a: accounts([
    ["a-ar", "610", "Accounts Receivable", "ASSET", "CURRENT", "DEBTORS"],
    ["a-ic", "615", "Beta intercompany", "ASSET", "CURRENT"],
    ["a-cap", "950", "Capital - Ordinary Shares", "EQUITY", "EQUITY"],
    ["a-bank", "090", "HSBC Innovation", "ASSET", "BANK"],
    ["a-dla", "835", "Directors' Loan Account", "LIABILITY", "CURRLIAB"],
  ]),
  b: accounts([
    ["b-ap", "800", "Accounts Payable", "LIABILITY", "CURRLIAB", "CREDITORS"],
    ["b-ic", "816", "Alpha intercompany", "LIABILITY", "CURRLIAB"],
    ["b-cap", "950", "Capital - Ordinary Shares", "EQUITY", "EQUITY"],
  ]),
};
const tbs = {
  "a:2026-10-31": () => [row("a-ar", "Accounts Receivable", "610", 300, 0, 300, 0), row("a-ic", "Beta intercompany", "615", 0, 0, 44374.92, 0),
    row("a-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 100), row("a-bank", "HSBC Innovation", "090", 0, 0, 3888.40, 0), row("a-dla", "Directors' Loan Account", "835", 0, 0, 0, 5000)],
  "a:2026-09-30": () => [row("a-ic", "Beta intercompany", "615", 0, 0, 44374.92, 0), row("a-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 100),
    row("a-bank", "HSBC Innovation", "090", 0, 0, 3888.40, 0), row("a-dla", "Directors' Loan Account", "835", 0, 0, 0, 5000)],
  "a:2026-11-30": () => [row("a-ar", "Accounts Receivable", "610", 0, 0, 300, 0), row("a-ic", "Beta intercompany", "615", 0, 0, 44374.92, 0),
    row("a-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 100), row("a-bank", "HSBC Innovation", "090", 0, 0, 3888.40, 0), row("a-dla", "Directors' Loan Account", "835", 0, 0, 0, 5000)],
  "b:2026-10-31": () => [row("b-ap", "Accounts Payable", "800", 0, 250, 0, 250), row("b-ic", "Alpha intercompany", "816", 0, 0, 0, 43704.92), row("b-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 2)],
  "b:2026-09-30": () => [row("b-ic", "Alpha intercompany", "816", 0, 0, 0, 43704.92), row("b-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 2)],
  "b:2026-11-30": () => [row("b-ap", "Accounts Payable", "800", 0, 0, 0, 250), row("b-ic", "Alpha intercompany", "816", 0, 0, 0, 43704.92), row("b-cap", "Capital - Ordinary Shares", "950", 0, 0, 0, 2)],
};
const INVOICES = {
  a: [
    { InvoiceID: "i1", Type: "ACCREC", Status: "PAID", DateString: "2026-10-10T00:00:00", Total: 500, Payments: [{ DateString: "2026-10-20T00:00:00", Amount: 200 }, { DateString: "2026-11-05T00:00:00", Amount: 300 }] },
    { InvoiceID: "i2", Type: "ACCREC", Status: "AUTHORISED", DateString: "2026-11-02T00:00:00", Total: 999 },
  ],
  b: [{ InvoiceID: "p1", Type: "ACCPAY", Status: "AUTHORISED", DateString: "2026-10-12T00:00:00", Total: 300 }],
};
const CREDIT_NOTES = { a: [], b: [{ CreditNoteID: "c1", Type: "ACCPAYCREDIT", Status: "AUTHORISED", DateString: "2026-10-20T00:00:00", Total: 40 }] };

const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const xeroCalls = [];
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") throw new Error("evidence must only read Xero");
  const h = opts.headers ?? {};
  const t = String(h["Xero-Tenant-Id"] ?? "").replace("tenant-", "");
  xeroCalls.push(`${t}${u.pathname}?${u.searchParams.get("where") ?? ""}`);
  const page = Number(u.searchParams.get("page") || 1);
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: CHART[t] });
  if (u.pathname.endsWith("/Reports/TrialBalance")) {
    const f = tbs[`${t}:${u.searchParams.get("date")}`];
    return json({ Reports: [{ Rows: [{ RowType: "Section", Rows: f ? f() : [] }] }] });
  }
  if (u.pathname.endsWith("/Invoices")) {
    const type = /Type=="(\w+)"/.exec(u.searchParams.get("where") ?? "")?.[1];
    return json({ Invoices: page === 1 ? INVOICES[t].filter((i) => i.Type === type) : [] });
  }
  if (u.pathname.endsWith("/CreditNotes")) return json({ CreditNotes: page === 1 ? CREDIT_NOTES[t] : [] });
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ BaseCurrency: "GBP" }] });
  return json({}, 404);
};

const { app, pool } = require("../server.js");

const CFO = "cfo@example.com";
const FC = "fc@example.com";
let base, CID, EA, EB;
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
  const r = await realFetch(`${base}/api/finance/clients/sample-evidence/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function seed() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = 'sample-evidence'");
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ('sample-evidence','Sample Group') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Financial Controller')", [CID, CFO, FC]);
  const ent = async (slug, name, t) => (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,$2,$3,$4) RETURNING id", [CID, slug, name, JSON.stringify({ tenant_id: `tenant-${t}`, tenant_name: name })])).rows[0].id;
  EA = await ent("alpha-ltd", "Alpha Ltd", "a");
  EB = await ent("beta-ltd", "Beta Ltd", "b");
}
const run = async (agent, status = "running") => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Prepare',$4) RETURNING id", [CID, CFO, agent, status])).rows[0].id;
const byName = (list, n) => list.recs.find((x) => x.account_name.startsWith(n));

async function scenario() {
  let list, fm1;
  await section("compose: evidence recs can be worked; a bank account is never VAT", async () => {
    await seed();
    await api("POST", "recs/compose", { period: "2026-10" });
    list = (await api("GET", "recs?period=2026-10")).body;
    ok("AR, AP, intercompany, capital and the loan are workable", ["Accounts Receivable", "Accounts Payable", "Beta intercompany", "Alpha intercompany", "Capital", "Directors' Loan"].every((n) => byName(list, n)?.workable), list.recs.map((r) => [r.account_name, r.line_key, r.workable]));
    const bank = byName(list, "HSBC Innovation");
    ok("HSBC Innovation is cash, not VAT", bank.line_key === "cash" && bank.proof === "outside_evidence", bank);
    ok("no evidence yet: support nil, does not tie", byName(list, "Accounts Receivable").support === "0.00" && byName(list, "Accounts Receivable").ties === false, byName(list, "Accounts Receivable"));
    fm1 = { "X-Work-Via": `agent:fm1:${await run("fm1")}` };
  });

  await section("receivables from Xero's invoices outstanding at the month end", async () => {
    const id = byName(list, "Accounts Receivable").id;
    const before = (await api("GET", `recs/${id}`)).body;
    ok("the page says how evidence is fetched, and who is missing", before.evidence?.method === "ageing_ar" && before.evidence.missing.join() === "Alpha Ltd", before.evidence);
    let r = await api("POST", `recs/${id}/prepare`, { note: "x" }, fm1);
    ok("cannot prepare with no evidence", r.status === 422 && /Add the evidence for Alpha Ltd/.test(r.body.issues.join()), r.body);
    r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    ok("FM1 fetches: 1 invoice, 300.00 outstanding at 31 Oct (paid 200 in Oct, 300 in Nov; the November invoice left out)", r.status === 200 && r.body.fetched === 1 && /1 sales invoice outstanding at 2026-10-31/.test(r.body.said[0]), r.body);
    ok("read only, invoices to the month end", xeroCalls.some((c) => /^a\/api\.xro\/2\.0\/Invoices\?Type=="ACCREC" AND Date <= DateTime\(2026,10,31\)/.test(c)), xeroCalls.slice(-3));
    const after = (await api("GET", `recs/${id}`)).body;
    ok("ties at 300.00", after.cover.ties && after.cover.rows[0].schedule === "300.00" && after.evidence.rows[0].method === "ageing_ar", after.cover);
    r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    ok("fetching again replaces, never doubles", (await api("GET", `recs/${id}`)).body.evidence.rows.length === 1);
    r = await api("POST", `recs/${id}/prepare`, { note: "Agrees to Xero's outstanding invoices at the month end." }, fm1);
    ok("prepared, with the FC", r.status === 200 && r.body.status === "with_fc", r.body);
    r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    ok("no fetching once with a reviewer", r.status === 409, r);
    r = await api("POST", `recs/${id}/review`, { pass: true, note: "Agreed to the aged report." }, { "X-Work-Via": `agent:fc:${await run("fc")}`, "X-Actor-Email": FC });
    r = await api("POST", `recs/${id}/sign-off`, { sole_reviewer: true });
    ok("the CFO signs it off", r.status === 200 && r.body.status === "signed_off", r.body);
    const snap = (await pool.query("SELECT signed_snapshot FROM finance.recs WHERE id = $1", [id])).rows[0].signed_snapshot;
    ok("the evidence is kept with what was signed", snap.evidence?.length === 1 && snap.evidence[0].amount === "300.00", snap.evidence);
    const l2 = (await api("GET", "recs?period=2026-10")).body;
    ok("the list shows the signed support", byName(l2, "Accounts Receivable").support === "300.00" && byName(l2, "Accounts Receivable").ties, byName(l2, "Accounts Receivable"));
  });

  await section("payables: bills less unallocated credit notes, a credit, and a real difference", async () => {
    const id = byName(list, "Accounts Payable").id;
    const r = await api("POST", `recs/${id}/evidence/fetch`, {});
    ok("a person can fetch too", r.status === 200 && /less 1 credit note/.test(r.body.said[0]), r.body);
    const v = (await api("GET", `recs/${id}`)).body;
    ok("evidence -260.00 against a ledger of -250.00: out by 10.00", v.cover.rows[0].schedule === "-260.00" && v.cover.rows[0].variance === "10.00" && !v.cover.ties, v.cover);
    const p = await api("POST", `recs/${id}/prepare`, { note: "" }, fm1);
    ok("a difference needs the note and the company comment", p.status === 422 && /say why/.test(p.body.issues.join()), p.body);
  });

  await section("intercompany: the pair is chosen by a person, then read reversed", async () => {
    const id = byName(list, "Beta intercompany").id;
    let v = (await api("GET", `recs/${id}`)).body;
    ok("the twin is suggested first, with the difference", v.evidence.method === "counterpart" && v.evidence.candidates[0]?.account_name === "Alpha intercompany" && v.evidence.candidates[0].difference === "670.00", v.evidence);
    let r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    ok("no fetching before the pair is chosen", r.status === 409 && r.body.needs === "counterpart", r.body);
    r = await api("POST", `recs/${id}/counterpart`, { rec_account_id: v.evidence.candidates[0].rec_account_id }, fm1);
    ok("an agent cannot choose the pair", r.status === 403, r);
    r = await api("POST", `recs/${id}/counterpart`, { rec_account_id: v.evidence.candidates[0].rec_account_id });
    ok("the CFO chooses it", r.status === 200, r);
    r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    v = (await api("GET", `recs/${id}`)).body;
    ok("evidence is Beta's balance reversed: 43,704.92 against 44,374.92, out by 670.00", v.cover.rows[0].schedule === "43704.92" && v.cover.rows[0].variance === "670.00" && v.evidence.counterpart?.account_name === "Alpha intercompany", { cover: v.cover, cp: v.evidence.counterpart });
  });

  await section("keyed evidence: share capital, and the rules on it", async () => {
    const id = byName(list, "Capital").id;
    let r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    ok("nothing to carry in the first month", r.status === 409 && /no signed evidence to carry/.test(r.body.error), r.body);
    r = await api("POST", `recs/${id}/evidence`, { entity_id: EA, amount: -100, source: "x" }, fm1);
    ok("a source must say where the figure comes from", r.status === 422, r.body);
    r = await api("POST", `recs/${id}/evidence`, { entity_id: "11111111-2222-3333-4444-555555555555", amount: -100, source: "Confirmation statement" }, fm1);
    ok("only a company on the rec", r.status === 422, r.body);
    r = await api("POST", `recs/${id}/evidence`, { entity_id: EA, amount: -100, source: "Confirmation statement, 1 March 2026", document_ref: "CS01 2026.pdf" }, fm1);
    ok("FM1 keys Alpha's", r.status === 201, r.body);
    r = await api("POST", `recs/${id}/evidence`, { entity_id: EB, amount: -2, source: "Confirmation statement, 1 March 2026" }, { "X-Work-Via": `agent:ap-clerk:${await run("ap-clerk")}` });
    ok("the AP clerk cannot", r.status === 403, r);
    const wrong = await api("POST", `recs/${id}/evidence`, { entity_id: EB, amount: -20, source: "Confirmation statement, 1 March 2026" });
    r = await api("DELETE", `recs/${id}/evidence/${wrong.body.id}`, undefined);
    ok("a wrong entry can be removed", r.status === 200, r);
    await api("POST", `recs/${id}/evidence`, { entity_id: EB, amount: -2, source: "Confirmation statement, 1 March 2026" });
    let v = (await api("GET", `recs/${id}`)).body;
    ok("both companies tie", v.cover.ties && v.evidence.rows.length === 2, v.cover);
    await api("POST", `recs/${id}/prepare`, { note: "Agrees to the confirmation statements." }, fm1);
    await api("POST", `recs/${id}/review`, { pass: true, note: "Agreed." }, { "X-Work-Via": `agent:fc:${await run("fc")}`, "X-Actor-Email": FC });
    r = await api("POST", `recs/${id}/sign-off`, { sole_reviewer: true });
    ok("signed off", r.status === 200, r.body);

    await api("POST", "recs/compose", { period: "2026-11" });
    const nov = (await api("GET", "recs?period=2026-11")).body;
    const nid = byName(nov, "Capital").id;
    r = await api("POST", `recs/${nid}/evidence/fetch`, {}, fm1);
    v = (await api("GET", `recs/${nid}`)).body;
    ok("November: October's signed evidence carried where nothing moved, and it ties", r.status === 200 && v.cover.ties && v.evidence.rows.every((x) => /carried from October 2026/.test(x.source)), { r: r.body, ev: v.evidence.rows });
  });

  await section("start FM1 on every rec the month can work, in one go", async () => {
    await pool.query("UPDATE finance.agent_runs SET status = 'succeeded' WHERE client_id = $1 AND status IN ('queued', 'running')", [CID]);
    let r = await api("POST", "recs/agent-all", { period: "2026-10" }, fm1);
    ok("an agent cannot start the batch", r.status === 403, r);
    r = await api("POST", "recs/agent-all", { period: "October" });
    ok("a bad month refused", r.status === 422, r);
    r = await api("POST", "recs/agent-all", { period: "2026-10" });
    const q = (r.body.queued || []).map((x) => x.account).sort();
    ok("queues the workable recs not with a reviewer", r.status === 200 && q.includes("Accounts Payable") && q.includes("Directors' Loan Account") && !q.includes("Accounts Receivable") && !q.includes("Capital - Ordinary Shares"), r.body);
    ok("an unpaired intercompany rec waits for its pair, with why", (r.body.skipped || []).some((x) => x.account === "Alpha intercompany" && /paired account/.test(x.why)), r.body.skipped);
    const runs = (await pool.query("SELECT agent, status, rec_id, instruction FROM finance.agent_runs WHERE client_id = $1 AND status = 'queued'", [CID])).rows;
    ok("one queued FM1 run per rec, each with its instruction", runs.length === q.length && runs.every((x) => x.agent === "fm1" && x.rec_id && /Reconciliation id/.test(x.instruction)), runs.length);
    r = await api("POST", "recs/agent-all", { period: "2026-10" });
    ok("pressing again starts nothing twice", r.status === 200 && r.body.queued.length === 0 && r.body.skipped.some((x) => /already working/.test(x.why)), r.body);
    const relay = await realFetch(`${base}/api/finance/agent-runs/relay`, { method: "POST", headers: { "X-API-Key": "k" } });
    const rb = await relay.json();
    ok("the relay sees the queue (no cloud runner here, so it stays queued)", relay.status === 200 && rb.queued >= q.length && rb.runner === "queued", rb);
  });

  await section("an account with no automatic source", async () => {
    const id = byName(list, "Directors' Loan").id;
    const r = await api("POST", `recs/${id}/evidence/fetch`, {}, fm1);
    ok("says to record outside evidence", r.status === 409 && /no automatic source/.test(r.body.error), r.body);
    const v = (await api("GET", `recs/${id}`)).body;
    ok("but the page takes keyed evidence", v.evidence && v.evidence.method === null && v.evidence.missing.length === 1, v.evidence);
  });
}

(async () => {
  // `serve`: run the checks, then leave the sample months up on :8788 for the portal.
  if (process.argv[2] === "serve") {
    const server = app.listen(8788, "127.0.0.1");
    base = "http://127.0.0.1:8788";
    await scenario();
    console.log(`${pass} passed, ${failures.length} failed; serving sample-evidence on :8788`);
    return;
  }
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await scenario();
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join("\n")); process.exit(1); }
})();

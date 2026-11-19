// Accruals, end to end (docs/accruals-spec.md): the real server.js on a real,
// local, throwaway Postgres, with Xero and Secret Manager faked inside this
// process. Any other network host throws, so this cannot reach Xero or a live
// database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. A scratch cluster on port 54329, database t, migrations through 062.
//   2. node scripts/accruals-local-check.js                 (from finance-api)
//      node scripts/accruals-local-check.js <backload.json> runs the November
//      acceptance on a client's own back-load file instead of the sample one.

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

const fs = require("fs");
const CHART = [
  ["a-412", "412", "Consultancy", "EXPENSE", "OVERHEADS"], ["a-acc", "805", "Accruals", "LIABILITY", "CURRLIAB"],
  ["a-ct", "830", "Corporation Tax", "LIABILITY", "CURRLIAB"], ["a-bank", "090", "Business Bank", "ASSET", "BANK"],
  ...["510", "511", "512", "515", "516", "441"].map((c) => [`a-${c}`, c, `Expense ${c}`, "EXPENSE", "OVERHEADS"]),
].map(([AccountID, Code, Name, Class, Type]) => ({ AccountID, Code, Name, Class, Type, Status: "ACTIVE" }));

const fresh = () => ({ drafts: [], keys: [], failKey: null, lock: null, bills: {}, tb: {} });
let state = fresh();
const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const tbReport = (closing) => ({ Reports: [{ Rows: [{ RowType: "Section", Rows: closing === undefined ? [] : [{ RowType: "Row", Cells: [
  { Value: "Accruals (805)", Attributes: [{ Id: "account", Value: "a-acc" }] }, { Value: "0" }, { Value: "0" },
  { Value: closing > 0 ? String(closing) : "0" }, { Value: closing < 0 ? String(-closing) : "0" }] }] }] }] });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  const tenant = opts.headers?.["Xero-Tenant-Id"] ?? opts.headers?.["xero-tenant-id"];
  if ((opts.method ?? "GET") !== "GET") {
    if (!u.pathname.endsWith("/ManualJournals")) return json({}, 404);
    const key = opts.headers?.["Idempotency-Key"];
    if (state.failKey && key === state.failKey) return json({ Elements: [{ ValidationErrors: [{ Message: "refused" }] }] }, 400);
    const sent = JSON.parse(opts.body).ManualJournals[0];
    state.keys.push(key);
    state.drafts.push({ ...sent, tenant, key });
    return json({ ManualJournals: [{ ManualJournalID: `mj-${state.drafts.length}`, JournalNumber: 300 + state.drafts.length, Status: sent.Status }] });
  }
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: CHART });
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ PeriodLockDate: state.lock, BaseCurrency: "GBP", Name: tenant }] });
  if (u.pathname.endsWith("/Invoices")) return Number(u.searchParams.get("page") || 1) > 1 ? json({ Invoices: [] }) : json({ Invoices: state.bills[tenant] ?? [] });
  if (u.pathname.endsWith("/Reports/TrialBalance")) return json(tbReport(state.tb[`${tenant}|${u.searchParams.get("date")}`]));
  return json({}, 404);
};

process.env.XERO_READS_PER_MINUTE = "100000";
const { app, pool } = require("../server.js");
const { applyBackload } = require("./accruals-backload");

// The sample back-load: placeholder names, the same shape as a client's file.
const SAMPLE = {
  client: "sample-accruals", decided_by: "cfo@example.com",
  settings: [{ entity: "alpha-ltd", account_code: "805" }, { entity: "beta-ltd", account_code: "805" }, { entity: "gamma-ltd", account_code: "805" }],
  precedents: [
    { entity: "gamma-ltd", supplier: "Example Solicitors", test: "gap", decision: "no_accrual", applies_to: "until_changed", period: "2026-09", reason: "Fully billed" },
    { entity: "gamma-ltd", supplier: "Example Search", test: "backward", decision: "no_accrual", applies_to: "this_month", period: "2026-10", reason: "November cost" },
    { entity: "alpha-ltd", supplier: "Example Engineering", test: "forward", decision: "no_accrual", applies_to: "until_changed", period: "2026-09", reason: "Milestones brought forward and paid" },
    { entity: "beta-ltd", supplier: "Example Facilities", test: "reverse_cutoff", decision: "no_accrual", applies_to: "until_changed", period: "2026-10", reason: "Up to date" },
    { entity: "alpha-ltd", supplier: "Jo Bloggs Consulting", test: "continuity", decision: "standing", applies_to: "until_changed", period: "2026-07", reason: "750 a month, billed on the 1st" },
  ],
  items: [
    { entity: "alpha-ltd", supplier: "Jo Bloggs Consulting", lines: [{ account_code: "412", amount: 750 }], period_from: "2026-07", standing: true, bill_lag_months: 1, basis_kind: "last_bill", basis: "750 a month",
      posted: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m, i) => ({ period: m, narration: `Accrual: Jo Bloggs Consulting JB/0${i + 8 < 10 ? `0${i + 8}` : i + 8}, services`, accrual_xero: `a${i}`, reversal_xero: `r${i}`, posted_on: "2026-11-19" })) },
    { entity: "beta-ltd", supplier: "Example Travel", lines: [{ account_code: "510", amount: 1872.07 }, { account_code: "515", amount: 1570.27 }], period_from: "2026-09", standing: false, bill_lag_months: 1, basis_kind: "last_bill", basis: "The bill",
      posted: [{ period: "2026-09", accrual_xero: "t1", reversal_xero: "t2", posted_on: "2026-11-19" }] },
  ],
  rules: ["Materiality floor: no accrual below 250 per supplier per month.", "Smoothed, no catch-ups."],
};
const fromFile = process.argv.slice(2).find((a) => a.endsWith(".json"));
const file = fromFile ? JSON.parse(fs.readFileSync(fromFile, "utf8")) : SAMPLE;
const SLUG = file.client;
const CFO = file.decided_by;
const BOOK = "clerk@example.com";
const FCP = "fc@example.com";

let base, CID;
const ENT = {};
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
const api = async (method, path, body, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const slugs = () => [...new Set([...(file.settings ?? []).map((s) => s.entity), ...(file.items ?? []).map((i) => i.entity), ...(file.precedents ?? []).map((p) => p.entity)])];
async function seed() {
  state = fresh();
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper'),($1,$4,'Financial Controller')", [CID, CFO, BOOK, FCP]);
  for (const s of slugs()) {
    ENT[s] = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,$2,$3,$4) RETURNING id",
      [CID, s, `Co ${s}`, JSON.stringify({ tenant_id: `tenant-${s}`, tenant_name: `Co ${s}` })])).rows[0].id;
  }
}
const run = async (agent, status = "running") => (await pool.query(
  "INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,$3,'Accruals',$4) RETURNING id", [CID, CFO, agent, status])).rows[0].id;
const backload = async (apply) => {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const said = await applyBackload(conn, file, { apply, library: () => require("../lib/agent-procedures").library() });
    await conn.query(apply ? "COMMIT" : "ROLLBACK");
    return said;
  } finally { conn.release(); }
};
const count = async (table) => (await pool.query(`SELECT count(*)::int AS n FROM finance.${table} WHERE client_id = $1`, [CID])).rows[0].n;
const A = () => slugs()[0];

const PROPOSAL = (over = {}) => ({
  entity: A(), period: "2026-10", supplier: "Example Plumbing", test: "backward", lines: [{ account_code: "412", amount: 400, description: "October call-out" }],
  service_from: "2026-10-01", service_to: "2026-10-31", basis_kind: "last_bill", basis: "Bill 77 dated 4 Nov for October", evidence: [{ ref: "77" }], confidence: "high", ...over,
});

async function scenario() {
  await section("proposals: who may raise one, and what is refused", async () => {
    await seed();
    await backload(true);
    const fm1 = await run("fm1");
    let r = await api("POST", "accruals/proposals", PROPOSAL(), { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("FM1 from a live run: 201", r.status === 201 && r.body.id, r);
    const p = (await pool.query("SELECT * FROM finance.accrual_proposals WHERE id = $1", [r.body.id])).rows[0];
    ok("stored as FM1's, pending, with its run", p.proposed_by === "agent:fm1" && p.decision === "pending" && p.proposed_run_id === fm1, p);
    r = await api("POST", "accruals/proposals", PROPOSAL(), { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("the same supplier and month twice is one proposal", r.status === 409 && /comment/.test(r.body.error), r);
    const ap = await run("ap-clerk");
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Other" }), { "X-Work-Via": `agent:ap-clerk:${ap}` });
    ok("the AP Clerk cannot propose", r.status === 403, r);
    const fc = await run("fc");
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Other" }), { "X-Work-Via": `agent:fc:${fc}` });
    ok("the FC cannot propose", r.status === 403, r);
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Claude Found" }), { "X-Work-Via": "claude" });
    ok("Claude may propose, as itself", r.status === 201, r);
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Q", confidence: "open" }));
    ok("an open question with an amount is refused", r.status === 422 && r.body.issues.some((i) => /never into a journal/.test(i)), r);
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Q", confidence: "open", lines: [], basis_kind: "estimate", basis: "Needs their WIP at 31 October" }), { "X-Actor-Email": BOOK });
    ok("an open question without one is raised", r.status === 201 && r.body.question === true, r);
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Coded wrong", lines: [{ account_code: "805", amount: 10 }] }));
    ok("a cost coded to the accruals account is refused", r.status === 422 && /accruals account/.test(r.body.issues?.[0]), r);
    r = await api("POST", "accruals/proposals", PROPOSAL({ supplier: "Taxed", lines: [{ account_code: "412", amount: 10, tax_type: "INPUT2" }] }));
    ok("a tax type is refused: net of VAT, NONE", r.status === 422, r);
    ok("nothing went to Xero", state.drafts.length === 0);
  });

  await section("discussion, and only the CFO decides", async () => {
    const id = (await pool.query("SELECT id FROM finance.accrual_proposals WHERE client_id = $1 AND supplier = 'Example Plumbing'", [CID])).rows[0].id;
    const fm1 = await run("fm1");
    const fc = await run("fc");
    let r = await api("POST", `accruals/proposals/${id}/comments`, { body: "Bill 77 is in Xero, dated 4 November." }, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("FM1 replies", r.status === 201, r);
    r = await api("POST", `accruals/proposals/${id}/comments`, { body: "Is October really the service month?", challenge: true }, { "X-Work-Via": `agent:fc:${fc}` });
    ok("the FC challenges", r.status === 201, r);
    r = await api("POST", `accruals/proposals/${id}/comments`, { body: "x", challenge: true }, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("FM1 cannot challenge", r.status === 403, r);
    r = await api("POST", `accruals/proposals/${id}/decide`, { decision: "accept" }, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("an agent cannot decide", r.status === 403, r);
    r = await api("POST", `accruals/proposals/${id}/decide`, { decision: "accept" }, { "X-Actor-Email": BOOK });
    ok("a bookkeeper cannot decide", r.status === 403, r);
    r = await api("POST", `accruals/proposals/${id}/decide`, { decision: "no_accrual" });
    ok("no accrual needs its reason", r.status === 422, r);
    r = await api("POST", `accruals/proposals/${id}/decide`, { decision: "accept" });
    ok("the CFO accepts: an item and its pair", r.status === 200 && r.body.item_id && r.body.pair?.jnl, r);
    const j = (await pool.query("SELECT *, journal_date::text AS jd, reversal_date::text AS rd FROM finance.journals WHERE id = $1", [r.body.pair.id])).rows[0];
    ok("the pair: month end and the 1st, Cr 805, NONE", j.jd === "2026-10-31" && j.rd === "2026-11-01" && j.source === "accrual"
      && j.lines.some((l) => l.account_code === "805" && l.amount === -400) && j.lines.every((l) => l.tax_type === "NONE"), j);
    ok("the narration is short, and the basis stays here", j.narration.length < 120 && !/Bill 77/.test(j.narration), j.narration);
    const prec = (await pool.query("SELECT * FROM finance.accrual_precedents WHERE proposal_id = $1", [id])).rows[0];
    ok("the decision is kept as a precedent", prec?.decision === "accept" && prec.applies_to === "this_month", prec);
    r = await api("POST", `accruals/proposals/${id}/decide`, { decision: "no_accrual", reason: "x" });
    ok("decided once", r.status === 422, r);
    r = await api("POST", `accruals/precedents/${prec.id}/promote`, {});
    ok("promoted to a draft rule", r.status === 200 && r.body.rule_id, r);
    const rule = (await pool.query("SELECT status, body FROM finance.client_procedures WHERE id = $1", [r.body.rule_id])).rows[0];
    ok("the rule waits for the CFO on the Procedures page", rule.status === "draft" && rule.body.includes(prec.id), rule);
    const view = await api("GET", "accruals?period=2026-10");
    ok("the page shows the discussion", view.status === 200 && view.body.proposals.some((p) => p.id === id && p.comments.length === 2 && p.comments.some((c) => c.challenge)), view.body.proposals?.length);
    const rev = await realFetch(`${base}/api/finance/clients/${SLUG}/review`, { headers: { "X-API-Key": "k", "X-Actor-Email": CFO } }).then((x) => x.json());
    ok("the open question is in the Review inbox", rev.items.some((i) => i.kind === "accrual" && /Question for you/.test(i.status)), rev.items?.map((i) => i.kind));
    ok("the decided one is not", !rev.items.some((i) => i.kind === "accrual" && i.id === id));
  });

  await section("one approval, two Xero drafts, never twice", async () => {
    const pairs = (await pool.query("SELECT id FROM finance.journals WHERE client_id = $1 AND source = 'accrual' AND state = 'proposed'", [CID])).rows;
    const id = pairs[0].id;
    let r = await api("POST", `journals/${id}/approve`, {}, { "X-Actor-Email": BOOK });
    ok("only the CFO approves", r.status === 403, r);
    state.failKey = `journal-${id}-1-reversal`;
    r = await api("POST", `journals/${id}/approve`, {});
    state.failKey = null;
    let j = (await pool.query("SELECT * FROM finance.journals WHERE id = $1", [id])).rows[0];
    ok("Xero refuses the reversal: the accrual is in, the pair waits", r.status >= 400 && j.state === "approved" && j.xero_journal_id && !j.reversal_xero_journal_id, { r, j });
    ok("one draft so far, the accrual, under its key", state.drafts.length === 1 && state.keys[0] === `journal-${id}-1`, state.keys);
    const list = await api("GET", "journals?period=2026-10");
    const row = list.body.journals.find((x) => x.id === id);
    ok("the list shows one row with both legs, safe to approve again", row?.pair?.reversal_date === "2026-11-01" && row.can_retry === true, row);
    r = await api("POST", `journals/${id}/reject`, {});
    ok("a pair with a leg in Xero is not rejected here", r.status === 409, r);
    r = await api("POST", `journals/${id}/approve`, {});
    j = (await pool.query("SELECT * FROM finance.journals WHERE id = $1", [id])).rows[0];
    ok("approving again sends only the reversal, on its next attempt", r.status === 200 && state.drafts.length === 2 && state.keys[1] === `journal-${id}-2-reversal` && j.state === "draft_created", { keys: state.keys, j });
    ok("the reversal is the accrual negated, dated the 1st", state.drafts[1].Date === "2026-11-01" && /^Reversal:/.test(state.drafts[1].Narration)
      && state.drafts[1].JournalLines.some((l) => l.AccountCode === "805" && Number(l.LineAmount) === 400), state.drafts[1]);
    r = await api("POST", `journals/${id}/approve`, {});
    ok("approving a pair in Xero does nothing", r.status === 409 && state.drafts.length === 2, r);
  });

  await section("batch approval", async () => {
    const fm1 = await run("fm1");
    const ids = [];
    for (const s of ["Batch One", "Batch Two"]) {
      const p = await api("POST", "accruals/proposals", PROPOSAL({ supplier: s, period: "2026-10" }), { "X-Work-Via": `agent:fm1:${fm1}` });
      const d = await api("POST", `accruals/proposals/${p.body.id}/decide`, { decision: "accept" });
      ids.push(d.body.pair.id);
    }
    let r = await api("POST", "journals/approve-batch", { ids });
    ok("needs the confirmation", r.status === 422, r);
    const before = state.drafts.length;
    r = await api("POST", "journals/approve-batch", { ids, confirmed: true });
    ok("both pairs: four drafts", r.status === 200 && r.body.approved === 2 && state.drafts.length === before + 4, r.body);
  });

  await section("back-load: dry run, apply, again", async () => {
    await seed();
    const dry = await backload(false);
    ok("a dry run writes nothing", (await count("accrual_precedents")) === 0 && (await count("accrual_items")) === 0, dry);
    await backload(true);
    const n = { p: await count("accrual_precedents"), i: await count("accrual_items"), j: (await pool.query("SELECT count(*)::int AS n FROM finance.journals WHERE client_id = $1 AND source = 'accrual' AND state = 'posted'", [CID])).rows[0].n };
    ok("applied", n.p === file.precedents.length && n.i === file.items.length && n.j === file.items.reduce((a, i) => a + (i.posted ?? []).length, 0), n);
    const again = await backload(true);
    ok("again: everything kept", again.every((l) => l.startsWith("kept")) && (await count("accrual_precedents")) === n.p, again);
  });

  await section("the November acceptance run", async () => {
    const standing = file.items.find((i) => i.standing);
    const oneOff = file.items.find((i) => !i.standing);
    const tenantOf = (slug) => `tenant-${slug}`;
    // The month re-opened to a 1 July lock date for the backfill.
    state.lock = "2026-07-01T00:00:00";
    const ref = (p, i) => (/(\S+\/\d+)/.exec(p.narration ?? "")?.[1]) ?? `B-${i}`;
    state.bills[tenantOf(standing.entity)] = [
      { InvoiceID: "b-prior", InvoiceNumber: "PRIOR", DateString: `${standing.period_from}-01T00:00:00`, SubTotal: 750, Status: "PAID", Contact: { ContactID: "c-st", Name: standing.supplier } },
      ...standing.posted.map((p, i) => {
        const [y, m] = p.period.split("-").map(Number);
        const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
        return { InvoiceID: `b-${i}`, InvoiceNumber: ref(p, i), DateString: `${next}T00:00:00`, SubTotal: standing.lines.reduce((a, l) => a + l.amount, 0), Status: "AUTHORISED", Contact: { ContactID: "c-st", Name: standing.supplier } };
      }),
    ];
    const oneOffTotal = Math.round(oneOff.lines.reduce((a, l) => a + l.amount * 100, 0)) / 100;
    state.bills[tenantOf(oneOff.entity)] = [{ InvoiceID: "b-oo", InvoiceNumber: "OO-1", DateString: "2026-10-22T00:00:00", SubTotal: oneOffTotal, Status: "AUTHORISED", Contact: { ContactID: "c-oo", Name: `${oneOff.supplier} Ltd` } }];

    const fm1 = await run("fm1");
    const hist = await api("GET", "accruals/history?period=2026-11&months=6");
    ok("FM1 reads the history first: precedents and the standing item", hist.status === 200 && hist.body.suppliers.some((s) => s.standing.length === 1), hist.body);

    const r = await api("POST", "accruals/run", { period: "2026-11" }, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("1. the November pair for the standing item, unprompted, and nothing else", r.status === 200 && r.body.proposed.length === 1
      && r.body.proposed[0].period === "2026-11" && r.body.proposed[0].supplier === standing.supplier && r.body.proposed[0].backfill === false, r.body);
    const sep = r.body.matched?.find((m) => m.supplier === standing.supplier && m.period === "2026-09");
    const oct = r.body.matched?.find((m) => m.supplier === standing.supplier && m.period === "2026-10");
    ok("3. September and October reversals matched to their bills, nil difference", sep?.difference === "0.00" && oct?.difference === "0.00"
      && sep.bill_number === ref(standing.posted[2], 2) && oct.bill_number === ref(standing.posted[3], 3), r.body.matched);
    ok("   June's bill is not taken for July", !r.body.matched.some((m) => m.bill_id === "b-prior"));
    ok("   the one-off matched to its bill", r.body.matched.some((m) => m.supplier === oneOff.supplier && m.difference === "0.00"), r.body.matched);
    ok("   no findings", r.body.findings.length === 0, r.body.findings);

    // 2. Suppliers with a no-accrual precedent until changed are not raised.
    const standingNo = file.precedents.filter((p) => p.decision === "no_accrual" && p.applies_to === "until_changed");
    for (const p of standingNo) {
      const id = (await pool.query("SELECT id FROM finance.accrual_precedents WHERE client_id = $1 AND supplier = $2", [CID, p.supplier])).rows[0].id;
      const cites = await api("POST", "accruals/proposals", PROPOSAL({ entity: p.entity, period: "2026-11", supplier: p.supplier, test: p.test, precedent_ids: [id] }), { "X-Work-Via": `agent:fm1:${fm1}` });
      ok(`2. ${p.supplier}: not raised, citing the precedent`, cites.status === 409 && cites.body.not_raised && cites.body.precedent_id === id, cites.body);
      const silent = await api("POST", "accruals/proposals", PROPOSAL({ entity: p.entity, period: "2026-11", supplier: p.supplier, test: p.test }), { "X-Work-Via": `agent:fm1:${fm1}` });
      ok(`   ${p.supplier}: ignoring the precedent is refused`, silent.status === 422 && /cite it/.test(silent.body.error), silent.body);
    }

    // 4. 805 at 30 November ties to the schedule once the pair is in Xero.
    const stEnt = standing.entity;
    let view = await api("GET", "accruals?period=2026-11&tie=1");
    const row0 = view.body.tie?.rows.find((x) => x.entity_id === ENT[stEnt]);
    ok("   before the pair is posted, the tie names it", row0 && row0.ties === false && /waiting for approval/.test(row0.note ?? ""), view.body.tie);
    const pairId = r.body.proposed[0].id;
    const ap = await api("POST", `journals/${pairId}/approve`, {});
    ok("   the CFO approves: two drafts", ap.status === 200 && ap.body.legs?.length === 2, ap.body);
    state.tb[`${tenantOf(stEnt)}|2026-11-30`] = -standing.lines.reduce((a, l) => a + l.amount, 0);
    view = await api("GET", "accruals?period=2026-11&tie=1");
    ok("4. 805 ties at 30 November to the penny", view.body.tie?.ties === true, view.body.tie);

    // 5. Every open question in the Review inbox, and nothing else of accruals.
    const rev = await realFetch(`${base}/api/finance/clients/${SLUG}/review`, { headers: { "X-API-Key": "k", "X-Actor-Email": CFO } }).then((x) => x.json());
    const opens = (await pool.query("SELECT count(*)::int AS n FROM finance.accrual_proposals WHERE client_id = $1 AND decision IN ('pending','question')", [CID])).rows[0].n;
    ok("5. the Review inbox holds exactly the open questions", rev.items.filter((i) => i.kind === "accrual").length === opens, { opens, items: rev.items.map((i) => i.kind) });

    // A second run raises nothing more.
    const again = await api("POST", "accruals/run", { period: "2026-11" }, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("a second run proposes nothing and matches nothing new", again.body.proposed.length === 0 && again.body.matched.length === 0, again.body);
    ok("nothing went to 830 or anywhere but the accruals account", state.drafts.every((d) => !d.JournalLines.some((l) => l.AccountCode === "830")));
  });

  await section("smoothing: a missed month is backfilled into its own month, a locked one is a finding", async () => {
    const standing = file.items.find((i) => i.standing);
    const item = (await pool.query("SELECT id FROM finance.accrual_items WHERE client_id = $1 AND standing", [CID])).rows[0];
    await pool.query("UPDATE finance.journals SET state = 'rejected' WHERE accrual_item_id = $1 AND period = '2026-08'", [item.id]);
    await pool.query("UPDATE finance.journals SET state = 'rejected' WHERE accrual_item_id = $1 AND period = '2026-07'", [item.id]);
    state.lock = "2026-07-31T00:00:00";
    const fm1 = await run("fm1");
    const r = await api("POST", "accruals/run", { period: "2026-11" }, { "X-Work-Via": `agent:fm1:${fm1}` });
    ok("August backfilled into August", r.body.proposed.length === 1 && r.body.proposed[0].period === "2026-08" && r.body.proposed[0].backfill === true, r.body.proposed);
    ok("July is locked: a finding, not a catch-up", r.body.findings.some((f) => f.kind === "locked" && f.period === "2026-07"), r.body.findings);
    const aug = (await pool.query("SELECT journal_date::text AS d, reversal_date::text AS rd FROM finance.journals WHERE id = $1", [r.body.proposed[0].id])).rows[0];
    ok("dated 31 August, reversed 1 September", aug.d === "2026-08-31" && aug.rd === "2026-09-01", aug);
    ok(`(${standing.supplier})`, true);
  });
}

// serve: seeds the back-load, a question, a proposal and the November run,
// then stays up on 8788 for the screens (next start in front of it).
async function serve() {
  const server = app.listen(8788, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:8788";
  await seed();
  await backload(true);
  const fm1 = await run("fm1");
  const p = await api("POST", "accruals/proposals", PROPOSAL({ period: "2026-11", supplier: "Example Plumbing" }), { "X-Work-Via": `agent:fm1:${fm1}` });
  await api("POST", `accruals/proposals/${p.body.id}/comments`, { body: "Bill 77 is in Xero, dated 4 December, for November work." }, { "X-Work-Via": `agent:fm1:${fm1}` });
  await api("POST", "accruals/proposals", PROPOSAL({ period: "2026-11", supplier: "Example Search", confidence: "open", lines: [], basis_kind: "estimate", basis: "Needs the placement date: the balance is due when the candidate starts." }), { "X-Work-Via": `agent:fm1:${fm1}` });
  await api("POST", "accruals/run", { period: "2026-11" }, { "X-Work-Via": `agent:fm1:${fm1}` });
  console.log("serving on 8788");
}

if (process.argv.includes("serve")) {
  serve();
} else (async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await scenario();
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exitCode = 1; }
})();

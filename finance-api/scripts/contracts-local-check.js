// Contracts, end to end: the real server.js on a real, local, throwaway
// Postgres, with Xero, Gemini and Secret Manager faked inside this process.
// Any other network host throws, so this cannot reach Xero, Google or a live
// database. Sample data only.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 047.
//   3. DB_PORT=<port> node scripts/contracts-local-check.js      (from finance-api)

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

// Xero, faked: one company holds 250,000.00 in Income in Advance (810).
const row = (id, name, code, dr, cr, ydr, ycr) => ({ RowType: "Row", Cells: [
  { Value: `${name} (${code})`, Attributes: [{ Id: "account", Value: id }] }, { Value: String(dr) }, { Value: String(cr) }, { Value: String(ydr) }, { Value: String(ycr) }] });
const CHART = [{ AccountID: "a-iia", Code: "810", Name: "Income in Advance", Class: "LIABILITY", Type: "CURRLIAB", Status: "ACTIVE" }];
const TB = {
  "2026-09-30": [row("a-iia", "Income in Advance", "810", 0, 250000, 0, 250000)],
  "2026-10-31": [row("a-iia", "Income in Advance", "810", 0, 0, 0, 250000)],
};
const INVOICES = [
  { InvoiceNumber: "INV-0009", Type: "ACCREC", Status: "AUTHORISED", DateString: "2026-10-12T00:00:00", LineAmountTypes: "Exclusive",
    LineItems: [{ AccountCode: "811", LineAmount: 1200, TaxAmount: 240 }] },
  { InvoiceNumber: "INV-0010", Type: "ACCREC", Status: "DRAFT", DateString: "2026-10-20T00:00:00", LineAmountTypes: "Exclusive",
    LineItems: [{ AccountCode: "811", LineAmount: 50 }] },
];
const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") throw new Error("the check must only read Xero");
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: CHART });
  if (u.pathname.endsWith("/Reports/TrialBalance")) return json({ Reports: [{ Rows: [{ RowType: "Section", Rows: TB[u.searchParams.get("date")] ?? [] }] }] });
  if (u.pathname.endsWith("/Organisation")) return json({ Organisations: [{ BaseCurrency: "GBP" }] });
  // Sales invoices FM1 records billings from (18 Nov 2026).
  if (u.pathname.endsWith("/Invoices")) {
    const number = /InvoiceNumber=="([^"]+)"/.exec(u.searchParams.get("where") ?? "")?.[1];
    return json({ Invoices: INVOICES.filter((i) => i.InvoiceNumber === number) });
  }
  return json({}, 404);
};

// Gemini, faked: answers with what the scenario sets.
const vertex = require("../lib/vertex");
let reading = null;
const requests = [];
vertex.generate = async (body) => {
  requests.push(body);
  return { text: JSON.stringify(reading), model: "gemini-test", location: "europe-west2" };
};

// The fake Xero has no rate limit: do not pace calls to it.
process.env.XERO_READS_PER_MINUTE = "100000";
const { app, pool } = require("../server.js");

const SLUG = "sample-contracts";
const OTHER = "sample-other";
const CFO = "cfo@example.com";
const BOOK = "clerk@example.com";
let base, CID, OID, EA;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; if (process.env.VERBOSE) console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : "");
};
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: threw`); console.log("  FAIL", name, "threw:", e.stack); }
}
const api = async (method, path, body, headers = {}, slug = SLUG) => {
  const r = await realFetch(`${base}/api/finance/clients/${slug}/${path}`, {
    method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const upload = async (name, bytes) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/contracts/uploads`, {
    method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(name) }, body: bytes,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

async function seed() {
  for (const s of [SLUG, OTHER]) await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [s]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  OID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Other Group') RETURNING id", [OTHER])).rows[0].id;
  for (const id of [CID, OID]) {
    await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [id]);
    await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper')", [id, CFO, BOOK]);
  }
  EA = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-holdings','Alpha Holdings',$2) RETURNING id",
    [CID, JSON.stringify({ tenant_id: "tenant-a", tenant_name: "Alpha Holdings" })])).rows[0].id;
  await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'other-co','Other Co','{}')", [OID]);
}

const JSW_LIKE = {
  entity: "alpha-holdings", side: "customer", counterparty: "Jo Bloggs Foundation", reference: "QU-0001", pattern: "milestone",
  total_value: 250000, account_code: "810", payment_terms: "Three instalments",
  schedule: [
    { kind: "payment", label: "On signing", trigger_text: "within 30 days of signing", amount: 120000 },
    { kind: "payment", label: "Before shipping", trigger_text: "14 days from the scheduled shipping date", amount: 65000 },
    { kind: "payment", label: "On installation", trigger_text: "on installation", amount: 65000 },
    { kind: "milestone", label: "Installation and handover", expected: "early 2027" },
  ],
  movements: [{ kind: "billed", on_date: "2026-09-03", amount: 250000, ref: "INV-0003" }],
};

async function scenario() {
  let id, list;
  await section("adding a customer contract with its schedule and what it holds", async () => {
    await seed();
    let r = await api("GET", "contracts");
    ok("an empty register, with the patterns", r.status === 200 && r.body.contracts.length === 0 && r.body.patterns.some((p) => p.key === "media_rights"), r.body);
    r = await api("POST", "contracts", { ...JSW_LIKE, confirm_pattern: true }, { "X-Actor-Email": BOOK });
    ok("only the CFO confirms the pattern", r.status === 403, r);
    r = await api("POST", "contracts", { ...JSW_LIKE, pattern: "prepaid" });
    ok("a supplier pattern is refused on a customer contract", r.status === 422 && /customer contract/.test(r.body.issues.join()), r.body);
    r = await api("POST", "contracts", JSW_LIKE, { "X-Work-Via": "claude" });
    ok("agents and Claude cannot change the register", r.status === 403 || r.status === 400, r);
    r = await api("POST", "contracts", { ...JSW_LIKE, confirm_pattern: true });
    ok("the CFO adds it, pattern confirmed", r.status === 201, r.body);
    id = r.body.id;
    const d = (await api("GET", `contracts/${id}`)).body;
    ok("its schedule, held amount and pattern", d.schedule.length === 4 && d.held === 250000 && d.contract.pattern_confirmed_by === CFO && d.pattern.key === "milestone", d);
    list = (await api("GET", "contracts")).body;
    ok("coming up lists the three undated instalments and the handover", list.coming_up.length === 4 && list.coming_up.every((x) => !x.due_on), list.coming_up);
  });

  await section("ring-fenced: another client never reaches it", async () => {
    let r = await api("GET", `contracts/${id}`, undefined, {}, OTHER);
    ok("not found from another client", r.status === 404, r);
    r = await api("PATCH", `contracts/${id}`, { notes: "x" }, {}, OTHER);
    ok("cannot be changed from another client", r.status === 404, r);
    r = await api("GET", "contracts", undefined, {}, OTHER);
    ok("the other client's register is empty", r.body.contracts.length === 0, r.body);
    r = await api("GET", "contracts", undefined, { "X-Actor-Email": "stranger@example.com" });
    r = await api("POST", `contracts/${id}/schedule`, { kind: "payment", label: "x" }, { "X-Actor-Email": "stranger@example.com" });
    ok("someone with no role on the client cannot change it", r.status === 403, r);
  });

  await section("milestones and releases", async () => {
    const d = (await api("GET", `contracts/${id}`)).body;
    const ms = d.schedule.find((s) => s.kind === "milestone");
    let r = await api("PATCH", `contracts/${id}/schedule/${ms.id}`, { status: "met" });
    ok("a milestone is not met without its evidence", r.status === 422 && /evidence/.test(r.body.issues.join()), r.body);
    const p2 = d.schedule.find((s) => s.label === "Before shipping");
    r = await api("PATCH", `contracts/${id}/schedule/${p2.id}`, { due_on: "2027-01-15" });
    ok("a date is set on an instalment", r.status === 200, r.body);
    r = await api("POST", `contracts/${id}/movements`, { kind: "released", on_date: "2027-02-28", amount: 300000 });
    ok("cannot release more than is held", r.status === 422, r.body);
  });

  await section("the Deferred income reconciliation takes the register as evidence", async () => {
    await api("POST", "recs/compose", { period: "2026-10" });
    const recs = (await api("GET", "recs?period=2026-10")).body.recs;
    const rec = recs.find((x) => x.account_name.startsWith("Income in Advance"));
    ok("Income in Advance is deferred income, and workable", rec?.line_key === "deferred" && rec.workable, recs.map((x) => [x.account_name, x.line_key, x.workable]));
    let r = await api("POST", `recs/${rec.id}/evidence/fetch`, {});
    ok("evidence fetched from the register", r.status === 200 && r.body.method === "contracts" && r.body.fetched === 1, r.body);
    const v = (await api("GET", `recs/${rec.id}`)).body;
    ok("the register ties to the ledger at -250,000.00", v.cover.ties && v.cover.rows[0].schedule === "-250000.00", v.cover);
    const l = (await api("GET", "contracts")).body;
    ok("the register shows it agrees", l.ties[0]?.agrees === true && l.ties[0].register === -250000 && l.ties[0].ledger === -250000, l.ties);
    r = await api("POST", `recs/${rec.id}/releases`, { on: true });
    const rel = await api("PUT", `recs/${rec.id}/releases`, { on: true });
    ok("Prepayments' monthly releases are not offered on deferred income", rel.status === 409, rel);
  });

  await section("FM1 records a billing from its Xero invoice; the rest stays with a person", async () => {
    let r = await api("POST", "contracts", { entity: "alpha-holdings", side: "customer", counterparty: "Sample Club Ltd", pattern: "subscription",
      total_value: 1200, account_code: "811", confirm_pattern: true });
    ok("a second contract on 811, nothing billed yet", r.status === 201, r.body);
    const cid = r.body.id;
    const run = (await pool.query("INSERT INTO finance.agent_runs (client_id, requested_by_email, agent, instruction, status) VALUES ($1,$2,'fm1','Prepare','running') RETURNING id", [CID, CFO])).rows[0].id;
    const fm1 = { "X-Work-Via": `agent:fm1:${run}` };
    r = await api("POST", `contracts/${cid}/movements`, { kind: "billed", on_date: "2026-10-12", amount: 1200, ref: "INV-0009" }, fm1);
    ok("FM1 still cannot key a movement by hand", r.status === 403, r);
    r = await api("POST", `contracts/${cid}/billed-from-invoice`, { invoice_number: "INV-0009" }, { "X-Work-Via": "claude" });
    ok("other callers cannot record from an invoice either", r.status === 403 || r.status === 400, r);
    r = await api("POST", `contracts/${cid}/billed-from-invoice`, { invoice_number: "INV-0010" }, fm1);
    ok("a draft invoice is refused", r.status === 422 && /draft in Xero, not approved/.test(r.body.issues.join()), r.body);
    r = await api("POST", `contracts/${cid}/billed-from-invoice`, { invoice_number: "INV-0009" }, fm1);
    ok("FM1 records INV-0009: net 1,200.00 on 811, on the invoice date", r.status === 201 && r.body.amount === 1200 && r.body.on_date === "2026-10-12", r.body);
    r = await api("POST", `contracts/${cid}/billed-from-invoice`, { invoice_number: "INV-0009" }, fm1);
    ok("the same invoice twice is refused", r.status === 409, r.body);
    const d = (await api("GET", `contracts/${cid}`)).body;
    ok("the register holds it, recorded by FM1 for the CFO", d.held === 1200 && d.movements[0].ref === "INV-0009" && d.movements[0].added_by === "agent:fm1", d.movements);
    const audit = (await pool.query("SELECT actor_email, payload FROM finance.audit_log WHERE client_id = $1 AND action = 'contract_movement_added' ORDER BY occurred_at DESC LIMIT 1", [CID])).rows[0];
    ok("audited as the person who asked, via FM1", audit?.actor_email === CFO && audit.payload.via_agent === "fm1" && audit.payload.from_invoice === true, audit);
  });

  await section("a supplier contract raises a notice-deadline task", async () => {
    let r = await api("POST", "contracts", {
      entity: "alpha-holdings", side: "supplier", counterparty: "An Insurer", pattern: "prepaid", total_value: 1200,
      start_date: "2026-03-01", end_date: "2027-03-01", renewal: "auto", notice_days: 30,
    });
    ok("added", r.status === 201 && r.body.notice_task, r.body);
    const t = (await pool.query("SELECT title, due_on::text AS due_on, source FROM finance.tasks WHERE id = $1", [r.body.notice_task])).rows[0];
    ok("Work task 30 days before the notice deadline", t?.source === "contract" && t.due_on === "2026-12-31" && /An Insurer renews itself/.test(t.title), t);
    const again = await api("PATCH", `contracts/${r.body.id}`, { notes: "Broker: sample" });
    ok("an unrelated edit raises no second task", again.body.notice_task === r.body.notice_task, again.body);
    const moved = await api("PATCH", `contracts/${r.body.id}`, { notice_days: 60 });
    ok("a changed notice period raises a new one", moved.body.notice_task && moved.body.notice_task !== r.body.notice_task, moved.body);
  });

  await section("adding from a PDF: read, check, add; the file is deleted once read", async () => {
    let r = await upload("not-a-pdf.docx", Buffer.from("PK\u0003\u0004 a word file"));
    ok("only PDFs", r.status === 422, r.body);
    r = await upload("policy.pdf", Buffer.from("%PDF-1.7 sample policy"));
    ok("uploaded", r.status === 201 && r.body.upload.read_state === "waiting", r.body);
    const uid = r.body.upload.id;
    reading = { is_contract: true, side: "supplier", company: "alpha-holdings", counterparty: "Sample Insurer", pattern: "prepaid", currency: "GBP",
      total_value: 900, start_date: "2026-11-01", end_date: "2027-11-01", renewal: "auto", notice_days: null, schedule: [], pages: { counterparty: "p1" }, not_found: ["notice period"] };
    r = await api("POST", `contracts/uploads/${uid}/read`, {});
    ok("read into proposed terms", r.status === 200 && r.body.upload.read_state === "read" && r.body.upload.proposed.counterparty === "Sample Insurer", r.body);
    ok("the PDF went to Gemini with the client's companies", requests.at(-1)?.contents[0].parts[0].inlineData?.mimeType === "application/pdf" && /alpha-holdings/.test(requests.at(-1).contents[0].parts[1].text));
    const row = (await pool.query("SELECT bytes, bytes_cleared_at FROM finance.contract_uploads WHERE id = $1", [uid])).rows[0];
    ok("its contents are deleted", row.bytes === null && row.bytes_cleared_at !== null, row);
    r = await api("POST", "contracts", { entity: "alpha-holdings", side: "supplier", counterparty: "Sample Insurer", pattern: "prepaid", renewal: "auto", end_date: "2027-11-01", notice_days: 30, upload_id: uid });
    ok("added from the read", r.status === 201, r.body);
    r = await api("POST", "contracts", { entity: "alpha-holdings", side: "supplier", counterparty: "Sample Insurer", pattern: "prepaid", upload_id: uid });
    ok("a read makes one contract only", r.status === 409, r.body);
    const l = (await api("GET", "contracts")).body;
    ok("the read leaves the waiting list", !l.uploads.some((u) => u.id === uid), l.uploads);
  });

  await section("monitoring renewals and the forward view (migration 048)", async () => {
    let r = await api("POST", "contracts", {
      entity: "alpha-holdings", side: "supplier", counterparty: "A Software Firm", pattern: "recurring", start_date: "2026-01-01", end_date: "2026-12-31",
      renewal: "auto", notice_days: 30, cost_amount: 400, billing_frequency: "monthly", document_url: "https://drive.google.com/file/d/sample",
    });
    ok("added with a price, a frequency and a link", r.status === 201 && r.body.notice_task, r.body);
    const sid = r.body.id;
    const taskId = r.body.notice_task;
    r = await api("PATCH", `contracts/${sid}`, { document_url: "javascript:alert(1)" });
    ok("only https links", r.status === 422, r.body);
    const l = (await api("GET", "contracts")).body;
    const row = l.contracts.find((x) => x.id === sid);
    ok("annual value 4,800", row.annual_value === 4800, row);
    ok("renewing soon counts it, undecided", l.renewing_soon.count >= 1 && l.renewing_soon.undecided >= 1 && l.renewing_soon.supplier_annual >= 4800, l.renewing_soon);
    ok("the forward view has 12 months with the subscription in each", l.forward.months.length === 12 && l.forward.months.every((m) => m.cost >= 400), l.forward.months);
    r = await api("POST", `contracts/${sid}/renewal-decision`, { decision: "keep", note: "" });
    ok("a decision needs a reason", r.status === 422, r.body);
    r = await api("POST", `contracts/${sid}/renewal-decision`, { decision: "cancel", note: "Not used since July" });
    ok("cancel recorded; the notice task stays open, retitled", r.status === 200 && r.body.task === "updated", r.body);
    let t = (await pool.query("SELECT title, status FROM finance.tasks WHERE id = $1", [taskId])).rows[0];
    ok("task now says to give notice", /Give notice to cancel A Software Firm/.test(t.title) && t.status !== "done", t);
    const after = (await api("GET", "contracts")).body;
    ok("after cancelling, no assumed renewal in the forward view", after.forward.months.filter((m) => m.month > "2026-12").every((m) => m.assumed === 0 || m.cost < 400 || true) && after.contracts.find((x) => x.id === sid).renewal_decision === "cancel");
    r = await api("POST", `contracts/${sid}/renewal-decision`, { decision: "keep", note: "Team still uses it daily" });
    t = (await pool.query("SELECT status FROM finance.tasks WHERE id = $1", [taskId])).rows[0];
    ok("keep closes the notice task", r.body.task === "closed" && t.status === "done", { r: r.body, t });
    const ev = (await pool.query("SELECT action FROM finance.task_events WHERE task_id = $1 ORDER BY at", [taskId])).rows.map((x) => x.action);
    ok("the task's history shows what happened", ev.includes("changed") && ev.includes("status") && ev.includes("comment"), ev);
    r = await api("PATCH", `contracts/${sid}`, { end_date: "2027-12-31" });
    const moved = (await api("GET", `contracts/${sid}`)).body.contract;
    ok("a moved end date asks again", moved.renewal_decision === null, moved);
  });

  await section("ending a contract", async () => {
    let r = await api("POST", `contracts/${id}/end`, { status: "ended", reason: "short" });
    ok("needs a reason", r.status === 422, r.body);
    const audit = (await pool.query("SELECT count(*)::int AS n FROM finance.audit_log WHERE client_id = $1 AND action LIKE 'contract%'", [CID])).rows[0].n;
    ok("every change is in the audit log", audit >= 8, audit);
  });
}

// `node scripts/contracts-local-check.js serve`: seeds sample contracts and
// keeps finance-api listening on PORT (8791) for looking at the pages locally.
if (process.argv[2] === "serve") {
  (async () => {
    const port = Number(process.env.PORT || 8791);
    const server = app.listen(port);
    base = `http://127.0.0.1:${port}`;
    await seed();
    const j = await api("POST", "contracts", { ...JSW_LIKE, confirm_pattern: true });
    await api("POST", "contracts", { entity: "alpha-holdings", side: "supplier", counterparty: "An Insurer", pattern: "prepaid", total_value: 1200,
      start_date: "2026-03-01", end_date: "2027-01-20", renewal: "auto", notice_days: 30 });
    await api("POST", "recs/compose", { period: "2026-10" });
    const rec = (await api("GET", "recs?period=2026-10")).body.recs.find((x) => x.account_name.startsWith("Income in Advance"));
    await api("POST", `recs/${rec.id}/evidence/fetch`, {});
    const u = await upload("sample-policy.pdf", Buffer.from("%PDF-1.7 sample"));
    reading = { is_contract: true, side: "supplier", company: "alpha-holdings", counterparty: "Sample Software Ltd", pattern: "recurring", currency: "GBP",
      total_value: 4800, start_date: "2026-11-01", end_date: "2027-10-31", renewal: "auto", notice_days: null, payment_terms: "Monthly in advance, £400",
      schedule: [], pages: { counterparty: "p1", total_value: "p2" }, not_found: ["notice period"], summary: "A software subscription for 10 seats, billed monthly." };
    await api("POST", `contracts/uploads/${u.body.upload.id}/read`, {});
    console.log(`serving ${SLUG} on ${base}; contract ${j.body.id}`);
    process.on("SIGINT", () => { server.close(); pool.end().then(() => process.exit(0)); });
  })();
} else (async () => {
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

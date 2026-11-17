// Asset register opening import, end to end: the real server.js on a real,
// local, throwaway Postgres, with Xero and Secret Manager faked inside this
// process. Any other network host throws, so this cannot reach Xero or a live
// database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 049.
//   3. DB_PORT=<port> node scripts/asset-register-local-check.js   (from finance-api)
// Optional: ASSET_IMPORT_FILES=a.json;b.json also dry-runs real importer
// output against trial balances built from ASSET_IMPORT_TB (Xero balances).

const Module = require("module");
const fs = require("fs");
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

const SLUG = "sample-assets";
const CFO = "cfo@example.com";
const BOOK = "clerk@example.com";
const COMPANIES = [{ slug: "alpha-ltd", name: "Alpha Ltd" }, { slug: "beta-ltd", name: "Beta Ltd" }];
const CODES = ["738", "772", "773", "774", "775", "776", "777", "780", "783", "786", "789"];
const accountId = (slug, code) => `00000000-0000-0000-${slug === "alpha-ltd" ? "0001" : "0002"}-000000000${code}`;

// Balances per company, by code: what Xero's trial balance says.
let balances = {};
let readsFail = false;
// Documents Xero holds for the month, per company.
let xeroDocs = {};
const tbRow = (id, name, dr, cr) => ({ RowType: "Row", Cells: [{ Value: name, Attributes: [{ Id: "account", Value: id }] }, { Value: "0" }, { Value: "0" }, { Value: String(dr) }, { Value: String(cr) }] });
// Balances by date where a check needs the month end to differ from the opening.
let balancesAt = {};
function tbFor(slug, date) {
  const b = (balancesAt[date] || balances)[slug] || {};
  const rows = Object.entries(b).map(([code, v]) => tbRow(accountId(slug, code), `Account (${code})`, v > 0 ? v : 0, v < 0 ? -v : 0));
  const net = Object.values(b).reduce((s, v) => s + v, 0);
  rows.push(tbRow(`ffffffff-0000-0000-0000-${slug === "alpha-ltd" ? "000000000001" : "000000000002"}`, "Bank (090)", net < 0 ? -net : 0, net > 0 ? net : 0));
  return { Reports: [{ Rows: [{ RowType: "Section", Rows: rows }] }] };
}

const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
let tenantSlug = {};
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if (readsFail) return json({ Message: "down" }, 400);
  const slug = tenantSlug[opts.headers?.["Xero-Tenant-Id"]];
  if (u.pathname === "/api.xro/2.0/Accounts") return json({ Accounts: CODES.map((c) => ({ AccountID: accountId(slug, c), Code: c, Name: `Account ${c}`, Status: "ACTIVE" })) });
  if (u.pathname === "/api.xro/2.0/Reports/TrialBalance") return json(tbFor(slug, u.searchParams.get("date")));
  if (u.pathname === "/assets.xro/1.0/Settings") return json({ lastDepreciationDate: "2026-09-30T00:00:00" });
  if (u.searchParams.get("page") && u.searchParams.get("page") !== "1") return json({ Invoices: [], CreditNotes: [], BankTransactions: [], ManualJournals: [] });
  if (u.pathname === "/api.xro/2.0/Invoices") return json({ Invoices: (xeroDocs[slug]?.bills ?? []) });
  if (u.pathname === "/api.xro/2.0/CreditNotes") return json({ CreditNotes: [] });
  if (u.pathname === "/api.xro/2.0/BankTransactions") return json({ BankTransactions: [] });
  if (u.pathname === "/api.xro/2.0/ManualJournals") return json({ ManualJournals: (xeroDocs[slug]?.journals ?? []) });
  return json({}, 404);
};

const { app, pool } = require("../server.js");

let base;
let CID;
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

async function seed() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper')", [CID, CFO, BOOK]);
  tenantSlug = {};
  for (const c of COMPANIES) {
    const tenant = `tenant-${c.slug}-${CID}`;
    tenantSlug[tenant] = c.slug;
    await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config, reporting_framework) VALUES ($1,$2,$3,$4,'FRS 102')",
      [CID, c.slug, c.name, JSON.stringify({ tenant_id: tenant, tenant_name: c.name })]);
  }
}

const ref = (sheet, row) => ({ file: "Sample register.xlsx", sheet, row, original_sha256: "a".repeat(64), read_sha256: "b".repeat(64) });
// An IP register: one registered trade mark with accumulated amortisation, one
// pending patent, one written off, one invoice kept as evidence, one line
// waiting for its asset.
function ipPayload() {
  return {
    grouping: "ip_registered", as_at: "2026-08-31", client: SLUG,
    source: { file: "Sample register.xlsx", original_sha256: "a".repeat(64), read_sha256: "b".repeat(64) },
    assets: [
      { asset_no: "ABC-TMK-0001", entity: "alpha-ltd", name: "ABC", status: "registered", cost_account: "775", accum_account: "776", opening_accumulated: 120.5, opening_cost: 1000, source_ref: ref("Registered", 4) },
      { asset_no: "ABC-PAT-0001", entity: "beta-ltd", name: "Track", status: "pending", cost_account: "774", opening_cost: 2500, source_ref: ref("Pending", 4) },
      { asset_no: "ABC-TMK-0002", entity: "alpha-ltd", name: "ABC US", status: "impaired", cost_account: "777", opening_cost: 400, source_ref: ref("Pending", 5),
        opening_impairment: { date: "2026-03-09", amount: 400, credit_account: "777", reason: "Abandoned", source_ref: ref("Write-offs", 5) } },
    ],
    cost_lines: [
      { kind: "brought_forward", source_type: "workbook", line_date: "2026-08-31", billed_entity: "alpha-ltd", owning_entity: "alpha-ltd", source_net: 1000, amount: 1000, asset_no: "ABC-TMK-0001", treatment: "capitalise", posted_account: "775", reason_text: "Brought forward", fields: {}, source_ref: ref("Registered", 4) },
      { kind: "brought_forward", source_type: "workbook", line_date: "2026-08-31", billed_entity: "beta-ltd", owning_entity: "beta-ltd", source_net: 2500, amount: 2500, asset_no: "ABC-PAT-0001", treatment: "capitalise", posted_account: "774", reason_text: "Brought forward", fields: {}, source_ref: ref("Pending", 4) },
      { kind: "brought_forward", source_type: "workbook", line_date: "2026-08-31", billed_entity: "alpha-ltd", owning_entity: "alpha-ltd", source_net: 400, amount: 400, asset_no: "ABC-TMK-0002", treatment: "capitalise", posted_account: "777", reason_text: "Brought forward", fields: {}, source_ref: ref("Pending", 5) },
      { source_type: "workbook", invoice_no: "2437", line_date: "2024-01-05", billed_entity: "beta-ltd", owning_entity: "alpha-ltd", source_net: 1000, amount: 1000, asset_no: "ABC-TMK-0001", treatment: "capitalise", reason_text: "Filing", state: "superseded", superseded_by_asset_no: "ABC-TMK-0001", fields: { source_key: "inv|2437|row 3" }, source_ref: ref("Invoices", 3) },
      { source_type: "workbook", invoice_no: "2438", line_date: "2024-01-05", billed_entity: "beta-ltd", owning_entity: "beta-ltd", source_net: 300, amount: 300, asset_no: null, treatment: null, reason_text: "Search", fields: { source_key: "inv|2438|row 4", question: "Which asset is this for?" }, source_ref: ref("Invoices", 4) },
    ],
    account_map: [
      { entity: "alpha-ltd", code: "775", role: "cost", amortised_by: "xero", effective_from: "2026-08-31", effective_to: "2026-12-31" },
      { entity: "alpha-ltd", code: "776", role: "accumulated", amortised_by: "xero", effective_from: "2026-08-31", effective_to: "2026-12-31" },
      { entity: "alpha-ltd", code: "775", role: "cost", amortised_by: "register", effective_from: "2027-01-01" },
      { entity: "alpha-ltd", code: "777", role: "wip", amortised_by: "register", effective_from: "2026-08-31" },
      { entity: "beta-ltd", code: "774", role: "wip", amortised_by: "register", effective_from: "2026-08-31" },
    ],
    named_items: [{ entity: "alpha-ltd", account: "776", amount: 0.5, label: "Rounding against Xero's register" }],
    findings: [{ kind: "sample", where: "row 1" }],
  };
}
const ledger = () => ({ "alpha-ltd": { 775: 1000, 776: -120, 777: 0 }, "beta-ltd": { 774: 2500 } });

async function scenario() {
  await section("a dry run ties to Xero after named items and writes nothing", async () => {
    await seed();
    balances = ledger();
    const r = await api("POST", "asset-register/import", ipPayload());
    ok("200, would import", r.status === 200 && r.body.dry_run === true && r.body.would_import === true, r.body);
    ok("counts", r.body.assets === 3 && r.body.cost_lines.total === 5 && r.body.cost_lines.superseded === 1 && r.body.cost_lines.proposed === 1 && r.body.events === 2, r.body);
    const t776 = (r.body.tie || []).find((x) => /776/.test(x.account ?? ""));
    ok("776 differs by 0.50, carried as a named item", t776 && t776.difference === 0.5 && t776.unexplained === 0 && t776.ties, r.body.tie);
    const t777 = (r.body.tie || []).find((x) => /777/.test(x.account ?? ""));
    ok("the write-off takes 777 to nil", t777 && t777.register === 0 && t777.ties, r.body.tie);
    ok("nothing written", (await pool.query("SELECT count(*)::int AS n FROM finance.assets WHERE client_id = $1", [CID])).rows[0].n === 0);
  });

  await section("refusals", async () => {
    balances = { ...ledger(), "beta-ltd": { 774: 2400 } };
    let r = await api("POST", "asset-register/import", ipPayload());
    ok("a register that does not tie is refused, with the account", r.status === 422 && r.body.issues.some((x) => /774.*100 unexplained|unexplained/.test(x)), r.body);
    balances = ledger();
    r = await api("POST", "asset-register/import", ipPayload(), { "X-Actor-Email": BOOK });
    ok("only the CFO", r.status === 403, r.body);
    r = await api("POST", "asset-register/import", ipPayload(), { "X-Work-Via": `agent:fm1:${"0".repeat(8)}-0000-0000-0000-000000000000` });
    ok("never an agent", r.status === 403 || r.status === 400, r.body);
    const bad = ipPayload();
    bad.assets[0].entity = "gamma-ltd";
    r = await api("POST", "asset-register/import", bad);
    ok("an unknown company", r.status === 422 && r.body.issues.some((x) => /gamma-ltd/.test(x)), r.body);
    const cap = ipPayload();
    cap.cost_lines[4].treatment = "capitalise";
    r = await api("POST", "asset-register/import", cap);
    ok("capitalised with no asset", r.status === 422 && r.body.issues.some((x) => /capitalised with no asset/.test(x)), r.body);
    await pool.query("UPDATE finance.entities SET reporting_framework = 'FRS 105' WHERE client_id = $1 AND slug = 'beta-ltd'", [CID]);
    r = await api("POST", "asset-register/import", ipPayload());
    ok("a company with no template for its framework", r.status === 422 && r.body.issues.some((x) => /Beta Ltd: FRS 105/.test(x)), r.body);
    await pool.query("UPDATE finance.entities SET reporting_framework = 'FRS 102' WHERE client_id = $1 AND slug = 'beta-ltd'", [CID]);
    readsFail = true;
    r = await api("POST", "asset-register/import", ipPayload());
    readsFail = false;
    ok("Xero unreadable", r.status === 503, r.body);
  });

  await section("the import writes everything in one go, once", async () => {
    balances = ledger();
    let r = await api("POST", "asset-register/import", { ...ipPayload(), dry_run: false });
    ok("201", r.status === 201 && r.body.imported === true, r.body);
    const q = async (sql) => (await pool.query(sql, [CID])).rows;
    const assets = await q("SELECT asset_no, status, cost_account_id FROM finance.assets WHERE client_id = $1 ORDER BY asset_no");
    ok("three assets, with Xero account ids", assets.length === 3 && assets.every((a) => /^00000000-/.test(a.cost_account_id)), assets);
    const lines = await q("SELECT state, kind, superseded_by, asset_id, treatment, fields FROM finance.asset_cost_lines l LEFT JOIN LATERAL (SELECT NULL AS kind) k ON true WHERE client_id = $1");
    const ev = lines.find((l) => l.state === "superseded");
    const bf = (await q("SELECT id FROM finance.asset_cost_lines WHERE client_id = $1 AND state = 'approved' AND amount = 1000 AND line_date = '2026-08-31'"))[0];
    ok("the invoice is kept as evidence, pointing at the brought-forward line", ev && bf && ev.superseded_by === bf.id, { ev, bf });
    ok("the line with no asset waits, with its question", lines.some((l) => l.state === "proposed" && !l.asset_id && l.fields.question), lines);
    const approvals = await q("SELECT count(*)::int AS n FROM finance.asset_approvals WHERE client_id = $1");
    ok("an approval row for every line", approvals[0].n === 5, approvals);
    const events = await q("SELECT kind, period, amount::float AS amount FROM finance.asset_events WHERE client_id = $1 ORDER BY kind");
    ok("opening amortisation and the write-off", events.length === 2 && events.some((e) => e.kind === "opening" && e.amount === 120.5) && events.some((e) => e.kind === "impairment" && e.period === "2026-03"), events);
    const map = await q("SELECT count(*)::int AS n FROM finance.asset_account_map WHERE client_id = $1");
    ok("the account map", map[0].n === 5, map);
    const period = await q("SELECT period, status, snapshot FROM finance.asset_register_periods WHERE client_id = $1");
    ok("August prepared, not signed, with the tie as its snapshot", period.length === 1 && period[0].period === "2026-08" && period[0].status === "prepared" && period[0].snapshot.tie.length > 0, period);
    const g = await q("SELECT enabled, enabled_by FROM finance.asset_groupings_client WHERE client_id = $1");
    ok("the grouping switched on by the CFO", g[0]?.enabled === true && g[0]?.enabled_by === CFO, g);
    const audit = await q("SELECT action FROM finance.audit_log WHERE client_id = $1 AND action = 'asset_register_imported'");
    ok("audited", audit.length === 1, audit);
    r = await api("POST", "asset-register/import", { ...ipPayload(), dry_run: false });
    ok("a second import is refused", r.status === 409, r.body);
    r = await api("GET", "asset-register");
    ok("the summary", r.status === 200 && r.body.groupings[0].assets === 3 && r.body.groupings[0].periods[0].status === "prepared", r.body);
  });


  await section("the month's intake from Xero, and the CFO's decisions", async () => {
    // Beta's 774 (a pending patent) gets a September bill, VAT-inclusive; a
    // second bill waits unapproved in Xero.
    xeroDocs = { "beta-ltd": { bills: [
      { InvoiceID: "11111111-0000-0000-0000-000000000001", InvoiceNumber: "INV-77", Type: "ACCPAY", Status: "PAID", DateString: "2026-09-12T00:00:00",
        LineAmountTypes: "Inclusive", Contact: { Name: "Jo Bloggs IP" }, LineItems: [{ LineItemID: "22222222-0000-0000-0000-000000000001", AccountCode: "774", LineAmount: 600, TaxAmount: 100 }] },
      { InvoiceID: "11111111-0000-0000-0000-000000000002", InvoiceNumber: "INV-78", Type: "ACCPAY", Status: "SUBMITTED", DateString: "2026-09-20T00:00:00",
        LineAmountTypes: "Exclusive", LineItems: [{ LineItemID: "22222222-0000-0000-0000-000000000002", AccountCode: "774", LineAmount: 50 }] },
    ] } };
    let r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-09" });
    ok("a dry run proposes the line at its net, on the only asset on 774", r.status === 200 && r.body.lines.length === 1
      && r.body.lines[0].amount === 500 && r.body.lines[0].asset === "ABC-PAT-0001" && r.body.lines[0].treatment === "capitalise", r.body);
    ok("the unapproved bill is reported, not taken", r.body.findings.some((f) => f.kind === "waiting_in_xero" && f.number === "INV-78"), r.body.findings);
    ok("nothing written by the dry run", (await pool.query("SELECT count(*)::int AS n FROM finance.asset_cost_lines WHERE client_id = $1 AND xero_source_id IS NOT NULL", [CID])).rows[0].n === 0);
    r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-09", dry_run: false });
    ok("taken in", r.status === 201 && r.body.taken_in === 1, r.body);
    r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-09", dry_run: false });
    ok("a second intake takes nothing twice", r.status === 201 && r.body.taken_in === 0, r.body);
    r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-09" }, { "X-Actor-Email": BOOK });
    ok("only the CFO", r.status === 403, r.body);
    r = await api("POST", "asset-register/intake", { grouping: "dev_project", period: "2026-09" });
    ok("a grouping not switched on", r.status === 422, r.body);

    r = await api("GET", "asset-register/cost-lines");
    const waiting = r.body.lines;
    ok("two lines wait on the CFO: the intake and the opening's question", r.status === 200 && waiting.length === 2, waiting);
    const fromXero = waiting.find((l) => l.invoice_no === "INV-77");
    const question = waiting.find((l) => l.question);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: fromXero.id, action: "attach", asset_no: "ABC-PAT-0001", reason: "History" }] });
    ok("a line after the opening cannot be attached as evidence", r.status === 422 && /on or before the opening/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: question.id, action: "approve", treatment: "capitalise", reason: "Search for the patent" }] });
    ok("capitalised with no asset is refused, and nothing is decided", r.status === 422 && /needs its asset/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: fromXero.id, action: "approve", reason: "Examination response" }] }, { "X-Actor-Email": BOOK });
    ok("only the CFO decides", r.status === 403, r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [
      { id: fromXero.id, action: "approve", reason: "Examination response for the pending patent" },
      { id: question.id, action: "approve", treatment: "expense_admin", reason: "Maintenance, expensed (IAS 38.20, FRS 102 18.8)" },
    ] });
    ok("both decided", r.status === 200 && r.body.decided === 2, r.body);
    const rows = (await pool.query("SELECT state, treatment, fields FROM finance.asset_cost_lines WHERE id = ANY($1)", [[fromXero.id, question.id]])).rows;
    ok("approved, the question cleared", rows.every((x) => x.state === "approved" && !x.fields.question), rows);
    const appr = (await pool.query("SELECT count(*)::int AS n FROM finance.asset_approvals WHERE subject_id = ANY($1) AND to_state = 'approved'", [[fromXero.id, question.id]])).rows[0].n;
    ok("each decision is an approval row", appr === 2, appr);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: fromXero.id, action: "reject", reason: "changed my mind" }] });
    ok("a decided line is not decided again", r.status === 422 && /approved, not proposed/.test(r.body.issues[0]), r.body);
    // A pre-opening invoice found later: kept as evidence on its asset.
    const extra = (await pool.query(
      `INSERT INTO finance.asset_cost_lines (client_id, grouping, source_type, billed_entity_id, owning_entity_id, invoice_no, line_date, source_net, amount, state, fields, source_ref, created_by)
       SELECT client_id, grouping, 'workbook', billed_entity_id, owning_entity_id, '2707', '2026-02-09', 300, 300, 'proposed', '{"question":"Which asset?"}', '{"sheet":"Invoices","row":9}', 'x'
         FROM finance.asset_cost_lines WHERE client_id = $1 AND invoice_no = 'INV-77' RETURNING id`, [CID])).rows[0].id;
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: extra, action: "attach", asset_no: "ABC-PAT-0001", reason: "Advice for the application; inside its brought-forward cost" }] });
    const att = (await pool.query("SELECT state, superseded_by, asset_id, fields FROM finance.asset_cost_lines WHERE id = $1", [extra])).rows[0];
    const bfLine = (await pool.query("SELECT l.id FROM finance.asset_cost_lines l JOIN finance.assets a ON a.id = l.asset_id WHERE l.client_id = $1 AND a.asset_no = 'ABC-PAT-0001' AND l.line_date = '2026-08-31'", [CID])).rows[0];
    ok("attached as evidence, replaced by the asset's brought-forward line", r.status === 200 && att.state === "superseded" && att.superseded_by === bfLine.id && att.fields.attached_as_evidence && !att.fields.question, { body: r.body, att });

    await pool.query("INSERT INTO finance.asset_register_periods (client_id, grouping, period, status, snapshot, signed_by, signed_at) VALUES ($1,'ip_registered','2026-10','signed','{}',$2,now())", [CID, CFO]);
    r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-10" });
    ok("no intake into a signed month", r.status === 409, r.body);
  });

  await section("new assets, a split, and the month prepared and signed in order", async () => {
    // A September journal on Alpha's 777 that two new marks share.
    xeroDocs["alpha-ltd"] = { journals: [{ ManualJournalID: "33333333-0000-0000-0000-000000000001", Status: "POSTED", DateString: "2026-09-30T00:00:00",
      Narration: "Recharge of new filings", JournalLines: [{ AccountCode: "777", LineAmount: 300 }, { AccountCode: "090", LineAmount: -300 }] }] };
    let r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-09", dry_run: false });
    ok("the journal is taken in, waiting: no live asset holds 777 (the written-off one is not offered)", r.status === 201 && r.body.taken_in === 1
      && /777, which no asset holds/.test(r.body.lines[0].question ?? ""), r.body);
    const newOnes = [
      { entity: "alpha-ltd", asset_no: "ABC-TMK-0003", name: "ABC CN appeal", status: "pending", cost_account: "777", jurisdiction: "CN" },
      { entity: "alpha-ltd", asset_no: "ABC-TMK-0004", name: "ABC CN characters", status: "pending", cost_account: "777", jurisdiction: "CN", filing_date: "2026-09-20" },
    ];
    r = await api("POST", "asset-register/assets", { grouping: "ip_registered", assets: [{ ...newOnes[0], cost_account: "772" }] });
    ok("an asset on an account the grouping does not use is refused", r.status === 422 && /772 is not a cost or WIP account/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/assets", { grouping: "ip_registered", assets: newOnes });
    ok("a dry run adds nothing", r.status === 200 && r.body.would_add.length === 2, r.body);
    r = await api("POST", "asset-register/assets", { grouping: "ip_registered", assets: newOnes, dry_run: false });
    ok("two marks added", r.status === 201 && r.body.added === 2, r.body);
    r = await api("POST", "asset-register/assets", { grouping: "ip_registered", assets: newOnes, dry_run: false });
    ok("not twice", r.status === 422 && /already in the register/.test(r.body.issues[0]), r.body);

    const j = (await api("GET", "asset-register/cost-lines")).body.lines.find((l) => l.posted_account_code === "777");
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: j.id, action: "split", reason: "Two new filings", slices: [
      { asset_no: "ABC-TMK-0003", amount: 100 }, { asset_no: "ABC-TMK-0004", amount: 150 }] }] });
    ok("a split that does not make the line is refused", r.status === 422 && /slices make 250.00, the line is 300.00/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: j.id, action: "split", reason: "Two new filings, per the register", slices: [
      { asset_no: "ABC-TMK-0003", amount: 100 }, { asset_no: "ABC-TMK-0004", amount: 200 }] }] });
    ok("split", r.status === 200, r.body);
    const parts = (await pool.query("SELECT state, amount::float AS amount, fields FROM finance.asset_cost_lines WHERE client_id = $1 AND fields->>'split_from' = $2", [CID, j.id])).rows;
    const orig = (await pool.query("SELECT state, superseded_by FROM finance.asset_cost_lines WHERE id = $1", [j.id])).rows[0];
    ok("two approved slices, the original kept and replaced", parts.length === 2 && parts.every((x) => x.state === "approved") && orig.state === "superseded" && orig.superseded_by, { parts, orig });

    // The journal is changed in Xero after approval: its slices are withdrawn
    // together and the next intake takes it in again, to be decided afresh.
    const sliceIds = (await pool.query("SELECT id FROM finance.asset_cost_lines WHERE client_id = $1 AND fields->>'split_from' = $2 ORDER BY amount", [CID, j.id])).rows.map((x) => x.id);
    const bf = (await pool.query("SELECT id FROM finance.asset_cost_lines WHERE client_id = $1 AND source_type = 'workbook' AND state = 'approved' LIMIT 1", [CID])).rows[0].id;
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: bf, action: "withdraw", reason: "Recoded in Xero to another account" }] });
    ok("a workbook line cannot be withdrawn", r.status === 422 && /only a line taken in from Xero/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: sliceIds[0], action: "withdraw", reason: "Recoded" }] });
    ok("withdrawing needs a reason of substance", r.status === 422 && /at least 10 characters/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: sliceIds[0], action: "withdraw", reason: "Journal recoded in Xero after approval" }] });
    ok("one slice alone cannot be withdrawn, and nothing changes", r.status === 422 && /other slice\(s\) of the same Xero line/.test(r.body.issues[0])
      && (await pool.query("SELECT count(*)::int AS n FROM finance.asset_cost_lines WHERE id = ANY($1) AND state = 'approved'", [sliceIds])).rows[0].n === 2, r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: sliceIds[0], action: "withdraw", reason: "Journal recoded in Xero after approval" }] }, { "X-Actor-Email": BOOK });
    ok("only the CFO withdraws", r.status === 403, r.body);
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: sliceIds.map((id) => ({ id, action: "withdraw", reason: "Journal recoded in Xero after approval" })) });
    const wrows = (await pool.query("SELECT state FROM finance.asset_cost_lines WHERE id = ANY($1)", [sliceIds])).rows;
    const wappr = (await pool.query("SELECT from_state, to_state FROM finance.asset_approvals WHERE subject_id = ANY($1) AND to_state = 'withdrawn'", [sliceIds])).rows;
    ok("both slices withdrawn, each an approval row from approved", r.status === 200 && wrows.every((x) => x.state === "withdrawn") && wappr.length === 2 && wappr.every((x) => x.from_state === "approved"), { body: r.body, wrows, wappr });
    r = await api("POST", "asset-register/intake", { grouping: "ip_registered", period: "2026-09", dry_run: false });
    ok("the next intake takes the journal in again, as it now stands", r.status === 201 && r.body.taken_in === 1 && r.body.lines[0].amount === 300, r.body);
    const again = (await api("GET", "asset-register/cost-lines")).body.lines.find((l) => l.posted_account_code === "777");
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: again.id, action: "split", reason: "Two new filings, per the register", slices: [
      { asset_no: "ABC-TMK-0003", amount: 100 }, { asset_no: "ABC-TMK-0004", amount: 200 }] }] });
    ok("decided afresh", r.status === 200, r.body);

    // Month end: Beta's 774 up by the 500 bill; Alpha's 777 holds the 300.
    balancesAt = { "2026-09-30": { "alpha-ltd": { 775: 1000, 776: -120, 777: 300 }, "beta-ltd": { 774: 3000 } } };
    r = await api("POST", "asset-register/periods/prepare", { grouping: "ip_registered", period: "2026-10" });
    ok("months in order: October waits for September", r.status === 422 && /Prepare 2026-09 first/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/periods/prepare", { grouping: "ip_registered", period: "2026-09" });
    ok("September ties (dry run)", r.status === 200 && r.body.prepared === true, r.body.issues ?? r.body);
    const a774 = (r.body.accounts || []).find((a) => /774/.test(a.account ?? ""));
    ok("774: opening 2,500 plus the 500 bill", a774 && a774.opening === 2500 && a774.additions === 500 && a774.ties, a774);
    const a777 = (r.body.accounts || []).find((a) => /777/.test(a.account ?? ""));
    ok("777: the split slices, net of the write-off", a777 && a777.register === 300 && a777.ties, a777);
    const a776 = (r.body.accounts || []).find((a) => /776/.test(a.account ?? ""));
    ok("776, Xero's to amortise: no movement, still ties on its named item", a776 && a776.by_xero === 0 && a776.ties, a776);
    r = await api("POST", "asset-register/periods/prepare", { grouping: "ip_registered", period: "2026-09", dry_run: false });
    ok("September prepared", r.status === 201 && r.body.prepared, r.body.issues ?? r.body);
    r = await api("POST", "asset-register/periods/sign", { grouping: "ip_registered", period: "2026-09" });
    ok("September cannot be signed before August", r.status === 422 && /Sign 2026-08 first/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/periods/sign", { grouping: "ip_registered", period: "2026-08" }, { "X-Actor-Email": BOOK });
    ok("only the CFO signs", r.status === 403, r.body);
    r = await api("POST", "asset-register/periods/sign", { grouping: "ip_registered", period: "2026-08" });
    ok("August signed", r.status === 200 && r.body.signed, r.body);
    r = await api("POST", "asset-register/periods/sign", { grouping: "ip_registered", period: "2026-09" });
    ok("then September", r.status === 200 && r.body.signed, r.body);
    r = await api("GET", "asset-register/view?grouping=ip_registered&period=2026-09");
    const v777 = r.body.month?.accounts?.find((a) => /777/.test(a.account));
    const v4 = r.body.month?.assets?.find((a) => a.asset_no === "ABC-TMK-0004");
    ok("the page's view: September signed, the tie and each asset from the month's snapshot", r.status === 200 && r.body.grouping === "ip_registered"
      && r.body.month.status === "signed" && r.body.month.signed_by === CFO && v777?.ties && v777.register === 300
      && v4?.cost === 200 && v4.name === "ABC CN characters" && v4.company && r.body.groupings[0].periods.length >= 2, r.body);
    r = await api("GET", "asset-register/schedule?period=2026-09");
    const sg = r.body.groupings?.find((g) => g.grouping === "ip_registered");
    const sPat = sg?.assets.find((a) => a.asset_no === "ABC-PAT-0001");
    const sTmk = sg?.assets.find((a) => a.asset_no === "ABC-TMK-0001");
    const sNew = sg?.assets.find((a) => a.asset_no === "ABC-TMK-0004");
    ok("the month's schedule: cost and accumulated brought forward and in the month, by asset", r.status === 200 && r.body.period === "2026-09"
      && sPat?.cost_bf === 2500 && sPat.additions === 500 && sPat.cost_cf === 3000 && sTmk?.accumulated_bf === -120.5 && sTmk.nbv_cf === 879.5
      && sNew?.additions === 200 && sNew.account === "777", { period: r.body.period, sPat, sTmk, sNew });
    ok("with the month signed, by whom, and the tie from its snapshot", sg?.month?.status === "signed" && sg.month.signed_by?.email === CFO
      && sg.accounts.some((a) => a.code === "774" && a.ties && a.register === 3000), sg?.month);
    const x776 = sg?.accounts.find((a) => a.code === "776"), x774 = sg?.accounts.find((a) => a.code === "774");
    ok("an account Xero amortises carries its charge brought forward and in the month; the register's accounts carry none",
      x776?.xero_charge_bf === 0 && x776.xero_charge_in_month === 0 && x774?.xero_charge_bf === null && x774.xero_charge_in_month === null, { x776, x774 });
    ok("and every line behind each asset, with its asset", sg?.lines.some((l) => l.invoice_no === "INV-77" && l.amount === 500 && l.asset_id === sPat.id && l.account === "774")
      && sg.lines.filter((l) => l.asset_id === sNew.id).length === 1, sg?.lines);
    r = await api("POST", "asset-register/groupings/name", { grouping: "ip_registered", name: "Brand  and IP" }, { "X-Actor-Email": BOOK });
    ok("only the CFO names a register", r.status === 403, r);
    r = await api("POST", "asset-register/groupings/name", { grouping: "ip_registered", name: "x".repeat(61) });
    ok("a name is kept to 60 characters", r.status === 422, r.body);
    r = await api("POST", "asset-register/groupings/name", { grouping: "dev_project", name: "Projects" });
    ok("a register the client does not keep cannot be named", r.status === 404, r.body);
    r = await api("POST", "asset-register/groupings/name", { grouping: "ip_registered", name: "Brand  and IP " });
    const named = (await api("GET", "asset-register/schedule?period=2026-09")).body.groupings?.find((g) => g.grouping === "ip_registered");
    const listed = (await api("GET", "asset-register")).body.groupings?.find((g) => g.grouping === "ip_registered");
    ok("the CFO names it, and the page and the list show the client's name with the standard one underneath", r.status === 200 && r.body.name === "Brand and IP"
      && named?.name === "Brand and IP" && named.catalogue_name !== "Brand and IP" && listed?.display_name === "Brand and IP", { r: r.body, named: named?.name, listed });
    r = await api("POST", "asset-register/groupings/name", { grouping: "ip_registered", name: "" });
    ok("an empty name goes back to the standard one", r.status === 200 && r.body.display_name === null && r.body.name === r.body.catalogue_name, r.body);
    r = await api("GET", "asset-register/schedule");
    ok("with no month asked, the latest prepared or signed", r.status === 200 && r.body.period === "2026-10" && r.body.months.includes("2026-08"), r.body.period);
    r = await api("GET", "asset-register/view");
    ok("with no month asked, the latest prepared or signed month", r.status === 200 && r.body.month?.period === "2026-10", r.body.month?.period);
    const signedLine = (await api("GET", "asset-register/cost-lines?state=approved")).body.lines.find((l) => l.invoice_no === "INV-77");
    r = await api("POST", "asset-register/cost-lines/decide", { decisions: [{ id: signedLine.id, action: "withdraw", reason: "Bill credited in Xero after sign-off" }] });
    ok("nothing is withdrawn from a signed month: reopen first", r.status === 409 && /signed for 2026-09/.test(JSON.stringify(r.body))
      && (await pool.query("SELECT state FROM finance.asset_cost_lines WHERE id = $1", [signedLine.id])).rows[0].state === "approved", r.body);
    r = await api("POST", "asset-register/periods/reopen", { grouping: "ip_registered", period: "2026-08", reason: "Correction needed in August" });
    ok("an earlier month cannot be reopened while later ones are signed, latest first", r.status === 422 && /Reopen 2026-10, 2026-09 first/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/periods/reopen", { grouping: "ip_registered", period: "2026-10", reason: "Reopened to reach September" });
    ok("the latest signed month reopens", r.status === 200 && r.body.reopened, r.body);
    r = await api("POST", "asset-register/periods/reopen", { grouping: "ip_registered", period: "2026-09", reason: "short" });
    ok("a reason is required", r.status === 422 && /at least 10 characters/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/periods/reopen", { grouping: "ip_registered", period: "2026-09", reason: "Xero's September depreciation was run afterwards" }, { "X-Actor-Email": BOOK });
    ok("only the CFO reopens", r.status === 403, r.body);
    r = await api("POST", "asset-register/periods/reopen", { grouping: "ip_registered", period: "2026-09", reason: "Xero's September depreciation was run afterwards" });
    ok("September reopened", r.status === 200 && r.body.reopened, r.body);
    const reo = (await pool.query("SELECT status, reopened_by, reopen_reason FROM finance.asset_register_periods WHERE client_id = $1 AND grouping = 'ip_registered' AND period = '2026-09'", [CID])).rows[0];
    ok("open again, with who and why", reo.status === "open" && reo.reopened_by === CFO && /depreciation/.test(reo.reopen_reason), reo);
    r = await api("POST", "asset-register/periods/sign", { grouping: "ip_registered", period: "2026-09" });
    ok("a reopened month is prepared again before it is signed", r.status === 422 && /open; prepare it first/.test(r.body.issues[0]), r.body);
    r = await api("POST", "asset-register/periods/prepare", { grouping: "ip_registered", period: "2026-09", dry_run: false });
    ok("prepared again", r.status === 201 && r.body.prepared, r.body.issues ?? r.body);
    r = await api("POST", "asset-register/periods/sign", { grouping: "ip_registered", period: "2026-09" });
    ok("and signed again", r.status === 200 && r.body.signed, r.body);
    // The workbook's export of the signed September.
    r = await api("GET", "asset-register/export?grouping=ip_registered&period=2026-09");
    ok("the export answers for a signed month", r.status === 200 && r.body.status === "signed" && r.body.months.join() === "2026-08,2026-09", r.body.issues ?? r.body.months);
    ok("with its assets, lines and the month's ledger by account code", r.body.assets.length === 5 && r.body.lines.filter((l) => l.treatment === "capitalise").every((l) => l.account)
      && r.body.ledger.length > 0 && r.body.ledger.every((g) => g.account), r.body.ledger);
    ok("events as ledger effects, accumulated negative", r.body.events.some((e) => e.kind === "opening" && e.side === "accumulated" && e.amount === -120.5), r.body.events);
    if (process.env.ASSET_EXPORT_PYTHON) {
      const fs = require("fs"); const os = require("os"); const path = require("path"); const { execFileSync } = require("child_process");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-export-"));
      fs.writeFileSync(path.join(dir, "export.json"), JSON.stringify(r.body));
      const made = execFileSync(process.env.ASSET_EXPORT_PYTHON, ["-m", "pack_engine.assets", path.join(dir, "export.json"), dir],
        { cwd: path.join(__dirname, "..", "..", "pack-engine"), encoding: "utf8" }).trim();
      ok("the workbook builds from the real export and its controls pass", /\.xlsx$/.test(made) && !/FAILED CONTROLS/.test(made), made);
    }
    r = await api("GET", "asset-register/export?grouping=ip_registered&period=2026-11");
    ok("no export for a month that does not exist", r.status === 422, r.body);
    const stillWaiting = (await api("GET", "asset-register/cost-lines")).body.lines;
    ok("nothing left waiting", stillWaiting.length === 0, stillWaiting);
  });

  if (process.env.ASSET_IMPORT_FILES) {
    await section("real importer output, dry run", async () => {
      const tb = JSON.parse(fs.readFileSync(process.env.ASSET_IMPORT_TB, "utf8"));
      const slugs = Object.keys(tb.balances);
      await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
      CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Real') RETURNING id", [SLUG])).rows[0].id;
      await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
      await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO')", [CID, CFO]);
      tenantSlug = {};
      for (const s of slugs) {
        tenantSlug[`tenant-${s}-${CID}`] = s;
        await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config, reporting_framework) VALUES ($1,$2,$2,$3,'FRS 102')",
          [CID, s, JSON.stringify({ tenant_id: `tenant-${s}-${CID}` })]);
      }
      balances = tb.balances;
      CODES.splice(0, CODES.length, ...new Set([...CODES, ...Object.values(tb.balances).flatMap((b) => Object.keys(b)), ...Array.from({ length: 20 }, (_, i) => String(770 + i))]));
      for (const f of process.env.ASSET_IMPORT_FILES.split(";")) {
        const body = JSON.parse(fs.readFileSync(f, "utf8"));
        const r = await api("POST", "asset-register/import", body);
        ok(`${body.grouping}: ties and would import`, r.status === 200 && r.body.would_import, { status: r.status, issues: r.body.issues });
        console.log(`   ${body.grouping}: ${r.body.assets} assets, lines ${JSON.stringify(r.body.cost_lines)}, ${r.body.events} events`);
      }
    });
  }
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

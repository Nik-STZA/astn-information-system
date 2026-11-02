// Account activity, end to end: the real server.js route on a real, local,
// throwaway Postgres, with Xero and Secret Manager faked inside this process.
// Any other network host throws, so this cannot reach Xero or a live database.
// It also proves the route only ever reads: a non-GET to Xero fails the check.
//
// Not part of `npm test`, because it needs Postgres. Same setup as
// recs-local-check.js (scratch cluster on port 54329, database t, migrations
// applied), then from finance-api: node scripts/account-activity-local-check.js

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

const row = (id, name, code, ydr, ycr) => ({ RowType: "Row", Cells: [
  { Value: `${name} (${code})`, Attributes: [{ Id: "account", Value: id }] }, { Value: "0" }, { Value: "0" }, { Value: String(ydr) }, { Value: String(ycr) }] });
const TB = {
  "2025-12-31": [row("a-pre", "Prepayments", "620", 1000, 0)],
  "2026-09-30": [row("a-pre", "Prepayments", "620", 3150, 0)],
};
const line = (code, amount, tax = 0) => ({ AccountCode: code, LineAmount: amount, TaxAmount: tax, Description: `on ${code}` });
// 105 bills over two pages, one of them coded to 620; the rest go elsewhere.
const BILLS = Array.from({ length: 105 }, (_, i) => ({
  InvoiceID: `inv-${i}`, Type: "ACCPAY", InvoiceNumber: `B-${i}`, Contact: { Name: "Sample Supplier Ltd" },
  DateString: "2026-03-01T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive",
  LineItems: [i === 104 ? line("620", 1200, 240) : line("400", 10, 2)],
}));
const DOCS = {
  "/Invoices": (page) => ({ Invoices: page === "1" ? BILLS.slice(0, 100) : BILLS.slice(100) }),
  "/CreditNotes": () => ({ CreditNotes: [] }),
  "/BankTransactions": () => ({ BankTransactions: [{ BankTransactionID: "bt-1", Type: "SPEND", Reference: "Card", DateString: "2026-02-01T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Inclusive", LineItems: [line("620", 1500, 250)] }] }),
  "/ManualJournals": () => ({ ManualJournals: [
    { ManualJournalID: "mj-1", Narration: "Release", DateString: "2026-09-30T00:00:00", Status: "POSTED", JournalLines: [line("620", -300), line("463", 300)] },
    { ManualJournalID: "mj-2", Narration: "Draft", DateString: "2026-09-30T00:00:00", Status: "DRAFT", JournalLines: [line("620", -50), line("463", 50)] },
  ] }),
};
const seen = [];
let nonGet = 0;

const realFetch = global.fetch;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") { nonGet += 1; return json({}, 500); }
  const p = u.pathname.replace("/api.xro/2.0", "");
  seen.push(`${p}${u.searchParams.get("page") ? `#${u.searchParams.get("page")}` : ""}${u.searchParams.get("date") ? `@${u.searchParams.get("date")}` : ""}`);
  if (p === "/Accounts") return json({ Accounts: [{ AccountID: "a-pre", Code: "620", Name: "Prepayments", Class: "ASSET", Type: "PREPAYMENT" }] });
  if (p === "/Reports/TrialBalance") return json({ Reports: [{ Rows: [{ RowType: "Section", Rows: TB[u.searchParams.get("date")] ?? [] }] }] });
  if (DOCS[p]) return json(DOCS[p](u.searchParams.get("page")));
  return json({}, 404);
};

const { app, pool } = require("../server.js");

let base;
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; console.log("  ok  ", name); return; }
  failures.push(name);
  console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
};
const get = async (q) => {
  const r = await realFetch(`${base}/api/finance/clients/sample-group/xero/alpha-ltd/account-activity${q}`, { headers: { "X-API-Key": "k", "X-Actor-Email": "cfo@example.com" } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

async function scenario() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = 'sample-group'");
  const cid = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ('sample-group','Sample Group') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,'alpha-ltd','Alpha Ltd',$2)", [cid, JSON.stringify({ tenant_id: "tenant-a", tenant_name: "Alpha Ltd" })]);

  const r = await get("?code=620&from=2026-01-01&to=2026-09-30");
  ok("answers 200", r.status === 200, r);
  const b = r.body;
  ok("reads the opening the day before from", b.opening_date === "2025-12-31" && b.opening_from_tb === 1000, b);
  ok("finds the spend money line, net of VAT", b.lines?.some((l) => l.id === "bt-1" && l.debit === 1250), b.lines);
  ok("finds the bill on the second page", b.lines?.some((l) => l.id === "inv-104" && l.debit === 1200), b.lines);
  ok("counts the posted release and not the draft", b.posted_total?.credit === 300 && b.not_posted?.length === 1, b);
  ok("agrees to the closing trial balance", b.closing_from_tb === 3150 && b.rebuilt_closing === 3150 && b.unexplained === 0, b);
  ok("says it was complete", b.complete === true && b.documents_read === 108, b);
  ok("names the entity and the account", b.entity === "Alpha Ltd" && b.account?.name === "Prepayments", b);
  ok("reads Xero one source after another, paging invoices", seen.join(",") === [
    "/Accounts", "/Reports/TrialBalance@2025-12-31", "/Reports/TrialBalance@2026-09-30",
    "/ManualJournals#1", "/CreditNotes#1", "/BankTransactions#1", "/Invoices#1", "/Invoices#2",
  ].join(","), seen);
  ok("never writes to Xero", nonGet === 0, nonGet);

  ok("refuses a bad code", (await get("?code=620%26x&from=2026-01-01&to=2026-09-30")).status === 400);
  ok("refuses a bad date", (await get("?code=620&from=2026-13-01&to=2026-09-30")).status === 400);
  ok("refuses dates the wrong way round", (await get("?code=620&from=2026-10-01&to=2026-09-30")).status === 400);
  ok("says when the code is not in the chart", (await get("?code=999&from=2026-01-01&to=2026-09-30")).status === 404);

  console.log(`\n${pass} passed, ${failures.length} failed`);
}

(async () => {
  await new Promise((done) => { app.listen(8789, "127.0.0.1", done); });
  base = "http://127.0.0.1:8789";
  await scenario();
  // Let the token refresh's background work settle before exiting; exiting
  // under it trips a libuv assertion on Windows.
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

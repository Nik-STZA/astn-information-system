// Outstanding documents, end to end: the real server.js on a real, local,
// throwaway Postgres, with Gemini and Secret Manager faked inside this process.
// Any other network host throws, so this cannot reach Google or a live database.
//
// Not part of `npm test`, because it needs Postgres. To run:
//   1. initdb a scratch cluster, start it on port 54329, create database t.
//   2. Apply migrations 024, 025, the finance set, then 029 to 040.
//   3. node scripts/outstanding-docs-local-check.js      (from finance-api)

const Module = require("module");
const zlib = require("zlib");
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
global.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  throw new Error(`blocked host ${u.hostname}`);
};

// Gemini, faked: answers with whatever the scenario sets, and records the request.
const vertex = require("../lib/vertex");
let reading = { lines: [] };
let readingFails = null;
const requests = [];
vertex.generate = async (body) => {
  requests.push(body);
  if (readingFails) { const e = new Error(readingFails); e.httpStatus = 502; throw e; }
  return { text: JSON.stringify(reading), model: "gemini-test", location: "europe-west2" };
};

const { app, pool } = require("../server.js");

const SLUG = "sample-docs";
const CFO = "cfo@example.com";
const BOOK = "clerk@example.com";
let base, CID;
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
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/outstanding-documents${path}`, {
    method, headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const upload = async (name, bytes, headers = {}) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/outstanding-documents/uploads`, {
    method: "POST", headers: { "X-API-Key": "k", "X-Actor-Email": CFO, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name), ...headers },
    body: bytes,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

async function seed() {
  reading = { lines: [] }; readingFails = null; requests.length = 0;
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Ltd') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_finance_config (client_id) VALUES ($1)", [CID]);
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'),($1,$3,'Bookkeeper')", [CID, CFO, BOOK]);
  await pool.query(`INSERT INTO finance.entities (client_id, slug, name, legal_name, accounting_system_config) VALUES
    ($1,'alpha-ltd','Alpha','Alpha Trading Limited','{}'), ($1,'beta-ltd','Beta','Beta Digital Limited','{}')`, [CID]);
}

// A one-sheet workbook, built here so no client file sits in the repo.
function workbook(rows) {
  const cell = (v, r, c) => `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const files = {
    "xl/workbook.xml": `<workbook><sheets><sheet name="Outstanding" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${rows.map((cells, i) => `<row r="${i + 1}">${cells.map((v, c) => cell(v, i + 1, c)).join("")}</row>`).join("")}</sheetData></worksheet>`,
  };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), body = zlib.deflateRawSync(data), n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body); centrals.push(ch, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const LINE = (o) => ({ bank_account: "Main account", date: "2025-01-29", payee: "Utility Co", reference: "Faster payment", direction: "spent", amount: 930.31, currency: "GBP", concern: "no_vat_invoice", source_line: "R3", ...o });
const items = async (state) => (await api("GET", state ? `?state=${state}` : "")).body;

async function scenario() {
  await section("before anything: an empty register", async () => {
    await seed();
    const r = await api("GET", "");
    ok("200 with no items", r.status === 200 && r.body.items.length === 0 && r.body.threshold === 25, r.body);
    ok("concerns listed for the page", r.body.concerns.no_vat_invoice.label === "No valid VAT invoice");
  });

  await section("upload a workbook, read it, accept the lines", async () => {
    await seed();
    const wb = workbook([["Main account"], ["Date", "Payee", "Spent"], ["29/01/2025", "Utility Co", "930.31"], ["04/04/2025", "Recruiter IRL", "1319.88"]]);
    let r = await upload("Alpha bank rec.xlsx", wb);
    ok("201, waiting to be read", r.status === 201 && r.body.upload.read_state === "waiting" && r.body.already === false, r.body);
    const id = r.body.upload.id;
    r = await upload("copy of it.xlsx", wb);
    ok("the same file again is the same upload", r.status === 200 && r.body.already === true && r.body.upload.id === id, r.body);

    reading = {
      report: { title: "Bank Reconciliation", organisation: "Alpha Trading Limited", as_at: "2025-07-31" },
      lines: [
        LINE(),
        LINE({ date: "2025-04-04", payee: "Recruiter IRL", amount: 1319.88, concern: "overseas_reverse_charge", source_line: "R4" }),
        LINE({ date: "2025-04-04", payee: "Recruiter IRL", amount: 1319.88, concern: "overseas_reverse_charge", source_line: "R9" }),
        LINE({ date: "not a date", payee: "Broken", source_line: "R5" }),
      ],
    };
    r = await api("POST", `/uploads/${id}/read`, {});
    ok("read: 3 lines, 1 repeat inside the file, 1 skipped", r.status === 200 && r.body.lines === 3 && r.body.duplicates === 1 && r.body.skipped.length === 1, r.body);
    ok("the sheet went to the model as text with row labels", /R3\t29\/01\/2025\tUtility Co\t930\.31/.test(requests[0].contents[0].parts[0].text), requests[0]?.contents?.[0]?.parts?.[0]?.text?.slice(-300));
    ok("placed in Alpha from the report's organisation", r.body.unplaced === 0, r.body);
    r = await api("POST", `/uploads/${id}/read`, {});
    ok("a read file is not read twice by accident", r.status === 409, r);

    let list = await items();
    const cands = list.items.filter((x) => x.state === "candidate");
    ok("3 candidates, all Alpha", cands.length === 3 && cands.every((x) => x.entity_slug === "alpha-ltd"), list.items);
    ok("summary counts candidates, nothing open yet", list.summary.candidates === 3 && list.summary.open.count === 0, list.summary);
    const utility = cands.find((x) => x.payee === "Utility Co");
    ok("VAT flagged above 25, up to a sixth", utility.vat.flagged && utility.vat.at_risk_max === 155.05, utility.vat);

    r = await api("POST", "/bulk", { step: "accept", ids: cands.map((x) => x.id) });
    ok("bulk accept: 2 accepted, the repeat refused", r.status === 200 && r.body.done.length === 2 && r.body.refused.length === 1 && /repeats/.test(r.body.refused[0].issues[0]), r.body);
    const repeat = r.body.refused[0].id;
    r = await api("POST", `/${repeat}/dismiss`, { note: "Same line twice in the report" });
    ok("the repeat dismissed", r.status === 200 && r.body.state === "dismissed", r);

    list = await items();
    ok("2 open, value 2,250.19, 1 VAT flag (overseas not counted)", list.summary.open.count === 2 && list.summary.open.value === 2250.19 && list.summary.vat.flagged === 1, list.summary);
    ok("by month", Object.keys(list.summary.by_month).join() === "2025-01,2025-04", list.summary.by_month);
    ok("dismissed hidden from the live list", !list.items.some((x) => x.id === repeat));
    ok("but kept in all", (await items("all")).items.some((x) => x.id === repeat && x.state === "dismissed"));

    const audit = (await pool.query("SELECT action FROM finance.audit_log WHERE client_id = $1 ORDER BY id", [CID])).rows.map((x) => x.action);
    ok("every step logged", ["outstanding_docs_uploaded", "outstanding_docs_read", "outstanding_doc_accept", "outstanding_doc_dismiss"].every((a) => audit.includes(a)), audit);

    const held = (await pool.query("SELECT bytes, bytes_cleared_at, sha256 FROM finance.document_uploads WHERE id = $1", [id])).rows[0];
    ok("the file's contents deleted once read, name and fingerprint kept", held.bytes === null && held.bytes_cleared_at && held.sha256, held);
    r = await upload("copy again.xlsx", wb);
    ok("uploading it after it was read is still caught", r.status === 200 && r.body.already === true && r.body.upload.read_state === "read" && r.body.upload.file_deleted_at, r.body);
    r = await realFetch(`${base}/api/finance/clients/${SLUG}/outstanding-documents/uploads/${id}/file`, { headers: { "X-API-Key": "k" } });
    ok("no route serves a file back", r.status === 404, r.status);
  });

  await section("placing a line, and a second report meets the first", async () => {
    await seed();
    const a = (await upload("a.csv", Buffer.from("Date,Payee,Amount\n2025-02-07,Airline,850.32\n"))).body.upload.id;
    reading = { lines: [LINE({ date: "2025-02-07", payee: "Airline", amount: 850.32, source_line: "R2" })] };
    let r = await api("POST", `/uploads/${a}/read`, {});
    ok("read without a company named", r.status === 200 && r.body.unplaced === 1, r.body);
    let cand = (await items()).items[0];
    r = await api("POST", `/${cand.id}/accept`, {});
    ok("cannot accept without a company", r.status === 422 && /choose the company/.test(r.body.issues[0]), r.body);
    r = await api("PATCH", `/${cand.id}`, { entity: "beta-ltd", concern: "business_purpose", note: "Flight, who travelled?" });
    ok("company and concern set", r.status === 200, r);
    cand = (await items()).items.find((x) => x.id === cand.id);
    ok("the edit saved", cand.entity_slug === "beta-ltd" && cand.concern === "business_purpose" && /who travelled/.test(cand.note), cand);
    r = await api("POST", `/${cand.id}/accept`, {});
    ok("accepted", r.status === 200 && r.body.state === "open", r);

    const b = (await upload("b.pdf", Buffer.from("%PDF-1.7 fake"))).body.upload.id;
    reading = { report: { organisation: "Beta Digital Limited" }, lines: [LINE({ date: "2025-02-07", payee: "AIRLINE", amount: 850.32, source_line: "p1" })] };
    r = await api("POST", `/uploads/${b}/read`, {});
    ok("a PDF goes to the model as the file", requests.at(-1).contents[0].parts[0].inlineData?.mimeType === "application/pdf");
    ok("the same transaction in a second report is marked as a repeat", r.body.duplicates === 1, r.body);
    const twin = (await items()).items.find((x) => x.state === "candidate");
    r = await api("POST", `/${twin.id}/accept`, {});
    ok("and refused on accept", r.status === 422 && /repeats/.test(r.body.issues[0]), r.body);
    r = await api("POST", `/${twin.id}/accept`, { allow_duplicate: true });
    ok("unless accepted as separate on purpose", r.status === 200, r);
  });

  await section("working the register", async () => {
    await seed();
    let r = await api("POST", "", { entity: "alpha-ltd", txn_date: "2025-03-27", payee: "Jo Bloggs", amount: "19,200.00", concern: "audit_evidence", note: "Consultancy, no contract" });
    ok("added by hand, open", r.status === 201, r);
    const id = r.body.id;
    r = await api("POST", "", { entity: "alpha-ltd", txn_date: "2025-03-27", payee: "JO BLOGGS", amount: 19200 });
    ok("the same one by hand again refused", r.status === 409 && r.body.duplicate_of === id, r);
    r = await api("POST", `/${id}/chased`, {});
    r = await api("POST", `/${id}/chased`, {});
    let it = (await items()).items.find((x) => x.id === id);
    ok("chased twice", it.chase_count === 2 && it.last_chased_at, it);
    r = await api("POST", `/${id}/accept-without`, { reason: "short" });
    ok("closing without a document needs a reason", r.status === 422 && /at least 15/.test(r.body.issues.join()), r.body);
    r = await api("POST", `/${id}/accept-without`, { reason: "Supplier dissolved; cannot obtain an invoice" }, { "X-Actor-Email": BOOK });
    ok("only the CFO closes without a document", r.status === 422 && /only the CFO/.test(r.body.issues.join()), r.body);
    r = await api("POST", `/${id}/accept-without`, { reason: "Supplier dissolved; cannot obtain an invoice" });
    ok("the CFO closes it", r.status === 200 && r.body.state === "accepted", r);
    ok("it leaves the open count", (await items()).summary.open.count === 0);
    r = await api("POST", `/${id}/reopen`, {});
    ok("reopened", r.status === 200 && r.body.state === "open", r);
    r = await api("POST", `/${id}/received`, { note: "Invoice attached in Xero 12 Nov" }, { "X-Actor-Email": BOOK });
    ok("received by anyone on the engagement", r.status === 200 && r.body.state === "received", r);
    it = (await items("all")).items.find((x) => x.id === id);
    ok("closed with who and why", it.closed_by === BOOK && /Invoice attached/.test(it.close_reason), it);
    r = await api("PATCH", `/${id}`, { note: "x" });
    ok("a closed item is not edited", r.status === 422, r);
  });

  await section("settings and refusals", async () => {
    await seed();
    let r = await api("PATCH", "/settings", { vat_threshold: 50 }, { "X-Actor-Email": BOOK });
    ok("only the CFO sets the threshold", r.status === 403, r);
    r = await api("PATCH", "/settings", { vat_threshold: "50" });
    ok("the CFO sets it", r.status === 200 && r.body.threshold === 50, r);
    await api("POST", "", { entity: "alpha-ltd", txn_date: "2025-03-01", payee: "Cafe", amount: 40 });
    ok("a 40 cost is under a 50 threshold", (await items()).summary.vat.flagged === 0);
    r = await api("POST", "", { entity: "alpha-ltd", txn_date: "2025-03-01", payee: "x", amount: 1 }, { "X-Work-Via": "claude" });
    ok("agents and Claude refused", r.status === 403, r);
    r = await api("POST", "", { entity: "alpha-ltd", txn_date: "2025-03-01", payee: "x", amount: 1 }, { "X-Actor-Email": "stranger@example.com" });
    ok("no engagement role refused", r.status === 403, r);
    r = await upload("old.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]));
    ok("an old .xls refused with what to do", r.status === 422 && /save it as \.xlsx/.test(r.body.issues[0]), r.body);
    r = await upload("page.html", Buffer.from("<html></html>"));
    ok("anything else refused", r.status === 422, r.body);
    r = await upload("big.pdf", Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(9 * 1024 * 1024)]));
    ok("over 8 MB refused", r.status === 413, r.status);
    const id = (await upload("x.pdf", Buffer.from("%PDF-1.4 x"))).body.upload.id;
    readingFails = "Vertex 429: quota";
    r = await api("POST", `/uploads/${id}/read`, {});
    ok("a failed read says why and can be tried again", r.status === 502 && /quota/.test(r.body.error), r.body);
    ok("and keeps the file for it", (await pool.query("SELECT bytes IS NOT NULL AS held FROM finance.document_uploads WHERE id = $1", [id])).rows[0].held);
    readingFails = null;
    reading = { lines: [] };
    r = await api("POST", `/uploads/${id}/read`, {});
    ok("tried again", r.status === 200 && r.body.lines === 0, r.body);
  });
}

(async () => {
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

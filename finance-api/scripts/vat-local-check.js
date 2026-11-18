// VAT returns end to end: the real server.js routes on a real, local,
// throwaway Postgres, with Xero and Secret Manager faked in this process.
// Not part of `npm test`. A scratch cluster on 54329, database t, migrations
// to 058; then from finance-api: node scripts/vat-local-check.js

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
Object.assign(process.env, { FINANCE_API_KEY: "k", DB_PORT: process.env.DB_PORT || "54329", DB_USER: process.env.DB_USER || "postgres", DB_NAME: "t", DB_PASSWORD: "x", XERO_READS_PER_MINUTE: "100000" });

const SLUG = "sample-vat";
const CFO = "cfo@example.com";
const FM = "fm@example.com";
let xeroWrites = 0;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const realFetch = global.fetch;
// Each company's VAT control: 200.00 debit at 30 Sep, 320.00 at 31 Oct, with a
// clearing journal of -100 and an HMRC receipt of 0 in October for the representative.
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(url, opts);
  if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800, refresh_token: "x" });
  if (u.hostname !== "api.xero.com") throw new Error(`blocked host ${u.hostname}`);
  if ((opts.method ?? "GET") !== "GET") { xeroWrites++; return json({}, 500); }
  const t = String(new Headers(opts.headers).get("xero-tenant-id"));
  if (u.pathname.endsWith("/Accounts")) return json({ Accounts: [{ AccountID: `vat-${t}`, Code: "820", Name: "VAT", SystemAccount: "GST", Class: "LIABILITY" }] });
  if (u.pathname.endsWith("/Reports/TrialBalance")) {
    const bal = u.searchParams.get("date") === "2026-10-31" ? (t === "tenant-rep" ? 220 : 320) : 200;
    return json({ Reports: [{ Rows: [{ RowType: "Section", Rows: [{ RowType: "Row", Cells: [{ Value: "VAT (820)", Attributes: [{ Id: "account", Value: `vat-${t}` }] }, { Value: "0" }, { Value: "0" }, { Value: String(bal) }, { Value: "0" }] }] }] }] });
  }
  // As Xero does: lines only on a paged read.
  if (u.pathname.endsWith("/ManualJournals")) {
    const paged = u.searchParams.has("page");
    if (u.searchParams.get("page") > "1") return json({ ManualJournals: [] });
    return json({ ManualJournals: t === "tenant-rep" ? [{ Narration: "VAT group clearing", ...(paged ? { JournalLines: [{ AccountCode: "820", LineAmount: -100 }] } : {}) }] : [] });
  }
  if (u.pathname.endsWith("/BankTransactions")) return json({ BankTransactions: [] });
  return json({}, 404);
};
const { app, pool } = require("../server.js");

// A synthetic export in Xero's layout (see lib/vat-export.test.js).
function exportOf(entity, { box4 = 120, extra = [] } = {}) {
  const b = { 1: 0, 2: 0, 3: 0, 4: box4, 5: box4, 6: 0, 7: box4 * 5, 8: 0, 9: 0 };
  return {
    "VAT Return": [["VAT Return"], [entity], ["For the period 01 Oct 2026 - 31 Oct 2026"], [], ["VAT Number", "GB123456789"], ["Period Start", "01 Oct 2026"], ["Period End", "31 Oct 2026"],
      ...[1, 2, 3, 4].map((n) => [`Box ${n}`, String(n), String(b[n])]), ["VAT to reclaim from HMRC", "5", String(b[5])], ...[6, 7, 8, 9].map((n) => [`Box ${n}`, String(n), String(b[n])])],
    "Other tab": [["dropped"]],
    "Transactions by VAT Box": [["Transactions by VAT Box"], [entity], ["For the period 01 Oct 2026 - 31 Oct 2026"],
      ["Box 4", "VAT reclaimed", String(b[4])], ["20% (VAT on Expenses)"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["10/10/2026", "Rent(469)", "R-1", "Sample Landlord - rent", "120", String(box4 * 5)], ...extra,
      ["Box 7", "Purchases", String(b[7])], ["20% (VAT on Expenses)"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["10/10/2026", "Rent(469)", "R-1", "Sample Landlord - rent", "120", String(box4 * 5)]],
  };
}

let base, CID, reg; const ENT = {};
let pass = 0; const failures = [];
const ok = (name, cond, extra) => { if (cond) { pass++; return; } failures.push(name); console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); };
const api = async (method, path, body, actor = CFO) => {
  const r = await realFetch(`${base}/api/finance/clients/${SLUG}/${path}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": actor, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

async function scenario() {
  await pool.query("UPDATE shared.clients SET slug = 'old-' || id WHERE slug = $1", [SLUG]);
  CID = (await pool.query("INSERT INTO shared.clients (slug, name) VALUES ($1,'Sample Group') RETURNING id", [SLUG])).rows[0].id;
  await pool.query("INSERT INTO finance.client_engagement_roles (client_id, actor_email, role) VALUES ($1,$2,'Fractional CFO'), ($1,$3,'Finance Manager')", [CID, CFO, FM]);
  for (const [slug, name, tenant] of [["rep-ltd", "Rep Ltd", "tenant-rep"], ["m1-ltd", "Member One Ltd", "tenant-m1"], ["m2-ltd", "Member Two Ltd", "tenant-m2"]]) {
    ENT[slug] = (await pool.query("INSERT INTO finance.entities (client_id, slug, name, accounting_system_config) VALUES ($1,$2,$3,$4) RETURNING id", [CID, slug, name, JSON.stringify({ tenant_id: tenant })])).rows[0].id;
  }
  reg = (await pool.query("INSERT INTO finance.vat_registrations (client_id, vat_number, kind, representative_id, created_by) VALUES ($1,'123456789','group',$2,'check') RETURNING id", [CID, ENT["rep-ltd"]])).rows[0].id;
  for (const id of Object.values(ENT)) await pool.query("INSERT INTO finance.vat_registration_members (registration_id, entity_id, effective_from) VALUES ($1,$2,'2026-01-01')", [reg, id]);

  let r = await api("POST", "vat/returns", { period_start: "2026-10-01", period_end: "2026-10-31" });
  ok("a return is opened for the period", r.status === 201, r.body);
  const RID = r.body.id;
  r = await api("POST", `vat/returns/${RID}/uploads`, { entity_id: ENT["m1-ltd"], kind: "member_export", file_name: "m1.xlsx", sheets: { Sheet1: [["x"]] } });
  ok("a file that is not a VAT export is refused", r.status === 422, r.body);
  const adj = [["Adjustments with no accounting transactions"], ["Date", "Account", "Reference", "Details", "VAT", "Net"], ["31/10/2026", "N/A", "Created on 01/11/2026", "Manual correction", "0", "0"]];
  for (const [slug, opts] of [["rep-ltd", {}], ["m1-ltd", {}], ["m2-ltd", { extra: adj }]]) {
    r = await api("POST", `vat/returns/${RID}/uploads`, { entity_id: ENT[slug], kind: "member_export", file_name: `${slug}.xlsx`, sheets: exportOf(slug, opts) });
    ok(`${slug}'s export is taken`, r.status === 201 && r.body.boxes[4] === 120, r.body);
  }
  let v = (await api("GET", `vat/returns/${RID}`)).body;
  ok("the adjustment with no transaction blocks the build", v.checks.blocking.join() === "adjustments" && v.group === null, v.checks);
  ok("the page gets the representative and each adjustment's line", v.return.representative_id === ENT["rep-ltd"] && v.checks.checks.find((c) => c.key === "adjustments").items[0].line_id, v.checks);
  const lineId = (await pool.query("SELECT id FROM finance.vat_return_lines WHERE return_id = $1 AND kind = 'no_transaction'", [RID])).rows[0].id;
  r = await api("POST", `vat/returns/${RID}/adjustments`, { line_id: lineId, reason: "Short reason?" }, FM);
  ok("only the CFO accepts an adjustment", r.status === 403, r.body);
  r = await api("POST", `vat/returns/${RID}/adjustments`, { line_id: lineId, reason: "Nil correction kept on the CFO's instruction", evidence_ref: "note" });
  ok("the CFO accepts it", r.status === 201, r.body);
  v = (await api("GET", `vat/returns/${RID}?ledger=1`)).body;
  ok("then the checks pass and the group is built", v.checks.ok && v.group?.target?.[4] === 360 && v.group.import[4] === 240, { checks: v.checks.blocking, group: v.group });
  ok("the import template is ready", v.group.template_rows[4][0] === "Box 4" && v.group.template_rows[4][1] === 240, v.group.template_rows);
  const rep = v.ledger.find((x) => x.entity === "Rep Ltd");
  ok("the ledger tie takes out the clearing journal", rep && rep.movement === 20 && rep.excluded === -100 && rep.trading === 120 && rep.from_return === 120 && rep.difference === 0, v.ledger);
  const m1 = v.ledger.find((x) => x.entity === "Member One Ltd");
  ok("a member's movement ties to its return", m1 && m1.difference === 0, v.ledger);
  r = await api("POST", `vat/returns/${RID}/imports`, { boxes: v.group.import });
  ok("the import is recorded and the return is ready to import", r.status === 201 && r.body.kind === "group", r.body);
  const after = exportOf("rep-ltd", { box4: 360, extra: [["Imported VAT box amount"], ["Date", "Account", "Reference", "Details", "VAT", "Net"], ["31/10/2026", "N/A", "Import", "VAT box amount from uploaded file", "240", "0"]] });
  after["VAT Return"] = after["VAT Return"].map((row) => (row[1] === "7" ? ["Box 7", "7", "1800"] : row));
  r = await api("POST", `vat/returns/${RID}/uploads`, { entity_id: ENT["rep-ltd"], kind: "representative_post_import", file_name: "rep-after.xlsx", sheets: after });
  v = (await api("GET", `vat/returns/${RID}`)).body;
  ok("after the import nothing more is needed on box 4", v.group.import[4] === 0, v.group.import);
  ok("the confirmation names what still differs", Array.isArray(v.confirmation), v.confirmation);
  r = await api("POST", `vat/returns/${RID}/uploads`, { entity_id: ENT["m1-ltd"], kind: "representative_pre_import", file_name: "x.xlsx", sheets: exportOf("m1") });
  ok("only the representative uploads a pre/post-import return", r.status === 422, r.body);
  // The workbook (migration 059)
  const tabs = (await pool.query("SELECT sheets FROM finance.vat_return_uploads WHERE return_id = $1 AND entity_id = $2 AND kind = 'member_export' AND superseded_at IS NULL", [RID, ENT["m1-ltd"]])).rows[0].sheets;
  ok("an upload keeps Xero's tabs and nothing else", tabs && Object.keys(tabs).join() === "VAT Return,Transactions by VAT Box", tabs && Object.keys(tabs));
  r = await api("POST", `vat/returns/${RID}/workbook`, {});
  ok("no drive, no workbook", r.status === 422 && /no shared drive/.test(r.body.issues?.[0]), r.body);
  await pool.query("UPDATE finance.vat_registrations SET drive_id = 'drive0000001', export_path = '[\"Sample\", \"VAT\", \"{yyyy}\", \"{yymm}\"]'::jsonb, workbook_title = 'Sample' WHERE id = $1", [reg]);
  await pool.query("UPDATE finance.vat_registration_members SET code = 'REP' WHERE entity_id = $1", [ENT["rep-ltd"]]);
  r = await api("GET", `vat/returns/${RID}/workbook-data`);
  ok("the pack engine gets the folder, the codes and each company's tabs, representative first",
    r.status === 200 && r.body.drive.path.join("/") === "Sample/VAT/2026/2610" && r.body.title === "Sample"
      && r.body.companies[0].code === "REP" && r.body.companies[0].representative && r.body.companies[1].code === "MO"
      && r.body.companies[0].sheets["VAT Return"].length > 5 && r.body.companies[0].after_import?.file_name === "rep-after.xlsx", r.body);
  const saved = process.env.GCP_PROJECT;
  delete process.env.GCP_PROJECT;
  r = await api("POST", `vat/returns/${RID}/workbook`, {});
  ok("without the pack engine configured it says so", r.status === 503, r.body);
  if (saved) process.env.GCP_PROJECT = saved;
  r = await api("POST", `vat/returns/${RID}/workbook-saved`, { file_id: "file0000001", name: "Sample VAT Group Return - 2610.xlsx", link: "https://drive.google.com/file/d/file0000001/view" });
  v = (await api("GET", `vat/returns/${RID}`)).body;
  ok("the saved file shows on the return", v.workbook.link?.includes("file0000001") && v.workbook.drive_set && v.uploads.every((u) => u.has_sheets), v.workbook);
  r = await api("POST", `vat/returns/${RID}/workbook-saved`, { link: "https://evil.example/x" });
  ok("a report without a file id is refused", r.status === 422, r.body);
  ok("nothing was written to Xero", xeroWrites === 0, xeroWrites);
}

const server = app.listen(0, "127.0.0.1", async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  try { await scenario(); } catch (e) { failures.push("threw"); console.log(e.stack); }
  finally {
    console.log(`\n${pass} passed, ${failures.length} failed`);
    if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
    server.close(); await new Promise((r) => setTimeout(r, 800)); await pool.end(); process.exit(failures.length ? 1 : 0);
  }
});

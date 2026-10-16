#!/usr/bin/env node
// Read-capability check: calls every read endpoint finance-api offers for one
// entity and prints a pass/fail table (docs/ap-lane/xero-capability-register.md,
// phase 0). Read-only: GET requests through finance-api, nothing is written.
//
//   FINANCE_API_KEY=... node scripts/xero-read-check.js <client> <entity> [baseUrl]
//
// For each resource it reads the list, then one record from it and that
// record's sub-resources (history, attachments, PDF...). A resource with no
// records is reported as "empty", not as a failure. Payroll is expected to
// fail with 401/403 on an organisation without Xero Payroll.
//
// Calls are paced (XERO_CHECK_DELAY_MS, default 1100) because Xero allows about
// 60 calls a minute per organisation; unpaced, the check fails on 429s rather
// than on capability.

const { XERO_READ_RESOURCES, XERO_READ_REPORTS } = require("../lib/xero-read");

const [client, entity, base = "https://stza-finance-api-782190795609.europe-west1.run.app"] = process.argv.slice(2);
const key = process.env.FINANCE_API_KEY;
if (!client || !entity || !key) {
  console.error("usage: FINANCE_API_KEY=... node scripts/xero-read-check.js <client> <entity> [baseUrl]");
  process.exit(2);
}
const root = `${base}/api/finance/clients/${client}/xero/${entity}/read`;
const DELAY = Number(process.env.XERO_CHECK_DELAY_MS || 1100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(path) {
  await sleep(DELAY);
  const t = Date.now();
  const r = await fetch(`${root}${path}`, { headers: { "X-API-Key": key } });
  const type = r.headers.get("content-type") || "";
  const body = type.includes("json") ? await r.json().catch(() => null) : await r.arrayBuffer();
  return { status: r.status, ms: Date.now() - t, type, body };
}

// The first record's id, whatever the API calls it (InvoiceID, Id, assetId...).
function firstId(data) {
  const list = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray);
  const rec = list && list[0];
  if (!rec || typeof rec !== "object") return null;
  const k = Object.keys(rec).find((x) => /id$/i.test(x) && GUID.test(String(rec[x])));
  return k ? rec[k] : null;
}

const rows = [];
// Xero answers 404 here when the feature is simply not in use: the online link
// exists only for approved sales invoices, CIS settings only where CIS is on.
const NOT_APPLICABLE_404 = /\/(online|cis)$/;

const add = (what, r, note = "") => {
  if (r.status === 502 && r.body?.detail?.status === 404 && NOT_APPLICABLE_404.test(what)) {
    rows.push({ what, result: "n/a", ms: r.ms, note: "not used on this record or organisation" });
    return;
  }
  const pass = r.status >= 200 && r.status < 300;
  const detail = !pass && r.body && r.body.error ? String(r.body.error).slice(0, 90) : "";
  rows.push({ what, result: pass ? "pass" : `FAIL ${r.status}`, ms: r.ms, note: note || detail });
};

(async () => {
  // The aged reports are per contact, so they are asked for the first one.
  const contacts = await call("/contacts?page=1");
  const contactId = contacts.status === 200 ? firstId(contacts.body.data) : null;
  for (const [report] of Object.entries(XERO_READ_REPORTS)) {
    const aged = report.startsWith("aged-");
    if (aged && !contactId) continue;
    add(`report ${report}`, await call(`/reports/${report}${aged ? `?contactID=${contactId}` : ""}`));
  }

  for (const [name, def] of Object.entries(XERO_READ_RESOURCES)) {
    if (def.idRequired || def.idIsOrg) continue; // reached from another record below
    // The live service may predate a list default; send it explicitly too.
    const qs = new URLSearchParams(def.listQuery || {}).toString();
    const list = await call(`/${name}${qs ? `?${qs}` : ""}`);
    add(name, list);
    if (list.status !== 200 || !def.byId) continue;

    const id = firstId(list.body.data);
    if (!id) {
      rows[rows.length - 1].note = "empty";
      continue;
    }
    add(`${name}/:id`, await call(`/${name}/${id}`));
    for (const sub of def.subs || []) {
      const r = await call(`/${name}/${id}/${sub}`);
      const note = r.status === 200 && !r.type.includes("json") ? `${r.type.split(";")[0]} ${r.body.byteLength} bytes` : "";
      add(`${name}/:id/${sub}`, r, note);
    }
    if (name === "invoices") add("object-associations/:id", await call(`/object-associations/${id}`));
  }

  const org = await call("/organisation");
  const orgId = org.status === 200 ? firstId(org.body.data) : null;
  if (orgId) add("organisation/:id/cis", await call(`/organisation/${orgId}/cis`));

  const w = Math.max(...rows.map((r) => r.what.length));
  console.log(`Read check: ${client}/${entity}, ${new Date().toISOString()}\n`);
  for (const r of rows) console.log(`${r.what.padEnd(w)}  ${r.result.padEnd(9)} ${String(r.ms).padStart(5)}ms  ${r.note}`);
  const failed = rows.filter((r) => r.result.startsWith("FAIL")).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

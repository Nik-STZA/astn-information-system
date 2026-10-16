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

const { XERO_READ_RESOURCES, XERO_READ_REPORTS } = require("../lib/xero-read");

const [client, entity, base = "https://stza-finance-api-782190795609.europe-west1.run.app"] = process.argv.slice(2);
const key = process.env.FINANCE_API_KEY;
if (!client || !entity || !key) {
  console.error("usage: FINANCE_API_KEY=... node scripts/xero-read-check.js <client> <entity> [baseUrl]");
  process.exit(2);
}
const root = `${base}/api/finance/clients/${client}/xero/${entity}/read`;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(path) {
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
const add = (what, r, note = "") => {
  const pass = r.status >= 200 && r.status < 300;
  const detail = !pass && r.body && r.body.error ? String(r.body.error).slice(0, 90) : "";
  rows.push({ what, result: pass ? "pass" : `FAIL ${r.status}`, ms: r.ms, note: note || detail });
};

(async () => {
  for (const [report] of Object.entries(XERO_READ_REPORTS)) {
    add(`report ${report}`, await call(`/reports/${report}`));
  }

  for (const [name, def] of Object.entries(XERO_READ_RESOURCES)) {
    if (def.idRequired || def.idIsOrg) continue; // reached from another record below
    const list = await call(`/${name}`);
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
  const failed = rows.filter((r) => r.result !== "pass").length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

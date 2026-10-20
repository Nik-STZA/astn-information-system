#!/usr/bin/env node
// The supplier master's mechanical pass, run live (docs/ap-lane/ap-lane-spec.md
// section 2.4 step 2; the computing is lib/supplier-pass.js). Read-only: GET
// requests through finance-api's read passthrough, nothing is written to Xero.
//
//   FINANCE_API_KEY=... node scripts/supplier-pass.js <client> [months=12] [out.json] [baseUrl]
//
// Prints one table per entity and the cross-entity groups, and writes the full
// result to out.json when given. Calls are paced for Xero's 60-a-minute limit.

const fs = require("fs");
const { entityPass, groupPass } = require("../lib/supplier-pass");

const [client, monthsArg = "12", out, base = "https://stza-finance-api-782190795609.europe-west1.run.app"] = process.argv.slice(2);
if (!client) {
  console.error("usage: node scripts/supplier-pass.js <client> [months=12] [out.json] [baseUrl]");
  process.exit(2);
}
let key = process.env.FINANCE_API_KEY;

// Without FINANCE_API_KEY the key is read from Secret Manager with Application
// Default Credentials, as the MCP server does, so it never sits in a shell.
async function loadKey() {
  if (key) return;
  const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
  const [v] = await new SecretManagerServiceClient().accessSecretVersion({
    name: "projects/africanstn-research/secrets/finance-api-key/versions/latest",
  });
  key = v.payload.data.toString("utf8").trim();
}
const DELAY = Number(process.env.XERO_CHECK_DELAY_MS || 1100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = `${base}/api/finance/clients/${client}`;

async function get(path, params = {}) {
  await sleep(DELAY);
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${api}${path}${qs ? `?${qs}` : ""}`, { headers: { "X-API-Key": key } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// Every page of a Xero list. Xero pages at 100 and returns line items only on
// paged reads, which is why page=1 is sent even for a short list.
async function all(entity, resource, listKey, where) {
  const rows = [];
  for (let page = 1; page <= 50; page++) {
    const body = await get(`/xero/${entity}/read/${resource}`, { page, ...(where ? { where } : {}) });
    const batch = body?.[listKey] ?? body?.data?.[listKey] ?? [];
    rows.push(...batch);
    process.stderr.write(`  ${entity} ${resource} page ${page}: ${batch.length}\n`);
    if (batch.length < 100) break;
  }
  return rows;
}

(async () => {
  await loadKey();
  const list = ((await get("/entities")).data || []).filter((e) => e.connected);
  if (!list.length) throw new Error(`no connected entities found for ${client}`);

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - Number(monthsArg));
  const from = since.toISOString().slice(0, 10);
  const xd = `DateTime(${from.slice(0, 4)},${+from.slice(5, 7)},${+from.slice(8, 10)})`;

  const results = [];
  for (const e of list) {
    const slug = e.slug || e.entity;
    process.stderr.write(`${slug}: reading...\n`);
    const orgBody = await get(`/xero/${slug}/read/organisation`);
    const organisation = (orgBody?.Organisations || orgBody?.data?.Organisations || [])[0] || {};
    const accounts = (await get(`/xero/${slug}/read/accounts`))?.data?.Accounts || [];
    // Both drive flags silently (PaysTax, balance-sheet codes), so an empty read
    // must stop the run rather than pass as "VAT registered, no balance sheet".
    if (!organisation.BaseCurrency || !accounts.length) throw new Error(`${slug}: organisation or chart of accounts came back empty`);
    const [contacts, bills, credits, spends] = [
      await all(slug, "contacts", "Contacts", "IsSupplier==true"),
      await all(slug, "invoices", "Invoices", `Type=="ACCPAY" AND Date>=${xd}`),
      await all(slug, "credit-notes", "CreditNotes", `Type=="ACCPAYCREDIT" AND Date>=${xd}`),
      await all(slug, "bank-transactions", "BankTransactions", `Type=="SPEND" AND Date>=${xd}`),
    ];
    results.push(entityPass({ entity: slug, organisation, contacts, accounts, bills, credits, spends, from }));
  }

  for (const r of results) {
    console.log(`\n== ${r.entity} (${r.base_currency}${r.pays_tax ? "" : ", not VAT registered"}) - ${r.live.length} live, ${r.spend_only.count} spend-only payees (${r.spend_only.net} purchases, ${r.spend_only.balance_sheet} to balance sheet), ${r.dormant.count} dormant, ${r.drafts_ignored} drafts ignored`);
    for (const s of r.live) {
      console.log(`${s.name.padEnd(40).slice(0, 40)} ${s.net.padStart(12)}  ${String(s.documents).padStart(3)} docs${s.balance_sheet_lines ? ` +${s.balance_sheet_lines} BS` : ""}  acct ${Object.keys(s.accounts).join("/")}  tax ${Object.keys(s.tax_types).join("/")}  ${s.flags.join(", ")}`);
    }
  }
  const groups = groupPass(results);
  const multi = groups.filter((g) => g.entities.length > 1);
  console.log(`\n== ${groups.length} supplier identities, ${multi.length} across more than one entity`);
  for (const g of multi) console.log(`${g.names.join(" | ")}: ${g.entities.map((x) => x.entity).join(", ")}`);

  if (out) {
    fs.writeFileSync(out, JSON.stringify({ client, from, run_at: new Date().toISOString(), entities: results, groups }, null, 2));
    console.log(`\nwritten ${out}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

#!/usr/bin/env node
// Capability check for the confirmed write tiers: post, send, settle, setup,
// conversion (docs/ap-lane/xero-capability-register.md, phase 0).
//
//   FINANCE_API_KEY=... node scripts/xero-confirmed-check.js <client> <entity> [baseUrl]
//
// Writes nothing. Every call is a dry run or a refusal:
//   * dry runs validate against the entity's live Xero data and must return a
//     confirmation code where the tier is on;
//   * a switched-off tier must be refused;
//   * a real call with no code, an unknown code, or a code from a dry run of a
//     different payload must be refused. On STZA only: those three are real
//     calls (dry_run false) that the confirmation check has to stop, and a
//     client ledger is not where that is proved.
// Codes issued here expire unused after 15 minutes.

const [client, entity, base = "https://stza-finance-api-782190795609.europe-west1.run.app"] = process.argv.slice(2);
const key = process.env.FINANCE_API_KEY;
const actor = process.env.STZA_ACTOR_EMAIL || "nik@stza.io";
if (!client || !entity || !key) {
  console.error("usage: FINANCE_API_KEY=... node scripts/xero-confirmed-check.js <client> <entity> [baseUrl]");
  process.exit(2);
}
const root = `${base}/api/finance/clients/${client}/xero/${entity}`;
const today = new Date().toISOString().slice(0, 10);
const TAG = `STZA-TEST ${today}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];

async function call(op, body, { query, raw } = {}) {
  await sleep(1200);
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const r = await fetch(`${root}/write/${op}${qs}`, {
    method: "POST",
    headers: { "X-API-Key": key, "X-Actor-Email": actor, "Content-Type": raw ? "text/csv" : "application/json" },
    body: raw || JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function read(path, params) {
  await sleep(1100);
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const r = await fetch(`${root}/read/${path}${qs}`, { headers: { "X-API-Key": key } });
  // The read routes wrap Xero's body as { entity, resource, data }.
  return r.ok ? ((await r.json()).data || {}) : {};
}

// expect: "code" (validated, code issued), "pass" (validated, no code), or a
// regex the refusal must match.
function check(what, r, expect) {
  const b = r.body || {};
  let ok;
  if (expect === "code") ok = r.status === 200 && b.validation === "PASS" && /^[0-9a-f]{10}$/.test(b.confirmation_code || "");
  else if (expect === "pass") ok = r.status === 200 && b.validation === "PASS" && !b.confirmation_code;
  else ok = r.status === 422 && expect.test(JSON.stringify(b.issues || b));
  if (b.action === "WRITTEN" || b.action === "UPDATED") ok = false; // never, here
  rows.push({ what, ok, status: r.status, detail: (b.issues || [b.action || b.error || ""]).join(" | ").slice(0, 160) });
  return b;
}
const skip = (what, why) => rows.push({ what, ok: null, status: "-", detail: `skipped: ${why}` });

(async () => {
  const accounts = (await read("accounts")).Accounts || [];
  const active = accounts.filter((a) => a.Status === "ACTIVE");
  const expense = active.find((a) => a.Type === "EXPENSE" || a.Type === "OVERHEADS");
  const liability = active.find((a) => a.Type === "CURRLIAB");
  // The write routes name a bank account by its Code; Xero lets bank accounts have none.
  const banks = active.filter((a) => a.Type === "BANK" && a.Code);
  const org = ((await read("organisation")).Organisations || [])[0] || {};

  // ── journals from a file ──────────────────────────────────────────────────
  if (expense && liability) {
    const csv = (amt, rate = "") => [
      "*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount",
      `${TAG} journal file check,${today},${TAG},${expense.Code},${rate},${amt}`,
      `${TAG} journal file check,${today},${TAG},${liability.Code},${rate},-${amt}`,
    ].join("\r\n");
    const q = (extra) => ({ audit_note: `${TAG}: confirmed tier check`, ...extra });
    check("journal file DRAFT dry run (draft tier)", await call("journals-from-file", null, { raw: csv("0.01"), query: q({ status: "DRAFT" }) }), "pass");
    const posted = await call("journals-from-file", null, { raw: csv("0.01"), query: q({ status: "POSTED" }) });
    const off = posted.status === 422 && /post tier is switched off/.test(JSON.stringify(posted.body.issues));
    const b = check("journal file POSTED dry run (post tier)", posted, off ? /post tier is switched off/ : "code");
    check("journal file unbalanced refused", await call("journals-from-file", null, {
      raw: csv("0.01").replace(/-0\.01$/, "-0.02"), query: q({ status: "DRAFT" }),
    }), /debits .* != credits/);
    check("journal file unknown tax rate refused", await call("journals-from-file", null, { raw: csv("0.01", "Made-up rate"), query: q({ status: "DRAFT" }) }), /not an active tax rate/);
    if (client === "stza" && b.confirmation_code) {
      check("real call without a code refused", await call("journals-from-file", null, { raw: csv("0.01"), query: q({ status: "POSTED", dry_run: "false" }) }), /confirmation_code from a dry run/);
      check("real call with an unknown code refused", await call("journals-from-file", null, { raw: csv("0.01"), query: q({ status: "POSTED", dry_run: "false", confirmation_code: "0000000000" }) }), /not recognised/);
      check("code spent on a different payload refused", await call("journals-from-file", null, { raw: csv("0.02"), query: q({ status: "POSTED", dry_run: "false", confirmation_code: b.confirmation_code }) }), /different write/);
    }
  } else skip("journal file", "no active expense and current liability accounts");

  // ── journal status ────────────────────────────────────────────────────────
  const drafts = (await read("manual-journals", { where: 'Status=="DRAFT"' })).ManualJournals || [];
  if (drafts.length) {
    const r = await call("journal-status", { manual_journal_id: drafts[0].ManualJournalID, new_status: "POSTED", audit_note: `${TAG}: check` });
    check("journal status DRAFT -> POSTED dry run", r, r.status === 422 && /switched off/.test(JSON.stringify(r.body.issues)) ? /post tier is switched off/ : "code");
    check("journal status back to DRAFT refused", await call("journal-status", { manual_journal_id: drafts[0].ManualJournalID, new_status: "DRAFT", audit_note: "x" }), /does not allow DRAFT -> DRAFT/);
  } else skip("journal status", "no DRAFT manual journal to dry-run against");

  // ── settle ────────────────────────────────────────────────────────────────
  const bills = ((await read("invoices", { where: 'Type=="ACCPAY" AND Status=="AUTHORISED"' })).Invoices || []).filter((i) => Number(i.AmountDue) > 0);
  const settleProbe = await call("bank-transfers", { audit_note: "x" });
  const settleOff = /settle tier is switched off/.test(JSON.stringify(settleProbe.body.issues || []));
  if (settleOff) {
    check("settle tier switched off: payment refused", await call("payments", { audit_note: "x" }), /settle tier is switched off/);
  } else {
    if (bills.length && banks.length) {
      const bill = bills[0];
      const pay = (amount) => ({ document_type: "Invoices", document_id: bill.InvoiceID, bank_account_code: banks[0].Code, amount, date: today, audit_note: `${TAG}: check` });
      check("payment dry run", await call("payments", pay("0.01")), "code");
      const over = (Number(bill.AmountDue) + 0.01).toFixed(2);
      check("payment over the amount due refused", await call("payments", pay(over)), /more than the|over the settle cap/);
      check("payment over the cap refused", await call("payments", pay("5000.01")), /over the settle cap|more than the/);
    } else skip("payment", "no AUTHORISED bill with an amount due, or no bank account");
    if (banks.length && expense) {
      check("bank transaction dry run", await call("bank-transactions", {
        transaction_type: "SPEND", bank_account_code: banks[0].Code, date: today, audit_note: `${TAG}: check`,
        line_amount_types: "NoTax", lines: [{ description: TAG, account_code: expense.Code, unit_amount: "0.01" }],
      }), "code");
    } else skip("bank transaction", "no bank or expense account");
    if (banks.length > 1) {
      check("bank transfer dry run", await call("bank-transfers", { from_bank_account_code: banks[0].Code, to_bank_account_code: banks[1].Code, amount: "0.01", date: today, audit_note: `${TAG}: check` }), "code");
    } else skip("bank transfer", "fewer than two bank accounts");
    check("bank transfer to the same account refused", await call("bank-transfers", { from_bank_account_code: "090", to_bank_account_code: "090", amount: "1", date: today, audit_note: "x" }), /must differ/);
  }

  // ── check_bill (a read: no tier) ──────────────────────────────────────────
  const anyBill = bills[0] || ((await read("invoices", { where: 'Type=="ACCPAY"' })).Invoices || [])[0];
  if (anyBill) {
    await sleep(1200);
    const r = await fetch(`${root}/checks/bill/${anyBill.InvoiceID}`, { headers: { "X-API-Key": key } });
    const b = await r.json().catch(() => ({}));
    const ok = r.status === 200 && Array.isArray(b.flags) && b.flags.length === 9
      && b.flags.some((f) => f.check === "lines_vs_pdf" && f.not_checked);
    rows.push({ what: "check_bill runs all nine checks", ok, status: r.status, detail: ok ? `flagged: ${b.flagged.join(", ") || "none"}` : JSON.stringify(b).slice(0, 160) });
  } else skip("check_bill", "no supplier bill");

  // ── send, setup, conversion: off on every portal entity today ─────────────
  check("send tier: email refused while off", await call("invoice-emails", { invoice_id: "00000000-0000-4000-8000-000000000000", audit_note: "x" }), /send tier is switched off|No invoice/);
  check("setup tier: setting refused while off", await call("settings", { kind: "currency", record: { Code: "EUR" }, audit_note: "x" }), /setup tier is switched off|already/);
  check("conversion tier: refused while off", await call("conversion-setup", { conversion_month: 1, conversion_year: 2026, conversion_balances: [], audit_note: "x" }), /conversion tier is switched off/);

  console.log(`== ${client} ${entity} (${org.Name || "?"}): ${rows.filter((r) => r.ok).length}/${rows.filter((r) => r.ok !== null).length} passed`);
  for (const r of rows) console.log(`${r.ok === null ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.what.padEnd(46)} ${String(r.status).padEnd(4)} ${r.detail}`);
  process.exit(rows.some((r) => r.ok === false) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

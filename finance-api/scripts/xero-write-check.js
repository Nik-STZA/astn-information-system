#!/usr/bin/env node
// Write-capability check for the note and draft tiers
// (docs/ap-lane/xero-capability-register.md, phase 0).
//
//   FINANCE_API_KEY=... node scripts/xero-write-check.js <client> <entity> [--live] [baseUrl]
//
// Without --live every call is a dry run: validated against the entity's live
// Xero data, nothing written. With --live it creates real records, all in
// DRAFT and all labelled STZA-TEST, and prints their ids for a person to void
// or delete. Agreed with Nik on 16 Oct 2026: live write tests run on STZA's own
// organisation only, never a client's.
//
// It also proves the refusals: approval, an archived account, a duplicate
// supplier number, bank details, a second association of the same file.

const args = process.argv.slice(2);
const live = args.includes("--live");
const [client, entity, base = "https://stza-finance-api-782190795609.europe-west1.run.app"] = args.filter((a) => a !== "--live");
const key = process.env.FINANCE_API_KEY;
const actor = process.env.STZA_ACTOR_EMAIL || "nik@stza.io";
if (!client || !entity || !key) {
  console.error("usage: FINANCE_API_KEY=... node scripts/xero-write-check.js <client> <entity> [--live] [baseUrl]");
  process.exit(2);
}
if (live && client !== "stza") {
  console.error("--live runs on STZA's own organisation only.");
  process.exit(2);
}

const root = `${base}/api/finance/clients/${client}/xero/${entity}`;
const today = new Date().toISOString().slice(0, 10);
const TAG = `STZA-TEST ${today}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = [];
const rows = [];

async function post(op, body, { query, raw, type } = {}) {
  await sleep(1200); // each write makes several Xero calls; stay under 60 a minute
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const r = await fetch(`${root}/write/${op}${qs}`, {
    method: "POST",
    headers: {
      "X-API-Key": key, "X-Actor-Email": actor,
      "Content-Type": raw ? type || "application/octet-stream" : "application/json",
    },
    body: raw || JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function get(path) {
  await sleep(1100);
  const r = await fetch(`${root}/read${path}`, { headers: { "X-API-Key": key } });
  return r.json();
}

// expect: "pass" (validated), "write" (written), or a regex the refusal must match.
function check(what, r, expect) {
  const b = r.body || {};
  let ok;
  if (expect === "pass") ok = r.status === 200 && b.validation === "PASS";
  else if (expect === "write") ok = r.status === 201 && ["WRITTEN", "UPDATED"].includes(b.action);
  else ok = r.status === 422 && expect.test((b.issues || []).join(" | "));
  const note = ok ? "" : `${r.status} ${JSON.stringify(b.issues || b.xero_errors || b.error || b).slice(0, 160)}`;
  rows.push({ what, result: ok ? "pass" : "FAIL", note });
  return b;
}

// Smallest valid PDF, so uploads are real documents.
const pdf = (label) => Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
  `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%${label}\n%%EOF\n`
);

(async () => {
  const accounts = (await get("/accounts")).data.Accounts;
  const expense = accounts.find((a) => a.Status === "ACTIVE" && a.Class === "EXPENSE" && a.Code);
  const archived = accounts.find((a) => a.Status === "ARCHIVED" && a.Code);
  const taxType = expense.TaxType || "NONE";
  const line = { description: `${TAG} line`, account_code: expense.Code, unit_amount: "1.00", tax_type: taxType };

  // ── contact ───────────────────────────────────────────────────────────────
  const contact = {
    name: `${TAG} supplier`, company_number: "00000000",
    address: { line1: "Test only - delete", city: "London", country: "GB" },
    audit_note: `${TAG}: write capability check, to be archived`,
  };
  check("contact: dry run", await post("contacts", contact), "pass");
  check("contact: bank details refused", await post("contacts", { ...contact, bank_account_details: "00-00-00 00000000" }), /bank details/);
  let contactId = null;
  if (live) {
    const c = check("contact: create", await post("contacts", { ...contact, dry_run: false }), "write");
    contactId = c.ContactID;
    if (contactId) created.push(["Contact (archive)", contactId]);
    if (contactId) check("contact: update", await post("contacts", { id: contactId, tax_number: "GB000000000", audit_note: `${TAG}: update check`, dry_run: false }), "write");
  }
  // Dry runs need a real contact to validate against; any active one will do.
  const anyContact = contactId || (await get("/contacts?page=1")).data.Contacts.find((c) => c.ContactStatus === "ACTIVE").ContactID;

  // ── bill ──────────────────────────────────────────────────────────────────
  const bill = {
    type: "ACCPAY", contact_id: anyContact, date: today, lines: [line],
    number: `${TAG.replace(/ /g, "-")}-0001`, reference: TAG, audit_note: `${TAG}: write capability check, to be deleted`,
  };
  check("bill: dry run", await post("invoices", bill), "pass");
  check("bill: AUTHORISED refused", await post("invoices", { ...bill, status: "AUTHORISED" }), /lane ends at SUBMITTED/);
  if (archived) check("bill: archived account refused", await post("invoices", { ...bill, lines: [{ ...line, account_code: archived.Code }] }), /archived/);
  check("bill: float amount refused", await post("invoices", { ...bill, lines: [{ ...line, unit_amount: 1.5 }] }), /float/);

  let billId = null;
  if (live) {
    const b = check("bill: create DRAFT", await post("invoices", { ...bill, dry_run: false }), "write");
    billId = b.InvoiceID;
    if (billId) created.push(["Bill (delete)", billId]);
    check("bill: duplicate supplier number refused", await post("invoices", bill), /already exists for this supplier/);
    if (billId) {
      check("bill: update while DRAFT", await post("invoices", { id: billId, type: "ACCPAY", reference: `${TAG} updated`, audit_note: `${TAG}: update check`, dry_run: false }), "write");
    }
  }

  // ── credit note ───────────────────────────────────────────────────────────
  const cn = { type: "ACCPAYCREDIT", contact_id: anyContact, date: today, lines: [line], reference: TAG, audit_note: `${TAG}: write capability check, to be deleted` };
  check("credit note: dry run", await post("credit-notes", cn), "pass");
  if (live) {
    const c = check("credit note: create DRAFT", await post("credit-notes", { ...cn, dry_run: false }), "write");
    if (c.CreditNoteID) created.push(["Credit note (delete)", c.CreditNoteID]);
  }

  if (!live) return done();

  // ── history note, attachment, Files, association, linked transaction ──────
  if (billId) {
    const note = { resource_type: "Invoices", resource_id: billId, details: `${TAG}: history note check` };
    check("history note: dry run", await post("history-notes", note), "pass");
    check("history note: write", await post("history-notes", { ...note, dry_run: false }), "write");

    const att = { resource_type: "Invoices", resource_id: billId, file_name: `${TAG} attachment.pdf`, audit_note: `${TAG}: attachment check` };
    check("attachment: dry run", await post("attachments", null, { query: att, raw: pdf("attachment"), type: "application/pdf" }), "pass");
    check("attachment: write", await post("attachments", null, { query: { ...att, dry_run: "false" }, raw: pdf("attachment"), type: "application/pdf" }), "write");
  }

  const up = { file_name: `${TAG} inbox file.pdf`, audit_note: `${TAG}: Files upload check` };
  check("Files upload: dry run", await post("files", null, { query: up, raw: pdf("file"), type: "application/pdf" }), "pass");
  const f = check("Files upload: write", await post("files", null, { query: { ...up, dry_run: "false" }, raw: pdf("file"), type: "application/pdf" }), "write");
  if (f.FileID) created.push(["Files document (delete)", f.FileID]);

  if (f.FileID && billId) {
    const assoc = { file_id: f.FileID, object_id: billId, object_group: "Invoice", audit_note: `${TAG}: association check` };
    check("associate file: dry run", await post("file-associations", assoc), "pass");
    check("associate file: write", await post("file-associations", { ...assoc, dry_run: false }), "write");
    check("associate file: second time refused", await post("file-associations", assoc), /already associated/);
  }

  if (billId && contactId) {
    const inv = (await get(`/invoices/${billId}`)).data.Invoices[0];
    const lt = {
      source_transaction_id: billId, source_line_item_id: inv.LineItems[0].LineItemID,
      contact_id: contactId, audit_note: `${TAG}: linked transaction check`,
    };
    check("linked transaction: dry run", await post("linked-transactions", lt), "pass");
    const l = check("linked transaction: write", await post("linked-transactions", { ...lt, dry_run: false }), "write");
    if (l.LinkedTransactionID) created.push(["Linked transaction (goes with the bill)", l.LinkedTransactionID]);
  }

  done();
})().catch((e) => {
  console.error(e);
  done(2);
});

function done(code) {
  const w = Math.max(...rows.map((r) => r.what.length), 10);
  console.log(`Write check: ${client}/${entity}, ${live ? "LIVE (drafts)" : "dry runs only"}, ${new Date().toISOString()}\n`);
  for (const r of rows) console.log(`${r.what.padEnd(w)}  ${r.result.padEnd(4)}  ${r.note}`);
  const failed = rows.filter((r) => r.result !== "pass").length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  if (created.length) {
    console.log("\nCreated in Xero, all labelled STZA-TEST, for a person to void, delete or archive:");
    for (const [what, id] of created) console.log(`  ${what}: ${id}`);
  }
  process.exit(code ?? (failed ? 1 : 0));
}

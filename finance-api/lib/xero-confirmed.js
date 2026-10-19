// Write rules for the confirmed tiers: post, send, settle, setup, conversion.
// Kept pure, like lib/xero-write.js, so every rule is tested without Xero.
//
// Ported from the laptop MCP (xero-server.py: _gate, post_journal,
// post_journal_from_csv, update_journal_status, email_invoice, record_payment,
// delete_payment, allocate_credit, remove_allocation, upsert_bank_transaction,
// create_bank_transfer, upsert_setting, upsert_repeating_invoice,
// create_fixed_asset, post_conversion_setup).
//
// What a confirmed write needs, on top of the note and draft rules:
//   1. its tier switched on for the entity (accounting_system_config.write_policy);
//   2. a confirmation code from a dry run of the identical payload, redeemed
//      within 15 minutes, once. The code proves the write is the one that was
//      validated and shown, not a variation of it;
//   3. settle writes under the entity's max_amount.
//
// Where the portal is deliberately stricter than the laptop:
//   * journals from a file are inside the tiers (the laptop's
//     post_journal_from_csv was not), and an unknown tax rate is refused
//     rather than silently mapped to NONE;
//   * a file journal whose narration and date already exist is refused unless
//     allow_duplicate is passed, so re-uploading a month's payroll import
//     cannot post it twice.

const crypto = require("crypto");
const w = require("./xero-write");

const CONFIRMED_TIERS = ["post", "send", "settle", "setup", "conversion"];
const CONFIRMATION_TTL_MINUTES = 15;

const isConfirmedTier = (tier) => CONFIRMED_TIERS.includes(tier);

function payloadDigest(tool, entityId, payload) {
  return crypto.createHash("sha256")
    .update(`${tool}|${entityId}|${w.stableStringify(payload)}`)
    .digest("hex");
}

const newConfirmationCode = () => crypto.randomBytes(5).toString("hex");

// Why a presented code did not redeem, from what the lookup found.
function confirmationRefusal(row) {
  if (!row) return "The confirmation_code is not recognised: dry-run this exact write to get one";
  if (row.consumed_at) return "The confirmation_code has already been used: dry-run this exact write again";
  if (!row.live) return "The confirmation_code has expired (codes last 15 minutes): dry-run this exact write again";
  return "The confirmation_code was issued for a different write: dry-run this exact write again";
}

// The settle cap. `amount` is a decimal string, or null when the write has no
// single amount (an allocation removal).
function capIssues(entityConfig, tier, amount) {
  if (tier !== "settle" || amount === null || amount === undefined) return [];
  const cap = w.writePolicy(entityConfig).max_amount;
  if (cap === null || cap === "") return [];
  const a = w.parseDecimal(String(amount).replace(/^-/, ""), "amount", 4).scaled;
  const c = w.parseDecimal(cap, "max_amount", 4).scaled;
  return a > c ? [`${amount} is over the settle cap of ${cap} for this entity`] : [];
}

// ── small validators ────────────────────────────────────────────────────────

// A positive money amount, at most `places` decimals, as an exact JSON number.
function money(value, field, issues, places = 2) {
  try {
    const d = w.parseDecimal(value, field, places);
    if (d.scaled <= 0n) {
      issues.push(`${field} must be positive`);
      return null;
    }
    return { json: w.toJsonNumber(d), text: d.text };
  } catch (e) {
    issues.push(e.message);
    return null;
  }
}

function dateIssues(value, field, required = true) {
  if (!value) return required ? [`${field} is required (YYYY-MM-DD)`] : [];
  return w.isIsoDate(value) ? [] : [`${field} must be YYYY-MM-DD`];
}

function guidIssues(value, field) {
  if (!value) return [`${field} is required`];
  return w.isGuid(value) ? [] : [`${field} must be a Xero GUID`];
}

const auditNoteIssues = (b) => (String(b.audit_note || "").trim()
  ? [] : ["audit_note is required: it goes to the audit log and the Xero history"]);

// Positive amounts summed, as a decimal string: the debit side of a journal.
function grossOf(amounts) {
  let pence = 0n;
  for (const a of amounts) {
    const p = w.parseDecimal(a, "amount", 2).scaled;
    if (p > 0n) pence += p;
  }
  return w.penceToString(pence);
}

// ── journals ────────────────────────────────────────────────────────────────

// DRAFT reports nothing until a person posts it; POSTED and VOIDED change what
// the ledger reports, and a void cannot be undone.
const journalTier = (status) => (String(status || "DRAFT").toUpperCase() === "DRAFT" ? "draft" : "post");

const JOURNAL_TRANSITIONS = [["DRAFT", "POSTED"], ["DRAFT", "VOIDED"], ["POSTED", "VOIDED"]];

function journalTransitionIssues(current, target) {
  const t = String(target || "").toUpperCase();
  if (!["DRAFT", "POSTED", "VOIDED"].includes(t)) return [`new_status must be DRAFT, POSTED or VOIDED, not ${target || "(blank)"}`];
  return JOURNAL_TRANSITIONS.some(([a, b]) => a === current && b === t)
    ? [] : [`Xero does not allow ${current} -> ${t} on a manual journal`];
}

// RFC 4180: quoted fields, doubled quotes, CRLF or LF, a leading BOM.
function parseCsv(text) {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Xero's manual journal import columns, with or without the asterisks.
const JOURNAL_COLUMNS = {
  narration: "narration", date: "date", description: "description",
  accountcode: "account_code", taxrate: "tax_rate", amount: "amount",
  trackingname1: "tracking_name_1", trackingoption1: "tracking_option_1",
  trackingname2: "tracking_name_2", trackingoption2: "tracking_option_2",
};
const REQUIRED_JOURNAL_COLUMNS = ["narration", "date", "account_code", "amount"];
const MAX_JOURNAL_FILE_ROWS = 2000;

function fileDate(raw) {
  const s = String(raw || "").trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return w.isIsoDate(iso) ? iso : null;
  }
  m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  return m && w.isIsoDate(s) ? s : null;
}

// "1,234.56", "-1234.56" and the spreadsheet "(1,234.56)" for a credit.
function fileAmount(raw) {
  let s = String(raw || "").trim().replace(/[,\s£]/g, "");
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1]; }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  if (negative) s = s.startsWith("-") ? s.slice(1) : `-${s}`;
  return s;
}

// Rows grouped into journals by narration and date, in file order. Lines keep
// the raw tax rate text: it is resolved against the entity's own tax rates.
function parseJournalFile(text) {
  const issues = [];
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!rows.length) return { journals: [], issues: ["The file is empty"] };
  const header = rows[0].map((h) => JOURNAL_COLUMNS[String(h).trim().replace(/^\*/, "").replace(/\s+/g, "").toLowerCase()] || null);
  const missing = REQUIRED_JOURNAL_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return { journals: [], issues: [`The header row is missing ${missing.join(", ")} (Xero's manual journal import format: *Narration, *Date, Description, *AccountCode, *TaxRate, *Amount)`] };
  }
  if (rows.length - 1 > MAX_JOURNAL_FILE_ROWS) {
    return { journals: [], issues: [`The file has ${rows.length - 1} lines; the limit is ${MAX_JOURNAL_FILE_ROWS}`] };
  }

  const byKey = new Map();
  rows.slice(1).forEach((cells, i) => {
    const at = `Row ${i + 2}`;
    const v = {};
    header.forEach((col, j) => { if (col) v[col] = String(cells[j] ?? "").trim(); });
    const date = fileDate(v.date);
    const amount = fileAmount(v.amount);
    if (!v.narration) issues.push(`${at}: narration is blank`);
    if (!date) issues.push(`${at}: date ${JSON.stringify(v.date || "")} is not DD/MM/YYYY or YYYY-MM-DD`);
    if (amount === null) issues.push(`${at}: amount ${JSON.stringify(v.amount || "")} is not a money value with at most 2 decimal places`);
    if (!v.account_code) issues.push(`${at}: account code is blank`);
    const tracking = [[v.tracking_name_1, v.tracking_option_1], [v.tracking_name_2, v.tracking_option_2]]
      .filter(([n, o]) => n || o);
    if (tracking.some(([n, o]) => !n || !o)) issues.push(`${at}: tracking needs both a name and an option`);

    const key = `${v.narration}|${date}`;
    if (!byKey.has(key)) byKey.set(key, { narration: v.narration, date, rows: [], lines: [] });
    const j = byKey.get(key);
    j.rows.push(i + 2);
    j.lines.push({
      account_code: v.account_code,
      amount,
      description: v.description || "",
      tax_rate: v.tax_rate || "",
      tracking: tracking.filter(([n, o]) => n && o).map(([n, o]) => ({ name: n, option: o })),
    });
  });
  return { journals: [...byKey.values()], issues };
}

// One journal as JSON (the laptop's post_journal), in the same shape as a
// parsed file so both go through the same rules. Amounts are strings or
// integers, positive for a debit; floats are refused, as everywhere else.
function journalEntries(b) {
  const issues = [];
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!String(b.narration || "").trim()) issues.push("narration is required");
  if (!w.isIsoDate(b.date)) issues.push("date must be YYYY-MM-DD");
  if (!lines.length) issues.push("lines are required");
  const out = lines.map((l, i) => {
    const line = l && typeof l === "object" ? l : {};
    if (typeof line.amount === "number" && !Number.isInteger(line.amount)) {
      issues.push(`Line ${i + 1}: amount ${line.amount} must be a string or an integer, not a float`);
    }
    const tracking = line.tracking === undefined ? [] : line.tracking;
    if (!Array.isArray(tracking) || tracking.some((t) => !t || !t.name || !t.option)) {
      issues.push(`Line ${i + 1}: tracking must be a list of { name, option }`);
    }
    return {
      account_code: String(line.account_code ?? "").trim(),
      amount: line.amount === undefined || line.amount === null ? "" : String(line.amount),
      description: String(line.description ?? ""),
      tax_rate: String(line.tax_type ?? ""),
      tracking: Array.isArray(tracking) ? tracking.filter((t) => t && t.name && t.option).map((t) => ({ name: String(t.name), option: String(t.option) })) : [],
    };
  });
  const journal = { narration: String(b.narration || "").trim(), date: b.date, rows: out.map((_, i) => i + 1), lines: out };
  return { journals: issues.length ? [] : [journal], issues };
}

// A file's tax rate text to a Xero TaxType: the rate's name as Xero shows it
// ("20% (VAT on Expenses)", "No VAT") or the TaxType code itself. Blank means
// NONE. Anything else is an issue, never a guess.
function resolveTaxRate(text, taxRates) {
  const t = String(text || "").trim();
  if (!t) return { taxType: "NONE" };
  const active = taxRates.filter((r) => r.Status === "ACTIVE");
  const hit = active.find((r) => r.TaxType === t)
    || active.find((r) => String(r.Name || "").toLowerCase() === t.toLowerCase());
  return hit ? { taxType: hit.TaxType } : { error: `tax rate ${JSON.stringify(t)} is not an active tax rate in this entity` };
}

// ── settle ──────────────────────────────────────────────────────────────────

// A payment against an AUTHORISED bill, sales invoice or credit note.
function paymentRequest(b) {
  const issues = [...auditNoteIssues(b)];
  if (!["Invoices", "CreditNotes"].includes(b.document_type)) issues.push("document_type must be Invoices or CreditNotes");
  issues.push(...guidIssues(b.document_id, "document_id"));
  if (!b.bank_account_code) issues.push("bank_account_code is required");
  const value = money(b.amount, "amount", issues);
  issues.push(...dateIssues(b.date, "date"));
  const docKey = b.document_type === "CreditNotes" ? "CreditNote" : "Invoice";
  const p = {
    [docKey]: { [`${docKey}ID`]: b.document_id },
    Account: { Code: String(b.bank_account_code || "") },
    Date: b.date,
    Amount: value?.json ?? null,
  };
  if (b.reference) p.Reference = String(b.reference);
  if (b.currency_rate !== undefined && b.currency_rate !== "") {
    try {
      p.CurrencyRate = w.toJsonNumber(w.parseDecimal(b.currency_rate, "currency_rate", 10));
    } catch (e) {
      issues.push(e.message);
    }
  }
  return { issues, payload: { Payments: [p] }, amount: value?.text ?? null };
}

// Checks against the document the payment is for.
function paymentDocumentIssues(doc, amountText) {
  const issues = [];
  if (doc.Status !== "AUTHORISED") issues.push(`the document is ${doc.Status}; payments go only against AUTHORISED documents`);
  const due = String(doc.AmountDue ?? doc.RemainingCredit ?? "0");
  if (amountText) {
    const a = w.parseDecimal(amountText, "amount", 4).scaled;
    const d = w.parseDecimal(Number(due).toFixed(2), "due", 4).scaled;
    if (a > d) issues.push(`${amountText} is more than the ${Number(due).toFixed(2)} outstanding`);
  }
  return issues;
}

// The account a payment, bank transaction or transfer goes through.
function bankAccountIssues(accounts, code, label = "bank_account_code") {
  const match = accounts.filter((a) => a.Code === String(code || ""));
  if (!match.length) return [`${label} ${code} is not in this entity's chart of accounts`];
  if (match[0].Type !== "BANK" && !match[0].EnablePaymentsToAccount) return [`${label} ${code} is neither a bank account nor enabled for payments`];
  if (match[0].Status !== "ACTIVE") return [`${label} ${code} is archived`];
  return [];
}

const ALLOCATABLE = { CreditNotes: "CreditNote", Prepayments: "Prepayment", Overpayments: "Overpayment" };

function allocationRequest(b) {
  const issues = [...auditNoteIssues(b)];
  if (!ALLOCATABLE[b.source_type]) issues.push(`source_type must be one of ${Object.keys(ALLOCATABLE).join(", ")}`);
  issues.push(...guidIssues(b.source_id, "source_id"), ...guidIssues(b.invoice_id, "invoice_id"));
  const value = money(b.amount, "amount", issues);
  issues.push(...dateIssues(b.date, "date"));
  const payload = { Allocations: [{ Invoice: { InvoiceID: b.invoice_id }, Amount: value?.json ?? null, Date: b.date }] };
  return { issues, payload, amount: value?.text ?? null };
}

// The credit and the invoice must be the same side, the same contact, and
// both have enough left.
function allocationDocumentIssues(src, inv, amountText) {
  const issues = [];
  const side = String(src.Type || "").startsWith("ACCPAY") || String(src.Type || "").startsWith("SPEND") ? "ACCPAY" : "ACCREC";
  if (inv.Type !== side) issues.push(`a ${src.Type} credit cannot be applied to a ${inv.Type} invoice`);
  if ((src.Contact || {}).ContactID !== (inv.Contact || {}).ContactID) issues.push("the credit and the invoice belong to different contacts");
  if (inv.Status !== "AUTHORISED") issues.push(`the invoice is ${inv.Status}; allocate only against AUTHORISED invoices`);
  if (amountText) {
    const a = w.parseDecimal(amountText, "amount", 4).scaled;
    const remaining = Number(src.RemainingCredit ?? 0).toFixed(2);
    const due = Number(inv.AmountDue ?? 0).toFixed(2);
    const limit = [remaining, due].map((x) => w.parseDecimal(x, "limit", 4).scaled).reduce((m, x) => (x < m ? x : m));
    if (a > limit) issues.push(`${amountText} is more than the credit remaining (${remaining}) or the invoice due (${due})`);
  }
  return issues;
}

// Spend or receive money. Bank transactions have no draft state in Xero: they
// post as AUTHORISED, which is why they are settle and not draft.
function bankTransactionRequest(b) {
  const issues = [...auditNoteIssues(b)];
  const type = String(b.transaction_type || "").toUpperCase();
  if (!["SPEND", "RECEIVE"].includes(type)) issues.push("transaction_type must be SPEND or RECEIVE");
  const lat = b.line_amount_types || "Exclusive";
  if (!["Exclusive", "Inclusive", "NoTax"].includes(lat)) issues.push("line_amount_types must be Exclusive, Inclusive or NoTax");
  if (!b.bank_account_code) issues.push("bank_account_code is required");
  issues.push(...dateIssues(b.date, "date"));
  if (b.contact_id && !w.isGuid(b.contact_id)) issues.push("contact_id must be a Xero GUID");
  if (b.id && !w.isGuid(b.id)) issues.push("id must be a Xero GUID");
  return { issues, type, lineAmountTypes: lat };
}

function buildBankTransaction(b, { type, lineAmountTypes, items }) {
  const doc = {
    Type: type, BankAccount: { Code: String(b.bank_account_code || "") }, Date: b.date,
    LineAmountTypes: lineAmountTypes, LineItems: items || [], Status: "AUTHORISED",
  };
  if (b.contact_id) doc.Contact = { ContactID: b.contact_id };
  if (b.reference) doc.Reference = String(b.reference);
  if (b.id) doc.BankTransactionID = b.id;
  return { BankTransactions: [doc] };
}

function bankTransferRequest(b) {
  const issues = [...auditNoteIssues(b)];
  const value = money(b.amount, "amount", issues);
  issues.push(...dateIssues(b.date, "date"));
  if (!b.from_bank_account_code || !b.to_bank_account_code) issues.push("from_bank_account_code and to_bank_account_code are required");
  else if (String(b.from_bank_account_code) === String(b.to_bank_account_code)) issues.push("the two bank accounts must differ");
  const t = {
    FromBankAccount: { Code: String(b.from_bank_account_code || "") },
    ToBankAccount: { Code: String(b.to_bank_account_code || "") },
    Amount: value?.json ?? null,
    Date: b.date,
  };
  if (b.reference) t.Reference = String(b.reference);
  return { issues, payload: { BankTransfers: [t] }, amount: value?.text ?? null };
}

// ── setup ───────────────────────────────────────────────────────────────────

// kind: method, path, envelope key (or null), required fields.
const SETTING_KINDS = {
  account_create: { method: "PUT", path: "Accounts", envelope: null, required: ["Code", "Name", "Type"] },
  account_update: { method: "POST", path: "Accounts/{id}", envelope: null, required: ["AccountID"] },
  tax_rate: { method: "POST", path: "TaxRates", envelope: "TaxRates", required: ["Name", "TaxComponents", "ReportTaxType"] },
  tracking_category: { method: "PUT", path: "TrackingCategories", envelope: null, required: ["Name"] },
  tracking_option: { method: "PUT", path: "TrackingCategories/{id}/Options", envelope: "Options", required: ["TrackingCategoryID", "Name"] },
  currency: { method: "PUT", path: "Currencies", envelope: null, required: ["Code"] },
  item: { method: "POST", path: "Items", envelope: "Items", required: ["Code"] },
  contact_group: { method: "PUT", path: "ContactGroups", envelope: "ContactGroups", required: ["Name"] },
  contact_group_members: { method: "PUT", path: "ContactGroups/{id}/Contacts", envelope: "Contacts", required: ["ContactGroupID", "ContactIDs"] },
};

// Archiving and deleting master data, bank accounts and tracked inventory are
// left to a person.
function settingRequest(kind, recordIn, b = {}) {
  const k = SETTING_KINDS[kind];
  if (!k) return { issues: [`kind must be one of ${Object.keys(SETTING_KINDS).join(", ")}`] };
  const record = JSON.parse(JSON.stringify(recordIn || {}));
  const issues = [...auditNoteIssues(b), ...k.required.filter((f) => !record[f] || (Array.isArray(record[f]) && !record[f].length)).map((f) => `record needs ${f}`)];
  if (kind === "account_create" && String(record.Type || "").toUpperCase() === "BANK") {
    issues.push("bank accounts are added by a person in Xero (bank details and feeds)");
  }
  if (kind === "account_update") {
    const banned = ["Type", "Code", "Status", "BankAccountNumber", "BankAccountType"].filter((f) => f in record);
    if (banned.length) issues.push(`account_update cannot change ${banned.join(", ")}`);
  }
  if (kind === "item" && record.IsTrackedAsInventory) issues.push("tracked inventory items are refused: they post cost of sales automatically");
  if (kind === "tax_rate") {
    (record.TaxComponents || []).forEach((c, i) => {
      try { c.Rate = w.toJsonNumber(w.parseDecimal(c.Rate ?? "", `TaxComponents ${i + 1} Rate`, 4)); } catch (e) { issues.push(e.message); }
    });
  }
  if (kind === "item") {
    for (const d of ["PurchaseDetails", "SalesDetails"]) {
      const u = record[d]?.UnitPrice;
      if (u !== undefined && u !== "") {
        try { record[d].UnitPrice = w.toJsonNumber(w.parseDecimal(u, `${d} UnitPrice`, 4)); } catch (e) { issues.push(e.message); }
      }
    }
  }
  for (const f of ["AccountID", "TrackingCategoryID", "ContactGroupID"]) {
    if (record[f] && !w.isGuid(record[f])) issues.push(`${f} must be a Xero GUID`);
  }
  const id = record.AccountID || record.TrackingCategoryID || record.ContactGroupID || "";
  let body = Object.fromEntries(Object.entries(record).filter(([f]) => !["TrackingCategoryID", "ContactGroupID", "ContactIDs"].includes(f)));
  if (kind === "contact_group_members") {
    const ids = Array.isArray(record.ContactIDs) ? record.ContactIDs : [];
    if (ids.some((c) => !w.isGuid(c))) issues.push("every ContactIDs entry must be a Xero GUID");
    body = ids.map((c) => ({ ContactID: c }));
  }
  const payload = k.envelope ? { [k.envelope]: Array.isArray(body) ? body : [body] } : body;
  return { issues, method: k.method, path: k.path.replace("{id}", id), payload };
}

// Checks against the chart, for the kinds that reference it.
function settingChartIssues(kind, record, accounts) {
  const issues = [];
  if (kind === "account_create" && accounts.some((a) => a.Code === record.Code)) {
    issues.push(`account code ${record.Code} already exists`);
  }
  if (kind === "item") {
    const active = new Set(accounts.filter((a) => a.Status === "ACTIVE").map((a) => a.Code));
    for (const d of ["PurchaseDetails", "SalesDetails"]) {
      const code = record[d]?.AccountCode;
      if (code && !active.has(code)) issues.push(`${d} AccountCode ${code} is not an active account`);
    }
  }
  return issues;
}

// Sales templates only, saved as DRAFT so each invoice they raise is a draft
// for a person to approve. Xero's API cannot create bill templates.
function repeatingInvoiceRequest(b) {
  const issues = [...auditNoteIssues(b)];
  const type = String(b.type || "").toUpperCase();
  if (type === "ACCPAY") issues.push("Xero's API cannot create repeating bill templates; set this one up in Xero");
  else if (type !== "ACCREC") issues.push("type must be ACCREC");
  if (b.id && !w.isGuid(b.id)) issues.push("id must be a Xero GUID");
  issues.push(...guidIssues(b.contact_id, "contact_id"));
  const lat = b.line_amount_types || "Exclusive";
  if (!["Exclusive", "Inclusive", "NoTax"].includes(lat)) issues.push("line_amount_types must be Exclusive, Inclusive or NoTax");
  const s = { ...(b.schedule || {}) };
  if (!["WEEKLY", "MONTHLY"].includes(s.Unit)) issues.push("schedule Unit must be WEEKLY or MONTHLY");
  if (!Number.isInteger(s.Period) || s.Period < 1) issues.push("schedule Period must be a whole number of units, at least 1");
  issues.push(...dateIssues(s.StartDate, "schedule StartDate"), ...dateIssues(s.EndDate, "schedule EndDate", false));
  return { issues, type, schedule: s, lineAmountTypes: lat };
}

function buildRepeatingInvoice(b, { type, schedule, lineAmountTypes, items }) {
  const doc = {
    Type: type, Contact: { ContactID: b.contact_id }, Schedule: schedule,
    LineItems: items || [], LineAmountTypes: lineAmountTypes, Status: "DRAFT",
  };
  if (b.reference) doc.Reference = String(b.reference);
  if (b.id) doc.RepeatingInvoiceID = b.id;
  return { RepeatingInvoices: [doc] };
}

// Method, rate, life and start date are set here or never: the Assets API has
// no update, disposal or depreciation run.
function fixedAssetRequest(what, recordIn, b = {}) {
  const record = JSON.parse(JSON.stringify(recordIn || {}));
  const issues = [...auditNoteIssues(b)];
  if (what === "asset") {
    for (const f of ["assetName", "purchaseDate"]) if (!record[f]) issues.push(`record needs ${f}`);
    if (record.purchaseDate) issues.push(...dateIssues(record.purchaseDate, "purchaseDate"));
    if (!record.assetStatus) record.assetStatus = "Draft";
    if (!["Draft", "Registered"].includes(record.assetStatus)) issues.push("assetStatus must be Draft or Registered");
    if (record.purchasePrice !== undefined && record.purchasePrice !== "") {
      const v = money(record.purchasePrice, "purchasePrice", issues);
      record.purchasePrice = v?.json ?? null;
    }
    return { issues, path: "Assets", payload: record };
  }
  if (what === "asset_type") {
    for (const f of ["assetTypeName", "fixedAssetAccountId", "depreciationExpenseAccountId", "accumulatedDepreciationAccountId"]) {
      if (!record[f]) issues.push(`record needs ${f}`);
    }
    return { issues, path: "AssetTypes", payload: record };
  }
  return { issues: ["what must be asset or asset_type"] };
}

// ── conversion ──────────────────────────────────────────────────────────────

// Opening balances for a client moving onto Xero. Debit positive; must net to
// exactly 0.00. No undo and no read-back, hence its own tier, off by default.
function conversionRequest(b) {
  const issues = [...auditNoteIssues(b)];
  const month = Number(b.conversion_month);
  const year = Number(b.conversion_year);
  if (!Number.isInteger(month) || month < 1 || month > 12) issues.push("conversion_month must be 1 to 12");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) issues.push("conversion_year must be a year");
  const rows = [];
  let total = 0n;
  (Array.isArray(b.conversion_balances) ? b.conversion_balances : []).forEach((x, i) => {
    if (!x || !x.account_code) issues.push(`balance ${i + 1}: account_code is required`);
    try {
      const d = w.parseDecimal(x?.balance ?? "", `balance ${i + 1}`, 2);
      total += d.scaled;
      rows.push({ AccountCode: String(x.account_code), Balance: w.toJsonNumber(d) });
    } catch (e) {
      issues.push(e.message);
    }
  });
  if (!rows.length && !issues.some((s) => s.startsWith("balance"))) issues.push("at least one conversion balance is required");
  if (total !== 0n) issues.push(`conversion balances net to ${w.penceToString(total)}, not 0.00`);
  return {
    issues,
    payload: { ConversionDate: { Month: month, Year: year }, ConversionBalances: rows },
    net: w.penceToString(total),
  };
}

module.exports = {
  CONFIRMED_TIERS,
  CONFIRMATION_TTL_MINUTES,
  isConfirmedTier,
  payloadDigest,
  newConfirmationCode,
  confirmationRefusal,
  capIssues,
  money,
  dateIssues,
  guidIssues,
  auditNoteIssues,
  grossOf,
  journalTier,
  journalTransitionIssues,
  parseCsv,
  parseJournalFile,
  journalEntries,
  resolveTaxRate,
  paymentRequest,
  paymentDocumentIssues,
  bankAccountIssues,
  ALLOCATABLE,
  allocationRequest,
  allocationDocumentIssues,
  bankTransactionRequest,
  buildBankTransaction,
  bankTransferRequest,
  SETTING_KINDS,
  settingRequest,
  settingChartIssues,
  repeatingInvoiceRequest,
  buildRepeatingInvoice,
  fixedAssetRequest,
  conversionRequest,
};

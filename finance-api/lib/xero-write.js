// Write rules for the note and draft tiers: the parts of a Xero write that can
// silently do the wrong thing, kept pure so they are tested without Xero.
//
// Ported from the laptop MCP (xero-server.py: _validate_lines, _lane_issues,
// _document_upsert, upsert_contact, add_history_note, the upload and
// association tools) so the portal and the laptop apply the same rules. See
// docs/ap-lane/xero-capability-register.md.
//
// Tiers, lowest risk first (same names as the laptop's mcp_write_policy.json):
//   note        permanent history notes on Xero records
//   draft       bills, sales invoices, credit notes in DRAFT or SUBMITTED;
//               contacts; attachments; linked transactions; Files uploads
//   post        POSTED or VOIDED manual journals
//   send        emailing a sales invoice
//   settle      payments, allocations, bank transactions and transfers
//   setup       accounts, tax rates, tracking, currencies, items, contact
//               groups, repeating invoice templates, fixed assets
//   conversion  conversion balances (POST /Setup): no undo, no read-back
// The last five need a confirmation code: see lib/xero-confirmed.js.
//
// The agent's lane ends at SUBMITTED. A person approves in Xero.

const crypto = require("crypto");

const TIERS = ["note", "draft", "post", "send", "settle", "setup", "conversion"];
// max_amount caps a single settle write, in the document's currency; null
// means no cap. It does not cap post: a payroll or depreciation journal is
// legitimately large, and the confirmation code shows the whole journal first.
const DEFAULT_POLICY = {
  note: true, draft: true, post: false, send: false, settle: false, setup: false, conversion: false,
  max_amount: "5000.00",
};

// An entity's policy: the defaults, overridden by accounting_system_config.write_policy.
function writePolicy(entityConfig) {
  const own = (entityConfig && entityConfig.write_policy) || {};
  const out = { ...DEFAULT_POLICY };
  for (const t of TIERS) if (typeof own[t] === "boolean") out[t] = own[t];
  if (own.max_amount === null) out.max_amount = null;
  else if (own.max_amount !== undefined) out.max_amount = String(own.max_amount);
  return out;
}

function tierIssues(entityConfig, tier) {
  if (!TIERS.includes(tier)) return [`unknown tier ${tier}`];
  return writePolicy(entityConfig)[tier] ? [] : [`The ${tier} tier is switched off for this entity`];
}

const AGENT_STATUSES = ["DRAFT", "SUBMITTED"];
const BEYOND_LANE = ["AUTHORISED", "PAID", "VOIDED", "DELETED"];

function laneIssues(status, currentStatus = "") {
  const issues = [];
  if (BEYOND_LANE.includes(status)) {
    issues.push(`Status ${status} is refused: the agent's lane ends at SUBMITTED. A person approves in Xero.`);
  } else if (!AGENT_STATUSES.includes(status)) {
    issues.push(`Status must be DRAFT or SUBMITTED, not ${status || "(blank)"}`);
  }
  if (currentStatus && !AGENT_STATUSES.includes(currentStatus)) {
    issues.push(`The existing document is ${currentStatus}; the agent may only change documents that are DRAFT or SUBMITTED`);
  }
  return issues;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGuid = (s) => GUID.test(String(s || ""));

function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Exact decimals. Amounts arrive as strings or integers, never floats, with at
// most `places` decimal places. Returned as a scaled BigInt so totals never
// touch floating point.
function parseDecimal(value, field, places = 4) {
  if (typeof value === "number" && !Number.isInteger(value)) {
    throw new Error(`${field}: ${value} must be a string or an integer, not a float`);
  }
  const s = String(value ?? "").trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`${field}: ${JSON.stringify(value)} is not a number`);
  const frac = m[3] || "";
  if (frac.length > places) throw new Error(`${field}: ${s} has more than ${places} decimal places`);
  const scaled = BigInt(`${m[1]}${m[2]}${frac.padEnd(places, "0")}`);
  return { text: s, scaled, places };
}

// A validated decimal as a JSON number. JavaScript prints the shortest text
// that round-trips, so a value of at most 4 decimal places is sent as exactly
// those digits; anything that would not round-trip is refused.
function toJsonNumber(d) {
  const n = Number(d.text);
  if (parseDecimal(String(n), "check", d.places).scaled !== d.scaled) {
    throw new Error(`${d.text} cannot be sent exactly`);
  }
  return n;
}

// quantity (4dp) x unit (4dp) rounded half-up to pence, as BigInt pence.
function linePence(qty, unit) {
  const product = qty.scaled * unit.scaled; // 8 decimal places
  const sign = product < 0n ? -1n : 1n;
  const abs = product * sign;
  const pence = (abs + 500000n) / 1000000n;
  return pence * sign;
}

const penceToString = (p) => {
  const sign = p < 0n ? "-" : "";
  const a = p < 0n ? -p : p;
  return `${sign}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};

// Check lines against the entity's chart and tax rates.
// Returns { items, issues, net } with net as a "0.00" string.
function validateLines(lines, accounts = [], taxRates = []) {
  const issues = [];
  const items = [];
  let net = 0n;
  const allCodes = new Set(accounts.map((a) => a.Code).filter(Boolean));
  const activeCodes = new Set(accounts.filter((a) => a.Code && a.Status === "ACTIVE").map((a) => a.Code));
  const activeTax = new Set(taxRates.filter((t) => t.Status === "ACTIVE").map((t) => t.TaxType));
  if (!Array.isArray(lines) || !lines.length) return { items, issues: ["At least one line is required"], net: "0.00" };

  lines.forEach((line, i) => {
    const at = `Line ${i + 1}`;
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      issues.push(`${at}: must be an object`);
      return;
    }
    const description = String(line.description ?? "").trim();
    const code = String(line.account_code ?? "").trim();
    const taxType = String(line.tax_type ?? "").trim();
    if (!description) issues.push(`${at}: description is required`);
    if (!code) issues.push(`${at}: account_code is required`);
    else if (!allCodes.has(code)) issues.push(`${at}: account code ${code} is not in this entity's chart of accounts`);
    else if (!activeCodes.has(code)) issues.push(`${at}: account code ${code} is archived`);
    if (taxType && !activeTax.has(taxType)) issues.push(`${at}: tax type ${taxType} is not an active tax rate in this entity`);

    let qty, unit;
    try {
      qty = parseDecimal(line.quantity ?? 1, `${at} quantity`);
      unit = parseDecimal(line.unit_amount ?? "", `${at} unit_amount`);
    } catch (e) {
      issues.push(e.message);
      return;
    }
    if (qty.scaled <= 0n) issues.push(`${at}: quantity must be positive`);
    net += linePence(qty, unit);

    const item = {
      Description: description,
      Quantity: toJsonNumber(qty),
      UnitAmount: toJsonNumber(unit),
      AccountCode: code,
    };
    if (taxType) item.TaxType = taxType;
    const tracking = Array.isArray(line.tracking) ? line.tracking : [];
    if (tracking.length) {
      const bad = tracking.some((t) => !t || !t.name || !t.option);
      if (bad) issues.push(`${at}: each tracking entry needs name and option`);
      else item.Tracking = tracking.map((t) => ({ Name: String(t.name), Option: String(t.option) }));
    }
    items.push(item);
  });
  return { items, issues, net: penceToString(net) };
}

const DOCUMENTS = {
  invoice: {
    endpoint: "Invoices", idField: "InvoiceID", numberField: "InvoiceNumber",
    types: ["ACCPAY", "ACCREC"], payableType: "ACCPAY", hasDueDate: true,
  },
  credit_note: {
    endpoint: "CreditNotes", idField: "CreditNoteID", numberField: "CreditNoteNumber",
    types: ["ACCPAYCREDIT", "ACCRECCREDIT"], payableType: "ACCPAYCREDIT", hasDueDate: false,
  },
};

// Checks that need no Xero data, for a bill/invoice/credit note upsert.
// `b` is the request body (snake_case, same names as the laptop tool).
function documentRequestIssues(kind, b) {
  const d = DOCUMENTS[kind];
  const issues = [];
  const type = String(b.type || "").toUpperCase().trim();
  const status = String(b.status || "DRAFT").toUpperCase().trim();
  const lat = b.line_amount_types || "Exclusive";
  if (!d.types.includes(type)) issues.push(`type must be one of ${d.types.join(", ")}`);
  if (!["Exclusive", "Inclusive", "NoTax"].includes(lat)) issues.push("line_amount_types must be Exclusive, Inclusive or NoTax");
  if (b.id !== undefined && b.id !== "" && !isGuid(b.id)) issues.push("id must be a Xero GUID");
  if (b.contact_id && !isGuid(b.contact_id)) issues.push("contact_id must be a Xero GUID");
  if (!b.id) {
    if (!b.contact_id) issues.push("contact_id is required for a new document");
    if (!b.date) issues.push("date is required for a new document, so it lands in the right period");
    if (!Array.isArray(b.lines) || !b.lines.length) issues.push("lines are required for a new document");
  }
  for (const [label, v] of [["date", b.date], ["due_date", b.due_date]]) {
    if (v && !isIsoDate(v)) issues.push(`${label} must be YYYY-MM-DD`);
  }
  if (!String(b.audit_note || "").trim()) issues.push("audit_note is required: it is written to the Xero history of the document");
  issues.push(...laneIssues(status));
  return { issues, type, status, lineAmountTypes: lat };
}

function buildDocumentPayload(kind, b, { type, status, lineAmountTypes, items }) {
  const d = DOCUMENTS[kind];
  const doc = { Type: type, Status: status, LineAmountTypes: lineAmountTypes };
  if (items && items.length) doc.LineItems = items;
  if (b.id) doc[d.idField] = b.id;
  if (b.contact_id) doc.Contact = { ContactID: b.contact_id };
  if (b.date) doc.Date = b.date;
  if (b.due_date && d.hasDueDate) doc.DueDate = b.due_date;
  if (b.number) doc[d.numberField] = String(b.number);
  if (b.reference) doc.Reference = String(b.reference);
  if (b.currency_code) doc.CurrencyCode = String(b.currency_code).toUpperCase();
  return { [d.endpoint]: [doc] };
}

// The Xero `where` clause that finds the same supplier document number. A
// supplier's number entered twice is the commonest AP error.
function duplicateWhere(kind, type, number, contactId) {
  const d = DOCUMENTS[kind];
  const safe = String(number).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `Type=="${type}" AND ${d.numberField}=="${safe}" AND Contact.ContactID==guid("${contactId}")`;
}

// Bank details are refused whatever Xero allows: a changed supplier bank
// account is the classic payment-fraud route, and it is set by a person.
const CONTACT_FIELDS = {
  name: "Name", email: "EmailAddress", first_name: "FirstName", last_name: "LastName",
  contact_number: "ContactNumber", account_number: "AccountNumber", tax_number: "TaxNumber",
  company_number: "CompanyNumber", default_currency: "DefaultCurrency",
  purchases_default_account_code: "PurchasesDefaultAccountCode",
  sales_default_account_code: "SalesDefaultAccountCode",
  accounts_payable_tax_type: "AccountsPayableTaxType",
  accounts_receivable_tax_type: "AccountsReceivableTaxType",
};
const REFUSED_CONTACT_FIELDS = ["bank_account_details", "BankAccountDetails", "batch_payments", "BatchPayments",
  "contact_status", "ContactStatus"];

function contactRequestIssues(b) {
  const issues = [];
  if (!b.id && !String(b.name || "").trim()) issues.push("name is required for a new contact");
  if (b.id && !isGuid(b.id)) issues.push("id must be a Xero GUID");
  if (!String(b.audit_note || "").trim()) issues.push("audit_note is required: it is written to the contact's Xero history");
  for (const f of REFUSED_CONTACT_FIELDS) {
    if (b[f] !== undefined) {
      issues.push(`${f} is refused: bank details and archiving are set by a person in Xero`);
    }
  }
  return issues;
}

// Only fields passed are sent, so an update never blanks a field.
function buildContactPayload(b) {
  const c = {};
  if (b.id) c.ContactID = b.id;
  for (const [k, x] of Object.entries(CONTACT_FIELDS)) {
    const v = typeof b[k] === "string" ? b[k].trim() : b[k];
    if (v) c[x] = k === "default_currency" ? String(v).toUpperCase() : v;
  }
  if (b.address && typeof b.address === "object") {
    const a = b.address;
    c.Addresses = [{
      AddressType: "POBOX",
      AddressLine1: a.line1 || "", AddressLine2: a.line2 || "",
      City: a.city || "", Region: a.region || "",
      PostalCode: a.postal_code || "", Country: a.country || "",
    }];
  }
  if (b.phone) c.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: String(b.phone) }];
  return { Contacts: [c] };
}

// Records that take PUT /{resource}/{id}/History.
const HISTORY_RESOURCES = [
  "BankTransactions", "BankTransfers", "BatchPayments", "Contacts", "CreditNotes",
  "ExpenseClaims", "Invoices", "Items", "ManualJournals", "Overpayments", "Payments",
  "Prepayments", "PurchaseOrders", "Quotes", "Receipts", "RepeatingInvoices",
];
const HISTORY_PREFIX = "STZA agent (os.stza.io): ";
const HISTORY_MAX_CHARS = 2500;

function historyText(details) {
  const d = String(details || "").trim();
  return d.startsWith(HISTORY_PREFIX) ? d : HISTORY_PREFIX + d;
}

// Records that take attachments (PUT /{resource}/{id}/Attachments/{name}).
const ATTACHABLE = [
  "Accounts", "BankTransactions", "BankTransfers", "Contacts", "CreditNotes", "Invoices",
  "ManualJournals", "PurchaseOrders", "Quotes", "Receipts", "RepeatingInvoices",
];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function fileNameIssues(name) {
  const n = String(name || "");
  if (!n.trim()) return ["file_name is required"];
  if (/[\\/]/.test(n) || n === "." || n === ".." || n.length > 255) return ["file_name is not valid"];
  return [];
}

// Xero Files ObjectGroup -> the accounting resource whose Attachments show it.
const ASSOCIABLE = ["Account", "BankTransaction", "Contact", "CreditNote", "Invoice", "Item",
  "ManualJournal", "Overpayment", "Payment", "Prepayment", "Quote", "Receipt"];
const ASSOC_ATTACHMENTS = {
  Invoice: "Invoices", BankTransaction: "BankTransactions", Contact: "Contacts",
  CreditNote: "CreditNotes", ManualJournal: "ManualJournals", Quote: "Quotes", Receipt: "Receipts",
};

// Same payload, same key, so repeating an identical call cannot create a
// second document. A caller-supplied key wins.
function idempotencyKey(entitySlug, operation, payload, given) {
  if (given) {
    const k = String(given).trim();
    if (k.length < 1 || k.length > 128) throw new Error("idempotency_key must be 1 to 128 characters");
    return k;
  }
  const canonical = stableStringify(payload);
  const digest = crypto.createHash("sha256").update(`${entitySlug}|${operation}|${canonical}`).digest("hex");
  return `stza-${digest.slice(0, 48)}`;
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// Validation messages out of a Xero error body, however it is shaped.
function xeroErrors(body) {
  if (!body || typeof body !== "object") return [];
  const out = [];
  for (const el of body.Elements || []) {
    for (const ve of el.ValidationErrors || []) if (ve.Message) out.push(ve.Message);
  }
  if (!out.length && body.Message) out.push(body.Message);
  if (!out.length && body.Detail) out.push(body.Detail);
  return out;
}

module.exports = {
  TIERS,
  DEFAULT_POLICY,
  writePolicy,
  tierIssues,
  laneIssues,
  isGuid,
  isIsoDate,
  parseDecimal,
  toJsonNumber,
  penceToString,
  validateLines,
  DOCUMENTS,
  documentRequestIssues,
  buildDocumentPayload,
  duplicateWhere,
  contactRequestIssues,
  buildContactPayload,
  HISTORY_RESOURCES,
  HISTORY_PREFIX,
  HISTORY_MAX_CHARS,
  historyText,
  ATTACHABLE,
  MAX_UPLOAD_BYTES,
  fileNameIssues,
  ASSOCIABLE,
  ASSOC_ATTACHMENTS,
  idempotencyKey,
  stableStringify,
  xeroErrors,
};

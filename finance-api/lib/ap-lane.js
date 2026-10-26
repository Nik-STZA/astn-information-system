// Phase 3 of the AP lane (docs/ap-lane/phase3-design.md): a document from the
// Documents inbox becomes a proposed bill, checked and queued for the CFO.
//
// The model has already read the document (bill-review's extraction). Everything
// here is code (spec D4): which files are documents at all, which supplier a
// document is from, the bill built from the master's defaults, and whether it
// goes to the clean queue or to the CFO as an exception (spec 3.3). Nothing here
// fetches or writes; the routes do that.

const { normNumber } = require("./bill-checks");
const { documentValue, isPayment, normVat, words } = require("./bill-review");

const pence = (v) => Math.round(Number(v || 0) * 100);
const money = (p) => Number((p / 100).toFixed(2));

// What the extraction can read (Gemini on Vertex), and a floor under images:
// every email forwarded to the inbox brings its signature logos with it (UDL,
// 26 Oct 2026: six PNGs of 0.5-0.9 KB beside one invoice).
const READABLE = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const MIN_IMAGE_BYTES = 20_000;
const MAX_BYTES = 15_000_000;

// Why a file in the inbox is not read, or null when it should be.
function screenFile(file) {
  const mime = String(file.MimeType || "").toLowerCase();
  if (!READABLE.includes(mime)) return `not a PDF or image (${mime || "unknown type"})`;
  const size = Number(file.Size || 0);
  if (mime.startsWith("image/") && size < MIN_IMAGE_BYTES) {
    return `image under ${MIN_IMAGE_BYTES / 1000} KB: an email signature or logo, not a document`;
  }
  if (size > MAX_BYTES) return `over ${MAX_BYTES / 1e6} MB`;
  return null;
}

// The supplier a document is from, among this entity's links in the master:
// by VAT number, else by name. Names must match exactly once normalised
// ("Ltd", punctuation, case); a near miss is a new supplier for the CFO, not a
// guess. links: [{ ...supplier_entities row, supplier: suppliers row }].
function matchSupplier(doc, links = []) {
  const vat = normVat(doc.supplier_vat_number);
  if (vat) {
    const hit = links.find((l) => l.supplier?.vat_number && normVat(l.supplier.vat_number) === vat);
    if (hit) return { link: hit, matched_by: "VAT number" };
  }
  const name = words(doc.supplier_name);
  if (name) {
    const hit = links.find((l) => [l.supplier?.legal_name, l.supplier?.trading_name, l.xero_contact_name]
      .some((n) => n && words(n) === name));
    if (hit) return { link: hit, matched_by: "name" };
  }
  return null;
}

// Tax types under which no VAT is reclaimed on the bill itself.
const NO_RECLAIM = new Set(["NONE", "EXEMPTINPUT", "ZERORATEDINPUT", "REVERSECHARGES"]);

const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// The bill the engine proposes, in Xero's shape so the phase 2 review reads it
// as it reads a keyed bill. Amounts come from the document's lines, never from
// a model total; account and VAT treatment from the master's defaults (null
// when there is none: line_incomplete then sends it to the CFO).
//   entity  { pays_tax } of the buying entity
function buildBill({ doc, match = null, entity = {} }) {
  const link = match?.link || null;
  const account = link?.default_account_code || null;
  const date = doc.document_date || null;
  const terms = link?.payment_terms_days;
  // A receipt or payment confirmation was paid when issued: due that day.
  const paidWhenIssued = ["receipt", "payment_confirmation"].includes(doc.document_type);
  const due = doc.due_date || (date && paidWhenIssued ? date : null) || (date && Number.isInteger(terms) ? addDays(date, terms) : null);
  const total = documentValue(doc);
  const charges = (doc.lines || []).filter((l) => l.net !== null && !isPayment(l));

  let lineAmountTypes;
  let lines;
  let totalTax = 0;
  if (entity.pays_tax === false) {
    // Not VAT registered (the STZA rule): one gross line, no VAT.
    lineAmountTypes = "NoTax";
    lines = [{ Description: describe(doc, charges), Quantity: 1, UnitAmount: money(total), LineAmount: money(total), AccountCode: account, TaxType: "NONE" }];
  } else {
    const taxType = link?.default_tax_type || null;
    const lineVat = charges.some((l) => l.vat !== null);
    const sum = charges.reduce((t, l) => t + pence(l.net), 0);
    const inclusive = !lineVat && doc.gross_total !== null && charges.length && Math.abs(sum - pence(doc.gross_total)) <= 2;
    lineAmountTypes = inclusive ? "Inclusive" : "Exclusive";
    lines = charges.length
      ? charges.map((l) => ({ Description: l.description, Quantity: 1, UnitAmount: money(pence(l.net)), LineAmount: money(pence(l.net)), AccountCode: account, TaxType: taxType }))
      : [{ Description: describe(doc, charges), Quantity: 1, UnitAmount: money(pence(doc.net_total ?? doc.gross_total)),
        LineAmount: money(pence(doc.net_total ?? doc.gross_total)), AccountCode: account, TaxType: taxType }];
    if (taxType && !NO_RECLAIM.has(taxType)) totalTax = pence(doc.vat_total);
  }

  return {
    Type: doc.document_type === "credit_note" ? "ACCPAYCREDIT" : "ACCPAY",
    InvoiceID: null,
    Status: "DRAFT",
    Contact: link ? { ContactID: link.xero_contact_id, Name: link.xero_contact_name } : { Name: doc.supplier_name || null },
    InvoiceNumber: doc.document_number || "",
    Reference: doc.document_number || "",
    DateString: date ? `${date}T00:00:00` : null,
    DueDateString: due ? `${due}T00:00:00` : null,
    CurrencyCode: doc.currency || null,
    LineAmountTypes: lineAmountTypes,
    LineItems: lines,
    Total: total === null ? null : money(total),
    TotalTax: money(totalTax),
  };
}

function describe(doc, charges) {
  const first = charges[0]?.description;
  return [doc.supplier_name, doc.document_number, first && charges.length === 1 ? first : null].filter(Boolean).join(" - ") || "Supplier document";
}

// Bills it may already be: in Xero, or earlier in the queue. Same supplier and
// the same normalised number, or the same supplier, date and total.
//   others  [{ source, id, contact_id, number, date, total }]
function duplicatesOf(bill, others = []) {
  const contact = bill.Contact?.ContactID;
  if (!contact) return [];
  const n = normNumber(bill.InvoiceNumber);
  const date = (bill.DateString || "").slice(0, 10);
  return others.filter((o) => o.contact_id === contact && (
    (n && normNumber(o.number) === n)
    || (date && o.date === date && pence(o.total) === pence(bill.Total))));
}

// The Xero bill this document already is, if certain: the same normalised
// number, and the same supplier or the same total (a bare "INV-001" from two
// suppliers is not the same bill). Not a decision for the CFO: the inbox still
// holds documents for bills keyed another way (UDL, 26 Oct 2026: three
// Cambridge Design invoices, all PAID). A weaker match stays an exception.
//   xeroBills  [{ id, contact_id, number, date, total, status }]
function alreadyBilled(bill, xeroBills = []) {
  const n = normNumber(bill.InvoiceNumber);
  if (!n) return null;
  return xeroBills.find((b) => normNumber(b.number) === n
    && ((bill.Contact?.ContactID && b.contact_id === bill.Contact.ContactID) || pence(b.total) === pence(bill.Total))) || null;
}

// Why a document the model read is not a purchase document at all, or null.
// Signatures and banners over the image floor still reach the model (UDL, 26
// Oct 2026: a logistics firm's signature, a promotional banner, a certification
// logo); with no amounts on them they are not the CFO's to look at. Anything
// with an amount, even a report, still goes to the CFO.
function notADocument(doc) {
  if (["invoice", "credit_note", "receipt", "payment_confirmation"].includes(doc.document_type)) return null;
  const amounts = doc.gross_total !== null || doc.net_total !== null || (doc.lines || []).some((l) => l.net !== null);
  return amounts ? null : "no amounts on it: a logo, banner or email signature, not a purchase document";
}

// Clean, or an exception for the CFO (spec 3.3), with every reason. The phase
// 2 review supplies most of them; the rest are what a bill built from scratch
// can lack.
function triage({ review, doc, match, bill, duplicates = [] }) {
  const reasons = (review?.flags || []).filter((f) => f.flagged).map(({ check, detail }) => ({ check, detail }));
  if (!bill.DueDateString) reasons.push({ check: "no_due_date", detail: "no due date on the document and no payment terms in the supplier master" });
  if (!bill.CurrencyCode) reasons.push({ check: "no_currency", detail: "the document's currency could not be read" });
  const status = match?.link?.supplier?.status;
  if (status && status !== "active") reasons.push({ check: "supplier_status", detail: `the supplier is ${status} in the master` });
  for (const d of duplicates) {
    reasons.push({ check: "duplicate", detail: `may already be ${d.source === "xero" ? "in Xero" : "in the queue"}: ${d.number || "no number"}, ${d.date || "no date"}, ${d.total}` });
  }
  if (doc?.doubts) reasons.push({ check: "reader_doubts", detail: `the reader was unsure: ${doc.doubts}` });
  return { state: reasons.length ? "exception" : "clean", reasons };
}

// ── Step 3: the CFO's decision, and the send to Xero ────────────────────────

// The proposed bill with the CFO's edits applied: a supplier chosen for a
// document the engine did not recognise, and an account or VAT treatment per
// line. Lines are addressed by position; amounts and descriptions are the
// document's and are not edited here.
//   edits  { contact?: { ContactID, Name }, lines?: [{ index, account_code?, tax_type? }] }
function applyEdits(bill, edits = {}) {
  const issues = [];
  const out = { ...bill, Contact: { ...bill.Contact }, LineItems: bill.LineItems.map((l) => ({ ...l })) };
  if (edits.contact) {
    if (!edits.contact.ContactID) issues.push("the chosen supplier has no Xero contact");
    else out.Contact = { ContactID: edits.contact.ContactID, Name: edits.contact.Name || null };
  }
  for (const e of edits.lines || []) {
    const line = Number.isInteger(e.index) ? out.LineItems[e.index] : null;
    if (!line) { issues.push(`there is no line ${e.index}`); continue; }
    if (e.account_code !== undefined) line.AccountCode = String(e.account_code || "").trim() || null;
    if (e.tax_type !== undefined) line.TaxType = String(e.tax_type || "").trim() || null;
  }
  return { bill: out, issues };
}

// What the CFO's decision on a queue item does to it, or why it cannot.
//   item    the finance.ap_items row
//   action  "approve" | "reject"
function decide(item, { action, note = "", edits = null } = {}) {
  const issues = [];
  if (!["approve", "reject"].includes(action)) issues.push("action must be approve or reject");
  if (action === "approve" && item.state !== "exception") issues.push(`only an exception is approved here; this item is ${item.state}`);
  if (action === "reject" && !["exception", "clean"].includes(item.state)) issues.push(`a ${item.state} item cannot be rejected`);
  if (action === "reject" && !String(note).trim()) issues.push("a reason is required to reject");
  if (issues.length) return { issues };
  if (action === "reject") return { issues, state: "rejected", note: String(note).trim(), bill: item.proposed_bill, edits: null };
  const { bill, issues: editIssues } = applyEdits(item.proposed_bill, edits || {});
  return { issues: editIssues, state: "approved", note: String(note || "").trim() || null, bill, edits: edits || null };
}

const money2 = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// The request the existing bill write takes (server.js documentPlan), at
// SUBMITTED: the lane ends there and the CFO approves in Xero (D3, and one
// approval per bill, Nik 26 Oct 2026). Anything still missing is an issue, not
// a guess.
function sendRequest(item) {
  const bill = item.proposed_bill || {};
  const issues = [];
  if (!["clean", "approved"].includes(item.state)) issues.push(`only a clean or approved item is sent; this item is ${item.state}`);
  if (bill.Type !== "ACCPAY") issues.push("only bills are sent for now; a supplier credit note goes in by hand");
  if (!bill.Contact?.ContactID) issues.push("no Xero supplier: choose one first");
  if (!bill.DateString) issues.push("no date on the bill");
  (bill.LineItems || []).forEach((l, i) => {
    if (!l.AccountCode) issues.push(`line ${i + 1} has no account`);
    if (!l.TaxType) issues.push(`line ${i + 1} has no VAT treatment`);
  });
  const body = {
    type: "ACCPAY",
    status: "SUBMITTED",
    contact_id: bill.Contact?.ContactID,
    date: (bill.DateString || "").slice(0, 10),
    due_date: bill.DueDateString ? bill.DueDateString.slice(0, 10) : undefined,
    number: bill.InvoiceNumber || undefined,
    reference: bill.Reference || bill.InvoiceNumber || undefined,
    currency_code: bill.CurrencyCode || undefined,
    line_amount_types: bill.LineAmountTypes,
    lines: (bill.LineItems || []).map((l) => ({
      description: l.Description, quantity: "1", unit_amount: money2(l.LineAmount), account_code: l.AccountCode, tax_type: l.TaxType,
    })),
    audit_note: `From the Documents inbox (${item.file_name}), built by the AP lane and sent from the portal.`,
  };
  return { body, issues };
}

module.exports = {
  screenFile, notADocument, matchSupplier, buildBill, duplicatesOf, alreadyBilled, triage, MIN_IMAGE_BYTES,
  applyEdits, decide, sendRequest,
};

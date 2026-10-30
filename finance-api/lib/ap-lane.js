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

// How many days apart the same supplier's same amount is still worth a look. A
// month is useless: every subscription repeats (135 false pairs at 31 days, 16
// Sep 2026 study).
const NEAR_DAYS = 3;
const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

// What a bill says it is, as the engine read it and, for a Xero draft, as Xero
// keyed it. Both count: on 30 Oct 2026 a resubmitted receipt escaped
// because the engine read its receipt number and a different total, while the
// draft Xero keyed matched the paid bill exactly.
function identities(bill, draft) {
  const one = (b) => ({
    contact: b.Contact?.ContactID || null, number: normNumber(b.InvoiceNumber),
    date: String(b.DateString || "").slice(0, 10) || null,
    total: b.Total === null || b.Total === undefined ? null : pence(b.Total),
  });
  return draft ? [one(bill), one(draft)] : [one(bill)];
}

// Bills it may already be: in Xero, or earlier in the queue. Each comes back
// with how it matched, strongest first:
//   number      the same normalised number, with the same supplier or the same
//               total (a new supplier has no contact to compare, and a bare
//               "INV-001" from two suppliers is not the same bill)
//   date_total  the same supplier, date and total
//   near        the same supplier and total within NEAR_DAYS: only a question
//   others  [{ source, id, contact_id, number, date, total }]
function duplicatesOf(bill, others = [], draft = null) {
  const ids = identities(bill, draft);
  const rank = { number: 3, date_total: 2, near: 1 };
  const found = new Map();
  others.forEach((o, i) => {
    const total = o.total === null || o.total === undefined ? null : pence(o.total);
    let match = null;
    const better = (m) => { if (!match || rank[m] > rank[match]) match = m; };
    for (const k of ids) {
      const supplier = k.contact && o.contact_id === k.contact;
      const sameTotal = k.total !== null && total === k.total;
      if (k.number && normNumber(o.number) === k.number && (supplier || sameTotal)) better("number");
      if (supplier && sameTotal && k.date && o.date === k.date) better("date_total");
      if (supplier && sameTotal && k.date && o.date && daysApart(o.date, k.date) <= NEAR_DAYS) better("near");
    }
    if (!match) return;
    const key = o.id || `row-${i}`;
    if (!found.has(key) || rank[match] > rank[found.get(key).match]) found.set(key, { ...o, match });
  });
  return [...found.values()].sort((a, b) => rank[b.match] - rank[a.match]);
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

// ── Drafts Xero keyed itself ─────────────────────────────────────────────────
//
// A document emailed to an entity's Xero bills address arrives as a DRAFT bill
// Xero keyed, with the document attached, and never reaches the Documents inbox
// (FSL, 27 Oct 2026: two Asian Capital Partners drafts). The engine reads the
// attachment as it reads an inbox file and proposes its own bill; sending
// updates that draft instead of creating a second bill.

const ymd = (s) => String(s || "").slice(0, 10) || null;

// The draft's last-changed stamp, as milliseconds: a draft edited in Xero after
// it was read is a different version, read again before anything is sent.
function draftVersion(draft) {
  const m = /\/Date\((\d+)/.exec(String(draft?.UpdatedDateUTC || ""));
  if (m) return m[1];
  const t = Date.parse(draft?.UpdatedDateUTCString || "");
  return Number.isNaN(t) ? null : String(t);
}

// The engine's bill for a draft: the document and the master decide, and the
// draft fills only what they leave blank. The supplier, number and due date
// come over as Xero keyed them. Coding the master has no default for comes over
// too, as a suggestion: coding_from_xero keeps the item for the CFO.
function billFromDraft(bill, draft) {
  const out = { ...bill, Contact: { ...bill.Contact }, LineItems: bill.LineItems.map((l) => ({ ...l })), InvoiceID: draft.InvoiceID };
  const filled = [];
  if (!out.Contact.ContactID && draft.Contact?.ContactID) {
    out.Contact = { ContactID: draft.Contact.ContactID, Name: draft.Contact.Name || null };
  }
  if (!out.InvoiceNumber && draft.InvoiceNumber) out.InvoiceNumber = draft.InvoiceNumber;
  if (!out.Reference && (draft.Reference || draft.InvoiceNumber)) out.Reference = draft.Reference || draft.InvoiceNumber;
  if (!out.DueDateString && draft.DueDateString) out.DueDateString = draft.DueDateString;
  const keyed = draft.LineItems || [];
  if (keyed.length === out.LineItems.length) {
    out.LineItems.forEach((l, i) => {
      if (!l.AccountCode && keyed[i].AccountCode) { l.AccountCode = keyed[i].AccountCode; filled.push(`line ${i + 1} account ${l.AccountCode}`); }
      if (!l.TaxType && keyed[i].TaxType) { l.TaxType = keyed[i].TaxType; filled.push(`line ${i + 1} VAT ${l.TaxType}`); }
    });
  }
  return { bill: out, filled };
}

// What Xero keyed against what the engine proposes.
//   blocking  the bill itself differs (supplier, number, date, currency, total):
//             the CFO sees it before the draft is overwritten
//   coding    account, VAT treatment or line layout differs: listed, and the
//             engine's coding is what is sent
// A blank on either side is not a difference: one side filling the other in.
function draftDifferences(bill, draft) {
  const blocking = [];
  const coding = [];
  const differ = (field, keyed, proposed) => ({ field, keyed, proposed });
  if (bill.Contact?.ContactID && draft.Contact?.ContactID && bill.Contact.ContactID !== draft.Contact.ContactID) {
    blocking.push(differ("supplier", draft.Contact.Name, bill.Contact.Name));
  }
  if (normNumber(bill.InvoiceNumber) && normNumber(draft.InvoiceNumber) && normNumber(bill.InvoiceNumber) !== normNumber(draft.InvoiceNumber)) {
    blocking.push(differ("number", draft.InvoiceNumber, bill.InvoiceNumber));
  }
  if (ymd(bill.DateString) && ymd(draft.DateString) && ymd(bill.DateString) !== ymd(draft.DateString)) {
    blocking.push(differ("date", ymd(draft.DateString), ymd(bill.DateString)));
  }
  if (bill.CurrencyCode && draft.CurrencyCode && bill.CurrencyCode !== draft.CurrencyCode) {
    blocking.push(differ("currency", draft.CurrencyCode, bill.CurrencyCode));
  }
  if (bill.Total !== null && bill.Total !== undefined && draft.Total !== null && draft.Total !== undefined && pence(bill.Total) !== pence(draft.Total)) {
    blocking.push(differ("total", money(pence(draft.Total)), money(pence(bill.Total))));
  }
  const keyed = draft.LineItems || [];
  if (keyed.length !== bill.LineItems.length) {
    coding.push(differ("lines", keyed.length, bill.LineItems.length));
  } else {
    bill.LineItems.forEach((l, i) => {
      if (l.AccountCode && keyed[i].AccountCode && l.AccountCode !== keyed[i].AccountCode) coding.push(differ(`line ${i + 1} account`, keyed[i].AccountCode, l.AccountCode));
      if (l.TaxType && keyed[i].TaxType && l.TaxType !== keyed[i].TaxType) coding.push(differ(`line ${i + 1} VAT`, keyed[i].TaxType, l.TaxType));
    });
  }
  if (bill.LineAmountTypes && draft.LineAmountTypes && bill.LineAmountTypes !== draft.LineAmountTypes) {
    coding.push(differ("amounts are", draft.LineAmountTypes, bill.LineAmountTypes));
  }
  return { blocking, coding };
}

// Clean, or an exception for the CFO (spec 3.3), with every reason. The phase
// 2 review supplies most of them; the rest are what a bill built from scratch
// can lack. For a Xero draft, draft carries what the draft adds:
//   { differences, filled, attachments, documents }
function triage({ review, doc, match, bill, duplicates = [], draft = null, sameFile = null }) {
  const reasons = (review?.flags || []).filter((f) => f.flagged).map(({ check, detail }) => ({ check, detail }));
  if (!bill.DueDateString) reasons.push({ check: "no_due_date", detail: "no due date on the document and no payment terms in the supplier master" });
  if (!bill.CurrencyCode) reasons.push({ check: "no_currency", detail: "the document's currency could not be read" });
  const status = match?.link?.supplier?.status;
  if (status && status !== "active") reasons.push({ check: "supplier_status", detail: `the supplier is ${status} in the master` });
  if (sameFile) reasons.push({ check: "same_file", detail: `the same file as ${sameFile}, already read` });
  for (const d of duplicates) {
    const where = d.source === "xero" ? `in Xero${d.status ? ` (${d.status})` : ""}` : "in the queue";
    const what = `${d.number || "no number"}, ${d.date || "no date"}, ${d.total}`;
    if (d.match === "near") reasons.push({ check: "possible_duplicate", detail: `same supplier and amount within days, ${where}: ${what}` });
    else reasons.push({ check: "duplicate", detail: `may already be ${where}: ${what}` });
  }
  if (doc?.doubts) reasons.push({ check: "reader_doubts", detail: `the reader was unsure: ${doc.doubts}` });
  if (draft) {
    for (const d of draft.differences?.blocking || []) {
      reasons.push({ check: "draft_differs", detail: `Xero keyed the ${d.field} as ${d.keyed ?? "blank"}; the document says ${d.proposed ?? "blank"}` });
    }
    if (draft.filled?.length) {
      reasons.push({ check: "coding_from_xero", detail: `no default in the supplier master; Xero's coding kept as a suggestion: ${draft.filled.join(", ")}` });
    }
    if ((draft.attachments || 0) > 1) {
      reasons.push({ check: "several_attachments", detail: `the draft has ${draft.attachments} attachments; only the first document was read` });
    }
    if ((draft.documents || 0) > 1) {
      reasons.push({ check: "several_documents", detail: `the attachment holds ${draft.documents} documents; the draft is one bill` });
    }
  }
  return { state: reasons.length ? "exception" : "clean", reasons };
}

// ── Step 3: the CFO's decision, and the send to Xero ────────────────────────

// The proposed bill with the CFO's edits applied: a supplier chosen for a
// document the engine did not recognise, and an account or VAT treatment per
// line. Lines are addressed by position; amounts and descriptions are the
// document's and are not edited here.
//   edits  { contact?: { ContactID, Name }, due_date?: "YYYY-MM-DD", lines?: [{ index, account_code?, tax_type? }] }
function applyEdits(bill, edits = {}) {
  const issues = [];
  const out = { ...bill, Contact: { ...bill.Contact }, LineItems: bill.LineItems.map((l) => ({ ...l })) };
  if (edits.contact) {
    if (!edits.contact.ContactID) issues.push("the chosen supplier has no Xero contact");
    else out.Contact = { ContactID: edits.contact.ContactID, Name: edits.contact.Name || null };
  }
  // Xero refuses a bill awaiting approval with no due date; a document with
  // none (FSL, 27 Oct 2026: a retainer invoice) needs the CFO to set it.
  if (edits.due_date !== undefined && edits.due_date !== null && edits.due_date !== "") {
    const problem = dueDateIssue(edits.due_date, out);
    if (problem) issues.push(problem);
    else out.DueDateString = `${edits.due_date}T00:00:00`;
  }
  for (const e of edits.lines || []) {
    const line = Number.isInteger(e.index) ? out.LineItems[e.index] : null;
    if (!line) { issues.push(`there is no line ${e.index}`); continue; }
    if (e.account_code !== undefined) line.AccountCode = String(e.account_code || "").trim() || null;
    if (e.tax_type !== undefined) line.TaxType = String(e.tax_type || "").trim() || null;
  }
  return { bill: out, issues };
}

// Why a due date cannot go on this bill, or null.
function dueDateIssue(value, bill) {
  const d = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return "the due date must be a date (YYYY-MM-DD)";
  if (bill?.DateString && d < bill.DateString.slice(0, 10)) return "the due date is before the bill's date";
  return null;
}

// An agent's suggested coding for a queue item (the AP Clerk, through its Bills
// tools). Advice only: it changes neither the item's state nor its proposed
// bill. The CFO accepts it in the portal, which is the decision.
//   body     { lines: [{ index, account_code, tax_type, reason? }], due_date?, note,
//              supplier?: { contact_id?, name?, vat_number?, country?, reason } }
//            supplier: who the document is really from, when that is not the
//            bill's supplier. contact_id for one already in Xero; a name alone
//            proposes a new one, which the CFO creates with a tap.
//   allowed  { accounts: Set of active account codes, taxes: Set of active VAT types }
function recommendation(item, body = {}, { accounts = new Set(), taxes = new Set() } = {}) {
  const issues = [];
  if (!["clean", "exception", "approved"].includes(item.state)) issues.push(`only an unsent item takes a recommendation; this item is ${item.state}`);
  const billLines = item.proposed_bill?.LineItems || [];
  const asked = Array.isArray(body.lines) ? body.lines : [];
  if (!asked.length) issues.push("recommend coding for at least one line");
  const seen = new Set();
  const lines = [];
  for (const l of asked) {
    if (!Number.isInteger(l.index) || !billLines[l.index]) { issues.push(`there is no line ${l.index}`); continue; }
    if (seen.has(l.index)) issues.push(`line ${l.index} is recommended twice`);
    seen.add(l.index);
    const code = String(l.account_code ?? "").trim();
    const tax = String(l.tax_type ?? "").trim();
    if (!accounts.has(code)) issues.push(`line ${l.index}: ${code || "(blank)"} is not an active account in this company`);
    if (!taxes.has(tax)) issues.push(`line ${l.index}: ${tax || "(blank)"} is not an active VAT treatment in this company`);
    lines.push({ index: l.index, account_code: code, tax_type: tax, reason: String(l.reason ?? "").trim().slice(0, 500) || null });
  }
  const due = body.due_date ? String(body.due_date) : null;
  if (due) {
    const problem = dueDateIssue(due, item.proposed_bill);
    if (problem) issues.push(problem);
  }
  const note = String(body.note ?? "").trim().slice(0, 2000);
  if (!note) issues.push("a note explaining the recommendation is required");
  let supplier = null;
  if (body.supplier) {
    const s = body.supplier;
    const text = (v, n) => String(v ?? "").trim().slice(0, n) || null;
    supplier = { contact_id: text(s.contact_id, 36), name: text(s.name, 255), vat_number: text(s.vat_number, 50), country: text(s.country, 50), reason: text(s.reason, 500) };
    if (supplier.contact_id && !/^[0-9a-f-]{36}$/i.test(supplier.contact_id)) issues.push("supplier.contact_id must be a Xero contact id");
    if (!supplier.contact_id && !supplier.name) issues.push("a supplier needs a contact_id or a name");
    if (!supplier.reason) issues.push("say why the supplier should change");
  }
  return { issues, recommendation: issues.length ? null : { lines, due_date: due, note, ...(supplier ? { supplier } : {}) } };
}

// A reviewer's view of a recommendation (FM2 or the FC), kept on it, so a new
// recommendation starts unreviewed. Nobody reviews work they prepared.
//   body  { verdict: agree|disagree, repetitive: repetitive|changed|one_off, pattern?, note, agent? }
//   repetitive  a regular bill matching its pattern; a regular bill with
//               something different (pattern says what); a one-off or new supplier
function billReview(item, body = {}) {
  const issues = [];
  if (!item.recommendation) issues.push("this item has no recommendation to review");
  if (body.agent && item.recommendation?.agent === body.agent) issues.push("nobody reviews work they prepared");
  if (!["agree", "disagree"].includes(body.verdict)) issues.push("verdict must be agree or disagree");
  if (!["repetitive", "changed", "one_off"].includes(body.repetitive)) issues.push("repetitive must be repetitive, changed or one_off");
  const note = String(body.note ?? "").trim().slice(0, 2000);
  if (!note) issues.push("a note on what was checked is required");
  const pattern = String(body.pattern ?? "").trim().slice(0, 300) || null;
  return { issues, review: issues.length ? null : { verdict: body.verdict, repetitive: body.repetitive, pattern, note } };
}

// What the CFO's decision on a queue item does to it, or why it cannot.
//   item    the finance.ap_items row
//   action  "approve" | "reject"
function decide(item, { action, note = "", edits = null } = {}) {
  const issues = [];
  if (!["approve", "reject"].includes(action)) issues.push("action must be approve or reject");
  // A clean or approved item is approved here only to change its coding before it is sent.
  if (action === "approve" && !["exception", "clean", "approved"].includes(item.state)) issues.push(`only an unsent item is approved here; this item is ${item.state}`);
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
  if (!bill.DueDateString) issues.push("no due date: set one first (Xero needs it on a bill awaiting approval)");
  (bill.LineItems || []).forEach((l, i) => {
    if (!l.AccountCode) issues.push(`line ${i + 1} has no account`);
    if (!l.TaxType) issues.push(`line ${i + 1} has no VAT treatment`);
  });
  const fromDraft = item.source === "ledger_draft";
  if (fromDraft && !item.ledger_draft_id) issues.push("the Xero draft this item came from is not recorded");
  const body = {
    // A draft Xero keyed is updated in place: one bill, its document already attached.
    id: fromDraft ? item.ledger_draft_id : undefined,
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
    audit_note: fromDraft
      ? `Draft keyed by Xero from ${item.file_name}; checked against the document by the AP lane and sent from the portal.`
      : `From the Documents inbox (${item.file_name}), built by the AP lane and sent from the portal.`,
  };
  return { body, issues };
}

module.exports = {
  screenFile, notADocument, matchSupplier, buildBill, duplicatesOf, alreadyBilled, triage, MIN_IMAGE_BYTES,
  applyEdits, decide, sendRequest, draftVersion, billFromDraft, draftDifferences, recommendation, billReview,
};

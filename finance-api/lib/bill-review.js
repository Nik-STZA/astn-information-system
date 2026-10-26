// Phase 2 of the AP lane (docs/ap-lane/ap-lane-spec.md 3.1-3.2): read the
// document behind a supplier bill and compare it, by code, with the bill as
// keyed. Read-only: nothing here writes to Xero.
//
// A model reads the file once (extraction); everything after that is code.
// That split was learned on the 12 Oct 2026 UDL batch, which arrived as
// GBP 8,421.29 against GBP 1,105.04 the documents support:
//
//   - The model is trusted to read and copy, not to total. On two identical
//     Amazon invoices it netted the "Funded by Amazon" credit off one total and
//     not the other, with every line right on both. documentValue rebuilds the
//     invoice value from the lines, leaving payment credits to bank
//     reconciliation (CFO ruling, 12 Oct 2026).
//   - The model is not trusted with the VAT treatment: Google Cloud EMEA
//     invoices print no reverse-charge wording. The treatment comes from the
//     supplier master; the document only says how much VAT it shows.
//
// What the batch got wrong, and the check here that catches each:
//
//   screenshot of a Xero report made into two bills   not_evidence, same_file_twice
//   HK$4,967.97 keyed as GBP                          currency
//   GBP 876.79 of VAT on invoices showing 0%          vat_not_on_document
//   two two-page PDFs read as one page each           documents_without_bill, pages_unread
//   two SSD invoices flagged as a duplicate           duplicate_cleared_by_number
//
// Bills are booked on whatever the client provides (CFO, 26 Oct 2026): an
// invoice, a receipt or a payment confirmation (a bank or card app screenshot of
// the payment) is evidence of the purchase, and its type is reported as a fact.
// A report, a statement or anything else is not, and is flagged. The VAT is a
// separate question: it needs a VAT invoice (vat_without_invoice).
//
// Flags use check_bill's shape ({ check, flagged, detail }) so the two read
// as one report. This module never fetches: the route reads Xero and Vertex
// and hands the results in.

const { normNumber, billDate } = require("./bill-checks");

// ── Extraction (the one model call per file) ────────────────────────────────

const EXTRACT_PROMPT = `You are reading one file that a supplier or a colleague sent to a UK company's accounts-payable inbox.
Read EVERY page. A single file can hold several separate invoices (for example one per page); return one entry per document you find.
If the file is not a supplier invoice or credit note, say so in document_type and still return one entry: "receipt" for a till or online receipt from the supplier; "payment_confirmation" for a bank, card or payment app screen or email showing a payment to the supplier; "statement" for a statement of account; "report_or_screenshot" for a screenshot of a report or of accounting software; "other" for anything else (a quote, an order, a letter).
Copy values exactly as printed. Never infer a value that is not on the document: use null.
Currency: return the ISO code the document actually uses. Look at the symbol and any code next to the amounts (HK$ is HKD, US$ or $ with a US/Irish Twilio is USD). Never assume GBP because the reader is in the UK.
VAT: return the VAT/GST amount and rate exactly as printed. If the document shows 0% or no VAT line, vat_total is 0. If it says reverse charge (or "VAT to be accounted for by the recipient", Article 196, etc.), set reverse_charge_wording to that text.
Lines: one entry per printed line, including shipping, promotions, discounts and credits, with the sign as printed.
Bank details: if the document prints the supplier's bank details, give only the last 4 characters of the account number or IBAN.`;

const DOC = {
  type: "OBJECT",
  properties: {
    document_type: { type: "STRING", enum: ["invoice", "credit_note", "receipt", "payment_confirmation", "statement", "report_or_screenshot", "other"] },
    page_numbers: { type: "ARRAY", items: { type: "INTEGER" } },
    supplier_name: { type: "STRING", nullable: true },
    supplier_country: { type: "STRING", nullable: true },
    supplier_vat_number: { type: "STRING", nullable: true },
    supplier_address: { type: "STRING", nullable: true },
    customer_name: { type: "STRING", nullable: true },
    customer_address: { type: "STRING", nullable: true },
    customer_vat_number: { type: "STRING", nullable: true },
    document_number: { type: "STRING", nullable: true },
    document_date: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    due_date: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    currency: { type: "STRING", nullable: true, description: "ISO 4217" },
    net_total: { type: "NUMBER", nullable: true },
    vat_total: { type: "NUMBER", nullable: true },
    vat_rate_shown: { type: "STRING", nullable: true },
    gross_total: { type: "NUMBER", nullable: true },
    reverse_charge_wording: { type: "STRING", nullable: true },
    bank_account_last4: { type: "STRING", nullable: true },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { description: { type: "STRING" }, net: { type: "NUMBER", nullable: true }, vat: { type: "NUMBER", nullable: true } },
        required: ["description"],
      },
    },
    doubts: { type: "STRING", nullable: true, description: "anything unreadable or ambiguous" },
  },
  required: ["document_type", "page_numbers", "currency", "gross_total", "vat_total"],
};
const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: { total_pages_read: { type: "INTEGER" }, documents: { type: "ARRAY", items: DOC } },
  required: ["total_pages_read", "documents"],
};

function buildExtractRequest({ document, mimeType }) {
  return {
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType, data: Buffer.from(document).toString("base64") } },
      { text: EXTRACT_PROMPT },
    ] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: EXTRACT_SCHEMA, temperature: 0 },
  };
}

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const mask4 = (v) => (v ? String(v).replace(/[^A-Za-z0-9]/g, "").slice(-4) : null);

// The model's answer, made safe to compare: numbers as numbers, currency as an
// upper-case code, bank details cut to 4 characters whatever the model sent.
function parseExtraction(text) {
  let raw;
  try { raw = typeof text === "string" ? JSON.parse(text) : text; } catch { throw new Error("extraction was not JSON"); }
  const documents = (raw?.documents || []).map((d) => ({
    ...d,
    currency: d.currency ? String(d.currency).trim().toUpperCase() : null,
    net_total: num(d.net_total), vat_total: num(d.vat_total), gross_total: num(d.gross_total),
    bank_account_last4: mask4(d.bank_account_last4),
    page_numbers: Array.isArray(d.page_numbers) ? d.page_numbers.map(Number) : [],
    lines: (d.lines || []).map((l) => ({ description: String(l.description || ""), net: num(l.net), vat: num(l.vat) })),
  }));
  return { total_pages_read: num(raw?.total_pages_read), documents };
}

// Pages in a PDF, from its page tree; null when it cannot be told (a page tree
// inside a compressed object stream), which the check reports as unknown.
function pdfPageCount(bytes) {
  const s = Buffer.from(bytes).toString("latin1");
  if (!s.startsWith("%PDF")) return null;
  let max = null;
  const tree = /<<((?:(?!>>)[\s\S])*?\/Type\s*\/Pages\b(?:(?!>>)[\s\S])*?)>>/g;
  for (let m; (m = tree.exec(s));) {
    const c = /\/Count\s+(\d+)/.exec(m[1]);
    if (c) max = Math.max(max ?? 0, Number(c[1]));
  }
  if (max !== null) return max;
  const leaves = (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  return leaves || null;
}

// ── Comparison ──────────────────────────────────────────────────────────────

const pence = (v) => Math.round(Number(v || 0) * 100);
const money = (p) => (p / 100).toFixed(2);
const INVOICE_TYPES = ["invoice", "credit_note"];
// What a bill can be booked on: the documents that show the purchase.
const EVIDENCE_TYPES = [...INVOICE_TYPES, "receipt", "payment_confirmation"];
const TYPE_NAMES = { invoice: "an invoice", credit_note: "a credit note", receipt: "a receipt", payment_confirmation: "a payment confirmation",
  statement: "a statement", report_or_screenshot: "a report or screenshot", other: "not a purchase document" };
// Whether a document supports reclaiming the VAT it shows: a VAT invoice, or a
// receipt carrying the supplier's VAT number up to GBP 250 (a simplified
// invoice, VAT Notice 700 para 16.6).
const supportsVat = (doc) => INVOICE_TYPES.includes(doc.document_type)
  || (doc.document_type === "receipt" && Boolean(doc.supplier_vat_number) && doc.gross_total !== null && pence(doc.gross_total) <= 25000);
// Credits applied at payment, not to the supply: the card payment proves the
// cash, not the value (CFO, 12 Oct 2026). They are left to bank reconciliation.
const PAYMENT_CREDIT = /funded by amazon|gift card|promotional (credit|balance)|account credit applied/i;
// A folio or till receipt settles to zero: the payment is printed as a negative
// line ("VISA-0000 -741.33" on a hotel folio, 7 Oct 2026). Only a line that is
// nothing but a payment method (with at most a card number) and negative
// counts, so a "Visa application fee" stays a charge.
const SETTLEMENT = /^(visa|mastercard|master card|amex|american express|maestro|diners( club)?|discover|debit card|credit card|card( payment)?|payment( received)?|cash|deposit( paid)?|balance( paid)?)[\s\-*:#x\d]*$/i;
const isPayment = (l) => PAYMENT_CREDIT.test(l.description) || (pence(l.net) < 0 && SETTLEMENT.test(String(l.description || "").trim()));
// "GB VAT 493735845", "GB 493 7358 45" and "GB493735845" are one number.
const normVat = (v) => String(v || "").toUpperCase().replace(/\b(VAT|REG(ISTRATION)?|NO)\b|[^A-Z0-9]/g, "").replace(/^GB/, "");
// Xero's placeholder for a bill without a supplier carries a ContactID.
const hasSupplier = (bill) => Boolean(bill.Contact?.ContactID) && !/^no contact$/i.test(String(bill.Contact?.Name || "").trim());
const words = (s) => String(s || "").toLowerCase().replace(/\b(limited|ltd|plc|llp|inc|the)\b/g, "").replace(/[^a-z0-9]/g, "");

// The listed employee a document's customer name refers to, or null. Every word
// of the listed name must appear in the document's ("Jo Bloggs" matches
// "MS JO ANNE BLOGGS"), so a surname alone does not match.
function employeeNamed(customerName, employees = []) {
  const have = new Set(String(customerName).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return (employees || []).find((e) => {
    const need = String(e).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return need.length > 1 && need.every((w) => have.has(w));
  }) || null;
}

// The invoice value the document supports, in pence: its lines (net + VAT),
// less nothing for payment credits or settlements; else the printed gross.
function documentValue(doc) {
  const lines = (doc.lines || []).filter((l) => l.net !== null && !isPayment(l));
  if (lines.length) {
    const lineVat = lines.some((l) => l.vat !== null);
    const sum = lines.reduce((t, l) => t + pence(l.net) + pence(l.vat), 0);
    // Lines printed with VAT included (hotel folios, till receipts): they add
    // up to the printed gross, and the VAT total is already inside them.
    if (!lineVat && doc.gross_total !== null && Math.abs(sum - pence(doc.gross_total)) <= 2) return sum;
    // Lines printed net with the VAT only in the summary (Smart Numbers, FSL,
    // 23 Oct 2026): the document's VAT total is added once.
    const fromLines = sum + (lineVat || doc.vat_total === null ? 0 : pence(doc.vat_total));
    if (fromLines !== 0 || doc.gross_total === null) return fromLines;
  }
  return doc.gross_total === null ? null : pence(doc.gross_total);
}

// Which document in the file a bill is for: the same number, else the same
// value, else the only one there is. Invoices are tried before receipts and
// payment confirmations, so a receipt filed with its invoice does not win.
function matchDocument(bill, docs) {
  const n = normNumber(bill.InvoiceNumber);
  for (const types of [INVOICE_TYPES, EVIDENCE_TYPES]) {
    const pool = docs.filter((d) => types.includes(d.document_type));
    const hit = (n && pool.find((d) => normNumber(d.document_number) === n))
      || pool.find((d) => documentValue(d) === pence(bill.Total))
      || (pool.length === 1 ? pool[0] : null);
    if (hit) return hit;
  }
  return null;
}

/**
 * Compares one bill with the documents its attachment holds.
 *
 *   bill        the bill as keyed (GET /Invoices/{id})
 *   file        { name, sha256, pages } of the attachment read (pages may be null)
 *   extraction  parseExtraction(...) of that file, or null if none was read
 *   entity      { name, vat_number, postcode, pays_tax, employees, employee_invoice_accounts }
 *               of the buying entity; the last two from its supplier_master config
 *   supplier    finance.suppliers row for the bill's contact, or null
 *   link        finance.supplier_entities row, or null
 *   today       YYYY-MM-DD, for the future-date check
 */
function reviewBill({ bill, file = null, extraction = null, entity = {}, supplier = null, link = null, today }) {
  const flags = [];
  const flag = (check, fired, detail, extra = {}) => flags.push({ check, flagged: Boolean(fired), detail, ...extra });
  const docs = extraction?.documents || [];
  const result = (doc) => ({
    invoice_id: bill.InvoiceID, supplier: bill.Contact?.Name || null, number: bill.InvoiceNumber || "",
    date: billDate(bill), total: money(pence(bill.Total)), currency: bill.CurrencyCode, status: bill.Status,
    file: file?.name || null, document: doc ? {
      type: doc.document_type, number: doc.document_number, date: doc.document_date, currency: doc.currency,
      value: documentValue(doc) === null ? null : money(documentValue(doc)), vat: doc.vat_total, pages: doc.page_numbers,
    } : null,
    flags, flagged: flags.filter((f) => f.flagged).map((f) => f.check),
  });

  if (!file) {
    flag("no_document", true, "No PDF or image attached: there is nothing to check the bill against");
    return result(null);
  }
  if (!extraction) {
    flag("not_read", true, "The attachment could not be read; the bill is unchecked");
    return result(null);
  }

  const kinds = [...new Set(docs.map((d) => d.document_type))];
  const evidence = docs.filter((d) => EVIDENCE_TYPES.includes(d.document_type));
  const invoices = docs.filter((d) => INVOICE_TYPES.includes(d.document_type));
  flag("not_evidence", !evidence.length,
    invoices.length ? `${invoices.length} invoice(s) or credit note(s) in the file`
      : evidence.length ? `the file is ${kinds.map((k) => TYPE_NAMES[k] || k).join(", ")}, not an invoice: booked on what the client provided`
        : `the file is ${kinds.map((k) => TYPE_NAMES[k] || k).join(", ") || "empty"}: it does not show a purchase`);

  if (file.pages) {
    const read = new Set(docs.flatMap((d) => d.page_numbers));
    const unread = [...Array(file.pages).keys()].map((i) => i + 1).filter((p) => !read.has(p));
    flag("pages_unread", unread.length, unread.length
      ? `The PDF has ${file.pages} pages; page(s) ${unread.join(", ")} were not read`
      : `all ${file.pages} page(s) read`);
  } else flag("pages_unread", false, "page count of the file unknown (not a PDF, or its page tree is compressed)", { not_checked: true });

  const doc = matchDocument(bill, docs);
  if (!evidence.length) return result(null);
  if (!doc) {
    flag("document_not_matched", true, `None of the ${evidence.length} document(s) in the file matches this bill by number or value`);
    return result(null);
  }

  // Arithmetic on the document's printed totals. With lines, the value is built
  // from them and the model's totals are not relied on (the SSD invoices).
  const priced = (doc.lines || []).some((l) => l.net !== null);
  if (!priced && doc.net_total !== null && doc.vat_total !== null && doc.gross_total !== null) {
    const off = pence(doc.net_total) + pence(doc.vat_total) - pence(doc.gross_total);
    flag("document_arithmetic", Math.abs(off) > 2,
      `document net ${doc.net_total} + VAT ${doc.vat_total} vs gross ${doc.gross_total}${Math.abs(off) > 2 ? ` (off by ${money(off)})` : ""}`);
  }

  const docCur = doc.currency || null;
  flag("currency", docCur && docCur !== bill.CurrencyCode,
    `document in ${docCur || "unknown"}, bill in ${bill.CurrencyCode}`);

  // Totals: compared only in the same currency.
  const value = documentValue(doc);
  if (value !== null && (!docCur || docCur === bill.CurrencyCode)) {
    const diff = pence(bill.Total) - value;
    const credits = (doc.lines || []).filter(isPayment);
    flag("total_vs_document", diff !== 0,
      `bill ${money(pence(bill.Total))}, document ${money(value)}${diff ? ` (bill ${diff > 0 ? "over" : "under"} by ${money(Math.abs(diff))})` : ""}`
      + (credits.length ? `; payment credit(s) left to bank reconciliation: ${credits.map((l) => `${l.description} ${l.net}`).join(", ")}` : ""));
  }

  // VAT: the bill must not claim VAT the document does not show.
  const billTax = pence(bill.TotalTax);
  const docVat = doc.vat_total === null ? null : pence(doc.vat_total);
  const reverse = (bill.LineItems || []).some((l) => l.TaxType === "REVERSECHARGES");
  if (docVat !== null && (!docCur || docCur === bill.CurrencyCode)) {
    flag("vat_not_on_document", billTax > docVat + 2 && !reverse,
      `bill claims VAT ${money(billTax)}; the document shows ${money(docVat)}`);
    // The other way: VAT on the document the bill does not claim. A warning,
    // not an error: the invoice may not be the entity's to recover (addressee).
    // Only where the document could support the claim.
    if (supportsVat(doc)) {
      flag("vat_not_claimed", docVat > billTax + 2 && !reverse,
        `the document shows VAT ${money(docVat)}; the bill claims ${money(billTax)}`);
    }
  } else if (docVat === 0) {
    flag("vat_not_on_document", billTax > 0 && !reverse, `bill claims VAT ${money(billTax)}; the document shows none`);
  }
  // Booking on a receipt or a payment confirmation is fine; reclaiming VAT on
  // one is not, unless it is a simplified invoice (see supportsVat).
  if (!supportsVat(doc)) {
    flag("vat_without_invoice", billTax > 0 && !reverse, billTax > 0 && !reverse
      ? `bill claims VAT ${money(billTax)} on ${TYPE_NAMES[doc.document_type] || doc.document_type}: reclaiming VAT needs a VAT invoice (or a receipt showing the supplier's VAT number, up to GBP 250)`
      : `no VAT claimed on ${TYPE_NAMES[doc.document_type] || doc.document_type}`);
  }

  // Dates.
  if (doc.document_date) {
    flag("date_vs_document", doc.document_date !== billDate(bill), `bill dated ${billDate(bill)}, document ${doc.document_date}`);
    flag("date_in_future", today && doc.document_date > today, `document dated ${doc.document_date}`);
  }

  // Who the document is addressed to.
  const ourVat = normVat(entity.vat_number);
  const theirCustomerVat = normVat(doc.customer_vat_number);
  const postcode = String(entity.postcode || "").replace(/\s/g, "").toUpperCase();
  const atOurAddress = Boolean(postcode) && String(doc.customer_address || "").replace(/\s/g, "").toUpperCase().includes(postcode);
  const addressed = words(doc.customer_name).includes(words(entity.name)) || (ourVat && theirCustomerVat === ourVat) || atOurAddress;
  // An invoice in an employee's name is valid evidence for subsistence and road
  // fuel only (VAT Notice 700 para 19.5.9(a)): it passes when the employee is
  // listed and every line is coded to one of the entity's subsistence or fuel
  // accounts. Anything else in an employee's name is still flagged.
  const employee = !addressed && doc.customer_name ? employeeNamed(doc.customer_name, entity.employees) : null;
  if (employee) {
    const allowed = new Set((entity.employee_invoice_accounts || []).map(String));
    const outside = [...new Set((bill.LineItems || []).map((l) => l.AccountCode || "(none)"))].filter((c) => !allowed.has(c));
    flag("addressee", outside.length, outside.length
      ? `addressed to employee ${employee} (${doc.customer_name}): valid evidence for subsistence and road fuel only (VAT Notice 700 para 19.5.9(a)); line(s) coded to ${outside.join(", ")}`
      : `addressed to employee ${employee}: subsistence or fuel, valid in an employee's name (VAT Notice 700 para 19.5.9(a))`);
  } else flag("addressee", doc.customer_name && !addressed,
    addressed ? `addressed to ${atOurAddress && !words(doc.customer_name).includes(words(entity.name)) ? `${doc.customer_name} at ${entity.name}'s address` : entity.name}` : `addressed to ${doc.customer_name || "(no customer named)"}${doc.customer_address ? `, ${doc.customer_address.replace(/\s+/g, " ")}` : ""}, not ${entity.name}`);
  if (theirCustomerVat && ourVat) {
    flag("customer_vat_number", theirCustomerVat !== ourVat, `document carries customer VAT number ${doc.customer_vat_number}; ${entity.name} is ${entity.vat_number}`);
  }

  // Every line needs an account and a tax type before it can be submitted.
  const bare = (bill.LineItems || []).filter((l) => !l.AccountCode || !l.TaxType);
  flag("line_incomplete", bare.length, bare.length
    ? `${bare.length} line(s) without ${[...new Set(bare.flatMap((l) => [!l.AccountCode && "an account", !l.TaxType && "a tax type"]).filter(Boolean))].join(" or ")}`
    : "every line has an account and a tax type");

  // Against the supplier master.
  flag("no_supplier", !hasSupplier(bill), hasSupplier(bill) ? `supplier ${bill.Contact.Name}` : `no supplier on the bill; the document names ${doc.supplier_name || "none"}`);
  if (hasSupplier(bill)) {
    flag("not_in_master", !link, link ? `in the supplier master (${link.status})` : "the supplier is not in the supplier master: a new supplier goes to the CFO");
  }
  if (supplier?.vat_number && doc.supplier_vat_number) {
    flag("supplier_vat_number", normVat(supplier.vat_number) !== normVat(doc.supplier_vat_number),
      `document shows ${doc.supplier_vat_number}; the master holds ${supplier.vat_number}`);
  }
  if (supplier?.always_discuss || supplier?.mixed_treatment) {
    flag("cfo_review", true, supplier.always_discuss ? "always discuss: this bill goes to the CFO" : "mixed treatment: the VAT is decided bill by bill");
  }
  if (link?.default_tax_type) {
    const types = [...new Set((bill.LineItems || []).map((l) => l.TaxType || "NONE"))];
    const other = types.filter((t) => t !== link.default_tax_type);
    flag("vat_treatment", other.length, other.length
      ? `bill uses ${other.join(", ")}; the master's treatment is ${link.default_tax_type}` : `matches the master (${link.default_tax_type})`);
  }
  if (link?.default_account_code) {
    const codes = [...new Set((bill.LineItems || []).map((l) => String(l.AccountCode || "")))].filter(Boolean);
    const other = codes.filter((c) => c !== link.default_account_code);
    flag("account", other.length, other.length
      ? `bill uses ${other.join(", ")}; the master's default is ${link.default_account_code}` : `matches the master (${link.default_account_code})`);
  }
  return result(doc);
}

/**
 * The batch view: per-bill reviews plus what only shows across bills.
 *
 *   items   [{ bill, file, extraction, supplier, link }]
 *
 * Adds:
 *   same_file_twice              one file on two or more bills
 *   documents_without_bill       invoices in the files that no bill in the batch covers
 *   duplicate_cleared_by_number  same supplier, day and amount, but the documents carry
 *                                different numbers: two genuine invoices, not a duplicate
 */
function reviewBatch({ items, entity = {}, today }) {
  const reviews = items.map((it) => ({ ...reviewBill({ ...it, entity, today }), _it: it }));
  const findings = [];

  const bySha = new Map();
  for (const r of reviews) {
    const sha = r._it.file?.sha256;
    if (sha) bySha.set(sha, [...(bySha.get(sha) || []), r]);
  }
  for (const [sha, rs] of bySha) {
    if (rs.length < 2) continue;
    const ids = rs.map((r) => r.invoice_id.slice(0, 8));
    for (const r of rs) {
      r.flags.push({ check: "same_file_twice", flagged: true, detail: `the same file (${sha.slice(0, 12)}) is attached to ${rs.length} bills: ${ids.join(", ")}` });
    }
  }

  // Every invoice in every file should be some bill's document. A file on two
  // bills is read for each, so documents are compared by file and identity,
  // not as objects.
  const docKey = (sha, d) => `${sha || ""}|${normNumber(d.document_number)}|${documentValue(d)}`;
  const covered = new Set();
  for (const r of reviews) {
    const d = matchDocument(r._it.bill, r._it.extraction?.documents || []);
    if (d) covered.add(docKey(r._it.file?.sha256, d));
  }
  const seen = new Set();
  for (const r of reviews) {
    const sha = r._it.file?.sha256;
    if (sha && seen.has(sha)) continue;
    if (sha) seen.add(sha);
    const missing = (r._it.extraction?.documents || [])
      .filter((d) => INVOICE_TYPES.includes(d.document_type) && !covered.has(docKey(sha, d)));
    for (const d of missing) {
      const value = documentValue(d);
      findings.push({
        check: "documents_without_bill", flagged: true, file: r._it.file?.name, found_with: r.invoice_id,
        document: { number: d.document_number, date: d.document_date, currency: d.currency, value: value === null ? null : money(value), pages: d.page_numbers },
        detail: `${d.document_number || "an invoice"} (${d.currency || ""} ${value === null ? "?" : money(value)}, page ${d.page_numbers.join(", ")}) is in ${r._it.file?.name || "the file"} on bill ${r.invoice_id.slice(0, 8)} but has no bill`,
      });
      const self = r.flags.find((f) => f.check === "pages_unread");
      if (self) self.detail += `; ${d.document_number || "an invoice"} on page ${d.page_numbers.join(", ")} has no bill`;
    }
  }

  // check_bill's duplicate_same_day, settled by the documents' own numbers.
  const groups = new Map();
  for (const r of reviews) {
    const b = r._it.bill;
    if (!hasSupplier(b)) continue;
    const k = `${b.Contact.ContactID}|${billDate(b)}|${pence(b.Total)}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  for (const rs of groups.values()) {
    if (rs.length < 2) continue;
    const numbers = rs.map((r) => normNumber(matchDocument(r._it.bill, r._it.extraction?.documents || [])?.document_number));
    const distinct = numbers.every(Boolean) && new Set(numbers).size === numbers.length;
    for (const r of rs) {
      r.flags.push(distinct
        ? { check: "duplicate_cleared_by_number", flagged: false, detail: `same supplier, date and amount as ${rs.filter((o) => o !== r).map((o) => o.invoice_id.slice(0, 8)).join(", ")}, but the documents are ${numbers.join(" and ")}: separate invoices` }
        : { check: "duplicate_same_document", flagged: true, detail: `same supplier, date and amount as ${rs.filter((o) => o !== r).map((o) => o.invoice_id.slice(0, 8)).join(", ")}, and the documents do not show different numbers: a likely duplicate` });
    }
  }

  const bills = reviews.map(({ _it, ...r }) => ({ ...r, flagged: r.flags.filter((f) => f.flagged).map((f) => f.check) }));
  const keyed = bills.reduce((t, b) => t + (b.currency === "GBP" ? pence(b.total) : 0), 0);
  return {
    bills, findings,
    summary: {
      bills: bills.length,
      clean: bills.filter((b) => !b.flagged.length).length,
      flagged: bills.filter((b) => b.flagged.length).length,
      documents_without_bill: findings.filter((f) => f.check === "documents_without_bill").length,
      gbp_keyed: money(keyed),
    },
  };
}

module.exports = {
  EXTRACT_PROMPT, EXTRACT_SCHEMA, buildExtractRequest, parseExtraction, pdfPageCount,
  documentValue, matchDocument, reviewBill, reviewBatch, isPayment, normVat, words,
};

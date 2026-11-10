// Outstanding documents against Xero (Nik, 10 Nov 2026). Pure: the route
// (outstanding-docs-routes.js, POST .../xero-check) reads Xero and applies.
//
// Two jobs, both by evidence in Xero, never by judgement:
//
//   match   each open item to the Xero record it became once the bank line was
//           reconciled: a spend or receive money transaction, or a payment
//           against a bill or invoice. When that record has an attachment the
//           document has come, so the item is cleared as received, saying
//           where. A match without an attachment stays open, now pointing at
//           the Xero record.
//   scan    a month's spend and receive money and supplier bills in Xero with
//           no attachment and above the client's threshold, as candidates for a
//           person to accept. Bank lines still unreconciled are not in Xero's
//           API at all, so those still come from the bank reconciliation
//           reports.

const { dupKey, markDuplicates, payeeKey } = require("./outstanding-docs");

// A matched record is within this many days of the bank line: card payments
// settle a day or two after the purchase, and people date spend money by the
// receipt.
const DATE_WINDOW_DAYS = 3;
// The furthest back a check reads Xero, from the oldest open item.
const MAX_WINDOW_DAYS = 400;

const pence = (v) => Math.round(Math.abs(Number(v)) * 100);
const day = (v) => {
  const s = String(v ?? "");
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const ms = /\/Date\((-?\d+)/.exec(s);
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : null;
};
const daysBetween = (a, b) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Xero's where clause for a date range.
function dateWhere(from, to) {
  const d = (iso) => { const [y, m, dd] = iso.split("-").map(Number); return `DateTime(${y},${m},${dd})`; };
  return `Date >= ${d(from)} AND Date <= ${d(to)}`;
}

// The month's first and last day.
function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month ?? ""))) return null;
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

// The window to read Xero over for these open items, or null when none.
function checkWindow(items, today = new Date().toISOString().slice(0, 10)) {
  const dates = items.map((i) => i.txn_date).filter(Boolean).sort();
  if (!dates.length) return null;
  let from = addDays(dates[0], -DATE_WINDOW_DAYS);
  const earliest = addDays(today, -MAX_WINDOW_DAYS);
  if (from < earliest) from = earliest;
  let to = addDays(dates[dates.length - 1], DATE_WINDOW_DAYS);
  if (to > today) to = today;
  return from <= to ? { from, to } : null;
}

// ── Xero records, made comparable ───────────────────────────────────────────

const SPEND = new Set(["SPEND", "SPEND-OVERPAYMENT", "SPEND-PREPAYMENT"]);
const RECEIVE = new Set(["RECEIVE", "RECEIVE-OVERPAYMENT", "RECEIVE-PREPAYMENT"]);

function fromBankTransaction(t) {
  const direction = SPEND.has(t.Type) ? "spent" : RECEIVE.has(t.Type) ? "received" : null;
  if (!direction || t.Status === "DELETED" || t.Status === "VOIDED") return null;
  return {
    kind: "bank_transaction", id: t.BankTransactionID, direction, date: day(t.DateString ?? t.Date),
    amount: Number(t.Total), currency: t.CurrencyCode || "GBP", bank_account: t.BankAccount?.Name ?? null,
    contact: t.Contact?.Name ?? null, reference: t.Reference || null, has_attachments: t.HasAttachments === true,
    reconciled: t.IsReconciled === true, label: `${direction === "spent" ? "spend" : "receive"} money${t.Reference ? ` ${t.Reference}` : ""}`,
  };
}

// A payment against a bill (money out) or a sales invoice (money in). The
// invoice's own attachment is the document; the route reads it for a match.
function fromPayment(p) {
  if (p.Status === "DELETED") return null;
  const type = p.Invoice?.Type;
  const direction = type === "ACCPAY" ? "spent" : type === "ACCREC" ? "received" : null;
  if (!direction || !p.Invoice?.InvoiceID) return null;
  return {
    kind: "payment", id: p.PaymentID, invoice_id: p.Invoice.InvoiceID, direction, date: day(p.DateString ?? p.Date),
    amount: Number(p.Amount), currency: p.Invoice?.CurrencyCode || p.CurrencyCode || "GBP", bank_account: p.Account?.Name ?? null,
    contact: p.Invoice?.Contact?.Name ?? null, reference: p.Invoice?.InvoiceNumber || p.Reference || null,
    has_attachments: p.Invoice?.HasAttachments === true, reconciled: p.IsReconciled === true,
    label: `${direction === "spent" ? "bill" : "invoice"}${p.Invoice?.InvoiceNumber ? ` ${p.Invoice.InvoiceNumber}` : ""}`,
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

// Each open item to at most one Xero record, each record used once. Same
// direction, same amount to the penny in the same currency, dates within the
// window. An item already matched keeps its record when Xero still has it.
// Ties go to the same bank account, then the closest date, then a payee that
// shares letters, so three identical charges meet three identical records.
//   items    open items of one company: { id, txn_date, direction, amount, currency, bank_account, payee, xero_id }
//   records  fromBankTransaction / fromPayment results
// Returns [{ item_id, record }].
function matchItems(items, records) {
  const used = new Set();
  const out = [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const rest = [];
  for (const it of items) {
    const kept = it.xero_id ? byId.get(it.xero_id) : null;
    if (kept && !used.has(kept.id)) { used.add(kept.id); out.push({ item_id: it.id, record: kept }); }
    else rest.push(it);
  }
  const score = (it, r) => {
    const sameBank = it.bank_account && r.bank_account && norm(it.bank_account) === norm(r.bank_account) ? 0 : 1;
    const payee = payeeKey(it.payee), contact = payeeKey(r.contact);
    const samePayee = payee && contact && (payee.includes(contact.slice(0, 6)) || contact.includes(payee.slice(0, 6))) ? 0 : 1;
    return sameBank * 1000 + daysBetween(it.txn_date, r.date) * 10 + samePayee;
  };
  // The tightest pairs first, so a close match is not taken by a looser one.
  const pairs = [];
  for (const it of rest) {
    for (const r of records) {
      if (r.direction !== it.direction || (r.currency || "GBP") !== (it.currency || "GBP")) continue;
      if (pence(r.amount) !== pence(it.amount) || !r.date || daysBetween(it.txn_date, r.date) > DATE_WINDOW_DAYS) continue;
      pairs.push({ it, r, s: score(it, r) });
    }
  }
  pairs.sort((a, b) => a.s - b.s || String(a.it.txn_date).localeCompare(String(b.it.txn_date)) || String(a.r.id).localeCompare(String(b.r.id)));
  const done = new Set();
  for (const p of pairs) {
    if (done.has(p.it.id) || used.has(p.r.id)) continue;
    done.add(p.it.id);
    used.add(p.r.id);
    out.push({ item_id: p.it.id, record: p.r });
  }
  return out;
}

// What a match does to the item: cleared when Xero holds the document.
function matchOutcome(record) {
  if (record.has_attachments) {
    return { clear: true, reason: `Attachment found in Xero on the ${record.label} (${record.date}).` };
  }
  return { clear: false, reason: null };
}

// ── Scanning a month ─────────────────────────────────────────────────────────

// Spend and receive money and supplier bills in the month with no attachment,
// above the threshold in sterling, that the register does not already hold.
//   bankTransactions  raw Xero BankTransactions
//   bills             raw Xero Invoices (ACCPAY)
//   held              existing items (any state but dismissed): xero_id, and the dupKey fields
// Returns candidate lines for the register (duplicate_of set for a repeat).
function scanMonth({ bankTransactions = [], bills = [], range, threshold, held = [], entity }) {
  const heldIds = new Set(held.map((h) => h.xero_id).filter(Boolean));
  const inRange = (d) => d && d >= range.from && d <= range.to;
  const lines = [];
  for (const t of bankTransactions) {
    const r = fromBankTransaction(t);
    if (!r || r.has_attachments || heldIds.has(r.id) || !inRange(r.date) || t.Status !== "AUTHORISED") continue;
    if (r.currency === "GBP" && Math.abs(r.amount) <= Number(threshold)) continue;
    lines.push({
      txn_date: r.date, payee: r.contact || r.reference || "Unnamed", reference: r.reference, direction: r.direction,
      amount: Math.abs(r.amount), currency: r.currency, amount_gbp: null, bank_account: r.bank_account,
      concern: r.currency !== "GBP" ? "overseas_reverse_charge" : "no_vat_invoice",
      note: `In Xero as ${r.direction === "spent" ? "spend" : "receive"} money with no attachment.`,
      xero_type: "bank_transaction", xero_id: r.id, entity_id: entity.id, card_holder: null, source_line: null,
    });
  }
  for (const b of bills) {
    if (b.Type !== "ACCPAY" || !["AUTHORISED", "PAID"].includes(b.Status) || b.HasAttachments === true || heldIds.has(b.InvoiceID)) continue;
    const date = day(b.DateString ?? b.Date);
    const currency = b.CurrencyCode || "GBP";
    if (!inRange(date) || (currency === "GBP" && Math.abs(Number(b.Total)) <= Number(threshold))) continue;
    lines.push({
      txn_date: date, payee: b.Contact?.Name || "Unnamed supplier", reference: b.InvoiceNumber || b.Reference || null, direction: "spent",
      amount: Math.abs(Number(b.Total)), currency, amount_gbp: null, bank_account: null,
      concern: currency !== "GBP" ? "overseas_reverse_charge" : "no_vat_invoice",
      note: `Supplier bill${b.InvoiceNumber ? ` ${b.InvoiceNumber}` : ""} in Xero with no attachment.`,
      xero_type: "bill", xero_id: b.InvoiceID, entity_id: entity.id, card_holder: null, source_line: null,
    });
  }
  return markDuplicates(lines.filter((l) => l.amount > 0), held.filter((h) => h.state !== "dismissed"));
}

module.exports = {
  DATE_WINDOW_DAYS, MAX_WINDOW_DAYS, dateWhere, monthRange, checkWindow, day,
  fromBankTransaction, fromPayment, matchItems, matchOutcome, scanMonth, dupKey,
};

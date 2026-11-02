// Account activity: one account's ledger, rebuilt from the documents that post
// to it (2 Nov 2026).
//
// Why rebuild it: Xero's /Journals feed would list every ledger line on an
// account, but this platform's Xero app cannot be granted
// accounting.journals.read (invalid_scope for apps on the granular scopes; see
// lib/ledger-changes.js). And /Reports/AccountTransactions is not a Xero API
// endpoint at all. Without this, FM1 searched bills and manual journals over a
// guessed window and missed spend money coded straight to the account, credit
// notes, and anything older than its guess: on one group it explained £11k of a
// £55k Prepayments balance.
//
// So: read every document type that carries coded lines (bills and sales
// invoices, credit notes, spend and receive money, manual journals) over the
// dates asked for, keep the lines on the account, and set the total against the
// trial balance either side. Whatever the documents cannot account for is
// reported as `unexplained`, with the reasons it can happen, rather than hidden.
//
// Everything that decides a number lives here and is tested. The route in
// server.js only fetches.
//
// Sign convention: debit positive, credit negative, in pence, the same as the
// trial balance's YTD Debit less YTD Credit (lib/recs.js). Each document type
// posts its lines to one side:
//
//   ACCPAY (bill)                     line Dr, Cr accounts payable
//   ACCREC (sales invoice)            line Cr, Dr accounts receivable
//   ACCPAYCREDIT (supplier credit)    line Cr, reverses a bill
//   ACCRECCREDIT (customer credit)    line Dr, reverses a sales invoice
//   SPEND, SPEND-PREPAYMENT,
//     SPEND-OVERPAYMENT               line Dr, Cr bank
//   RECEIVE, RECEIVE-PREPAYMENT,
//     RECEIVE-OVERPAYMENT             line Cr, Dr bank
//   Manual journal                    LineAmount as given: positive is Dr
//
// A negative line on a document (a discount line on a bill, say) posts to the
// other side, so the sign is applied to the line's own signed amount.

const { trialBalanceByAccountId, fromPence } = require("./journal");

const DEFAULT_CAP = 2000;

// +1: the document debits the coded account. -1: it credits it.
const SIDE = {
  ACCPAY: 1,
  ACCREC: -1,
  ACCPAYCREDIT: -1,
  ACCRECCREDIT: 1,
  SPEND: 1,
  "SPEND-PREPAYMENT": 1,
  "SPEND-OVERPAYMENT": 1,
  RECEIVE: -1,
  "RECEIVE-PREPAYMENT": -1,
  "RECEIVE-OVERPAYMENT": -1,
};

// Which statuses mean the document is in the ledger, which mean it is waiting
// and has not posted, and (by omission) which are ignored: VOIDED and DELETED
// documents posted nothing, or Xero has reversed what they posted.
const STATUS = {
  invoice: { posted: ["AUTHORISED", "PAID"], waiting: ["DRAFT", "SUBMITTED"] },
  credit_note: { posted: ["AUTHORISED", "PAID"], waiting: ["DRAFT", "SUBMITTED"] },
  // A bank transaction is AUTHORISED or DELETED; there is no draft.
  bank_transaction: { posted: ["AUTHORISED"], waiting: [] },
  manual_journal: { posted: ["POSTED"], waiting: ["DRAFT"] },
};

const BLIND_SPOTS = [
  "conversion (opening) balances entered in Xero's conversion setup",
  "fixed asset depreciation posted by Xero's fixed asset register",
  "foreign currency revaluation and realised gains and losses",
  "allocations of prepayments and overpayments to invoices, and payments of bills and invoices (these post to the payables, receivables and bank accounts, not to coded lines)",
  "payroll postings from Xero Payroll, and expense claims",
  "documents dated before the start date or after the end date (the opening trial balance covers the earlier ones)",
];

// ── Small helpers ────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function dayBefore(s) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Xero sends dates as "2026-08-31T00:00:00" (the *String fields) or as
// "/Date(1788134400000+0000)/".
function day(s) {
  if (!s) return null;
  const ms = /^\/Date\((-?\d+)/.exec(String(s));
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : String(s).slice(0, 10);
}

// Pounds as Xero sends them (a number or a numeric string) to whole pence.
// Rounded, because 0.1 + 0.2 arithmetic on pounds is how a rec ends up out by
// a penny nobody can find.
function pence(v) {
  const n = Number(String(v ?? 0).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const pounds = (p) => (p === null || p === undefined ? null : Number(fromPence(p)));

const sameCode = (a, b) => String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();

// ── Amounts ──────────────────────────────────────────────────────────────────

// The ledger amount of one line in the document's currency, in pence, signed as
// the line is (a negative line stays negative). The account gets the net:
// under Inclusive amounts the VAT is inside LineAmount and goes to the VAT
// account, so it comes out here. Exclusive and NoTax amounts are already net.
// The VAT is taken off by size, because Xero's sign on TaxAmount for a negative
// line is not something to rely on.
function netLinePence(lineAmount, taxAmount, lineAmountTypes) {
  const gross = pence(lineAmount);
  if (String(lineAmountTypes || "").toLowerCase() !== "inclusive") return gross;
  const tax = Math.abs(pence(taxAmount));
  return gross >= 0 ? gross - tax : gross + tax;
}

// A foreign-currency document converted to the base currency at its own rate.
// Xero's CurrencyRate is units of the document currency per one unit of base.
// Converted line by line, so a penny can differ from Xero's own rounding, which
// is done on the document; that is said in the note.
function toBase(p, currencyRate) {
  const rate = Number(currencyRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate === 1) return p;
  return Math.round(p / rate);
}

// ── Documents to lines ───────────────────────────────────────────────────────

// Each source document as the parts that matter here. One shape for all four
// kinds, so the decision below is made once.
function normalise(kind, d) {
  switch (kind) {
    case "invoice":
      return {
        kind, source: d.Type === "ACCREC" ? "sales_invoice" : "bill", side: SIDE[d.Type], id: d.InvoiceID,
        number: d.InvoiceNumber || d.Reference || null, contact: d.Contact?.Name ?? null,
        date: day(d.DateString ?? d.Date), status: d.Status, amountTypes: d.LineAmountTypes, rate: d.CurrencyRate,
        lines: (d.LineItems || []).map((l) => ({ code: l.AccountCode, amount: l.LineAmount, tax: l.TaxAmount, description: l.Description })),
      };
    case "credit_note":
      return {
        kind, source: d.Type === "ACCRECCREDIT" ? "sales_credit_note" : "supplier_credit_note", side: SIDE[d.Type],
        id: d.CreditNoteID, number: d.CreditNoteNumber || d.Reference || null, contact: d.Contact?.Name ?? null,
        date: day(d.DateString ?? d.Date), status: d.Status, amountTypes: d.LineAmountTypes, rate: d.CurrencyRate,
        lines: (d.LineItems || []).map((l) => ({ code: l.AccountCode, amount: l.LineAmount, tax: l.TaxAmount, description: l.Description })),
      };
    case "bank_transaction":
      return {
        kind, source: `bank_${String(d.Type || "").toLowerCase().replace(/-/g, "_")}`, side: SIDE[d.Type],
        id: d.BankTransactionID, number: d.Reference || null, contact: d.Contact?.Name ?? null,
        date: day(d.DateString ?? d.Date), status: d.Status, amountTypes: d.LineAmountTypes, rate: d.CurrencyRate,
        lines: (d.LineItems || []).map((l) => ({ code: l.AccountCode, amount: l.LineAmount, tax: l.TaxAmount, description: l.Description })),
      };
    case "manual_journal":
      // Manual journals are always in the base currency, and LineAmount
      // carries its own sign: positive is a debit.
      return {
        kind, source: "manual_journal", side: 1, id: d.ManualJournalID, number: d.Narration || null, contact: null,
        date: day(d.DateString ?? d.Date), status: d.Status, amountTypes: d.LineAmountTypes, rate: null,
        lines: (d.JournalLines || []).map((l) => ({ code: l.AccountCode, amount: l.LineAmount, tax: l.TaxAmount, description: l.Description })),
      };
    default:
      throw new Error(`unknown document kind ${kind}`);
  }
}

// Lines of one document on the account, as ledger lines in pence.
// state: "posted", "waiting" or null (ignored).
function linesOnAccount(doc, code) {
  const rule = STATUS[doc.kind];
  const status = String(doc.status || "").toUpperCase();
  const state = rule.posted.includes(status) ? "posted" : rule.waiting.includes(status) ? "waiting" : null;
  // A transfer between bank accounts has no coded lines; an unknown type is
  // not guessed at.
  if (!state || !doc.side) return [];
  return doc.lines
    .filter((l) => sameCode(l.code, code))
    .map((l) => {
      const signed = doc.side * toBase(netLinePence(l.amount, l.tax, doc.amountTypes), doc.rate);
      return {
        state, date: doc.date, source: doc.source, id: doc.id, number_or_ref: doc.number, contact: doc.contact,
        description: l.description ?? null, amount: signed, status,
      };
    })
    .filter((l) => l.amount !== 0);
}

// ── The trial balance either side ────────────────────────────────────────────

const hasRows = (report) => (report?.Rows ?? []).some((s) => (s?.Rows ?? []).some((r) => r?.RowType === "Row"));

// The account's balance on a TrialBalance report, in pence, debit positive.
// Found by AccountID where the row carries it, else by "(code)" at the end of
// the name. A report with rows but none for the account means a nil balance
// (Xero leaves nil accounts out). A report with no rows at all is a failed or
// empty read and gives null, never a nil that looks real.
function tbBalance(report, account) {
  if (!hasRows(report)) return null;
  const byId = trialBalanceByAccountId(report);
  let row = account?.AccountID ? byId[account.AccountID] : null;
  if (!row) {
    for (const section of report.Rows ?? []) {
      for (const r of section?.Rows ?? []) {
        if (r?.RowType !== "Row") continue;
        const m = /\(([^()]+)\)\s*$/.exec(String(r.Cells?.[0]?.Value ?? ""));
        if (m && sameCode(m[1], account?.Code)) {
          row = { ytdDebit: r.Cells?.[3]?.Value, ytdCredit: r.Cells?.[4]?.Value };
        }
      }
    }
  }
  if (!row) return 0;
  return pence(row.ytdDebit) - pence(row.ytdCredit);
}

// ── The result ───────────────────────────────────────────────────────────────

// account:   Xero's Accounts row (Code, Name, Type, Class, AccountID, SystemAccount)
// documents: { invoices, creditNotes, bankTransactions, manualJournals } as Xero returns them
// openingTb: TrialBalance report dated the day before `from`
// closingTb: TrialBalance report dated `to`
// fetch:     { complete, read, cap, incomplete: [source names] } from fetchDocuments
function buildActivity({ account, from, to, documents = {}, openingTb, closingTb, fetch = { complete: true } }) {
  const code = account.Code;
  const docs = [
    ...(documents.invoices || []).map((d) => normalise("invoice", d)),
    ...(documents.creditNotes || []).map((d) => normalise("credit_note", d)),
    ...(documents.bankTransactions || []).map((d) => normalise("bank_transaction", d)),
    ...(documents.manualJournals || []).map((d) => normalise("manual_journal", d)),
  ].filter((d) => d.date && d.date >= from && d.date <= to);

  const all = docs.flatMap((d) => linesOnAccount(d, code))
    .sort((a, b) => (a.date === b.date ? String(a.source).localeCompare(String(b.source)) : a.date < b.date ? -1 : 1));
  const view = (l) => ({
    date: l.date, source: l.source, id: l.id, number_or_ref: l.number_or_ref, contact: l.contact,
    description: l.description, debit: l.amount > 0 ? pounds(l.amount) : 0, credit: l.amount < 0 ? pounds(-l.amount) : 0,
    status: l.status,
  });
  const posted = all.filter((l) => l.state === "posted");
  const waiting = all.filter((l) => l.state === "waiting");

  const debits = posted.reduce((s, l) => s + Math.max(l.amount, 0), 0);
  const credits = posted.reduce((s, l) => s + Math.max(-l.amount, 0), 0);
  const movement = debits - credits;
  const waitingNet = waiting.reduce((s, l) => s + l.amount, 0);

  const opening = tbBalance(openingTb, account);
  const closing = tbBalance(closingTb, account);
  const rebuilt = opening === null ? null : opening + movement;
  const unexplained = closing === null || rebuilt === null ? null : closing - rebuilt;

  const warnings = [];
  if (opening === null) warnings.push(`Xero returned a trial balance with no rows at ${dayBefore(from)}, so the opening balance is unknown and nothing can be agreed. If the company started after that date, start from its first day.`);
  if (closing === null) warnings.push(`Xero returned a trial balance with no rows at ${to}, so the closing balance is unknown.`);
  if (account.Type === "BANK" || account.SystemAccount) {
    warnings.push(
      "Xero posts to this account itself (bank movements, payments, VAT, payables or receivables totals, or revaluations), " +
      "not from lines coded to it, so a rebuild from coded lines will not explain it. Reconcile it from its own source instead."
    );
  }
  if (["REVENUE", "EXPENSE"].includes(String(account.Class || "").toUpperCase())) {
    warnings.push("This is a profit and loss account. Xero's trial balance gives it year to date, so the comparison holds only when both dates are in the same financial year.");
  }
  if (!fetch.complete) {
    warnings.push(
      `Reading stopped at the cap of ${fetch.cap} documents, so the lines are incomplete` +
      `${fetch.incomplete?.length ? ` (not fully read: ${fetch.incomplete.join(", ")})` : ""}. ` +
      "Narrow the dates and run it again in parts; do not rely on these totals."
    );
  }

  const note = [
    "Computed by the platform from the documents in Xero; quote these totals rather than adding the lines up yourself.",
    "Lines are the net (ex VAT) amounts in the base currency, debit positive.",
    unexplained === 0
      ? "The documents explain the whole movement between the two trial balances."
      : unexplained === null
        ? "The movement could not be agreed because a trial balance was missing."
        : `The trial balance carries ${fromPence(Math.abs(unexplained))} more ${unexplained > 0 ? "debit" : "credit"} than the documents explain. ` +
          `What this cannot see: ${BLIND_SPOTS.join("; ")}. A foreign-currency document can also differ by a penny from Xero's own rounding. ` +
          "If the difference is in the opening, move the start date back to when the account was last nil.",
    waiting.length
      ? `${waiting.length} line(s) on draft or submitted documents are listed under not_posted; they are not in the ledger and not in the totals.`
      : null,
  ].filter(Boolean).join(" ");

  return {
    account: { code, name: account.Name ?? null, type: account.Type ?? null, class: account.Class ?? null },
    from, to,
    opening_date: dayBefore(from),
    opening_from_tb: pounds(opening),
    closing_from_tb: pounds(closing),
    lines: posted.map(view),
    not_posted: waiting.map(view),
    not_posted_total: pounds(waitingNet),
    posted_total: { debit: pounds(debits), credit: pounds(credits), net: pounds(movement) },
    rebuilt_closing: pounds(rebuilt),
    unexplained: pounds(unexplained),
    complete: Boolean(fetch.complete),
    documents_read: fetch.read ?? docs.length,
    warnings,
    note,
  };
}

// ── Fetching ─────────────────────────────────────────────────────────────────

const dt = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  return `DateTime(${y},${m},${dd})`;
};

// The four document lists, in the order fetched. Smallest first: if the cap
// is hit, the lists most likely to be complete are the ones read.
const SOURCES = [
  { name: "manual journals", path: "/ManualJournals", key: "ManualJournals", into: "manualJournals" },
  { name: "credit notes", path: "/CreditNotes", key: "CreditNotes", into: "creditNotes" },
  { name: "bank transactions", path: "/BankTransactions", key: "BankTransactions", into: "bankTransactions" },
  { name: "invoices and bills", path: "/Invoices", key: "Invoices", into: "invoices" },
];

// get(path, params) -> Xero's parsed JSON. Called one page at a time, never in
// parallel: Xero allows five concurrent calls per organisation and other work
// shares them. Pages (page=N) come back with line items, which summaryOnly
// would leave out. Filtered by date only; status is decided in buildActivity,
// where it is tested, rather than in a where clause.
async function fetchDocuments({ get, from, to, cap = DEFAULT_CAP }) {
  const where = `Date>=${dt(from)} AND Date<=${dt(to)}`;
  const documents = { invoices: [], creditNotes: [], bankTransactions: [], manualJournals: [] };
  let read = 0;
  const incomplete = [];
  for (const s of SOURCES) {
    if (read >= cap) { incomplete.push(s.name); continue; }
    for (let page = 1; ; page++) {
      const got = (await get(s.path, { where, order: "Date", page: String(page) }))?.[s.key] || [];
      const room = cap - read;
      const take = got.slice(0, room);
      documents[s.into].push(...take);
      read += take.length;
      if (got.length > room) { incomplete.push(s.name); break; }
      if (got.length < 100) break;
      if (read >= cap) { incomplete.push(s.name); break; }
    }
  }
  return { documents, fetch: { complete: incomplete.length === 0, read, cap, incomplete } };
}

module.exports = {
  buildActivity, fetchDocuments, netLinePence, toBase, tbBalance, linesOnAccount, normalise,
  isDate, dayBefore, SIDE, STATUS, BLIND_SPOTS, DEFAULT_CAP,
};

// What changed in a Xero ledger since the last management pack.
//
// Xero's /Journals feed would say it directly, but this platform's Xero app
// cannot be granted accounting.journals.read: Xero answers invalid_scope for
// apps on the granular scopes (checked 11 Sep 2026). So the change is read from
// the documents that post to the ledger instead. Each is fetched with
// If-Modified-Since set to the previous build's start, which returns anything
// created, edited, voided or deleted since, and each carries the date it posts
// to. Those dates say which periods moved, which decides how far back a build
// must re-pull. It is also a control: an entry dated into a year already
// reported, or on or before the lock date, is something a controller wants to
// see before the pack goes out.
//
// "Modified" is broader than "posted to its period": paying a June bill in
// September touches the bill but posts nothing to June (the payment posts on its
// own date and is counted from /Payments). On 11 Sep 2026 that made 9 of FGH's
// 11 lock-date flags noise. So drafts that never posted are dropped, and a
// document that could move an old or locked period has its history read: it
// counts only if something other than a payment or an attachment happened to it
// since the watermark.
//
// Blind spot, stated rather than hidden: entries Xero creates with no document
// behind them (fixed-asset depreciation, FX revaluation, conversion balances)
// do not appear here. The lock dates narrow it: a locked period cannot change
// without someone moving the lock.

// Xero resource -> the collection key in its response, the id field, whether it
// pages, a label for people, and the statuses that mean it never posted.
const LEDGER_DOCUMENTS = {
  "/Invoices": {
    key: "Invoices", idKey: "InvoiceID", paged: true, label: "invoices and bills",
    neverPosted: ["DRAFT", "SUBMITTED", "DELETED"],
  },
  "/CreditNotes": {
    key: "CreditNotes", idKey: "CreditNoteID", paged: true, label: "credit notes",
    neverPosted: ["DRAFT", "SUBMITTED", "DELETED"],
  },
  "/BankTransactions": {
    key: "BankTransactions", idKey: "BankTransactionID", paged: true, label: "bank transactions",
    neverPosted: [],
  },
  "/ManualJournals": {
    key: "ManualJournals", idKey: "ManualJournalID", paged: true, label: "manual journals",
    neverPosted: ["DRAFT", "DELETED"],
  },
  "/Payments": {
    key: "Payments", idKey: "PaymentID", paged: true, label: "payments",
    neverPosted: [],
  },
  // History is not read for transfers: any change to one is counted.
  "/BankTransfers": {
    key: "BankTransfers", idKey: "BankTransferID", paged: false, label: "bank transfers",
    neverPosted: [], noHistory: true,
  },
};

// History labels that post nothing to the document's own period. Anything else,
// including a label not seen before, counts as a change. Labels seen on 11 Sep
// 2026: Created, Approved, Attached a file, Edited, Paid, Posted.
const BENIGN_HISTORY = new Set(["Paid", "Attached a file"]);

// Xero JSON dates look like "/Date(1788134400000+0000)/". Some fields come as a
// plain "2026-08-31T00:00:00" instead: that is a calendar day in the
// organisation's books, not an instant, so it is read as UTC. Read as local
// time it lands on 30 August during British Summer Time.
function xeroDate(v) {
  const m = /\/Date\((-?\d+)/.exec(String(v ?? ""));
  if (m) return new Date(Number(m[1]));
  if (!v) return null;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}(T[\d:.]+)?$/.test(s) ? `${s.length === 10 ? `${s}T00:00:00` : s}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const isoDay = (d) => d.toISOString().slice(0, 10);

// One Xero response -> the changed documents in it.
function documentsFrom(resource, payload) {
  const spec = LEDGER_DOCUMENTS[resource];
  if (!spec) return [];
  return (payload?.[spec.key] ?? []).map((d) => ({
    resource,
    id: d[spec.idKey] ?? null,
    label: spec.label,
    date: d.Date ?? d.DateString ?? null,
    status: d.Status ?? null,
  }));
}

function neverPosted(doc) {
  const spec = LEDGER_DOCUMENTS[doc.resource];
  return Boolean(spec) && spec.neverPosted.includes(String(doc.status || "").toUpperCase());
}

// Only a document dated on or before the lock date, or into a year before the
// reporting year, can make this check say something beyond "re-pull the
// reporting year", so only those are worth a history call.
function needsHistoryCheck(doc, { reportingYear, lockDates = {} } = {}) {
  const spec = LEDGER_DOCUMENTS[doc.resource];
  if (!spec || spec.noHistory || !doc.id) return false;
  const d = xeroDate(doc.date);
  if (!d) return false;
  const lock = xeroDate(lockDates.periodLockDate);
  return Boolean((lock && isoDay(d) <= isoDay(lock)) || (reportingYear && d.getUTCFullYear() < Number(reportingYear)));
}

function historyShowsLedgerChange(records = [], since) {
  const from = Date.parse(since);
  // Without a usable watermark there is nothing to compare against: count it.
  if (!Number.isFinite(from)) return true;
  return (records ?? []).some((h) => {
    const when = xeroDate(h.DateUTC ?? h.DateUTCString);
    return when && when.getTime() >= from && !BENIGN_HISTORY.has(String(h.Changes || "").trim());
  });
}

function summariseChanges(docs, { since = null, reportingYear, lockDates = {} } = {}) {
  const year = Number(reportingYear);
  const periods = new Map();
  const years = new Set(year ? [year] : []);

  const periodLock = xeroDate(lockDates.periodLockDate);
  const lockDay = periodLock ? isoDay(periodLock) : null;
  let onOrBeforeLock = 0;
  let undated = 0;

  for (const doc of docs) {
    const d = xeroDate(doc.date);
    if (!d) {
      undated += 1;
      continue;
    }
    const day = isoDay(d);
    const key = day.slice(0, 7);
    const p = periods.get(key) ?? { period: key, count: 0, kinds: {} };
    p.count += 1;
    p.kinds[doc.label] = (p.kinds[doc.label] ?? 0) + 1;
    periods.set(key, p);

    // A pack reports the reporting year and the years before it; an entry dated
    // after the reporting year cannot change this pack.
    const y = d.getUTCFullYear();
    if (!year || y <= year) years.add(y);
    if (lockDay && day <= lockDay) onOrBeforeLock += 1;
  }

  const flags = [];
  const priorYears = [...new Set([...periods.keys()].map((p) => Number(p.slice(0, 4))))]
    .filter((y) => year && y < year)
    .sort((a, b) => a - b);
  if (priorYears.length) flags.push(`entries dated into year(s) already reported: ${priorYears.join(", ")}`);
  if (onOrBeforeLock) {
    flags.push(`${onOrBeforeLock} entr${onOrBeforeLock === 1 ? "y" : "ies"} dated on or before the lock date ${lockDay}`);
  }
  if (undated) flags.push(`${undated} changed document(s) had no date and could not be placed in a period`);

  return {
    since,
    changed: docs.length,
    periods: [...periods.values()].sort((a, b) => a.period.localeCompare(b.period)),
    yearsToRepull: [...years].sort((a, b) => a - b),
    lockDates: {
      periodLockDate: lockDay,
      endOfYearLockDate: xeroDate(lockDates.endOfYearLockDate) ? isoDay(xeroDate(lockDates.endOfYearLockDate)) : null,
    },
    flags,
  };
}

module.exports = {
  LEDGER_DOCUMENTS,
  BENIGN_HISTORY,
  xeroDate,
  documentsFrom,
  neverPosted,
  needsHistoryCheck,
  historyShowsLedgerChange,
  summariseChanges,
};

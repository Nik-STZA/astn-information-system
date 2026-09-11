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
// Blind spot, stated rather than hidden: entries Xero creates with no document
// behind them (fixed-asset depreciation, FX revaluation, conversion balances)
// do not appear here. The lock dates narrow it: a locked period cannot change
// without someone moving the lock.

// Xero resource -> the collection key in its response, whether it pages, and a
// label for people.
const LEDGER_DOCUMENTS = {
  "/Invoices": { key: "Invoices", paged: true, label: "invoices and bills" },
  "/CreditNotes": { key: "CreditNotes", paged: true, label: "credit notes" },
  "/BankTransactions": { key: "BankTransactions", paged: true, label: "bank transactions" },
  "/ManualJournals": { key: "ManualJournals", paged: true, label: "manual journals" },
  "/Payments": { key: "Payments", paged: true, label: "payments" },
  "/BankTransfers": { key: "BankTransfers", paged: false, label: "bank transfers" },
};

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

// One Xero response -> the changed documents in it, as { label, date, status }.
function documentsFrom(resource, payload) {
  const spec = LEDGER_DOCUMENTS[resource];
  if (!spec) return [];
  return (payload?.[spec.key] ?? []).map((d) => ({
    label: spec.label,
    date: d.Date ?? d.DateString ?? null,
    status: d.Status ?? null,
  }));
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

module.exports = { LEDGER_DOCUMENTS, xeroDate, documentsFrom, summariseChanges };

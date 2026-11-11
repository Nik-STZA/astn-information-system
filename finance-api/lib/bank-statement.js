// Bank statements on a bank reconciliation (11 Nov 2026).
//
// A person uploads the bank's own export (CSV or Excel) for a bank account.
// This reads it into lines with a running balance, then sets it against what
// Xero holds for the same account:
//
//   1. The agreed point: the latest day, up to the month end, on which the
//      statement's balance equals Xero's ledger balance for the account.
//      Everything up to that day is proved. Nobody has to know in advance how
//      far back a gap goes: the files say.
//   2. After that day, each statement line is matched to a Xero item by amount
//      and date (within a few days). What is left are the reconciling items:
//      on the statement but not in Xero, or in Xero but not on the statement.
//
// Then: statement balance at the month end + items in Xero only - items on the
// statement only = the ledger. The rec carries those items until they clear.
//
// Everything that decides a number lives here and is tested. The route only
// fetches and stores. Amounts are in pence, money into the account positive.
// One currency only: the account's. Foreign currency accounts come later.

const MATCH_DAYS = 4;
const TIMING_DAYS = 7;
const MIN_FIT = 0.9;

// ── Reading cells ────────────────────────────────────────────────────────────

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
};

// A cell as a date, YYYY-MM-DD, or null. `order` is "dmy" (UK, the default)
// or "mdy" for slashed dates.
function dateOf(v, order = "dmy") {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(s);
  if (m) return order === "mdy" ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[A-Za-z]*[\s-,]*(\d{2}|\d{4})\b/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([A-Za-z]{3,4})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

// Whether a column's slashed dates are month first: only when a middle part
// is over 12 and no first part is.
function slashOrder(values) {
  let firstBig = false, secondBig = false;
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(String(v ?? "").trim());
    if (!m) continue;
    if (+m[1] > 12) firstBig = true;
    if (+m[2] > 12) secondBig = true;
  }
  return secondBig && !firstBig ? "mdy" : "dmy";
}

// A cell as an amount in pence, or null when blank or not a number.
// "(12.50)", "-12.50", "12.50 DR" are negative; "£1,234.56" and "1234.56 CR" positive.
function penceOf(v) {
  let s = String(v ?? "").trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bDR$/i.test(s)) { sign = -sign; s = s.replace(/\s*DR$/i, ""); }
  s = s.replace(/\s*CR$/i, "");
  s = s.replace(/[£$€\s,]/g, "").replace(/^[A-Z]{3}/, "").replace(/[A-Z]{3}$/, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

// ── Finding the columns ──────────────────────────────────────────────────────

const HEAD = {
  completed: /^(date completed|completed date|completed)\b/,
  date: /^(transaction date|posting date|posted date|booking date|value date|date)\b|\bdate\b/,
  description: /^(description|details|narrative|transaction description|payee|merchant|counterparty|name)\b/,
  reference: /^(reference|memo|transaction reference)\b/,
  amount: /^(amount|value|transaction amount)\b/,
  total: /^total amount\b/,
  paid_in: /^(paid in|money in|credit|credits|deposits?|in)\b/,
  paid_out: /^(paid out|money out|debit|debits|withdrawals?|out)\b/,
  balance: /^(running balance|balance)\b/,
  fee: /^fees?\b/,
  state: /^(state|status)\b/,
  currency: /^(currency|payment currency)\b/,
};

// The header row and which column holds what, or null.
function findColumns(rows) {
  for (const r of rows.slice(0, 40)) {
    const heads = r.cells.map((c) => String(c ?? "").trim().toLowerCase());
    const find = (re, not = []) => heads.findIndex((h, i) => re.test(h) && !not.includes(i));
    const col = {};
    col.balance = find(HEAD.balance);
    if (col.balance < 0) continue;
    col.date = find(HEAD.completed);
    if (col.date < 0) col.date = find(HEAD.date);
    if (col.date < 0) continue;
    col.total = find(HEAD.total);
    col.amount = find(HEAD.amount, [col.total]);
    col.paid_in = find(HEAD.paid_in);
    col.paid_out = find(HEAD.paid_out);
    if (col.amount < 0 && col.total < 0 && (col.paid_in < 0 || col.paid_out < 0)) continue;
    col.fee = find(HEAD.fee);
    col.state = find(HEAD.state);
    col.currency = find(HEAD.currency);
    col.description = find(HEAD.description);
    col.reference = find(HEAD.reference);
    return { header_row: r.row, col, heads };
  }
  return null;
}

// How a line's amount can be read: each way is tried against the running
// balance, and the one that follows it best is taken.
function amountWays(col) {
  const at = (cells, i) => (i >= 0 ? penceOf(cells[i]) : null);
  const ways = [];
  if (col.total >= 0) ways.push({ name: "total amount", read: (c) => at(c, col.total) });
  if (col.amount >= 0) ways.push({ name: "amount", read: (c) => at(c, col.amount) });
  if (col.amount >= 0 && col.fee >= 0) ways.push({ name: "amount less fee", read: (c) => { const a = at(c, col.amount); return a === null ? null : a - Math.abs(at(c, col.fee) ?? 0); } });
  if (col.paid_in >= 0 && col.paid_out >= 0) {
    ways.push({ name: "paid in less paid out", read: (c) => { const i = at(c, col.paid_in), o = at(c, col.paid_out); return i === null && o === null ? null : (i ?? 0) - Math.abs(o ?? 0); } });
  }
  return ways;
}

// Of a run of lines in order, how many follow the running balance.
function fitOf(lines) {
  let tried = 0, fits = 0;
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (a.balance === null || b.balance === null || b.amount === null) continue;
    tried += 1;
    if (b.balance - a.balance === b.amount) fits += 1;
  }
  return { tried, fits };
}

const SKIP_STATE = /declined|reverted|revert|failed|pending|cancel|reject/i;

// Reads the sheets of a bank export into lines, oldest first.
// Returns { lines, issues, said, read } where issues stop the upload and
// `read` says which columns were used.
function readStatement(sheets) {
  const issues = [], said = [];
  for (const s of sheets || []) {
    const found = findColumns(s.rows);
    if (!found) continue;
    const { col, header_row: headerRow, heads } = found;
    const body = s.rows.filter((r) => r.row > headerRow);
    const order = slashOrder(body.map((r) => r.cells[col.date]));
    let skipped = 0;
    const raw = [];
    for (const r of body) {
      if (col.state >= 0 && SKIP_STATE.test(String(r.cells[col.state] ?? ""))) { skipped += 1; continue; }
      const date = dateOf(r.cells[col.date], order);
      if (!date) continue;
      const text = [col.description, col.reference].filter((i) => i >= 0).map((i) => String(r.cells[i] ?? "").trim()).filter(Boolean);
      raw.push({ row: r.row, date, description: [...new Set(text)].join(" · ").slice(0, 300) || null, cells: r.cells, balance: penceOf(r.cells[col.balance]) });
    }
    if (!raw.length) continue;
    // Which way to read amounts, and which way the file runs: the pair that
    // follows the running balance best.
    let best = null;
    for (const way of amountWays(col)) {
      const lines = raw.map((x) => ({ row: x.row, date: x.date, description: x.description, amount: way.read(x.cells), balance: x.balance }));
      for (const dir of ["as_is", "reversed"]) {
        const run = dir === "as_is" ? lines : [...lines].reverse();
        const f = fitOf(run);
        const score = f.tried ? f.fits / f.tried : 0;
        if (!best || score > best.score || (score === best.score && f.tried > best.tried)) best = { way, dir, run, score, tried: f.tried };
      }
    }
    if (!best || best.tried === 0) {
      issues.push("The running balance could not be followed: the file needs a balance on each line");
      return { lines: [], issues, said, read: null };
    }
    if (best.score < MIN_FIT) {
      issues.push(`The amounts follow the running balance on only ${Math.round(best.score * 100)}% of lines, so the file cannot be relied on. Export it again with every transaction and the balance column`);
      return { lines: [], issues, said, read: null };
    }
    // Oldest first; within a day the file's own order (as read) is kept.
    const lines = best.run.filter((l) => l.amount !== null);
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].date < lines[i - 1].date) {
        issues.push("The lines are not in date order, so the running balance cannot be trusted. Export the file sorted by date");
        return { lines: [], issues, said, read: null };
      }
    }
    if (skipped) said.push(`${skipped} declined, reverted or pending line${skipped === 1 ? " was" : "s were"} left out`);
    if (best.score < 1) said.push(`${best.tried - Math.round(best.score * best.tried)} line${best.tried - Math.round(best.score * best.tried) === 1 ? "" : "s"} did not follow the running balance`);
    const currencies = col.currency >= 0 ? [...new Set(raw.map((x) => String(x.cells[col.currency] ?? "").trim().toUpperCase()).filter(Boolean))] : [];
    return {
      lines, issues, said,
      read: {
        sheet: s.name, header_row: headerRow, amount: best.way.name, date: heads[col.date], newest_first: best.dir === "reversed",
        currencies, fit: Math.round(best.score * 1000) / 10,
      },
    };
  }
  issues.push("No columns for a date, an amount and a running balance were found. Use the bank's transaction export (CSV or Excel) with its balance column");
  return { lines: [], issues, said, read: null };
}

// The statement balance at the end of a day, in pence, or null when the file
// does not reach back that far.
function balanceAt(lines, date) {
  let out = null;
  for (const l of lines) {
    if (l.date > date) break;
    if (l.balance !== null) out = l.balance;
  }
  if (out !== null) return out;
  const first = lines.find((l) => l.balance !== null);
  if (first && date < first.date) return first.balance - first.amount;
  return null;
}

// ── Xero's side ──────────────────────────────────────────────────────────────

const xeroDay = (s) => {
  if (s === null || s === undefined || s === "") return null;
  const ms = /^\/Date\((-?\d+)/.exec(String(s));
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  const m = /(\d{4}-\d{2}-\d{2})/.exec(String(s));
  return m ? m[1] : null;
};
const pence = (v) => Math.round(Number(v) * 100);

const PAYMENT_IN = new Set(["ACCRECPAYMENT", "APCREDITPAYMENT", "APOVERPAYMENTPAYMENT", "APPREPAYMENTPAYMENT"]);
const PAYMENT_OUT = new Set(["ACCPAYPAYMENT", "ARCREDITPAYMENT", "AROVERPAYMENTPAYMENT", "ARPREPAYMENTPAYMENT"]);

// What Xero holds on one bank account, as items like statement lines:
// spend and receive money (transfers included), and payments of bills and
// invoices. Payments made together in a batch are one item, as they are one
// line on the statement.
function xeroItems({ bankTransactions = [], payments = [], accountId }) {
  const out = [];
  for (const t of bankTransactions) {
    if (t.Status !== "AUTHORISED") continue;
    if (accountId && t.BankAccount?.AccountID && t.BankAccount.AccountID !== accountId) continue;
    const sign = String(t.Type).startsWith("RECEIVE") ? 1 : -1;
    const who = t.Contact?.Name ?? null;
    const what = t.Reference || t.LineItems?.[0]?.Description || null;
    out.push({
      key: `bt:${t.BankTransactionID}`, kind: "bank_transaction", date: xeroDay(t.DateString ?? t.Date), amount: sign * pence(t.Total),
      description: [who, what].filter(Boolean).join(" · ").slice(0, 300) || t.Type, type: t.Type, reconciled: Boolean(t.IsReconciled),
    });
  }
  const batches = new Map();
  for (const p of payments) {
    if (p.Status && p.Status !== "AUTHORISED") continue;
    if (accountId && p.Account?.AccountID !== accountId) continue;
    const sign = PAYMENT_IN.has(p.PaymentType) ? 1 : PAYMENT_OUT.has(p.PaymentType) ? -1 : null;
    if (sign === null) continue;
    const amount = sign * pence(p.BankAmount ?? p.Amount);
    const date = xeroDay(p.DateString ?? p.Date);
    const batch = p.BatchPayment?.BatchPaymentID ?? p.BatchPaymentID ?? null;
    const description = [p.Invoice?.Contact?.Name, p.Invoice?.InvoiceNumber, p.Reference].filter(Boolean).join(" · ").slice(0, 300) || p.PaymentType;
    if (batch) {
      const b = batches.get(batch) ?? { key: `batch:${batch}`, kind: "batch_payment", date, amount: 0, count: 0, description: "", type: "BATCH", reconciled: Boolean(p.IsReconciled) };
      b.amount += amount;
      b.count += 1;
      b.description = `Batch payment of ${b.count}`;
      batches.set(batch, b);
    } else {
      out.push({ key: `pay:${p.PaymentID}`, kind: "payment", date, amount, description, type: p.PaymentType, reconciled: Boolean(p.IsReconciled) });
    }
  }
  out.push(...batches.values());
  return out.filter((x) => x.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ── Setting one against the other ────────────────────────────────────────────

// "28 Sep 2026", the house date style, for what is said to people.
const nice = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "nowhere");

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysApart = (a, b) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

// The latest day, up to the month end, on which the statement and the ledger
// agree. The ledger on a day is the month-end ledger less Xero's items after
// that day. Returns { date, balance } or null.
//   ledgerEnd  the account's ledger balance at the month end, in pence
function agreedPoint({ lines, items, ledgerEnd, periodEnd }) {
  if (!lines.length) return null;
  const firstDate = lines[0].date;
  const days = new Set([periodEnd, addDays(firstDate, -1)]);
  for (const l of lines) if (l.date <= periodEnd) days.add(l.date);
  const sorted = [...days].filter((d) => d <= periodEnd).sort().reverse();
  const within = items.filter((x) => x.date <= periodEnd).sort((a, b) => (a.date < b.date ? 1 : -1));
  let after = 0, k = 0;
  for (const d of sorted) {
    while (k < within.length && within[k].date > d) { after += within[k].amount; k += 1; }
    const s = balanceAt(lines, d);
    if (s !== null && s === ledgerEnd - after) return { date: d, balance: s };
  }
  return null;
}

// Matches the statement's lines after the agreed day to Xero's items after it,
// by amount and the nearest date within MATCH_DAYS.
function matchAfter({ lines, items, from, periodEnd, days = MATCH_DAYS }) {
  const start = from ?? addDays(lines[0]?.date ?? periodEnd, -1);
  const bank = lines.filter((l) => l.date > start && l.date <= periodEnd);
  const xero = items.filter((x) => x.date > start && x.date <= periodEnd).map((x) => ({ ...x, used: false }));
  const matched = [], bankOnly = [];
  for (const l of bank) {
    let pick = null;
    for (const x of xero) {
      if (x.used || x.amount !== l.amount) continue;
      const gap = daysApart(x.date, l.date);
      if (gap > days) continue;
      if (!pick || gap < pick.gap) pick = { x, gap };
    }
    if (pick) { pick.x.used = true; matched.push({ line: l, item: pick.x }); }
    else bankOnly.push(l);
  }
  const xeroOnly = xero.filter((x) => !x.used).map(({ used, ...x }) => x);
  return { matched, bankOnly, xeroOnly, from: start };
}

// The whole comparison for one account. Returns what the rec needs:
//   statement_balance  at the month end
//   agreed             { date, balance } or null
//   items              reconciling items to hold: { side, kind, txn_date, description, amount, statement_row, xero_ref }
//   check              statement + xero_only - bank_only - ledger (nil when it all holds)
//   said               plain sentences for the person
function compare({ lines, items, ledgerEnd, periodEnd }) {
  const said = [];
  const statementBalance = balanceAt(lines, periodEnd);
  const last = lines[lines.length - 1];
  if (last && last.date < periodEnd.slice(0, 7) + "-01") said.push(`The statement's last line is ${nice(last.date)}, before this month: if anything moved since, export to the month end`);
  const agreed = agreedPoint({ lines, items, ledgerEnd, periodEnd });
  const m = matchAfter({ lines, items, from: agreed?.date ?? null, periodEnd });
  const held = [
    ...m.bankOnly.map((l) => ({ side: "bank_only", kind: "unreconciled", txn_date: l.date, description: l.description, amount: l.amount, statement_row: l.row, xero_ref: null })),
    ...m.xeroOnly.map((x) => ({
      side: "xero_only", kind: x.date >= addDays(periodEnd, -TIMING_DAYS) ? "timing" : "error",
      txn_date: x.date, description: x.description, amount: x.amount, statement_row: null, xero_ref: x.key,
    })),
  ];
  const effect = held.reduce((a, h) => a + (h.side === "xero_only" ? h.amount : -h.amount), 0);
  const check = statementBalance === null ? null : statementBalance + effect - ledgerEnd;
  if (agreed) {
    said.push(agreed.date === periodEnd
      ? "The statement and Xero agree at the month end."
      : `The statement and Xero last agreed on ${nice(agreed.date)}. ${m.matched.length} line${m.matched.length === 1 ? "" : "s"} since then matched Xero; ${held.length} did not.`);
  } else {
    said.push(`The statement and Xero do not agree on any day in this file (it starts ${nice(lines[0]?.date)}). The gap is older than the file: export from earlier.`);
    if (check) said.push(`Before the file starts there is a difference of ${(check / 100).toFixed(2)} that the lines in it cannot explain.`);
  }
  return { statement_balance: statementBalance, agreed, items: held, matched: m.matched.length, check, said };
}

// The effect of a reconciling item on the support for the ledger, in pence:
// in Xero only adds to the statement balance; on the statement only takes away.
const itemEffect = (it) => (it.side === "xero_only" ? 1 : -1) * pence(it.amount);

module.exports = {
  MATCH_DAYS, TIMING_DAYS, dateOf, slashOrder, penceOf, findColumns, readStatement, balanceAt, xeroItems, agreedPoint, matchAfter, compare, itemEffect, xeroDay, nice,
};

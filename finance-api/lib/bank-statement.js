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
  const matched = [];
  for (const l of bank) {
    let pick = null;
    for (const x of xero) {
      if (x.used || x.amount !== l.amount) continue;
      const gap = daysApart(x.date, l.date);
      if (gap > days) continue;
      if (!pick || gap < pick.gap) pick = { x, gap };
    }
    if (pick) { pick.x.used = true; l.used = true; matched.push({ line: l, item: pick.x }); }
  }
  // Then one to several, each way. Revolut shows a card payment and its fee as
  // one line where Xero holds two (the charge, and "revolut" for the fee), and
  // a batch payment in Xero can sit beside separate items on one bank line.
  // Seen on 11 Nov 2026: without this, 104 of 566 lines on one account stood
  // as differences that were the same money.
  const left = bank.filter((l) => !l.used);
  for (const l of left) {
    const group = groupFor(l, xero.filter((x) => !x.used), GROUP_DAYS);
    if (group) { for (const x of group) x.used = true; l.used = true; matched.push({ line: l, items: group }); }
  }
  for (const x of xero.filter((y) => !y.used)) {
    const group = groupFor(x, bank.filter((l) => !l.used), GROUP_DAYS);
    if (group) { for (const l of group) l.used = true; x.used = true; matched.push({ lines: group, item: x }); }
  }
  // Entries on one side that cancel each other on the same day (Revolut's
  // account clearing in Xero, a charge and its reversal) stand for nothing.
  const cancelled = [];
  for (const side of [bank, xero]) {
    const open = side.filter((v) => !v.used);
    for (const a of open) {
      if (a.used) continue;
      const b = open.find((v) => v !== a && !v.used && v.date === a.date && v.amount === -a.amount);
      if (b) { a.used = true; b.used = true; cancelled.push([a, b]); }
    }
  }
  // Before calling anything a near match: other Xero entries on the same day
  // as the nearest one may make up the bank amount, either way round. Seen on
  // 13 Nov 2026: a batch payment of 302.71 and a 2.02 receipt in Xero against
  // one bank line of 300.69.
  for (const l of bank.filter((v) => !v.used)) {
    let pick = null;
    for (const x of xero) {
      if (x.used || Math.sign(x.amount) !== Math.sign(l.amount)) continue;
      const diff = Math.abs(x.amount - l.amount);
      if (diff === 0 || diff > Math.max(NEAR_PENCE, Math.round(Math.abs(l.amount) * NEAR_SHARE))) continue;
      const gap = daysApart(x.date, l.date);
      if (gap > days) continue;
      const extra = offsetsFor(l.amount - x.amount, xero.filter((y) => !y.used && y !== x && (y.date === x.date || y.date === l.date)));
      if (extra && (!pick || gap < pick.gap)) pick = { set: [x, ...extra], gap };
    }
    if (pick) { for (const x of pick.set) x.used = true; l.used = true; matched.push({ line: l, items: pick.set }); }
  }
  // Last, the same payment at a slightly different amount: a card payment in
  // another currency entered at a different rate, a fee left out. They become
  // one item, the difference, rather than two that look unrelated.
  const near = [];
  for (const l of bank.filter((v) => !v.used)) {
    let pick = null;
    for (const x of xero) {
      if (x.used || Math.sign(x.amount) !== Math.sign(l.amount)) continue;
      const diff = Math.abs(x.amount - l.amount);
      if (diff > Math.max(NEAR_PENCE, Math.round(Math.abs(l.amount) * NEAR_SHARE))) continue;
      const gap = daysApart(x.date, l.date);
      if (gap > days) continue;
      if (!pick || diff < pick.diff || (diff === pick.diff && gap < pick.gap)) pick = { x, diff, gap };
    }
    if (pick) { pick.x.used = true; l.used = true; near.push({ line: l, item: pick.x }); }
  }
  const bankOnly = bank.filter((l) => !l.used).map(({ used, ...l }) => l);
  const xeroOnly = xero.filter((x) => !x.used).map(({ used, ...x }) => x);
  for (const l of bank) delete l.used;
  return { matched, near, cancelled, bankOnly, xeroOnly, from: start };
}

// How close a near match must be: within 2% of the line, or 50p on a small one.
const NEAR_PENCE = 50;
const NEAR_SHARE = 0.02;

// Two to MAX_GROUP of `pool`, on the same side of nil as `one` and within
// `days` of it, that add up to it exactly. The nearest in date are tried
// first, and the set nearest in date wins. Null when none do.
const MAX_GROUP = 4;
const GROUP_DAYS = 1;
const MAX_TRIED = 14;
function groupFor(one, pool, days) {
  const sign = Math.sign(one.amount);
  const near = pool
    .filter((p) => Math.sign(p.amount) === sign && Math.abs(p.amount) < Math.abs(one.amount) && daysApart(p.date, one.date) <= days)
    .map((p) => ({ p, gap: daysApart(p.date, one.date) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, MAX_TRIED);
  let best = null;
  const walk = (start, chosen, sum, gap) => {
    if (chosen.length >= 2 && sum === one.amount) {
      if (!best || gap < best.gap || (gap === best.gap && chosen.length < best.set.length)) best = { set: [...chosen], gap };
      return;
    }
    if (chosen.length === MAX_GROUP) return;
    for (let i = start; i < near.length; i++) {
      const next = sum + near[i].p.amount;
      if (Math.abs(next) > Math.abs(one.amount)) continue;
      chosen.push(near[i].p);
      walk(i + 1, chosen, next, gap + near[i].gap);
      chosen.pop();
    }
  };
  walk(0, [], 0, 0);
  return best ? best.set : null;
}

// One to MAX_OFFSETS of `pool`, of either sign, adding up to `needed` exactly;
// the fewest that do. Null when none do.
const MAX_OFFSETS = 3;
function offsetsFor(needed, pool) {
  const some = pool.slice(0, MAX_TRIED);
  let best = null;
  const walk = (start, chosen, sum) => {
    if (chosen.length && sum === needed) {
      if (!best || chosen.length < best.length) best = [...chosen];
      return;
    }
    if (chosen.length === MAX_OFFSETS) return;
    for (let i = start; i < some.length; i++) {
      chosen.push(some[i]);
      walk(i + 1, chosen, sum + some[i].amount);
      chosen.pop();
    }
  };
  walk(0, [], 0);
  return best;
}

// ── Xero's own balances ──────────────────────────────────────────────────────

// The days on which Xero's balance for the account is read: the day before the
// file starts, each month end in the file, and the month end of the rec.
function balanceDays(lines, periodEnd) {
  if (!lines.length) return [];
  const out = [addDays(lines[0].date, -1)];
  let d = lines[0].date;
  for (;;) {
    const [y, m] = d.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (end >= periodEnd) break;
    out.push(end);
    d = addDays(end, 1);
  }
  out.push(periodEnd);
  return [...new Set(out)];
}

// One account's closing balance, in pence, from Xero's Bank Summary report
// (the report's ToDate is the day). Null when the account is not in it.
function bankSummaryClosing(report, accountId, accountName) {
  const rows = report?.Reports?.[0]?.Rows ?? [];
  const flat = rows.flatMap((r) => (r.Rows ? r.Rows : [r]));
  const header = rows.find((r) => r.RowType === "Header")?.Cells?.map((c) => String(c.Value ?? "")) ?? [];
  let col = header.findIndex((h) => /closing/i.test(h));
  for (const r of flat) {
    if (r.RowType !== "Row" || !r.Cells?.length) continue;
    const first = r.Cells[0];
    const id = (first.Attributes ?? []).find((a) => /account/i.test(a.Id ?? ""))?.Value;
    if (!(accountId && id === accountId) && !(accountName && String(first.Value).trim() === accountName)) continue;
    if (col < 0) col = r.Cells.length - 1;
    const v = penceOf(r.Cells[col]?.Value);
    return v;
  }
  return null;
}

// Statement less Xero at a day end, in pence. Xero's own balance when it was
// read for that day; otherwise the month-end ledger less Xero's items after it.
function gapAt({ lines, items, ledgerEnd, periodEnd, xeroBalances }, date) {
  const s = balanceAt(lines, date);
  if (s === null) return null;
  if (xeroBalances && xeroBalances[date] !== undefined && xeroBalances[date] !== null) return s - xeroBalances[date];
  let after = 0;
  for (const x of items) if (x.date > date && x.date <= periodEnd) after += x.amount;
  return s - (ledgerEnd - after);
}

// How a held item moves the gap (statement less Xero): one in Xero only
// lowers it, one on the statement only raises it.
const moveOf = (h) => (h.side === "xero_only" ? -h.amount : h.amount);

// A near match is a real difference only if the gap between the statement and
// Xero moved by it and stayed moved. Month by month, the Xero money that its
// items do not show (from Xero's own balances) is set against the near
// differences; the fewest that still stand are kept, the rest are only
// noted. Seen on 13 Nov 2026: four near differences (net -0.72) were held as
// errors while Xero sat 10.63 below the statement at every month end.
function testNear(near, ctx, monthEnds) {
  const keep = [], noted = [];
  const ends = [...monthEnds].sort();
  const monthOf = (d) => ends.find((e) => e >= d) ?? null;
  const groups = new Map();
  for (const n of near) {
    const k = monthOf(n.txn_date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  for (const [end, list] of groups) {
    const i = ends.indexOf(end);
    const g1 = end ? gapAt(ctx, end) : null;
    const g0 = i > 0 ? gapAt(ctx, ends[i - 1]) : null;
    if (g0 === null || g1 === null || list.length > 12) { keep.push(...list); continue; }
    // What Xero's items say the gap did this month, less what Xero's own
    // balance says it did, is the Xero money the items do not show. The near
    // differences that stand are those that money does not offset. A payment
    // crossing the month end (bank 31 May, Xero 1 Jun) moves both the same
    // way, so it drops out (seen on 13 Nov 2026: 74.99 across 31 May).
    const byItems = { ...ctx, xeroBalances: null };
    const i0 = gapAt(byItems, ends[i - 1]), i1 = gapAt(byItems, end);
    if (i0 === null || i1 === null) { keep.push(...list); continue; }
    const unseen = (i1 - i0) - (g1 - g0);
    const needed = list.reduce((a, n) => a + moveOf(n), 0) - unseen;
    let best = null;
    for (let mask = 0; mask < 1 << list.length; mask++) {
      let sum = 0, count = 0;
      for (let j = 0; j < list.length; j++) if (mask & (1 << j)) { sum += moveOf(list[j]); count += 1; }
      if (sum === needed && (best === null || count < best.count)) best = { mask, count };
    }
    if (best === null) { keep.push(...list); continue; }
    list.forEach((n, j) => (best.mask & (1 << j) ? keep : noted).push(n));
  }
  return { keep, noted };
}

// The whole comparison for one account. Returns what the rec needs:
//   statement_balance  at the month end
//   agreed             { date, balance } or null
//   items              reconciling items to hold: { side, kind, txn_date, description, amount, statement_row, xero_ref }
//   check              statement + xero_only - bank_only - ledger (nil when it all holds)
//   said               plain sentences for the person
//   before_file        { date, statement, xero, difference, from_xero } on the
//                      day before the file starts, or null
//   noted              near differences not held, because Xero's balance shows
//                      them offset in the same month
//   xeroBalances       optional { "YYYY-MM-DD": pence } read from Xero for the
//                      days balanceDays gives; without it the ledger on a day is
//                      worked back from the items
function compare({ lines, items, ledgerEnd, periodEnd, xeroBalances = null }) {
  const said = [];
  const ctx = { lines, items, ledgerEnd, periodEnd, xeroBalances };
  const statementBalance = balanceAt(lines, periodEnd);
  const last = lines[lines.length - 1];
  if (last && last.date < periodEnd.slice(0, 7) + "-01") said.push(`The statement's last line is ${nice(last.date)}, before this month: if anything moved since, export to the month end`);
  const agreed = agreedPoint({ lines, items, ledgerEnd, periodEnd });
  const m = matchAfter({ lines, items, from: agreed?.date ?? null, periodEnd });
  const others = [
    ...m.bankOnly.map((l) => ({ side: "bank_only", kind: "unreconciled", txn_date: l.date, description: l.description, amount: l.amount, statement_row: l.row, xero_ref: null })),
    ...m.xeroOnly.map((x) => ({
      side: "xero_only", kind: x.date >= addDays(periodEnd, -TIMING_DAYS) ? "timing" : "error",
      txn_date: x.date, description: x.description, amount: x.amount, statement_row: null, xero_ref: x.key,
    })),
  ];
  // A near match is held as one item, the difference: in Xero less on the
  // statement, so it moves the bridge exactly as the pair would.
  const nearItems = m.near.map(({ line, item }) => ({
    side: "xero_only", kind: "error", txn_date: line.date,
    description: `${item.description ?? "Xero"} - bank ${(line.amount / 100).toFixed(2)}, Xero ${(item.amount / 100).toFixed(2)}`.slice(0, 300),
    amount: item.amount - line.amount, statement_row: line.row, xero_ref: item.key,
  }));
  const ends = balanceDays(lines, periodEnd).filter((d) => !agreed || d >= agreed.date);
  if (agreed && !ends.includes(agreed.date)) ends.unshift(agreed.date);
  const tested = testNear(nearItems, ctx, ends);
  const held = [...tested.keep, ...others];
  const effect = held.reduce((a, h) => a + (h.side === "xero_only" ? h.amount : -h.amount), 0);
  const check = statementBalance === null ? null : statementBalance + effect - ledgerEnd;

  // Before the file starts: the statement's opening balance less Xero's
  // balance on the day before, read directly, never a residual.
  let beforeFile = null;
  if (lines.length) {
    const day = addDays(lines[0].date, -1);
    const statement = balanceAt(lines, day);
    const fromXero = Boolean(xeroBalances && xeroBalances[day] !== undefined && xeroBalances[day] !== null);
    const gap = gapAt(ctx, day);
    if (statement !== null && gap !== null) beforeFile = { date: day, statement, xero: statement - gap, difference: gap, from_xero: fromXero };
  }

  if (agreed) {
    said.push(agreed.date === periodEnd
      ? "The statement and Xero agree at the month end."
      : `The statement and Xero last agreed on ${nice(agreed.date)}. ${m.matched.length} line${m.matched.length === 1 ? "" : "s"} since then matched Xero; ${held.length} did not.`);
  } else {
    said.push(`The statement and Xero do not agree on any day in this file (it starts ${nice(lines[0]?.date)}). The gap is older than the file.`);
    if (beforeFile && beforeFile.difference) {
      said.push(`On ${nice(beforeFile.date)}, before the file starts, the statement shows ${(beforeFile.statement / 100).toFixed(2)} and Xero ${(beforeFile.xero / 100).toFixed(2)}${beforeFile.from_xero ? "" : " (worked back from Xero's items)"}: a difference of ${(beforeFile.difference / 100).toFixed(2)}.`);
    }
    const rest = check === null || !beforeFile ? null : check - beforeFile.difference;
    if (rest) said.push(`A further ${(rest / 100).toFixed(2)} is not explained by the difference before the file or the items held.`);
  }
  if (tested.keep.length) said.push(`${tested.keep.length} ${tested.keep.length === 1 ? "payment is" : "payments are"} in both at slightly different amounts (a rate or a fee), and Xero's balance moved by ${tested.keep.length === 1 ? "it" : "them"}: each is held as its difference.`);
  if (tested.noted.length) {
    said.push(`${tested.noted.length} small difference${tested.noted.length === 1 ? "" : "s"} between a bank line and its Xero entry ${tested.noted.length === 1 ? "is" : "are"} offset by other Xero entries in the same month (Xero's balance did not move by ${tested.noted.length === 1 ? "it" : "them"}), so only noted: `
      + tested.noted.map((n) => `${nice(n.txn_date)} ${(n.amount / 100).toFixed(2)}`).join(", ") + ".");
  }
  if (m.cancelled.length) said.push(`${m.cancelled.length} pair${m.cancelled.length === 1 ? "" : "s"} of entries cancel out on the same day and are left aside.`);
  return { statement_balance: statementBalance, agreed, items: held, matched: m.matched.length, check, before_file: beforeFile, noted: tested.noted, said };
}

// The effect of a reconciling item on the support for the ledger, in pence:
// in Xero only adds to the statement balance; on the statement only takes away.
const itemEffect = (it) => (it.side === "xero_only" ? 1 : -1) * pence(it.amount);

module.exports = {
  MATCH_DAYS, TIMING_DAYS, dateOf, slashOrder, penceOf, findColumns, readStatement, balanceAt, xeroItems, agreedPoint, matchAfter, compare, itemEffect, xeroDay, nice,
  balanceDays, bankSummaryClosing, gapAt, testNear, offsetsFor,
};

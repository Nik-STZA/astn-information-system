// Balance sheet reconciliations: the decisions, with no network or database, so
// each can be tested. lib/recs-routes.js applies them.
//
// A reconciliation is one GL account for one month across the client's
// companies. The list is composed from the trial balance, not from a list
// someone keeps, so that no balance can be left out: every balance sheet
// account with a balance, and every one that moved in the month and ended at
// zero.
//
// Money is integer pence throughout, as in lib/journal.js.

const { toPence, fromPence, trialBalanceByAccountId } = require("./journal");
const { classify, lineFor } = require("./bs-matrix");

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BALANCE_SHEET_CLASSES = new Set(["ASSET", "LIABILITY", "EQUITY"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isPeriod = (p) => PERIOD.test(String(p ?? ""));
const ymd = (d) => d.toISOString().slice(0, 10);

function monthEnd(period) {
  const m = PERIOD.exec(String(period ?? ""));
  return m ? ymd(new Date(Date.UTC(Number(m[1]), Number(m[2]), 0))) : null;
}

function shiftPeriod(period, by) {
  const m = PERIOD.exec(String(period ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + by, 1));
  return ymd(d).slice(0, 7);
}

const priorPeriod = (period) => shiftPeriod(period, -1);
const nextPeriod = (period) => shiftPeriod(period, 1);

function periodLabel(period) {
  const m = PERIOD.exec(String(period ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(period ?? "");
}

function isDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && ymd(d) === s;
}

// A pound figure from Xero or a numeric column, to pence. Floats from a report
// are rounded here, because they arrive as 12.34 not as a typed value.
const pence = (v) => Math.round(Number(v ?? 0) * 100);
const pounds = (p) => fromPence(p);

// ── The list, composed from the trial balance ────────────────────────────────

// The account name reduced to letters and digits. Companies in a group can
// number the same account differently, so a group rec joins them by name; a
// real typo gives two recs, which is visible, rather than a hidden merge.
const accountKey = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Which group account a line belongs to. The same name across companies joins
// only within a class: an asset and a liability called Deposits are two things.
// A bank account never joins: each is its own account at its own bank.
function lineKey(id, acct, name) {
  if (acct?.Type === "BANK") return `bank:${id}`;
  const flat = accountKey(name);
  return `${String(acct?.Class ?? "unknown").toLowerCase()}:${flat || `id-${id}`}`;
}

// A report with no account rows is a failed read. It must never look like a
// company with nothing on its balance sheet.
const hasRows = (report) => (report?.Rows ?? []).some((s) => (s?.Rows ?? []).some((r) => r?.RowType === "Row"));

// Rows carrying figures but no account id cannot be placed anywhere: they are
// reported, not skipped.
function unidentifiedRows(report) {
  const out = [];
  for (const section of report?.Rows ?? []) {
    for (const row of section?.Rows ?? []) {
      if (row?.RowType !== "Row") continue;
      const cells = row.Cells ?? [];
      if (cells[0]?.Attributes?.some((a) => a.Id === "account")) continue;
      if (cells.slice(1).some((c) => Number(String(c?.Value ?? "").replace(/,/g, "")))) out.push(String(cells[0]?.Value ?? "A row with no name"));
    }
  }
  return out;
}

// One company's accounts needing a rec this month.
//   accounts  Xero's chart
//   closeTb   Xero's trial balance dated the month end
//   openTb    the same, dated the prior month end
// A trial balance dated at a month end gives that month's movement in Debit and
// Credit, and the closing balance of a balance sheet account in the YTD columns.
// The in-month columns matter: an account that went up and came back within the
// month shows no change between the two closings, and still needs a look.
function entityLines({ accounts, closeTb, openTb }) {
  const close = trialBalanceByAccountId(closeTb);
  const open = trialBalanceByAccountId(openTb);
  const byId = new Map((accounts || []).map((a) => [a.AccountID, a]));
  const out = [];
  for (const id of new Set([...Object.keys(close), ...Object.keys(open)])) {
    const acct = byId.get(id);
    // Not in the chart: kept rather than dropped, as a balance nobody can
    // classify is the one that most needs a person to see it.
    if (acct && !BALANCE_SHEET_CLASSES.has(acct.Class)) continue;
    const c = close[id];
    const o = open[id];
    const closing = c ? pence(c.ytdDebit) - pence(c.ytdCredit) : 0;
    const opening = o ? pence(o.ytdDebit) - pence(o.ytdCredit) : 0;
    const turned = c ? pence(c.debit) + pence(c.credit) : 0;
    if (closing === 0 && opening === closing && turned === 0) continue;
    const name = acct?.Name || String(c?.name ?? o?.name ?? "").replace(/\s+\([^)]*\)$/, "") || `Account ${acct?.Code ?? id}`;
    out.push({
      account_id: id, code: acct?.Code ?? null, name, key: lineKey(id, acct, name), odd_name: !accountKey(name),
      opening, closing, movement: closing - opening,
      zero_after_movement: closing === 0,
      chart: acct ?? null,
    });
  }
  return out;
}

// Every company's lines joined into group accounts, with the line of the matrix
// each belongs to. An account Xero or its name cannot place stays unplaced, for
// a person to place; it is listed all the same.
//   entities  [{ id, slug, name, currency, lines }]
// accounts: [{ key, name, line_key, proof, by_entity: [{ entity_id, code, name, currency, opening, closing, movement }] }]
// notes: what a person should know, in words
//
// Two accounts in ONE company can reduce to the same key. Each company has one
// row per rec, so those two must never share a rec: each gets its own, by code.
function composeAccounts(entities) {
  const groups = new Map();
  const notes = new Set();
  for (const e of entities) {
    const seen = new Map();
    for (const l of e.lines) seen.set(l.key, (seen.get(l.key) ?? 0) + 1);
    for (const l of e.lines) {
      const clash = seen.get(l.key) > 1;
      const key = clash ? `${l.key}:${l.code ?? l.account_id}` : l.key;
      const bank = l.key.startsWith("bank:");
      const name = clash ? `${l.name} (${l.code ?? "no code"})` : bank ? `${l.name}: ${e.name}` : l.name;
      if (clash) notes.add(`${e.name} has more than one account named like ${l.name}. Each has its own reconciliation; check they are not duplicates.`);
      if (l.odd_name) notes.add(`${e.name}: the account named "${l.name}" has no letters or digits in its name, so it cannot join other companies.`);
      if (!groups.has(key)) {
        const hit = l.chart ? classify(l.chart) : classify({ Name: l.name });
        const line = hit ? lineFor(hit.key) : null;
        groups.set(key, { key, name, line_key: line?.key ?? null, proof: line?.proof ?? "ledger_review", by_entity: [] });
      }
      groups.get(key).by_entity.push({
        entity_id: e.id, code: l.code, name: l.name, currency: e.currency ?? null, opening: l.opening, closing: l.closing, movement: l.movement,
      });
    }
  }
  return { accounts: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)), notes: [...notes] };
}

// What the matrix puts on a rec. Unplaced: nothing, and a person must place it.
function matrixFields(lineKey) {
  const line = lineFor(lineKey);
  if (!line) return { owner: null, challenge: null, class: null, artefact: null };
  return { owner: line.owner, challenge: line.challenge === "-" ? null : line.challenge, class: line.cls, artefact: line.artefact };
}

// Only Prepayments works end to end for now: the rest are on the list, with
// their status, and their screens say what is still to come.
const workable = (lineKey, proof) => lineKey === "prepay" && proof === "schedule";

// ── The schedule ─────────────────────────────────────────────────────────────

function addMonths(date, n) {
  const [y, m] = date.split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}

// Months and the monthly release, as the existing schedule works them out: the
// days of the service over 30.4375, rounded, and the cost over that. At least
// one month, so a short item still releases.
function releaseProfile(item) {
  const cost = toPence(item.total_cost) ?? pence(item.total_cost);
  if (item.treatment === "held") return { months: 0, monthly: 0, first: null, last: null, cost };
  const days = (Date.parse(item.service_end) - Date.parse(item.service_start)) / 86_400_000;
  const months = Math.max(1, Math.round(days / 30.4375));
  const monthly = Math.round(cost / months);
  const first = String(item.amort_commenced).slice(0, 7);
  return { months, monthly, first, last: addMonths(`${first}-01`, months - 1), cost };
}

// What an item releases in one month. The last month takes what is left, so
// pence lost to rounding cannot sit on the balance sheet after the service ends
// (the spreadsheet left them there).
function releaseIn(item, period) {
  const p = releaseProfile(item);
  if (item.treatment === "held") return 0;
  if (item.ended_period && period >= item.ended_period) return 0;
  if (period < p.first || period > p.last) return 0;
  if (period === p.last) return p.cost - p.monthly * (p.months - 1);
  return p.monthly;
}

// An item at a month end.
function itemAt(item, period) {
  const p = releaseProfile(item);
  const ended = Boolean(item.ended_period && period >= item.ended_period);
  // Not yet paid for: an item dated after this month is not part of it.
  const started = !item.invoice_date || String(item.invoice_date).slice(0, 7) <= period;
  let released = 0;
  if (item.treatment !== "held" && started && period >= p.first) {
    const through = period < p.last ? period : p.last;
    const months = (Number(through.slice(0, 4)) - Number(p.first.slice(0, 4))) * 12
      + Number(through.slice(5, 7)) - Number(p.first.slice(5, 7)) + 1;
    released = through === p.last ? p.cost : p.monthly * months;
  }
  const balance = !started || ended ? 0 : p.cost - released;
  return { months: p.months, monthly: p.monthly, first: p.first, last: p.last, cost: p.cost, released, balance, this_month: started ? releaseIn(item, period) : 0, ended };
}

// Each company's schedule total at a month end, in pence.
function scheduleTotals(items, period) {
  const out = new Map();
  for (const i of items) out.set(i.entity_id, (out.get(i.entity_id) ?? 0) + itemAt(i, period).balance);
  return out;
}

// The months a schedule's columns cover: the earliest release to the latest.
function scheduleMonths(items, period) {
  const firsts = items.filter((i) => i.treatment !== "held").map((i) => releaseProfile(i));
  if (!firsts.length) return [period];
  let from = firsts.map((p) => p.first).sort()[0];
  const to = [...firsts.map((p) => p.last), period].sort().pop();
  const out = [];
  while (from <= to && out.length < 120) { out.push(from); from = nextPeriod(from); }
  return out;
}

function scheduleItemInput(body, { partial = false } = {}) {
  const b = body || {};
  const issues = [];
  const fields = {};
  const text = (k, max, required) => {
    if (b[k] === undefined) { if (required && !partial) issues.push(`${k.replace(/_/g, " ")} is required`); return; }
    const v = b[k] === null ? "" : String(b[k]).trim();
    if (!v) { if (required) issues.push(`${k.replace(/_/g, " ")} is required`); else fields[k] = null; return; }
    if (v.length > max) issues.push(`${k.replace(/_/g, " ")} is over ${max} characters`);
    fields[k] = v;
  };
  const date = (k) => {
    if (b[k] === undefined) return;
    if (b[k] === null || b[k] === "") { fields[k] = null; return; }
    if (!isDate(b[k])) issues.push(`${k.replace(/_/g, " ")} must be a date`);
    else fields[k] = b[k];
  };
  text("supplier", 200, true);
  text("description", 500);
  text("pl_account_code", 20, true);
  text("invoice_ref", 200);
  text("document_ref", 500);
  text("note", 1000);
  date("invoice_date");
  date("service_start");
  date("service_end");
  date("amort_commenced");
  if (b.total_cost !== undefined) {
    const p = toPence(b.total_cost);
    if (p === null) issues.push("total cost must be a money value with at most 2 decimal places");
    else fields.total_cost = pounds(p);
  } else if (!partial) issues.push("total cost is required");
  if (b.treatment !== undefined) {
    if (!["amortise", "held"].includes(b.treatment)) issues.push("treatment must be amortise or held");
    else fields.treatment = b.treatment;
  }
  if (b.ended_period !== undefined) {
    if (b.ended_period === null || b.ended_period === "") fields.ended_period = null;
    else if (!isPeriod(b.ended_period)) issues.push("ended period must be a month (YYYY-MM)");
    else fields.ended_period = b.ended_period;
  }
  if (b.item_no !== undefined) {
    if (!Number.isInteger(b.item_no) || b.item_no < 0) issues.push("item number must be a whole number");
    else fields.item_no = b.item_no;
  }
  return { issues, fields };
}

// The dates an item needs, on the row as it will be saved. An amortised item
// without a start month is given the first of the service start month.
function finishItem(row) {
  const out = { ...row };
  const issues = [];
  if ((out.treatment ?? "amortise") === "amortise") {
    if (!out.service_start) issues.push("service start is required");
    if (!out.service_end) issues.push("service end is required");
    if (out.service_start && out.service_end && out.service_end < out.service_start) issues.push("service end is before service start");
    if (!out.amort_commenced && out.service_start) out.amort_commenced = `${String(out.service_start).slice(0, 7)}-01`;
  }
  return { issues, row: out };
}

// ── Ties ─────────────────────────────────────────────────────────────────────

// Each company's ledger against its support, and the group total.
//   balances  [{ entity_id, closing (pounds) }]
//   support   Map entity id -> pence, or null where the proof has no figure yet
//
// A company with support but no ledger row is on the cover, as a variance: if
// it dropped out, its schedule would vanish from the tie and the group total.
// Companies in different base currencies are not added up. There are no closing
// rates in the platform, so the group total is refused and each company stands
// on its own.
function cover(balances, support, tolerancePence) {
  const byId = new Map(balances.map((b) => [b.entity_id, b]));
  const extra = support ? [...support.keys()].filter((id) => !byId.has(id) && support.get(id) !== 0) : [];
  const rows = [...byId.keys(), ...extra].map((id) => {
    const b = byId.get(id);
    const gl = pence(b?.closing);
    const sch = support ? support.get(id) ?? 0 : null;
    const variance = sch === null ? null : gl - sch;
    return { entity_id: id, gl, schedule: sch, variance, currency: b?.currency ?? null, no_ledger: !b, ties: variance === null ? null : Math.abs(variance) <= tolerancePence };
  });
  const known = rows.every((r) => r.variance !== null);
  const mixed = new Set(rows.map((r) => r.currency).filter(Boolean)).size > 1;
  const gl = rows.reduce((a, r) => a + r.gl, 0);
  const schedule = known ? rows.reduce((a, r) => a + r.schedule, 0) : null;
  return {
    rows,
    group: mixed ? { gl: null, schedule: null, variance: null } : { gl, schedule, variance: known ? gl - schedule : null },
    mixed_currency: mixed,
    ties: known && rows.length > 0 && rows.every((r) => r.ties),
  };
}

// ── Has anything moved since this was prepared? ──────────────────────────────

// The figures a preparer saw, by company.
const snapshotOf = (balances) => Object.fromEntries(balances.map((b) => [b.entity_id, { opening: pence(b.opening), closing: pence(b.closing) }]));

// Plain words for what changed since preparation, or null. A company that
// joined the account, or left it, counts as a change. So does a schedule edit
// that moves this month's figures: months share one schedule, so an edit made
// from a later month reaches back into one already reviewed or signed.
//   priorLabel  the prior month, as words
//   names       Map entity id -> company name
//   items       the schedule now, with period, to compare with what was seen
function recheckReason(snapshot, balances, { priorLabel, names, items, period }) {
  if (!snapshot) return null;
  const said = [];
  const seen = snapshot.balances || {};
  const name = (id) => names.get(id) ?? "A company";
  const money = (p) => Number(pounds(p)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const b of balances) {
    const was = seen[b.entity_id] ?? { opening: 0, closing: 0 };
    const opening = pence(b.opening);
    const closing = pence(b.closing);
    if (opening !== was.opening) said.push(`${name(b.entity_id)}: the ${priorLabel} closing figure moved from ${money(was.opening)} to ${money(opening)} after this was prepared.`);
    else if (closing !== was.closing) said.push(`${name(b.entity_id)}: the ledger moved from ${money(was.closing)} to ${money(closing)} after this was prepared.`);
  }
  const here = new Set(balances.map((b) => b.entity_id));
  for (const [id, was] of Object.entries(seen)) {
    if (!here.has(id) && (was.closing !== 0 || was.opening !== 0)) {
      said.push(`${name(id)}: it held ${money(was.closing)} on this account when prepared, and no longer has the account.`);
    }
  }
  if (items && snapshot.schedule) {
    const before = new Map(snapshot.schedule.map((i) => [i.id, i]));
    const now = new Map(items.map((i) => [i.id, i]));
    for (const id of new Set([...before.keys(), ...now.keys()])) {
      const a = before.get(id);
      const b = now.has(id) ? itemAt(now.get(id), period) : null;
      if ((a?.balance ?? 0) !== (b?.balance ?? 0) || (a?.this_month ?? 0) !== (b?.this_month ?? 0)) {
        said.push(`The schedule changed after this was prepared: ${(now.get(id) ?? a).supplier} moved from ${money(a?.balance ?? 0)} to ${money(b?.balance ?? 0)} at this month end.`);
      }
    }
  }
  return said.length ? said.join(" ") : null;
}

// ── The monthly release journals ─────────────────────────────────────────────

// Xero's API has no route for repeating manual journals: its Accounting API
// offers ManualJournals, Journals and RepeatingInvoices, and no template or
// schedule for a repeating journal. So whether "the repeating journal ran" can
// only be inferred, from the manual journals dated in the month. Everything
// this says about a repeating journal is an inference and is labelled as one.
const INFERRED_NOTE = "Worked out from manual journals in Xero for the month. Xero does not let us read repeating journals, so a missing release could mean the repeating journal ended, or it was never set up.";

// How close to an item's last release we warn, in months.
const END_WARNING_MONTHS = 2;

// For one company and month: which items' releases are in the ledger.
//   items        the company's schedule items
//   journals     Xero manual journals dated in the month, any status, with lines
//   accountCode  the prepayments account in this company
// A release counts when a journal credits the prepayments account and debits
// the item's P&L account. One journal often releases several items, so the
// debits on a P&L account are compared to what its items should release in
// total before being looked for one by one.
function journalChecks({ items, journals, accountCode, period, tolerancePence }) {
  const usable = (journals || []).filter((j) => !["VOIDED", "DELETED"].includes(j.Status));
  const debits = (status) => {
    const out = new Map();
    for (const j of usable) {
      if (status(j) === false) continue;
      const lines = j.JournalLines || [];
      if (!lines.some((l) => String(l.AccountCode) === String(accountCode) && pence(l.LineAmount) < 0)) continue;
      for (const l of lines) {
        const amount = pence(l.LineAmount);
        if (amount <= 0 || String(l.AccountCode) === String(accountCode)) continue;
        const code = String(l.AccountCode);
        if (!out.has(code)) out.set(code, []);
        out.get(code).push({ amount, date: String(j.DateString ?? j.Date ?? "").slice(0, 10), number: j.JournalNumber ?? null, id: j.ManualJournalID ?? null, description: l.Description ?? null });
      }
    }
    return out;
  };
  const posted = debits((j) => j.Status === "POSTED");
  const drafts = debits((j) => j.Status === "DRAFT");

  const due = items.map((i) => ({ item: i, at: itemAt(i, period) })).filter((x) => x.at.this_month > 0);
  const byCode = new Map();
  for (const d of due) {
    const code = String(d.item.pl_account_code);
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(d);
  }

  const results = new Map();
  const used = new Set();
  const sum = (a) => a.reduce((t, x) => t + x, 0);
  const take = (pool, amount) => {
    const at = pool.findIndex((l) => Math.abs(l.amount - amount) <= tolerancePence);
    return at === -1 ? null : pool.splice(at, 1)[0];
  };
  for (const [code, list] of byCode) {
    const lines = [...(posted.get(code) ?? [])];
    const inDraft = [...(drafts.get(code) ?? [])];
    const expected = sum(list.map((d) => d.at.this_month));
    const together = Math.abs(sum(lines.map((l) => l.amount)) - expected) <= tolerancePence;
    if (together) lines.forEach((l) => used.add(l));
    for (const d of list) {
      const hit = together ? lines[0] ?? null : take(lines, d.at.this_month);
      if (hit) {
        used.add(hit);
        results.set(d.item.id, { state: "posted", journal: hit, expected: d.at.this_month, combined: together && list.length > 1 });
        continue;
      }
      const draft = take(inDraft, d.at.this_month);
      results.set(d.item.id, draft
        ? { state: "draft", journal: draft, expected: d.at.this_month }
        : { state: "missing", journal: null, expected: d.at.this_month });
    }
  }

  const warnings = [];
  const shown = items.map((i) => {
    const at = itemAt(i, period);
    const r = results.get(i.id);
    const monthsLeft = i.treatment === "held" || at.ended ? null
      : (Number(at.last.slice(0, 4)) - Number(period.slice(0, 4))) * 12 + Number(at.last.slice(5, 7)) - Number(period.slice(5, 7));
    const ending = monthsLeft !== null && monthsLeft >= 0 && monthsLeft <= END_WARNING_MONTHS;
    if (ending) {
      warnings.push({ item_id: i.id, kind: "ending", text: monthsLeft === 0
        ? `${i.supplier}: this is the last release. Stop the monthly journal in Xero and check whether a renewal is due.`
        : `${i.supplier}: the last release is ${periodLabel(at.last)}. Check the monthly journal ends then, and whether a renewal is due.` });
    }
    return {
      item_id: i.id, supplier: i.supplier, expected: at.this_month, journal: r?.state ?? (at.this_month ? "missing" : "none_due"),
      combined: Boolean(r?.combined), posted_as: r?.journal ?? null, months_left: monthsLeft,
    };
  });

  // Still releasing after an item's last month: nothing on the schedule asked for it.
  for (const i of items) {
    const at = itemAt(i, period);
    if (i.treatment === "held" || at.ended || period <= at.last) continue;
    const late = (posted.get(String(i.pl_account_code)) ?? []).find((l) => !used.has(l) && Math.abs(l.amount - at.monthly) <= tolerancePence);
    if (late) {
      warnings.push({ item_id: i.id, kind: "overrun", text: `${i.supplier}: a release of ${Number(pounds(late.amount)).toLocaleString("en-GB", { minimumFractionDigits: 2 })} posted after the item's last month, ${periodLabel(at.last)}. The monthly journal may still be running.` });
    }
  }

  return {
    inferred: true,
    note: INFERRED_NOTE,
    missing: shown.filter((s) => s.journal === "missing").length,
    in_draft: shown.filter((s) => s.journal === "draft").length,
    items: shown,
    warnings,
  };
}

// ── The monthly release, made here ──────────────────────────────────────────

// os.stza.io does what a repeating journal in Xero would: from the schedule, it
// works out one company's releases for the month, for the items the checks did
// not find in Xero (posted or in draft), so a release already made by hand or
// by an old repeating journal is never made twice.
//   items        the company's schedule items
//   check        that company's journalChecks(...) result
//   accountCode  the prepayments account in this company
// Returns one journal per item due and missing, so one supplier's release can
// be reversed on its own: a debit to the item's P&L account and a credit to the
// prepayments account, dated the month end. An empty list when there is none.
function releaseJournals({ items, check, accountCode, period }) {
  if (!check || check.error || !String(accountCode ?? "").trim()) return [];
  const missing = new Set((check.items ?? []).filter((x) => x.journal === "missing").map((x) => x.item_id));
  const out = [];
  for (const i of items) {
    if (!missing.has(i.id)) continue;
    const at = itemAt(i, period);
    if (at.this_month <= 0) continue;
    const n = (Number(period.slice(0, 4)) - Number(at.first.slice(0, 4))) * 12 + Number(period.slice(5, 7)) - Number(at.first.slice(5, 7)) + 1;
    const label = `${i.supplier}${i.description ? ` ${i.description}` : ""}`.trim().slice(0, 400);
    const amount = Number(pounds(at.this_month));
    const tail = `${i.item_no != null ? ` (item ${i.item_no})` : ""}, ${periodLabel(period)}`;
    out.push({
      item_id: i.id,
      supplier: i.supplier,
      date: monthEnd(period),
      // Short, because it lands in Xero. The supplier is cut, never the month.
      narration: `Prepayment release: ${String(i.supplier).trim().slice(0, MAX_NARRATION - 21 - tail.length)}${tail}`,
      lines: [
        { account_code: String(i.pl_account_code), description: `${label}, release ${n} of ${at.months}`, amount, tax_type: "NONE" },
        { account_code: String(accountCode), description: `${label}, release ${n} of ${at.months}`, amount: -amount, tax_type: "NONE" },
      ],
      total: pounds(at.this_month),
      release: n,
      of: at.months,
      reason: [
        `The monthly release of ${i.supplier}${i.invoice_ref ? `, ${i.invoice_ref}` : ""}, from the prepayments schedule in os.stza.io: release ${n} of ${at.months}.`,
        "Xero did not show this release for the month when the checks ran.",
        "Turn off any repeating journal in Xero for this item, or the month is released twice.",
      ].join(" ").slice(0, 4000),
    });
  }
  return out;
}

// ── Moving a rec along ───────────────────────────────────────────────────────

const STATUS = ["not_started", "in_progress", "with_fc", "with_cfo", "signed_off", "sent_back"];
// The whole role, not a word in it. A qualifier such as Fractional is fine;
// "Assistant to the CFO" is not the CFO.
const CFO_ROLE = /^(?:(?:fractional|interim|group|outsourced)\s+)?(?:cfo|chief financial officer|finance director)$/i;
const REVIEW_ROLE = /^(?:(?:fractional|interim|group|outsourced)\s+)?(?:fc|financial controller|cfo|chief financial officer|finance director)$/i;
const samePerson = (a, b) => Boolean(a && b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Whoever prepared or reviewed a rec, or started the agents that did, is not an
// independent signer. In a small practice that is normal, and the record must
// say so: the balance-sheet-matrix procedure flags it rather than forbids it.
const needsSoleReviewer = (rec, person) => samePerson(rec.prepared_by_person, person) || samePerson(rec.reviewed_by_person, person);

// Who is acting, as the history records it.
const actorOf = (actorEmail, via) => (via?.kind === "agent" ? `agent:${via.agent}` : actorEmail);

// Issues that stop a step. Every step's rule is here, so the routes hold none.
//   rec      the row
//   tied     cover(...).ties
//   via      null for a person; { kind, agent } for an agent or Claude
//   role     the actor's engagement role
//   actor    actorOf(...)
//   person   the email behind the action. An agent acts for the person who
//            started it, and that person answers for what it prepared
//   sole     the CFO says, on the screen, they are the only reviewer
//   note     the note given
//   reads    why the figures cannot be relied on at sign-off
function stepIssues(step, { rec, tied, via, role, actor, person, sole, note, comments, reads = null }) {
  const issues = [];
  const say = (s) => issues.push(s);
  const worked = workable(rec.line_key, rec.proof);
  if (step === "prepare") {
    if (!worked) say("This line cannot be prepared here yet: only Prepayments works end to end.");
    if (!["not_started", "in_progress", "sent_back"].includes(rec.status)) say("This is already with a reviewer");
    if (via && via.agent !== "fm1") say("Only FM1 or a person prepares a reconciliation");
    if (!tied && !String(note ?? "").trim()) say("It does not tie, so say why in the note");
    if (!tied && !(comments ?? false)) say("It does not tie, so each company with a difference needs a comment");
  } else if (step === "review_pass" || step === "review_back") {
    if (rec.status !== "with_fc") say("This is not with the FC for review");
    if (via && via.agent !== "fc") say("Only the FC or a person reviews a reconciliation");
    if (!via && !REVIEW_ROLE.test(String(role ?? ""))) say("Only the FC or the CFO reviews a reconciliation");
    if (!via && samePerson(rec.prepared_by_person, person) && !(sole && CFO_ROLE.test(String(role ?? "")))) {
      say("The preparer cannot review their own reconciliation, unless the CFO marks themselves sole reviewer");
    }
    if (step === "review_back" && !String(note ?? "").trim()) say("Say what needs changing");
  } else if (step === "sign_off") {
    if (via) say("Only a person signs off, in os.stza.io");
    if (!CFO_ROLE.test(String(role ?? ""))) say("Only the CFO signs off");
    if (rec.status !== "with_cfo") say("This has not passed FC review");
    if (rec.recheck_reason) say("A figure moved after this was prepared, so it needs preparing again");
    if (!tied) say("It does not tie. Post the journal in Xero and refresh, or correct the schedule");
    if (!via && needsSoleReviewer(rec, person) && !sole) {
      say("You prepared or reviewed this, or started the agents that did. Tick sole reviewer to sign off: it is recorded and shown on the reconciliation");
    }
    // Null means the read at sign-off never ran, which is a refusal, not a pass.
    if (reads === null) say("The ledger was not read at sign-off, so this cannot be signed off. Try again");
    else issues.push(...reads);
  } else if (step === "send_back") {
    if (via) say("Only a person sends this back, in os.stza.io");
    if (!CFO_ROLE.test(String(role ?? ""))) say("Only the CFO sends a reconciliation back from sign-off");
    if (rec.status !== "with_cfo") say("This has not reached you");
    if (!String(note ?? "").trim()) say("Say what needs changing");
  } else if (step === "reopen") {
    if (via) say("Only a person reopens a reconciliation, in os.stza.io");
    if (!["signed_off", "with_cfo", "with_fc"].includes(rec.status)) say("There is nothing to reopen");
    if (["signed_off", "with_cfo"].includes(rec.status) && !CFO_ROLE.test(String(role ?? ""))) say("Only the CFO reopens a reconciliation that has reached them");
  } else {
    say(`Unknown step ${step}`);
  }
  return issues;
}

// ── Proposed journals ────────────────────────────────────────────────────────

// Short, because it lands in Xero: the reasoning stays in os.stza.io.
const MAX_NARRATION = 120;

// A proposal from an agent, against the rec it fixes.
//   recAccountCode  this company's GL code on the rec
function journalProposalIssues(body, { period, recAccountCode }) {
  const issues = [];
  const b = body || {};
  const narration = String(b.narration ?? "").trim();
  if (!narration) issues.push("narration is required");
  if (narration.length > MAX_NARRATION) issues.push(`keep the narration to ${MAX_NARRATION} characters; the reasoning goes in reason, which stays out of Xero`);
  if (!isDate(b.date)) issues.push("date must be YYYY-MM-DD");
  else if (b.date.slice(0, 7) !== period) issues.push(`the journal must be dated in ${periodLabel(period)}`);
  if (!String(b.reason ?? "").trim()) issues.push("reason is required");
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length < 2) issues.push("at least 2 lines are required");
  let net = 0;
  for (const [i, l] of lines.entries()) {
    if (!l || typeof l !== "object") { issues.push(`line ${i + 1}: is not a journal line`); continue; }
    const p = toPence(l.amount);
    if (p === null || p === 0) issues.push(`line ${i + 1}: amount must be money, and not zero`);
    else net += p;
    if (!String(l.account_code ?? "").trim()) issues.push(`line ${i + 1}: account_code is required`);
  }
  if (net !== 0) issues.push(`the journal does not balance: it is out by ${pounds(Math.abs(net))}`);
  if (!String(recAccountCode ?? "").trim()) issues.push("this company has no ledger account on this reconciliation, so a journal cannot be checked against it");
  else if (!lines.some((l) => String(l?.account_code) === String(recAccountCode))) {
    issues.push(`the journal must touch the account being reconciled (${recAccountCode})`);
  }
  return issues;
}

// True only when a journal is exactly the one approved: same date, narration,
// and the same code and amount on every line.
const amountsKey = (lines) => (Array.isArray(lines) ? lines : [])
  .map((l) => `${String(l?.account_code ?? "").trim()}|${toPence(l?.amount)}`).sort().join(",");
const linesKey = (lines) => (Array.isArray(lines) ? lines : [])
  .map((l) => [String(l?.account_code ?? "").trim(), toPence(l?.amount), String(l?.description ?? "").trim(), l?.tax_type ?? "NONE"].join("|")).sort().join(",");

// Date, narration, codes, and amounts agree. What a model is asked to repeat:
// the runner then sends the stored journal, not what the model typed.
function journalAgrees(approved, input) {
  return String(approved.journal_date).slice(0, 10) === input.date
    && String(approved.narration).trim() === String(input.narration ?? "").trim()
    && amountsKey(approved.lines) === amountsKey(input.lines);
}

// Exactly the stored journal, every line's description and tax type included.
function journalMatches(approved, input) {
  return journalAgrees(approved, input) && linesKey(approved.lines) === linesKey(input.lines);
}

// The key a proposal reaches Xero under. It belongs to the proposal, not to a
// run, so a second run cannot make a second draft.
const recJournalKey = (j) => `rec-journal-${j.id}-${j.attempts ?? 1}`;

// The one gate between a rec and Xero, applied at the journal routes.
//   runId        the agent run asking, if any
//   inRecThread  that run is in a conversation that started on, or proposed on, a rec
//   proposals    this company's proposals for this month, not superseded
//   input        { date, narration, status, lines }
// A journal proposed on a rec reaches Xero only as the run the CFO approved, as
// the exact journal, as a DRAFT. A reply in a chat, whatever its words, is not
// that approval.
//
// Any other caller is held when, for this company:
//   - it sends the same amounts as a live proposal, on any date, or as any
//     proposal for that month, including one superseded or rejected
//   - it touches the rec's GL account in a month with a live proposal, so a
//     changed penny or a split cannot slip round it
// A journal on other accounts is left alone.
function recJournalGate({ runId, inRecThread, proposals, input }) {
  const refuse = (detail) => ({ refuse: detail });
  const mine = runId ? proposals.find((p) => p.approved_run_id === runId && p.state === "approved") : null;
  if (mine) {
    const stop = approvalIssues(mine);
    if (stop) return refuse(stop);
    if ((input.status ?? "DRAFT") !== "DRAFT") return refuse("A journal approved on a reconciliation is created only as a DRAFT.");
    if (!journalMatches(mine, input)) return refuse("This differs from the journal approved on the reconciliation.");
    return { journal: mine, key: recJournalKey(mine) };
  }
  if (inRecThread) return refuse("A journal on a reconciliation is approved on the reconciliation, by the CFO. A reply here does not approve it.");
  const live = (p) => ["proposed", "approved"].includes(p.state);
  const month = String(input.date ?? "").slice(0, 7);
  const inMonth = (p) => String(p.journal_date).slice(0, 7) === month;
  const same = amountsKey(input.lines);
  if (proposals.some((p) => amountsKey(p.lines) === same && (live(p) || inMonth(p)))) {
    return refuse("This journal is proposed on a reconciliation. It is approved there, by the CFO.");
  }
  const codes = new Set((Array.isArray(input.lines) ? input.lines : []).map((l) => String(l?.account_code ?? "").trim()));
  const held = proposals.find((p) => live(p) && inMonth(p) && p.rec_code && codes.has(String(p.rec_code)));
  if (held) return refuse(`Account ${held.rec_code} has a journal waiting on its reconciliation for this month. Decide that one first.`);
  return {};
}

// A run that could still create the journal. An approval goes stale after 30
// minutes (lib/journal.js), so an older run can no longer reach Xero.
const RUN_LIVE_MINUTES = 35;
const runIsLive = (run, now = Date.now()) => Boolean(run) && ["queued", "running"].includes(run.status)
  && now - Date.parse(run.queued_at) < RUN_LIVE_MINUTES * 60_000;

// Whether approving again is safe, from what is known of the last attempt.
//   go       never reached Xero
//   live     a run may still create it
//   drafted  it is in Xero; the record just needs catching up
//   retry    Xero definitely refused it, so a new attempt cannot duplicate it
//   unknown  it may be in Xero: a timeout, a 5xx, or a crash part-way
function retryState({ runLive, post }) {
  if (runLive) return "live";
  if (!post) return "go";
  if (["draft", "posted"].includes(post.outcome)) return "drafted";
  const code = Number(post.http_status);
  if (post.outcome === "failed" && code >= 400 && code < 500 && code !== 408 && code !== 429) return "retry";
  return "unknown";
}

// What the runner tells the agent when a create did not return a draft. Only a
// definite refusal may say nothing was created. A timeout, a 5xx, or a journal
// already in flight can have reached Xero.
function draftFailure(status, body) {
  const http = body?.http_status;
  const refused = (status === 400 || status === 404 || status === 422)
    || (status === 502 && body?.stage === "xero" && http >= 400 && http < 500 && http !== 408 && http !== 429)
    || (status === 200 && http >= 400 && http < 500 && http !== 408 && http !== 429);
  return refused
    ? "Xero or the platform refused the draft. Nothing was created."
    : "This did not finish cleanly, so the draft may be in Xero. Do not try again. Tell the user to check Xero first.";
}

// What stops an approval, whatever the state of the proposal.
function approvalIssues(rec) {
  if (rec.dropped_at) return "This account is no longer on the trial balance for the month.";
  if (rec.status === "signed_off") return "This is signed off. Reopen it first.";
  if (rec.recheck_reason) return "A figure moved after this was prepared. Check it before approving a journal.";
  return null;
}

// The fixed words of a follow-up: they must read as a plain approval to
// lib/draft-approval.js, so the journal goes through the one approval path.
const approvalInstruction = (journalId) => `Approved. Create the draft journal for reconciliation proposal ${journalId}`;

// True for a run started by that approval: it may then create the journal only
// if finance-api still says it is this run's to create.
const namesRecProposal = (instruction) => /reconciliation proposal [0-9a-f-]{36}\b/i.test(String(instruction ?? ""));

// What FM1 is asked when a person starts it on a rec.
function prepareInstruction(rec) {
  return [
    `Prepare the ${rec.account_name} reconciliation for ${periodLabel(rec.period)}. Reconciliation id: ${rec.id}.`,
    "Read the accruals-and-prepayments procedure if it is listed for you, and the balance-sheet-matrix procedure.",
    "Use get_rec, then run_rec_checks. Check every company, and that each item has a document. Add or correct items with save_rec_item.",
    "Find the cause of any difference. If a journal is needed, use propose_rec_journal and show it in your answer under the heading Proposed journal (draft). Do not create it.",
    "Then use submit_rec with a note in plain English, and hand off to fc.",
  ].join(" ");
}

module.exports = {
  STATUS, CFO_ROLE, REVIEW_ROLE, MONTHS, END_WARNING_MONTHS, INFERRED_NOTE, MAX_NARRATION,
  isPeriod, monthEnd, priorPeriod, nextPeriod, periodLabel, pence, pounds,
  accountKey, lineKey, hasRows, unidentifiedRows, entityLines, composeAccounts, matrixFields, workable,
  releaseProfile, releaseIn, itemAt, scheduleTotals, scheduleMonths, scheduleItemInput, finishItem,
  cover, snapshotOf, recheckReason, journalChecks, releaseJournals,
  actorOf, needsSoleReviewer, stepIssues, journalProposalIssues, journalMatches, journalAgrees, amountsKey, draftFailure, recJournalKey, recJournalGate, runIsLive, retryState, approvalIssues, approvalInstruction, namesRecProposal, prepareInstruction,
};

// Accruals (docs/accruals-spec.md, migration 062): agent proposals, the CFO's
// decision on each, the precedents those decisions leave, the schedule of
// accrued items, and the accrual and its reversal as one journal pair. Pure:
// lib/accruals-routes.js reads and writes the rows, every rule is here.
//
// Rules that come from real errors:
//   - The accruals account comes from the CFO's setting or the account on the
//     Accruals rec line, never from code (item 71: a sweep hard-coded 830,
//     Corporation Tax, and posted 28 journals to it).
//   - Net of VAT, TaxType NONE; the reversal is dated the 1st of the next month.
//   - The narration sent to Xero is under 120 characters. Basis, evidence,
//     decision and comments stay in os.stza.io.
//   - Smoothed: a standing item that skipped a month is backfilled into that
//     month, never caught up in this one. A locked month is a finding for the
//     CFO to open (a client rule, CFO 18 Nov 2026).
//   - Precedents are per client. An agent proposes and comments; only the CFO decides.

const { toPence, fromPence } = require("./journal");

const TESTS = ["continuity", "backward", "gap", "forward", "reverse_cutoff"];
const BASIS_KINDS = ["contract", "purchase_order", "last_bill", "estimate"];
const CONFIDENCE = ["high", "medium", "open"];
const DECISIONS = ["accept", "accept_edited", "no_accrual", "question", "standing"];
const APPLIES = ["this_month", "until_changed"];
const LIVE_PAIR = ["proposed", "approved", "draft_created", "posted"];
// Xero's own limit is longer; ours keeps the line readable in Xero's list.
const MAX_NARRATION = 120;
const MAX_TEXT = 4000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isPeriod = (p) => PERIOD.test(String(p ?? ""));
const isDate = (d) => DATE.test(String(d ?? "")) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const blank = (v) => v === undefined || v === null || String(v).trim() === "";

function shift(period, by) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthEnd(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const monthName = (period) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const longDate = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const shortId = (id) => String(id ?? "").slice(0, 8);

// One supplier, however Xero and the agent spell it.
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/\b(limited|ltd|llp|plc|inc)\b/g, " ").replace(/[^a-z0-9]/g, "");
function sameSupplier(a, b) {
  if (a.contact_id && b.contact_id) return a.contact_id === b.contact_id;
  const x = nameKey(a.supplier ?? a.contact_name);
  const y = nameKey(b.supplier ?? b.contact_name);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
}

const sumPence = (lines) => (lines ?? []).reduce((a, l) => a + (toPence(l.amount) ?? 0), 0);

// ── Proposals ────────────────────────────────────────────────────────────────

// A proposal from FM1, a person, or Claude. Every issue at once.
function proposalIssues(body) {
  const b = body || {};
  const issues = [];
  if (blank(b.entity)) issues.push("choose the company");
  if (!isPeriod(b.period)) issues.push("period must be a month (YYYY-MM)");
  if (blank(b.supplier)) issues.push("supplier is required");
  else if (String(b.supplier).length > 200) issues.push("keep the supplier to 200 characters");
  if (!TESTS.includes(b.test)) issues.push(`test must be one of ${TESTS.join(", ")}`);
  if (!BASIS_KINDS.includes(b.basis_kind)) issues.push(`basis kind must be one of ${BASIS_KINDS.join(", ")}`);
  if (blank(b.basis)) issues.push("basis is required: what the amount rests on");
  else if (String(b.basis).length > MAX_TEXT) issues.push(`keep the basis to ${MAX_TEXT} characters`);
  if (!CONFIDENCE.includes(b.confidence)) issues.push(`confidence must be one of ${CONFIDENCE.join(", ")}`);
  for (const k of ["service_from", "service_to"]) if (!blank(b[k]) && !isDate(b[k])) issues.push(`${k.replace("_", " ")} must be a date, YYYY-MM-DD`);
  if (isDate(b.service_from) && isDate(b.service_to) && b.service_to < b.service_from) issues.push("the service ends before it starts");
  if (b.evidence !== undefined && !Array.isArray(b.evidence)) issues.push("evidence must be a list: invoice ids, line numbers, document references");
  if (b.precedent_ids !== undefined && (!Array.isArray(b.precedent_ids) || b.precedent_ids.some((x) => typeof x !== "string"))) issues.push("precedent_ids must be a list of precedent ids");
  if (!blank(b.departs_reason) && String(b.departs_reason).length > MAX_TEXT) issues.push(`keep departs_reason to ${MAX_TEXT} characters`);
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (b.lines !== undefined && !Array.isArray(b.lines)) issues.push("lines must be a list");
  if (b.confidence === "open") {
    if (lines.length) issues.push("an open question carries no amount: it goes to the CFO as a question, never into a journal");
  } else {
    if (!lines.length) issues.push("give at least one cost line, or make it an open question (confidence open)");
    issues.push(...lineIssues(lines));
  }
  return issues;
}

function lineIssues(lines) {
  const issues = [];
  if (lines.length > 20) issues.push("at most 20 lines");
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (!l || typeof l !== "object") { issues.push(`line ${n}: is not a line`); continue; }
    if (blank(l.account_code)) issues.push(`line ${n}: account code is required`);
    const p = toPence(l.amount);
    if (p === null) issues.push(`line ${n}: amount must be money, to the penny`);
    else if (p <= 0) issues.push(`line ${n}: give the cost as a positive amount, net of VAT; the credit to accruals is added for you`);
    if (!blank(l.tax_type) && l.tax_type !== "NONE") issues.push(`line ${n}: accruals are net of VAT with no tax type; leave tax_type out`);
    if (l.description != null && String(l.description).length > 200) issues.push(`line ${n}: keep the description to 200 characters`);
  }
  return issues;
}

// The cost lines must not be the accruals account itself.
function accountIssues(lines, accrualAccount) {
  return (lines ?? []).flatMap((l, i) => (String(l.account_code).trim() === String(accrualAccount)
    ? [`line ${i + 1}: ${accrualAccount} is the accruals account; code the cost to where it belongs`] : []));
}

const cleanLines = (lines) => (lines ?? []).map((l) => ({
  account_code: String(l.account_code).trim(),
  amount: Number(fromPence(toPence(l.amount))),
  ...(blank(l.description) ? {} : { description: String(l.description).trim() }),
}));

// The accruals account for one company: the CFO's setting, else the single
// account on the Accruals line of the balance sheet matrix. Never a default.
//   settings     [{ entity_id, account_code }]
//   recAccounts  [{ entity_id, account_code }] the company's accounts placed on the accruals line
function accrualAccountFor({ settings = [], recAccounts = [], entityId }) {
  const set = settings.find((s) => s.entity_id === entityId && !blank(s.account_code));
  if (set) return String(set.account_code);
  const codes = [...new Set(recAccounts.filter((r) => r.entity_id === entityId && !blank(r.account_code)).map((r) => String(r.account_code)))];
  return codes.length === 1 ? codes[0] : null;
}

// ── Precedents: cite or depart ──────────────────────────────────────────────

// The client's precedents that bear on one supplier in one company this month.
function applicablePrecedents(precedents, { entity_id, supplier, contact_id, period }) {
  return (precedents ?? []).filter((p) => !p.ended_at && p.entity_id === entity_id
    && sameSupplier({ supplier, contact_id }, p)
    && (p.applies_to === "until_changed" ? period >= p.period : period === p.period));
}

// Whether a proposal may be raised (spec 5): it names the precedent it
// follows, or says why this month differs. One that follows a no-accrual
// precedent is not raised at all: the agent puts it in its run note.
function citeOrDepart(proposal, applicable) {
  if (!applicable?.length || !blank(proposal.departs_reason)) return { ok: true };
  const cited = applicable.filter((p) => (proposal.precedent_ids ?? []).includes(p.id));
  if (!cited.length) {
    const p = applicable[0];
    return { refuse: `${p.supplier} has a precedent that applies: the CFO decided ${words(p.decision)} on ${longDate(p.decided_at)}${p.reason ? ` (${p.reason})` : ""}, precedent ${p.id}. Either cite it in precedent_ids, or say in departs_reason what is different this month.` };
  }
  const no = cited.find((p) => p.decision === "no_accrual");
  if (no) {
    return { refuse: `Not raised: the CFO decided no accrual for ${no.supplier} on ${longDate(no.decided_at)}${no.reason ? ` (${no.reason})` : ""}, precedent ${no.id}. Put it in your run note as not raised. Raise it only with new evidence, in departs_reason.`, not_raised: true, precedent_id: no.id };
  }
  return { ok: true };
}

const words = (d) => ({ accept: "to accrue", accept_edited: "to accrue an edited amount", no_accrual: "no accrual", standing: "a standing accrual", question: "to ask" }[d] ?? d);

// ── The CFO's decision ──────────────────────────────────────────────────────

// Plans the writes for one decision. Returns { issues, proposal, precedent, item }.
//   precedent  null for a question: the proposal stays open
//   item       for accept, accept_edited and standing
function decisionPlan({ proposal, body, actor, now = new Date() }) {
  const b = body || {};
  const issues = [];
  const none = { proposal: null, precedent: null, item: null };
  if (!["pending", "question"].includes(proposal.decision)) return { issues: ["this proposal is already decided"], ...none };
  if (!DECISIONS.includes(b.decision)) return { issues: [`decision must be one of ${DECISIONS.join(", ")}`], ...none };
  const reason = blank(b.reason) ? null : String(b.reason).trim();
  if (reason && reason.length > MAX_TEXT) issues.push(`keep the reason to ${MAX_TEXT} characters`);
  if (b.decision === "no_accrual" && !reason) issues.push("say why there is no accrual: it becomes the precedent the agents follow");
  if (b.decision === "question" && !reason) issues.push("write the question");
  const applies = b.applies_to ?? "this_month";
  if (!APPLIES.includes(applies)) issues.push(`applies_to must be one of ${APPLIES.join(", ")}`);
  let lines = proposal.lines ?? [];
  if (b.decision === "accept_edited") {
    const edited = Array.isArray(b.lines) ? b.lines : [];
    if (!edited.length) issues.push("give the lines as you want them accrued");
    issues.push(...lineIssues(edited));
    lines = edited;
  } else if (["accept", "standing"].includes(b.decision) && !lines.length) {
    issues.push("an open question has no amount to accept: give the lines (accept_edited), decide no accrual, or answer it as a question");
  }
  if (b.decision === "standing") {
    if (!blank(b.end_period) && (!isPeriod(b.end_period) || b.end_period < proposal.period)) issues.push("end period must be a month from this one on");
  }
  const lag = b.bill_lag_months ?? 1;
  if (!Number.isInteger(lag) || lag < 0 || lag > 3) issues.push("bill_lag_months is how many months after the service the bill is dated: 0 to 3");
  if (issues.length) return { issues, ...none };

  const at = now.toISOString();
  const kept = b.decision === "question" ? "question" : b.decision;
  const clean = cleanLines(lines);
  const amount = fromPence(sumPence(clean));
  const item = ["accept", "accept_edited", "standing"].includes(b.decision) ? {
    entity_id: proposal.entity_id, supplier: proposal.supplier, contact_id: proposal.contact_id ?? null, lines: clean, amount,
    period_from: proposal.period, standing: b.decision === "standing", end_period: b.decision === "standing" ? (b.end_period || null) : null,
    bill_lag_months: lag, basis_kind: proposal.basis_kind, basis: proposal.basis,
    service_from: proposal.service_from ?? null, service_to: proposal.service_to ?? null,
    expected_clearing: blank(b.expected_clearing) ? null : String(b.expected_clearing).trim().slice(0, 500),
  } : null;
  const precedent = b.decision === "question" ? null : {
    entity_id: proposal.entity_id, supplier: proposal.supplier, contact_id: proposal.contact_id ?? null, test: proposal.test,
    decision: kept, reason, applies_to: applies, period: proposal.period, decided_by: actor, decided_at: at,
    facts: { service_month: proposal.period, amount: item ? amount : (proposal.lines?.length ? fromPence(sumPence(proposal.lines)) : null), basis_kind: proposal.basis_kind },
  };
  return {
    issues: [],
    proposal: { decision: kept, decision_reason: reason, applies_to: b.decision === "question" ? null : applies, decided_by: b.decision === "question" ? null : actor, decided_at: b.decision === "question" ? null : at },
    precedent,
    item,
  };
}

// ── The schedule ─────────────────────────────────────────────────────────────

// Whether an item accrues in a month: a one-off in its own month; a standing
// item every month from its first to its end month, until it is stopped.
function accruesIn(item, period) {
  if (period < item.period_from) return false;
  if (item.stopped_period && period >= item.stopped_period) return false;
  if (!item.standing) return period === item.period_from;
  return !item.end_period || period <= item.end_period;
}

// What each company holds on its accruals account at a month end, in pence
// (positive: owed). Last month's accruals are reversed on the 1st, so only
// this month's are left.
function scheduleAt(items, period) {
  const out = new Map();
  for (const i of items) if (accruesIn(i, period)) out.set(i.entity_id, (out.get(i.entity_id) ?? 0) + toPence(i.amount));
  return out;
}

// The accruals account against the schedule, per company, to the penny.
//   ledger   [{ entity_id, closing }] signed as the ledger (a credit is negative)
//   pending  [{ entity_id, total, state, jnl }] this month's pairs not yet posted
function tieOut({ items, period, ledger = [], pending = [] }) {
  const sched = scheduleAt(items, period);
  const ids = [...new Set([...ledger.map((l) => l.entity_id), ...sched.keys()])];
  const rows = ids.map((id) => {
    const l = ledger.find((x) => x.entity_id === id);
    const gl = l ? toPence(l.closing) ?? 0 : 0;
    const schedule = -(sched.get(id) ?? 0);
    const variance = gl - schedule;
    const waiting = pending.filter((p) => p.entity_id === id && p.state !== "posted");
    const note = variance !== 0 && waiting.length
      ? `${waiting.map((p) => `${p.jnl ?? "A pair"} (${p.total})`).join(", ")} ${waiting.length === 1 ? "is" : "are"} ${waiting.every((p) => p.state === "proposed") ? "waiting for approval" : "not yet posted in Xero"}; once posted in Xero the ledger should tie.`
      : null;
    return { entity_id: id, ledger: gl, schedule, variance, ties: variance === 0, note };
  });
  return { rows, ties: rows.length > 0 && rows.every((r) => r.ties) };
}

// ── Continuity ───────────────────────────────────────────────────────────────

// Every month a live item accrues in, from its first month to this one, needs a
// pair (waiting, approved, in Xero or posted). A missed earlier month is
// proposed into that month; a locked one is a finding. A bill billed in the
// month (lag 0) that arrived in it needs no accrual. A month's bill not in by
// the 15th of the month it was expected is a finding.
//   pairs      [{ accrual_item_id, period, state }]
//   clearings  [{ item_id, period, bill_date }]
function continuity({ items, pairs = [], clearings = [], period, lockDate = null, today }) {
  const propose = [];
  const findings = [];
  for (const item of items) {
    for (let m = item.period_from; m <= period; m = shift(m, 1)) {
      if (!accruesIn(item, m)) continue;
      const cleared = clearings.find((c) => c.item_id === item.id && c.period === m);
      const paired = pairs.some((p) => p.accrual_item_id === item.id && p.period === m && LIVE_PAIR.includes(p.state));
      if (!paired) {
        if ((item.bill_lag_months ?? 1) === 0 && cleared) continue;
        if (lockDate && monthEnd(m) <= lockDate) {
          findings.push({ kind: "locked", item_id: item.id, period: m,
            text: `${item.supplier}: ${monthName(m)} has no accrual and the month is locked (lock date ${longDate(lockDate)}). Open the month in Xero to backfill it; it is not caught up in another month.` });
        } else {
          propose.push({ item_id: item.id, period: m, backfill: m < period });
        }
        continue;
      }
      const due = shift(m, item.bill_lag_months ?? 1);
      if (!cleared && today && today > `${due}-15`) {
        findings.push({ kind: "bill_late", item_id: item.id, period: m,
          text: `${item.supplier}: the bill for ${monthName(m)} was expected in ${monthName(due)} and is not in Xero by 15 ${monthName(due)}.` });
      }
    }
  }
  return { propose, findings };
}

// ── The journal pair ─────────────────────────────────────────────────────────

// The accrual for one item and month: dated the month end, Dr the cost lines,
// Cr the accruals account, TaxType NONE. Its reversal is the same lines
// negated, dated the 1st of the next month, under the same short narration.
function pairFor({ item, period, accrualAccount }) {
  if (blank(accrualAccount)) throw new Error(`There is no accruals account for ${item.supplier}'s company. Set it on the Accruals page before anything is proposed.`);
  const tail = `, ${monthName(period)} services`;
  const room = MAX_NARRATION - 1 - "Reversal: ".length - tail.length;
  const supplier = String(item.supplier).trim().slice(0, room);
  const desc = `Accrual: ${supplier}`.slice(0, 200);
  const cost = (item.lines ?? []).map((l) => ({ account_code: String(l.account_code), description: desc, amount: Number(fromPence(toPence(l.amount))), tax_type: "NONE" }));
  return {
    journal_date: monthEnd(period),
    reversal_date: `${shift(period, 1)}-01`,
    narration: `Accrual: ${supplier}${tail}`,
    lines: [...cost, { account_code: String(accrualAccount), description: desc, amount: -Number(fromPence(sumPence(cost))), tax_type: "NONE" }],
  };
}

const reversalLines = (lines) => (lines ?? []).map((l) => ({ ...l, amount: Number(fromPence(-toPence(l.amount))) }));
const reversalNarration = (n) => String(n).replace(/^Accrual:/, "Reversal:");

// Each leg reaches Xero under its own key: the journal, the leg's attempt and
// the leg. The accrual keeps the register's key, so every place that reads a
// journal's attempt still finds it. A refused reversal moves only the reversal on.
const pairKeys = (j) => ({ accrual: `journal-${j.id}-${j.attempts ?? 1}`, reversal: `journal-${j.id}-${j.reversal_attempts ?? 1}-reversal` });

// The pair's state from each leg's (journals.attemptState): which legs to send.
function pairAttempt({ accrual, reversal }) {
  const legs = { accrual, reversal };
  if (Object.values(legs).includes("live")) return { state: "live", legs: [] };
  if (Object.values(legs).includes("unknown")) return { state: "unknown", legs: [] };
  const send = Object.entries(legs).filter(([, s]) => s !== "drafted").map(([k]) => k);
  if (!send.length) return { state: "drafted", legs: [] };
  return { state: send.some((k) => legs[k] === "retry") ? "retry" : "go", legs: send };
}

// ── Matching the bill ────────────────────────────────────────────────────────

const BILL_OK = ["SUBMITTED", "AUTHORISED", "PAID"];

// The bill that clears each accrued month: the same supplier, dated in the
// month the bill was expected (the service month plus the item's lag), not
// used by another month. The closest amount wins, then the earliest. A month
// is matched only once it was accrued (a live pair).
//   bills  [{ id, number, date, net, contact_id, contact_name, status }]
function matchClearings({ items, bills = [], clearings = [], pairs = [], period }) {
  const used = new Set(clearings.map((c) => c.bill_id).filter(Boolean));
  const out = [];
  for (const item of items) {
    for (let m = item.period_from; m <= period; m = shift(m, 1)) {
      if (!accruesIn(item, m)) continue;
      if (clearings.some((c) => c.item_id === item.id && c.period === m)) continue;
      if (!pairs.some((p) => p.accrual_item_id === item.id && p.period === m && LIVE_PAIR.includes(p.state))) continue;
      const due = shift(m, item.bill_lag_months ?? 1);
      const accrued = toPence(item.amount);
      const hit = bills
        .filter((b) => !used.has(b.id) && BILL_OK.includes(String(b.status).toUpperCase()) && String(b.date).slice(0, 7) === due && sameSupplier(item, b))
        .sort((a, b) => Math.abs(toPence(a.net) - accrued) - Math.abs(toPence(b.net) - accrued) || String(a.date).localeCompare(String(b.date)))[0];
      if (!hit) continue;
      used.add(hit.id);
      out.push({ item_id: item.id, period: m, bill_id: hit.id, bill_number: hit.number ?? null, bill_date: String(hit.date).slice(0, 10), bill_net: fromPence(toPence(hit.net)), difference: toPence(hit.net) - accrued });
    }
  }
  return out;
}

// ── History, for the agent ───────────────────────────────────────────────────

// Per supplier: the proposals with decisions, reasons and comments, the
// precedents, the standing items, the clearing differences and what they say.
function historyView({ proposals = [], comments = [], precedents = [], items = [], clearings = [], names = new Map() }) {
  const by = new Map();
  const slot = (supplier) => {
    const key = nameKey(supplier);
    if (!by.has(key)) by.set(key, { supplier, proposals: [], precedents: [], standing: [], clearings: [], calibration: null });
    return by.get(key);
  };
  for (const p of proposals) {
    slot(p.supplier).proposals.push({
      id: p.id, company: names.get(p.entity_id) ?? null, period: p.period, test: p.test, total: p.total ?? null, basis: p.basis,
      decision: p.decision, reason: p.decision_reason ?? null,
      comments: comments.filter((c) => c.proposal_id === p.id).map((c) => ({ by: c.author, at: c.created_at, body: c.body })),
    });
  }
  for (const p of precedents) {
    slot(p.supplier).precedents.push({ id: p.id, company: names.get(p.entity_id) ?? null, period: p.period, decision: p.decision, reason: p.reason ?? null, applies_to: p.applies_to, ended: p.ended_at ?? null });
  }
  for (const i of items.filter((x) => x.standing)) {
    slot(i.supplier).standing.push({ item_id: i.id, company: names.get(i.entity_id) ?? null, monthly: fromPence(toPence(i.amount)), from: i.period_from, to: i.end_period ?? null, stopped: i.stopped_period ?? null });
  }
  for (const c of clearings) {
    const s = slot(c.supplier);
    s.clearings.push({ period: c.period, bill: c.bill_number ?? null, difference: fromPence(c.difference) });
  }
  for (const s of by.values()) {
    const cs = clearings.filter((c) => nameKey(c.supplier) === nameKey(s.supplier) && c.accrued);
    const under = cs.filter((c) => c.difference > 0);
    const over = cs.filter((c) => c.difference < 0);
    const side = under.length === cs.length ? { list: under, word: "under" } : over.length === cs.length ? { list: over, word: "over" } : null;
    if (cs.length >= 2 && side) {
      const avg = side.list.reduce((a, c) => a + Math.abs(c.difference) / c.accrued, 0) / side.list.length;
      s.calibration = `Accruals ran ${side.word} the bill in ${side.list.length} of ${cs.length} months, by ${Number((avg * 100).toFixed(1))}% on average. Adjust the basis.`;
    }
  }
  return { suppliers: [...by.values()].sort((a, b) => a.supplier.localeCompare(b.supplier)) };
}

// One line for the client's accruals-and-prepayments addition, from a precedent.
function promoteText(p, companyName) {
  const what = { no_accrual: "no accrual", accept: "accrue", accept_edited: "accrue", standing: "standing accrual" }[p.decision] ?? p.decision;
  return `- ${p.supplier}${companyName ? ` (${companyName})` : ""}: ${what}.${p.reason ? ` ${String(p.reason).replace(/\.?\s*$/, ".")}` : ""} (CFO, ${longDate(p.decided_at)}; from accrual precedent ${p.id}.)`;
}

module.exports = {
  TESTS, BASIS_KINDS, CONFIDENCE, DECISIONS, APPLIES, LIVE_PAIR, MAX_NARRATION,
  isPeriod, monthEnd, shift, monthName, longDate, shortId, sameSupplier,
  proposalIssues, accountIssues, cleanLines, accrualAccountFor,
  applicablePrecedents, citeOrDepart, decisionPlan,
  accruesIn, scheduleAt, tieOut, continuity,
  pairFor, reversalLines, reversalNarration, pairKeys, pairAttempt,
  matchClearings, historyView, promoteText,
};

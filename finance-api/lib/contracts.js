// Contracts (Nik, 15 Nov 2026): what each company of a client has agreed to
// sell and to buy. The routes (lib/contracts-routes.js) apply what this decides.
//
// Three layers say how a customer contract becomes revenue:
//   1. the standard pattern here (PATTERNS), the same for every client;
//   2. the client's own rules, approved by the CFO on the revenue procedure
//      (finance.client_procedures, read by the routes);
//   3. this contract's terms: its schedule, milestones and amounts.
// The pattern is proposed (by the read, or by whoever adds the contract) and
// confirmed by the CFO, as bill coding is.
//
// Finance terms only: amounts, dates, renewal, payment triggers. Never a legal
// reading of a contract.

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_TEXT = 2000;
const NOTICE_LEAD_DAYS = 30;
const COMING_UP_DAYS = 120;

// How a contract becomes revenue (customer) or cost (supplier). rule says when;
// evidence what proves it. Edited only with the revenue procedure, which lists
// the same patterns (agents/procedures/revenue-and-deferred-revenue.md).
const PATTERNS = [
  { key: "goods", side: "customer", label: "Goods sold",
    rule: "Revenue when the goods are delivered and the customer has them.",
    evidence: "Delivery note or proof of dispatch." },
  { key: "services_time", side: "customer", label: "Services, as delivered",
    rule: "Revenue as the work is done; work done and not yet billed is accrued.",
    evidence: "Time records or the statement of work." },
  { key: "subscription", side: "customer", label: "Subscription or SaaS",
    rule: "Revenue spread evenly over the service period; a set-up fee is judged on its own, usually spread with it.",
    evidence: "The period on the invoice or the contract." },
  { key: "milestone", side: "customer", label: "Milestone or installation",
    rule: "Held as deferred income until each milestone is evidenced, then released. Costs to fulfil it are held until then too.",
    evidence: "A signed handover or acceptance note for each milestone." },
  { key: "deposit", side: "customer", label: "Deposit",
    rule: "Never revenue when received: held as a liability until delivery under the order starts.",
    evidence: "The order and the receipt." },
  { key: "agent", side: "customer", label: "Agent or principal",
    rule: "Acting as agent, only the share kept is revenue; acting as principal, the gross.",
    evidence: "The contract terms on who controls what is sold." },
  { key: "sponsorship", side: "customer", label: "Sponsorship",
    rule: "Revenue over the sponsorship term, unless it has separate deliverables (naming, events, content) priced on their own; value in kind at fair value.",
    evidence: "The sponsorship agreement and its rights schedule." },
  { key: "event", side: "customer", label: "Event",
    rule: "Revenue on the event date; tickets and hospitality sold before it are held until then.",
    evidence: "The event date and ticketing report." },
  { key: "grant", side: "customer", label: "Grant",
    rule: "FRS 102 section 24: when its conditions are met (performance model) or spread to match the costs it funds (accrual model), as the client's policy chooses; clawback conditions tracked.",
    evidence: "The grant letter, its conditions and the claims made." },
  { key: "media_rights", side: "customer", label: "Media rights",
    rule: "Access over a term is spread over the term; a right to use granted once is recognised when granted; royalties and revenue shares as the sales or usage happen; a minimum guarantee is spread.",
    evidence: "The rights agreement, territories and seasons, and usage or sales reports." },
  { key: "prepaid", side: "supplier", label: "Paid upfront for a period",
    rule: "Cost spread over the period it covers: a prepayment schedule (insurance, annual licences).",
    evidence: "The policy or order with its period." },
  { key: "recurring", side: "supplier", label: "Recurring subscription",
    rule: "Cost in the month it covers; each bill checked against the agreed price and seats.",
    evidence: "The order form or price agreed." },
  { key: "lease", side: "supplier", label: "Lease",
    rule: "FRS 102 from 1 January 2026: most leases come onto the balance sheet as a right-of-use asset and a lease liability.",
    evidence: "The lease, its term, payments and any break dates." },
  { key: "services_buy", side: "supplier", label: "Services bought",
    rule: "Cost as the services are received; received and not yet billed is accrued.",
    evidence: "The engagement or statement of work." },
];
const PATTERN = Object.fromEntries(PATTERNS.map((p) => [p.key, p]));

const RENEWALS = ["no", "auto", "option"];
const SIDES = ["customer", "supplier"];

// ── Small checks ─────────────────────────────────────────────────────────────

const clean = (v, max = 200) => {
  const s = String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
function amountOf(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[£$€,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const pence = (v) => Math.round(Number(v ?? 0) * 100);
const pounds = (p) => (p / 100).toFixed(2);
const isGuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ""));
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const CFO_ROLE = /^(?:(?:fractional|interim|group|outsourced)\s+)?(?:cfo|chief financial officer|finance director)$/i;
const isCfo = (role) => CFO_ROLE.test(String(role ?? ""));

// ── A contract's fields ──────────────────────────────────────────────────────

// The columns a body sets, checked. partial: only what is given (an edit).
//   entities  [{ id, slug, name }] of this client: a company is named by slug
function contractInput(body = {}, entities = [], { partial = false } = {}) {
  const set = {};
  const issues = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const want = (k) => !partial || has(k);

  if (want("entity")) {
    const e = entities.find((x) => x.slug === body.entity);
    if (!e) issues.push("entity must be one of this client's companies");
    else set.entity_id = e.id;
  }
  if (want("side")) {
    if (!SIDES.includes(body.side)) issues.push("side must be customer or supplier");
    else set.side = body.side;
  }
  if (want("counterparty")) {
    const c = clean(body.counterparty);
    if (!c) issues.push("counterparty is required: who the contract is with");
    else set.counterparty = c;
  }
  for (const k of ["title", "reference", "payment_terms", "account_code"]) {
    if (has(k)) set[k] = clean(body[k], k === "payment_terms" ? 500 : 200);
  }
  if (has("notes")) set.notes = clean(body.notes, MAX_TEXT);
  if (want("pattern")) {
    const p = PATTERN[body.pattern];
    if (!p) issues.push("pattern must be one of the standard patterns");
    else set.pattern = p.key;
  }
  if (has("currency") || !partial) {
    const c = String(body.currency ?? "GBP").toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(c)) issues.push("currency must be a three-letter code");
    else set.currency = c;
  }
  if (has("total_value")) {
    const v = amountOf(body.total_value);
    if (Number.isNaN(v) || (v !== null && v < 0)) issues.push("total_value must be an amount");
    else set.total_value = v;
  }
  for (const k of ["start_date", "end_date"]) {
    if (!has(k)) continue;
    if (body[k] === null || body[k] === "") set[k] = null;
    else if (!isDate(body[k])) issues.push(`${k} must be YYYY-MM-DD`);
    else set[k] = body[k];
  }
  if (has("renewal") || !partial) {
    const r = body.renewal ?? "no";
    if (!RENEWALS.includes(r)) issues.push("renewal must be no, auto or option");
    else set.renewal = r;
  }
  if (has("notice_days")) {
    if (body.notice_days === null || body.notice_days === "") set.notice_days = null;
    else {
      const n = Number(body.notice_days);
      if (!Number.isInteger(n) || n < 0 || n > 3650) issues.push("notice_days must be a whole number of days");
      else set.notice_days = n;
    }
  }
  return { set, issues };
}

// A pattern must belong to the contract's side: a supplier contract is never
// recognised as revenue.
function sideIssues(side, pattern) {
  const p = PATTERN[pattern];
  if (!p || !side) return [];
  return p.side === side ? [] : [`${p.label} is a ${p.side} pattern; this is a ${side} contract`];
}

function datesIssues(c) {
  return c.start_date && c.end_date && c.end_date < c.start_date ? ["end_date is before start_date"] : [];
}

// ── Schedule and movements ───────────────────────────────────────────────────

// A payment instalment or a milestone, checked.
function scheduleInput(body = {}, { partial = false } = {}) {
  const set = {};
  const issues = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("kind")) {
    if (!["payment", "milestone"].includes(body.kind)) issues.push("kind must be payment or milestone");
    else set.kind = body.kind;
  }
  if (!partial || has("label")) {
    const l = clean(body.label);
    if (!l) issues.push("label is required");
    else set.label = l;
  }
  if (has("seq")) {
    const n = Number(body.seq);
    if (!Number.isInteger(n) || n < 1 || n > 999) issues.push("seq must be a whole number from 1");
    else set.seq = n;
  }
  for (const k of ["trigger_text", "expected", "evidence", "note"]) if (has(k)) set[k] = clean(body[k], 500);
  for (const k of ["amount", "received_amount"]) {
    if (!has(k)) continue;
    const v = amountOf(body[k]);
    if (Number.isNaN(v) || (v !== null && v < 0)) issues.push(`${k} must be an amount`);
    else set[k] = v;
  }
  for (const k of ["due_on", "received_on"]) {
    if (!has(k)) continue;
    if (body[k] === null || body[k] === "") set[k] = null;
    else if (!isDate(body[k])) issues.push(`${k} must be YYYY-MM-DD`);
    else set[k] = body[k];
  }
  if (has("status")) {
    if (!["pending", "met", "cancelled"].includes(body.status)) issues.push("status must be pending, met or cancelled");
    else set.status = body.status;
  }
  return { set, issues };
}

// What an item would be after a change, checked as a whole: a milestone is met
// only with its evidence named.
function scheduleIssues(item) {
  const issues = [];
  if (item.kind === "milestone" && item.status === "met" && String(item.evidence ?? "").trim().length < 3) {
    issues.push("name the evidence that the milestone is met (for example the signed handover note)");
  }
  return issues;
}

function movementInput(body = {}) {
  const issues = [];
  if (!["billed", "released"].includes(body.kind)) issues.push("kind must be billed or released");
  if (!isDate(body.on_date)) issues.push("on_date must be YYYY-MM-DD");
  const amount = amountOf(body.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0) issues.push("amount must be more than nothing");
  return {
    set: { kind: body.kind, on_date: body.on_date, amount, ref: clean(body.ref, 100), note: clean(body.note, 500) },
    issues,
  };
}

// What a contract holds on its account at a date, in pence: billed less
// released, up to and including the date. Withdrawn lines do not count.
function heldAt(movements = [], date) {
  let held = 0;
  for (const m of movements) {
    if (m.withdrawn_at) continue;
    const on = String(m.on_date instanceof Date ? m.on_date.toISOString() : m.on_date).slice(0, 10);
    if (date && on > date) continue;
    held += (m.kind === "released" ? -1 : 1) * pence(m.amount);
  }
  return held;
}

// The evidence a Deferred income reconciliation takes from the register, per
// company with a balance: customer contracts held on the rec's account at the
// month end. A liability, so negative, as the ledger shows it.
//   balances   [{ entity_id, account_code }]
//   contracts  [{ id, entity_id, side, account_code, counterparty, movements }]
function deferredEvidence(balances = [], contracts = [], date) {
  const rows = [];
  const said = [];
  for (const b of balances) {
    const code = String(b.account_code ?? "").trim();
    const mine = contracts.filter((c) => c.side === "customer" && c.entity_id === b.entity_id && code && String(c.account_code ?? "").trim() === code);
    if (!mine.length) {
      said.push(`${b.entity_name ?? "A company"}: no customer contract in the register holds money on account ${code || "(no code)"}. Add the contracts behind this balance.`);
      continue;
    }
    let total = 0;
    const parts = [];
    for (const c of mine) {
      const h = heldAt(c.movements, date);
      if (!h) continue;
      total += h;
      parts.push(`${c.counterparty} ${pounds(h)}`);
    }
    rows.push({
      entity_id: b.entity_id, amount: pounds(-total),
      source: `Contracts register at ${date}: ${mine.length} contract${mine.length === 1 ? "" : "s"} on ${code}`,
      note: parts.length ? `Held: ${parts.join("; ")}.` : "The contracts on this account held nothing at the month end.",
    });
    said.push(`${b.entity_name ?? "A company"}: ${parts.length ? parts.join("; ") : "nothing held"}.`);
  }
  return { rows, said };
}

// ── Dates that matter ────────────────────────────────────────────────────────

// The last day notice can be given, for a contract that renews: the end date
// less the notice period. Null when either is missing or it does not renew.
function noticeBy(c) {
  if (!["auto", "option"].includes(c.renewal) || !c.end_date || c.notice_days === null || c.notice_days === undefined) return null;
  return addDays(day(c.end_date), -Number(c.notice_days));
}

const day = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// The Work task for a notice deadline, or null: due NOTICE_LEAD_DAYS before it,
// once per contract and deadline (source_ref), so a changed date is a new task.
function noticeTask(c, entityName = null) {
  const by = noticeBy(c);
  if (!by || c.status !== "active") return null;
  const end = day(c.end_date);
  const verb = c.renewal === "auto" ? "renews itself" : "may be renewed";
  return {
    title: `Notice deadline: ${c.counterparty} ${verb} on ${end}`,
    notes: `${entityName ? `${entityName}. ` : ""}Notice must be given by ${by} (${c.notice_days} days before ${end}). Decide whether to renew, renegotiate or cancel before then. From the contracts register.`,
    due_on: addDays(by, -NOTICE_LEAD_DAYS),
    source: "contract",
    source_ref: `contract:${c.id}:notice:${by}`,
  };
}

// What is coming up across the register: undecided or dated payments and
// milestones, and notice deadlines within COMING_UP_DAYS. Undated items come
// first: a date nobody has set is the thing most likely to be missed.
function comingUp(contracts = [], schedule = [], today) {
  const until = addDays(today, COMING_UP_DAYS);
  const out = [];
  const byId = new Map(contracts.map((c) => [c.id, c]));
  for (const s of schedule) {
    const c = byId.get(s.contract_id);
    if (!c || c.status !== "active" || s.status !== "pending") continue;
    const due = day(s.due_on);
    if (due && due > until) continue;
    out.push({
      contract_id: c.id, counterparty: c.counterparty, kind: s.kind, label: s.label,
      amount: s.amount == null ? null : Number(s.amount), currency: c.currency,
      due_on: due, expected: s.expected ?? null, trigger_text: s.trigger_text ?? null, overdue: Boolean(due && due < today),
    });
  }
  for (const c of contracts) {
    const by = noticeBy(c);
    if (!by || c.status !== "active" || by > until) continue;
    out.push({ contract_id: c.id, counterparty: c.counterparty, kind: "notice", label: "Notice deadline", amount: null, currency: c.currency, due_on: by, expected: null, trigger_text: null, overdue: by < today });
  }
  const rank = (x) => (x.due_on ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || String(a.due_on ?? "").localeCompare(String(b.due_on ?? "")));
}

// ── Reading a contract ───────────────────────────────────────────────────────

const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_contract: { type: "BOOLEAN", description: "True for a contract, agreement, order form, quote accepted as a contract, policy or lease" },
    side: { type: "STRING", enum: ["customer", "supplier"], nullable: true },
    company: { type: "STRING", nullable: true, description: "One of the company slugs given, or null" },
    counterparty: { type: "STRING", nullable: true },
    title: { type: "STRING", nullable: true },
    reference: { type: "STRING", nullable: true },
    pattern: { type: "STRING", enum: PATTERNS.map((p) => p.key), nullable: true },
    pattern_reason: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    total_value: { type: "NUMBER", nullable: true },
    start_date: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    end_date: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    renewal: { type: "STRING", enum: RENEWALS, nullable: true },
    notice_days: { type: "INTEGER", nullable: true },
    payment_terms: { type: "STRING", nullable: true },
    schedule: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["payment", "milestone"] },
          label: { type: "STRING" },
          trigger_text: { type: "STRING", nullable: true },
          amount: { type: "NUMBER", nullable: true },
          due_on: { type: "STRING", nullable: true, description: "YYYY-MM-DD, only when the document gives a date" },
        },
        required: ["kind", "label"],
      },
    },
    pages: {
      type: "OBJECT",
      description: "The page each term was found on, as p1, p2",
      properties: Object.fromEntries(["counterparty", "total_value", "start_date", "end_date", "renewal", "notice_days", "payment_terms", "schedule"].map((k) => [k, { type: "STRING", nullable: true }])),
    },
    not_found: { type: "ARRAY", items: { type: "STRING" }, description: "Terms a contract of this kind normally has that this document does not give" },
    summary: { type: "STRING", nullable: true },
  },
  required: ["is_contract"],
};

function readPrompt({ fileName, entities = [], clientName = "" }) {
  const companies = entities.map((e) => `- ${e.slug}: ${e.name}${e.legal_name && e.legal_name !== e.name ? ` (${e.legal_name})` : ""}`).join("\n");
  const patterns = PATTERNS.map((p) => `- ${p.key} (${p.side}): ${p.label}. ${p.rule}`).join("\n");
  return `You are reading a document a UK accountant uploaded, "${fileName}", for the contracts register of ${clientName || "a client"}. Read it for its FINANCE terms only: who it is with, amounts, dates, renewal and notice, and what makes each payment due. Do not give legal advice or interpret obligations beyond those terms.

First say whether it is a contract (an agreement, order form, accepted quote, insurance policy or lease). If it is not, set is_contract false and leave the rest null.

The client's companies:
${companies || "- (none given)"}

- side: "customer" when one of these companies is SELLING (it is paid), "supplier" when it is BUYING (it pays).
- company: the slug of the client's company that is party to it, only if the document names it; else null.
- counterparty: the other party, as written.
- title and reference: the document's title and any contract, quote or policy number.
- pattern: how it becomes revenue or cost, one of the following, matching the side. Give pattern_reason in one sentence from the document's own terms.
${patterns}
- currency (ISO code), total_value (the whole contract value, before VAT where shown).
- start_date and end_date: YYYY-MM-DD. UK documents write dates day first.
- renewal: "auto" if it renews itself unless notice is given, "option" if it may be renewed, "no" if it simply ends. notice_days: the notice period in days (a month is 30, three months 90), or null.
- payment_terms: the payment terms in one line, as written.
- schedule: each payment instalment (kind payment: its amount, what makes it due as trigger_text, due_on only if a date is given) and each milestone to be delivered (kind milestone). Never invent a date.
- pages: the page each term was found on.
- not_found: the terms a contract of this kind normally has that this one does not give (for example "notice period", "end date").
- summary: two sentences on what is bought or sold and how it is paid.

Never invent a value. Leave a term null when the document does not give it.`;
}

function buildReadRequest({ bytes, fileName, entities, clientName }) {
  return {
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
      { text: readPrompt({ fileName, entities, clientName }) },
    ] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: READ_SCHEMA, temperature: 0, maxOutputTokens: 16384 },
  };
}

// The model's answer as the terms a person checks: every value checked, and a
// company or pattern that does not fit dropped rather than guessed.
function parseRead(text, entities = []) {
  let raw;
  try { raw = typeof text === "string" ? JSON.parse(text) : text; } catch { throw new Error("the reading was not valid JSON"); }
  if (!raw || typeof raw !== "object") throw new Error("the reading was empty");
  const side = SIDES.includes(raw.side) ? raw.side : null;
  const company = entities.some((e) => e.slug === raw.company) ? raw.company : null;
  const pattern = PATTERN[raw.pattern] && (!side || PATTERN[raw.pattern].side === side) ? raw.pattern : null;
  const amt = (v) => { const n = amountOf(v); return n === null || Number.isNaN(n) || n < 0 ? null : n; };
  const schedule = (Array.isArray(raw.schedule) ? raw.schedule : []).slice(0, 50).map((s, i) => ({
    kind: s?.kind === "milestone" ? "milestone" : "payment",
    seq: i + 1,
    label: clean(s?.label) ?? `${s?.kind === "milestone" ? "Milestone" : "Payment"} ${i + 1}`,
    trigger_text: clean(s?.trigger_text, 500),
    amount: amt(s?.amount),
    due_on: isDate(s?.due_on) ? s.due_on : null,
  }));
  const pages = {};
  for (const [k, v] of Object.entries(raw.pages && typeof raw.pages === "object" ? raw.pages : {})) {
    const p = clean(v, 20);
    if (p) pages[k] = p;
  }
  const notice = Number.isInteger(raw.notice_days) && raw.notice_days >= 0 && raw.notice_days <= 3650 ? raw.notice_days : null;
  return {
    is_contract: raw.is_contract !== false,
    side, entity: company,
    counterparty: clean(raw.counterparty), title: clean(raw.title), reference: clean(raw.reference),
    pattern, pattern_reason: clean(raw.pattern_reason, 500),
    currency: /^[A-Z]{3}$/.test(String(raw.currency ?? "").toUpperCase()) ? String(raw.currency).toUpperCase() : null,
    total_value: amt(raw.total_value),
    start_date: isDate(raw.start_date) ? raw.start_date : null,
    end_date: isDate(raw.end_date) ? raw.end_date : null,
    renewal: RENEWALS.includes(raw.renewal) ? raw.renewal : null,
    notice_days: notice,
    payment_terms: clean(raw.payment_terms, 500),
    schedule, pages,
    not_found: (Array.isArray(raw.not_found) ? raw.not_found : []).map((x) => clean(x, 100)).filter(Boolean).slice(0, 20),
    summary: clean(raw.summary, 800),
  };
}

const isPdf = (bytes) => Buffer.isBuffer(bytes) && bytes.length > 4 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";

module.exports = {
  MAX_UPLOAD_BYTES, PATTERNS, PATTERN, RENEWALS, NOTICE_LEAD_DAYS, COMING_UP_DAYS,
  clean, isDate, amountOf, pence, pounds, isGuid, isCfo, addDays, day,
  contractInput, sideIssues, datesIssues, scheduleInput, scheduleIssues, movementInput,
  heldAt, deferredEvidence, noticeBy, noticeTask, comingUp,
  READ_SCHEMA, readPrompt, buildReadRequest, parseRead, isPdf,
};

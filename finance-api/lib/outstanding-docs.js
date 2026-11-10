// Outstanding documents (Nik, 10 Nov 2026): transactions a client has not
// supported with a document, carried as open items in the close and listed in
// the management pack. Pure: the routes (lib/outstanding-docs-routes.js) hold
// no rules of their own.
//
// The first load is the client's bank reconciliation reports (Excel or PDF),
// read by Gemini in London into candidate lines a person accepts. An item never
// blocks a sign-off; it is cleared when the document arrives (received) or
// closed without one, with a reason (accepted).
//
// VAT: a cost above the client's threshold (25.00 by default, Nik's rule) with
// no valid VAT invoice is flagged as VAT not recoverable. The amount at risk is
// shown as "up to" one sixth of the gross, the VAT inside a standard-rated
// price, because the bank line does not say what rate was charged. Overseas
// suppliers carry no UK VAT to lose, so they are not counted.

const CONCERNS = {
  no_vat_invoice: { label: "No valid VAT invoice", hint: "A UK cost with no VAT invoice: input VAT cannot be recovered." },
  audit_evidence: { label: "Not enough evidence for audit", hint: "Some support, but not enough for an auditor or due diligence (no invoice, no contract, no delivery)." },
  business_purpose: { label: "Business purpose unclear", hint: "Meals, travel, personal-looking spend: may be personal or belong to the director's loan account." },
  overseas_reverse_charge: { label: "Overseas supplier, reverse charge", hint: "A supplier outside the UK: the invoice is needed to account for reverse charge VAT." },
  unknown_payee: { label: "Payee or nature unknown", hint: "Cannot tell who was paid or what for." },
  other: { label: "Other", hint: "Say what in the note." },
};
const CONCERN_KEYS = Object.keys(CONCERNS);

const STATES = ["candidate", "open", "received", "accepted", "dismissed"];
const ACCEPT_MIN = 15;
const DEFAULT_THRESHOLD = 25;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_NOTE = 2000;

const CFO_ROLE = /^(?:(?:fractional|interim|group|outsourced)\s+)?(?:cfo|chief financial officer|finance director)$/i;
const isCfo = (role) => CFO_ROLE.test(String(role ?? ""));

// ── Values ───────────────────────────────────────────────────────────────────

const pence = (v) => Math.round(Number(v) * 100);
const pounds = (p) => Math.round(p) / 100;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const clean = (v, max = 300) => {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
// Amounts as written in reports: "£1,234.50", "(120.00)", "1 234,50" is not handled (UK reports).
function amountOf(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[£$€\s,]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const monthOf = (date) => String(date).slice(0, 7);

// The sterling value: the amount for a GBP line, the given conversion otherwise.
const gbpOf = (item) => (item.currency === "GBP" ? Number(item.amount) : item.amount_gbp != null ? Number(item.amount_gbp) : null);

// Payee reduced to letters and digits, so "British A 1252202921252" and
// "BRITISH A   1252202921252" are the same payee in a duplicate check.
const payeeKey = (p) => String(p ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);

// Two lines are the same transaction when date, amount, currency and payee
// agree. The company is left out on purpose: a line read before its company
// was set must still meet its twin.
const dupKey = (x) => [x.txn_date, x.direction || "spent", pence(x.amount), x.currency || "GBP", payeeKey(x.payee)].join("|");

// ── VAT ──────────────────────────────────────────────────────────────────────

// { flagged, at_risk_max, reason } for one item.
function vatFlag(item, threshold = DEFAULT_THRESHOLD) {
  if (item.direction === "received") return { flagged: false, at_risk_max: null, reason: null };
  if (item.concern === "overseas_reverse_charge") return { flagged: false, at_risk_max: null, reason: "Overseas supplier: no UK VAT charged" };
  const gbp = gbpOf(item);
  if (gbp == null) return { flagged: true, at_risk_max: null, reason: "Sterling value not known; treated as above the threshold" };
  if (gbp <= Number(threshold)) return { flagged: false, at_risk_max: null, reason: `${fmt(gbp)} is within the ${fmt(threshold)} threshold` };
  return { flagged: true, at_risk_max: pounds(pence(gbp) / 6), reason: `Above ${fmt(threshold)} with no valid VAT invoice: input VAT not recoverable` };
}

const fmt = (n) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── A line read from a report ────────────────────────────────────────────────

// The model's line made safe: checked, trimmed, the company only if it is one
// of this client's. { line, issues }: a line with issues is not saved.
function normaliseLine(raw, entities = []) {
  const issues = [];
  const r = raw || {};
  const txn_date = clean(r.date ?? r.txn_date, 10);
  if (!isDate(txn_date)) issues.push(`date "${r.date ?? r.txn_date ?? ""}" is not a date`);
  const payee = clean(r.payee, 200);
  if (!payee) issues.push("no payee");
  let amount = amountOf(r.amount);
  let direction = r.direction === "received" ? "received" : "spent";
  if (amount != null && amount < 0) { amount = -amount; if (r.direction == null) direction = "spent"; }
  if (amount == null || amount <= 0) issues.push(`amount "${r.amount ?? ""}" is not an amount`);
  const currency = /^[A-Za-z]{3}$/.test(String(r.currency ?? "").trim()) ? String(r.currency).trim().toUpperCase() : "GBP";
  const gbp = amountOf(r.amount_gbp);
  const entitySlug = clean(r.company ?? r.entity, 80);
  const entity = entities.find((e) => e.slug === entitySlug) ?? null;
  const concern = CONCERN_KEYS.includes(r.concern) ? r.concern : "no_vat_invoice";
  return {
    issues,
    line: {
      txn_date, payee, amount: amount != null ? pounds(pence(Math.abs(amount))) : null, direction, currency,
      amount_gbp: currency !== "GBP" && gbp != null && gbp > 0 ? pounds(pence(gbp)) : null,
      bank_account: clean(r.bank_account, 120), reference: clean(r.reference, 300),
      entity_id: entity?.id ?? null, entity_slug: entity?.slug ?? null,
      concern, note: clean(r.note, 500), source_line: clean(r.source_line, 40),
    },
  };
}

// Lines read from one upload, set against what the client already has. Each
// comes back with duplicate_of: the id of a live item it repeats, or null.
//
// Identical lines inside one report are separate transactions: a bank report
// lists each transaction once, and three charges of 690.00 to one supplier on
// one day are three charges (first live load, 10 Nov 2026). So repeats are counted:
// the k-th identical line in this file repeats the k-th live item already
// held, and any beyond those are new.
function markDuplicates(lines, existing = []) {
  const live = new Map();
  for (const x of existing) if (["candidate", "open", "received", "accepted"].includes(x.state)) {
    const k = dupKey(x);
    if (!live.has(k)) live.set(k, []);
    live.get(k).push(x.id);
  }
  const seen = new Map();
  return lines.map((l) => {
    const k = dupKey(l);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return { ...l, duplicate_of: live.get(k)?.[n] ?? null };
  });
}

// ── Reading a report ─────────────────────────────────────────────────────────

const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    report: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", nullable: true },
        organisation: { type: "STRING", nullable: true },
        as_at: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
      },
    },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          bank_account: { type: "STRING", nullable: true },
          date: { type: "STRING", description: "YYYY-MM-DD" },
          payee: { type: "STRING" },
          reference: { type: "STRING", nullable: true },
          direction: { type: "STRING", enum: ["spent", "received"] },
          amount: { type: "NUMBER", description: "Positive, in the bank account's currency" },
          currency: { type: "STRING", description: "ISO code of the bank account's currency" },
          amount_gbp: { type: "NUMBER", nullable: true },
          company: { type: "STRING", nullable: true, description: "One of the company slugs given, or null" },
          concern: { type: "STRING", enum: CONCERN_KEYS },
          note: { type: "STRING", nullable: true },
          source_line: { type: "STRING", nullable: true, description: "Sheet row (e.g. R12) or PDF page (e.g. p2)" },
        },
        required: ["date", "payee", "direction", "amount", "currency", "concern"],
      },
    },
  },
  required: ["lines"],
};

function readPrompt({ fileName, entities }) {
  const companies = entities.map((e) => `- ${e.slug}: ${e.name}${e.legal_name && e.legal_name !== e.name ? ` (${e.legal_name})` : ""}`).join("\n");
  const concerns = CONCERN_KEYS.map((k) => `- ${k}: ${CONCERNS[k].hint}`).join("\n");
  return `You are reading a report a UK accountant uploaded, "${fileName}". It is a bank reconciliation report exported from Xero, or a list of bank transactions the client has not supported with a document (an invoice, receipt or contract).

Take out every individual bank transaction the report lists as unreconciled, outstanding or missing its document. Leave out headings, opening and closing balances, totals, subtotals and anything already reconciled. Never invent a line, and never combine two lines into one.

For each transaction:
- bank_account: the bank account it sits under (the section heading or report title), as written.
- date: YYYY-MM-DD. UK reports write dates day first (03/04/2025 is 3 April 2025).
- payee: who was paid or who paid, as written.
- reference: the reference or description, as written.
- direction: "spent" for money out, "received" for money in.
- amount: positive, in the bank account's own currency (the amount column), never the foreign amount quoted in a reference.
- currency: the bank account's currency (GBP unless the account or column says otherwise).
- amount_gbp: only when the line is not GBP and the report gives a sterling value; otherwise null.
- company: the slug of the company the line belongs to, ONLY if the report's organisation name or the line's own text names it. Otherwise null. The companies:
${companies || "- (none given)"}
- concern: the most likely concern, from:
${concerns}
  Use overseas_reverse_charge only when the supplier is plainly outside the UK (a foreign name, a foreign currency, a foreign place in the text). Use business_purpose for meals, hotels and personal-looking spend. Use unknown_payee when the payee says nothing about what was bought. Otherwise no_vat_invoice.
- note: anything the report itself says about the line (a comment column), else null.
- source_line: the sheet row label (R12) for a spreadsheet, or the page (p2) for a PDF.

Also give report: its title, the organisation it is for, and the date it is as at, when shown.`;
}

// The Vertex request for one upload: a PDF goes in as the file, a spreadsheet
// as its rows in text.
function buildReadRequest({ kind, bytes, sheetText, fileName, entities }) {
  const prompt = readPrompt({ fileName, entities });
  const parts = kind === "pdf"
    ? [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } }, { text: prompt }]
    : [{ text: `${prompt}\n\nThe spreadsheet, one row per line, R<row> first, cells separated by tabs:\n\n${sheetText}` }];
  return {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: READ_SCHEMA, temperature: 0, maxOutputTokens: 65536 },
  };
}

// The model's answer: { report, lines, skipped }. skipped lists lines that
// failed the checks, with why, so the person sees what was not taken.
function parseRead(text, entities) {
  let raw;
  try { raw = typeof text === "string" ? JSON.parse(text) : text; } catch { throw new Error("the reading was not valid JSON"); }
  const lines = [], skipped = [];
  for (const r of Array.isArray(raw?.lines) ? raw.lines : []) {
    const { line, issues } = normaliseLine(r, entities);
    if (issues.length) skipped.push({ source_line: line.source_line, payee: line.payee, issues });
    else lines.push(line);
  }
  const rep = raw?.report || {};
  return {
    report: { title: clean(rep.title, 200), organisation: clean(rep.organisation, 200), as_at: isDate(rep.as_at) ? rep.as_at : null },
    lines, skipped,
  };
}

// When the report names one company and no line was placed, place them all.
function placeByOrganisation(parsed, entities) {
  const org = String(parsed.report.organisation ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!org) return parsed;
  const hit = entities.filter((e) => [e.name, e.legal_name].some((n) => {
    const k = String(n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return k && (org.includes(k) || k.includes(org));
  }));
  if (hit.length !== 1) return parsed;
  return { ...parsed, lines: parsed.lines.map((l) => (l.entity_id ? l : { ...l, entity_id: hit[0].id, entity_slug: hit[0].slug })) };
}

// ── A person's edits and steps ───────────────────────────────────────────────

// Fields a person may change on a candidate or open item. { set, issues }.
function editInput(body, entities) {
  const set = {}, issues = [];
  const b = body || {};
  if ("entity" in b) {
    if (b.entity === null || b.entity === "") set.entity_id = null;
    else {
      const e = entities.find((x) => x.slug === b.entity);
      if (!e) issues.push(`no company ${b.entity} for this client`); else set.entity_id = e.id;
    }
  }
  if ("concern" in b) { if (CONCERN_KEYS.includes(b.concern)) set.concern = b.concern; else issues.push(`concern must be one of ${CONCERN_KEYS.join(", ")}`); }
  if ("note" in b) set.note = b.note == null ? null : String(b.note).trim().slice(0, MAX_NOTE) || null;
  if ("bank_account" in b) set.bank_account = clean(b.bank_account, 120);
  if ("reference" in b) set.reference = clean(b.reference, 300);
  if ("payee" in b) { const p = clean(b.payee, 200); if (p) set.payee = p; else issues.push("payee cannot be empty"); }
  if ("txn_date" in b) { if (isDate(b.txn_date)) set.txn_date = b.txn_date; else issues.push("txn_date must be YYYY-MM-DD"); }
  if ("amount" in b) { const a = amountOf(b.amount); if (a != null && a > 0) set.amount = pounds(pence(a)); else issues.push("amount must be above zero"); }
  if ("direction" in b) { if (["spent", "received"].includes(b.direction)) set.direction = b.direction; else issues.push("direction must be spent or received"); }
  if ("currency" in b) { if (/^[A-Z]{3}$/.test(String(b.currency))) set.currency = b.currency; else issues.push("currency must be a 3-letter code"); }
  if ("amount_gbp" in b) {
    if (b.amount_gbp === null || b.amount_gbp === "") set.amount_gbp = null;
    else { const a = amountOf(b.amount_gbp); if (a != null && a > 0) set.amount_gbp = pounds(pence(a)); else issues.push("amount_gbp must be above zero"); }
  }
  return { set, issues };
}

// A new item a person adds by hand: the same checks as a read line, stricter.
function newItemInput(body, entities) {
  const { line, issues } = normaliseLine({ ...body, date: body?.txn_date ?? body?.date, company: body?.entity }, entities);
  if (!line.entity_id) issues.push("choose the company");
  if (body?.concern && !CONCERN_KEYS.includes(body.concern)) issues.push(`concern must be one of ${CONCERN_KEYS.join(", ")}`);
  if (body?.note) line.note = String(body.note).trim().slice(0, MAX_NOTE);
  return { line, issues };
}

// What a step needs. Returns the issues that stop it; empty means go.
//   step   accept | dismiss | received | accept_without | reopen | chased | edit
const STEP_FROM = {
  accept: ["candidate"],
  dismiss: ["candidate"],
  received: ["open"],
  accept_without: ["open"],
  reopen: ["received", "accepted", "dismissed"],
  chased: ["open"],
  edit: ["candidate", "open"],
};

function stepIssues(step, item, { role, reason, allowDuplicate = false, duplicateState = null } = {}) {
  const issues = [];
  const from = STEP_FROM[step];
  if (!from) return [`unknown step ${step}`];
  if (!from.includes(item.state)) issues.push(`this item is ${item.state}; ${step.replace("_", " ")} applies to ${from.join(" or ")} items`);
  if (step === "accept" && !item.entity_id) issues.push("choose the company first");
  if (step === "accept" && duplicateState && !allowDuplicate) issues.push(`this repeats an item already on the register (${duplicateState}); dismiss it, or accept it as a separate transaction`);
  if (step === "accept_without") {
    if (!isCfo(role)) issues.push("only the CFO closes an item without its document");
    if (String(reason ?? "").trim().length < ACCEPT_MIN) issues.push(`give a reason of at least ${ACCEPT_MIN} characters`);
  }
  return issues;
}

// The state a step leads to.
function stepTarget(step, item) {
  return {
    accept: "open", dismiss: "dismissed", received: "received", accept_without: "accepted",
    reopen: item.state === "dismissed" ? "candidate" : "open", chased: "open", edit: item.state,
  }[step];
}

// ── The register's figures ───────────────────────────────────────────────────

// Open items summed for the close and the pack: count and sterling value, by
// concern, company and month of the transaction, with VAT flagged.
function summary(items, { threshold = DEFAULT_THRESHOLD } = {}) {
  const open = items.filter((x) => x.state === "open");
  const blank = () => ({ count: 0, value_p: 0, unknown_gbp: 0 });
  const total = blank();
  const by = { concern: {}, company: {}, month: {} };
  let vatFlagged = 0, vatAtRiskP = 0;
  const add = (b, x) => {
    b.count += 1;
    const g = gbpOf(x);
    if (g == null) b.unknown_gbp += 1; else b.value_p += pence(x.direction === "received" ? 0 : g);
  };
  for (const x of open) {
    add(total, x);
    add(by.concern[x.concern] ??= blank(), x);
    add(by.company[x.entity_slug ?? "none"] ??= blank(), x);
    add(by.month[monthOf(x.txn_date)] ??= blank(), x);
    const v = vatFlag(x, threshold);
    if (v.flagged) { vatFlagged += 1; if (v.at_risk_max != null) vatAtRiskP += pence(v.at_risk_max); }
  }
  const out = (b) => ({ count: b.count, value: pounds(b.value_p), unknown_gbp: b.unknown_gbp });
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, b]) => [k, out(b)]));
  return {
    open: out(total),
    candidates: items.filter((x) => x.state === "candidate").length,
    by_concern: map(by.concern), by_company: map(by.company),
    by_month: Object.fromEntries(Object.entries(map(by.month)).sort(([a], [b]) => a.localeCompare(b))),
    vat: { flagged: vatFlagged, at_risk_max: pounds(vatAtRiskP), threshold: Number(threshold) },
    oldest: open.reduce((m, x) => (!m || x.txn_date < m ? x.txn_date : m), null),
  };
}

module.exports = {
  CONCERNS, CONCERN_KEYS, STATES, ACCEPT_MIN, DEFAULT_THRESHOLD, MAX_UPLOAD_BYTES, MAX_NOTE, READ_SCHEMA, STEP_FROM,
  isCfo, isDate, amountOf, monthOf, gbpOf, payeeKey, dupKey, vatFlag,
  normaliseLine, markDuplicates, readPrompt, buildReadRequest, parseRead, placeByOrganisation,
  editInput, newItemInput, stepIssues, stepTarget, summary,
};

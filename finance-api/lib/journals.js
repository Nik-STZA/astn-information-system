// The Journals register (migration 033): month-end journals that are not tied
// to a reconciliation. The rules are here, so the routes (lib/journals-routes.js)
// hold none and every rule is tested.
//
// A person or an agent (FM1 or FC) proposes. Only a person with the CFO role
// approves, in os.stza.io, and finance-api then creates the journal in Xero as
// a DRAFT through the one journal write (server.js postManualJournal). Nothing
// here ever asks for POSTED: a person posts it in Xero.

const { toPence, fromPence, validateJournal, isValidIsoDate } = require("./journal");
const recs = require("./recs");

// The agents that may propose. Every other agent, and Claude through the
// practice MCP, is refused: they can raise a task in Work instead.
const PROPOSERS = ["fm1", "fc"];
const MAX_LINES = 100;
const MAX_REASON = 4000;
const STATES = ["proposed", "approved", "draft_created", "posted", "rejected", "superseded"];

// A proposal, from a person or an agent. Returns every issue at once.
//   body    { entity, date, narration, lines, reason }
//   source  'person' | 'agent'
// The period is the date's month: a journal belongs to the month it is dated in.
function journalIssues(body, { source }) {
  const issues = [];
  const b = body || {};
  if (!String(b.entity ?? "").trim()) issues.push("choose the company");
  const narration = String(b.narration ?? "").trim();
  if (!narration) issues.push("narration is required");
  if (narration.length > recs.MAX_NARRATION) issues.push(`keep the narration to ${recs.MAX_NARRATION} characters; the reasoning goes in reason, which stays out of Xero`);
  if (!isValidIsoDate(b.date)) issues.push("date must be a real date, YYYY-MM-DD");
  const reason = String(b.reason ?? "").trim();
  // An agent says why, always: the CFO decides on it. A person may leave it out.
  if (source === "agent" && !reason) issues.push("reason is required");
  if (reason.length > MAX_REASON) issues.push(`keep the reason to ${MAX_REASON} characters`);
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length < 2) issues.push("at least 2 lines are required");
  if (lines.length > MAX_LINES) issues.push(`at most ${MAX_LINES} lines`);
  let net = 0;
  let clean = true;
  for (const [i, l] of lines.entries()) {
    if (!l || typeof l !== "object") { issues.push(`line ${i + 1}: is not a journal line`); clean = false; continue; }
    const p = toPence(l.amount);
    if (p === null || p === 0) { issues.push(`line ${i + 1}: amount must be money, and not zero`); clean = false; } else net += p;
    if (!String(l.account_code ?? "").trim()) issues.push(`line ${i + 1}: account code is required`);
    if (l.description != null && String(l.description).length > 500) issues.push(`line ${i + 1}: keep the description to 500 characters`);
  }
  if (clean && lines.length && net !== 0) issues.push(`the journal does not balance: it is out by ${fromPence(Math.abs(net))}`);
  return issues;
}

// The lines as stored: code and description trimmed, amount to the penny.
const cleanLines = (lines) => lines.map((l) => ({
  account_code: String(l.account_code).trim(),
  description: String(l.description ?? "").trim(),
  amount: Number(fromPence(toPence(l.amount))),
  tax_type: l.tax_type ? String(l.tax_type) : "NONE",
}));

// The total, as the list shows it: the sum of the debits.
const totalOf = (lines) => fromPence((Array.isArray(lines) ? lines : []).reduce((a, l) => a + Math.max(toPence(l?.amount) ?? 0, 0), 0));

// What Xero's chart and lock dates say about a proposal, using the same rules
// as the journal write so a person hears now what would stop it at approval.
// The approval rules are left out: there is no approval yet.
function ledgerIssues(body, { accounts, lockDates, entityNames }) {
  const { issues } = validateJournal({ ...body, approval: undefined }, {
    accounts, lockDates: lockDates ?? {}, now: Date.now(), entityNames,
  });
  return issues.filter((i) => ["UNKNOWN_ACCOUNT", "ARCHIVED_ACCOUNT", "BANK_ACCOUNT", "PERIOD_LOCKED"].includes(i.code)).map((i) => i.detail);
}

// The key a register journal reaches Xero under. It belongs to the journal and
// its attempt, so approving twice cannot make two drafts, and only an attempt
// Xero definitely refused moves it on.
const journalKey = (j) => `journal-${j.id}-${j.attempts ?? 1}`;

// A claim still pending this long is a crash part-way, not a call in flight:
// the Xero call times out after 30 seconds.
const PENDING_LIVE_MINUTES = 5;

// Whether approving again is safe, from the journal_posts row for the current
// key. The same answers as a rec journal (lib/recs.js retryState), with no run:
// finance-api makes the call itself, so "live" is a claim still in flight.
function attemptState(post, now = Date.now()) {
  const live = post?.outcome === "pending" && now - Date.parse(post.created_at) < PENDING_LIVE_MINUTES * 60_000;
  // A stale pending claim is neither a draft nor a refusal: retryState calls it unknown.
  return recs.retryState({ runLive: live, post: post ?? null });
}

// The text the approval records as shown to the CFO: the stored journal as the
// Journals page shows it. The journal write checks it names the company, the
// date, every code and every amount, as it does for any approval.
function presentedText(j, entityName) {
  const lines = (j.lines ?? []).map((l) => `${l.account_code}${l.description ? ` ${l.description}` : ""} ${Number(l.amount) > 0 ? "Dr" : "Cr"} ${fromPence(Math.abs(toPence(l.amount)))}`);
  return `Journal for ${entityName}, dated ${String(j.journal_date).slice(0, 10)}: ${j.narration}. ${lines.join("; ")}. Total ${totalOf(j.lines)}.`;
}

const AGREED_TEXT = "Approved as a Xero draft on the Journals page in os.stza.io.";

// The approval block the journal write needs, from the CFO's click.
const approvalFor = (j, { entityName, actorEmail, now = new Date() }) => ({
  approved_by: actorEmail,
  approved_at: now.toISOString(),
  presented_text: presentedText(j, entityName),
  agreed_text: AGREED_TEXT,
});

// What the CFO is told when an approval did not end in a draft.
//   out  postManualJournal's { status, body, sent }
function failureText(out) {
  const b = out.body ?? {};
  if (Array.isArray(b.issues) && b.issues.length) return b.issues.map((i) => i.detail ?? String(i)).join(" ");
  if (b.stage === "xero") {
    const errs = b.xero_error?.Elements?.flatMap((e) => (e.ValidationErrors ?? []).map((v) => v.Message)) ?? [];
    return `Xero refused it${b.http_status ? ` (${b.http_status})` : ""}${errs.length ? `: ${errs.join(" ")}` : ""}.`;
  }
  return String(b.error ?? `It did not reach Xero (${out.status}).`);
}

// What Xero's status for a draft means for the register. Only POSTED moves it:
// voided or deleted is reported, and a person decides what to do.
const stateFromXero = (status) => (String(status ?? "").toUpperCase() === "POSTED" ? "posted" : null);

// The gate at the journal write for every caller but the register itself. A
// journal waiting on the Journals page reaches Xero only through the CFO's
// approval there: a reply in a chat ("approved") is not that approval.
//   proposals  this company's register journals, not superseded
//   input      { date, lines }
// Held when it has the same amounts as one still waiting or approved, on any
// date, or as any of that month's, including one rejected or already drafted,
// so a rejected journal cannot be sent round the side and a draft not made twice.
function registerGate({ proposals, input }) {
  const same = recs.amountsKey(input?.lines);
  const month = String(input?.date ?? "").slice(0, 7);
  const hit = (proposals ?? []).find((p) => recs.amountsKey(p.lines) === same
    && (["proposed", "approved"].includes(p.state) || String(p.journal_date).slice(0, 7) === month));
  if (!hit) return {};
  return { refuse: hit.state === "rejected"
    ? "The CFO rejected this journal on the Journals page. Propose it again there if it is still needed."
    : "This journal is on the Journals page. The CFO approves it there, and it goes to Xero from there." };
}

// Where a journal in the list came from: person, fm1, fc, or rec for one
// proposed on a reconciliation (read-only on the Journals page).
function sourceOf(row) {
  if (row.kind === "rec") return "rec";
  if (row.source === "person") return "person";
  if (row.source === "schedule") return "schedule";
  const m = /^agent:(.+)$/.exec(String(row.proposed_by ?? ""));
  return m ? m[1] : "agent";
}

// The number a person and an agent both use for a journal: JNL-7. Per client,
// shared by a rec's journals and the register's (migration 036).
function jnlRef(n) {
  return n == null ? null : `JNL-${n}`;
}

module.exports = {
  jnlRef,
  PROPOSERS, MAX_LINES, STATES, AGREED_TEXT, PENDING_LIVE_MINUTES,
  journalIssues, cleanLines, totalOf, ledgerIssues, journalKey, attemptState, presentedText, approvalFor, failureText, stateFromXero, sourceOf, registerGate,
};

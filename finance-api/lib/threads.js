// Threads (migration 050): one thread per thing the work is about, shown on
// every page where that thing appears and read by the agents as context.
// Everything here is pure; threads-routes.js reads and writes the rows.
//
// An entry is a note, a question, a hold, a decision or (from an agent) a
// finding. One that waits on a person has needs_decision; it stays open until
// a reply of kind decision answers it. Entries are never edited or deleted.

const SUBJECTS = ["account", "asset", "cost_line", "reconciliation", "register_month"];
const KINDS = ["note", "question", "hold", "decision", "finding"];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BODY = 4000;

// The shape each subject's key takes.
function subjectIssue(kind, key) {
  const k = String(key ?? "").trim();
  if (!SUBJECTS.includes(kind)) return `subject_kind must be one of ${SUBJECTS.join(", ")}`;
  if (!k) return "subject_key is required";
  if (kind === "account") return /^[0-9a-f-]{36}:[A-Za-z0-9.-]{1,20}$/i.test(k) && GUID.test(k.split(":")[0]) ? null : "an account's key is <company id>:<account code>";
  if (kind === "register_month") return /^[a-z_]{3,40}$/.test(k) ? null : "a register month's key is the grouping";
  return GUID.test(k) ? null : `a ${kind.replace("_", " ")}'s key is its id`;
}

// A new entry from a person or an agent, cleaned, with why it cannot be made.
//   via   { kind: "agent", agent, run_id } when an agent writes it, else null
function entryInput(body = {}, via = null) {
  const issues = [];
  const subject_kind = String(body.subject_kind ?? "");
  const subject_key = String(body.subject_key ?? "").trim();
  const s = subjectIssue(subject_kind, subject_key);
  if (s) issues.push(s);
  const period = body.period == null || body.period === "" ? null : String(body.period);
  if (period && !PERIOD.test(period)) issues.push("period must be YYYY-MM");
  if ((subject_kind === "account" || subject_kind === "register_month") && !period) issues.push(`an ${subject_kind.replace("_", " ")} thread needs its period`);
  const kind = String(body.kind ?? "note");
  if (!KINDS.includes(kind)) issues.push(`kind must be one of ${KINDS.join(", ")}`);
  if (kind === "finding" && via?.kind !== "agent") issues.push("only an agent records a finding");
  const text = String(body.body ?? "").trim();
  if (!text) issues.push("say something: the entry is empty");
  if (text.length > MAX_BODY) issues.push(`keep an entry under ${MAX_BODY} characters`);
  const parent_id = body.parent_id ? String(body.parent_id) : null;
  if (parent_id && !GUID.test(parent_id)) issues.push("parent_id must be an id");
  const needs_decision = body.needs_decision === true;
  if (needs_decision && parent_id) issues.push("a reply cannot itself wait on a decision: start a new entry");
  if (needs_decision && kind === "decision") issues.push("a decision does not wait on one");
  return { issues, entry: { subject_kind, subject_key, period, parent_id, kind, body: text, needs_decision } };
}

// Which entries still wait on a person: those that need a decision and have
// no reply of kind decision.
function openIds(entries) {
  const decided = new Set(entries.filter((e) => e.parent_id && e.kind === "decision").map((e) => e.parent_id));
  return new Set(entries.filter((e) => e.needs_decision && !e.parent_id && !decided.has(e.id)).map((e) => e.id));
}

// Initials from a name: first letters of the first and last words, upper case.
function initialsOf(name, email) {
  const words = String(name ?? "").trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const pick = (w) => (w.match(/[A-Za-z0-9]/) || [""])[0].toUpperCase();
  if (words.length >= 2) return pick(words[0]) + pick(words[words.length - 1]);
  if (words.length === 1) return words[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  return String(email ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

// A profile change from its owner, cleaned.
function profileInput(body = {}) {
  const issues = [];
  const display_name = String(body.display_name ?? "").trim();
  if (!display_name) issues.push("a display name is required");
  if (display_name.length > 80) issues.push("keep the name under 80 characters");
  const initials = String(body.initials ?? "").trim().toUpperCase() || initialsOf(display_name);
  if (!/^[A-Z0-9]{1,4}$/.test(initials)) issues.push("initials are 1 to 4 letters or digits");
  const title = body.title == null ? null : String(body.title).trim() || null;
  if (title && title.length > 80) issues.push("keep the title under 80 characters");
  return { issues, profile: { display_name, initials, title } };
}

// The agent's pseudo-address in finance.people.
const agentEmail = (agent) => `${agent}@agents.stza.io`;

// Entries as the page shows them: newest thread first, replies under their
// entry in order, each with who wrote it (initials, name) and whether it waits.
function shape(entries, people) {
  const who = (email) => people.get(String(email ?? "").toLowerCase()) ?? { initials: initialsOf(null, email), display_name: email };
  const open = openIds(entries);
  const person = (e) => {
    const p = who(e.author_email);
    const a = e.via_agent ? who(agentEmail(e.via_agent)) : null;
    return {
      initials: a ? a.initials : p.initials,
      name: a ? `${a.display_name}, for ${p.display_name}` : p.display_name,
      on_behalf_of: a ? p.initials : null,
      role: e.actor_role ?? null,
    };
  };
  const out = (e) => ({ id: e.id, subject_kind: e.subject_kind, subject_key: e.subject_key, period: e.period, kind: e.kind,
    body: e.body, needs_decision: e.needs_decision, open: open.has(e.id), created_at: e.created_at, by: person(e), via_agent: e.via_agent ?? null });
  const top = entries.filter((e) => !e.parent_id);
  return top
    .map((e) => ({ ...out(e), replies: entries.filter((r) => r.parent_id === e.id).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at))).map(out) }))
    .sort((x, y) => (Number(y.open) - Number(x.open)) || String(y.created_at).localeCompare(String(x.created_at)));
}

module.exports = { SUBJECTS, KINDS, subjectIssue, entryInput, openIds, initialsOf, profileInput, agentEmail, shape };

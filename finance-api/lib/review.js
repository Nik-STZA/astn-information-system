// The Review inbox: one list of everything waiting on a person for a client,
// whatever produced it. Bills from the AP lane, reconciliations at review or
// sign-off, the journals proposed on them, the register's journals, and the
// Approvals folder items. Pure, so it is tested without a database; the routes
// in lib/review-routes.js read the rows and hand them here.
//
// Nothing here decides a state. Each source's own rules say what an item is
// (recs.retryState, journals.attemptState, the folder a WIP item sits in); this
// only says who it is waiting on and where it is acted on. Acting stays on each
// item's own screen, with that screen's CFO and FC rules.

const recs = require("./recs");
const journals = require("./journals");

// Who an item waits on. CFO and FC are engagement roles. Preparer is whoever
// does the work below review, a person or an agent. FM is the first review tier
// of the Approvals folders (pending-fm), and Outside is a third party
// (blocked-external). The last two exist only because the Approvals folders
// have them, and leaving those items out would hide them.
const WAITS = ["CFO", "FC", "FM", "Preparer", "Outside"];

// The FC role, without the CFO (recs.REVIEW_ROLE accepts both, because a CFO
// may review; here the question is which queue is the viewer's own).
const FC_ROLE = /^(?:(?:fractional|interim|group|outsourced)\s+)?(?:fc|financial controller)$/i;

// The viewer's engagement role as a queue: CFO, FC, or none of the review tiers.
function waitsAs(role) {
  if (recs.CFO_ROLE.test(String(role ?? ""))) return "CFO";
  if (FC_ROLE.test(String(role ?? ""))) return "FC";
  return null;
}

// agent:fm1 -> FM1, ap-clerk -> AP Clerk; a person stays as their address.
const AGENT_NAMES = { "ap-clerk": "AP Clerk", fm1: "FM1", fm2: "FM2", fc: "FC", "ar-clerk": "AR Clerk", fpa: "FP&A" };
function producedBy(actor) {
  if (!actor) return null;
  const m = /^agent:(.+)$/.exec(String(actor));
  const name = m ? m[1] : String(actor);
  if (AGENT_NAMES[name.toLowerCase()]) return AGENT_NAMES[name.toLowerCase()];
  return m ? name.toUpperCase() : name;
}

const iso = (t) => (t ? new Date(t).toISOString() : null);
const enc = encodeURIComponent;
const clientBase = (slug) => `/finance/clients/${enc(slug)}`;

// ── Bills ────────────────────────────────────────────────────────────────────

const BILL_OPEN = ["exception", "clean", "approved"];
const BILL_RUNNER = { ap: "ap-clerk", fm2: "fm2", fc: "fc" };

// Which agent has a bill now, if any. The same reading as the Bills screen
// (src/modules/finance/lib/ap-agents.ts, billProgress), which finance-api cannot
// import: the AP Clerk until it recommends, then FM2 until it reviews, then the
// FC only if the FC is running. A bill whose agent is not running is with the
// CFO, so nothing is left unseen.
function billAgent(row, activeAgents) {
  if (!BILL_OPEN.includes(row.state)) return null;
  const reviewers = row.review_agents ?? [];
  const fm2Done = reviewers.some((r) => r !== "fc") || (reviewers.length === 0 && Boolean(row.review_verdict));
  const fcDone = reviewers.includes("fc");
  const running = (step) => activeAgents.includes(BILL_RUNNER[step]);
  let due = null;
  if (!row.recommended) due = "ap";
  else if (!fm2Done) due = "fm2";
  else if (!fcDone && running("fc")) due = "fc";
  return due && running(due) ? due : null;
}

function billItem(row, { slug, activeAgents = [] }) {
  if (!BILL_OPEN.includes(row.state)) return null;
  const agent = billAgent(row, activeAgents);
  const reasons = Array.isArray(row.reasons) ? row.reasons.length : 0;
  const status = agent
    ? `With ${producedBy(BILL_RUNNER[agent])} now`
    : row.state === "approved" ? "Approved, waiting to be sent to Xero"
      : row.state === "exception" ? `Needs a decision: ${reasons} check${reasons === 1 ? "" : "s"} to look at`
        : "Clean, ready to approve";
  const name = row.supplier || row.file_name || "A bill";
  return {
    kind: "bill",
    id: row.id,
    title: row.number ? `${name}, ${row.number}` : name,
    company: row.entity_name ?? null,
    amount: row.total ?? null,
    currency: row.currency ?? null,
    waiting_on: agent ? "Preparer" : "CFO",
    // When it reached the person: the decision for an approved bill, else the
    // last agent's word on it, else when it arrived.
    since: iso(row.state === "approved" ? row.decided_at ?? row.created_at : row.reviewed_at ?? row.recommended_at ?? row.created_at),
    produced_by: row.recommended ? producedBy(row.recommendation_agent || "ap-clerk") : row.source === "ledger_draft" ? "Xero bills inbox" : "Documents inbox",
    status,
    href: `${clientBase(slug)}/bills?entity=${enc(row.entity_slug)}&tab=${agent ? "agents" : "exceptions"}&item=${enc(row.id)}`,
  };
}

// ── Reconciliations ──────────────────────────────────────────────────────────

// with_fc and with_cfo are a review step; sent_back is back with the preparer,
// and is listed so a returned rec is not lost between screens.
const REC_WAIT = { with_fc: "FC", with_cfo: "CFO", sent_back: "Preparer" };

function recItem(row, { slug }) {
  const waiting = REC_WAIT[row.status];
  if (!waiting || row.dropped_at) return null;
  const words = { with_fc: "Prepared, needs FC review", with_cfo: "Passed review, needs sign-off", sent_back: "Sent back to the preparer" }[row.status];
  const note = row.status === "sent_back" && row.review_note ? `: ${String(row.review_note).slice(0, 140)}` : "";
  const recheck = row.recheck_reason ? ". A figure moved after it was prepared" : "";
  return {
    kind: "rec",
    id: row.id,
    title: `${row.account_name}, ${recs.periodLabel(row.period)}`,
    company: "Group",
    amount: null,
    currency: null,
    waiting_on: waiting,
    since: iso({ with_fc: row.prepared_at, with_cfo: row.reviewed_at, sent_back: row.updated_at }[row.status] ?? row.updated_at),
    produced_by: producedBy(row.prepared_by ?? row.owner),
    status: `${words}${note}${recheck}`,
    href: `${clientBase(slug)}/reconciliations/${enc(row.id)}`,
  };
}

// ── Journals ─────────────────────────────────────────────────────────────────

// An approved journal is waiting on the CFO unless it is being made in Xero
// right now. The retry states are each source's own.
const AFTER_APPROVAL = {
  go: "Approved, but the run ended before a draft was made. Approve again",
  retry: "Xero refused the last attempt. Approve again or reject",
  unknown: "The last attempt did not finish cleanly, so it may be in Xero. Check Xero first",
  drafted: "In Xero as a draft. Open it to bring the record up to date",
};

function recJournalItem(row, { slug, now = Date.now() }) {
  if (!["proposed", "approved"].includes(row.state)) return null;
  let retry = null;
  if (row.state === "approved") {
    retry = recs.retryState({
      runLive: recs.runIsLive({ status: row.run_status, queued_at: row.run_queued_at }, now),
      post: row.post_outcome ? { outcome: row.post_outcome, http_status: row.post_http } : null,
    });
    if (retry === "live") return null;
  }
  return {
    kind: "rec_journal",
    id: row.id,
    title: row.narration,
    company: row.entity_name ?? null,
    amount: journals.totalOf(row.lines),
    currency: null,
    waiting_on: "CFO",
    since: iso(row.state === "approved" ? row.approved_at ?? row.created_at : row.created_at),
    produced_by: producedBy(row.proposed_by),
    status: retry ? AFTER_APPROVAL[retry] : `Proposed on ${row.account_name ?? "a reconciliation"}, ${recs.periodLabel(row.period)}`,
    href: `${clientBase(slug)}/reconciliations/${enc(row.rec_id)}`,
  };
}

function journalItem(row, { slug, now = Date.now() }) {
  if (!["proposed", "approved"].includes(row.state)) return null;
  let retry = null;
  if (row.state === "approved") {
    retry = journals.attemptState(row.post_outcome ? { outcome: row.post_outcome, http_status: row.post_http, created_at: row.post_at } : null, now);
    if (retry === "live") return null;
  }
  const source = journals.sourceOf({ kind: "register", source: row.source, proposed_by: row.proposed_by });
  const last = row.last_error ? `. Last time: ${String(row.last_error).slice(0, 140)}` : "";
  // finance-api makes the register's draft itself, so there is no run to end.
  const after = retry === "go" ? "Approved, but nothing reached Xero. Approve again" : AFTER_APPROVAL[retry];
  return {
    kind: "journal",
    id: row.id,
    title: row.narration,
    company: row.entity_name ?? null,
    amount: journals.totalOf(row.lines),
    currency: null,
    waiting_on: "CFO",
    since: iso(row.state === "approved" ? row.approved_at ?? row.created_at : row.created_at),
    produced_by: source === "person" ? row.proposed_by : producedBy(source),
    status: `${retry ? after : `Proposed for ${recs.periodLabel(row.period)}`}${last}`,
    href: `${clientBase(slug)}/journals?period=${enc(row.period)}`,
  };
}

// ── The Approvals folders ────────────────────────────────────────────────────

// A WIP item's state is the folder it sits in. Each live folder maps to who has
// it. Posted and rejected are finished, and the upcoming panel is not yet due,
// so neither is waiting on anyone; both stay on the Approvals board.
const WIP_WAIT = {
  "pending-cfo": "CFO", "pending-fc": "FC", "pending-fm": "FM", drafting: "Preparer", "sent-back": "Preparer",
};
const WIP_WORDS = {
  "pending-cfo": "Awaiting the CFO's decision", "pending-fc": "With the FC", "pending-fm": "With the FM",
  drafting: "Being drafted", "sent-back": "Sent back",
};
const WIP_PANELS = ["awaiting-decision", "blocked-external", "in-progress-upstream"];
const WIP_TYPES = { ap: "AP", ar: "AR", vat: "VAT", fpa: "FP&A", tax: "Tax", "month-end": "Month-end", reconciliation: "Reconciliation" };

function approvalItem(row, { slug }) {
  if (!WIP_PANELS.includes(row.panel)) return null;
  const blocked = row.panel === "blocked-external";
  const waiting = blocked ? "Outside" : WIP_WAIT[row.status];
  if (!waiting) return null;
  const type = WIP_TYPES[row.type] ?? row.type;
  const words = blocked ? `Waiting on ${row.blocked_on || "someone outside"}` : WIP_WORDS[row.status];
  return {
    kind: "approval",
    id: row.id,
    title: row.title,
    company: row.entity_name || "Group",
    amount: row.amount_total ?? null,
    currency: null,
    waiting_on: waiting,
    since: iso(row.updated_at ?? row.drafted_at ?? row.created_at),
    produced_by: producedBy(row.drafter_agent) ?? row.drafter_email ?? row.drafter_role ?? null,
    status: type ? `${type}: ${words}` : words,
    href: `${clientBase(slug)}/approvals?item=${enc(row.ref)}`,
  };
}

// ── Together ─────────────────────────────────────────────────────────────────

// One list, oldest first, each marked for the viewer when it waits on their
// role. An item with no time sorts last rather than first, so it is not read
// as the oldest thing in the queue.
function combine(items, viewerWaitsAs) {
  const time = (i) => (i.since ? Date.parse(i.since) : Number.POSITIVE_INFINITY);
  return items
    .filter(Boolean)
    .map((i) => ({ ...i, for_you: Boolean(viewerWaitsAs) && i.waiting_on === viewerWaitsAs }))
    .sort((a, b) => time(a) - time(b) || a.kind.localeCompare(b.kind) || String(a.title).localeCompare(String(b.title)));
}

function counts(items) {
  const byKind = {};
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  return { total: items.length, for_you: items.filter((i) => i.for_you).length, by_kind: byKind };
}

module.exports = {
  WAITS, FC_ROLE, waitsAs, producedBy, billAgent, billItem, recItem, recJournalItem, journalItem, approvalItem, combine, counts,
};

// Work (redesign step 3; migration 024): tasks, sub-tasks, blockers and their
// history. Everything here is pure; the routes read and write the rows.
//
// A task's shown status is computed from what a person set and what holds it
// up: an open task with an unresolved task or Bills blocker is Blocked; one
// waiting only on someone outside is Waiting. A task or Bills blocker counts
// as resolved as soon as that task is done or that bill is decided, even
// before the row is marked, so the screen is never behind the facts.

const STATUSES = ["todo", "in_progress", "review", "done"];
const PRIORITIES = ["P1", "P2", "P3"];
const AGENTS = ["ap-clerk", "ar-clerk", "fm1", "fm2", "fc", "fpa"];
const BILL_DECIDED = ["written", "rejected", "superseded", "skipped"];
const EDITABLE = ["title", "notes", "status", "priority", "owner_kind", "owner", "start_on", "due_on", "parent_id", "entity_id", "position"];

const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const ymd = (d) => (d == null ? null : (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)));

// The fields a create or edit may set, cleaned, and why any cannot be.
//   partial  true for an edit: only the fields sent are checked and returned
function taskInput(body = {}, { partial = false, current = null } = {}) {
  const issues = [];
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  for (const k of Object.keys(body)) if (!EDITABLE.includes(k)) issues.push(`${k} cannot be set here`);

  if (!partial || has("title")) {
    const t = String(body.title ?? "").trim();
    if (!t) issues.push("a title is required");
    else if (t.length > 300) issues.push("the title is over 300 characters");
    else out.title = t;
  }
  if (has("notes")) out.notes = body.notes == null ? null : String(body.notes).slice(0, 10000);
  if (has("status")) {
    if (!STATUSES.includes(body.status)) issues.push(`status must be one of ${STATUSES.join(", ")}`);
    else out.status = body.status;
  }
  if (has("priority")) {
    if (body.priority != null && !PRIORITIES.includes(body.priority)) issues.push("priority must be P1, P2 or P3");
    else out.priority = body.priority ?? null;
  }
  if (has("owner_kind") || has("owner")) {
    const kind = body.owner_kind ?? null;
    const owner = body.owner == null ? null : String(body.owner).trim() || null;
    if ((kind == null) !== (owner == null)) issues.push("owner and owner_kind go together");
    else if (kind === "person" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) issues.push("a person owner is an email address");
    else if (kind === "agent" && !AGENTS.includes(owner)) issues.push(`an agent owner is one of ${AGENTS.join(", ")}`);
    else if (kind != null && !["person", "agent"].includes(kind)) issues.push("owner_kind is person or agent");
    else { out.owner_kind = kind; out.owner = owner; }
  }
  for (const k of ["start_on", "due_on"]) {
    if (has(k)) {
      if (body[k] != null && body[k] !== "" && !isDate(body[k])) issues.push(`${k} must be a date (YYYY-MM-DD)`);
      else out[k] = body[k] || null;
    }
  }
  const start = has("start_on") ? out.start_on : ymd(current?.start_on);
  const due = has("due_on") ? out.due_on : ymd(current?.due_on);
  if (start && due && start > due) issues.push("the start date is after the due date");
  for (const k of ["parent_id", "entity_id"]) {
    if (has(k)) {
      if (body[k] != null && !isGuid(body[k])) issues.push(`${k} must be an id`);
      else out[k] = body[k] ?? null;
    }
  }
  if (current && out.parent_id && out.parent_id === current.id) issues.push("a task cannot be its own parent");
  if (has("position")) {
    if (!Number.isInteger(body.position)) issues.push("position must be a whole number");
    else out.position = body.position;
  }
  return { issues, fields: out };
}

// Whether a blocker still holds, given what it points at.
//   blockingTask  { status, deleted_at } for kind task
//   apItem        { state } for kind ap_item
function blockerOpen(b, { blockingTask = null, apItem = null } = {}) {
  if (b.resolved_at) return false;
  if (b.kind === "task") return !!blockingTask && blockingTask.status !== "done" && !blockingTask.deleted_at;
  if (b.kind === "ap_item") return !apItem || !BILL_DECIDED.includes(apItem.state);
  return true;
}

// The status shown: done stays done; otherwise blockers decide.
//   openBlockers  the task's blockers that still hold
function shownStatus(task, openBlockers = []) {
  if (task.status === "done") return "done";
  if (openBlockers.some((b) => b.kind === "task" || b.kind === "ap_item")) return "blocked";
  if (openBlockers.some((b) => b.kind === "external")) return "waiting";
  return task.status;
}

// A blocker as sent, cleaned, and why it cannot be.
function blockerInput(body = {}) {
  const issues = [];
  const kind = body.kind;
  const out = { kind };
  if (kind === "task") {
    if (!isGuid(body.blocking_task_id)) issues.push("blocking_task_id must be a task id");
    else out.blocking_task_id = body.blocking_task_id;
  } else if (kind === "ap_item") {
    if (!isGuid(body.ap_item_id)) issues.push("ap_item_id must be a Bills item id");
    else out.ap_item_id = body.ap_item_id;
  } else if (kind === "external") {
    const party = String(body.party ?? "").trim();
    if (!party) issues.push("say who it is waiting on (client, supplier, HMRC...)");
    else out.party = party.slice(0, 120);
  } else {
    issues.push("kind must be task, ap_item or external");
  }
  out.description = body.description == null ? null : String(body.description).trim().slice(0, 1000) || null;
  if (body.chase_on != null && body.chase_on !== "") {
    if (!isDate(body.chase_on)) issues.push("chase_on must be a date (YYYY-MM-DD)");
    else out.chase_on = body.chase_on;
  }
  return { issues, fields: out };
}

// Would "task waits for blocker" close a loop? edges: [{ task_id, blocking_task_id }]
// for the open task blockers. A loop would leave both tasks blocked for ever.
function wouldLoop(taskId, blockingId, edges = []) {
  if (taskId === blockingId) return true;
  const next = new Map();
  for (const e of edges) {
    if (!next.has(e.task_id)) next.set(e.task_id, []);
    next.get(e.task_id).push(e.blocking_task_id);
  }
  // Does blockingId (transitively) wait for taskId?
  const seen = new Set();
  const stack = [blockingId];
  while (stack.length) {
    const t = stack.pop();
    if (t === taskId) return true;
    if (seen.has(t)) continue;
    seen.add(t);
    stack.push(...(next.get(t) || []));
  }
  return false;
}

// Would making parentId the parent close a loop in the task tree?
// tasks: [{ id, parent_id }]
function wouldNestLoop(taskId, parentId, tasks = []) {
  const parentOf = new Map(tasks.map((t) => [t.id, t.parent_id]));
  let p = parentId;
  for (let i = 0; p && i < 1000; i += 1) {
    if (p === taskId) return true;
    p = parentOf.get(p);
  }
  return false;
}

// What an edit changed, for the history: { field: { from, to } }.
function changes(before, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    const was = ["start_on", "due_on"].includes(k) ? ymd(before[k]) : before[k] ?? null;
    if (String(was ?? "") !== String(v ?? "")) out[k] = { from: was, to: v ?? null };
  }
  return out;
}

module.exports = {
  STATUSES, PRIORITIES, AGENTS, BILL_DECIDED,
  taskInput, blockerInput, blockerOpen, shownStatus, wouldLoop, wouldNestLoop, changes, isGuid,
};

// ── Bringing open items in (Nik, 27 Oct 2026: Work is the master) ────────────
//
// The open-items register (open-items.md, mirrored in finance.open_items) is
// imported once as tasks. Its statuses are free text; what they say decides
// the task's status and any outside blocker. Anything the register says that
// has no field of its own goes into the task's notes, so nothing is lost.

const DONE_RE = /^\s*done([^a-z0-9]|$)/i;

// What one open item becomes, or null when it is already done.
//   o  a finance.open_items row
function openItemTask(o) {
  const status = String(o.status ?? "").trim();
  if (o.is_closed || DONE_RE.test(status)) return null;
  let taskStatus = "todo";
  if (/^in progress/i.test(status) || /^partially done/i.test(status)) taskStatus = "in_progress";
  const blockers = [];
  const ext = /awaiting external \(([^)]+)\)/i.exec(status);
  const decision = /pending ([A-Za-z]+) decision/i.exec(status);
  if (ext) blockers.push({ kind: "external", party: ext[1].trim().slice(0, 120), description: status.slice(0, 1000) });
  else if (decision) blockers.push({ kind: "external", party: decision[1].trim(), description: status.slice(0, 1000) });
  const lines = [
    o.notes ? String(o.notes).trim() : null,
    "From the open-items register:",
    o.ref ? `Ref: ${o.ref}` : null,
    status ? `Status: ${status}` : null,
    o.owner_label ? `Owner: ${o.owner_label}` : null,
    o.category ? `Category: ${o.category}` : null,
    o.raised_at ? `Raised: ${String(o.raised_at instanceof Date ? o.raised_at.toISOString() : o.raised_at).slice(0, 10)}` : null,
    o.amount_gbp != null ? `Amount: GBP ${Number(o.amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : null,
  ].filter(Boolean);
  return {
    task: {
      title: String(o.title).trim().slice(0, 300),
      notes: lines.join("\n").slice(0, 10000),
      status: taskStatus,
      priority: PRIORITIES.includes(o.priority) ? o.priority : null,
      due_on: o.due_at ? String(o.due_at instanceof Date ? o.due_at.toISOString() : o.due_at).slice(0, 10) : null,
      entity_id: o.entity_id || null,
      source: "open_item",
      source_ref: o.id,
    },
    blockers,
  };
}

module.exports.openItemTask = openItemTask;

// ── Who a change came through (agents and Claude, 28 Oct 2026) ───────────────
//
// An agent run or a Claude conversation changes Work as the person who asked
// (the role check is theirs), and says so in the X-Work-Via header:
//   agent:<agent>:<run id>   an agent run in os.stza.io
//   claude                   a Claude conversation through the MCP server
// The portal never sends it, so a person cannot pass a change off as an agent's.
// X-Work-Ref, with it, names the item so the same thing sent twice is one task.

// { via, source, issues }: via is null when the header is absent.
function viaInput(header, ref) {
  const h = String(header ?? "").trim();
  const r = String(ref ?? "").trim();
  if (!h) return { via: null, source: null, ref: null, issues: r ? ["X-Work-Ref needs X-Work-Via"] : [] };
  const issues = [];
  let via = null;
  const m = /^agent:([a-z0-9-]+):([0-9a-f-]{36})$/i.exec(h);
  if (m) {
    if (![...AGENTS, "general"].includes(m[1])) issues.push(`the agent must be one of ${AGENTS.join(", ")} or general`);
    else if (!isGuid(m[2])) issues.push("the run id must be an id");
    else via = { kind: "agent", agent: m[1], run_id: m[2].toLowerCase() };
  } else if (h === "claude") {
    via = { kind: "claude" };
  } else {
    issues.push("X-Work-Via must be agent:<agent>:<run id> or claude");
  }
  if (r.length > 200) issues.push("X-Work-Ref is over 200 characters");
  return { via: issues.length ? null : via, source: via?.kind ?? null, ref: r || null, issues };
}

module.exports.viaInput = viaInput;

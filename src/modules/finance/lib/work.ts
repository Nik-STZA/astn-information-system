// Work (redesign step 3): the portal side of finance-api's task routes.
// Server-only fetches live at the bottom; the rest is pure, so it is tested
// and safe on either side.

export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type ShownStatus = TaskStatus | "blocked" | "waiting";

export interface TaskBlocker {
  id: string;
  task_id: string;
  kind: "task" | "ap_item" | "external";
  open: boolean;
  since: string;
  chase_on: string | null;
  description: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  party: string | null;
  task: { id: string; title: string; status: TaskStatus } | null;
  bill: { id: string; supplier: string | null; total: string | null; currency: string | null; state: string | null; entity: string | null } | null;
}

export interface Task {
  id: string;
  parent_id: string | null;
  entity_id: string | null;
  entity_slug: string | null;
  entity_name: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  shown_status: ShownStatus;
  priority: "P1" | "P2" | "P3" | null;
  owner_kind: "person" | "agent" | null;
  owner: string | null;
  start_on: string | null;
  due_on: string | null;
  position: number;
  source: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  blockers: TaskBlocker[];
  holds_up: string[];
}

export interface TaskEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export const STATUS_LABEL: Record<ShownStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  waiting: "Waiting",
  review: "Needs review",
  done: "Done",
};

// What a person can set; Blocked and Waiting come from blockers.
export const SETTABLE: TaskStatus[] = ["todo", "in_progress", "review", "done"];

export const AGENTS: Array<{ value: string; label: string; initials: string }> = [
  { value: "ap-clerk", label: "AP Clerk", initials: "AP" },
  { value: "ar-clerk", label: "AR Clerk", initials: "AR" },
  { value: "fm1", label: "FM1", initials: "F1" },
  { value: "fm2", label: "FM2", initials: "F2" },
  { value: "fc", label: "Financial Controller", initials: "FC" },
  { value: "fpa", label: "FP&A", initials: "PA" },
];

export function ownerLabel(t: Pick<Task, "owner_kind" | "owner">): string {
  if (!t.owner) return "Unassigned";
  if (t.owner_kind === "agent") return AGENTS.find((a) => a.value === t.owner)?.label ?? t.owner;
  return t.owner;
}

export function ownerInitials(t: Pick<Task, "owner_kind" | "owner">): string {
  if (!t.owner) return "-";
  if (t.owner_kind === "agent") return AGENTS.find((a) => a.value === t.owner)?.initials ?? "AI";
  const name = t.owner.split("@")[0].replace(/[^a-z]/gi, " ").trim().split(/\s+/);
  return (name.length > 1 ? name[0][0] + name[1][0] : name[0].slice(0, 1)).toUpperCase();
}

// One line on what holds a task up.
export function blockerText(b: TaskBlocker): string {
  if (b.kind === "task") return `Blocked by: ${b.task?.title ?? "a task"}`;
  if (b.kind === "ap_item") {
    const amount = b.bill?.total ? ` ${b.bill.currency ?? ""} ${Number(b.bill.total).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`.trimEnd() : "";
    return `Waiting for a Bills decision: ${b.bill?.supplier ?? "a bill"}${amount ? ` (${amount.trim()})` : ""}`;
  }
  return `Waiting on ${b.party}${b.description ? `: ${b.description}` : ""}`;
}

export interface TreeRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

// Tasks in display order: each parent followed by its sub-tasks (by position,
// then oldest first). A collapsed parent hides its sub-tasks. Done tasks are
// left out unless showDone; a parent stays if any sub-task is shown.
export function taskTree(tasks: Task[], { collapsed = new Set<string>(), showDone = true } = {}): TreeRow[] {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const p = t.parent_id && ids.has(t.parent_id) ? t.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(t);
  }
  const order = (a: Task, b: Task) => a.position - b.position || a.created_at.localeCompare(b.created_at);
  const visible = (t: Task): boolean => showDone || t.status !== "done" || (kids.get(t.id) ?? []).some(visible);
  const out: TreeRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of (kids.get(parent) ?? []).sort(order)) {
      if (!visible(t)) continue;
      const hasChildren = (kids.get(t.id) ?? []).some(visible);
      const open = !collapsed.has(t.id);
      out.push({ task: t, depth, hasChildren, open });
      if (hasChildren && open) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// "Status changed from To do to Done", "Blocked: Waiting on Client", ...
export function eventText(e: TaskEvent): string {
  const d = e.detail as {
    changes?: Record<string, { from?: string; to?: string }>;
    kind?: string; party?: string; description?: string; reason?: string; note?: string; text?: string;
  };
  const label = (s: string | undefined) => STATUS_LABEL[s as ShownStatus] ?? s ?? "";
  switch (e.action) {
    case "created": return "Created";
    case "status": return `Status: ${label(d.changes?.status?.from)} → ${label(d.changes?.status?.to)}`;
    case "changed": return `Changed ${Object.keys(d.changes ?? {}).map((k) => k.replace(/_/g, " ").replace(/ on$/, " date")).join(", ")}`;
    case "blocked":
      return d.kind === "external" ? `Waiting on ${d.party}${d.description ? `: ${d.description}` : ""}`
        : d.kind === "ap_item" ? "Blocked by a Bills item" : "Blocked by another task";
    case "unblocked": return `Unblocked${d.reason ? `: ${d.reason}` : d.note ? `: ${d.note}` : ""}`;
    case "comment": return String(d.text ?? "");
    case "deleted": return "Deleted";
    default: return e.action;
  }
}

// Who a change came through, when not the person directly: " via FM1",
// " via Claude" (finance-api's X-Work-Via, stored on the history row).
export function viaText(e: TaskEvent): string {
  const v = (e.detail as { via?: { kind?: string; agent?: string } }).via;
  if (v?.kind === "claude") return " via Claude";
  if (v?.kind === "agent") return ` via ${AGENTS.find((a) => a.value === v.agent)?.label ?? "an agent"}`;
  return "";
}

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchTasks(slug: string): Promise<Task[]> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) throw new Error("FINANCE_API_KEY is not configured");
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/tasks`, { headers: { "X-API-Key": key }, cache: "no-store" });
  if (!res.ok) throw new Error(`the tasks could not be read (${res.status})`);
  return ((await res.json()) as { tasks: Task[] }).tasks;
}

// The task paths the portal may reach on finance-api, and nothing else.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WORK_PATH = new RegExp(`^tasks(/month-end|/${UUID}(/(events|notes|blockers(/${UUID}/resolve)?))?)?$`, "i");
export const isWorkPath = (path: string) => WORK_PATH.test(path);

// Passes one call through to finance-api as the signed-in person, returning
// its status and body as they are (422 issues included).
export async function workCall(slug: string, path: string, method: string, actorEmail: string, body?: unknown) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/${path}`, {
    method,
    headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ── Board ─────────────────────────────────────────────────────────────────────

export const BOARD_COLUMNS: ShownStatus[] = ["todo", "in_progress", "blocked", "waiting", "review", "done"];

// Columns a card can be dropped into: the statuses a person sets. Blocked and
// Waiting come from blockers, so nothing is dropped there.
export const DROPPABLE = new Set<ShownStatus>(SETTABLE);

export interface BoardColumn {
  status: ShownStatus;
  tasks: Array<Task & { parentTitle: string | null }>;
}

// The board shows the pieces of work: tasks with no sub-tasks. A parent is a
// label on its sub-tasks' cards, not a card of its own. Most urgent first
// (see urgency), then by due date (undated last), then oldest.
export function boardColumns(tasks: Task[], { showDone = false, today = londonToday() } = {}): BoardColumn[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasKids = new Set(tasks.map((t) => t.parent_id).filter(Boolean) as string[]);
  const urgent = urgency(tasks, today);
  const rank = (t: Task) => [urgent.has(t.id) ? 0 : 1, t.due_on ?? "9999-12-31", t.created_at] as const;
  const order = (a: Task, b: Task) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1].localeCompare(rb[1]) || ra[2].localeCompare(rb[2]);
  };
  const leaves = tasks.filter((t) => !hasKids.has(t.id));
  return BOARD_COLUMNS
    .filter((s) => showDone || s !== "done")
    .map((status) => ({
      status,
      tasks: leaves.filter((t) => t.shown_status === status).sort(order)
        .map((t) => ({ ...t, parentTitle: t.parent_id ? byId.get(t.parent_id)?.title ?? null : null })),
    }));
}

// Why a card dropped on a column did not land there: Blocked and Waiting come
// from blockers, and a task with an open blocker stays in its column whatever
// its own status is. Null when the move shows.
export function dropRefusal(t: Task, status: ShownStatus): string | null {
  if (!DROPPABLE.has(status)) {
    return `${STATUS_LABEL[status]} is set by blockers. Open the task and add a blocker to move it there.`;
  }
  const open = t.blockers.filter((b) => b.open);
  if (open.length && status !== "done") {
    return `"${t.title}" is now ${STATUS_LABEL[status]}, but stays under ${STATUS_LABEL[t.shown_status]} until this clears: ${blockerText(open[0])}.`;
  }
  return null;
}

// ── Urgency ───────────────────────────────────────────────────────────────────
//
// Urgent or normal; nothing in between. A task is urgent when it is flagged by
// hand (stored as priority P1, the only priority that counts), overdue, due by
// the next working day, or directly holding up a task that is flagged or
// overdue. Done tasks never are. Kept narrow on purpose: if most of a close
// shows as urgent, the tag tells you nothing.

export type UrgentWhy = "flagged" | "overdue" | "soon" | "holds_up";

export const URGENT_WHY: Record<UrgentWhy, string> = {
  flagged: "Flagged urgent",
  overdue: "Overdue",
  soon: "Due by the next working day",
  holds_up: "Holds up a flagged or overdue task",
};

export function londonToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

// The date n working days (Monday to Friday) after a YYYY-MM-DD date.
export function addWorkingDays(ymd: string, n: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export function urgency(tasks: Task[], today: string): Map<string, UrgentWhy> {
  const soon = addWorkingDays(today, 1);
  const out = new Map<string, UrgentWhy>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    const due = t.due_on?.slice(0, 10);
    if (t.priority === "P1") out.set(t.id, "flagged");
    else if (due && due < today) out.set(t.id, "overdue");
    else if (due && due <= soon) out.set(t.id, "soon");
  }
  const pressing = new Set([...out].filter(([, why]) => why === "flagged" || why === "overdue").map(([id]) => id));
  for (const t of tasks) {
    if (t.status !== "done" && !out.has(t.id) && t.holds_up.some((id) => pressing.has(id))) out.set(t.id, "holds_up");
  }
  return out;
}

// ── Timeline ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayNum = (ymd: string) => Math.round(Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const ymdOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export interface TimelineBar {
  id: string;
  row: number;
  from: number; // day index from the timeline's first day
  to: number;   // inclusive
  parent: boolean;
  dated: boolean; // false: the bar is drawn from its sub-tasks' dates
}

export interface TimelineLayout {
  first: string;          // the first day shown (YYYY-MM-DD)
  days: string[];         // every day shown
  todayIndex: number | null;
  bars: TimelineBar[];
  links: Array<{ from: string; to: string }>; // blocking task -> task waiting on it
}

// Where each row's bar sits. A task runs from its start to its due date. With
// a due date and no start it runs from the day after the tasks blocking it are
// due (it cannot start before), else from the day it was created; one day
// long if that is after the due date. With a start only it is one day; with
// neither it has no bar. A parent
// with no dates spans its sub-tasks. The range runs from three days before the
// earliest bar (or today) to three days after the latest, at least minDays
// and at most maxDays (zoomed out to weeks or months shows more).
export function timelineLayout(rows: TreeRow[], allTasks: Task[], today: string, maxDays = 120, minDays = 0): TimelineLayout {
  const kids = new Map<string, Task[]>();
  for (const t of allTasks) if (t.parent_id) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const own = (t: Task, depth = 0): [number, number] | null => {
    const e = t.due_on ?? t.start_on;
    if (!e) return null;
    if (t.start_on) return [dayNum(t.start_on), dayNum(e)];
    const end = dayNum(e);
    // After the latest end of the open tasks blocking it.
    const after = depth > 20 ? [] : t.blockers
      .filter((b) => b.open && b.kind === "task" && b.task && byId.has(b.task.id))
      .map((b) => own(byId.get(b.task!.id)!, depth + 1)?.[1])
      .filter((n): n is number => n !== undefined);
    const created = t.created_at ? dayNum(t.created_at) : end;
    const start = after.length ? Math.max(...after) + 1 : created;
    return [Math.min(start, end), end];
  };
  const span = (t: Task, seen = new Set<string>()): [number, number] | null => {
    const mine = own(t);
    if (mine) return mine;
    if (seen.has(t.id)) return null;
    seen.add(t.id);
    const parts = (kids.get(t.id) ?? []).map((k) => span(k, seen)).filter(Boolean) as Array<[number, number]>;
    if (!parts.length) return null;
    return [Math.min(...parts.map((p) => p[0])), Math.max(...parts.map((p) => p[1]))];
  };

  const spans = rows.map((r) => ({ r, s: span(r.task) }));
  const t0 = dayNum(today);
  const dated = spans.filter((x) => x.s) as Array<{ r: TreeRow; s: [number, number] }>;
  let lo = Math.min(t0, ...dated.map((x) => x.s[0])) - 3;
  let hi = Math.max(t0, ...dated.map((x) => x.s[1])) + 3;
  if (hi - lo > maxDays - 1) { lo = Math.max(lo, t0 - Math.round(maxDays / 4)); hi = lo + maxDays - 1; }
  if (hi - lo < minDays - 1) hi = lo + minDays - 1;

  const bars: TimelineBar[] = [];
  spans.forEach(({ r, s }, row) => {
    if (!s) return;
    const from = Math.max(s[0], lo) - lo;
    const to = Math.min(s[1], hi) - lo;
    if (to < 0 || from > hi - lo) return;
    bars.push({ id: r.task.id, row, from, to, parent: r.hasChildren, dated: !!own(r.task) });
  });
  const shown = new Set(bars.map((b) => b.id));
  const links = rows.flatMap((r) => r.task.blockers
    .filter((b) => b.open && b.kind === "task" && b.task && shown.has(b.task.id) && shown.has(r.task.id))
    .map((b) => ({ from: b.task!.id, to: r.task.id })));
  const days = Array.from({ length: hi - lo + 1 }, (_, i) => ymdOf(lo + i));
  return { first: days[0], days, todayIndex: t0 >= lo && t0 <= hi ? t0 - lo : null, bars, links };
}

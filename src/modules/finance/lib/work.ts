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
const WORK_PATH = new RegExp(`^tasks(/${UUID}(/(events|notes|blockers(/${UUID}/resolve)?))?)?$`, "i");
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
// label on its sub-tasks' cards, not a card of its own. Most urgent first:
// P1, then by due date (undated last), then oldest.
export function boardColumns(tasks: Task[], { showDone = false } = {}): BoardColumn[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasKids = new Set(tasks.map((t) => t.parent_id).filter(Boolean) as string[]);
  const rank = (t: Task) => [t.priority === "P1" ? 0 : 1, t.due_on ?? "9999-12-31", t.created_at] as const;
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

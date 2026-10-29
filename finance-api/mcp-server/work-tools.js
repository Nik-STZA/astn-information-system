// ─────────────────────────────────────────────────────────────────────────────
// Work tools: a Claude conversation reads and adds to a client's task list in
// os.stza.io (redesign step 3, 28 Oct 2026).
//
// Served beside the practice toolset (STZA's own Claude), not the client-facing
// one. Every call goes to finance-api's Work routes as STZA_ACTOR_EMAIL, who
// needs an engagement role for the client, with X-Work-Via: claude so each
// task and history row says it came from Claude. finance-api refuses deletes
// from here; a person deletes in the portal.
//
// A ref (any short key, e.g. "fsl-vat-q3-2026") makes adding idempotent: the
// same ref sent again returns the task already there instead of a second one.
// ─────────────────────────────────────────────────────────────────────────────

import { LAPTOP_NAMES } from "./practice-tools.js";

const s = (description) => ({ type: "string", description });

const TASK_FIELDS = {
  notes: s("What needs doing and why, with the evidence (account, amount, document, conversation)"),
  priority: { type: "string", enum: ["P1", "P2", "P3"], description: "P1 flags the task as urgent; P2 and P3 show as normal. Overdue and soon-due tasks turn urgent by themselves" },
  due_on: s("Due date YYYY-MM-DD"),
  owner_kind: { type: "string", enum: ["person", "agent"], description: "With owner" },
  owner: s("A person's email, or an agent: ap-clerk, ar-clerk, fm1, fm2, fc, fpa"),
};

function tool(name, description, props, required) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { client: s("Client slug, e.g. feldspar or stza"), ...props },
      required: ["client", ...required],
      additionalProperties: false,
    },
  };
}

export function workTools({ apiUrl, apiKey, actorEmail, log }) {
  async function request(method, path, json) {
    const headers = { "X-API-Key": await apiKey(), Accept: "application/json" };
    if (method !== "GET") {
      if (!actorEmail) throw new Error("Set STZA_ACTOR_EMAIL: every change in Work is attributed to a person");
      Object.assign(headers, { "X-Actor-Email": actorEmail, "X-Work-Via": "claude" });
    }
    if (json && json.ref) headers["X-Work-Ref"] = json.ref;
    const body = json ? JSON.stringify(Object.fromEntries(Object.entries(json).filter(([k]) => k !== "ref"))) : undefined;
    if (body) headers["Content-Type"] = "application/json";
    log(`${method} ${path}`);
    const r = await fetch(`${apiUrl}${path}`, { method, headers, body });
    const text = await r.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 2000) }; }
    return { status: r.status, ok: r.ok, body: parsed };
  }
  const base = (a) => `/api/finance/clients/${encodeURIComponent(a.client)}/tasks`;
  const pick = (a, keys) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== "").map((k) => [k, a[k]]));

  // The company a task concerns: by portal slug or laptop name, within the client.
  async function entityId(a) {
    const want = LAPTOP_NAMES[a.entity] || a.entity;
    const r = await request("GET", `/api/finance/clients/${encodeURIComponent(a.client)}/entities`);
    if (!r.ok) throw new Error(`client ${a.client}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const hit = (r.body.data || []).find((e) => e.slug === want);
    if (!hit) throw new Error(`No entity ${a.entity} in ${a.client}. Available: ${(r.body.data || []).map((e) => e.slug).join(", ")}`);
    return hit.id;
  }

  const T = [];
  const H = {};
  const def = (t, h) => { T.push(t); H[t.name] = h; };

  def(tool("work_list_tasks", "The client's tasks in Work (os.stza.io): status, owner, due date and what each waits on. Read before adding, so nothing goes in twice",
    { include_done: { type: "boolean", description: "Also list finished tasks. Default false" } }, []),
  async (a) => {
    const r = await request("GET", base(a));
    if (!r.ok) throw new Error(`${base(a)} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    const tasks = (r.body.tasks || []).filter((t) => a.include_done || t.status !== "done");
    return {
      count: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id, parent_id: t.parent_id, title: t.title, status: t.shown_status, priority: t.priority, owner: t.owner,
        entity: t.entity_slug, due_on: t.due_on, source: t.source,
        waiting_on: (t.blockers || []).filter((b) => b.open).map((b) => (b.kind === "external" ? b.party : b.kind === "task" ? `task: ${b.task?.title}` : "a Bills item")),
      })),
    };
  });

  def(tool("work_add_task", "Add an open item to the client's Work list in os.stza.io, marked as from Claude. Use waiting_on when it cannot move until someone outside acts", {
    title: s("Short and specific, e.g. 'Chase the bank for the facility letter'"),
    entity: s("The company it concerns: portal slug or laptop name"),
    parent_id: s("Make it a sub-task of this task"),
    ...TASK_FIELDS,
    waiting_on: {
      type: "object",
      description: "Someone outside it waits on (client, supplier, HMRC, bank)",
      properties: { party: { type: "string" }, description: { type: "string" }, chase_on: s("YYYY-MM-DD") },
      required: ["party"],
    },
    ref: s("Optional key so the same item sent again is not added twice"),
  }, ["title", "notes"]),
  async (a) => {
    const json = { ...pick(a, ["title", "parent_id", "notes", "priority", "due_on", "owner_kind", "owner", "ref"]) };
    if (a.entity) json.entity_id = await entityId(a);
    const r = await request("POST", base(a), json);
    if (!r.ok) return { saved: false, status: r.status, refused: r.body };
    if (r.body.existing) return { saved: false, existing: true, task_id: r.body.id, note: "Already in Work under this ref; nothing was added." };
    const out = { saved: true, task_id: r.body.id };
    if (a.waiting_on) {
      const b = await request("POST", `${base(a)}/${r.body.id}/blockers`, { kind: "external", ...a.waiting_on });
      if (!b.ok) Object.assign(out, { waiting_on_refused: b.body });
    }
    return out;
  });

  def(tool("work_update_task", "Change a task in Work: status (todo, in_progress, review, done), priority, due date, owner or notes, with a note for its history", {
    task_id: s("From work_list_tasks"),
    status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
    ...TASK_FIELDS,
    note: s("What was done or found; goes in the task's history"),
  }, ["task_id", "note"]),
  async (a) => {
    const path = `${base(a)}/${encodeURIComponent(a.task_id)}`;
    const fields = pick(a, ["status", "notes", "priority", "due_on", "owner_kind", "owner"]);
    if (Object.keys(fields).length) {
      const r = await request("PATCH", path, fields);
      if (!r.ok) return { saved: false, status: r.status, refused: r.body };
    }
    const n = await request("POST", `${path}/notes`, { text: a.note });
    if (!n.ok) return { saved: Object.keys(fields).length > 0, status: n.status, note_refused: n.body };
    return { saved: true };
  });

  return { tools: T, handlers: H };
}

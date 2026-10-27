// Work tools for the agent runner (28 Oct 2026): an agent reads the client's
// task list in os.stza.io, adds what it finds and moves tasks on.
//
// Tasks are changed through finance-api's Work routes as the person who asked
// (they need an engagement role), with X-Work-Via naming this agent and run so
// the history shows it. finance-api refuses deletes from an agent.

const TASK_FIELDS = {
  notes: { type: "string", description: "What needs doing and why, with the evidence (account, amount, document)" },
  priority: { type: "string", enum: ["P1", "P2", "P3"] },
  due_on: { type: "string", description: "Due date (YYYY-MM-DD)" },
  owner_kind: { type: "string", enum: ["person", "agent"], description: "With owner" },
  owner: { type: "string", description: "A person's email, or an agent: ap-clerk, ar-clerk, fm1, fm2, fc, fpa" },
};

const NAMES = ["list_tasks", "add_task", "update_task"];

function tools(entityEnum) {
  return [
    {
      name: "list_tasks",
      description:
        "The client's tasks in Work (os.stza.io): what is open, who owns it, when it is due and what holds it up. " +
        "Read this before adding a task, so you do not add one that is already there.",
      input_schema: {
        type: "object",
        properties: { include_done: { type: "boolean", description: "Also list finished tasks. Default false" } },
        required: [],
      },
    },
    {
      name: "add_task",
      description:
        "Add a task to the client's Work list for something that needs doing and is not already there: a follow-up you found, " +
        "a reconciliation break, a document to chase. Use waiting_on when it cannot move until someone outside acts.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short and specific, e.g. 'Chase the bank for the facility letter'" },
          entity: { type: "string", enum: entityEnum, description: "The company it concerns, if one" },
          parent_id: { type: "string", description: "Make it a sub-task of this task" },
          ...TASK_FIELDS,
          waiting_on: {
            type: "object",
            description: "Someone outside it waits on (client, supplier, HMRC, bank)",
            properties: { party: { type: "string" }, description: { type: "string" }, chase_on: { type: "string", description: "YYYY-MM-DD" } },
            required: ["party"],
          },
        },
        required: ["title", "notes"],
      },
    },
    {
      name: "update_task",
      description:
        "Change a task: its status (todo, in_progress, review, done), priority, due date, owner or notes. Always give a note " +
        "saying what you did or found; it goes in the task's history. Mark a task done only when you have checked it is done, " +
        "and say how in the note. Use review when a person should check your work.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
          ...TASK_FIELDS,
          note: { type: "string", description: "What you did or found" },
        },
        required: ["task_id", "note"],
      },
    },
  ];
}

// A task as an agent needs it, without the portal's bookkeeping.
function taskView(t) {
  return {
    id: t.id, parent_id: t.parent_id, title: t.title, status: t.shown_status, priority: t.priority,
    owner: t.owner, entity: t.entity_slug, start_on: t.start_on, due_on: t.due_on, notes: t.notes,
    waiting_on: (t.blockers || []).filter((b) => b.open).map((b) =>
      b.kind === "external" ? `${b.party}${b.description ? `: ${b.description}` : ""}`
        : b.kind === "task" ? `task ${b.task?.title}` : `Bills item ${b.bill?.supplier ?? b.bill?.id}`),
  };
}

// apiCall (throws), apiRequest (returns { ok, status, body }) and requesterOf
// are the runner's own.
function agentWork({ apiCall, apiRequest, requesterOf }) {
  async function call(job, entities, name, input) {
    const base = `/api/finance/clients/${encodeURIComponent(job.client.slug)}/tasks`;
    if (name === "list_tasks") {
      const r = await apiCall("GET", base);
      const tasks = (r.tasks || []).filter((t) => input.include_done || t.status !== "done");
      return { count: tasks.length, tasks: tasks.map(taskView) };
    }
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was changed in Work." };
    const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent || "general"}:${job.id}` };
    const fields = Object.fromEntries(["notes", "priority", "due_on", "owner_kind", "owner", "status"]
      .filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));

    if (name === "add_task") {
      const entity = input.entity ? entities.find((e) => e.slug === input.entity) : null;
      if (input.entity && !entity) return { saved: false, error: `No connected entity ${input.entity}` };
      const body = { title: input.title, ...fields, ...(entity ? { entity_id: entity.id } : {}), ...(input.parent_id ? { parent_id: input.parent_id } : {}) };
      const res = await apiRequest("POST", base, body, headers);
      if (!res.ok) return { saved: false, status: res.status, refused: res.body };
      const task = res.body;
      if (input.waiting_on) {
        const b = await apiRequest("POST", `${base}/${task.id}/blockers`, { kind: "external", ...input.waiting_on }, headers);
        if (!b.ok) return { saved: true, task_id: task.id, waiting_on_refused: b.body, note: "The task was added but the wait was not recorded; say so." };
      }
      return { saved: true, task_id: task.id, note: "Added to Work in os.stza.io, marked as yours in its history. Tell the user." };
    }

    if (name === "update_task") {
      if (!/^[0-9a-f-]{36}$/i.test(String(input.task_id))) return { saved: false, error: "task_id must be a task id from list_tasks" };
      const path = `${base}/${input.task_id}`;
      if (Object.keys(fields).length) {
        const res = await apiRequest("PATCH", path, fields, headers);
        if (!res.ok) return { saved: false, status: res.status, refused: res.body };
      }
      const n = await apiRequest("POST", `${path}/notes`, { text: input.note }, headers);
      if (!n.ok) return { saved: Object.keys(fields).length > 0, status: n.status, note_refused: n.body };
      return { saved: true, note: "Updated in Work, with your note in the task's history." };
    }
    return { error: `Unknown tool: ${name}` };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentWork, taskView };

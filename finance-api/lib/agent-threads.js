// Thread tools for the agent runner (migration 050): an agent reads the
// client's threads (the notes, questions, holds and decisions people have left
// on an account, an asset, a reconciliation) and adds to them. The same
// threads show in os.stza.io on the Fixed assets page, each reconciliation and
// the Close page.
//
// An agent writes as the person who asked (they need a role on the client),
// with X-Work-Via naming the agent and run, so the entry shows the agent's
// initials "for" that person. Only an agent records a finding. Entries are
// permanent; finance-api refuses edits and deletes.

const NAMES = ["read_threads", "add_thread_entry"];

const SUBJECT_KINDS = ["account", "asset", "cost_line", "reconciliation", "register_month"];
const SUBJECT_HELP =
  "account: <company id>:<account code> (with its period); asset, cost_line, reconciliation: its id; register_month: the register's grouping (with its period)";

function tools() {
  return [
    {
      name: "read_threads",
      description:
        "Read the client's threads in os.stza.io: what people have said, asked, held or decided about an account in a month, an asset, " +
        "a reconciliation or a register's month. Read the threads on anything you work on before you act: a hold or a decision there " +
        "binds you. With no subject, lists the month's entries (or, with open_only, what still waits on a decision).",
      input_schema: {
        type: "object",
        properties: {
          subjects: {
            type: "array", maxItems: 50,
            items: {
              type: "object",
              properties: { kind: { type: "string", enum: SUBJECT_KINDS }, key: { type: "string", description: SUBJECT_HELP } },
              required: ["kind", "key"],
            },
          },
          period: { type: "string", description: "YYYY-MM. Entries of that month, plus those with no month (an asset's thread runs across months)" },
          open_only: { type: "boolean", description: "Only entries still waiting on a decision" },
        },
        required: [],
      },
    },
    {
      name: "add_thread_entry",
      description:
        "Add to a thread in os.stza.io. Use kind finding for what you found (with the figures and where they came from), question when " +
        "you need a person to decide something (set needs_decision so it shows on the Close page as waiting on them), and note otherwise. " +
        "To answer an entry, give its id as parent_id. You cannot record a decision for a person, and entries cannot be changed afterwards.",
      input_schema: {
        type: "object",
        properties: {
          subject_kind: { type: "string", enum: SUBJECT_KINDS },
          subject_key: { type: "string", description: SUBJECT_HELP },
          period: { type: "string", description: "YYYY-MM. Required for an account or a register's month" },
          kind: { type: "string", enum: ["finding", "question", "note"] },
          body: { type: "string", description: "Plain English, short, with the evidence" },
          needs_decision: { type: "boolean", description: "A question a person must decide (not on a reply)" },
          parent_id: { type: "string", description: "The entry this answers" },
        },
        required: ["subject_kind", "subject_key", "kind", "body"],
      },
    },
  ];
}

// An entry as an agent needs it: who, what, when, and whether it still waits.
function entryView(e) {
  return {
    id: e.id, about: `${e.subject_kind}:${e.subject_key}`, period: e.period, kind: e.kind, by: e.by?.name ?? null,
    at: String(e.created_at ?? "").slice(0, 10), text: e.body, waits_on_decision: !!e.open,
    replies: (e.replies || []).map((r) => ({ id: r.id, kind: r.kind, by: r.by?.name ?? null, at: String(r.created_at ?? "").slice(0, 10), text: r.body })),
  };
}

// For the system prompt: what still waits on a decision, so every run starts
// knowing it. Short: the newest few, each cut to a line.
function openSummary(threads, max = 10) {
  const open = (threads || []).filter((e) => e.open);
  if (!open.length) return "";
  const line = (e) => `- [${e.kind}] ${e.subject_kind}:${e.subject_key}${e.period ? ` (${e.period})` : ""}, ${e.by?.name ?? "someone"}: ${String(e.body).replace(/\s+/g, " ").slice(0, 200)}`;
  return `Waiting on a decision in this client's threads (${open.length}${open.length > max ? `, newest ${max} shown` : ""}). ` +
    `Do not act against an open hold; read_threads for the full thread:\n${open.slice(0, max).map(line).join("\n")}`;
}

// apiCall (throws), apiRequest (returns { ok, status, body }) and requesterOf
// are the runner's own.
function agentThreads({ apiCall, apiRequest, requesterOf }) {
  const base = (job) => `/api/finance/clients/${encodeURIComponent(job.client.slug)}/threads`;

  async function call(job, name, input = {}) {
    if (name === "read_threads") {
      const q = new URLSearchParams();
      for (const s of input.subjects || []) q.append("s", `${s.kind}|${s.key}`);
      if (input.period) q.set("period", input.period);
      if (input.open_only) q.set("open", "true");
      const r = await apiRequest("GET", `${base(job)}?${q}`);
      if (!r.ok) return { error: r.body?.error ?? r.body?.issues?.join("; ") ?? `threads answered ${r.status}` };
      const threads = r.body.threads || [];
      return { count: threads.length, open: r.body.open ?? 0, entries: threads.map(entryView) };
    }
    if (name === "add_thread_entry") {
      if (input.kind === "decision") return { saved: false, error: "A decision is a person's to record, not an agent's. Ask with a question and needs_decision." };
      const actor = await requesterOf(job);
      if (!actor) return { saved: false, error: "The person who asked could not be found, so nothing was added to the thread." };
      const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent || "general"}:${job.id}` };
      const body = Object.fromEntries(["subject_kind", "subject_key", "period", "kind", "body", "needs_decision", "parent_id"]
        .filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
      const res = await apiRequest("POST", base(job), body, headers);
      if (!res.ok) return { saved: false, status: res.status, refused: res.body };
      return { saved: true, id: res.body.id, note: "Added to the thread in os.stza.io under your initials, for the person who asked. Tell the user." };
    }
    return { error: `Unknown tool: ${name}` };
  }

  // The open entries for the system prompt; "" when none or unreadable.
  async function context(job) {
    try {
      const r = await apiCall("GET", `${base(job)}?open=true`);
      return openSummary(r?.threads);
    } catch {
      return "";
    }
  }

  return { tools, call, context, names: NAMES };
}

module.exports = { agentThreads, entryView, openSummary };

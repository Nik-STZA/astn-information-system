// Pack commentary tools for the agent runner (migration 063). FP&A and the FC
// draft the month's commentary in os.stza.io: they read it, load a whole
// highlights or dashboard file, or edit its text fields. Each goes through
// finance-api's commentary routes as the person who asked, with X-Work-Via
// naming the agent and the run.
//
// There is no tool to approve: only the CFO approves, in os.stza.io, and the
// pack build takes only an approved month.

const NAMES = ["get_pack_commentary", "import_pack_commentary", "edit_pack_commentary"];
const ROLES = ["fpa", "fc"];

function tools() {
  return [
    {
      name: "get_pack_commentary",
      description: "The month's management pack commentary in os.stza.io: each text field by section with its path (commentary, KPI notes, compliance details, variance comments, actions, risks), the figures beside them, the version and whether the CFO has approved it, notes on wording the CFO's standard asks you to avoid, and the history of versions. Read it before writing, and read last month's for context.",
      input_schema: { type: "object", properties: { period: { type: "string", description: "YYYY-MM" } }, required: ["period"] },
    },
    {
      name: "import_pack_commentary",
      description: "Load a whole file for the month as a draft: the highlights (the commentary and its figures) or the dashboard (figures only), in the shape the pack build reads. Use it to start a month from your analysis. It replaces what is there as a new version and, if the CFO had approved the month, takes it back to draft. Prefer edit_pack_commentary for changes to words.",
      input_schema: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM" },
          kind: { type: "string", enum: ["highlights", "dashboard"] },
          content: { type: "object", description: "The whole file as JSON" },
          note: { type: "string", description: "What this version is, for the CFO" },
        },
        required: ["period", "kind", "content"],
      },
    },
    {
      name: "edit_pack_commentary",
      description: "Change text fields of the month's commentary, by path from get_pack_commentary. Words only: a figure cannot be changed here; if one looks wrong, say so in your note and to the CFO. Give the version you read; if someone saved since, read again.",
      input_schema: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM" },
          version: { type: "number", description: "The version you read" },
          edits: { type: "array", items: { type: "object", properties: { path: { type: "string" }, text: { type: "string" } }, required: ["path", "text"] } },
          note: { type: "string", description: "What you changed and why, for the CFO" },
        },
        required: ["period", "edits"],
      },
    },
  ];
}

function agentCommentary({ apiRequest, requesterOf }) {
  async function call(job, name, input) {
    if (!ROLES.includes(job.agent)) return { error: "Only FP&A or the FC works on the pack commentary." };
    const base = `/api/finance/clients/${encodeURIComponent(job.client.slug)}/commentary`;
    if (name === "get_pack_commentary") {
      const res = await apiRequest("GET", `${base}?period=${encodeURIComponent(String(input.period ?? ""))}`);
      return res.ok ? res.body : { error: res.body?.error ?? `Could not read the commentary (${res.status})` };
    }
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was saved." };
    const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent}:${job.id}` };
    const path = name === "import_pack_commentary" ? "import" : name === "edit_pack_commentary" ? "edit" : null;
    if (!path) return { error: `Unknown tool: ${name}` };
    const res = await apiRequest("POST", `${base}/${path}`, input, headers);
    if (!res.ok) return { saved: false, status: res.status, refused: res.body };
    return { saved: true, ...res.body, note: "Saved as a draft in os.stza.io for the CFO to read and approve. The pack uses it only once approved; say so in your answer." };
  }
  return { tools, call, names: NAMES };
}

module.exports = { agentCommentary, NAMES, ROLES };

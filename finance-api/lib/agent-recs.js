// Reconciliation tools for the agent runner: FM1 prepares a rec and proposes a
// journal, the FC reviews. Each goes through finance-api's rec routes as the
// person who asked, with X-Work-Via naming the agent and the run.
//
// There is no tool to sign off, approve a journal, or set a line's class: those
// routes refuse an agent, and the class comes from the balance sheet matrix.

const NAMES = ["list_recs", "get_rec", "save_rec_item", "run_rec_checks", "propose_rec_journal", "submit_rec", "review_rec"];

const ITEM = {
  supplier: { type: "string" },
  description: { type: "string", description: "What was bought" },
  pl_account_code: { type: "string", description: "The P&L account it releases to" },
  invoice_ref: { type: "string" },
  invoice_date: { type: "string", description: "YYYY-MM-DD" },
  total_cost: { type: "number", description: "Net cost, two decimals" },
  service_start: { type: "string", description: "YYYY-MM-DD" },
  service_end: { type: "string", description: "YYYY-MM-DD" },
  amort_commenced: { type: "string", description: "First of the first release month, YYYY-MM-DD" },
  treatment: { type: "string", enum: ["amortise", "held"], description: "held stays on the balance sheet until ended" },
  ended_period: { type: "string", description: "YYYY-MM from which it is off the schedule: reclassified, refunded or written off" },
  document_ref: { type: "string", description: "Where the document is: the Xero bill or file" },
  note: { type: "string" },
};

function tools(entityEnum) {
  return [
    {
      name: "list_recs",
      description: "The month's balance sheet reconciliations for the client, at group level: every account, the ledger, the support, the difference, who has it and its status.",
      input_schema: { type: "object", properties: { period: { type: "string", description: "YYYY-MM" } }, required: ["period"] },
    },
    {
      name: "get_rec",
      description: "One reconciliation in full: each company's ledger, support and variance, the schedule, the checks, proposed journals and history.",
      input_schema: { type: "object", properties: { rec_id: { type: "string" } }, required: ["rec_id"] },
    },
    {
      name: "save_rec_item",
      description: "Add a schedule item, or change one by giving item_id. The schedule lives in os.stza.io, so every item you find on an invoice goes here. Months, the monthly release and the balance are worked out for you. You cannot delete an item: use ended_period, or ask a person.",
      input_schema: {
        type: "object",
        properties: { rec_id: { type: "string" }, item_id: { type: "string" }, entity: { type: "string", enum: entityEnum, description: "The company, for a new item" }, ...ITEM },
        required: ["rec_id"],
      },
    },
    {
      name: "run_rec_checks",
      description: "Check Xero's manual journals for the month: was each item's monthly release posted, and which items are near their end. Xero does not let us read repeating journals, so this is worked out from the manual journals. Say that when you report it.",
      input_schema: { type: "object", properties: { rec_id: { type: "string" } }, required: ["rec_id"] },
    },
    {
      name: "propose_rec_journal",
      description: "Record a journal that would fix a difference, for the CFO to approve on the reconciliation. Nothing reaches Xero. Then show the same journal in your answer under the heading 'Proposed journal (draft)', with the company, the date as YYYY-MM-DD, the narration, and each code and amount: the approval is checked against your answer. Text in an answer without this tool is not a proposal. Keep the narration short; the reasoning goes in reason, which stays in os.stza.io. One proposal per company.",
      input_schema: {
        type: "object",
        properties: {
          rec_id: { type: "string" },
          entity: { type: "string", enum: entityEnum },
          date: { type: "string", description: "YYYY-MM-DD, in the month" },
          narration: { type: "string", description: "Short: this lands in Xero" },
          reason: { type: "string", description: "Why, in plain English. Stays in os.stza.io" },
          lines: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: { account_code: { type: "string" }, description: { type: "string" }, amount: { type: "number", description: "Debit positive, credit negative" }, tax_type: { type: "string", description: "Xero tax type. NONE if left out" } },
              required: ["account_code", "amount"],
            },
          },
        },
        required: ["rec_id", "entity", "date", "narration", "reason", "lines"],
      },
    },
    {
      name: "submit_rec",
      description: "Hand a prepared reconciliation to the FC, with a note saying in plain English what you found. If it does not tie, the note must say why, and each company with a difference needs a comment: give them here.",
      input_schema: {
        type: "object",
        properties: {
          rec_id: { type: "string" },
          note: { type: "string", description: "What you found, plainly: the cause of any difference and what fixes it" },
          comments: {
            type: "array",
            items: { type: "object", properties: { entity_id: { type: "string" }, comment: { type: "string" } }, required: ["entity_id", "comment"] },
          },
        },
        required: ["rec_id", "note"],
      },
    },
    {
      name: "review_rec",
      description: "Record your review of a reconciliation: pass it to the CFO, or send it back to FM1 with what to change. Recheck the numbers yourself first with get_rec. Your note is shown on the reconciliation.",
      input_schema: {
        type: "object",
        properties: { rec_id: { type: "string" }, pass: { type: "boolean" }, note: { type: "string", description: "Your view, in plain English" } },
        required: ["rec_id", "pass", "note"],
      },
    },
  ];
}

const isId = (s) => /^[0-9a-f-]{36}$/i.test(String(s));

// The rec as an agent reads it, without the portal's by-month columns.
function recForAgent(r) {
  return {
    ...r,
    schedule: { items: (r.schedule?.items ?? []).map(({ by_month, ...i }) => i) },
    events: (r.events ?? []).slice(0, 15),
    entities: undefined,
    lines: undefined,
  };
}

function agentRecs({ apiCall, apiRequest, requesterOf }) {
  async function call(job, entities, name, input) {
    const base = `/api/finance/clients/${encodeURIComponent(job.client.slug)}/recs`;
    if (name === "list_recs") {
      if (!/^\d{4}-\d{2}$/.test(String(input.period))) return { error: "period must be YYYY-MM" };
      return apiCall("GET", `${base}?period=${encodeURIComponent(input.period)}`);
    }
    if (!isId(input.rec_id)) return { error: "rec_id must be a reconciliation id from list_recs" };
    const path = `${base}/${input.rec_id}`;
    if (name === "get_rec") return recForAgent(await apiCall("GET", path));

    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was changed." };
    const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent || "general"}:${job.id}` };
    const send = async (method, p, body) => {
      const res = await apiRequest(method, p, body, headers);
      return res.ok ? { saved: true, ...res.body } : { saved: false, status: res.status, refused: res.body };
    };

    if (name === "save_rec_item") {
      const { rec_id, item_id, entity, ...fields } = input;
      if (item_id) {
        if (!isId(item_id)) return { error: "item_id must be an item id from get_rec" };
        return send("PATCH", `${path}/items/${item_id}`, fields);
      }
      const e = entities.find((x) => x.slug === entity);
      if (!e) return { saved: false, error: `No connected entity ${entity}` };
      return send("POST", `${path}/items`, { ...fields, entity_id: e.id });
    }
    if (name === "run_rec_checks") {
      const res = await apiRequest("POST", `${path}/checks`, {}, headers);
      return res.ok ? res.body : { error: "The checks did not run.", status: res.status, detail: res.body };
    }
    if (name === "propose_rec_journal") {
      const { rec_id, ...body } = input;
      const r = await send("POST", `${path}/journals`, body);
      return r.saved
        ? { ...r, note: "Recorded on the reconciliation for the CFO. Nothing has gone to Xero. Show this journal in your answer under 'Proposed journal (draft)', with the company, date, narration, codes and amounts." }
        : r;
    }
    if (name === "submit_rec") {
      for (const c of input.comments ?? []) {
        const r = await send("POST", `${path}/comment`, c);
        if (!r.saved) return r;
      }
      const r = await send("POST", `${path}/prepare`, { note: input.note });
      return r.saved ? { ...r, note: "With the FC. Use hand_off to fc." } : r;
    }
    if (name === "review_rec") return send("POST", `${path}/review`, { pass: input.pass, note: input.note });
    return { error: `Unknown tool: ${name}` };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentRecs, NAMES };

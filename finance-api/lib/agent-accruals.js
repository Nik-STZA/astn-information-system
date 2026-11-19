// The accruals tools for the agent runner (docs/accruals-spec.md 5 and 8).
// FM1 reads the history, runs the month and proposes; the FC reads and
// comments, and may challenge. Each goes through finance-api's accruals routes
// as the person who asked, with X-Work-Via naming the agent and the run.
//
// There is no tool to decide, set a standing item, promote a precedent or
// approve a pair: those routes refuse an agent. The CFO decides in os.stza.io.

const NAMES = ["get_accrual_history", "run_accruals", "propose_accrual", "comment_on_accrual"];

// Which roles are offered which tools; finance-api refuses the rest anyway.
const BY_ROLE = {
  fm1: NAMES,
  fc: ["get_accrual_history", "comment_on_accrual"],
};

const LINE = {
  type: "object",
  properties: {
    account_code: { type: "string", description: "The cost account, never the accruals account" },
    amount: { type: "number", description: "Net of VAT, positive" },
    description: { type: "string" },
  },
  required: ["account_code", "amount"],
};

function tools(entityEnum, agent = "fm1") {
  const all = [
    {
      name: "get_accrual_history",
      description: "Read before proposing any accrual. Per supplier, for this client only: your earlier proposals with the CFO's decisions, reasons and the comments on them; the precedents in force (each with its id, decision, reason and whether it applies to its month only or until changed); the standing items; and each month's bill against what was accrued, with a calibration line where the differences run one way.",
      input_schema: { type: "object", properties: { period: { type: "string", description: "YYYY-MM, the month you are working" }, months: { type: "number", description: "How many months back, 1 to 36. Default 12" } }, required: ["period"] },
    },
    {
      name: "run_accruals",
      description: "Run the month's accruals schedule in os.stza.io: proposes the journal pair (accrual at the month end, reversal on the 1st) for every standing item, backfills a month a standing item missed into that month (never a catch-up in this one), matches bills that arrived to the months they clear, and lists findings (a locked month to open, a bill not in by the 15th, a company with no accruals account). Nothing reaches Xero. Run it first; do not propose what it proposes.",
      input_schema: { type: "object", properties: { period: { type: "string", description: "YYYY-MM" } }, required: ["period"] },
    },
    {
      name: "propose_accrual",
      description: "Raise one accrual candidate for the CFO to discuss and decide in os.stza.io. Give the test that found it, the basis kind and basis, the evidence, and your confidence. Lines are the cost, Dr, net of VAT; the credit to the accruals account and the reversal are made for you. Where a fact from outside the ledger is needed, set confidence open with no lines: it goes to the CFO as a question and is never estimated. Cite or depart: name in precedent_ids the precedent you follow, or say in departs_reason what is different this month. A proposal that follows a no-accrual precedent is refused as not raised: list it in your answer as not raised, with the precedent.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum },
          period: { type: "string", description: "The service month, YYYY-MM" },
          supplier: { type: "string" },
          contact_id: { type: "string", description: "The supplier's Xero ContactID, when known" },
          test: { type: "string", enum: ["continuity", "backward", "gap", "forward", "reverse_cutoff"] },
          lines: { type: "array", items: LINE, description: "Empty for an open question" },
          service_from: { type: "string", description: "YYYY-MM-DD" },
          service_to: { type: "string", description: "YYYY-MM-DD" },
          basis_kind: { type: "string", enum: ["contract", "purchase_order", "last_bill", "estimate"] },
          basis: { type: "string", description: "What the amount rests on; for an estimate, who gave it" },
          evidence: { type: "array", items: { type: "object" }, description: "Invoice ids, line numbers, document references" },
          confidence: { type: "string", enum: ["high", "medium", "open"] },
          precedent_ids: { type: "array", items: { type: "string" } },
          departs_reason: { type: "string" },
        },
        required: ["entity", "period", "supplier", "test", "basis_kind", "basis", "confidence"],
      },
    },
    {
      name: "comment_on_accrual",
      description: "Reply on a proposal's discussion in os.stza.io with what you found: a bill, a document, an answer to the CFO's question. The FC may mark a comment as a challenge. You cannot decide; the CFO does.",
      input_schema: {
        type: "object",
        properties: { proposal_id: { type: "string" }, body: { type: "string" }, challenge: { type: "boolean", description: "FC only" } },
        required: ["proposal_id", "body"],
      },
    },
  ];
  const allowed = BY_ROLE[agent] ?? [];
  return all.filter((t) => allowed.includes(t.name));
}

function agentAccruals({ apiRequest, requesterOf }) {
  async function call(job, name, input) {
    if (!(BY_ROLE[job.agent] ?? []).includes(name)) return { error: `${String(job.agent).toUpperCase()} does not have ${name}.` };
    const base = `/api/finance/clients/${encodeURIComponent(job.client.slug)}/accruals`;
    if (name === "get_accrual_history") {
      const q = new URLSearchParams({ period: String(input.period ?? ""), months: String(input.months ?? 12) });
      const res = await apiRequest("GET", `${base}/history?${q}`);
      return res.ok ? res.body : { error: res.body?.error ?? `Could not read the accruals history (${res.status})` };
    }
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was recorded." };
    const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent}:${job.id}` };
    if (name === "run_accruals") {
      const res = await apiRequest("POST", `${base}/run`, { period: input.period }, headers);
      if (!res.ok) return { ran: false, status: res.status, refused: res.body };
      return { ran: true, ...res.body, note: "Pairs proposed are on the Journals page for the CFO. Nothing has gone to Xero. Report each pair by its JNL number, each match with its difference, and every finding." };
    }
    if (name === "propose_accrual") {
      const res = await apiRequest("POST", `${base}/proposals`, input, headers);
      if (res.status === 409 && res.body?.not_raised) return { raised: false, not_raised: true, ...res.body, note: "Not raised. List it in your answer as not raised, citing the precedent." };
      if (!res.ok) return { raised: false, status: res.status, refused: res.body };
      return { raised: true, ...res.body, note: "On the Accruals page for the CFO to discuss and decide. Nothing has gone to Xero." };
    }
    if (name === "comment_on_accrual") {
      const res = await apiRequest("POST", `${base}/proposals/${encodeURIComponent(input.proposal_id)}/comments`, { body: input.body, challenge: input.challenge === true }, headers);
      return res.ok ? { saved: true } : { saved: false, status: res.status, refused: res.body };
    }
    return { error: `Unknown tool: ${name}` };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentAccruals, NAMES, BY_ROLE };

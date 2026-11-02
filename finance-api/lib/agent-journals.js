// The Journals tool for the agent runner: FM1 or the FC proposes a month-end
// journal that is not on a reconciliation (an accrual, a reclass, the payroll
// journal, a correction). It goes through finance-api's journal routes as the
// person who asked, with X-Work-Via naming the agent and the run.
//
// There is no tool to approve one: that route refuses an agent, and only the
// CFO approves, on the Journals page. finance-api then creates it in Xero as a
// DRAFT. Nothing an agent does here reaches Xero.

const NAMES = ["propose_journal"];

// Only these roles are offered the tool; finance-api refuses any other agent.
const ROLES = ["fm1", "fc"];

function tools(entityEnum) {
  return [
    {
      name: "propose_journal",
      description: "Record a month-end journal that is not on a reconciliation (an accrual, a reclass, the payroll journal, a correction) on the Journals page in os.stza.io, for the CFO to approve there. Nothing reaches Xero: once the CFO approves, the platform creates it in Xero as a DRAFT and a person posts it. Do not use create_draft_journal for it, and do not ask for a reply. A journal that fixes a reconciliation difference goes through propose_rec_journal instead. Keep the narration short; the reasoning goes in reason, which stays in os.stza.io. The date must be in the month the journal belongs to.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum },
          date: { type: "string", description: "YYYY-MM-DD" },
          narration: { type: "string", description: "Short: this lands in Xero" },
          reason: { type: "string", description: "Why, in plain English, with the evidence. Stays in os.stza.io" },
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
        required: ["entity", "date", "narration", "reason", "lines"],
      },
    },
  ];
}

function agentJournals({ apiRequest, requesterOf }) {
  async function call(job, name, input) {
    if (name !== "propose_journal") return { error: `Unknown tool: ${name}` };
    if (!ROLES.includes(job.agent)) return { error: "Only FM1 or the FC proposes a journal." };
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was recorded." };
    const res = await apiRequest("POST", `/api/finance/clients/${encodeURIComponent(job.client.slug)}/journals`, input, {
      "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent}:${job.id}`,
    });
    if (!res.ok) return { saved: false, status: res.status, refused: res.body };
    return {
      saved: true, ...res.body,
      note: "Recorded on the Journals page for the CFO. Nothing has gone to Xero. Say so in your answer, with the company, date, narration, codes and amounts.",
    };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentJournals, NAMES, ROLES };

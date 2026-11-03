// The Journals tool for the agent runner: FM1 or the FC proposes a month-end
// journal that is not on a reconciliation (an accrual, a reclass, the payroll
// journal, a correction). It goes through finance-api's journal routes as the
// person who asked, with X-Work-Via naming the agent and the run.
//
// There is no tool to approve one: that route refuses an agent, and only the
// CFO approves, on the Journals page. finance-api then creates it in Xero as a
// DRAFT. Nothing an agent does here reaches Xero.

const NAMES = ["propose_journal", "list_journals"];

// Only these roles are offered the tool; finance-api refuses any other agent.
const ROLES = ["fm1", "fc"];

function tools(entityEnum) {
  return [
    {
      name: "list_journals",
      description: "List a month's journals in os.stza.io: the Journals page's own and those proposed on reconciliations, each with its number (jnl, such as JNL-7), company, date, narration, total, state and, once in Xero, Xero's own journal number. When a person names a journal as JNL-n, find it here. Read only.",
      input_schema: {
        type: "object",
        properties: { period: { type: "string", description: "YYYY-MM" } },
        required: ["period"],
      },
    },
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
    if (name === "list_journals") {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.period))) return { error: "period must be YYYY-MM" };
      const res = await apiRequest("GET", `/api/finance/clients/${encodeURIComponent(job.client.slug)}/journals?period=${encodeURIComponent(input.period)}`);
      if (!res.ok) return { error: res.body?.error ?? `Could not read the journals (${res.status})` };
      return {
        period: res.body.period,
        journals: (res.body.journals ?? []).map((j) => ({
          jnl: j.jnl, company: j.entity_name, date: j.journal_date, narration: j.narration, total: j.total,
          state: j.state, xero_journal_no: j.xero_journal_no ?? null, on_rec: j.rec?.account_name ?? null, rec_id: j.rec?.id ?? null,
          lines: j.lines, reason: j.reason ?? null,
        })),
      };
    }
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
      note: `Recorded on the Journals page for the CFO as ${res.body.jnl ?? "a new journal"}. Nothing has gone to Xero. Say so in your answer, naming it ${res.body.jnl ?? "by its number"}, with the company, date, narration, codes and amounts.`,
    };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentJournals, NAMES, ROLES };

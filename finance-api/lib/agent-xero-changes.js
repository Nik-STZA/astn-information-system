// Agent tools that propose a change to Xero for the CFO (lib/xero-changes.js).
// The agent proposes; the CFO approves on the Xero changes screen in
// os.stza.io; finance-api then makes it through the same write route Cowork
// uses. There is no tool to approve: that route refuses an agent.
//
// Fixed assets first. Each later write (lib/agent-parity.js, to_build) joins
// here as its own tool, with the fields that write needs.

const NAMES = ["propose_fixed_asset", "list_xero_changes"];

// Who is offered which tool; finance-api checks again (KINDS[kind].proposers).
const ROLES = { propose_fixed_asset: ["fm1", "fc"], list_xero_changes: ["fm1", "fc"] };

function tools(entityEnum) {
  return [
    {
      name: "propose_fixed_asset",
      description: "Propose a fixed asset for the company's register in Xero, from the purchase that bought it, for the CFO to approve in os.stza.io. Nothing reaches Xero until the CFO approves; it is then created in Xero's register as a DRAFT, and a person registers it there, which starts depreciation. Use it when a purchase coded to an asset account (or that meets the client's capitalisation rule) is not in the register. Read the asset types first with get_fixed_assets what=types and pick the one whose cost account the purchase was coded to; its depreciation method and life are copied in unless you give them. Leave asset_number out and the next number in the register is used. Do not ask for a reply.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum },
          asset_name: { type: "string", description: "What it is, as a person would name it, e.g. Laptop for the finance team" },
          asset_type_id: { type: "string", description: "From get_fixed_assets what=types" },
          purchase_date: { type: "string", description: "YYYY-MM-DD, the date on the bill" },
          purchase_price: { type: "number", description: "Cost, net of recoverable VAT" },
          source_doc: { type: "string", description: "The id of the Xero bill or bank transaction that bought it" },
          reason: { type: "string", description: "What was bought, the document that shows it, the account it was coded to, and why it is an asset. Stays in os.stza.io" },
          description: { type: "string", description: "Optional: lands in Xero" },
          serial_number: { type: "string" },
          warranty_expiry: { type: "string", description: "YYYY-MM-DD" },
          depreciation_start_date: { type: "string", description: "YYYY-MM-DD. The purchase date if left out" },
          depreciation_method: { type: "string", description: "Only to override the type: StraightLine, DiminishingValue100, DiminishingValue150, DiminishingValue200, FullDepreciation, NoDepreciation" },
          effective_life_years: { type: "integer", description: "Only to override the type" },
          asset_number: { type: "string", description: "Only if the register's next number should not be used" },
          allow_duplicate: { type: "boolean", description: "Only when the register already has an asset bought the same day for the same price and this is genuinely a second one; say why in reason" },
        },
        required: ["entity", "asset_name", "asset_type_id", "purchase_date", "purchase_price", "reason"],
      },
    },
    {
      name: "list_xero_changes",
      description: "List the changes to Xero proposed for this client (fixed assets so far), waiting for the CFO or made in the last two weeks: what each is, its state, and what Xero said. Read only.",
      input_schema: { type: "object", properties: {} },
    },
  ];
}

function agentXeroChanges({ apiRequest, requesterOf }) {
  const base = (job) => `/api/finance/clients/${encodeURIComponent(job.client.slug)}/xero-changes`;

  async function call(job, name, input) {
    if (!NAMES.includes(name)) return { error: `Unknown tool: ${name}` };
    if (!(ROLES[name] || []).includes(job.agent)) return { error: `${name} is not one of your tools.` };
    if (name === "list_xero_changes") {
      const res = await apiRequest("GET", base(job));
      if (!res.ok) return { error: res.body?.error ?? `Could not read the Xero changes (${res.status})` };
      if (res.body.migration_missing) return { changes: [], note: "Xero changes are not switched on yet." };
      return {
        changes: (res.body.changes ?? []).map((c) => ({
          id: c.id, kind: c.kind, company: c.entity_name, summary: c.summary, state: c.state, proposed_by: c.proposed_by,
          last_error: c.last_error, xero_id: c.xero_id,
        })),
      };
    }
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was recorded." };
    const { allow_duplicate, ...fields } = input || {};
    const res = await apiRequest("POST", base(job), { kind: "create_fixed_asset", ...fields, ...(allow_duplicate === true ? { allow_duplicate: true } : {}) }, {
      "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent}:${job.id}`,
    });
    if (!res.ok) return { saved: false, status: res.status, refused: res.body };
    return {
      saved: true, id: res.body.id, summary: res.body.summary, warnings: res.body.warnings ?? [],
      note: `Proposed on the Xero changes screen for the CFO: ${res.body.summary}. Nothing has gone to Xero. Say so in your answer, with the company, the asset, its type, the date and the cost, and any warnings.`,
    };
  }

  return { tools, call, names: NAMES };
}

// The tools one agent is offered.
const toolsFor = (agent, entityEnum) => tools(entityEnum).filter((t) => (ROLES[t.name] || []).includes(agent));

module.exports = { agentXeroChanges, NAMES, ROLES, toolsFor };

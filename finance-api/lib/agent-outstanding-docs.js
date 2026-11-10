// Outstanding documents tools for the agent runner (10 Nov 2026): FM1 and the
// FC read the client's register of transactions without their document, run
// the check against Xero at month end, and note what they find.
//
// The check itself is finance-api's (POST .../xero-check), by evidence only:
// an item clears when Xero holds an attachment on the record it became, and
// the month's spend money and bills with no attachment come in as lines for
// a person to accept. An agent cannot accept, dismiss or close an item.

const ROLES = ["fm1", "fc"];
const NAMES = ["list_outstanding_documents", "check_outstanding_documents_in_xero", "note_outstanding_document"];

function tools(entityEnum, agent) {
  if (!ROLES.includes(agent)) return [];
  const entity = { type: "string", enum: entityEnum, description: "One company only; leave out for all" };
  return [
    {
      name: "list_outstanding_documents",
      description:
        "The client's outstanding documents register in os.stza.io: transactions with no supporting invoice, receipt or contract, " +
        "with the concern each raises (no VAT invoice, audit evidence, business purpose, overseas reverse charge, payee unknown), " +
        "whether VAT is not recoverable, the card holder or processor, and how often it has been chased. Open items by default.",
      input_schema: {
        type: "object",
        properties: { entity, include_waiting: { type: "boolean", description: "Also list lines read from uploads that a person has not accepted yet" } },
        required: [],
      },
    },
    {
      name: "check_outstanding_documents_in_xero",
      description:
        "Run the month-end check of the register against Xero. Each open item is matched to the Xero record its bank line became " +
        "(spend or receive money, or a payment on a bill); when that record has an attachment the item is cleared as received. " +
        "The month's spend money and supplier bills with no attachment above the client's threshold are added as lines for a " +
        "person to accept. Bank lines not yet reconciled are not in Xero and still come from the bank reconciliation reports. " +
        "Run it once per close; report what it cleared and added.",
      input_schema: {
        type: "object",
        properties: { month: { type: "string", description: "The close month, YYYY-MM" }, entity },
        required: ["month"],
      },
    },
    {
      name: "note_outstanding_document",
      description:
        "Add a dated note to one item on the register, keeping what is there: what you found in Xero or the ledger, " +
        "who to ask, what the document should show. Short and factual; never a judgement on whether to accept it.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "The item id from list_outstanding_documents" }, text: { type: "string" } },
        required: ["id", "text"],
      },
    },
  ];
}

// An item as an agent needs it.
function itemView(i) {
  return {
    id: i.id, state: i.state, company: i.entity_slug, date: i.txn_date, payee: i.payee, reference: i.reference,
    card_holder: i.card_holder, bank_account: i.bank_account, direction: i.direction, amount: i.amount, currency: i.currency,
    amount_gbp: i.amount_gbp, concern: i.concern, vat_not_recoverable: i.vat?.flagged ?? false, vat_at_risk_up_to: i.vat?.at_risk_max ?? null,
    chased: i.chase_count, last_chased: i.last_chased_at, note: i.note, in_xero: i.xero_id ? i.xero_type : null,
  };
}

// apiCall (throws), apiRequest (returns { ok, status, body }) and requesterOf
// are the runner's own.
function agentOutstandingDocs({ apiCall, apiRequest, requesterOf }) {
  async function call(job, name, input = {}) {
    const base = `/api/finance/clients/${encodeURIComponent(job.client.slug)}/outstanding-documents`;
    if (name === "list_outstanding_documents") {
      const r = await apiCall("GET", base);
      if (r.migration_missing) return { error: "Outstanding documents are not switched on for this client yet." };
      const items = (r.items || []).filter((i) => (i.state === "open" || (input.include_waiting && i.state === "candidate"))
        && (!input.entity || i.entity_slug === input.entity));
      return { count: items.length, summary: r.summary, threshold: r.threshold, items: items.map(itemView) };
    }
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so nothing was done." };
    const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent || "general"}:${job.id}` };
    if (name === "check_outstanding_documents_in_xero") {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.month ?? ""))) return { error: "month must be YYYY-MM" };
      const res = await apiRequest("POST", `${base}/xero-check`, { month: input.month, ...(input.entity ? { entity: input.entity } : {}) }, headers);
      if (!res.ok) return { done: false, status: res.status, refused: res.body };
      return {
        done: true, month: res.body.month, companies: res.body.companies,
        note: "Cleared items had their attachment found in Xero. Added lines wait for a person to accept on the Outstanding documents page. Report both, and any company Xero could not be read for.",
      };
    }
    if (name === "note_outstanding_document") {
      if (!/^[0-9a-f-]{36}$/i.test(String(input.id))) return { saved: false, error: "id must be an item id from list_outstanding_documents" };
      const res = await apiRequest("POST", `${base}/${input.id}/note`, { text: input.text }, headers);
      if (!res.ok) return { saved: false, status: res.status, refused: res.body };
      return { saved: true, note: "Added to the item's note with your name and the date." };
    }
    return { error: `Unknown tool: ${name}` };
  }
  return { tools, call, names: NAMES, roles: ROLES };
}

module.exports = { agentOutstandingDocs, itemView, ROLES, NAMES };

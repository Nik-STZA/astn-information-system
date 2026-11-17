// Contracts register tools for the agent runner (18 Nov 2026): FM1 and the FC
// read the client's customer contracts and record a billing from the Xero
// sales invoice that raised it, so the Deferred income reconciliation's
// evidence (the register) is complete without the CFO keying it. Releases,
// a contract's terms and how it becomes revenue stay with a person.
//
// A billing is recorded through finance-api as the person who asked, with
// X-Work-Via naming the agent and run; finance-api reads the invoice from Xero
// and refuses one already recorded.

const NAMES = ["list_contracts", "record_contract_billing"];

function tools() {
  return [
    {
      name: "list_contracts",
      description:
        "The client's customer contracts in the contracts register (os.stza.io): company, customer, the balance sheet account each holds money on, " +
        "value, how it becomes revenue (and whether the CFO has confirmed that), what it holds now, and every billing and release recorded with its " +
        "invoice reference. Compare the billings with the sales invoices posted to the account (get_account_activity) to find any not yet recorded.",
      input_schema: { type: "object", properties: { include_ended: { type: "boolean" } }, required: [] },
    },
    {
      name: "record_contract_billing",
      description:
        "Record a billing on a customer contract from the Xero sales invoice that raised it: the net of the invoice's lines on the contract's account, " +
        "on the invoice date. Use it when a sales invoice posted to the contract's deferred income account is missing from the register, then fetch " +
        "the Deferred income reconciliation's evidence again. Only an approved invoice with a line on the account counts; one already recorded is refused. " +
        "You cannot record a release: that waits for its journal in Xero and the CFO.",
      input_schema: {
        type: "object",
        properties: {
          contract_id: { type: "string", description: "From list_contracts" },
          invoice_number: { type: "string", description: "The Xero invoice number, e.g. INV-0003" },
        },
        required: ["contract_id", "invoice_number"],
      },
    },
  ];
}

// A contract as an agent needs it.
function contractView(c, movements = []) {
  return {
    id: c.id, company: c.entity_name, customer: c.counterparty, title: c.title ?? null, account: c.account_code ?? null,
    value: c.total_value, currency: c.currency, status: c.status, starts: c.start_date, ends: c.end_date,
    becomes_revenue: c.pattern_label ?? c.pattern, confirmed_by_cfo: Boolean(c.pattern_confirmed_at), held_now: c.held,
    movements: movements.filter((m) => !m.withdrawn_at).map((m) => ({ kind: m.kind, on: m.on_date, amount: m.amount, ref: m.ref ?? null })),
  };
}

// apiCall (throws), apiRequest (returns { ok, status, body }) and requesterOf
// are the runner's own.
function agentContracts({ apiCall, apiRequest, requesterOf }) {
  const base = (job) => `/api/finance/clients/${encodeURIComponent(job.client.slug)}/contracts`;

  async function call(job, name, input = {}) {
    if (name === "list_contracts") {
      const r = await apiCall("GET", `${base(job)}?side=customer${input.include_ended ? "&status=all" : ""}`);
      if (r?.migration_missing) return { error: "The contracts register is not set up for this client yet." };
      const out = [];
      for (const c of (r?.contracts ?? []).filter((x) => x.side === "customer")) {
        const d = await apiCall("GET", `${base(job)}/${c.id}`).catch(() => null);
        out.push(contractView({ ...c, held: c.held }, d?.movements ?? []));
      }
      return { count: out.length, contracts: out };
    }
    if (name === "record_contract_billing") {
      if (!/^[0-9a-f-]{36}$/i.test(String(input.contract_id))) return { saved: false, error: "contract_id must be an id from list_contracts" };
      const actor = await requesterOf(job);
      if (!actor) return { saved: false, error: "The person who asked could not be found, so nothing was recorded." };
      const headers = { "X-Actor-Email": actor, "X-Work-Via": `agent:${job.agent || "general"}:${job.id}` };
      const res = await apiRequest("POST", `${base(job)}/${input.contract_id}/billed-from-invoice`, { invoice_number: input.invoice_number }, headers);
      if (!res.ok) return { saved: false, status: res.status, refused: res.body };
      return { saved: true, ...res.body, note: "Recorded in the contracts register from the Xero invoice. Fetch the Deferred income reconciliation's evidence again, and tell the user." };
    }
    return { error: `Unknown tool: ${name}` };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentContracts, contractView };

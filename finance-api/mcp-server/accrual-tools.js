// ─────────────────────────────────────────────────────────────────────────────
// Accrual tools: a Claude conversation reads a client's accrual history and
// raises or discusses an accrual proposal in os.stza.io (docs/accruals-spec.md).
//
// Served beside the practice toolset (STZA's own Claude), not the client-facing
// one. Every call goes to finance-api's accruals routes as STZA_ACTOR_EMAIL,
// with X-Work-Via: claude, so each proposal and comment says it came from
// Claude. finance-api refuses a decision from here: only the CFO decides, in
// os.stza.io. Nothing here reaches Xero.
// ─────────────────────────────────────────────────────────────────────────────

const s = (description) => ({ type: "string", description });

function tool(name, description, props, required) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { client: s("Client slug, e.g. feldspar or stza"), ...props },
      required: ["client", ...required],
      additionalProperties: false,
    },
  };
}

export function accrualTools({ apiUrl, apiKey, actorEmail, log }) {
  async function request(method, path, json) {
    const headers = { "X-API-Key": await apiKey(), Accept: "application/json" };
    if (method !== "GET") {
      if (!actorEmail) throw new Error("Set STZA_ACTOR_EMAIL: every accrual proposal and comment is attributed to a person");
      Object.assign(headers, { "X-Actor-Email": actorEmail, "X-Work-Via": "claude", "Content-Type": "application/json" });
    }
    log(`${method} ${path}`);
    const r = await fetch(`${apiUrl}${path}`, { method, headers, body: json ? JSON.stringify(json) : undefined });
    const text = await r.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 2000) }; }
    return { status: r.status, ok: r.ok, body: parsed };
  }
  const base = (a) => `/api/finance/clients/${encodeURIComponent(a.client)}/accruals`;

  const T = [];
  const H = {};
  const def = (t, h) => { T.push(t); H[t.name] = h; };

  def(tool("get_accrual_history", "Read before proposing an accrual. Per supplier, for this client only: earlier proposals with the CFO's decisions, reasons and comments; the precedents in force with their ids; standing items; and each month's bill against what was accrued", {
    period: s("YYYY-MM, the month being worked"),
    months: { type: "integer", description: "How many months back, 1 to 36. Default 12" },
  }, ["period"]),
  async (a) => {
    const q = new URLSearchParams({ period: a.period, months: String(a.months ?? 12) });
    const r = await request("GET", `${base(a)}/history?${q}`);
    if (!r.ok) throw new Error(`${base(a)}/history -> ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.body;
  });

  def(tool("propose_accrual", "Raise one accrual candidate on the client's Accruals page for the CFO to discuss and decide. Lines are the cost, Dr, net of VAT; the credit to the accruals account and the reversal are made by the platform. Set confidence open with no lines where a fact from outside the ledger is needed. Cite the precedent followed in precedent_ids, or say in departs_reason what is different this month", {
    entity: s("Portal slug of the company"),
    period: s("The service month, YYYY-MM"),
    supplier: s("Supplier name"),
    contact_id: s("The supplier's Xero ContactID, when known"),
    test: { type: "string", enum: ["continuity", "backward", "gap", "forward", "reverse_cutoff"] },
    lines: { type: "array", items: { type: "object" }, description: "[{ account_code, amount, description? }]; empty for an open question" },
    service_from: s("YYYY-MM-DD"),
    service_to: s("YYYY-MM-DD"),
    basis_kind: { type: "string", enum: ["contract", "purchase_order", "last_bill", "estimate"] },
    basis: s("What the amount rests on; for an estimate, who gave it"),
    evidence: { type: "array", items: { type: "object" }, description: "Invoice ids, lines, document references" },
    confidence: { type: "string", enum: ["high", "medium", "open"] },
    precedent_ids: { type: "array", items: { type: "string" } },
    departs_reason: s("Why this month differs from a precedent that applies"),
  }, ["entity", "period", "supplier", "test", "basis_kind", "basis", "confidence"]),
  async (a) => {
    const { client, ...body } = a;
    const r = await request("POST", `${base(a)}/proposals`, body);
    if (r.status === 409 && r.body?.not_raised) return { raised: false, not_raised: true, ...r.body };
    return r.ok ? { raised: true, ...r.body, note: "On the Accruals page for the CFO. Nothing has gone to Xero." } : { raised: false, status: r.status, refused: r.body };
  });

  def(tool("comment_on_accrual", "Reply on an accrual proposal's discussion in os.stza.io with what was found. Claude cannot decide; the CFO does", {
    proposal_id: s("From get_accrual_history or the Accruals page"),
    body: s("The comment"),
  }, ["proposal_id", "body"]),
  async (a) => {
    const r = await request("POST", `${base(a)}/proposals/${encodeURIComponent(a.proposal_id)}/comments`, { body: a.body });
    return r.ok ? { saved: true } : { saved: false, status: r.status, refused: r.body };
  });

  return { tools: T, handlers: H };
}

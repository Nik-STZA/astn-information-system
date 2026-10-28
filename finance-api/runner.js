#!/usr/bin/env node
//
// STZA Finance Agent Runner
//
// Polls the finance-api for queued agent jobs, executes them against the
// Anthropic Messages API with Xero-backed tools, and reports results back.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... FINANCE_API_KEY=... node runner.js
//
// Optional env:
//   FINANCE_API_URL  (default http://127.0.0.1:8080)
//   POLL_INTERVAL_MS (default 5000)
//   MODEL            (default claude-sonnet-5)
//   MAX_TURNS        (default 25)
//   RUNNER_ONCE      1 (or --once): run every queued job, then exit. This is how
//                    the Cloud Run Job agent-runner runs: finance-api starts it
//                    when a run is queued, so nothing sits polling.

const Anthropic = require("@anthropic-ai/sdk").default;

// ── Config ───────────────────────────────────────────────────────────────────

const API_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";
// Trimmed: a secret mounted by Cloud Run arrives exactly as stored, and a
// trailing newline breaks the header (the api-key CRLF incident, July 2026).
const API_KEY = (process.env.FINANCE_API_KEY || "").trim() || undefined;
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const MODEL = process.env.MODEL || "claude-sonnet-5";
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "25", 10);
const ONCE = process.env.RUNNER_ONCE === "1" || process.argv.includes("--once");

if (!API_KEY) {
  console.error("FINANCE_API_KEY is required");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY.trim() });

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiCall(method, path, body) {
  const opts = {
    method,
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${API_URL}${path}`, opts);
  if (r.status === 204) return null;
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

// Like apiCall, but returns the status and body instead of throwing, so a
// validation refusal from finance-api can be handed back to the agent intact.
async function apiRequest(method, path, body, headers = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text().catch(() => "");
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  return { ok: r.ok, status: r.status, body: parsed };
}

async function claimJob() {
  return apiCall("POST", "/api/finance/agent-runs/claim");
}

async function completeJob(id, result) {
  return apiCall("POST", `/api/finance/agent-runs/${id}/complete`, result);
}

async function listEntities(slug) {
  return apiCall("GET", `/api/finance/clients/${encodeURIComponent(slug)}/entities`);
}

async function xeroCall(slug, entity, report, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const path = `/api/finance/clients/${encodeURIComponent(slug)}/xero/${encodeURIComponent(entity)}/${report}`;
  return apiCall("GET", `${path}${qs ? `?${qs}` : ""}`);
}

// ── Tool definitions ─────────────────────────────────────────────────────────
//
// Each tool maps to one of the Xero data endpoints in finance-api/server.js.
// The runner resolves the client slug at claim time and threads it through.

function buildTools(clientSlug, entities) {
  const entityEnum = entities.map((e) => e.slug);
  const entityDesc = entities.map((e) => `${e.slug} (${e.name})`).join(", ");

  return [
    {
      name: "list_entities",
      description: `List all entities (companies) connected for this client. Available: ${entityDesc}`,
      input_schema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_trial_balance",
      description: "Get the trial balance from Xero for an entity. Returns all account balances as at a date.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          date: { type: "string", description: "As-at date (YYYY-MM-DD). Defaults to today." },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_profit_and_loss",
      description: "Get the profit and loss report from Xero. For a month-by-month (or quarterly) view, pass the full range as fromDate/toDate with timeframe MONTH (or QUARTER): the platform fetches each whole period separately and returns one column per period, oldest first, with totals already computed. Without timeframe, returns one column for the whole range.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          fromDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          toDate: { type: "string", description: "End date (YYYY-MM-DD)" },
          periods: { type: "integer", description: "Number of comparative periods" },
          timeframe: { type: "string", enum: ["MONTH", "QUARTER", "YEAR"], description: "Period grouping" },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_balance_sheet",
      description: "Get the balance sheet from Xero as at a specific date.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          date: { type: "string", description: "As-at date (YYYY-MM-DD)" },
          periods: { type: "integer", description: "Number of comparative periods" },
          timeframe: { type: "string", enum: ["MONTH", "QUARTER", "YEAR"], description: "Period grouping" },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_bank_summary",
      description: "Get the bank summary report from Xero showing cash positions across bank accounts.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          fromDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          toDate: { type: "string", description: "End date (YYYY-MM-DD)" },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_aged_receivables",
      description: "Get aged receivables — all outstanding sales invoices bucketed into current, 30, 60, 90, 90+ days overdue. Returns summary buckets and individual invoice lines with contact, amount, due date, and days overdue.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          date: { type: "string", description: "As-at date for ageing calculation (YYYY-MM-DD). Defaults to today." },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_aged_payables",
      description: "Get aged payables — all outstanding purchase invoices/bills bucketed into current, 30, 60, 90, 90+ days overdue. Returns summary buckets and individual invoice lines with supplier, amount, due date, and days overdue.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          date: { type: "string", description: "As-at date for ageing calculation (YYYY-MM-DD). Defaults to today." },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_chart_of_accounts",
      description: "Get the full chart of accounts (account codes, names, types, balances).",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
        },
        required: ["entity"],
      },
    },
    {
      name: "list_bills_queue",
      description:
        "List the Bills queue in os.stza.io for an entity: supplier documents the AP engine has read (from the Documents inbox " +
        "or from draft bills Xero keyed), each with its state and the reasons it needs the CFO. States: exception (needs a " +
        "decision), clean, approved (ready to send), written (in Xero awaiting approval), skipped, rejected.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          state: { type: "string", description: "Comma-separated states. Default exception,clean,approved" },
        },
        required: ["entity"],
      },
    },
    {
      name: "get_bill_item",
      description:
        "One Bills queue item in full: what the engine read from the document (supplier, addressee, type, dates, totals and " +
        "each line), the bill it proposes with each line's index, account and VAT treatment, the checks it failed, how Xero's " +
        "own draft differed, and any earlier recommendation. Read this before recommending coding.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          item_id: { type: "string", description: "Queue item id from list_bills_queue" },
        },
        required: ["entity", "item_id"],
      },
    },
    {
      name: "get_bill_coding_options",
      description: "The active expense and balance-sheet accounts (code and name), VAT treatments (type and name) and suppliers this entity's bills can use.",
      input_schema: {
        type: "object",
        properties: { entity: { type: "string", enum: entityEnum, description: "Entity slug" } },
        required: ["entity"],
      },
    },
    {
      name: "recommend_bill_coding",
      description:
        "Attach your recommended coding to a Bills queue item: an account code and VAT type for each line (by its index from " +
        "get_bill_item), a short reason per line, an optional due date, and a note. The CFO sees it on the item and accepts or " +
        "changes it. It does not approve, change or send the bill, and nothing reaches Xero. Codes must come from " +
        "get_bill_coding_options; a refusal lists what was wrong.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          item_id: { type: "string", description: "Queue item id" },
          lines: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                index: { type: "integer", description: "Line index from get_bill_item, starting at 0" },
                account_code: { type: "string" },
                tax_type: { type: "string", description: "VAT type, e.g. INPUT2, REVERSECHARGES, NONE" },
                reason: { type: "string", description: "Why this account and VAT treatment, in a sentence" },
              },
              required: ["index", "account_code", "tax_type", "reason"],
            },
          },
          due_date: { type: "string", description: "YYYY-MM-DD, only when the bill has none or it is wrong" },
          note: { type: "string", description: "Your overall view for the CFO, including anything else to check (entity, evidence, VAT)" },
        },
        required: ["entity", "item_id", "lines", "note"],
      },
    },
    {
      name: "create_draft_journal",
      description:
        "Create a manual journal in Xero as a DRAFT, for a person to review and post in Xero. It never posts to the ledger. " +
        "It only works in a follow-up where the user has plainly approved a journal you proposed in your previous answer: the " +
        "platform checks the entity, the date, every account code and every amount against that answer, word for word, and " +
        "rejects anything that differs. Use exactly the lines you proposed.",
      input_schema: {
        type: "object",
        properties: {
          entity: { type: "string", enum: entityEnum, description: "Entity slug" },
          date: { type: "string", description: "Journal date (YYYY-MM-DD), as shown in the proposal" },
          narration: { type: "string", description: "Journal narration, as shown in the proposal" },
          lines: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                account_code: { type: "string", description: "Account code, as shown in the proposal" },
                description: { type: "string" },
                amount: { type: "number", description: "Debit positive, credit negative, two decimals" },
              },
              required: ["account_code", "amount"],
            },
          },
        },
        required: ["entity", "date", "narration", "lines"],
      },
    },
    ...work.tools(entityEnum),
  ];
}

// Map tool name → Xero endpoint slug used in the API path
const TOOL_TO_ENDPOINT = {
  get_trial_balance: "trial-balance",
  get_profit_and_loss: "profit-and-loss",
  get_balance_sheet: "balance-sheet",
  get_bank_summary: "bank-summary",
  get_aged_receivables: "aged-receivables",
  get_aged_payables: "aged-payables",
  get_chart_of_accounts: "accounts",
};

// A P&L across several periods is built from one Xero call per whole period,
// with the totals computed in code. lib/pnl-periods.js records the three ways
// Xero's own comparatives misled an agent on 11 Sep 2026.
const { planPnl, mergeReports } = require("./lib/pnl-periods");

// The client's reporting currency, so the agent labels money correctly. Without
// it, "CA(SA)" in the prompt led an agent to show a GBP ledger in rand.
async function clientCurrency(slug) {
  const clients = await apiCall("GET", "/api/finance/clients");
  return clients?.data?.find((c) => c.slug === slug)?.reporting_currency ?? null;
}

// ── Draft journals ───────────────────────────────────────────────────────────
//
// The agent may create a journal in Xero only as a DRAFT, and only through the
// governed endpoint, which validates it against what the approver saw. The
// approval comes from the stored conversation, never from the agent: see
// lib/draft-approval.js.

const { approvalFromThread } = require("./lib/draft-approval");

async function createDraftJournal(job, input) {
  const slug = encodeURIComponent(job.client.slug);
  const runs = (await apiCall("GET", `/api/finance/clients/${slug}/agent-runs`))?.data ?? [];
  const current = runs.find((r) => r.id === job.id);
  const parent = job.parentRunId ? runs.find((r) => r.id === job.parentRunId) : null;

  const a = approvalFromThread({ current, parent });
  if (a.error) return { error: a.error };

  const body = {
    entity: input.entity,
    date: input.date,
    narration: input.narration,
    lines: input.lines,
    status: "DRAFT", // never POSTED from here: a person posts it in Xero
    approval: a.approval,
  };
  const path = `/api/finance/clients/${slug}/xero/${encodeURIComponent(input.entity)}/journals`;
  const headers = { "X-Actor-Email": current.requested_by_email };

  // Dry run first, so a mismatch with the approved text comes back without
  // anything reaching Xero.
  const dry = await apiRequest("POST", path, { ...body, dry_run: true }, headers);
  if (!dry.ok) {
    return {
      error: "The platform refused the journal before it reached Xero. Nothing was created.",
      status: dry.status,
      detail: dry.body,
    };
  }

  const res = await apiRequest("POST", path, { ...body, idempotency_key: `agent-run-${job.id}` }, headers);
  if (!res.ok) {
    return { error: "Xero or the platform refused the draft. Nothing was created.", status: res.status, detail: res.body };
  }
  return {
    created: true,
    status: res.body?.status ?? "DRAFT",
    journal_number: res.body?.journal_number,
    journal_id: res.body?.journal_id,
    audit_id: res.body?.audit_id,
    warnings: res.body?.warnings,
    note: "Created in Xero as a DRAFT. Nothing is posted to the ledger until a person reviews and posts it in Xero. Tell the user that.",
  };
}

// ── The Bills queue ──────────────────────────────────────────────────────────
//
// The AP engine in finance-api reads supplier documents and queues proposed
// bills (docs/ap-lane). An agent reads the queue and may attach a recommended
// coding; it cannot approve or send. The CFO does both in the Bills tab.

const apPath = (slug, entity) =>
  `/api/finance/clients/${encodeURIComponent(slug)}/xero/${encodeURIComponent(entity)}/ap`;

// The person who asked: recommendations are recorded against them, and they
// must hold an engagement role for the client.
async function requesterOf(job) {
  const runs = (await apiCall("GET", `/api/finance/clients/${encodeURIComponent(job.client.slug)}/agent-runs`))?.data ?? [];
  return runs.find((r) => r.id === job.id)?.requested_by_email ?? null;
}

// One item, without the engine's bookkeeping (tokens, hashes, run ids).
function billItemView(i) {
  const bill = i.proposed_bill || {};
  return {
    id: i.id, state: i.state, state_reason: i.state_reason, source: i.source, file_name: i.file_name,
    supplier_matched_by: i.matched_by,
    document: i.extraction,
    proposed_bill: {
      supplier: bill.Contact?.Name ?? null, number: bill.InvoiceNumber || null, date: (bill.DateString || "").slice(0, 10) || null,
      due_date: (bill.DueDateString || "").slice(0, 10) || null, currency: bill.CurrencyCode, amounts_are: bill.LineAmountTypes,
      total: bill.Total, vat: bill.TotalTax,
      lines: (bill.LineItems || []).map((l, index) => ({ index, description: l.Description, amount: l.LineAmount, account_code: l.AccountCode, tax_type: l.TaxType })),
    },
    checks_failed: i.review?.reasons ?? [],
    xero_draft_differences: i.review?.draft_differences ?? null,
    earlier_recommendation: i.recommendation ?? null,
    decided: i.decided_at ? { by: i.decided_by_email, at: i.decided_at, note: i.decision_note } : null,
  };
}

async function billsTool(job, name, input) {
  const base = apPath(job.client.slug, input.entity);
  if (name === "list_bills_queue") {
    const r = await apiCall("GET", `${base}/items?state=${encodeURIComponent(input.state || "exception,clean,approved")}`);
    return { count: r.count, items: (r.items || []).map((i) => ({
      id: i.id, state: i.state, source: i.source, supplier: i.supplier, number: i.number, date: i.date, total: i.total,
      currency: i.currency, reasons: (i.reasons || []).map((x) => x.check), recommended: i.recommended, file_name: i.file_name,
    })) };
  }
  if (name === "get_bill_item") return billItemView(await apiCall("GET", `${base}/items/${encodeURIComponent(input.item_id)}`));
  if (name === "get_bill_coding_options") return apiCall("GET", `${base}/options`);
  if (name === "recommend_bill_coding") {
    const actor = await requesterOf(job);
    if (!actor) return { error: "The person who asked could not be found, so the recommendation was not saved." };
    const res = await apiRequest("POST", `${base}/items/${encodeURIComponent(input.item_id)}/recommendation`, {
      lines: input.lines, due_date: input.due_date, note: input.note, agent: job.agent || "general", run_id: job.id,
    }, { "X-Actor-Email": actor });
    if (!res.ok) return { saved: false, status: res.status, refused: res.body };
    return { saved: true, note: "Saved on the item for the CFO, who accepts or changes it in the Bills tab. Nothing was approved or sent; tell the user that." };
  }
  return { error: `Unknown tool: ${name}` };
}

// ── Work ─────────────────────────────────────────────────────────────────────
//
// The client's task list in os.stza.io: lib/agent-work.js.

const work = require("./lib/agent-work").agentWork({ apiCall, apiRequest, requesterOf });

// ── System prompts per agent role ────────────────────────────────────────────

const SYSTEM_BASE = `You are a finance agent working inside the STZA Finance OS. You have access to live Xero accounting data via tools. You are acting on behalf of a qualified Chartered Accountant (CA(SA)) with Big 4 experience.

Key rules:
- Be precise with numbers. Use commas as thousand separators, two decimal places for money.
- Show money in the client's reporting currency, given below. Never use any other currency symbol.
- When a tool gives you totals, quote them. Do not add figures up yourself; if you must, say the figure is your own addition.
- Dates should be formatted as "27 May 2026" (no ordinals).
- When presenting financial data, use tables where appropriate.
- If data looks unusual or inconsistent, flag it. Auditor mindset.
- Do not make up numbers. If a tool returns an error, say so.
- Keep your response concise and professional. No waffle.
- State your conclusion or recommendation clearly at the end.

Journals:
- You can create a manual journal in Xero only as a DRAFT, and only after the user approves it. You can never post one.
- First, check the chart of accounts, then reply with a proposal headed "Proposed journal (draft)". It must name the entity, give the date in YYYY-MM-DD form (for example 2026-08-31), give the narration, and list each line with ONE account code, a description and the amount. If you are unsure which account to use, ask; do not list alternatives. End by asking the user to reply "approved" to create it as a draft in Xero.
- Only when the user's follow-up plainly approves that proposal, call create_draft_journal with exactly the proposed entity, date, narration, codes and amounts (debits positive, credits negative). If they ask for a change, make it and propose again.
- After creating it, say it is a draft in Xero awaiting their review and posting, and give the journal number.

The Bills queue:
- "Bills" means the Bills tab in os.stza.io, not Xero's bills list. Read it with list_bills_queue and get_bill_item. Draft bills in Xero do not appear in aged payables, so never look for a Bills item there.
- To review coding, read the item (the document's own lines, addressee and dates) and get_bill_coding_options, then save your view with recommend_bill_coding: one account and VAT type per line, each with a one-sentence reason, and a note for anything else to check.
- Code from the document, not the supplier's habit. A charge for a later period is a prepayment. A document addressed to another group company belongs to that company: say so in the note rather than coding around it. VAT follows the supplier's position (a non-UK supplier of services is usually reverse charge) and what the document can support.
- You cannot approve, change or send a bill. The CFO accepts or changes your recommendation in the Bills tab; say that when you finish.

Work (the client's task list in os.stza.io):
- When you find something that needs doing later (a break to clear, a document to chase, a journal to review), read list_tasks, then add_task if it is not already there. One task per thing, with the evidence in the notes.
- When you finish or progress a task in Work, update_task with a note of what you did. Mark it done only when you have checked it is done; use review when a person should check it.
- You cannot delete tasks. At the end, list any tasks you added or changed.`;

const AGENT_PROMPTS = {
  fc: `${SYSTEM_BASE}

You are the Financial Controller (FC) agent. Your focus is:
- Month-end close quality and completeness
- Trial balance reviews and variance analysis
- Balance sheet substantiation
- Management reporting commentary
- Identifying mispostings, unusual balances, and reconciliation breaks
- Ensuring the books are accurate and audit-ready`,

  "fpa": `${SYSTEM_BASE}

You are the FP&A (Financial Planning & Analysis) agent. Your focus is:
- Budget vs actual variance analysis
- Revenue and cost trend analysis
- Runway and cash burn calculations
- Scenario modelling and sensitivity analysis
- KPI tracking and business performance insights
- Identifying the story behind the numbers for board and investor updates`,

  fm2: `${SYSTEM_BASE}

You are the FM2 (Finance Manager 2) agent, reviewing AP, AR and VAT work. Your focus is:
- Accounts payable and accounts receivable reviews
- Aged debtor and creditor analysis
- Payment run preparation and prioritisation
- VAT return reconciliation and compliance
- Working capital optimisation
- Identifying overdue items and collection priorities`,

  "ap-clerk": `${SYSTEM_BASE}

You are the AP Clerk agent. Your focus is:
- Accounts payable posting accuracy
- Vendor setup and maintenance
- Invoice matching and reconciliation
- Payment allocation
- Flagging duplicate invoices or unusual supplier activity
- Maintaining clean supplier records`,
};

// ── Follow-ups ───────────────────────────────────────────────────────────────
//
// A follow-up arrives with the earlier turns of its conversation, replayed as
// plain question and answer. See lib/thread.js.

const { threadToMessages } = require("./lib/thread");
const agentCost = require("./lib/agent-cost");

// ── Execute one job ──────────────────────────────────────────────────────────

async function executeJob(job) {
  const startMs = Date.now();
  const toolCounts = {};
  let usage = agentCost.NO_USAGE;

  console.log(`  Claimed job ${job.id} [${job.agent || "general"}]: ${job.instruction.slice(0, 80)}`);

  // 1. Discover entities for this client
  let entities;
  try {
    const entResp = await listEntities(job.client.slug);
    entities = entResp?.data ?? [];
  } catch (e) {
    console.error(`  Failed to list entities for ${job.client.slug}:`, e.message);
    return {
      status: "failed",
      error: `Could not list entities: ${e.message}`,
      durationMs: Date.now() - startMs,
    };
  }

  if (!entities.length) {
    return {
      status: "failed",
      error: "No entities connected for this client. Connect a Xero organisation first.",
      durationMs: Date.now() - startMs,
    };
  }

  const connectedEntities = entities.filter((e) => e.connected);
  if (!connectedEntities.length) {
    return {
      status: "failed",
      error: `${entities.length} entities exist but none are connected to Xero.`,
      durationMs: Date.now() - startMs,
    };
  }

  // 2. Build tools and system prompt
  const tools = buildTools(job.client.slug, connectedEntities);
  const systemPrompt = AGENT_PROMPTS[job.agent] || SYSTEM_BASE;
  const currency = await clientCurrency(job.client.slug).catch(() => null);
  const clientContext = `You are working on client: ${job.client.name} (slug: ${job.client.slug}).
Reporting currency: ${currency ?? "not recorded; label every amount with the currency code Xero returns"}.
Connected entities: ${connectedEntities.map((e) => `${e.name} (${e.slug}, year-end: ${e.yearEnd || "not set"})`).join("; ")}.
Today is ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;

  // 3. Agentic loop
  let messages = [
    ...threadToMessages(job.thread),
    { role: "user", content: job.instruction },
  ];

  let finalOutput = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Cached: the tools and system prompt once, and the conversation up to
      // the newest message. See lib/agent-cost.js.
      system: agentCost.cachedSystem(`${systemPrompt}\n\n${clientContext}`),
      tools,
      messages: agentCost.withCacheMarker(messages),
    });

    usage = agentCost.addUsage(usage, resp.usage);

    // Collect any text blocks as the final output
    const textParts = resp.content.filter((b) => b.type === "text").map((b) => b.text);
    if (textParts.length) finalOutput = textParts.join("\n");

    // If stop_reason is "end_turn" or there are no tool_use blocks, we're done
    if (resp.stop_reason === "end_turn" || !resp.content.some((b) => b.type === "tool_use")) {
      break;
    }

    // Process tool calls
    const toolUseBlocks = resp.content.filter((b) => b.type === "tool_use");
    const toolResults = [];

    for (const tu of toolUseBlocks) {
      toolCounts[tu.name] = (toolCounts[tu.name] || 0) + 1;
      console.log(`    Tool: ${tu.name}(${JSON.stringify(tu.input).slice(0, 100)})`);

      let result;
      try {
        if (tu.name === "list_entities") {
          result = { entities: connectedEntities };
        } else if (["list_bills_queue", "get_bill_item", "get_bill_coding_options", "recommend_bill_coding"].includes(tu.name)) {
          result = await billsTool(job, tu.name, tu.input);
          if (tu.name === "recommend_bill_coding") console.log(`    Recommendation: ${result.saved ? "saved" : `refused (${result.status ?? result.error})`}`);
        } else if (work.names.includes(tu.name)) {
          result = await work.call(job, connectedEntities, tu.name, tu.input);
          if (tu.name !== "list_tasks") console.log(`    Work: ${result.saved ? "saved" : `refused (${result.status ?? result.error})`}`);
        } else if (tu.name === "create_draft_journal") {
          result = await createDraftJournal(job, tu.input);
          console.log(`    Draft journal: ${result.created ? `created ${result.journal_number ?? ""}` : `refused (${result.status ?? "no approval"})`}`);
        } else if (TOOL_TO_ENDPOINT[tu.name]) {
          const endpoint = TOOL_TO_ENDPOINT[tu.name];
          const { entity, ...input } = tu.input;
          const plan = tu.name === "get_profit_and_loss" ? planPnl(input) : null;
          if (plan && plan.ranges.length > 1) {
            // One call per whole period, one at a time: Xero allows five
            // concurrent calls per organisation and the runner is not the only caller.
            const { fromDate, toDate, periods, timeframe, ...rest } = input;
            const reports = [];
            for (const r of plan.ranges) {
              const res = await xeroCall(job.client.slug, entity, endpoint, {
                ...rest, fromDate: r.fromDate, toDate: r.toDate,
              });
              reports.push(res?.report);
            }
            const period = String(timeframe).toLowerCase();
            const last = plan.ranges[plan.ranges.length - 1];
            result = {
              note:
                `Built by the platform from one Xero call per ${period}. Each column is one whole ${period}, oldest first. ` +
                `Totals are computed by the platform: quote them and do not add figures up yourself. ` +
                (plan.partialLast
                  ? `The last column (${last.label}) is still in progress: to date, not a full ${period}. `
                  : "") +
                (plan.truncated
                  ? `More than 12 columns were asked for; only the 12 most recent are included, from ${plan.ranges[0].label}. Say so in your answer. `
                  : ""),
              entity,
              ...mergeReports(plan.ranges, reports),
            };
          } else {
            result = await xeroCall(job.client.slug, entity, endpoint, input);
          }
        } else {
          result = { error: `Unknown tool: ${tu.name}` };
        }
      } catch (e) {
        result = { error: e.message };
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }

    // Append assistant response and tool results
    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: toolResults });
  }

  // 4. Cost at the model's list price, cached tokens included (null for a model
  // with no price in lib/agent-cost.js).
  const costUsd = agentCost.runCost(MODEL, usage);
  console.log(
    `  Tokens: ${usage.input} in, ${usage.cacheRead} read from cache, ${usage.cacheWrite} written to cache, ${usage.output} out`
  );

  const toolsUsed = Object.entries(toolCounts).map(([name, count]) => ({ name, count }));

  return {
    status: "succeeded",
    output: finalOutput,
    toolsUsed,
    durationMs: Date.now() - startMs,
    costUsd,
    processingPath: "anthropic-api",
    processingPathLabel: `Anthropic Messages API (${MODEL})`,
  };
}

// ── Poll loop ────────────────────────────────────────────────────────────────

let running = true;

async function poll() {
  let claimFailures = 0;
  while (running) {
    try {
      const job = await claimJob();
      claimFailures = 0;
      if (!job) {
        // Queue empty: a once runner is done; a polling runner waits.
        if (ONCE) return;
        await sleep(POLL_MS);
        continue;
      }

      let result;
      try {
        result = await executeJob(job);
      } catch (e) {
        console.error(`  Job ${job.id} threw:`, e);
        result = {
          status: "failed",
          error: e.message,
          durationMs: 0,
        };
      }

      try {
        await completeJob(job.id, result);
        console.log(`  Job ${job.id} → ${result.status} (${result.durationMs}ms, $${result.costUsd ?? 0})`);
      } catch (e) {
        console.error(`  Failed to report completion for ${job.id}:`, e.message);
      }

    } catch (e) {
      // Claim itself failed — API might be down
      console.error("Poll error:", e.message);
      claimFailures += 1;
      // A once runner gives up after three tries; the run stays queued for the next start.
      if (ONCE && claimFailures >= 3) throw new Error(`could not claim jobs: ${e.message}`);
      await sleep(POLL_MS * 2);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Startup ──────────────────────────────────────────────────────────────────

console.log("STZA Finance Agent Runner");
console.log(`  API:   ${API_URL}`);
console.log(`  Model: ${MODEL}`);
console.log(`  Poll:  ${POLL_MS}ms`);
console.log(`  Max turns: ${MAX_TURNS}`);
console.log(`  Mode:  ${ONCE ? "once (exit when the queue is empty)" : "polling"}`);
console.log("");

process.on("SIGINT", () => {
  console.log("\nShutting down…");
  running = false;
});

process.on("SIGTERM", () => {
  console.log("\nShutting down…");
  running = false;
});

poll().then(() => {
  if (ONCE) console.log("Queue empty, exiting.");
}).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

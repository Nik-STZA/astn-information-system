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

const Anthropic = require("@anthropic-ai/sdk").default;

// ── Config ───────────────────────────────────────────────────────────────────

const API_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";
const API_KEY = process.env.FINANCE_API_KEY;
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const MODEL = process.env.MODEL || "claude-sonnet-5";
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "25", 10);

if (!API_KEY) {
  console.error("FINANCE_API_KEY is required");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

const anthropic = new Anthropic();

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
      description: "Get the profit and loss report from Xero. Supports date range and comparative periods.",
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

// ── System prompts per agent role ────────────────────────────────────────────

const SYSTEM_BASE = `You are a finance agent working inside the STZA Finance OS. You have access to live Xero accounting data via tools. You are acting on behalf of a qualified Chartered Accountant (CA(SA)) with Big 4 experience.

Key rules:
- Be precise with numbers. Use commas as thousand separators, two decimal places for money.
- Dates should be formatted as "27 May 2026" (no ordinals).
- When presenting financial data, use tables where appropriate.
- If data looks unusual or inconsistent, flag it. Auditor mindset.
- Do not make up numbers. If a tool returns an error, say so.
- Keep your response concise and professional. No waffle.
- State your conclusion or recommendation clearly at the end.`;

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

// ── Execute one job ──────────────────────────────────────────────────────────

async function executeJob(job) {
  const startMs = Date.now();
  const toolCounts = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

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
  const clientContext = `You are working on client: ${job.client.name} (slug: ${job.client.slug}).
Connected entities: ${connectedEntities.map((e) => `${e.name} (${e.slug}, year-end: ${e.yearEnd || "not set"})`).join("; ")}.
Today is ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;

  // 3. Agentic loop
  let messages = [
    { role: "user", content: job.instruction },
  ];

  let finalOutput = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: `${systemPrompt}\n\n${clientContext}`,
      tools,
      messages,
    });

    totalInputTokens += resp.usage?.input_tokens ?? 0;
    totalOutputTokens += resp.usage?.output_tokens ?? 0;

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
        } else if (TOOL_TO_ENDPOINT[tu.name]) {
          const endpoint = TOOL_TO_ENDPOINT[tu.name];
          const { entity, ...params } = tu.input;
          result = await xeroCall(job.client.slug, entity, endpoint, params);
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

  // 4. Compute cost estimate (Sonnet pricing: $3/$15 per MTok)
  const inputCost = (totalInputTokens / 1_000_000) * 3;
  const outputCost = (totalOutputTokens / 1_000_000) * 15;
  const costUsd = parseFloat((inputCost + outputCost).toFixed(6));

  const toolsUsed = Object.entries(toolCounts).map(([name, count]) => ({ name, count }));

  return {
    status: "succeeded",
    output: finalOutput,
    toolsUsed,
    durationMs: Date.now() - startMs,
    costUsd,
  };
}

// ── Poll loop ────────────────────────────────────────────────────────────────

let running = true;

async function poll() {
  while (running) {
    try {
      const job = await claimJob();
      if (!job) {
        // No queued jobs — sleep and retry
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
console.log("");

process.on("SIGINT", () => {
  console.log("\nShutting down…");
  running = false;
});

process.on("SIGTERM", () => {
  console.log("\nShutting down…");
  running = false;
});

poll().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

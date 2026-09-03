#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// STZA Finance Platform — MCP Server  v0.2.0
// ─────────────────────────────────────────────────────────────────────────────
//
// The core commercial product. Exposes live Xero accounting data as MCP tools
// so users can connect from Claude Desktop, ChatGPT, Gemini, or any MCP-
// compatible AI client and interact with their books conversationally.
//
// v0.1 architecture (current):
//   • stdio transport — local connections (Claude Desktop, Cowork)
//   • Wraps the STZA Finance REST API (hosted on Cloud Run)
//   • Multi-client — STZA_CLIENT sets the default, each tool accepts client param
//
// v1.0 architecture (planned):
//   • SSE transport — remote connections from any AI client
//   • Direct Xero access (no REST API dependency)
//   • Per-user API keys mapped to entities and tier permissions
//
// Environment variables:
//   STZA_API_KEY      API key for the finance REST API (required)
//   STZA_API_URL      Base URL (required, e.g. https://africastn-api-....run.app)
//   STZA_CLIENT       Default client slug (optional — if unset, tools require client param)
//
// Claude Desktop config example (add to claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "stza-finance": {
//         "command": "node",
//         "args": ["C:/Dev/astn-information-system/finance-api/mcp-server/index.js"],
//         "env": {
//           "STZA_API_KEY": "<your-api-key>",
//           "STZA_API_URL": "https://stza-finance-api-782190795609.europe-west1.run.app",
//           "STZA_CLIENT": "stza"
//         }
//       }
//     }
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Configuration ────────────────────────────────────────────────────────────

const API_KEY = process.env.STZA_API_KEY;
const API_URL = (process.env.STZA_API_URL || "").replace(/\/$/, "");
// STZA_CLIENT is accepted for backward compatibility but only used in log output.
// Every tool requires an explicit client parameter — no defaults — to prevent
// accidentally reading or modifying the wrong client's books.
const DEFAULT_CLIENT_HINT = process.env.STZA_CLIENT || null;

function log(...args) {
  // MCP stdio servers must only write protocol messages to stdout.
  // Everything else goes to stderr.
  console.error("[stza-finance]", new Date().toISOString(), ...args);
}

if (!API_KEY || !API_URL) {
  log(
    "FATAL: missing required env vars.",
    "Set STZA_API_KEY and STZA_API_URL."
  );
  process.exit(1);
}

/**
 * Every tool must name its client explicitly — there is no default.
 * This prevents both confidentiality breaches (reading the wrong client's
 * data) and data integrity issues (writing to the wrong client's books).
 * The LLM calls list_clients first, then passes the slug to every tool.
 */
function resolveClient(clientParam) {
  if (!clientParam) {
    throw new Error(
      "A 'client' parameter is required on every tool call. " +
      "This is a safety control — it prevents accidentally accessing the wrong " +
      "client's financial data. Call list_clients first to see available clients."
    );
  }
  return clientParam;
}

log(`starting — api=${API_URL} (explicit client required on every call)`);

// ── REST API client ──────────────────────────────────────────────────────────
//
// Thin wrapper around fetch that adds auth and error handling. Every tool call
// maps to one or more REST API calls via this function.

async function api(path, { method = "GET", params, body } = {}) {
  let url = `${API_URL}${path}`;

  if (params) {
    const entries = Object.entries(params).filter(([, v]) => v != null);
    if (entries.length) {
      url += `?${new URLSearchParams(Object.fromEntries(entries))}`;
    }
  }

  const opts = {
    method,
    headers: {
      "X-API-Key": API_KEY,
      Accept: "application/json",
    },
  };

  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  log(`${method} ${path}`);
  const r = await fetch(url, opts);

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const msg = `${method} ${path} → ${r.status}: ${text.slice(0, 200)}`;
    log("ERROR", msg);
    throw new Error(friendlyError(r.status, text));
  }

  return r.json();
}

/** Translate HTTP errors into messages an LLM can relay usefully. */
function friendlyError(status, body) {
  if (status === 404) return "Entity not found or not connected to Xero. Use list_entities to see available entities.";
  if (status === 502) return "Xero connection expired. The entity needs to be reconnected in the STZA portal.";
  if (status === 429) return "Xero rate limit reached. Wait 60 seconds and retry.";
  if (status === 401 || status === 403) return "Authentication failed. Check the STZA_API_KEY.";
  if (status === 409) return body || "Conflict — the resource is in an unexpected state.";
  return `API error ${status}: ${body.slice(0, 200)}`;
}

/** Build entity-scoped API paths. */
function entityPath(client, entity, endpoint) {
  return `/api/finance/clients/${client}/xero/${entity}/${endpoint}`;
}

// ── Tool definitions ─────────────────────────────────────────────────────────
//
// These descriptions are the user interface — they're what the LLM reads to
// decide which tool to call. Write them for a finance professional who is
// talking to their AI assistant about their books.

const CLIENT_PARAM = {
  client: {
    type: "string",
    description:
      "Client slug (from list_clients). Required on every call for data safety.",
  },
};

const TOOLS = [
  {
    name: "list_clients",
    description:
      "List all clients (practices / companies) available on this STZA Finance " +
      "account. Returns each client's slug, name, and status. Call this first " +
      "to discover which clients you can work with. Then use list_entities to " +
      "see the Xero-connected entities within a client.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_entities",
    description:
      "List all Xero-connected entities (companies) for a client. " +
      "Returns each entity's name, legal name, connection status, and year-end date. " +
      "Call this after list_clients to discover which entities you can query, " +
      "and to get the entity slug needed by all other tools.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
      },
      required: ["client"],
      additionalProperties: false,
    },
  },
  {
    name: "get_trial_balance",
    description:
      "Get the trial balance for a Xero entity — every account with its debit and " +
      "credit balance at a point in time. The foundation of all financial reporting. " +
      "Use it to verify debits equal credits, identify large balances, or get a " +
      "complete view of the ledger.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
        date: {
          type: "string",
          description: "Report date YYYY-MM-DD (defaults to today)",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
  {
    name: "get_profit_and_loss",
    description:
      "Get the profit and loss (income statement) for a Xero entity. Shows revenue, " +
      "cost of sales, gross profit, operating expenses, and net profit for a period. " +
      "Supports comparative periods — set 'periods' and 'timeframe' to compare " +
      "month-on-month, quarter-on-quarter, or year-on-year. Can filter by tracking " +
      "category (department/cost centre). Defaults to accrual basis; set " +
      "paymentsOnly=true for cash basis.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
        fromDate: {
          type: "string",
          description: "Period start YYYY-MM-DD (defaults to start of financial year)",
        },
        toDate: {
          type: "string",
          description: "Period end YYYY-MM-DD (defaults to today)",
        },
        periods: {
          type: "integer",
          description:
            "Number of comparison periods (e.g. 1 for prior period, " +
            "11 for full year monthly breakdown)",
        },
        timeframe: {
          type: "string",
          enum: ["MONTH", "QUARTER", "YEAR"],
          description: "Length of each comparison period",
        },
        trackingCategoryID: {
          type: "string",
          description: "Xero tracking category UUID (department/cost centre filter)",
        },
        trackingOptionID: {
          type: "string",
          description: "Specific tracking option within a category",
        },
        standardLayout: {
          type: "boolean",
          description: "true = Xero standard layout, false = entity's custom layout",
        },
        paymentsOnly: {
          type: "boolean",
          description: "true = cash basis, false = accrual basis (default)",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
  {
    name: "get_balance_sheet",
    description:
      "Get the balance sheet (statement of financial position) for a Xero entity. " +
      "Shows assets, liabilities, and equity at a point in time. Supports " +
      "comparative periods. Use this to understand what the entity owns, what it " +
      "owes, and the residual equity.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
        date: {
          type: "string",
          description: "Balance sheet date YYYY-MM-DD (defaults to today)",
        },
        periods: {
          type: "integer",
          description: "Number of comparison periods",
        },
        timeframe: {
          type: "string",
          enum: ["MONTH", "QUARTER", "YEAR"],
          description: "Length of each comparison period",
        },
        trackingOptionID: {
          type: "string",
          description: "Filter by Xero tracking option",
        },
        standardLayout: {
          type: "boolean",
          description: "true = standard layout, false = custom",
        },
        paymentsOnly: {
          type: "boolean",
          description: "true = cash basis, false = accrual (default)",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
  {
    name: "get_bank_summary",
    description:
      "Get a summary of all bank accounts for a Xero entity. Shows opening " +
      "balance, cash received, cash spent, and closing balance for each bank " +
      "account over a period. Use this to assess the overall cash position " +
      "and cash movement.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
        fromDate: {
          type: "string",
          description: "Period start YYYY-MM-DD",
        },
        toDate: {
          type: "string",
          description: "Period end YYYY-MM-DD",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
  {
    name: "get_aged_receivables",
    description:
      "Get aged receivables (trade debtors) for a Xero entity. Returns every " +
      "outstanding sales invoice with customer name, invoice number, amount due, " +
      "due date, days overdue, and ageing bucket (current / 30 / 60 / 90 / 90+ " +
      "days). Includes summary totals per bucket. Use this to chase overdue " +
      "payments, assess debtor concentration, and identify credit risk.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
        date: {
          type: "string",
          description: "As-at date YYYY-MM-DD for ageing calculation (defaults to today)",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
  {
    name: "get_aged_payables",
    description:
      "Get aged payables (trade creditors) for a Xero entity. Returns every " +
      "outstanding purchase invoice with supplier name, invoice number, amount due, " +
      "due date, days overdue, and ageing bucket (current / 30 / 60 / 90 / 90+ " +
      "days). Includes summary totals per bucket. Use this to manage supplier " +
      "payments, identify overdue obligations, and plan cash outflows.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
        date: {
          type: "string",
          description: "As-at date YYYY-MM-DD for ageing calculation (defaults to today)",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
  {
    name: "get_accounts",
    description:
      "Get the chart of accounts for a Xero entity. Returns every account with " +
      "its code, name, type (REVENUE, EXPENSE, ASSET, LIABILITY, EQUITY), class, " +
      "tax type, and status. Use this to understand the account structure, find " +
      "the right account code for a transaction, or review the chart before " +
      "posting journals.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: {
          type: "string",
          description: "Entity slug (from list_entities)",
        },
      },
      required: ["client", "entity"],
      additionalProperties: false,
    },
  },
];

// ── Tool handlers ────────────────────────────────────────────────────────────

const handlers = {
  async list_clients() {
    return api("/api/finance/clients");
  },

  async list_entities({ client }) {
    const slug = resolveClient(client);
    return api(`/api/finance/clients/${slug}/entities`);
  },

  async get_trial_balance({ client, entity, date }) {
    const slug = resolveClient(client);
    const params = {};
    if (date) params.date = date;
    return api(entityPath(slug, entity, "trial-balance"), { params });
  },

  async get_profit_and_loss({
    client, entity, fromDate, toDate, periods, timeframe,
    trackingCategoryID, trackingOptionID, standardLayout, paymentsOnly,
  }) {
    const slug = resolveClient(client);
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    if (periods != null) params.periods = String(periods);
    if (timeframe) params.timeframe = timeframe;
    if (trackingCategoryID) params.trackingCategoryID = trackingCategoryID;
    if (trackingOptionID) params.trackingOptionID = trackingOptionID;
    if (standardLayout != null) params.standardLayout = String(standardLayout);
    if (paymentsOnly != null) params.paymentsOnly = String(paymentsOnly);
    return api(entityPath(slug, entity, "profit-and-loss"), { params });
  },

  async get_balance_sheet({
    client, entity, date, periods, timeframe,
    trackingOptionID, standardLayout, paymentsOnly,
  }) {
    const slug = resolveClient(client);
    const params = {};
    if (date) params.date = date;
    if (periods != null) params.periods = String(periods);
    if (timeframe) params.timeframe = timeframe;
    if (trackingOptionID) params.trackingOptionID = trackingOptionID;
    if (standardLayout != null) params.standardLayout = String(standardLayout);
    if (paymentsOnly != null) params.paymentsOnly = String(paymentsOnly);
    return api(entityPath(slug, entity, "balance-sheet"), { params });
  },

  async get_bank_summary({ client, entity, fromDate, toDate }) {
    const slug = resolveClient(client);
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    return api(entityPath(slug, entity, "bank-summary"), { params });
  },

  async get_aged_receivables({ client, entity, date }) {
    const slug = resolveClient(client);
    const params = {};
    if (date) params.date = date;
    return api(entityPath(slug, entity, "aged-receivables"), { params });
  },

  async get_aged_payables({ client, entity, date }) {
    const slug = resolveClient(client);
    const params = {};
    if (date) params.date = date;
    return api(entityPath(slug, entity, "aged-payables"), { params });
  },

  async get_accounts({ client, entity }) {
    const slug = resolveClient(client);
    return api(entityPath(slug, entity, "accounts"));
  },
};

// ── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "stza-finance", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = handlers[name];
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await handler(args || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    log(`tool ${name} failed:`, err.message);
    return {
      content: [{ type: "text", text: err.message }],
      isError: true,
    };
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("connected via stdio");
}

main().catch((err) => {
  log("FATAL:", err);
  process.exit(1);
});

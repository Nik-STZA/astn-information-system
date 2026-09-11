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
//   STZA_API_URL          Base URL (required)
//   STZA_SECRET_PROJECT   GCP project holding the api key secret (default africanstn-research)
//   STZA_SECRET_NAME      Secret name (default finance-api-key)
//   STZA_ACTOR_EMAIL      Person that writes are attributed to in the audit log
//   STZA_CLIENT           Default client slug (optional — tools require client anyway)
//   STZA_API_KEY          DEPRECATED fallback. See "Credentials" below.
//
// Claude Desktop config example (add to claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "stza-finance": {
//         "command": "node",
//         "args": ["<REPO_ROOT>/finance-api/mcp-server/index.js"],
//         "env": {
//           "STZA_API_URL": "https://stza-finance-api-782190795609.europe-west1.run.app",
//           "STZA_ACTOR_EMAIL": "nik@stza.io",
//           "STZA_CLIENT": "stza"
//         }
//       }
//     }
//   }
//
// ── Credentials ──────────────────────────────────────────────────────────────
//
// The API key is fetched from Secret Manager at startup using Application
// Default Credentials. It is NOT read from the config file.
//
// It used to be. claude_desktop_config.json held the live key in cleartext, and
// that key is what authenticates every call to the finance API — including, now
// that post_journal exists, posting journals to client ledgers. A credential
// with write power sitting in a plaintext config on a laptop is the same
// structural mistake as the configs/*.json files this whole programme of work
// exists to remove. One holder, and the holder is Secret Manager.
//
// Requires `gcloud auth application-default login` once on the machine.
//
// STZA_API_KEY still works as a fallback so a broken ADC setup does not strand
// the operator, but it warns loudly and should not be set in normal use.
//
// ─────────────────────────────────────────────────────────────────────────────

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Configuration ────────────────────────────────────────────────────────────

const API_URL = (process.env.STZA_API_URL || "").replace(/\/$/, "");
const SECRET_PROJECT = process.env.STZA_SECRET_PROJECT || "africanstn-research";
const SECRET_NAME = process.env.STZA_SECRET_NAME || "finance-api-key";
// STZA_CLIENT is accepted for backward compatibility but only used in log output.
// Every tool requires an explicit client parameter — no defaults — to prevent
// accidentally reading or modifying the wrong client's books.
const DEFAULT_CLIENT_HINT = process.env.STZA_CLIENT || null;

function log(...args) {
  // MCP stdio servers must only write protocol messages to stdout.
  // Everything else goes to stderr.
  console.error("[stza-finance]", new Date().toISOString(), ...args);
}

if (!API_URL) {
  log("FATAL: STZA_API_URL is not set.");
  process.exit(1);
}

/**
 * Fetches the finance API key from Secret Manager using Application Default
 * Credentials, so no secret has to live in claude_desktop_config.json.
 *
 * Falls back to STZA_API_KEY only if Secret Manager cannot be reached, and says
 * so loudly. Secret Manager takes precedence deliberately: it means a stale key
 * left behind in a config file is inert rather than authoritative, so the config
 * can be cleaned up and the key rotated in either order.
 */
async function resolveApiKey() {
  try {
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    const sm = new SecretManagerServiceClient();
    const [v] = await sm.accessSecretVersion({
      name: `projects/${SECRET_PROJECT}/secrets/${SECRET_NAME}/versions/latest`,
    });
    const key = v.payload.data.toString("utf8").trim();
    if (!key) throw new Error("secret is empty");
    log(`api key loaded from Secret Manager (${SECRET_PROJECT}/${SECRET_NAME})`);
    if (process.env.STZA_API_KEY) {
      log(
        "WARNING: STZA_API_KEY is set but was NOT used. Remove it from " +
        "claude_desktop_config.json — a plaintext API key in a config file is " +
        "the credential-copy problem this server was changed to avoid."
      );
    }
    return key;
  } catch (e) {
    if (process.env.STZA_API_KEY) {
      log(
        `WARNING: could not read the key from Secret Manager (${e.message}).`,
        "Falling back to STZA_API_KEY. Fix ADC with:",
        "gcloud auth application-default login"
      );
      return process.env.STZA_API_KEY;
    }
    // Thrown, not exited. The failure surfaces on the tool call that needed the
    // key, where the caller can see it, instead of killing a server that has
    // already told the client it is ready.
    throw new Error(
      `Could not read the api key from Secret Manager: ${e.message}. ` +
      `Run: gcloud auth application-default login`
    );
  }
}

// Resolving through ADC takes several seconds cold — long enough that awaiting
// it before connecting the transport risks the client giving up on a server
// that is working fine. So it starts at boot and is awaited at first use: the
// transport connects immediately, and the wait, if any is left, lands on the
// first tool call. The promise is the cache; it resolves once per process.
let apiKeyPromise = null;
function apiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = resolveApiKey().catch((e) => {
      apiKeyPromise = null; // let a later call retry rather than fail forever
      throw e;
    });
  }
  return apiKeyPromise;
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

async function api(path, { method = "GET", params, body, actorEmail } = {}) {
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
      "X-API-Key": await apiKey(),
      Accept: "application/json",
      // Writes are attributed to a person in finance.audit_log. The API key
      // identifies the service, not who asked for the journal.
      ...(actorEmail ? { "X-Actor-Email": actorEmail } : {}),
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
  // Validation failures are the useful case, not a generic error: the caller
  // needs to see which rule failed and why, verbatim, so it can tell the person
  // what to fix. Summarising them away would hide an UNBALANCED or an
  // APPROVAL_MISMATCH behind "API error 422".
  if (status === 422) {
    return `The journal was rejected before anything was sent to Xero:\n${body}`;
  }
  if (status === 404) return "Entity not found or not connected to Xero. Use list_entities to see available entities.";
  // 502 now covers both a dead connection and Xero refusing the write, and the
  // body carries Xero's own words. Pass them on.
  if (status === 502) return `The upstream call to Xero failed:\n${body}`;
  if (status === 429) return "Xero rate limit reached. Wait 60 seconds and retry.";
  if (status === 401 || status === 403) return "Authentication failed. Check the api key in Secret Manager.";
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

  // ───────────────────────────────────────────────────────────────────────────
  // post_journal — the only write tool. Read this before changing it.
  //
  // presented_text and agreed_text MUST be passed through from the caller
  // verbatim. This tool MUST NOT compose either of them.
  //
  // The platform validates the submitted journal against presented_text: every
  // account code and every line amount must appear in it. That check is the one
  // protection against a payload that differs from what the human actually
  // approved.
  //
  // If this tool generated presented_text from the same arguments it is about
  // to submit, it would be comparing the payload against a description of
  // itself. Every check would pass, every time, on every journal — including
  // one nobody ever saw. The audit record would state what the approver was
  // shown, and be wrong. The control would validate perfectly and protect
  // nothing.
  //
  // The same applies to agreed_text: the human's actual words, not "approved"
  // copied from the schema example.
  //
  // So the contract is: the caller (the journal-posting skill, running in
  // Cowork) renders the journal, shows it to a person, captures what they say,
  // and passes both strings through untouched. If presented_text is missing,
  // the platform returns MISSING_APPROVAL. Let it. Do not helpfully generate
  // one — a generated string is worse than a rejection, because a rejection is
  // visible and a fabricated approval record is not.
  //
  // This is exactly the kind of thing a later tidy-up "simplifies" by building
  // the string here, and nothing would fail. That is why it is written down.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "post_journal",
    description:
      "Post a manual journal to a client's Xero ledger. This WRITES to real books — " +
      "it requires explicit human approval, captured before the call.\n\n" +
      "Before calling: render the journal for the person, show it to them, and wait " +
      "for their answer. Then pass the text you showed them as approval.presented_text " +
      "and their actual reply as approval.agreed_text, both word for word. Do not " +
      "write these strings yourself or paraphrase them — the platform checks the " +
      "journal against presented_text, and text you composed from these same arguments " +
      "would make that check meaningless.\n\n" +
      "Always call with dry_run=true first and show the result. Status defaults to " +
      "DRAFT; posting straight to the ledger must be an explicit choice. " +
      "Line amounts are positive for debits and negative for credits, and must sum to " +
      "zero. Always send an idempotency_key so a retry cannot post twice.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLIENT_PARAM,
        entity: { type: "string", description: "Entity slug (from list_entities)" },
        date: { type: "string", description: "Journal date YYYY-MM-DD — the period it belongs to" },
        narration: { type: "string", description: "What the journal is for, in a sentence" },
        status: {
          type: "string",
          enum: ["DRAFT", "POSTED"],
          description: "DRAFT (default) creates it for review. POSTED writes it straight to the ledger.",
        },
        dry_run: {
          type: "boolean",
          description: "Validate only, send nothing to Xero. Use this first, every time.",
        },
        idempotency_key: {
          type: "string",
          description:
            "Stable key so a retry cannot double-post, e.g. fgh-2026-08-marketing-provision-v1. " +
            "Reusing a key with different numbers is rejected.",
        },
        reference: { type: "string", description: "Optional working paper or reconciliation reference" },
        lines: {
          type: "array",
          minItems: 2,
          description: "At least two lines, summing to zero",
          items: {
            type: "object",
            properties: {
              account_code: { type: "string", description: "Xero account code (from get_accounts)" },
              amount: { type: "number", description: "Positive = debit, negative = credit. Max 2 decimal places." },
              description: { type: "string", description: "Line narrative" },
              tax_type: { type: "string", description: "NONE (default), INPUT2, OUTPUT2" },
            },
            required: ["account_code", "amount"],
            additionalProperties: false,
          },
        },
        approval: {
          type: "object",
          description:
            "Evidence of the human approval that already happened. Captured, never composed.",
          properties: {
            approved_by: { type: "string", description: "Email of the person who approved it" },
            approved_at: {
              type: "string",
              description: "ISO timestamp of when they approved. Must be within the last 30 minutes.",
            },
            via: { type: "string", description: "Where approval happened, e.g. cowork" },
            presented_text: {
              type: "string",
              description:
                "VERBATIM: the exact text that was displayed to the person, as they saw it. " +
                "Not a reconstruction, not a summary, and never generated from the arguments " +
                "of this call. The platform checks the journal against this text.",
            },
            agreed_text: {
              type: "string",
              description:
                "VERBATIM: what the person actually said in reply. Their words, not 'approved'.",
            },
          },
          required: ["approved_by", "approved_at", "presented_text", "agreed_text"],
          additionalProperties: true,
        },
      },
      required: ["client", "entity", "date", "narration", "lines", "approval"],
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

  // Passes the caller's arguments straight through. Note what is NOT here:
  // no default for approval, no composed presented_text, no "approved"
  // substituted for a missing agreed_text. Omissions travel to the platform and
  // come back as MISSING_APPROVAL, which is the correct outcome — the approval
  // record has to describe something that actually happened, and this process
  // has no way to know that it did. See the block comment on the tool
  // definition above before changing any of this.
  async post_journal({
    client, entity, date, narration, status, dry_run,
    idempotency_key, reference, lines, approval,
  }) {
    const slug = resolveClient(client);
    const body = {
      date,
      narration,
      status: status ?? "DRAFT",
      dry_run: dry_run === true,
      lines,
      approval,
    };
    if (idempotency_key) body.idempotency_key = idempotency_key;
    if (reference) body.reference = reference;

    // The audit row is attributed to a person. STZA_ACTOR_EMAIL comes first so
    // that a call with no approval still carries an actor and is refused for
    // the real reason — MISSING_APPROVAL — rather than for a missing header,
    // which says nothing about what is actually wrong. In this single-operator
    // setup the caller and the approver are the same human; when that stops
    // being true, this is the seam to widen.
    const actorEmail = process.env.STZA_ACTOR_EMAIL || approval?.approved_by;
    if (!actorEmail) {
      throw new Error(
        "Cannot attribute this journal to a person. Set STZA_ACTOR_EMAIL in the " +
        "MCP server config, or supply approval.approved_by. Nothing is assumed " +
        "here: an audit record naming the wrong person is worse than a refusal."
      );
    }

    return api(entityPath(slug, entity, "journals"), { method: "POST", body, actorEmail });
  },
};

// ── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "stza-finance", version: "0.3.0" },
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
  // Start fetching the credential, but do not wait for it. See apiKey().
  apiKey().catch((e) => log("api key not ready:", e.message));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`connected via stdio — ${TOOLS.length} tools (1 write: post_journal)`);
}

main().catch((err) => {
  log("FATAL:", err);
  process.exit(1);
});

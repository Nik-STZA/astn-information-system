// ─────────────────────────────────────────────────────────────────────────────
// The practice toolset: the laptop MCP's tools, by the same names and the same
// arguments, served by finance-api.
//
// Switched on with STZA_TOOLSET=practice. It replaces the laptop's
// xero-server.py in Claude Desktop without the skills that call those tools
// having to change, while the Xero token, the rules and the audit trail stay
// on STZA's server (phase 0, docs/ap-lane/phase0-tracker.md). This file holds
// no Xero logic: every tool is one or more calls to finance-api, and every
// write is validated, tiered, confirmed and audited there.
//
// The tool list is checked against the laptop's by finance-api's parity test
// (lib/laptop-parity.test.js), so the two cannot drift apart silently.
//
// Entities are named as on the laptop (ultraspeed, feldspar_ltd,
// feldspar_holdings, stza) or by their portal slug. A name that matches one
// entity across all clients needs no client; anything ambiguous is refused.
//
// Writes return the platform's answer as it stands, including a refusal (422)
// or Xero's own error (502): those are results to read, not crashes.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

// The laptop's config names for the entities that moved to the portal.
export const LAPTOP_NAMES = {
  ultraspeed: "ultraspeed-digital",
  feldspar_ltd: "feldspar-ltd",
  feldspar_holdings: "feldspar-group-holdings",
  stza: "stza",
};

// Xero report names, as the laptop's get_report takes them, to portal reports.
const REPORTS = {
  TrialBalance: "trial-balance", ProfitAndLoss: "profit-and-loss", BalanceSheet: "balance-sheet",
  BankSummary: "bank-summary", ExecutiveSummary: "executive-summary", BudgetSummary: "budget-summary",
  AgedReceivablesByContact: "aged-receivables", AgedPayablesByContact: "aged-payables",
};

// ── argument schemas ─────────────────────────────────────────────────────────

const s = (description) => ({ type: "string", description });
const b = (description) => ({ type: "boolean", description });
const n = (description) => ({ type: "integer", description });
const list = (description, items = {}) => ({ type: "array", description, items });
const obj = (description) => ({ type: "object", description });

const ENTITY = {
  entity: s("Entity: the laptop name (ultraspeed, feldspar_ltd, feldspar_holdings, stza) or the portal slug"),
  client: s("Client slug. Only needed when the entity name is not unique"),
};
const DRY = { dry_run: b("Validate only, write nothing. Default true") };
const CONFIRM = { confirmation_code: s("From a dry run of exactly this write; needed for post, send, settle, setup and conversion writes") };
const NOTE = { audit_note: s("Why: kept in our audit log, never sent to Xero") };
const LINES = list("Lines: {description, account_code, unit_amount, quantity?, tax_type?, tracking?: [{name, option}]}. Amounts as strings", { type: "object" });

function tool(name, description, props = {}, required = []) {
  const withEntity = name !== "list_entities";
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: withEntity ? { ...ENTITY, ...props } : props,
      required: withEntity ? ["entity", ...required] : required,
      additionalProperties: false,
    },
  };
}

// ── where clauses ────────────────────────────────────────────────────────────

const dt = (d) => {
  const [y, m, day] = String(d).split("-");
  return `DateTime(${Number(y)},${Number(m)},${Number(day)})`;
};
const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
function where(...parts) {
  const w = parts.filter(Boolean).join(" AND ");
  return w || undefined;
}
const eq = (field, v) => (v ? `${field}=="${esc(String(v).toUpperCase())}"` : null);
const from = (field, d) => (d ? `${field}>=${dt(d)}` : null);
const to = (field, d) => (d ? `${field}<=${dt(d)}` : null);

export function practiceTools({ apiUrl, apiKey, actorEmail, log }) {
  // ── HTTP ──────────────────────────────────────────────────────────────────
  async function request(method, path, { params, json, raw, contentType, binary } = {}) {
    let url = `${apiUrl}${path}`;
    const qs = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (qs.length) url += `?${new URLSearchParams(qs.map(([k, v]) => [k, String(v)]))}`;
    const headers = { "X-API-Key": await apiKey(), Accept: binary ? "*/*" : "application/json" };
    if (method !== "GET") {
      if (!actorEmail) throw new Error("Set STZA_ACTOR_EMAIL: every write is attributed to a person in the audit log");
      headers["X-Actor-Email"] = actorEmail;
    }
    let body;
    if (raw) { headers["Content-Type"] = contentType || "application/octet-stream"; body = raw; }
    else if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    log(`${method} ${path}`);
    const r = await fetch(url, { method, headers, body });
    if (binary && r.ok) return { status: r.status, ok: true, buffer: Buffer.from(await r.arrayBuffer()), headers: r.headers };
    const text = await r.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 2000) }; }
    return { status: r.status, ok: r.ok, body: parsed };
  }

  // Reads fail loudly; writes return the platform's verdict whatever it is.
  async function get(path, params) {
    const r = await request("GET", path, { params });
    if (!r.ok) throw new Error(`${path} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.body;
  }

  // ── entities ──────────────────────────────────────────────────────────────
  let index = null;
  let indexedAt = 0;
  async function entityIndex() {
    if (index && Date.now() - indexedAt < 5 * 60_000) return index;
    const clients = (await get("/api/finance/clients")).data || [];
    const out = [];
    for (const c of clients) {
      for (const e of (await get(`/api/finance/clients/${c.slug}/entities`)).data || []) {
        out.push({ client: c.slug, entity: e.slug, name: e.name, connected: e.connected });
      }
    }
    index = out;
    indexedAt = Date.now();
    return out;
  }

  async function at(args) {
    const want = LAPTOP_NAMES[args.entity] || args.entity;
    if (!want) throw new Error("entity is required");
    const all = await entityIndex();
    const hits = all.filter((e) => e.entity === want && (!args.client || e.client === args.client));
    if (hits.length === 1) return hits[0];
    const names = all.map((e) => `${e.client}/${e.entity}`).join(", ");
    if (!hits.length) throw new Error(`No entity ${args.entity}${args.client ? ` in ${args.client}` : ""}. Available: ${names}`);
    throw new Error(`${args.entity} is in more than one client; pass client. Available: ${names}`);
  }
  const X = (e) => `/api/finance/clients/${e.client}/xero/${e.entity}`;
  // The read routes answer { entity, resource, data }, with Xero's own reply
  // under data. Anything that looks inside a reply must look there.
  const xero = (body) => body?.data ?? {};

  // ── reads ─────────────────────────────────────────────────────────────────
  const read = async (args, resource, params) => get(`${X(await at(args))}/read/${resource}`, params);
  const readOne = async (args, resource, id, sub) => get(`${X(await at(args))}/read/${resource}/${id}${sub ? `/${sub}` : ""}`);
  const report = async (args, name, params) => get(`${X(await at(args))}/read/reports/${name}`, params);

  // Xero pages at 100; the laptop's max_pages bounds how many are read.
  async function readPages(args, resource, key, params, maxPages = 10) {
    const e = await at(args);
    const items = [];
    let page = 1;
    for (; page <= Math.max(1, maxPages); page++) {
      const body = await get(`${X(e)}/read/${resource}`, { ...params, page });
      const got = xero(body)[key] || [];
      items.push(...got);
      if (got.length < 100) break;
    }
    return { entity: e.name, count: items.length, pages_read: Math.min(page, maxPages), [key]: items };
  }

  async function saveBinary(path, outDir, fileName) {
    const r = await request("GET", path, { binary: true });
    if (!r.ok) throw new Error(`${path} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    const dir = resolve(outDir);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, basename(fileName));
    await writeFile(dest, r.buffer);
    return { path: dest, bytes: r.buffer.length, content_type: r.headers.get("content-type") };
  }

  // ── writes ────────────────────────────────────────────────────────────────
  const dry = (a) => a.dry_run !== false;
  async function write(args, op, json) {
    const r = await request("POST", `${X(await at(args))}/write/${op}`, { json: { ...json, dry_run: dry(args) } });
    return r.body;
  }
  async function upload(args, op, filePath, query) {
    const raw = await readFile(filePath);
    const r = await request("POST", `${X(await at(args))}/write/${op}`, {
      raw, params: { ...query, file_name: basename(filePath), dry_run: String(dry(args)) },
    });
    return r.body;
  }
  const pick = (a, keys) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== "").map((k) => [k, a[k]]));

  // ── the tools ─────────────────────────────────────────────────────────────
  const T = [];
  const H = {};
  const def = (t, h) => { T.push(t); H[t.name] = h; };

  def(tool("list_entities", "The Xero organisations available, by client"), async () => ({
    entities: (await entityIndex()).map((e) => ({ ...e, laptop_name: Object.keys(LAPTOP_NAMES).find((k) => LAPTOP_NAMES[k] === e.entity) || null })),
  }));
  def(tool("validate_credentials", "Check the entity's Xero connection is alive"), async (a) => {
    const e = await at(a);
    const st = await get(`/api/finance/clients/${e.client}/xero`);
    const connection = (st.data || []).find((x) => x.slug === e.entity) || null;
    const probe = connection ? await read(a, "organisation").then(() => "ok", (err) => err.message) : "not connected";
    return { entity: e, connection, live_call: probe };
  });
  def(tool("get_connections", "The Xero organisations this app's grant reaches"), async (a) => get(`/api/finance/clients/${(await at(a)).client}/xero/organisations`));
  def(tool("get_organisation", "Organisation settings: currency, year end, tax, lock dates"), (a) => read(a, "organisation"));
  def(tool("get_organisation_actions", "What this app is allowed to do in the organisation"), (a) => read(a, "organisation-actions"));
  def(tool("get_users", "Xero users on the organisation"), (a) => read(a, "users"));

  // reports
  def(tool("pull_trial_balance", "Trial balance at a date", { date: s("YYYY-MM-DD") }, ["date"]),
    async (a) => get(`${X(await at(a))}/trial-balance`, { date: a.date }));
  def(tool("get_account_balance", "Trial balance lines for given account codes", { date: s("YYYY-MM-DD"), account_codes: list("Account codes", { type: "string" }) }, ["date", "account_codes"]),
    async (a) => {
      const tb = await get(`${X(await at(a))}/trial-balance`, { date: a.date });
      const want = new Set((a.account_codes || []).map(String));
      const rows = [];
      for (const sec of tb.report?.Rows || []) {
        for (const row of sec.Rows || []) {
          const m = /\(([^()]+)\)\s*$/.exec(row.Cells?.[0]?.Value || "");
          if (m && want.has(m[1])) rows.push({ code: m[1], cells: row.Cells.map((c) => c.Value) });
        }
      }
      return { entity: tb.entity, date: a.date, columns: (tb.report?.Rows?.[0]?.Cells || []).map((c) => c.Value), rows, not_found: [...want].filter((c) => !rows.some((r) => r.code === c)) };
    });
  def(tool("get_bank_balances", "Bank summary: opening, receipts, payments and closing per bank account", { date: s("To date YYYY-MM-DD"), from_date: s("From date YYYY-MM-DD") }, ["date"]),
    (a) => report(a, "bank-summary", { toDate: a.date, fromDate: a.from_date }));
  def(tool("get_profit_and_loss", "Profit and loss for a period", {
    from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), tracking_option_id_1: s("Tracking option id"), tracking_option_id_2: s("Tracking option id"), standard_layout: b("Default true"),
  }, ["from_date", "to_date"]), (a) => report(a, "profit-and-loss", {
    fromDate: a.from_date, toDate: a.to_date, trackingOptionID1: a.tracking_option_id_1, trackingOptionID2: a.tracking_option_id_2, standardLayout: a.standard_layout !== false,
  }));
  def(tool("get_balance_sheet", "Balance sheet at a date", {
    date: s("YYYY-MM-DD"), tracking_option_id_1: s("Tracking option id"), tracking_option_id_2: s("Tracking option id"), standard_layout: b("Default true"),
  }, ["date"]), (a) => report(a, "balance-sheet", {
    date: a.date, trackingOptionID1: a.tracking_option_id_1, trackingOptionID2: a.tracking_option_id_2, standardLayout: a.standard_layout !== false,
  }));
  for (const [name, rep] of [["get_aged_receivables", "aged-receivables"], ["get_aged_payables", "aged-payables"]]) {
    def(tool(name, `Aged ${rep.split("-")[1]} for one contact`, { contact_id: s("ContactID"), date: s("YYYY-MM-DD"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD") }, ["contact_id"]),
      (a) => report(a, rep, { contactID: a.contact_id, date: a.date, fromDate: a.from_date, toDate: a.to_date }));
  }
  def(tool("get_report", `A named Xero report: ${Object.keys(REPORTS).join(", ")}`, { report_name: s("Xero report name"), params_json: s("Report parameters as JSON") }, ["report_name"]),
    (a) => {
      const rep = REPORTS[a.report_name];
      if (!rep) throw new Error(`report_name must be one of ${Object.keys(REPORTS).join(", ")}`);
      return report(a, rep, JSON.parse(a.params_json || "{}"));
    });
  def(tool("get_summary_report", "BudgetSummary or ExecutiveSummary", { report: s("BudgetSummary or ExecutiveSummary"), date: s("YYYY-MM-DD"), periods: n("BudgetSummary periods"), timeframe: n("BudgetSummary: 1 month, 3 quarter, 12 year") }, ["report"]),
    (a) => {
      if (!["BudgetSummary", "ExecutiveSummary"].includes(a.report)) throw new Error("report must be BudgetSummary or ExecutiveSummary");
      return report(a, REPORTS[a.report], { date: a.date, periods: a.periods || undefined, timeframe: a.timeframe || undefined });
    });
  const refused = (why) => async () => ({ error: why, served: false });
  def(tool("get_published_reports", "Not available: Xero refuses published reports for this app", { report_id: s("ReportID") }), refused("Xero answers 401 to /Reports for this app (16 Oct 2026), on the laptop too"));
  def(tool("get_account_transactions", "Not available: needs Xero's journals scope, which Xero rejects for this app", { account_code: s("code"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), starting_offset: n("offset"), max_pages: n("pages") }), refused("reads /Journals, which needs journals.read; Xero rejects that scope for this app. Use get_manual_journals, get_invoices and get_bank_transactions instead"));
  def(tool("get_journal", "Not available: needs Xero's journals scope, which Xero rejects for this app", { journal_number: n("number"), journal_id: s("id") }), refused("reads /Journals, which needs journals.read; Xero rejects that scope for this app"));
  def(tool("get_expense_claims", "Not available: Xero refuses expense claims for this app", { status: s("status"), max_pages: n("pages") }), refused("Xero answers 401 to /ExpenseClaims for this app (16 Oct 2026), on the laptop too"));
  def(tool("get_receipts", "Not available: Xero refuses receipts for this app", { status: s("status"), max_pages: n("pages") }), refused("Xero answers 401 to /Receipts for this app (16 Oct 2026), on the laptop too"));

  // reference data
  for (const [name, res, what] of [
    ["get_tax_rates", "tax-rates", "Tax rates"], ["get_tracking_categories", "tracking-categories", "Tracking categories and options"],
    ["get_branding_themes", "branding-themes", "Invoice branding themes"], ["get_currencies", "currencies", "Currencies"],
    ["get_items", "items", "Items"], ["get_contact_groups", "contact-groups", "Contact groups"],
  ]) def(tool(name, what), (a) => read(a, res));
  def(tool("get_accounts", "Chart of accounts", { where: s("Xero where clause"), order: s("Xero order") }), (a) => read(a, "accounts", { where: a.where, order: a.order }));

  // records
  def(tool("get_contacts", "Contacts (customers and suppliers)", { where: s("Xero where clause"), order: s("Xero order"), include_archived: b("Include archived"), max_pages: n("Pages of 100, default 10") }),
    (a) => readPages(a, "contacts", "Contacts", { where: a.where, order: a.order, includeArchived: a.include_archived || undefined }, a.max_pages || 10));
  def(tool("get_contact_by_id", "One contact", { contact_id: s("ContactID") }, ["contact_id"]), (a) => readOne(a, "contacts", a.contact_id));
  def(tool("search_contacts", "Contacts whose name contains a term", { search_term: s("Text to find"), max_results: n("Default 50") }, ["search_term"]),
    async (a) => {
      const r = await read(a, "contacts", { searchTerm: a.search_term });
      const found = xero(r).Contacts || [];
      return { entity: r.entity, count: Math.min(found.length, a.max_results || 50), Contacts: found.slice(0, a.max_results || 50) };
    });
  def(tool("get_invoices", "Bills (ACCPAY) and sales invoices (ACCREC)", {
    invoice_type: s("ACCPAY or ACCREC"), status: s("Status"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), contact_id: s("ContactID"), max_pages: n("Pages of 100, default 10"),
  }), (a) => readPages(a, "invoices", "Invoices", {
    where: where(eq("Type", a.invoice_type), eq("Status", a.status), from("Date", a.from_date), to("Date", a.to_date),
      a.contact_id ? `Contact.ContactID==Guid("${esc(a.contact_id)}")` : null),
  }, a.max_pages || 10));
  def(tool("get_invoice_by_id", "One bill or invoice with its lines and payments", { invoice_id: s("InvoiceID") }, ["invoice_id"]), (a) => readOne(a, "invoices", a.invoice_id));
  def(tool("get_invoice_document", "An invoice's PDF saved to disk, or its online link", { invoice_id: s("InvoiceID"), kind: s("pdf (default) or online_url"), out_dir: s("Folder for the PDF, default _xero_documents") }, ["invoice_id"]),
    async (a) => {
      if (a.kind === "online_url") return readOne(a, "invoices", a.invoice_id, "online");
      return saveBinary(`${X(await at(a))}/read/invoices/${a.invoice_id}/pdf`, a.out_dir || "_xero_documents", `invoice_${a.invoice_id.slice(0, 8)}.pdf`);
    });
  def(tool("get_credit_notes", "Credit notes", { credit_note_type: s("ACCPAYCREDIT or ACCRECCREDIT"), status: s("Status"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), max_pages: n("Default 5") }),
    (a) => readPages(a, "credit-notes", "CreditNotes", { where: where(eq("Type", a.credit_note_type), eq("Status", a.status), from("Date", a.from_date), to("Date", a.to_date)) }, a.max_pages || 5));
  for (const [name, res, key] of [["get_prepayments", "prepayments", "Prepayments"], ["get_overpayments", "overpayments", "Overpayments"]]) {
    def(tool(name, key, { status: s("Status"), max_pages: n("Default 5") }), (a) => readPages(a, res, key, { where: where(eq("Status", a.status)) }, a.max_pages || 5));
  }
  def(tool("get_bank_transactions", "Spend and receive money", { bank_account_id: s("AccountID"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), transaction_type: s("SPEND, RECEIVE..."), max_pages: n("Default 10") }),
    (a) => readPages(a, "bank-transactions", "BankTransactions", {
      where: where(a.bank_account_id ? `BankAccount.AccountID==Guid("${esc(a.bank_account_id)}")` : null, eq("Type", a.transaction_type), from("Date", a.from_date), to("Date", a.to_date)),
    }, a.max_pages || 10));
  def(tool("get_bank_transfers", "Transfers between bank accounts", { from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD") }),
    (a) => read(a, "bank-transfers", { where: where(from("Date", a.from_date), to("Date", a.to_date)) }));
  def(tool("get_payments", "Payments", { from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), status: s("AUTHORISED or DELETED"), max_pages: n("Default 10") }),
    (a) => readPages(a, "payments", "Payments", { where: where(eq("Status", a.status), from("Date", a.from_date), to("Date", a.to_date)) }, a.max_pages || 10));
  def(tool("get_manual_journals", "Manual journals", { status: s("DRAFT, POSTED, VOIDED"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), max_pages: n("Default 10") }),
    (a) => readPages(a, "manual-journals", "ManualJournals", { where: where(eq("Status", a.status), from("Date", a.from_date), to("Date", a.to_date)) }, a.max_pages || 10));
  for (const [name, res, key] of [["get_purchase_orders", "purchase-orders", "PurchaseOrders"], ["get_quotes", "quotes", "Quotes"]]) {
    def(tool(name, key, { status: s("Status"), from_date: s("YYYY-MM-DD"), to_date: s("YYYY-MM-DD"), max_pages: n("Default 5") }),
      (a) => readPages(a, res, key, { Status: a.status ? a.status.toUpperCase() : undefined, DateFrom: a.from_date, DateTo: a.to_date }, a.max_pages || 5));
  }

  // history, attachments, schedules, assets, payroll, files
  const RES = (t) => String(t || "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  def(tool("get_history", "A record's history and notes", { resource_type: s("Invoices, Contacts, ManualJournals..."), resource_id: s("Record id") }, ["resource_type", "resource_id"]),
    (a) => readOne(a, RES(a.resource_type), a.resource_id, "history"));
  def(tool("list_attachments", "Attachments on a record", { resource_type: s("Invoices, CreditNotes, BankTransactions..."), resource_id: s("Record id") }, ["resource_type", "resource_id"]),
    (a) => readOne(a, RES(a.resource_type), a.resource_id, "attachments"));
  def(tool("fetch_attachment", "Save one attachment to disk", { resource_type: s("As list_attachments"), resource_id: s("Record id"), file_name: s("Attachment file name"), out_dir: s("Default _ap_inbox") }, ["resource_type", "resource_id", "file_name"]),
    async (a) => saveBinary(`${X(await at(a))}/read/${RES(a.resource_type)}/${a.resource_id}/attachments/${encodeURIComponent(a.file_name)}`, a.out_dir || "_ap_inbox", a.file_name));
  def(tool("get_cis_settings", "Construction Industry Scheme settings, for the organisation or a contact", { contact_id: s("ContactID") }),
    async (a) => {
      if (a.contact_id) return readOne(a, "contacts", a.contact_id, "cis");
      const org = xero(await read(a, "organisation")).Organisations?.[0];
      if (!org) throw new Error("Xero returned no organisation");
      return readOne(a, "organisation", org.OrganisationID, "cis");
    });
  const SCHEDULES = { repeating_invoices: "repeating-invoices", budgets: "budgets", batch_payments: "batch-payments", linked_transactions: "linked-transactions", invoice_reminders: "invoice-reminders" };
  def(tool("get_schedule_data", `Schedule records: ${Object.keys(SCHEDULES).join(", ")}`, { what: s("Which"), record_id: s("One record"), status: s("Status filter"), date_from: s("Budgets"), date_to: s("Budgets") }, ["what"]),
    (a) => {
      const res = SCHEDULES[a.what];
      if (!res) throw new Error(`what must be one of ${Object.keys(SCHEDULES).join(", ")}`);
      if (a.record_id && a.what !== "invoice_reminders") return readOne(a, res, a.record_id);
      const params = a.what === "repeating_invoices" && a.status ? { where: eq("Status", a.status) }
        : a.what === "linked_transactions" && a.status ? { Status: a.status.toUpperCase() } : {};
      return read(a, res, { ...params, DateFrom: a.date_from, DateTo: a.date_to });
    });
  def(tool("get_fixed_assets", "Fixed assets: assets (by status), asset, types or settings", { what: s("assets, asset, types or settings"), status: s("DRAFT, REGISTERED or DISPOSED"), asset_id: s("For asset"), page: n("Page") }),
    (a) => {
      const what = a.what || "assets";
      if (what === "asset") return readOne(a, "assets", a.asset_id);
      if (what === "types") return read(a, "asset-types");
      if (what === "settings") return read(a, "asset-settings");
      return read(a, "assets", { status: (a.status || "REGISTERED").toUpperCase(), page: a.page || 1, pageSize: 200 });
    });
  const PAYROLL = { settings: "payroll-settings", earnings_rates: "earnings-rates", deductions: "deductions", benefits: "benefits", leave_types: "leave-types", reimbursements: "reimbursements", pay_run_calendars: "pay-run-calendars" };
  def(tool("get_payroll_reference", "UK payroll reference data, no individuals", { what: s(Object.keys(PAYROLL).join(", ")) }, ["what"]),
    (a) => {
      if (!PAYROLL[a.what]) throw new Error(`what must be one of ${Object.keys(PAYROLL).join(", ")}`);
      return read(a, PAYROLL[a.what]);
    });
  def(tool("get_pay_runs", "UK pay runs as totals only; per-person data is removed by the server", { pay_run_id: s("One pay run"), status: s("Draft or Posted"), page: n("Page") }),
    (a) => (a.pay_run_id ? readOne(a, "pay-runs", a.pay_run_id) : read(a, "pay-runs", { page: a.page || 1, status: a.status })));
  def(tool("get_files", "Xero Files: files, file, content, associations, object_associations, folders or inbox", { what: s("Which"), record_id: s("Id where needed"), page: n("Page"), out_dir: s("For content, default _xero_documents") }),
    async (a) => {
      const what = a.what || "files";
      if (what === "content") {
        const meta = xero(await readOne(a, "files", a.record_id));
        return saveBinary(`${X(await at(a))}/read/files/${a.record_id}/content`, a.out_dir || "_xero_documents", `${a.record_id.slice(0, 8)}_${basename(meta.Name || "file.bin")}`);
      }
      if (what === "file") return readOne(a, "files", a.record_id);
      if (what === "associations") return readOne(a, "files", a.record_id, "associations");
      if (what === "object_associations") return readOne(a, "object-associations", a.record_id);
      if (what === "folders" || what === "inbox") return read(a, what);
      return read(a, "files", { page: a.page || 1, pagesize: 100 });
    });
  def(tool("check_bill", "The deterministic checks over one supplier bill: returns the flags", { invoice_id: s("InvoiceID"), since: s("ISO time of your own edit, to detect Round overwriting it") }, ["invoice_id"]),
    async (a) => get(`${X(await at(a))}/checks/bill/${a.invoice_id}`, { since: a.since }));

  // ── note and draft writes ─────────────────────────────────────────────────
  const DOC = { contact_id: s("ContactID"), lines: LINES, date: s("YYYY-MM-DD"), reference: s("Reference"), line_amount_types: s("Exclusive, Inclusive or NoTax"), currency_code: s("ISO code"), status: s("DRAFT or SUBMITTED"), idempotency_key: s("Optional"), allow_duplicate: b("Allow a repeated supplier number") };
  const DOC_KEYS = ["contact_id", "lines", "date", "due_date", "reference", "line_amount_types", "currency_code", "status", "idempotency_key", "allow_duplicate", "audit_note"];
  def(tool("upsert_invoice", "Create or change a bill or sales invoice, DRAFT or SUBMITTED only", { invoice_type: s("ACCPAY or ACCREC"), ...NOTE, ...DOC, due_date: s("YYYY-MM-DD"), invoice_id: s("To change one"), invoice_number: s("Number"), ...DRY }, ["invoice_type", "audit_note"]),
    (a) => write(a, "invoices", { ...pick(a, DOC_KEYS), type: a.invoice_type, id: a.invoice_id, number: a.invoice_number }));
  def(tool("upsert_credit_note", "Create or change a credit note, DRAFT or SUBMITTED only", { credit_note_type: s("ACCPAYCREDIT or ACCRECCREDIT"), ...NOTE, ...DOC, credit_note_id: s("To change one"), credit_note_number: s("Number"), ...DRY }, ["credit_note_type", "audit_note"]),
    (a) => write(a, "credit-notes", { ...pick(a, DOC_KEYS), type: a.credit_note_type, id: a.credit_note_id, number: a.credit_note_number }));
  const CONTACT = ["name", "email", "first_name", "last_name", "contact_number", "account_number", "tax_number", "default_currency", "purchases_default_account_code", "sales_default_account_code", "accounts_payable_tax_type", "accounts_receivable_tax_type", "address", "phone", "idempotency_key", "audit_note"];
  def(tool("upsert_contact", "Create or update a supplier or customer; never bank details", {
    ...NOTE, contact_id: s("To change one"), ...Object.fromEntries(CONTACT.filter((k) => !["address", "audit_note"].includes(k)).map((k) => [k, s(k.replace(/_/g, " "))])),
    address: obj("{line1, line2, city, region, postal_code, country}"), ...DRY,
  }, ["audit_note"]), (a) => write(a, "contacts", { ...pick(a, CONTACT), id: a.contact_id }));
  def(tool("add_history_note", "A short permanent note on a Xero record's history, 300 characters at most. Reasoning stays in os.stza.io", { resource_type: s("Invoices, Contacts..."), resource_id: s("Record id"), details: s("The note"), ...DRY }, ["resource_type", "resource_id", "details"]),
    (a) => write(a, "history-notes", { resource_type: a.resource_type, resource_id: a.resource_id, details: a.details, audit_note: a.details }));
  def(tool("upsert_linked_transaction", "Mark a bill line as billable to a customer", { source_transaction_id: s("Bill id"), source_line_item_id: s("LineItemID"), contact_id: s("Customer"), linked_transaction_id: s("To change one"), ...NOTE, ...DRY }, ["source_transaction_id", "source_line_item_id", "audit_note"]),
    (a) => write(a, "linked-transactions", pick(a, ["source_transaction_id", "source_line_item_id", "contact_id", "linked_transaction_id", "audit_note"])));
  def(tool("upload_attachment", "Attach a local file to a Xero record", { resource_type: s("Invoices, CreditNotes..."), resource_id: s("Record id"), file_path: s("File on this machine, up to 25 MB"), include_online: b("Sales invoices: show online"), ...NOTE, ...DRY }, ["resource_type", "resource_id", "file_path", "audit_note"]),
    (a) => upload(a, "attachments", a.file_path, { resource_type: a.resource_type, resource_id: a.resource_id, include_online: a.include_online ? "true" : undefined, audit_note: a.audit_note }));
  def(tool("upload_file", "Put a local file into Xero Files, optionally linked to a record", { file_path: s("File on this machine"), folder_id: s("Folder"), associate_with_id: s("Record to link"), associate_object_group: s("Invoice, Contact..."), ...NOTE, ...DRY }, ["file_path", "audit_note"]),
    (a) => upload(a, "files", a.file_path, pick(a, ["folder_id", "associate_with_id", "associate_object_group", "audit_note"])));
  def(tool("associate_file", "Link a file already in Xero Files to a record (Match)", { file_id: s("FileId"), object_id: s("Record id"), object_group: s("Invoice, Contact..."), allow_duplicate: b("Even if the record has a file of that name"), ...NOTE, ...DRY }, ["file_id", "object_id", "object_group", "audit_note"]),
    (a) => write(a, "file-associations", pick(a, ["file_id", "object_id", "object_group", "allow_duplicate", "audit_note"])));

  // ── confirmed writes ──────────────────────────────────────────────────────
  const C = { ...NOTE, ...CONFIRM, ...DRY };
  def(tool("post_journal", "A manual journal. DRAFT by default; POSTED needs the post tier and a confirmation code", {
    narration: s("Narration"), date: s("YYYY-MM-DD"), lines: list("{account_code, amount (string, debit positive), description, tax_type?, tracking?}", { type: "object" }), status: s("DRAFT or POSTED"), allow_duplicate: b("Allow a repeated narration and date"), ...C,
  }, ["narration", "date", "lines", "audit_note"]), (a) => write(a, "journals", pick(a, ["narration", "date", "lines", "status", "allow_duplicate", "audit_note", "confirmation_code"])));
  def(tool("post_journal_from_csv", "Journals from Xero's manual journal import CSV. POSTED needs a confirmation code", { csv_content: s("The CSV text"), status: s("DRAFT (default) or POSTED"), allow_duplicate: b("Allow a repeated narration and date"), ...C }, ["csv_content", "audit_note"]),
    async (a) => {
      const r = await request("POST", `${X(await at(a))}/write/journals-from-file`, {
        raw: Buffer.from(a.csv_content, "utf8"), contentType: "text/csv",
        params: { status: a.status || "DRAFT", audit_note: a.audit_note, allow_duplicate: a.allow_duplicate ? "true" : undefined, confirmation_code: a.confirmation_code, dry_run: String(dry(a)) },
      });
      return r.body;
    });
  def(tool("update_journal_status", "Post or void an existing manual journal", { manual_journal_id: s("ManualJournalID"), new_status: s("POSTED or VOIDED"), ...C }, ["manual_journal_id", "new_status", "audit_note"]),
    (a) => write(a, "journal-status", pick(a, ["manual_journal_id", "new_status", "audit_note", "confirmation_code"])));
  def(tool("email_invoice", "Email an approved sales invoice to the customer", { invoice_id: s("InvoiceID"), ...C }, ["invoice_id", "audit_note"]),
    (a) => write(a, "invoice-emails", pick(a, ["invoice_id", "audit_note", "confirmation_code"])));
  def(tool("record_payment", "Record a payment that has happened against an approved document", {
    document_type: s("Invoices or CreditNotes"), document_id: s("Id"), bank_account_code: s("Bank account code"), amount: s("Amount as a string"), date: s("YYYY-MM-DD"), reference: s("Reference"), currency_rate: s("For foreign currency"), ...C,
  }, ["document_type", "document_id", "bank_account_code", "amount", "date", "audit_note"]),
    (a) => write(a, "payments", pick(a, ["document_type", "document_id", "bank_account_code", "amount", "date", "reference", "currency_rate", "audit_note", "confirmation_code"])));
  def(tool("delete_payment", "Delete a payment recorded in error", { payment_id: s("PaymentID"), ...C }, ["payment_id", "audit_note"]),
    (a) => write(a, "payment-deletions", pick(a, ["payment_id", "audit_note", "confirmation_code"])));
  def(tool("allocate_credit", "Apply a credit note, prepayment or overpayment to an invoice", { source_type: s("CreditNotes, Prepayments or Overpayments"), source_id: s("Id"), invoice_id: s("InvoiceID"), amount: s("Amount as a string"), date: s("YYYY-MM-DD"), ...C }, ["source_type", "source_id", "invoice_id", "amount", "date", "audit_note"]),
    (a) => write(a, "allocations", pick(a, ["source_type", "source_id", "invoice_id", "amount", "date", "audit_note", "confirmation_code"])));
  def(tool("remove_allocation", "Undo a credit allocation", { source_type: s("CreditNotes, Prepayments or Overpayments"), source_id: s("Id"), allocation_id: s("AllocationID"), ...C }, ["source_type", "source_id", "allocation_id", "audit_note"]),
    (a) => write(a, "allocation-removals", pick(a, ["source_type", "source_id", "allocation_id", "audit_note", "confirmation_code"])));
  def(tool("upsert_bank_transaction", "Spend or receive money against a bank account", {
    transaction_type: s("SPEND or RECEIVE"), bank_account_code: s("Bank account code"), date: s("YYYY-MM-DD"), lines: LINES, contact_id: s("ContactID"), reference: s("Reference"), line_amount_types: s("Exclusive, Inclusive or NoTax"), bank_transaction_id: s("To change one"), ...C,
  }, ["transaction_type", "bank_account_code", "date", "lines", "audit_note"]),
    (a) => write(a, "bank-transactions", { ...pick(a, ["transaction_type", "bank_account_code", "date", "lines", "contact_id", "reference", "line_amount_types", "audit_note", "confirmation_code"]), id: a.bank_transaction_id }));
  def(tool("create_bank_transfer", "Record a transfer between two bank accounts", { from_bank_account_code: s("From"), to_bank_account_code: s("To"), amount: s("Amount as a string"), date: s("YYYY-MM-DD"), reference: s("Reference"), ...C }, ["from_bank_account_code", "to_bank_account_code", "amount", "date", "audit_note"]),
    (a) => write(a, "bank-transfers", pick(a, ["from_bank_account_code", "to_bank_account_code", "amount", "date", "reference", "audit_note", "confirmation_code"])));
  def(tool("upsert_setting", "Master data: account_create, account_update, tax_rate, tracking_category, tracking_option, currency, item, contact_group, contact_group_members", { kind: s("Which"), record: obj("Xero field names"), ...C }, ["kind", "record", "audit_note"]),
    (a) => write(a, "settings", pick(a, ["kind", "record", "audit_note", "confirmation_code"])));
  def(tool("upsert_repeating_invoice", "A repeating sales invoice template, saved as DRAFT", {
    invoice_type: s("ACCREC"), contact_id: s("ContactID"), lines: LINES, schedule: obj("{Period, Unit, DueDate, DueDateType, StartDate, EndDate?}"), reference: s("Reference"), line_amount_types: s("Exclusive, Inclusive or NoTax"), repeating_invoice_id: s("To change one"), ...C,
  }, ["invoice_type", "contact_id", "lines", "schedule", "audit_note"]),
    (a) => write(a, "repeating-invoices", { ...pick(a, ["contact_id", "lines", "schedule", "reference", "line_amount_types", "audit_note", "confirmation_code"]), type: a.invoice_type, id: a.repeating_invoice_id }));
  def(tool("create_fixed_asset", "Register a fixed asset or create an asset type", { what: s("asset or asset_type"), record: obj("Assets API fields"), ...C }, ["what", "record", "audit_note"]),
    (a) => write(a, "fixed-assets", pick(a, ["what", "record", "audit_note", "confirmation_code"])));
  def(tool("post_conversion_setup", "Conversion date and opening balances. No undo", { conversion_month: n("1-12"), conversion_year: n("Year"), conversion_balances: list("{account_code, balance (string, debit positive)}", { type: "object" }), ...C }, ["conversion_month", "conversion_year", "conversion_balances", "audit_note"]),
    (a) => write(a, "conversion-setup", pick(a, ["conversion_month", "conversion_year", "conversion_balances", "audit_note", "confirmation_code"])));

  return { tools: T, handlers: H };
}

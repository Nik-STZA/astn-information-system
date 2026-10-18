// Every tool of the laptop MCP (Feldspar_Project/XERO REPORTING/xero-server.py)
// and what serves it here. Read by laptop-parity.test.js, which fails the
// build when a laptop tool has no portal route, a route listed here does not
// exist, or a portal write route is claimed by no laptop tool.
//
// Agreed with Nik on 16 Oct 2026: the portal and the laptop work the same and
// stay in sync, with finance-api as the one engine. Adding a laptop tool means
// adding it here, with the route that serves it, in the same change.
//
// Each entry is { serves: [...] } or { xero_refuses: why }. A serves item is:
//   { route: "METHOD /path" }                   an Express route, exactly as registered
//   { read: resource, id?, sub? }               GET .../read/... (lib/xero-read.js)
//   { report: name }                            GET .../read/reports/:report
//   { write: operation }                        POST .../write/<operation>
// xero_refuses marks a tool Xero answers with an error for this app on the
// laptop too: there is nothing for the portal to serve.

const X = "/api/finance/clients/:slug/xero/:entity";
const ID = true;

const LAPTOP_PARITY = {
  list_entities: { serves: [{ route: "GET /api/finance/clients/:slug/entities" }] },
  validate_credentials: { serves: [{ route: "GET /api/finance/clients/:slug/xero" }] },
  get_connections: { serves: [{ route: "GET /api/finance/clients/:slug/xero/organisations" }] },
  get_organisation: { serves: [{ read: "organisation" }] },
  get_organisation_actions: { serves: [{ read: "organisation-actions" }] },
  get_users: { serves: [{ read: "users" }] },

  pull_trial_balance: { serves: [{ route: `GET ${X}/trial-balance` }, { report: "trial-balance" }] },
  get_account_balance: { serves: [{ route: `GET ${X}/trial-balance` }], note: "the trial balance, filtered by the caller" },
  get_bank_balances: { serves: [{ route: `GET ${X}/bank-summary` }, { report: "bank-summary" }] },
  get_profit_and_loss: { serves: [{ route: `GET ${X}/profit-and-loss` }, { report: "profit-and-loss" }] },
  get_balance_sheet: { serves: [{ route: `GET ${X}/balance-sheet` }, { report: "balance-sheet" }] },
  get_aged_receivables: { serves: [{ route: `GET ${X}/aged-receivables` }, { report: "aged-receivables" }] },
  get_aged_payables: { serves: [{ route: `GET ${X}/aged-payables` }, { report: "aged-payables" }] },
  get_report: { serves: ["trial-balance", "profit-and-loss", "balance-sheet", "bank-summary", "aged-receivables", "aged-payables"].map((report) => ({ report })) },
  get_summary_report: { serves: [{ report: "budget-summary" }, { report: "executive-summary" }] },
  get_published_reports: { xero_refuses: "GET /Reports answers 401 for this app (16 Oct 2026)" },
  get_account_transactions: { xero_refuses: "reads /Journals, which needs journals.read; Xero rejects that scope for this app" },
  get_journal: { xero_refuses: "reads /Journals, which needs journals.read; Xero rejects that scope for this app" },

  get_accounts: { serves: [{ read: "accounts" }, { route: `GET ${X}/accounts` }] },
  get_tax_rates: { serves: [{ read: "tax-rates" }] },
  get_tracking_categories: { serves: [{ read: "tracking-categories" }] },
  get_branding_themes: { serves: [{ read: "branding-themes" }] },
  get_currencies: { serves: [{ read: "currencies" }] },
  get_items: { serves: [{ read: "items" }] },
  get_contact_groups: { serves: [{ read: "contact-groups" }] },
  get_contacts: { serves: [{ read: "contacts" }] },
  search_contacts: { serves: [{ read: "contacts" }], note: "searchTerm passes through as a query parameter" },
  get_contact_by_id: { serves: [{ read: "contacts", id: ID }] },
  get_invoices: { serves: [{ read: "invoices" }] },
  get_invoice_by_id: { serves: [{ read: "invoices", id: ID }] },
  get_invoice_document: { serves: [{ read: "invoices", id: ID, sub: "pdf" }, { read: "invoices", id: ID, sub: "online" }] },
  get_credit_notes: { serves: [{ read: "credit-notes" }] },
  get_prepayments: { serves: [{ read: "prepayments" }] },
  get_overpayments: { serves: [{ read: "overpayments" }] },
  get_bank_transactions: { serves: [{ read: "bank-transactions" }] },
  get_bank_transfers: { serves: [{ read: "bank-transfers" }] },
  get_payments: { serves: [{ read: "payments" }] },
  get_manual_journals: { serves: [{ read: "manual-journals" }] },
  get_purchase_orders: { serves: [{ read: "purchase-orders" }] },
  get_quotes: { serves: [{ read: "quotes" }] },
  get_expense_claims: { xero_refuses: "GET /ExpenseClaims answers 401 for this app (16 Oct 2026)" },
  get_receipts: { xero_refuses: "GET /Receipts answers 401 for this app (16 Oct 2026)" },
  get_history: { serves: [{ read: "invoices", id: ID, sub: "history" }, { read: "contacts", id: ID, sub: "history" }] },
  list_attachments: { serves: [{ read: "invoices", id: ID, sub: "attachments" }] },
  fetch_attachment: { serves: [{ route: `GET ${X}/read/:resource/:id/attachments/:name` }] },
  get_cis_settings: { serves: [{ read: "contacts", id: ID, sub: "cis" }, { read: "organisation", id: ID, sub: "cis" }] },
  get_schedule_data: {
    serves: ["repeating-invoices", "budgets", "batch-payments", "linked-transactions", "invoice-reminders"].map((read) => ({ read })),
  },
  get_fixed_assets: { serves: [{ read: "assets" }, { read: "assets", id: ID }, { read: "asset-types" }, { read: "asset-settings" }] },
  get_payroll_reference: {
    serves: ["payroll-settings", "earnings-rates", "deductions", "benefits", "leave-types", "reimbursements", "pay-run-calendars"].map((read) => ({ read })),
  },
  get_pay_runs: { serves: [{ read: "pay-runs" }, { read: "pay-runs", id: ID }] },
  get_files: {
    serves: [
      { read: "files" }, { read: "files", id: ID }, { read: "files", id: ID, sub: "content" },
      { read: "files", id: ID, sub: "associations" }, { read: "object-associations", id: ID },
      { read: "folders" }, { read: "inbox" },
    ],
  },
  check_bill: { serves: [{ route: `GET ${X}/checks/bill/:id` }] },

  // note and draft tiers
  add_history_note: { serves: [{ write: "history-notes" }] },
  upsert_invoice: { serves: [{ write: "invoices" }] },
  upsert_credit_note: { serves: [{ write: "credit-notes" }] },
  upsert_contact: { serves: [{ write: "contacts" }] },
  upload_attachment: { serves: [{ write: "attachments" }] },
  upsert_linked_transaction: { serves: [{ write: "linked-transactions" }] },
  upload_file: { serves: [{ write: "files" }] },
  associate_file: { serves: [{ write: "file-associations" }] },

  // confirmed tiers
  post_journal: { serves: [{ write: "journals" }, { route: `POST ${X}/journals` }] },
  post_journal_from_csv: { serves: [{ write: "journals-from-file" }] },
  update_journal_status: { serves: [{ write: "journal-status" }] },
  email_invoice: { serves: [{ write: "invoice-emails" }] },
  record_payment: { serves: [{ write: "payments" }] },
  delete_payment: { serves: [{ write: "payment-deletions" }] },
  allocate_credit: { serves: [{ write: "allocations" }] },
  remove_allocation: { serves: [{ write: "allocation-removals" }] },
  upsert_bank_transaction: { serves: [{ write: "bank-transactions" }] },
  create_bank_transfer: { serves: [{ write: "bank-transfers" }] },
  upsert_setting: { serves: [{ write: "settings" }] },
  upsert_repeating_invoice: { serves: [{ write: "repeating-invoices" }] },
  create_fixed_asset: { serves: [{ write: "fixed-assets" }] },
  post_conversion_setup: { serves: [{ write: "conversion-setup" }] },
};

// The laptop's tools on 18 Oct 2026, one per @mcp.tool() in xero-server.py.
// Changing the laptop's tool list means changing this list too, and the test
// then demands an entry above.
const LAPTOP_TOOLS = [
  "list_entities", "pull_trial_balance", "get_bank_balances", "get_account_balance", "get_account_transactions",
  "post_journal", "post_journal_from_csv", "get_profit_and_loss", "get_balance_sheet", "get_aged_receivables",
  "get_aged_payables", "get_report", "get_accounts", "get_manual_journals", "update_journal_status", "get_contacts",
  "get_contact_by_id", "search_contacts", "get_invoices", "get_invoice_by_id", "get_credit_notes", "get_prepayments",
  "get_overpayments", "get_bank_transactions", "get_bank_transfers", "get_payments", "get_organisation", "get_users",
  "get_tax_rates", "get_tracking_categories", "get_branding_themes", "get_currencies", "get_items",
  "get_contact_groups", "get_expense_claims", "get_purchase_orders", "get_quotes", "get_receipts",
  "validate_credentials", "get_history", "get_organisation_actions", "get_connections", "list_attachments",
  "fetch_attachment", "upsert_invoice", "upsert_credit_note", "upsert_contact", "add_history_note",
  "get_invoice_document", "get_published_reports", "get_summary_report", "get_journal", "get_cis_settings",
  "get_schedule_data", "get_fixed_assets", "get_payroll_reference", "get_pay_runs", "get_files",
  "upload_attachment", "upsert_linked_transaction", "upload_file", "associate_file", "email_invoice",
  "record_payment", "delete_payment", "allocate_credit", "remove_allocation", "upsert_bank_transaction",
  "create_bank_transfer", "upsert_setting", "upsert_repeating_invoice", "create_fixed_asset",
  "post_conversion_setup", "check_bill",
];

// The Express route a serves item lands on.
function routeOf(item) {
  if (item.route) return item.route;
  if (item.report) return `GET ${X}/read/reports/:report`;
  if (item.write) return `POST ${X}/write/${item.write}`;
  if (item.read) {
    if (item.sub) return `GET ${X}/read/:resource/:id/:sub`;
    return item.id ? `GET ${X}/read/:resource/:id` : `GET ${X}/read/:resource`;
  }
  throw new Error(`unrecognised parity item ${JSON.stringify(item)}`);
}

module.exports = { LAPTOP_PARITY, LAPTOP_TOOLS, routeOf, WRITE_PREFIX: `${X}/write/` };

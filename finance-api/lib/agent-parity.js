// Every Cowork tool, and the agent tool in os.stza.io that does its job.
//
// Nik's rule (30 Oct 2026, restated 5 Nov): the agents in os.stza.io can do
// what Cowork can, so he never has to switch to Cowork for ledger work.
// lib/laptop-parity.js already proves Cowork and finance-api share one engine;
// this proves the agents can reach it. agent-parity.test.js fails the build
// when a Cowork tool has no entry here, when an entry names an agent tool that
// does not exist or no role is given, or when a read is left unbuilt.
//
// Each entry is one of:
//   { agent: [names], note? }   these agent tools do the same job
//   { xero_refuses: true }      Xero refuses it for this app (see laptop-parity.js)
//   { to_build: proposal }      a write the agents cannot do yet. The proposal says
//                               how it should reach them: agent proposes and the
//                               CFO approves in os.stza.io, or people only. Nik
//                               decides each one; the list shrinks as they land.

const AGENT_PARITY = {
  // Connection and organisation
  list_entities: { agent: ["list_entities"] },
  validate_credentials: { agent: ["get_organisation"], note: "a read that answers proves the connection" },
  get_connections: { agent: ["list_entities"] },
  get_organisation: { agent: ["get_organisation"] },
  get_organisation_actions: { agent: ["get_xero_settings"] },
  get_users: { agent: ["get_xero_settings"], note: "names and roles only, never email" },

  // Reports
  pull_trial_balance: { agent: ["get_trial_balance"] },
  get_account_balance: { agent: ["get_trial_balance"] },
  get_bank_balances: { agent: ["get_bank_summary"] },
  get_profit_and_loss: { agent: ["get_profit_and_loss"] },
  get_balance_sheet: { agent: ["get_balance_sheet"] },
  get_aged_receivables: { agent: ["get_aged_receivables"] },
  get_aged_payables: { agent: ["get_aged_payables"] },
  get_report: { agent: ["get_trial_balance", "get_profit_and_loss", "get_balance_sheet", "get_bank_summary", "get_aged_receivables", "get_aged_payables"] },
  get_summary_report: { agent: ["get_budget_summary", "get_executive_summary"] },
  get_published_reports: { xero_refuses: true },
  get_account_transactions: { agent: ["get_account_activity"], note: "Xero refuses /Journals; the platform rebuilds an account's entries from the documents instead" },
  get_journal: { xero_refuses: true },

  // Settings and lists
  get_accounts: { agent: ["get_chart_of_accounts"] },
  get_tax_rates: { agent: ["get_xero_settings"] },
  get_tracking_categories: { agent: ["get_xero_settings"] },
  get_branding_themes: { agent: ["get_xero_settings"] },
  get_currencies: { agent: ["get_xero_settings"] },
  get_items: { agent: ["get_xero_settings"] },
  get_contact_groups: { agent: ["get_xero_settings"] },

  // Contacts and documents
  get_contacts: { agent: ["get_contacts"] },
  search_contacts: { agent: ["get_contacts"] },
  get_contact_by_id: { agent: ["get_contact"] },
  get_invoices: { agent: ["get_invoices"] },
  get_invoice_by_id: { agent: ["get_invoice"] },
  get_invoice_document: { agent: ["get_invoice", "read_attachment"], note: "the invoice's content and its attached source document; Xero's own PDF rendering is not offered" },
  get_credit_notes: { agent: ["get_credit_notes"] },
  get_prepayments: { agent: ["get_prepayments"] },
  get_overpayments: { agent: ["get_overpayments"] },
  get_bank_transactions: { agent: ["get_bank_transactions"] },
  get_bank_transfers: { agent: ["get_bank_transfers"] },
  get_payments: { agent: ["get_payments"] },
  get_manual_journals: { agent: ["get_manual_journals"] },
  get_purchase_orders: { agent: ["get_purchase_orders"] },
  get_quotes: { agent: ["get_quotes"] },
  get_expense_claims: { xero_refuses: true },
  get_receipts: { xero_refuses: true },
  get_history: { agent: ["get_history"] },
  list_attachments: { agent: ["list_attachments"] },
  fetch_attachment: { agent: ["read_attachment"] },
  get_cis_settings: { agent: ["get_cis_settings"] },
  get_schedule_data: { agent: ["get_schedule_data"] },
  get_fixed_assets: { agent: ["get_fixed_assets"] },
  get_payroll_reference: { agent: ["get_payroll"] },
  get_pay_runs: { agent: ["get_payroll"] },
  get_files: { agent: ["get_xero_files"] },
  check_bill: { agent: ["check_bill"] },

  // Writes the agents already have, behind the CFO's approval
  post_journal: { agent: ["propose_journal", "propose_rec_journal", "create_draft_journal"], note: "proposed, approved by the CFO, created in Xero as a draft; a person posts it" },
  post_journal_from_csv: { agent: ["propose_journal"], note: "one proposal per journal" },

  // Writes still to build (Nik decides each proposal)
  create_fixed_asset: { to_build: "agent proposes the asset from the purchase; CFO approves in os.stza.io; created in Xero" },
  upsert_invoice: { to_build: "bills already reach Xero through the AP lane (recommend_bill_coding, submit_bill); sales invoices: AR Clerk proposes, CFO approves" },
  upsert_credit_note: { to_build: "agent proposes, CFO approves" },
  upsert_contact: { to_build: "agent proposes a new or changed contact, CFO approves; bank details never set by an agent" },
  upsert_bank_transaction: { to_build: "agent proposes, CFO approves" },
  create_bank_transfer: { to_build: "agent proposes, CFO approves" },
  record_payment: { to_build: "agent proposes recording a payment that has already happened, CFO approves; agents never make payments" },
  allocate_credit: { to_build: "agent proposes, CFO approves" },
  upsert_repeating_invoice: { to_build: "agent proposes, CFO approves" },
  upsert_linked_transaction: { to_build: "agent proposes, CFO approves" },
  upload_attachment: { to_build: "agents attach evidence they found to the record, logged; no approval needed" },
  upload_file: { to_build: "agents file evidence into Xero Files, logged; no approval needed" },
  associate_file: { to_build: "agents link a Xero Files document to its record, logged; no approval needed" },
  update_journal_status: { to_build: "people only: posting a journal is the approval" },
  email_invoice: { to_build: "people only: it sends to the customer" },
  delete_payment: { to_build: "people only" },
  remove_allocation: { to_build: "people only" },
  add_history_note: { to_build: "people only: agents' reasoning stays in os.stza.io (31 Oct 2026)" },
  upsert_setting: { to_build: "people only: organisation settings" },
  post_conversion_setup: { to_build: "people only: opening balances" },
};

const toBuild = () => Object.entries(AGENT_PARITY).filter(([, v]) => v.to_build).map(([k, v]) => ({ tool: k, proposal: v.to_build }));

module.exports = { AGENT_PARITY, toBuild };

// The read-only Xero surface: which resources finance-api will fetch, and how.
//
// This is the allowlist behind GET .../xero/:entity/read/... It mirrors every
// read tool in the laptop MCP (xero-server.py) so the portal and the laptop can
// reach the same data through one token holder (docs/ap-lane/
// xero-capability-register.md). Pure: it turns a request into a URL or an
// error, and never touches the network, so it is tested without Xero.
//
// GET only. Writes stay on explicit, validated, audited endpoints.

const XERO_APIS = {
  accounting: "https://api.xero.com/api.xro/2.0",
  files: "https://api.xero.com/files.xro/1.0",
  assets: "https://api.xero.com/assets.xro/1.0",
  payroll: "https://api.xero.com/payroll.xro/2.0",
};

// Sub-resources a document can expose. Each resource lists the ones Xero
// supports for it.
//   history       what changed, when and by whom
//   attachments   the list of attached files (the file itself is binary, below)
//   pdf           the document as Xero renders it (binary)
//   online        the customer's online invoice link
//   cis           CIS settings
//   associations  which records a Xero Files file is linked to
//   content       a Xero Files file's bytes (binary)
const SUBS = {
  history: { path: "History" },
  attachments: { path: "Attachments" },
  pdf: { path: "", accept: "application/pdf", binary: true },
  online: { path: "OnlineInvoice" },
  cis: { path: "CISSettings" },
  associations: { path: "Associations" },
  content: { path: "Content", accept: "application/octet-stream", binary: true },
};

const HISTORY_ATTACH = ["history", "attachments"];

// api defaults to accounting. byId: GET /<path>/<id> is valid. personal: the
// response carries data about individuals and is stripped before it leaves.
const XERO_READ_RESOURCES = {
  // Settings and organisation
  organisation: { path: "/Organisation", subs: ["cis"], idIsOrg: true },
  "organisation-actions": { path: "/Organisation/Actions" },
  // Users by id answers 404 (checked 16 Oct 2026); the list carries every field.
  users: { path: "/Users" },
  currencies: { path: "/Currencies" },
  "branding-themes": { path: "/BrandingThemes", byId: true },
  accounts: { path: "/Accounts", byId: true, subs: ["attachments"] },
  "tax-rates": { path: "/TaxRates" },
  "tracking-categories": { path: "/TrackingCategories", byId: true },
  "invoice-reminders": { path: "/InvoiceReminders/Settings" },

  // Contacts
  contacts: { path: "/Contacts", byId: true, subs: [...HISTORY_ATTACH, "cis"] },
  "contact-groups": { path: "/ContactGroups", byId: true },

  // Sales and purchases
  invoices: { path: "/Invoices", byId: true, subs: [...HISTORY_ATTACH, "pdf", "online"] },
  "credit-notes": { path: "/CreditNotes", byId: true, subs: [...HISTORY_ATTACH, "pdf"] },
  "repeating-invoices": { path: "/RepeatingInvoices", byId: true, subs: HISTORY_ATTACH },
  quotes: { path: "/Quotes", byId: true, subs: [...HISTORY_ATTACH, "pdf"] },
  "purchase-orders": { path: "/PurchaseOrders", byId: true, subs: [...HISTORY_ATTACH, "pdf"] },
  items: { path: "/Items", byId: true, subs: ["history"] },
  "linked-transactions": { path: "/LinkedTransactions", byId: true },

  // Money
  payments: { path: "/Payments", byId: true, subs: ["history"] },
  "batch-payments": { path: "/BatchPayments", byId: true, subs: ["history"] },
  prepayments: { path: "/Prepayments", byId: true, subs: ["history"] },
  overpayments: { path: "/Overpayments", byId: true, subs: ["history"] },
  "bank-transactions": { path: "/BankTransactions", byId: true, subs: HISTORY_ATTACH },
  "bank-transfers": { path: "/BankTransfers", byId: true, subs: HISTORY_ATTACH },
  // /Receipts and /ExpenseClaims are not here: both answer 401 on this app,
  // laptop included (checked 16 Oct 2026). They are Xero's retired expenses
  // endpoints and no granular scope reaches them.

  // Journals. /Journals (ledger journals) is not here: accounting.journals.read
  // cannot be granted to this app, so it could only ever return 401.
  "manual-journals": { path: "/ManualJournals", byId: true, subs: HISTORY_ATTACH },

  // Budgets and published reports
  budgets: { path: "/Budgets", byId: true },
  // Published reports (/Reports) are not here: the list answers 401 on this
  // app, laptop included (checked 16 Oct 2026); it needs the broad
  // accounting.reports.read scope, which post-March 2026 apps cannot have.

  // Xero Files (the Documents inbox and library)
  files: { api: "files", path: "/Files", byId: true, subs: ["associations", "content"] },
  folders: { api: "files", path: "/Folders", byId: true },
  inbox: { api: "files", path: "/Inbox" },
  // Records -> files: GET /Associations/<invoice, contact... id>
  "object-associations": { api: "files", path: "/Associations", byId: true, idRequired: true },

  // Fixed assets
  // The list needs a status (DRAFT, REGISTERED or DISPOSED) or Xero answers
  // 403; REGISTERED is the default, as on the laptop. A caller's own wins.
  assets: { api: "assets", path: "/Assets", byId: true, listQuery: { status: "REGISTERED" } },
  "asset-types": { api: "assets", path: "/AssetTypes" },
  "asset-settings": { api: "assets", path: "/Settings" },

  // UK payroll: reference data and pay run totals only (see stripPersonal)
  "pay-runs": { api: "payroll", path: "/PayRuns", byId: true, personal: true },
  "payroll-settings": { api: "payroll", path: "/Settings", personal: true },
  "earnings-rates": { api: "payroll", path: "/EarningsRates", personal: true },
  deductions: { api: "payroll", path: "/Deductions", personal: true },
  benefits: { api: "payroll", path: "/Benefits", personal: true },
  "leave-types": { api: "payroll", path: "/LeaveTypes", personal: true },
  reimbursements: { api: "payroll", path: "/Reimbursements", personal: true },
  "pay-run-calendars": { api: "payroll", path: "/PayRunCalendars", personal: true },
};

const XERO_READ_REPORTS = {
  "trial-balance": "/Reports/TrialBalance",
  "profit-and-loss": "/Reports/ProfitAndLoss",
  "balance-sheet": "/Reports/BalanceSheet",
  "bank-summary": "/Reports/BankSummary",
  "executive-summary": "/Reports/ExecutiveSummary",
  "aged-receivables": "/Reports/AgedReceivablesByContact",
  "aged-payables": "/Reports/AgedPayablesByContact",
  "budget-summary": "/Reports/BudgetSummary",
};

// Attachments live on these resources; the file itself is fetched by name.
const ATTACHMENT_RESOURCES = Object.keys(XERO_READ_RESOURCES).filter((k) =>
  (XERO_READ_RESOURCES[k].subs || []).includes("attachments")
);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function allowed() {
  return {
    resources: Object.keys(XERO_READ_RESOURCES),
    reports: Object.keys(XERO_READ_REPORTS),
  };
}

function fail(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

/**
 * Resolves a read request to a Xero URL.
 *
 * { resource, id?, sub?, name? } -> { ok, url, accept, binary, personal, path }
 * or { ok: false, status, error }. `path` is the API-relative path, used in
 * responses and error detail.
 */
function resolveRead({ resource, id, sub, name }) {
  const def = XERO_READ_RESOURCES[resource];
  if (!def) return fail(404, "unknown resource", { allowed: allowed() });

  const base = XERO_APIS[def.api || "accounting"];
  let path = def.path;

  if (id === undefined || id === null || id === "") {
    if (def.idRequired) return fail(400, `${resource} needs an id`);
    if (sub || name) return fail(400, "a sub-resource needs an id");
    return done(base, path, def);
  }

  if (!GUID.test(id)) return fail(400, "id must be a Xero GUID");
  if (!def.byId && !def.idIsOrg) return fail(404, `${resource} cannot be read by id`);
  if (def.idIsOrg && !sub) return fail(404, "organisation is read without an id");
  path = `${path}/${id}`;

  if (name !== undefined) {
    if (!(def.subs || []).includes("attachments")) {
      return fail(404, "attachments are not available for this resource", { allowed: ATTACHMENT_RESOURCES });
    }
    if (!name || /[\\/]/.test(name) || name === "." || name === "..") {
      return fail(400, "attachment name is not valid");
    }
    return {
      ...done(base, `${path}/Attachments/${encodeURIComponent(name)}`, def),
      accept: "application/octet-stream",
      binary: true,
    };
  }

  if (sub) {
    const s = SUBS[sub];
    if (!s || !(def.subs || []).includes(sub)) {
      return fail(404, `${sub} is not available for ${resource}`, { allowed: def.subs || [] });
    }
    const r = done(base, s.path ? `${path}/${s.path}` : path, def);
    return s.binary ? { ...r, accept: s.accept, binary: true } : r;
  }

  return done(base, path, def);
}

function done(base, path, def) {
  return {
    ok: true,
    url: `${base}${path}`,
    path,
    defaults: path === def.path ? def.listQuery || {} : {},
    accept: "application/json",
    binary: false,
    personal: Boolean(def.personal),
  };
}

// Payroll records carry payslips, employee names, ids and bank details. Only
// totals and reference data are needed (the payroll journal and the
// payroll-to-GL control), so every per-person field is removed here, in code,
// before a response leaves the service. Same key list as the laptop MCP.
const PERSONAL_KEYS = new Set([
  "payslips", "employeeid", "employees", "firstname", "lastname", "bacshash",
  "paymentmethod", "employee",
]);

function stripPersonal(value) {
  if (Array.isArray(value)) return value.map(stripPersonal);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!PERSONAL_KEYS.has(k.toLowerCase())) out[k] = stripPersonal(v);
    }
    return out;
  }
  return value;
}

// Supplier bank details (spec 2.6, 20 Oct 2026): the lane compares them, never
// holds or repeats them, because a changed bank detail is the payment-diversion
// fraud this lane must report rather than spread. Every read leaving the service
// shows a bank number as its last 4 characters only. Found when a contact read
// on 20 Oct returned the full account number to an agent.
const BANK_KEYS = new Set(["bankaccountdetails", "bankaccountnumber", "iban", "sortcode", "bsb"]);

function maskBankDetails(value) {
  if (Array.isArray(value)) return value.map(maskBankDetails);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (BANK_KEYS.has(k.toLowerCase()) && typeof v === "string" && v.trim()) {
        out[k] = `****${v.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`;
      } else {
        out[k] = maskBankDetails(v);
      }
    }
    return out;
  }
  return value;
}

module.exports = {
  maskBankDetails,
  XERO_APIS,
  XERO_READ_RESOURCES,
  XERO_READ_REPORTS,
  resolveRead,
  stripPersonal,
  allowed,
};

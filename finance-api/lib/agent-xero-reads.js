// The rest of Cowork's Xero reads for the agent runner (5 Nov 2026).
//
// Nik's rule (30 Oct, restated 5 Nov): the agents in os.stza.io can do what
// Cowork can, so he never has to switch. lib/agent-parity.js maps every Cowork
// tool to the agent tool that does the same job; these are the reads that had
// no agent equivalent. Every call is a GET through finance-api's /read routes,
// which mask bank numbers and strip per-person payroll data before anything
// leaves the service. Results are cut down to the fields a reviewer uses.

const NAMES = [
  "get_contact", "get_prepayments", "get_overpayments", "get_bank_transfers", "get_purchase_orders", "get_quotes",
  "get_xero_settings", "get_schedule_data", "get_cis_settings", "get_payroll", "get_xero_files", "get_executive_summary",
];

const MAX_ITEMS = 500;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
const isGuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const dt = (d) => { const [y, m, x] = String(d).split("-"); return `DateTime(${Number(y)},${Number(m)},${Number(x)})`; };
const where = (...parts) => parts.filter(Boolean).join(" AND ") || undefined;
const eq = (field, v) => (v ? `${field}=="${esc(String(v).toUpperCase())}"` : null);
const from = (field, d) => (d ? `${field}>=${dt(d)}` : null);
const to = (field, d) => (d ? `${field}<=${dt(d)}` : null);

function day(s) {
  if (!s) return null;
  const ms = /^\/Date\((-?\d+)/.exec(String(s));
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : String(s).slice(0, 10);
}
const money = (n) => (n === undefined || n === null ? null : Number(n));
const lines = (ls) => (ls || []).map((l) => ({
  description: l.Description ?? null, quantity: l.Quantity ?? null, unit_amount: money(l.UnitAmount), amount: money(l.LineAmount),
  account_code: l.AccountCode ?? null, tax_type: l.TaxType ?? null, item_code: l.ItemCode ?? null,
  tracking: (l.Tracking || []).map((t) => `${t.Name}: ${t.Option}`),
}));

// ── Views ────────────────────────────────────────────────────────────────────

function contactView(c) {
  const b = c.Balances || {};
  return {
    id: c.ContactID, name: c.Name, status: c.ContactStatus, number: c.ContactNumber || null, account_number: c.AccountNumber || null,
    is_supplier: c.IsSupplier ?? null, is_customer: c.IsCustomer ?? null, tax_number: c.TaxNumber || null,
    company_number: c.CompanyNumber || null, default_currency: c.DefaultCurrency || null,
    purchases_account: c.PurchasesDefaultAccountCode || null, sales_account: c.SalesDefaultAccountCode || null,
    purchases_tax: c.AccountsPayableTaxType || null, sales_tax: c.AccountsReceivableTaxType || null,
    // Masked to the last 4 by finance-api; enough to see that it changed.
    bank_account: c.BankAccountDetails || null,
    payment_terms: c.PaymentTerms ?? null,
    groups: (c.ContactGroups || []).map((g) => g.Name),
    addresses: (c.Addresses || []).filter((a) => a.AddressLine1 || a.City || a.Country)
      .map((a) => [a.AddressLine1, a.City, a.PostalCode, a.Country].filter(Boolean).join(", ")),
    owes_us: money(b.AccountsReceivable?.Outstanding), overdue_to_us: money(b.AccountsReceivable?.Overdue),
    we_owe: money(b.AccountsPayable?.Outstanding), we_owe_overdue: money(b.AccountsPayable?.Overdue),
    updated: day(c.UpdatedDateUTC),
  };
}

const allocationsOf = (x) => (x.Allocations || []).map((a) => ({
  invoice: a.Invoice?.InvoiceNumber ?? a.Invoice?.InvoiceID ?? null, date: day(a.Date), amount: money(a.Amount),
}));

function prepaymentRow(p) {
  return {
    id: p.PrepaymentID, type: p.Type, contact: p.Contact?.Name ?? null, date: day(p.DateString ?? p.Date), status: p.Status,
    reference: p.Reference || null, currency: p.CurrencyCode, total: money(p.Total), remaining: money(p.RemainingCredit),
    allocations: allocationsOf(p), lines: lines(p.LineItems),
  };
}

function overpaymentRow(o) {
  return {
    id: o.OverpaymentID, type: o.Type, contact: o.Contact?.Name ?? null, date: day(o.DateString ?? o.Date), status: o.Status,
    currency: o.CurrencyCode, total: money(o.Total), remaining: money(o.RemainingCredit), allocations: allocationsOf(o),
  };
}

function transferRow(t) {
  return {
    id: t.BankTransferID, date: day(t.DateString ?? t.Date), amount: money(t.Amount), rate: t.CurrencyRate ?? null,
    from: t.FromBankAccount ? `${t.FromBankAccount.Code ?? ""} ${t.FromBankAccount.Name ?? ""}`.trim() : null,
    to: t.ToBankAccount ? `${t.ToBankAccount.Code ?? ""} ${t.ToBankAccount.Name ?? ""}`.trim() : null,
    from_reconciled: t.FromIsReconciled ?? null, to_reconciled: t.ToIsReconciled ?? null,
    reference: t.Reference || null, has_attachments: t.HasAttachments ?? null,
  };
}

function purchaseOrderRow(p) {
  return {
    id: p.PurchaseOrderID, number: p.PurchaseOrderNumber || null, reference: p.Reference || null, contact: p.Contact?.Name ?? null,
    date: day(p.DateString ?? p.Date), delivery_date: day(p.DeliveryDateString ?? p.DeliveryDate), status: p.Status,
    currency: p.CurrencyCode, total: money(p.Total), vat: money(p.TotalTax), sent_to_contact: p.SentToContact ?? null,
    lines: lines(p.LineItems),
  };
}

function quoteRow(q) {
  return {
    id: q.QuoteID, number: q.QuoteNumber || null, reference: q.Reference || null, contact: q.Contact?.Name ?? null,
    date: day(q.DateString ?? q.Date), expiry: day(q.ExpiryDateString ?? q.ExpiryDate), status: q.Status,
    currency: q.CurrencyCode, total: money(q.Total), vat: money(q.TotalTax), title: q.Title || null, lines: lines(q.LineItems),
  };
}

function repeatingRow(r) {
  const s = r.Schedule || {};
  return {
    id: r.RepeatingInvoiceID, type: r.Type, contact: r.Contact?.Name ?? null, status: r.Status, reference: r.Reference || null,
    every: s.Period && s.Unit ? `${s.Period} ${String(s.Unit).toLowerCase()}` : null,
    start: day(s.StartDate), next: day(s.NextScheduledDate), end: day(s.EndDate),
    approved_for_sending: r.ApprovedForSending ?? null, total: money(r.Total), currency: r.CurrencyCode, lines: lines(r.LineItems),
  };
}

// What each settings list keeps. users: name and role only, never email.
const SETTINGS = {
  tax_rates: { resource: "tax-rates", key: "TaxRates", view: (t) => ({ name: t.Name, type: t.TaxType, status: t.Status, rate: money(t.EffectiveRate), report_type: t.ReportTaxType ?? null }) },
  tracking_categories: { resource: "tracking-categories", key: "TrackingCategories", view: (t) => ({ id: t.TrackingCategoryID, name: t.Name, status: t.Status, options: (t.Options || []).map((o) => `${o.Name}${o.Status && o.Status !== "ACTIVE" ? ` (${o.Status.toLowerCase()})` : ""}`) }) },
  currencies: { resource: "currencies", key: "Currencies", view: (c) => ({ code: c.Code, name: c.Description }) },
  items: { resource: "items", key: "Items", view: (i) => ({ id: i.ItemID, code: i.Code, name: i.Name, tracked: i.IsTrackedAsInventory ?? null, on_hand: money(i.QuantityOnHand), purchase: i.PurchaseDetails ? { price: money(i.PurchaseDetails.UnitPrice), account: i.PurchaseDetails.AccountCode ?? i.PurchaseDetails.COGSAccountCode ?? null, tax: i.PurchaseDetails.TaxType ?? null } : null, sales: i.SalesDetails ? { price: money(i.SalesDetails.UnitPrice), account: i.SalesDetails.AccountCode ?? null, tax: i.SalesDetails.TaxType ?? null } : null }) },
  contact_groups: { resource: "contact-groups", key: "ContactGroups", view: (g) => ({ id: g.ContactGroupID, name: g.Name, status: g.Status }) },
  branding_themes: { resource: "branding-themes", key: "BrandingThemes", view: (b) => ({ id: b.BrandingThemeID, name: b.Name, sort_order: b.SortOrder ?? null }) },
  users: { resource: "users", key: "Users", view: (u) => ({ name: [u.FirstName, u.LastName].filter(Boolean).join(" ") || null, role: u.OrganisationRole ?? null, subscriber: u.IsSubscriber ?? null }) },
  organisation_actions: { resource: "organisation-actions", key: "Actions", view: (a) => ({ action: a.Name, status: a.Status }) },
};

// Schedule data: what repeats or is planned.
const SCHEDULES = {
  repeating_invoices: { resource: "repeating-invoices", key: "RepeatingInvoices", view: repeatingRow },
  budgets: { resource: "budgets", key: "Budgets", view: (b) => ({ id: b.BudgetID, type: b.Type, description: b.Description || null, status: b.Status, updated: day(b.UpdatedDateUTC) }) },
  batch_payments: { resource: "batch-payments", key: "BatchPayments", view: (b) => ({ id: b.BatchPaymentID, date: day(b.DateString ?? b.Date), type: b.Type, status: b.Status, total: money(b.TotalAmount), reference: b.Reference || null, reconciled: b.IsReconciled ?? null, bank_account: b.Account?.Code ?? null, payments: (b.Payments || []).length }) },
  linked_transactions: { resource: "linked-transactions", key: "LinkedTransactions", view: (l) => ({ id: l.LinkedTransactionID, status: l.Status, type: l.Type, source: l.SourceTransactionID ?? null, source_line: l.SourceLineItemID ?? null, target: l.TargetTransactionID ?? null, contact_id: l.ContactID ?? null }) },
  invoice_reminders: { resource: "invoice-reminders", key: "InvoiceRemindersSettings", view: (s) => s },
};

// Payroll: totals and reference data only (finance-api strips every per-person field).
const PAYROLL = {
  pay_runs: "pay-runs", settings: "payroll-settings", earnings_rates: "earnings-rates", deductions: "deductions",
  benefits: "benefits", leave_types: "leave-types", reimbursements: "reimbursements", pay_run_calendars: "pay-run-calendars",
};

// ── Tool definitions ─────────────────────────────────────────────────────────

function tools(entityEnum) {
  const entity = { type: "string", enum: entityEnum, description: "Entity slug" };
  const date = (what) => ({ type: "string", description: `${what} (YYYY-MM-DD)` });
  const id = (what) => ({ type: "string", description: what });
  const def = (name, description, props = {}, required = []) => ({
    name, description, input_schema: { type: "object", properties: { entity, ...props }, required: ["entity", ...required] },
  });
  return [
    def("get_contact",
      "One supplier or customer in full: VAT and company numbers, default accounts and VAT types, payment terms, groups, " +
      "addresses, what they owe us and we owe them, and the bank account (last 4 digits only). Use get_history on the " +
      "contact to see whether bank details changed.",
      { contact_id: id("ContactID from get_contacts") }, ["contact_id"]),
    def("get_prepayments",
      "Prepayments in Xero's sense: money paid or received before the invoice (SPEND-PREPAYMENT or RECEIVE-PREPAYMENT), " +
      "with what is left unallocated and where it was allocated. Not the prepaid expenses schedule (that is a reconciliation).",
      { status: { type: "string", enum: ["AUTHORISED", "PAID", "VOIDED"] }, from_date: date("From"), to_date: date("To") }),
    def("get_overpayments",
      "Overpayments: money paid or received above an invoice, with what is left unallocated and where it was allocated.",
      { status: { type: "string", enum: ["AUTHORISED", "PAID", "VOIDED"] }, from_date: date("From"), to_date: date("To") }),
    def("get_bank_transfers",
      "Transfers between the entity's own bank accounts: date, from, to, amount, and whether each side is reconciled.",
      { from_date: date("From"), to_date: date("To") }),
    def("get_purchase_orders", "Purchase orders with their lines, status and delivery date.", {
      status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED", "BILLED", "DELETED"] }, from_date: date("From"), to_date: date("To"),
    }),
    def("get_quotes", "Sales quotes with their lines, status and expiry.", {
      status: { type: "string", enum: ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "INVOICED", "DELETED"] }, from_date: date("From"), to_date: date("To"),
    }),
    def("get_xero_settings",
      "The entity's Xero set-up lists: tax_rates, tracking_categories (with options), currencies, items (with their default " +
      "accounts and VAT), contact_groups, branding_themes, users (name and role only), organisation_actions (what Xero lets " +
      "this connection do).",
      { what: { type: "string", enum: Object.keys(SETTINGS) } }, ["what"]),
    def("get_schedule_data",
      "What repeats or is planned in Xero: repeating_invoices (bills and invoices with their schedule and next date), " +
      "budgets, batch_payments, linked_transactions (billable expenses), invoice_reminders (settings). Check repeating " +
      "bills before accruing a recurring cost, so it is not counted twice.",
      { what: { type: "string", enum: Object.keys(SCHEDULES) } }, ["what"]),
    def("get_cis_settings",
      "Construction Industry Scheme settings: the entity's own (no contact_id) or one contact's (with contact_id).",
      { contact_id: id("ContactID, for a contact's CIS settings") }),
    def("get_payroll",
      "Xero UK payroll, totals and reference data only (no payslips or personal data): pay_runs (list, or one with " +
      "pay_run_id), settings, earnings_rates, deductions, benefits, leave_types, reimbursements, pay_run_calendars. Use it " +
      "to tie the payroll journal and PAYE/NI to the pay runs.",
      { what: { type: "string", enum: Object.keys(PAYROLL) }, pay_run_id: id("PayRunID, with what=pay_runs, for one pay run") }, ["what"]),
    def("get_xero_files",
      "Xero Files, the entity's document library: files (list, or one with file_id), folders, inbox (documents waiting), " +
      "associations (which records a file is linked to, with file_id), record_files (files linked to a record, with record_id). " +
      "To read a file's contents, use read_attachment on the record it is attached to.",
      {
        what: { type: "string", enum: ["files", "folders", "inbox", "associations", "record_files"] },
        file_id: id("FileId"), record_id: id("The id of an invoice, contact, bank line or journal"),
      }, ["what"]),
    def("get_executive_summary",
      "Xero's Executive Summary report for a month: cash, profitability, balance sheet and performance ratios, with the " +
      "prior month.", { date: date("A day in the month (default: this month)") }),
  ];
}

// ── Calls ────────────────────────────────────────────────────────────────────

function agentXeroReads({ apiCall }) {
  const base = (job, entity) =>
    `/api/finance/clients/${encodeURIComponent(job.client.slug)}/xero/${encodeURIComponent(entity)}`;
  const qs = (params) => {
    const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
    return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)]))}` : "";
  };
  const read = (job, entity, path, params = {}) => apiCall("GET", `${base(job, entity)}/read/${path}${qs(params)}`);

  async function pages(job, entity, resource, key, params, cap = 200) {
    const limit = Math.min(cap, MAX_ITEMS);
    const items = [];
    for (let page = 1; items.length < limit; page++) {
      const got = (await read(job, entity, resource, { ...params, page }))?.data?.[key] || [];
      items.push(...got);
      if (got.length < 100) return { items: items.slice(0, limit), complete: items.length <= limit };
    }
    return { items: items.slice(0, limit), complete: false };
  }
  const listed = ({ items, complete }, view) => ({
    count: items.length, complete,
    ...(complete ? {} : { note: "More records exist than were read. Narrow the dates or filters, and say the list is partial if you rely on it." }),
    items: items.map(view),
  });
  const dated = (field, input) => ({
    where: where(eq("Status", input.status), from(field, input.from_date), to(field, input.to_date)),
  });

  function checkInput(input) {
    for (const k of ["from_date", "to_date", "date"]) if (input[k] && !isDate(input[k])) return `${k} must be YYYY-MM-DD`;
    for (const k of ["contact_id", "file_id", "record_id", "pay_run_id"]) if (input[k] && !isGuid(input[k])) return `${k} must be an id from an earlier tool result`;
    return null;
  }

  async function call(job, name, input = {}) {
    const bad = checkInput(input);
    if (bad) return { error: bad };
    const e = input.entity;
    switch (name) {
      case "get_contact": {
        const c = (await read(job, e, `contacts/${input.contact_id}`))?.data?.Contacts?.[0];
        return c ? contactView(c) : { error: "No such contact" };
      }
      case "get_prepayments":
        return listed(await pages(job, e, "prepayments", "Prepayments", dated("Date", input)), prepaymentRow);
      case "get_overpayments":
        return listed(await pages(job, e, "overpayments", "Overpayments", dated("Date", input)), overpaymentRow);
      case "get_bank_transfers":
        return listed(await pages(job, e, "bank-transfers", "BankTransfers", { where: where(from("Date", input.from_date), to("Date", input.to_date)) }), transferRow);
      case "get_purchase_orders": {
        // Purchase orders filter by query parameters, not a where clause.
        const params = { status: input.status, DateFrom: input.from_date, DateTo: input.to_date };
        return listed(await pages(job, e, "purchase-orders", "PurchaseOrders", params), purchaseOrderRow);
      }
      case "get_quotes": {
        const params = { Status: input.status, DateFrom: input.from_date, DateTo: input.to_date };
        return listed(await pages(job, e, "quotes", "Quotes", params), quoteRow);
      }
      case "get_xero_settings": {
        const s = SETTINGS[input.what];
        if (!s) return { error: `what must be one of ${Object.keys(SETTINGS).join(", ")}` };
        const rows = (await read(job, e, s.resource))?.data?.[s.key] || [];
        return { what: input.what, count: rows.length, items: rows.map(s.view) };
      }
      case "get_schedule_data": {
        const s = SCHEDULES[input.what];
        if (!s) return { error: `what must be one of ${Object.keys(SCHEDULES).join(", ")}` };
        const got = (await read(job, e, s.resource))?.data?.[s.key];
        const rows = Array.isArray(got) ? got : got ? [got] : [];
        return { what: input.what, count: rows.length, items: rows.map(s.view) };
      }
      case "get_cis_settings": {
        if (input.contact_id) return (await read(job, e, `contacts/${input.contact_id}/cis`))?.data ?? null;
        const org = (await read(job, e, "organisation"))?.data?.Organisations?.[0];
        if (!org?.OrganisationID) return { error: "Xero returned no organisation" };
        return (await read(job, e, `organisation/${org.OrganisationID}/cis`))?.data ?? null;
      }
      case "get_payroll": {
        const resource = PAYROLL[input.what];
        if (!resource) return { error: `what must be one of ${Object.keys(PAYROLL).join(", ")}` };
        if (input.pay_run_id && input.what !== "pay_runs") return { error: "pay_run_id goes with what=pay_runs" };
        return (await read(job, e, input.pay_run_id ? `${resource}/${input.pay_run_id}` : resource))?.data ?? null;
      }
      case "get_xero_files": {
        switch (input.what) {
          case "files": return (await read(job, e, input.file_id ? `files/${input.file_id}` : "files"))?.data ?? null;
          case "folders": return (await read(job, e, "folders"))?.data ?? null;
          case "inbox": return (await read(job, e, "inbox"))?.data ?? null;
          case "associations":
            if (!input.file_id) return { error: "associations needs file_id" };
            return (await read(job, e, `files/${input.file_id}/associations`))?.data ?? null;
          case "record_files":
            if (!input.record_id) return { error: "record_files needs record_id" };
            return (await read(job, e, `object-associations/${input.record_id}`))?.data ?? null;
          default: return { error: "what must be files, folders, inbox, associations or record_files" };
        }
      }
      case "get_executive_summary":
        return read(job, e, "reports/executive-summary", { date: input.date });
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentXeroReads, NAMES, SETTINGS, SCHEDULES, PAYROLL, contactView };

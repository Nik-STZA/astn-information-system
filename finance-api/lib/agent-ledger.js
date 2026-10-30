// Ledger read tools for the agent runner (29 Oct 2026): the documents behind
// a balance, so an agent can open what made a number instead of reasoning from
// a summary (practice controls, section 3).
//
// Every tool is a read through finance-api's /read routes, which hold the Xero
// token, mask bank details and strip per-person payroll data. Results are cut
// down to the fields a reviewer uses: a raw page of Xero invoices is around
// 40,000 tokens, and most of it is addresses and links.

const NAMES = [
  "get_organisation", "get_invoices", "get_invoice", "get_credit_notes", "get_payments",
  "get_bank_transactions", "get_manual_journals", "get_contacts", "get_history",
  "list_attachments", "get_fixed_assets", "check_bill", "get_budget_summary", "get_client_profile",
];

// History and attachments, by the record types an agent meets.
const RECORD_TYPES = {
  invoice: "invoices", credit_note: "credit-notes", bank_transaction: "bank-transactions",
  manual_journal: "manual-journals", contact: "contacts", payment: "payments", bank_transfer: "bank-transfers",
};
const ATTACHABLE = ["invoice", "credit_note", "bank_transaction", "manual_journal", "contact", "bank_transfer"];

const MAX_ITEMS = 500;

// ── Xero where clauses ───────────────────────────────────────────────────────

const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
const isGuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
function dt(d) {
  const [y, m, day] = String(d).split("-");
  return `DateTime(${Number(y)},${Number(m)},${Number(day)})`;
}
const eq = (field, v) => (v ? `${field}=="${esc(String(v).toUpperCase())}"` : null);
const from = (field, d) => (d ? `${field}>=${dt(d)}` : null);
const to = (field, d) => (d ? `${field}<=${dt(d)}` : null);
const guid = (field, v) => (v ? `${field}==Guid("${esc(v)}")` : null);
const where = (...parts) => parts.filter(Boolean).join(" AND ") || undefined;

// ── Views: what a reviewer reads, without Xero's bookkeeping ─────────────────

// Xero sends dates as "2026-08-31T00:00:00" (the *String fields) or as
// "/Date(1788134400000+0000)/".
function day(s) {
  if (!s) return null;
  const ms = /^\/Date\((-?\d+)/.exec(String(s));
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : String(s).slice(0, 10);
}
const money = (n) => (n === undefined || n === null ? null : Number(n));

function lineView(l) {
  return {
    description: l.Description ?? null, quantity: l.Quantity ?? null, unit_amount: money(l.UnitAmount),
    amount: money(l.LineAmount), account_code: l.AccountCode ?? null, tax_type: l.TaxType ?? null, tax: money(l.TaxAmount),
    tracking: (l.Tracking || []).map((t) => `${t.Name}: ${t.Option}`),
  };
}

function invoiceRow(i) {
  return {
    id: i.InvoiceID, type: i.Type, number: i.InvoiceNumber || null, reference: i.Reference || null,
    contact: i.Contact?.Name ?? null, date: day(i.DateString), due_date: day(i.DueDateString), status: i.Status,
    currency: i.CurrencyCode, total: money(i.Total), vat: money(i.TotalTax), amount_due: money(i.AmountDue),
    has_attachments: i.HasAttachments ?? null,
  };
}

function invoiceView(i) {
  return {
    ...invoiceRow(i),
    amounts_are: i.LineAmountTypes, sub_total: money(i.SubTotal), amount_paid: money(i.AmountPaid),
    amount_credited: money(i.AmountCredited), currency_rate: i.CurrencyRate ?? null,
    lines: (i.LineItems || []).map(lineView),
    payments: (i.Payments || []).map((p) => ({ id: p.PaymentID, date: day(p.DateString ?? p.Date), amount: money(p.Amount), reference: p.Reference || null })),
    credit_notes: (i.CreditNotes || []).map((c) => ({ id: c.CreditNoteID, number: c.CreditNoteNumber, total: money(c.Total) })),
    updated: day(i.UpdatedDateUTC),
  };
}

function creditNoteRow(c) {
  return {
    id: c.CreditNoteID, type: c.Type, number: c.CreditNoteNumber || null, reference: c.Reference || null,
    contact: c.Contact?.Name ?? null, date: day(c.DateString), status: c.Status, currency: c.CurrencyCode,
    total: money(c.Total), remaining: money(c.RemainingCredit),
    allocations: (c.Allocations || []).map((a) => ({ invoice: a.Invoice?.InvoiceNumber ?? a.Invoice?.InvoiceID ?? null, amount: money(a.Amount) })),
    lines: (c.LineItems || []).map(lineView),
  };
}

function paymentRow(p) {
  return {
    id: p.PaymentID, date: day(p.DateString ?? p.Date), amount: money(p.Amount), currency_rate: p.CurrencyRate ?? null,
    reference: p.Reference || null, status: p.Status, type: p.PaymentType, reconciled: p.IsReconciled ?? null,
    bank_account: p.Account?.Code ?? p.Account?.AccountID ?? null,
    document: p.Invoice ? { kind: "invoice", id: p.Invoice.InvoiceID, number: p.Invoice.InvoiceNumber || null, contact: p.Invoice.Contact?.Name ?? null }
      : p.CreditNote ? { kind: "credit_note", id: p.CreditNote.CreditNoteID, number: p.CreditNote.CreditNoteNumber || null } : null,
  };
}

function bankTransactionRow(b) {
  return {
    id: b.BankTransactionID, type: b.Type, date: day(b.DateString), contact: b.Contact?.Name ?? null,
    reference: b.Reference || null, status: b.Status, reconciled: b.IsReconciled ?? null,
    bank_account: b.BankAccount ? `${b.BankAccount.Code ?? ""} ${b.BankAccount.Name ?? ""}`.trim() : null,
    currency: b.CurrencyCode, total: money(b.Total), vat: money(b.TotalTax), has_attachments: b.HasAttachments ?? null,
    lines: (b.LineItems || []).map(lineView),
  };
}

function journalRow(j) {
  return {
    id: j.ManualJournalID, date: day(j.DateString ?? j.Date), narration: j.Narration, status: j.Status,
    amounts_are: j.LineAmountTypes, has_attachments: j.HasAttachments ?? null,
    lines: (j.JournalLines || []).map((l) => ({
      account_code: l.AccountCode, description: l.Description ?? null, amount: money(l.LineAmount),
      tax_type: l.TaxType ?? null, tracking: (l.Tracking || []).map((t) => `${t.Name}: ${t.Option}`),
    })),
  };
}

function contactRow(c) {
  return {
    id: c.ContactID, name: c.Name, status: c.ContactStatus, is_supplier: c.IsSupplier ?? null, is_customer: c.IsCustomer ?? null,
    tax_number: c.TaxNumber || null, default_currency: c.DefaultCurrency || null,
    country: (c.Addresses || []).find((a) => a.Country)?.Country ?? null,
    purchases_account: c.PurchasesDefaultAccountCode || null, sales_account: c.SalesDefaultAccountCode || null,
  };
}

function assetRow(a) {
  const d = a.bookDepreciationDetail || {};
  const s = a.bookDepreciationSetting || {};
  return {
    id: a.assetId, number: a.assetNumber, name: a.assetName, status: a.assetStatus, type_id: a.assetTypeId ?? null,
    purchase_date: day(a.purchaseDate), purchase_price: money(a.purchasePrice), disposal_date: day(a.disposalDate),
    book_value: money(a.bookValue), depreciation_method: s.depreciationMethod ?? null, averaging: s.averagingMethod ?? null,
    rate: s.depreciationRate ?? null, effective_life_years: s.effectiveLifeYears ?? null,
    depreciation_start: day(d.depreciationStartDate), accumulated_depreciation: money(d.currentAccumDepreciationAmount),
  };
}

// Organisation: the facts a procedure checks before starting.
function organisationView(o) {
  return {
    name: o.Name, legal_name: o.LegalName, vat_registered: o.PaysTax ?? null, tax_number: o.TaxNumber || null,
    tax_basis: o.SalesTaxBasis ?? null, tax_period: o.SalesTaxPeriod ?? null, base_currency: o.BaseCurrency,
    country: o.CountryCode, organisation_type: o.OrganisationType,
    financial_year_end: o.FinancialYearEndDay && o.FinancialYearEndMonth ? `${o.FinancialYearEndDay}/${o.FinancialYearEndMonth}` : null,
    period_lock_date: day(o.PeriodLockDateString ?? null), year_end_lock_date: day(o.EndOfYearLockDateString ?? null),
  };
}

// ── Tool definitions ─────────────────────────────────────────────────────────

function tools(entityEnum) {
  const entity = { type: "string", enum: entityEnum, description: "Entity slug" };
  const date = (what) => ({ type: "string", description: `${what} (YYYY-MM-DD)` });
  const id = (what) => ({ type: "string", description: what });
  const def = (name, description, props = {}, required = []) => ({
    name, description, input_schema: { type: "object", properties: { entity, ...props }, required: ["entity", ...required] },
  });
  return [
    {
      name: "get_client_profile",
      description:
        "The client's group and companies as recorded in os.stza.io: who owns whom and the share held, registration " +
        "number, country of incorporation, VAT position (own number or VAT group member) and the reporting standard " +
        "each company reports under, with what that standard decides. Read it before choosing any treatment. Its gaps " +
        "list says what is not recorded; ask rather than assume.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    def("get_organisation",
      "The entity's own settings in Xero: legal name, whether it is VAT registered, VAT basis and period, base currency, " +
      "financial year end and lock dates. Check this before work that depends on any of them; never assume VAT status."),
    def("get_invoices",
      "Bills (ACCPAY) and sales invoices (ACCREC) as a list: number, contact, dates, status, total, VAT and amount due. " +
      "Filter by type, status, date range or contact. Open one with get_invoice for its lines.",
      {
        invoice_type: { type: "string", enum: ["ACCPAY", "ACCREC"] },
        status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED", "DELETED"] },
        from_date: date("Invoice date from"), to_date: date("Invoice date to"), contact_id: id("ContactID from get_contacts"),
        max_items: { type: "integer", description: `Default 100, at most ${MAX_ITEMS}` },
      }),
    def("get_invoice",
      "One bill or invoice in full: every line with its account, VAT type and tracking, the payments and credit notes " +
      "against it, and whether it has attachments. This is the source document's record in the ledger.",
      { invoice_id: id("InvoiceID from get_invoices") }, ["invoice_id"]),
    def("get_credit_notes", "Credit notes with their lines and what they are allocated against.", {
      credit_note_type: { type: "string", enum: ["ACCPAYCREDIT", "ACCRECCREDIT"] },
      status: { type: "string" }, from_date: date("From"), to_date: date("To"),
    }),
    def("get_payments", "Payments against bills, invoices and credit notes: date, amount, bank account, reference, whether reconciled.", {
      from_date: date("From"), to_date: date("To"), status: { type: "string", enum: ["AUTHORISED", "DELETED"] },
    }),
    def("get_bank_transactions",
      "Spend and receive money lines (not payments of bills, which are get_payments): date, contact, reference, " +
      "lines with account and VAT, and whether reconciled. Filter by bank account, type or dates.",
      {
        bank_account_id: id("AccountID of the bank account, from get_chart_of_accounts"),
        transaction_type: { type: "string", enum: ["SPEND", "RECEIVE", "SPEND-TRANSFER", "RECEIVE-TRANSFER", "SPEND-PREPAYMENT", "RECEIVE-PREPAYMENT", "SPEND-OVERPAYMENT", "RECEIVE-OVERPAYMENT"] },
        from_date: date("From"), to_date: date("To"),
        max_items: { type: "integer", description: `Default 200, at most ${MAX_ITEMS}` },
      }),
    def("get_manual_journals", "Manual journals with every line: date, narration, status (DRAFT, POSTED, VOIDED) and the account and amount on each line.", {
      status: { type: "string", enum: ["DRAFT", "POSTED", "VOIDED", "DELETED"] }, from_date: date("From"), to_date: date("To"),
    }),
    def("get_contacts", "Suppliers and customers: name, status, VAT number, country, default accounts. Search by name.", {
      search_term: { type: "string", description: "Part of the name, email or account number" },
      is_supplier: { type: "boolean" }, is_customer: { type: "boolean" },
    }),
    def("get_history",
      "Who changed a record and when, and what they changed: the audit trail behind an invoice, credit note, bank line, " +
      "journal, payment or contact. Use it to see whether a document was edited after it was entered.",
      { record_type: { type: "string", enum: Object.keys(RECORD_TYPES) }, record_id: id("The record's id") }, ["record_type", "record_id"]),
    def("list_attachments",
      "The files attached to a record (name, type, size). Open one with read_attachment.",
      { record_type: { type: "string", enum: ATTACHABLE }, record_id: id("The record's id") }, ["record_type", "record_id"]),
    def("get_fixed_assets", "The fixed asset register in Xero: each asset's cost, purchase date, depreciation method and rate, book value and status.", {
      status: { type: "string", enum: ["REGISTERED", "DRAFT", "DISPOSED"], description: "Default REGISTERED" },
    }),
    def("check_bill",
      "The platform's computed checks on one bill: duplicates against the ledger, VAT against the entity's registration, " +
      "dates, totals, attachment present and whether anything changed it after entry. A reviewer runs this itself rather " +
      "than reading the drafter's account of it.",
      { invoice_id: id("InvoiceID of the bill") }, ["invoice_id"]),
    def("get_budget_summary",
      "The budget held in Xero against actuals, by month: Xero's Budget Summary report. Empty when no budget is loaded in " +
      "Xero; say so rather than inferring a plan.",
      {
        date: date("The report runs from this month"),
        periods: { type: "integer", description: "Number of months, 1 to 12" },
        timeframe: { type: "integer", enum: [1, 3, 12], description: "Months per column: 1, 3 or 12" },
      }),
  ];
}

// ── Calls ────────────────────────────────────────────────────────────────────

// apiCall is the runner's (throws on a non-2xx answer).
function agentLedger({ apiCall }) {
  const base = (job, entity) =>
    `/api/finance/clients/${encodeURIComponent(job.client.slug)}/xero/${encodeURIComponent(entity)}`;
  const qs = (params) => {
    const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
    return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)]))}` : "";
  };
  const read = (job, entity, path, params = {}) => apiCall("GET", `${base(job, entity)}/read/${path}${qs(params)}`);

  // Xero pages at 100. Reads stop at the cap and say so, rather than quietly
  // returning part of a population as if it were all of it.
  async function pages(job, entity, resource, key, params, cap) {
    const limit = Math.min(Math.max(1, cap || 100), MAX_ITEMS);
    const items = [];
    for (let page = 1; items.length < limit; page++) {
      const got = (await read(job, entity, resource, { ...params, page }))?.data?.[key] || [];
      items.push(...got);
      if (got.length < 100) return { items: items.slice(0, limit), complete: items.length <= limit };
    }
    return { items: items.slice(0, limit), complete: false };
  }
  const listed = ({ items, complete }, view) => ({
    count: items.length,
    complete,
    ...(complete ? {} : { note: "More records exist than were read. Narrow the dates or filters, and say the list is partial if you rely on it." }),
    items: items.map(view),
  });

  function checkInput(name, input) {
    for (const k of ["from_date", "to_date"]) if (input[k] && !isDate(input[k])) return `${k} must be YYYY-MM-DD`;
    for (const k of ["invoice_id", "record_id", "contact_id", "bank_account_id"]) if (input[k] && !isGuid(input[k])) return `${k} must be an id from an earlier tool result`;
    if (input.record_type && !RECORD_TYPES[input.record_type]) return `record_type must be one of ${Object.keys(RECORD_TYPES).join(", ")}`;
    if (name === "list_attachments" && !ATTACHABLE.includes(input.record_type)) return `attachments are not kept on ${input.record_type}`;
    return null;
  }

  async function call(job, name, input) {
    if (name === "get_client_profile") {
      try {
        return await apiCall("GET", `/api/clients/${encodeURIComponent(job.client.slug)}/profile?for=agent`);
      } catch (e) {
        return { error: "The client profile could not be read. Ask for the reporting standard and VAT position rather than assuming them.", detail: e.message };
      }
    }
    const bad = checkInput(name, input);
    if (bad) return { error: bad };
    const e = input.entity;

    switch (name) {
      case "get_organisation": {
        const o = (await read(job, e, "organisation"))?.data?.Organisations?.[0];
        return o ? organisationView(o) : { error: "Xero returned no organisation" };
      }
      case "get_invoices":
        return listed(await pages(job, e, "invoices", "Invoices", {
          where: where(eq("Type", input.invoice_type), eq("Status", input.status), from("Date", input.from_date), to("Date", input.to_date), guid("Contact.ContactID", input.contact_id)),
          order: "Date DESC", summaryOnly: "true",
        }, input.max_items || 100), invoiceRow);
      case "get_invoice": {
        const i = (await read(job, e, `invoices/${input.invoice_id}`))?.data?.Invoices?.[0];
        return i ? invoiceView(i) : { error: "No such invoice" };
      }
      case "get_credit_notes":
        return listed(await pages(job, e, "credit-notes", "CreditNotes", {
          where: where(eq("Type", input.credit_note_type), eq("Status", input.status), from("Date", input.from_date), to("Date", input.to_date)),
        }, 200), creditNoteRow);
      case "get_payments":
        return listed(await pages(job, e, "payments", "Payments", {
          where: where(eq("Status", input.status), from("Date", input.from_date), to("Date", input.to_date)),
        }, 300), paymentRow);
      case "get_bank_transactions":
        return listed(await pages(job, e, "bank-transactions", "BankTransactions", {
          where: where(guid("BankAccount.AccountID", input.bank_account_id), eq("Type", input.transaction_type), from("Date", input.from_date), to("Date", input.to_date)),
          order: "Date DESC",
        }, input.max_items || 200), bankTransactionRow);
      case "get_manual_journals":
        return listed(await pages(job, e, "manual-journals", "ManualJournals", {
          where: where(eq("Status", input.status), from("Date", input.from_date), to("Date", input.to_date)),
        }, 200), journalRow);
      case "get_contacts": {
        const params = input.search_term
          ? { searchTerm: input.search_term }
          : { where: where(input.is_supplier ? "IsSupplier==true" : null, input.is_customer ? "IsCustomer==true" : null), summaryOnly: "true" };
        return listed(await pages(job, e, "contacts", "Contacts", params, 300), contactRow);
      }
      case "get_history": {
        const r = await read(job, e, `${RECORD_TYPES[input.record_type]}/${input.record_id}/history`);
        return { record_type: input.record_type, record_id: input.record_id, history: (r?.data?.HistoryRecords || []).map((h) => ({
          when: h.DateUTCString ?? h.DateUTC ?? null, who: h.User ?? null, change: h.Changes ?? null, details: h.Details ?? null,
        })) };
      }
      case "list_attachments": {
        const r = await read(job, e, `${RECORD_TYPES[input.record_type]}/${input.record_id}/attachments`);
        return { attachments: (r?.data?.Attachments || []).map((a) => ({ name: a.FileName, type: a.MimeType, bytes: a.ContentLength })) };
      }
      case "get_fixed_assets": {
        const r = await read(job, e, "assets", { status: input.status || "REGISTERED", page: 1, pageSize: 200 });
        const items = r?.data?.items || [];
        return { count: items.length, complete: items.length < 200, items: items.map(assetRow) };
      }
      case "get_budget_summary":
        if (input.date && !isDate(input.date)) return { error: "date must be YYYY-MM-DD" };
        return read(job, e, "reports/budget-summary", { date: input.date, periods: input.periods, timeframe: input.timeframe });
      case "check_bill":
        return apiCall("GET", `${base(job, e)}/checks/bill/${input.invoice_id}`);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentLedger, NAMES, invoiceRow, invoiceView, organisationView, where, dt };

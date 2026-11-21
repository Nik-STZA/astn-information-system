// Management pack templates (part 2 of docs/management-pack-templates-plan.md,
// CFO 18 Nov 2026): a named P&L layout, kept here in code and versioned with it.
//
// A template gives:
//   categories  P&L lines it adds or renames on top of the standard set
//               (migration 017). Same shape as a reporting_categories row.
//   sublines    each category's sub-lines, in the order the pack draws them.
//               A sub-line not listed here draws after the listed ones, in
//               account code order, as before.
//   ebitda      whether the pack shows Management EBITDA (overheads above it,
//               the subtotal, then the lines below it). Off: every overhead in
//               category order, then operating profit.
//   belowEbitda the overhead lines drawn below Management EBITDA. Not set: the
//               non-cash ones (depreciation and amortisation). This is about
//               presentation only; whether a line is cash for the cash flow is
//               its category's cash_flow (realised FX is cash, yet sits below
//               EBITDA in a management pack).
//   labels      the subtotal labels.
//   headings    a master file's P&L Mapping 1 words -> category key, so a
//               master file can be read (part 3). A heading not here is shown
//               as having no category, never guessed.
//   bsHeadings  the same for the master's BS Mapping. A value may list more
//               than one line where the heading alone does not decide it (loan
//               notes due within or after a year): the first is the default,
//               and an account already on one of them keeps it.
//
// The client picks one (shared.clients.pack_template, migration 055). The
// categories a client sees are: the standard set, then the template's, then the
// client's own rows (which still win: a rename or a client-only line).

const SUBTOTALS = ["gross_profit", "total_overheads", "management_ebitda", "operating_profit", "profit_before_tax", "net_profit"];

const STANDARD_LABELS = {
  gross_profit: "Gross profit",
  total_overheads: "Total overheads",
  management_ebitda: "Management EBITDA",
  operating_profit: "Operating profit",
  profit_before_tax: "Profit before taxation",
  net_profit: "Profit for the financial period",
};

// The standard set's own headings, shared by the two standard templates.
const STANDARD_HEADINGS = {
  "Turnover": "turnover",
  "Revenue": "turnover",
  "Sales": "turnover",
  "Cost of sales": "cost_of_sales",
  "Direct costs": "cost_of_sales",
  "Staff costs": "staff_costs",
  "Establishment costs": "establishment",
  "Legal and professional fees": "professional_fees",
  "Administrative expenses": "administrative",
  "Depreciation": "depreciation",
  "Amortisation": "depreciation",
  "Depreciation and amortisation": "depreciation",
  "Foreign exchange gains and losses": "fx",
  "Interest receivable and other income": "other_income",
  "Other income": "other_income",
  "Interest payable": "interest_payable",
  "Taxation": "taxation",
};

// The standard balance sheet lines by their own labels.
const STANDARD_BS_HEADINGS = {
  "Intangible assets": "intangible_assets",
  "Tangible assets": "tangible_assets",
  "Investments": "investments",
  "Stock": "stock",
  "Debtors": "debtors",
  "Cash at bank and in hand": "cash",
  "Cash": "cash",
  "Creditors: amounts falling due within one year": "creditors_lt1y",
  "Creditors: amounts falling due after more than one year": "creditors_gt1y",
  "Provisions for liabilities": "provisions",
  "Called up share capital": "share_capital",
  "Share capital": "share_capital",
  "Profit and loss account": "retained_earnings",
  "Retained earnings": "retained_earnings",
  "Other reserves": "other_reserves",
};

const pnl = (key, label, section, sortOrder, cashFlow = null) =>
  ({ key, label, statement: "pnl", section, sortOrder, cashFlow, active: true });

const TEMPLATES = {
  standard_management: {
    key: "standard_management",
    name: "Standard management",
    description: "Standard headings with Management EBITDA before depreciation and amortisation. The default.",
    version: 1,
    ebitda: true,
    labels: { ...STANDARD_LABELS },
    categories: [],
    sublines: {},
    headings: { ...STANDARD_HEADINGS },
    bsHeadings: { ...STANDARD_BS_HEADINGS },
  },

  standard_statutory: {
    key: "standard_statutory",
    name: "Standard statutory",
    description: "FRS 102 headings, no EBITDA: every overhead, then operating profit.",
    version: 1,
    ebitda: false,
    labels: { ...STANDARD_LABELS, total_overheads: "Total administrative expenses" },
    categories: [],
    sublines: {},
    headings: { ...STANDARD_HEADINGS },
    bsHeadings: { ...STANDARD_BS_HEADINGS },
  },

  // From the Feldspar master (Master Mapping with Raise Buckets, 10 Nov 2026)
  // and the categories applied from it on 18 Nov 2026.
  feldspar_management: {
    key: "feldspar_management",
    name: "Feldspar management",
    description: "Feldspar's management layout: Marketing, Payroll & Related, Property & General, IT, Travel & Entertainment, Legal & Professional, Capitalised Development, then Management EBITDA.",
    version: 3,
    ebitda: true,
    labels: { ...STANDARD_LABELS },
    // CFO 18 Nov 2026: impairment beside depreciation and amortisation, and FX
    // (realised, unrealised, bank revaluations) below EBITDA. CFO 20 Nov 2026:
    // Penalties and Fines on its own line below EBITDA.
    belowEbitda: ["depreciation", "impairment", "fx", "penalties_fines"],
    categories: [
      pnl("turnover", "Revenue", "turnover", 10),
      pnl("cost_of_sales", "Direct Costs", "cost_of_sales", 20),
      pnl("marketing", "Marketing", "overheads", 30),
      pnl("staff_costs", "Payroll & Related", "overheads", 32),
      pnl("property_general", "Property & General Costs", "overheads", 34),
      pnl("it_costs", "IT Costs", "overheads", 36),
      pnl("travel", "Travel and Entertainment", "overheads", 38),
      pnl("professional_fees", "Legal & Professional Fees", "overheads", 50),
      pnl("capitalised_dev", "Capitalised Development", "overheads", 65),
      pnl("impairment", "Impairment", "overheads", 72, "non_cash"),
      pnl("fx", "FX Gains / (Losses)", "overheads", 80),
      pnl("penalties_fines", "Penalties and Fines", "overheads", 82),
      pnl("other_income", "Other Income", "finance", 90),
      pnl("interest_payable", "Interest", "finance", 100),
      pnl("taxation", "Taxes", "taxation", 110),
    ],
    sublines: {
      turnover: ["Performance Surface", "Ticketing", "PPV", "Media Rights", "Title Sponsorship", "App Subscription",
        "Event level sponsorship", "Betting Income"],
      other_income: ["Interest Income"],
      cost_of_sales: ["Direct Costs - Other", "Direct Costs - Performance Surface"],
      staff_costs: ["Direct Wages", "Contractors", "Salaries", "Directors' Remuneration", "Employers National Insurance",
        "Staff Training", "Pensions Costs", "Medical Insurance", "Sales Commission", "Recruitment", "Bonuses",
        "Intercompany payroll recharge"],
      marketing: ["Advertising", "Investor Event", "PR Fees", "Other Marketing Costs", "Marketing Agency Fees",
        "Brand Ambassador Fees", "Trade shows & events", "Sponsorship", "Merchandise & supplies", "Customer Incentives"],
      professional_fees: ["Audit & Accountancy Fees", "Consulting", "Legal Expenses"],
      property_general: ["Bank Fees", "Office Expenses", "Donations", "Postage, Freight & Courier", "General Expenses",
        "Insurance", "Utilities", "Rent & Rates", "Printing & Stationery", "Telephone & Internet",
        "Premises - Storage & warehousing"],
      travel: ["Entertainment - business", "Entertainment - non-deductible", "Motor Vehicle Expenses",
        "Meals & subsistence", "Travel - National", "Travel - International", "Airfares", "Rail",
        "Taxi, car hire & parking", "Accommodation", "Travel - EV Charging"],
      it_costs: ["Website", "Software & Subscriptions", "Consumables", "Hosting & Infrastructure",
        "Hardware & Equipment - below threshold"],
    },
    // Rounding is left out: in Xero it is a balance sheet account and stays
    // under retained earnings, as the master's BS Mapping says (CFO 18 Nov 2026).
    headings: {
      "Revenue": "turnover",
      "Other Income": "other_income",
      "Direct Costs": "cost_of_sales",
      "Payroll & Related": "staff_costs",
      "Marketing": "marketing",
      "Legal & Professional Fees": "professional_fees",
      "Property & General Costs": "property_general",
      "Depreciation": "depreciation",
      "Amortisation": "depreciation",
      "Travel and Entertainment": "travel",
      "IT Costs": "it_costs",
      "Interest": "interest_payable",
      "FX Gains / (Losses)": "fx",
      "Impairment": "impairment",
      "Taxes": "taxation",
      "Capitalised Development": "capitalised_dev",
      "Penalties and Fines": "penalties_fines",
    },
    // The 10 Nov master's BS Mapping, as applied on 18 Nov 2026.
    bsHeadings: {
      "Cash": "cash",
      "Trade Debtors": "debtors",
      "Other Debtors": "debtors",
      "Prepayments": "debtors",
      "Deposits": "debtors",
      "Inter Company Debtor": "debtors",
      "VAT Debtor": "debtors",
      "Inventory": "stock",
      "Internally Developed Intellectual Property": "intangible_assets",
      "Patents and Trademarks": "intangible_assets",
      "Software": "intangible_assets",
      "Computer Equipment": "tangible_assets",
      "Buildings": "tangible_assets",
      "Leasehold Improvements": "tangible_assets",
      "Motor Vehicle": "tangible_assets",
      "Office Equipment": "tangible_assets",
      "Plant and Machinery": "tangible_assets",
      "Performance Surface Assets": "tangible_assets",
      "Trade Creditors": "creditors_lt1y",
      "Accruals": "creditors_lt1y",
      "Deferred Income": "creditors_lt1y",
      "Net Wages Payable": "creditors_lt1y",
      "PAYE/NI": "creditors_lt1y",
      "Inter Company Creditor": ["creditors_lt1y", "debtors"],
      "Provisions": ["creditors_lt1y", "provisions"],
      "Loan Notes": ["creditors_gt1y", "creditors_lt1y"],
      "Deferred Tax": "provisions",
      "Share Capital": "share_capital",
      "Retained Earnings": "retained_earnings",
      "Current Year Earnings": "retained_earnings",
    },
  },
};

const DEFAULT_TEMPLATE = "standard_management";
const TEMPLATE_KEYS = Object.keys(TEMPLATES);

function templateOf(key) {
  return TEMPLATES[key] || TEMPLATES[DEFAULT_TEMPLATE];
}

// The template's categories as reporting_categories rows, so effectiveCategories
// can layer them between the standard set and the client's own rows.
function templateRows(key) {
  return templateOf(key).categories.map((c) => ({
    client_id: null,
    template: true,
    key: c.key,
    label: c.label,
    statement: c.statement,
    section: c.section,
    sort_order: c.sortOrder,
    cash_flow: c.cashFlow,
    active: c.active,
  }));
}

// What the pack engine needs to draw the P&L.
function layoutOf(key) {
  const t = templateOf(key);
  return { template: t.key, name: t.name, version: t.version, ebitda: t.ebitda, labels: { ...t.labels },
    belowEbitda: t.belowEbitda ?? null, sublineOrder: t.sublines };
}

// A master file heading -> category key, or null. Case and spacing do not matter.
const normHeading = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
function categoryForHeading(key, heading) {
  const want = normHeading(heading);
  if (!want) return null;
  const hit = Object.entries(templateOf(key).headings).find(([h]) => normHeading(h) === want);
  return hit ? hit[1] : null;
}

// The lines a master heading allows, first the default; [] when the template
// does not know the heading. statement: "pnl" reads headings, "bs" bsHeadings.
function categoriesForHeading(key, statement, heading) {
  const want = normHeading(heading);
  if (!want) return [];
  const map = statement === "bs" ? templateOf(key).bsHeadings || {} : templateOf(key).headings;
  const hit = Object.entries(map).find(([h]) => normHeading(h) === want);
  if (!hit) return [];
  return Array.isArray(hit[1]) ? [...hit[1]] : [hit[1]];
}

// For the Settings picker.
function templateList() {
  return TEMPLATE_KEYS.map((k) => {
    const t = TEMPLATES[k];
    return { key: t.key, name: t.name, description: t.description, version: t.version, ebitda: t.ebitda };
  });
}

module.exports = {
  TEMPLATES, TEMPLATE_KEYS, DEFAULT_TEMPLATE, SUBTOTALS,
  templateOf, templateRows, layoutOf, categoryForHeading, categoriesForHeading, templateList,
};

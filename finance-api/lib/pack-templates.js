// Management pack templates (part 2 of docs/management-pack-templates-plan.md,
// CFO 18 Nov 2026): a named P&L layout, kept here in code and versioned with it.
//
// A template gives:
//   categories  P&L lines it adds or renames on top of the standard set
//               (migration 017). Same shape as a reporting_categories row.
//   sublines    each category's sub-lines, in the order the pack draws them.
//               A sub-line not listed here draws after the listed ones, in
//               account code order, as before.
//   ebitda      whether the pack shows Management EBITDA (cash overheads, the
//               subtotal, then depreciation and amortisation below it). Off:
//               every overhead in category order, then operating profit.
//   labels      the subtotal labels.
//   headings    a master file's P&L Mapping 1 words -> category key, so a
//               master file can be read (part 3). A heading not here is shown
//               as having no category, never guessed.
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
  },

  // From the Feldspar master (Master Mapping with Raise Buckets, 10 Nov 2026)
  // and the categories applied from it on 18 Nov 2026.
  feldspar_management: {
    key: "feldspar_management",
    name: "Feldspar management",
    description: "Feldspar's management layout: Marketing, Payroll & Related, Property & General, IT, Travel & Entertainment, Legal & Professional, Capitalised Development, then Management EBITDA.",
    version: 1,
    ebitda: true,
    labels: { ...STANDARD_LABELS },
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
        "Taxi, car hire & parking", "Accommodation"],
      it_costs: ["Website", "Software & Subscriptions", "Consumables", "Hosting & Infrastructure",
        "Hardware & Equipment - below threshold"],
    },
    // Rounding and Impairment are left out on purpose: no Feldspar account was
    // given a category for them on 18 Nov, so a master file's rows under them
    // show as having no category until the CFO decides.
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
      "Taxes": "taxation",
      "Capitalised Development": "capitalised_dev",
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
  return { template: t.key, name: t.name, version: t.version, ebitda: t.ebitda, labels: { ...t.labels }, sublineOrder: t.sublines };
}

// A master file heading -> category key, or null. Case and spacing do not matter.
const normHeading = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
function categoryForHeading(key, heading) {
  const want = normHeading(heading);
  if (!want) return null;
  const hit = Object.entries(templateOf(key).headings).find(([h]) => normHeading(h) === want);
  return hit ? hit[1] : null;
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
  templateOf, templateRows, layoutOf, categoryForHeading, templateList,
};

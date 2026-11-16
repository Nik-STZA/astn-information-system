// The asset register's groupings (docs/asset-register-spec.md section 3), as
// data. A grouping is a kind of asset with its own lifecycle, fields, policy
// template and proof. Defined once here, like the lines in bs-matrix.js, and
// switched on per client by the CFO (finance.asset_groupings_client, 049).
//
// Templates are keyed by grouping and reporting framework. The framework is
// read from finance.entities.reporting_framework, never stored by the
// register. A company whose framework has no template is refused with the
// reason, never given another framework's rules (decision 21: refuse to guess).
//
// Later groupings (goodwill, software_purchased, ppe_standard) are added here
// with no change to the tables.

// The register's templates. 'FRS 102 Section 1A' has FRS 102's recognition and
// measurement, so it uses that template. Everything else is refused.
const TEMPLATE_OF_FRAMEWORK = {
  "FRS 102": "FRS 102",
  "FRS 102 Section 1A": "FRS 102",
  IFRS: "IFRS",
};

const FRAMEWORK_REFUSALS = {
  "FRS 105": "FRS 105 does not allow development costs or internally generated intangibles to be capitalised, so the register has no template for it.",
  "IFRS for SMEs": "IFRS for SMEs differs from full IFRS on intangibles (all have a finite life) and has no template yet.",
  "US GAAP": "US GAAP has no template in the register.",
  Other: "The company's reporting standard is 'Other', so the register cannot choose its rules.",
};

// Statuses each grouping's assets move through.
const LIFECYCLES = {
  dev_project: ["research", "wip", "available", "impaired", "disposed"],
  software_internal: ["wip", "available", "impaired", "disposed"],
  ip_registered: ["pending", "registered", "lapsed", "impaired", "disposed"],
  tangible_build: ["wip", "available", "disposed"],
};

const COMMON_PROOF = [
  { key: "tb_foots", text: "The trial balance for the month foots and its account totals equal Xero's own report" },
  { key: "ties", text: "The register ties to the ledger per company and account, within the client's tolerance" },
  { key: "slices_sum", text: "Every source line's slices sum to its net amount" },
  { key: "allocated", text: "No unallocated cost line older than the month, unless it carries a question" },
  { key: "expected_charge", text: "The expected charge equals the ledger movement on the accumulated account" },
  { key: "accounts_owned", text: "Every asset account on the line is owned by an enabled grouping, by Xero's register, or listed as outside any register" },
];

const GROUPINGS = {
  dev_project: {
    key: "dev_project",
    name: "Developed intangible, project WIP",
    line: "intangible",
    roles: ["cost", "wip", "accumulated", "charge", "impairment"],
    fields: ["proposal_no", "phase", "phase_name", "work_description", "rd_milestone"],
    splits: ["phase", "percentage", "tangible_inventory"],
    proof: [
      { key: "criteria", text: "The six recognition criteria assessed per project, dated" },
      { key: "rd_split", text: "Research and development split recorded on each cost line" },
      { key: "no_charge_before_live", text: "No amortisation without a signed available-for-use date" },
    ],
    evidence: ["Criteria memo per project", "CFO available-for-use sign-off with evidence (capable of operating, not just commissioned)"],
    templates: {
      "FRS 102": {
        refs: ["FRS 102 s18.8H", "FRS 102 s18.8K"], life_kind: "finite", life_months: null,
        start_trigger: "available_for_use", start_convention: null,
        notes: "Capitalising development cost that meets the criteria is a policy choice (s18.8K), applied consistently; the client's election is recorded on the policy. Life is always finite; no more than 10 years if it cannot be estimated reliably (s18.19-18.20).",
      },
      IFRS: {
        refs: ["IAS 38.57", "IAS 36.10"], life_kind: "finite", life_months: null,
        start_trigger: "available_for_use", start_convention: null,
        notes: "Development cost meeting IAS 38.57 must be capitalised: cost expensed on a project whose criteria are met is a finding. WIP not yet available for use is tested for impairment annually (IAS 36.10).",
        extra_proof: ["annual_impairment_test", "borrowing_costs", "year_end_life_review"],
      },
    },
  },
  software_internal: {
    key: "software_internal",
    name: "Internal staff time capitalised",
    line: "intangible",
    roles: ["cost", "wip", "accumulated", "charge", "capitalisation_credit"],
    fields: ["work_description", "item"],
    splits: ["percentage"],
    proof: [
      { key: "time_split_ties", text: "The monthly time split ties to the capitalisation credit account" },
      { key: "split_2dp", text: "Split rows at 2dp" },
      { key: "no_tangible_memo", text: "No tangible memo layer reaches the software accounts" },
    ],
    evidence: ["Time attestation for the month, reviewed by someone other than the person who attests"],
    templates: {
      "FRS 102": {
        refs: ["FRS 102 s18.8H", "FRS 102 s18.8K"], life_kind: "finite", life_months: null,
        start_trigger: "available_for_use", start_convention: null, notes: "As dev_project.",
      },
      IFRS: {
        refs: ["IAS 38.57", "IAS 36.10"], life_kind: "finite", life_months: null,
        start_trigger: "available_for_use", start_convention: null, notes: "As dev_project.",
        extra_proof: ["annual_impairment_test", "year_end_life_review"],
      },
    },
  },
  ip_registered: {
    key: "ip_registered",
    name: "Patents, trade marks, designs, domains",
    line: "intangible",
    roles: ["cost", "wip", "accumulated", "charge", "impairment"],
    fields: ["jurisdiction", "cost_per_country", "ipo_status"],
    splits: ["country"],
    // The basis differs by IP class, so each class cites its own.
    classes: {
      trade_mark: { treatment: "capitalise", refs: ["FRS 102 s18.4", "FRS 102 s18.8C", "IAS 38.63"],
        reason: "Filing and registration fees paid to an attorney or office are the cost of a separately acquired legal right, not of the brand, which is never recognised." },
      patent: { treatment: "capitalise", refs: ["FRS 102 s18.8H"],
        reason: "Patent drafting and prosecution follow the development criteria." },
      search: { treatment: "expense_research", refs: ["FRS 102 s18.8E"],
        reason: "Searches and landscaping are research and are expensed." },
      domain: { treatment: "capitalise", refs: ["FRS 102 s18.4"], reason: "A separately acquired right." },
    },
    proof: [
      { key: "class_matches_status", text: "Account class matches IPO status (pending against registered)" },
      { key: "dates_held", text: "Renewal and expiry dates held" },
      { key: "office_action_before_registration", text: "Office-action costs only before registration" },
      { key: "recharge_both_sides", text: "Intercompany recharge raised on both sides where billed and owning company differ" },
    ],
    evidence: ["IPO record link per asset", "Status sweep date"],
    templates: {
      "FRS 102": { refs: ["FRS 102 s18.4", "FRS 102 s18.19"], life_kind: "finite", life_months: null, start_trigger: "registration", start_convention: null, notes: "" },
      IFRS: { refs: ["IAS 38", "IAS 38.88"], life_kind: "finite", life_months: null, start_trigger: "registration", start_convention: null,
        notes: "A trade mark may have an indefinite life under IFRS: not amortised, tested annually.", allows_indefinite: true, extra_proof: ["year_end_life_review"] },
    },
  },
  tangible_build: {
    key: "tangible_build",
    name: "Self-constructed tangible asset with WIP",
    line: "ppe",
    roles: ["cost", "wip", "accumulated", "charge"],
    fields: ["item", "item_type"],
    splits: ["tangible_inventory", "percentage"],
    proof: [
      { key: "quantity_location", text: "Quantity and location held" },
      { key: "surplus_split", text: "Surplus split between asset and inventory recorded, or carried as a named item" },
      { key: "accounts_exist", text: "Completed-asset accounts exist before a transfer" },
    ],
    evidence: ["Installation and condition evidence", "Physical check annually"],
    templates: {
      "FRS 102": { refs: ["FRS 102 s17"], life_kind: "finite", life_months: null, start_trigger: "available_for_use", start_convention: null, notes: "" },
      IFRS: { refs: ["IAS 16", "IAS 16.51", "IAS 23"], life_kind: "finite", life_months: null, start_trigger: "available_for_use", start_convention: null,
        notes: "", extra_proof: ["borrowing_costs", "year_end_life_review"] },
    },
  },
};

const isGrouping = (k) => Object.prototype.hasOwnProperty.call(GROUPINGS, k);

// The template a company uses for a grouping, from its reporting framework.
// { template, framework } or { refused: reason }.
function templateFor(groupingKey, reportingFramework) {
  if (!isGrouping(groupingKey)) return { refused: `No grouping ${groupingKey} in the register.` };
  const fw = reportingFramework ? String(reportingFramework) : "";
  if (!fw) return { refused: "The company has no reporting standard set on its profile, so the register cannot choose its rules." };
  const framework = TEMPLATE_OF_FRAMEWORK[fw];
  if (!framework) return { refused: FRAMEWORK_REFUSALS[fw] ?? `The register has no template for ${fw}.` };
  const template = GROUPINGS[groupingKey].templates[framework];
  if (!template) return { refused: `The ${GROUPINGS[groupingKey].name} grouping has no ${framework} template.` };
  return { framework, template };
}

// Switching a grouping on for a client's companies: refused for any company
// without a template, with the reason. companies: [{ name, reporting_framework }].
function enableIssues(groupingKey, companies) {
  if (!isGrouping(groupingKey)) return [`No grouping ${groupingKey} in the register.`];
  return (companies || []).flatMap((c) => {
    const t = templateFor(groupingKey, c.reporting_framework);
    return t.refused ? [`${c.name}: ${t.refused}`] : [];
  });
}

// The grouping expects its accounts on one matrix line; the CFO places each
// account on the Reconciliations page (rec_accounts.line_key). A different
// placement is reported, never assumed either way.
function placementIssue(groupingKey, account) {
  const g = GROUPINGS[groupingKey];
  if (!g) return null;
  if (!account?.line_key) return `${account?.name ?? "An account"} is not placed on a balance sheet line; the ${g.name} grouping expects it on ${g.line}.`;
  if (account.line_key !== g.line) return `${account.name} is placed on ${account.line_key}; the ${g.name} grouping expects ${g.line}.`;
  return null;
}

// Whether a policy is allowed for its template: indefinite life only where the
// template allows it (never FRS 102), and a policy citing another framework
// than its company's is a finding (e.g. a policy tab citing IAS 38 while the
// companies report FRS 102).
function policyIssues(groupingKey, policy, reportingFramework) {
  const t = templateFor(groupingKey, reportingFramework);
  if (t.refused) return { issues: [t.refused], findings: [] };
  const issues = [];
  const findings = [];
  if (policy.life_kind === "indefinite" && !t.template.allows_indefinite) {
    issues.push(`An indefinite life is not allowed under ${t.framework} for this grouping.`);
  }
  if (policy.life_kind !== "indefinite" && !(Number.isInteger(policy.life_months) && policy.life_months > 0)) {
    issues.push("A finite life needs a whole number of months.");
  }
  if (t.framework === "FRS 102" && policy.life_months > 120 && policy.life_reliable !== true) {
    findings.push("A life over 120 months under FRS 102 needs the life to be reliably estimable (s18.20); record why.");
  }
  const cited = (policy.standard_refs || []).map(String);
  const other = t.framework === "FRS 102" ? /\b(IAS|IFRS)\b/ : /\bFRS 102\b/;
  if (cited.some((r) => other.test(r))) findings.push(`The policy cites ${cited.filter((r) => other.test(r)).join(", ")} while the company reports under ${t.framework}.`);
  return { issues, findings };
}

module.exports = { GROUPINGS, LIFECYCLES, COMMON_PROOF, TEMPLATE_OF_FRAMEWORK, isGrouping, templateFor, enableIssues, placementIssue, policyIssues };

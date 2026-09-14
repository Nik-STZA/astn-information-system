// Account mapping: which reporting category each Xero account belongs to.
//
// The pack engine renders every account under a category (Staff costs,
// Debtors...). A person approves those in the portal's Chart of accounts tab;
// the engine reads what was approved (GET .../account-mapping). Anything not
// yet saved is offered a proposal by the same rules the engine falls back on,
// so the portal and the engine never disagree about a suggestion. The shared
// cases in pack-engine/tests/mapping_rule_cases.json keep the two in step.
//
// Categories (migration 017): the standard set, which a client can rename,
// reorder or switch off, plus categories that client alone has. Sections are
// fixed, because they are the statement structure the engine renders.

const PNL_SECTIONS = ["turnover", "cost_of_sales", "overheads", "finance", "taxation"];
const BS_SECTIONS = ["fixed_assets", "current_assets", "creditors_lt1y", "creditors_gt1y", "provisions", "equity"];

// Where a balance sheet category's movement goes on the indirect cash flow.
const BS_CASH_FLOWS = [
  "cash", "working_capital", "provisions", "tax", "capex",
  "investments", "loans", "equity", "dividends", "retained_earnings",
];
// The engine's cash and retained earnings lines are single categories.
const RESERVED_CASH_FLOWS = { cash: "cash", retained_earnings: "retained_earnings" };
// What one account may override its category's cash flow with.
const ACCOUNT_CASH_FLOWS = BS_CASH_FLOWS.filter((c) => !RESERVED_CASH_FLOWS[c]);

const PNL_CLASSES = new Set(["REVENUE", "EXPENSE"]);

// ── Rules (a port of pack-engine/pack_engine/mapping.py propose) ──────────────

const STANDARD_STATEMENT = {
  turnover: "pnl", cost_of_sales: "pnl", staff_costs: "pnl", establishment: "pnl",
  professional_fees: "pnl", administrative: "pnl", depreciation: "pnl", fx: "pnl",
  other_income: "pnl", interest_payable: "pnl", taxation: "pnl",
  intangible_assets: "bs", tangible_assets: "bs", investments: "bs", stock: "bs",
  debtors: "bs", cash: "bs", creditors_lt1y: "bs", creditors_gt1y: "bs", provisions: "bs",
  share_capital: "bs", retained_earnings: "bs", other_reserves: "bs",
};

const REPORTING_CODE_RULES = {
  "REV.INV": "other_income", "REV.OTH": "other_income", REV: "turnover",
  "EXP.COS": "cost_of_sales",
  "EXP.STF": "staff_costs",
  "EXP.EST": "establishment",
  "EXP.ADM.FEE": "professional_fees",
  "EXP.ADM.FOR": "fx",
  "EXP.ADM": "administrative",
  "EXP.DEP": "depreciation", "EXP.AMO": "depreciation",
  "EXP.INT": "interest_payable",
  "EXP.TAX": "taxation",
  "ASS.NCA.INT": "intangible_assets", "ASS.NCA.FIX": "tangible_assets",
  "ASS.NCA.INV": "investments",
  "ASS.CUR.STO": "stock", "ASS.CUR.REC": "debtors", "ASS.CUR.BAN": "cash",
  "ASS.CUR": "debtors",
  "LIA.CUR": "creditors_lt1y", "LIA.NCL": "creditors_gt1y", "LIA.PRO": "provisions",
  "EQU.SHA": "share_capital", "EQU.RET": "retained_earnings", EQU: "other_reserves",
};

const TYPE_RULES = {
  REVENUE: "turnover", SALES: "turnover", OTHERINCOME: "other_income",
  DIRECTCOSTS: "cost_of_sales", OVERHEADS: "administrative", EXPENSE: "administrative",
  DEPRECIATN: "depreciation",
  CURRENT: "debtors", PREPAYMENT: "debtors", INVENTORY: "stock",
  FIXED: "tangible_assets", NONCURRENT: "investments",
  CURRLIAB: "creditors_lt1y", TERMLIAB: "creditors_gt1y", LIABILITY: "creditors_lt1y",
  EQUITY: "other_reserves",
};

const STAFF_CODE_RANGE = [477, 484];

function statementOfClass(klass) {
  return PNL_CLASSES.has(String(klass || "").toUpperCase()) ? "pnl" : "bs";
}

function ruleProposal(a) {
  const type = String(a.Type || "").toUpperCase();
  const klass = String(a.Class || "").toUpperCase();
  if (type === "BANK") return { category: "cash", reason: "Xero account type BANK" };

  const rc = String(a.ReportingCode || "").trim().toUpperCase();
  if (rc) {
    const parts = rc.split(".");
    for (let n = parts.length; n > 1; n--) {
      const cat = REPORTING_CODE_RULES[parts.slice(0, n).join(".")];
      if (cat) return { category: cat, reason: `reporting code ${rc}` };
    }
  }

  const num = /^\s*\d+\s*$/.test(String(a.Code ?? "")) ? Number(a.Code) : null;
  if (klass === "EXPENSE" && num !== null && num >= STAFF_CODE_RANGE[0] && num <= STAFF_CODE_RANGE[1]) {
    return {
      category: "staff_costs",
      reason: `code ${num} is in the UK payroll range ${STAFF_CODE_RANGE[0]}-${STAFF_CODE_RANGE[1]} (reporting code ${rc || "none"} is too broad)`,
    };
  }

  if (klass === "ASSET" && type === "NONCURRENT" && String(a.Name || "").toLowerCase().includes("invest")) {
    return { category: "investments", reason: "non-current asset named as an investment" };
  }

  const statement = statementOfClass(klass);
  const byType = TYPE_RULES[type];
  if (byType && STANDARD_STATEMENT[byType] === statement) {
    return { category: byType, reason: `Xero account type ${type}` };
  }
  const broad = REPORTING_CODE_RULES[rc];
  if (broad && STANDARD_STATEMENT[broad] === statement) {
    return { category: broad, reason: `reporting code ${rc} (broad)` };
  }
  return { category: null, reason: `no rule for type ${type || "none"}, reporting code ${rc || "none"}` };
}

// A proposal for a Xero account, or { category: null } when no rule applies.
// `categories` (effective, by key) drops a proposal the client has switched off.
function proposeCategory(account, categories = null) {
  const p = ruleProposal(account);
  if (!p.category) return p;
  const statement = statementOfClass(account.Class);
  if (STANDARD_STATEMENT[p.category] !== statement) {
    return { category: null, reason: `${p.reason} puts a ${account.Class} account on the wrong statement` };
  }
  if (categories) {
    const c = categories.get(p.category);
    if (!c || !c.active) return { category: null, reason: `${p.reason}, but ${p.category} is switched off for this client` };
  }
  return p;
}

// ── Categories ────────────────────────────────────────────────────────────────

function categoryFromRow(r, scope) {
  return {
    key: r.key,
    label: r.label,
    statement: r.statement,
    section: r.section,
    sortOrder: r.sort_order,
    cashFlow: r.cash_flow ?? null,
    active: r.active !== false,
    scope,
  };
}

// Standard rows (client_id null) overlaid with the client's own rows.
function effectiveCategories(rows) {
  const out = new Map();
  for (const r of rows.filter((r) => !r.client_id)) out.set(r.key, categoryFromRow(r, "standard"));
  for (const r of rows.filter((r) => r.client_id)) {
    out.set(r.key, categoryFromRow(r, out.has(r.key) ? "override" : "client"));
  }
  return new Map(
    [...out.entries()].sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0]))
  );
}

// Validates a create or edit of one category for a client. `current` is the
// effective category of that key, if any; `inUse` counts accounts mapped to it.
function validateCategory(key, input, { current = null, standard = null, inUse = 0 } = {}) {
  const errors = [];
  if (!/^[a-z][a-z0-9_]{1,48}$/.test(key || "")) {
    errors.push("key must be lower case letters, digits and underscores, starting with a letter");
  }
  const next = {
    label: String(input.label ?? current?.label ?? "").trim(),
    statement: input.statement ?? current?.statement,
    section: input.section ?? current?.section,
    sortOrder: input.sortOrder ?? current?.sortOrder,
    cashFlow: input.cashFlow !== undefined ? input.cashFlow : current?.cashFlow ?? null,
    active: input.active ?? current?.active ?? true,
  };
  if (!next.label) errors.push("label is required");
  if (!["pnl", "bs"].includes(next.statement)) errors.push("statement must be pnl or bs");
  const sections = next.statement === "pnl" ? PNL_SECTIONS : BS_SECTIONS;
  if (!sections.includes(next.section)) errors.push(`section must be one of ${sections.join(", ")}`);
  if (!Number.isInteger(next.sortOrder)) errors.push("sortOrder must be a whole number");
  if (next.statement === "pnl" && next.cashFlow !== null && next.cashFlow !== "non_cash") {
    errors.push("a profit and loss category's cash flow is either none or non_cash");
  }
  if (next.statement === "bs" && !BS_CASH_FLOWS.includes(next.cashFlow)) {
    errors.push(`a balance sheet category needs a cash flow class: ${BS_CASH_FLOWS.join(", ")}`);
  }
  // The engine's cash and retained earnings lines are the standard categories.
  for (const [reservedKey, flow] of Object.entries(RESERVED_CASH_FLOWS)) {
    if (next.cashFlow === flow && key !== reservedKey) {
      errors.push(`only the ${reservedKey} category can use the ${flow} cash flow class`);
    }
    if (key === reservedKey) {
      if (next.cashFlow !== flow || next.statement !== "bs") errors.push(`${reservedKey} must stay a balance sheet ${flow} category`);
      if (!next.active) errors.push(`${reservedKey} cannot be switched off`);
    }
  }
  if (standard) {
    if (next.statement !== standard.statement) errors.push("a standard category cannot move between statements");
  }
  if (current && inUse > 0) {
    if (next.statement !== current.statement) errors.push(`${inUse} account(s) are mapped to ${key}; it cannot move statement`);
    if (!next.active) errors.push(`${inUse} account(s) are mapped to ${key}; remap them before switching it off`);
  }
  return { errors, value: next };
}

// ── Mapping changes ───────────────────────────────────────────────────────────

const SOURCES = ["manual", "upload", "rule", "agent"];

// Turns a request's changes into rows to write, or errors. Nothing is written
// when any change is invalid, so an upload lands whole or not at all.
//
//   change: { accountId, category?, cashFlow?, approve? }
//     category omitted: keep the saved one, else take the rule proposal
//     cashFlow  omitted: keep the saved one; null clears it
//     approve   true approves; anything else saves as proposed
function planMappingChanges({ changes, accounts, categories, stored, source = "manual", note = null }) {
  const errors = [];
  const writes = [];
  if (!Array.isArray(changes) || !changes.length) return { errors: ["changes must be a non-empty list"], writes };
  if (!SOURCES.includes(source)) return { errors: [`source must be one of ${SOURCES.join(", ")}`], writes };

  const byId = new Map(accounts.map((a) => [a.AccountID, a]));
  const seen = new Set();
  changes.forEach((ch, i) => {
    const at = `change ${i + 1}`;
    const account = byId.get(ch?.accountId);
    if (!account) return errors.push(`${at}: account ${ch?.accountId ?? "(none)"} is not in this entity's Xero chart of accounts`);
    const label = account.Code ? `${account.Code} ${account.Name}` : account.Name;
    if (seen.has(account.AccountID)) return errors.push(`${label}: appears more than once`);
    seen.add(account.AccountID);

    const saved = stored.get(account.AccountID) || null;
    const statement = statementOfClass(account.Class);
    let category = ch.category ?? null;
    let reason;
    let from = source;
    if (category && saved && saved.category_key === category) {
      reason = saved.reason;         // re-sending the saved category, e.g. to approve it
      from = saved.source;
    } else if (category) {
      reason = source === "upload" ? `uploaded${note ? ` from ${note}` : ""}` : source === "agent" ? note || "proposed by an agent" : "set in the portal";
    } else if (saved) {
      category = saved.category_key;
      reason = saved.reason;
      from = saved.source;
    } else {
      const p = proposeCategory(account, categories);
      if (!p.category) return errors.push(`${label}: no category given and ${p.reason}`);
      category = p.category;
      reason = p.reason;
      from = "rule";
    }

    const cat = categories.get(category);
    if (!cat) return errors.push(`${label}: unknown category ${category}`);
    if (!cat.active) return errors.push(`${label}: ${cat.label} is switched off for this client`);
    if (cat.statement !== statement) {
      return errors.push(`${label}: ${cat.label} is a ${cat.statement === "pnl" ? "profit and loss" : "balance sheet"} category but this is a ${account.Class} account`);
    }

    let cashFlow = ch.cashFlow !== undefined ? ch.cashFlow : saved?.cash_flow ?? null;
    if (cashFlow === "") cashFlow = null;
    if (cashFlow !== null) {
      if (statement !== "bs") return errors.push(`${label}: only balance sheet accounts take a cash flow override`);
      if (!ACCOUNT_CASH_FLOWS.includes(cashFlow)) {
        return errors.push(`${label}: cash flow must be one of ${ACCOUNT_CASH_FLOWS.join(", ")}`);
      }
    }

    writes.push({
      accountId: account.AccountID,
      code: account.Code ?? null,
      name: account.Name ?? "",
      klass: account.Class ?? "",
      category,
      cashFlow,
      status: ch.approve === true ? "approved" : "proposed",
      source: from,
      reason,
      before: saved
        ? { category: saved.category_key, status: saved.status, cashFlow: saved.cash_flow ?? null }
        : null,
    });
  });
  return { errors, writes };
}

// The Chart of accounts tab's rows: every Xero account with what is saved, a
// proposal where nothing is, and anything that needs a person's eye.
function accountRows({ accounts, stored, categories }) {
  const rows = accounts.map((a) => {
    const saved = stored.get(a.AccountID) || null;
    const statement = statementOfClass(a.Class);
    const flags = [];
    if (saved) {
      const cat = categories.get(saved.category_key);
      if (!cat) flags.push("unknown_category");
      else if (!cat.active) flags.push("category_switched_off");
      else if (cat.statement !== statement) flags.push("wrong_statement");
      if ((saved.account_code ?? null) !== (a.Code ?? null) || saved.account_name !== a.Name) flags.push("renamed_in_xero");
    }
    return {
      accountId: a.AccountID,
      code: a.Code ?? null,
      name: a.Name ?? "",
      class: a.Class ?? "",
      type: a.Type ?? "",
      reportingCode: a.ReportingCode ?? null,
      xeroStatus: a.Status ?? "ACTIVE",
      statement,
      mapping: saved
        ? {
            category: saved.category_key,
            cashFlow: saved.cash_flow ?? null,
            status: saved.status,
            source: saved.source,
            reason: saved.reason,
            proposedBy: saved.proposed_by_email,
            proposedAt: saved.proposed_at,
            approvedBy: saved.approved_by_email,
            approvedAt: saved.approved_at,
            savedCode: saved.account_code,
            savedName: saved.account_name,
          }
        : null,
      proposal: saved ? null : proposeCategory(a, categories),
      flags,
    };
  });
  rows.sort((x, y) => String(x.code ?? "~").localeCompare(String(y.code ?? "~"), "en", { numeric: true }) || x.name.localeCompare(y.name));
  const ids = new Set(accounts.map((a) => a.AccountID));
  const orphans = [...stored.values()]
    .filter((s) => !ids.has(s.xero_account_id))
    .map((s) => ({ accountId: s.xero_account_id, code: s.account_code, name: s.account_name, category: s.category_key, status: s.status }));
  return { rows, orphans };
}

module.exports = {
  PNL_SECTIONS,
  BS_SECTIONS,
  BS_CASH_FLOWS,
  ACCOUNT_CASH_FLOWS,
  statementOfClass,
  proposeCategory,
  effectiveCategories,
  validateCategory,
  planMappingChanges,
  accountRows,
};

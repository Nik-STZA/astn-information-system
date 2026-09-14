"""Account mapping: which pack category each Xero account belongs to.

Approved in the portal (Chart of accounts tab) and read from finance-api
(GET /clients/:slug/entities/:entity/account-mapping, migration 017). An account
with nothing saved falls back to a rule proposal, and the pack says so: the
"Account mapping approved" control warns until every account is approved.

Categories come from finance-api too: the standard set below, which a client can
rename, reorder or switch off, plus lines only that client has. Sections are
fixed, because they are the statement structure the renderer draws. An older
finance-api with no mapping endpoint gives the standard set and rules only.

Rule order, most specific first:
  1. Xero account type BANK is cash, whatever its reporting code says
     (STZA's NatWest accounts carry the bare code "ASS").
  2. The longest matching prefix of Xero's reporting code (e.g. EXP.STF.WAG).
  3. UK default-chart code ranges where the reporting code is too broad
     (STZA 481 Employer pension and 484 Benefits in kind carry just "EXP").
  4. The Xero account type.
Anything left is a gap, and a gap with activity fails the build. finance-api
ports these rules for the portal's suggestions; tests/mapping_rule_cases.json
keeps the two in step.
"""

from __future__ import annotations

from dataclasses import dataclass

from .ledger import Account


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    statement: str        # "pnl" or "bs"
    section: str
    order: int
    cash_flow: str | None = None   # bs: where its movement goes; pnl: None or "non_cash"
    active: bool = True


PNL_SECTIONS = ("turnover", "cost_of_sales", "overheads", "finance", "taxation")
BS_SECTIONS = ("fixed_assets", "current_assets", "creditors_lt1y", "creditors_gt1y", "provisions", "equity")

# The standard set, in presentation order. Matches the seed in migration 017.
CATEGORIES: list[Category] = [
    # Profit and loss
    Category("turnover",          "Turnover",                              "pnl", "turnover",        10),
    Category("cost_of_sales",     "Cost of sales",                         "pnl", "cost_of_sales",   20),
    Category("staff_costs",       "Staff costs",                           "pnl", "overheads",       30),
    Category("establishment",     "Establishment costs",                   "pnl", "overheads",       40),
    Category("professional_fees", "Legal and professional fees",           "pnl", "overheads",       50),
    Category("administrative",    "Administrative expenses",               "pnl", "overheads",       60),
    Category("depreciation",      "Depreciation and amortisation",         "pnl", "overheads",       70, "non_cash"),
    Category("fx",                "Foreign exchange gains and losses",     "pnl", "overheads",       80),
    Category("other_income",      "Interest receivable and other income",  "pnl", "finance",         90),
    Category("interest_payable",  "Interest payable",                      "pnl", "finance",        100),
    Category("taxation",          "Taxation",                              "pnl", "taxation",       110),
    # Balance sheet
    Category("intangible_assets", "Intangible assets",                     "bs", "fixed_assets",    200, "capex"),
    Category("tangible_assets",   "Tangible assets",                       "bs", "fixed_assets",    210, "capex"),
    Category("investments",       "Investments",                           "bs", "fixed_assets",    220, "investments"),
    Category("stock",             "Stock",                                 "bs", "current_assets",  300, "working_capital"),
    Category("debtors",           "Debtors",                               "bs", "current_assets",  310, "working_capital"),
    Category("cash",              "Cash at bank and in hand",              "bs", "current_assets",  320, "cash"),
    Category("creditors_lt1y",    "Creditors: amounts falling due within one year", "bs", "creditors_lt1y", 400, "working_capital"),
    Category("creditors_gt1y",    "Creditors: amounts falling due after more than one year", "bs", "creditors_gt1y", 410, "loans"),
    Category("provisions",        "Provisions for liabilities",            "bs", "provisions",      420, "provisions"),
    Category("share_capital",     "Called up share capital",               "bs", "equity",          500, "equity"),
    Category("retained_earnings", "Profit and loss account",               "bs", "equity",          510, "retained_earnings"),
    Category("other_reserves",    "Other reserves",                        "bs", "equity",          520, "equity"),
]
BY_KEY = {c.key: c for c in CATEGORIES}


def categories_from_api(rows: list[dict] | None) -> dict[str, Category]:
    """finance-api's effective categories for a client, or the standard set."""
    if not rows:
        return dict(BY_KEY)
    out = {}
    for r in rows:
        sections = PNL_SECTIONS if r["statement"] == "pnl" else BS_SECTIONS
        if r["section"] not in sections:
            raise ValueError(f"category {r['key']} has section {r['section']!r}, which the pack cannot draw")
        out[r["key"]] = Category(r["key"], r["label"], r["statement"], r["section"], int(r["sortOrder"]),
                                 r.get("cashFlow"), bool(r.get("active", True)))
    return dict(sorted(out.items(), key=lambda kv: (kv[1].order, kv[0])))


# Reporting-code prefix -> category. Longest match wins.
REPORTING_CODE_RULES: dict[str, str] = {
    "REV.INV": "other_income", "REV.OTH": "other_income", "REV": "turnover",
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
    "EQU.SHA": "share_capital", "EQU.RET": "retained_earnings", "EQU": "other_reserves",
}

# Xero account type -> category, used when nothing more specific applies.
TYPE_RULES: dict[str, str] = {
    "REVENUE": "turnover", "SALES": "turnover", "OTHERINCOME": "other_income",
    "DIRECTCOSTS": "cost_of_sales", "OVERHEADS": "administrative", "EXPENSE": "administrative",
    "DEPRECIATN": "depreciation",
    "CURRENT": "debtors", "PREPAYMENT": "debtors", "INVENTORY": "stock",
    "FIXED": "tangible_assets", "NONCURRENT": "investments",
    "CURRLIAB": "creditors_lt1y", "TERMLIAB": "creditors_gt1y", "LIABILITY": "creditors_lt1y",
    "EQUITY": "other_reserves",
}

# UK default chart: 477-484 are payroll lines (salaries, NI, pensions, benefits).
STAFF_CODE_RANGE = (477, 484)


@dataclass(frozen=True)
class Mapping:
    account: Account
    category: str | None
    reason: str
    status: str = "rule"            # approved | proposed | rule
    cash_flow: str | None = None    # an approved per-account cash flow override

    @property
    def is_gap(self) -> bool:
        return self.category is None


def _code_number(code: str | None) -> int | None:
    try:
        return int(str(code).strip())
    except (TypeError, ValueError):
        return None


def propose(account: Account) -> Mapping:
    if account.type == "BANK":
        return Mapping(account, "cash", "Xero account type BANK")

    rc = (account.reporting_code or "").strip().upper()
    if rc:
        parts = rc.split(".")
        for n in range(len(parts), 0, -1):
            prefix = ".".join(parts[:n])
            cat = REPORTING_CODE_RULES.get(prefix)
            if cat and n > 1:
                return Mapping(account, cat, f"reporting code {rc}")
            if cat and n == 1:
                break   # a bare class code ("EXP", "ASS") is too broad on its own

    num = _code_number(account.code)
    if account.klass == "EXPENSE" and num is not None and STAFF_CODE_RANGE[0] <= num <= STAFF_CODE_RANGE[1]:
        return Mapping(account, "staff_costs",
                       f"code {num} is in the UK payroll range {STAFF_CODE_RANGE[0]}-{STAFF_CODE_RANGE[1]} "
                       f"(reporting code {rc or 'none'} is too broad)")

    if account.klass == "ASSET" and account.type == "NONCURRENT" and "invest" in account.name.lower():
        return Mapping(account, "investments", "non-current asset named as an investment")

    cat = TYPE_RULES.get(account.type)
    if cat and BY_KEY[cat].statement == ("pnl" if account.is_pnl else "bs"):
        return Mapping(account, cat, f"Xero account type {account.type}")

    if rc in REPORTING_CODE_RULES:
        cat = REPORTING_CODE_RULES[rc]
        if BY_KEY[cat].statement == ("pnl" if account.is_pnl else "bs"):
            return Mapping(account, cat, f"reporting code {rc} (broad)")

    return Mapping(account, None, f"no rule for type {account.type!r}, reporting code {rc or 'none'}")


def _saved(account: Account, s: dict) -> Mapping:
    if s["status"] == "approved":
        when = str(s.get("approvedAt") or "")[:10]
        reason = f"approved by {s.get('approvedBy')}" + (f" on {when}" if when else "")
    else:
        reason = f"saved, not approved ({s.get('source')}: {s.get('reason') or 'no reason given'})"
    return Mapping(account, s["category"], reason, s["status"], s.get("cashFlow"))


def resolve_mapping(accounts: list[Account], categories: dict[str, Category] | None = None,
                    saved: dict[str, dict] | None = None) -> dict[str, Mapping]:
    """account id -> Mapping: the saved mapping where there is one, else a rule
    proposal. A category that does not exist, is switched off, or sits on the
    wrong statement for the account is a gap."""
    cats = categories or BY_KEY
    saved = saved or {}
    out = {}
    for a in accounts:
        m = _saved(a, saved[a.id]) if a.id in saved else propose(a)
        statement = "pnl" if a.is_pnl else "bs"
        cat = cats.get(m.category) if m.category else None
        if m.category and cat is None:
            m = Mapping(a, None, f"{m.reason}, but category {m.category} does not exist", m.status)
        elif cat and not cat.active:
            m = Mapping(a, None, f"{m.reason}, but {cat.label} is switched off for this client", m.status)
        elif cat and cat.statement != statement:
            m = Mapping(a, None, f"{m.reason} puts a {a.klass} account on the wrong statement", m.status)
        out[a.id] = m
    return out


# --- Cash flow ------------------------------------------------------------------
# Each balance sheet account's movement lands in one place on the indirect cash
# flow: its category's class, unless the account has its own approved override.
# Creditors and debtors mix working capital with tax, dividends and loans, so
# without an override those are recognised by reporting code and name.
CASH_FLOW_CLASSES = ("cash", "working_capital", "provisions", "tax", "capex",
                     "investments", "loans", "equity", "dividends", "retained_earnings")


def cash_flow_class(account: Account, category: str, categories: dict[str, Category] | None = None,
                    override: str | None = None) -> str:
    cat = (categories or BY_KEY)[category]
    if override:
        return override
    rc = (account.reporting_code or "").upper()
    name = account.name.lower()
    if cat.section in ("current_assets", "creditors_lt1y", "creditors_gt1y") and cat.cash_flow in ("working_capital", "loans"):
        if rc.startswith(("LIA.CUR.TAX.COR", "LIA.NCL.TAX.COR", "ASS.CUR.REC.TAX.COR")) or "corporation tax" in name:
            return "tax"
        if "dividend" in name or rc.startswith("LIA.CUR.DIV"):
            return "dividends"
        if rc.startswith(("LIA.CUR.LOA", "LIA.NCL.LOA")) or "loan" in name:
            return "loans"
    if cat.cash_flow not in CASH_FLOW_CLASSES:
        raise ValueError(f"category {category} has no cash flow class")
    return cat.cash_flow

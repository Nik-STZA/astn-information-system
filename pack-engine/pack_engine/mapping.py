"""Account mapping: which pack category each Xero account belongs to.

v1 proposes mappings by rule from Xero's own account metadata, recording why.
The design (11 Sep 2026) moves the resolved mapping into finance-api with CFO
approval; `resolve_mapping` is the seam where that will plug in, so nothing
downstream depends on where a mapping came from.

Rule order, most specific first:
  1. Xero account type BANK is cash, whatever its reporting code says
     (STZA's NatWest accounts carry the bare code "ASS").
  2. The longest matching prefix of Xero's reporting code (e.g. EXP.STF.WAG).
  3. UK default-chart code ranges where the reporting code is too broad
     (STZA 481 Employer pension and 484 Benefits in kind carry just "EXP").
  4. The Xero account type.
Anything left is a gap, and a gap with activity fails the build.
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


# Presentation order is the order here.
CATEGORIES: list[Category] = [
    # Profit and loss
    Category("turnover",          "Turnover",                              "pnl", "turnover",        10),
    Category("cost_of_sales",     "Cost of sales",                         "pnl", "cost_of_sales",   20),
    Category("staff_costs",       "Staff costs",                           "pnl", "overheads",       30),
    Category("establishment",     "Establishment costs",                   "pnl", "overheads",       40),
    Category("professional_fees", "Legal and professional fees",           "pnl", "overheads",       50),
    Category("administrative",    "Administrative expenses",               "pnl", "overheads",       60),
    Category("depreciation",      "Depreciation and amortisation",         "pnl", "overheads",       70),
    Category("fx",                "Foreign exchange gains and losses",     "pnl", "overheads",       80),
    Category("other_income",      "Interest receivable and other income",  "pnl", "finance",         90),
    Category("interest_payable",  "Interest payable",                      "pnl", "finance",        100),
    Category("taxation",          "Taxation",                              "pnl", "taxation",       110),
    # Balance sheet
    Category("intangible_assets", "Intangible assets",                     "bs", "fixed_assets",    200),
    Category("tangible_assets",   "Tangible assets",                       "bs", "fixed_assets",    210),
    Category("investments",       "Investments",                           "bs", "fixed_assets",    220),
    Category("stock",             "Stock",                                 "bs", "current_assets",  300),
    Category("debtors",           "Debtors",                               "bs", "current_assets",  310),
    Category("cash",              "Cash at bank and in hand",              "bs", "current_assets",  320),
    Category("creditors_lt1y",    "Creditors: amounts falling due within one year", "bs", "creditors_lt1y", 400),
    Category("creditors_gt1y",    "Creditors: amounts falling due after more than one year", "bs", "creditors_gt1y", 410),
    Category("provisions",        "Provisions for liabilities",            "bs", "provisions",      420),
    Category("share_capital",     "Called up share capital",               "bs", "equity",          500),
    Category("retained_earnings", "Profit and loss account",               "bs", "equity",          510),
    Category("other_reserves",    "Other reserves",                        "bs", "equity",          520),
]
BY_KEY = {c.key: c for c in CATEGORIES}

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


def resolve_mapping(accounts: list[Account]) -> dict[str, Mapping]:
    """account id -> Mapping. Rule-proposed in v1; approved mappings from
    finance-api will replace this without changing the callers."""
    out = {}
    for a in accounts:
        m = propose(a)
        if m.category and BY_KEY[m.category].statement != ("pnl" if a.is_pnl else "bs"):
            m = Mapping(a, None, f"{m.reason} puts a {a.klass} account on the wrong statement")
        out[a.id] = m
    return out


# --- Cash flow ------------------------------------------------------------------
# Each balance sheet account's movement lands in one place on the indirect cash
# flow. Most follow their category, but creditors and debtors mix working
# capital with tax, dividends and loans, which belong in different sections.
CASH_FLOW_CLASSES = ("cash", "working_capital", "provisions", "tax", "capex",
                     "investments", "loans", "equity", "dividends", "retained_earnings")

_CATEGORY_CASH_FLOW = {
    "cash": "cash", "stock": "working_capital", "debtors": "working_capital",
    "creditors_lt1y": "working_capital", "creditors_gt1y": "loans", "provisions": "provisions",
    "intangible_assets": "capex", "tangible_assets": "capex", "investments": "investments",
    "share_capital": "equity", "other_reserves": "equity", "retained_earnings": "retained_earnings",
}


def cash_flow_class(account: Account, category: str) -> str:
    rc = (account.reporting_code or "").upper()
    name = account.name.lower()
    if category in ("creditors_lt1y", "creditors_gt1y", "debtors"):
        if rc.startswith(("LIA.CUR.TAX.COR", "LIA.NCL.TAX.COR", "ASS.CUR.REC.TAX.COR")) or "corporation tax" in name:
            return "tax"
        if "dividend" in name or rc.startswith("LIA.CUR.DIV"):
            return "dividends"
        if rc.startswith(("LIA.CUR.LOA", "LIA.NCL.LOA")) or "loan" in name:
            return "loans"
    return _CATEGORY_CASH_FLOW[category]

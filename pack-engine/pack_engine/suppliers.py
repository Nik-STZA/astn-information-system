"""Supplier analysis: Category > Account > Supplier tabs, by month, tied to the P&L.

Ported from the laptop pack's supplier tabs and keeping their layout. Each level
of the hierarchy is an eight-row block (Actual, PY, Var, Var %, a gap, Budget,
Var vs Bud, Var %), across the twelve months of the financial year, YTD and FY.
A supplier with nothing in a reported month shows nil for that month: a missing
accrual is meant to be seen.

Where the figures come from. The laptop read Xero's /Journals feed, which this
platform cannot: Xero refuses accounting.journals.read for our app. So supplier
lines are rebuilt from the documents that post to the ledger, through
finance-api's read-only passthrough, and account figures come from the same
trial balances as the P&L:

  bills, sales invoices     AUTHORISED or PAID only
  credit notes              AUTHORISED or PAID only
  bank transactions         AUTHORISED only, spend adds and receive subtracts
  manual journals           POSTED only, debits add and credits subtract

Three things keep a month from being overstated, each of which the laptop got
wrong somewhere:

  - Amounts are signed. The journal feed carries an edited or voided document and
    its reversal, and abs() added both, so a month could show many times its
    true cost.
  - Only what has reached the ledger counts. A bill awaiting approval (SUBMITTED)
    is not in the P&L, and our bill lane stops at exactly that status.
  - A supplier that nets to a credit keeps its row. Dropping it would leave the
    suppliers short of the account.

Anything that posts outside these documents has no supplier here: Xero Payroll,
the fixed asset register, Xero Expenses, currency revaluation. Depreciation and
foreign exchange are left out by default for that reason; a profile can narrow
the categories further. The suppliers-to-account control fails on any other gap,
so it is seen and its cause fixed, never plugged with a balancing row.

Off unless the profile has "supplier_tabs": {} or
{"categories": ["staff_costs", ...]}. Nothing else in the pack changes.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter as col
from openpyxl.worksheet.properties import Outline

from . import style
from .api import FinanceApiError
from .controls import Control
from .fiscal import month_end, month_label
from .ledger import Account, Ledger, parse_trial_balance
from .model import Model
from .render import PNL, Rendered

SOURCE = "Source - Supplier ledger"
RECONCILIATION = "Supplier reconciliation"

DEFAULT_SECTIONS = ("cost_of_sales", "overheads")
NOT_SUPPLIER_COSTS = ("depreciation", "fx")      # posted by Xero, not by a document

POSTED = ("AUTHORISED", "PAID", "SUBMITTED")
SPEND_TYPES = ("SPEND", "SPEND-OVERPAYMENT", "SPEND-PREPAYMENT")
RECEIVE_TYPES = ("RECEIVE", "RECEIVE-OVERPAYMENT", "RECEIVE-PREPAYMENT")

# Tabs show whole pounds, and foreign currency lines are converted here at the
# document rate, so they can round a few pence away from Xero's own posting. GBP
# documents tie exactly. Above this, per account per month, the control fails.
TOLERANCE = 1.00


# --- the ledger, from documents ------------------------------------------------------------

def parse_xero_date(value) -> date | None:
    """Either '/Date(ms+zzzz)/' or 'YYYY-MM-DD...'."""
    s = str(value or "")
    if s.startswith("/Date("):
        try:
            ms = int(re.split(r"[+\-)]", s[6:], maxsplit=1)[0])
        except ValueError:
            return None
        return datetime.fromtimestamp(ms / 1000, timezone.utc).date()
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def net_amount(line: dict, amount_types) -> float:
    """LineAmount net of tax. Inclusive documents carry the tax inside LineAmount."""
    amount = _float(line.get("LineAmount"))
    if str(amount_types or "").strip().lower() == "inclusive":
        amount -= _float(line.get("TaxAmount"))
    return amount


def to_base(amount: float, rate) -> float:
    """Xero's CurrencyRate is foreign units per unit of base currency."""
    r = _float(rate)
    return amount / r if r > 0 else amount


def contact_name(doc: dict) -> str:
    return str((doc.get("Contact") or {}).get("Name") or "(unattributed)").strip()


def ledger_from_documents(invoices=(), credit_notes=(), bank_transactions=(), manual_journals=()) -> dict:
    """{(account code, supplier, month-end): signed amount}, debit positive. Pure."""
    ledger: dict = defaultdict(float)

    def add(code, supplier, when, amount):
        code = str(code or "").strip()
        if code and when is not None:
            ledger[(code, supplier, month_end(when.year, when.month))] += amount

    def lines(doc, sign, supplier):
        when, rate = parse_xero_date(doc.get("Date")), doc.get("CurrencyRate")
        for li in doc.get("LineItems") or []:
            add(li.get("AccountCode"), supplier, when,
                sign * to_base(net_amount(li, doc.get("LineAmountTypes")), rate))

    def status(doc):
        return str(doc.get("Status") or "").upper()

    for doc in invoices:
        sign = {"ACCPAY": 1, "ACCREC": -1}.get(str(doc.get("Type")).upper())
        if sign and status(doc) in POSTED:
            lines(doc, sign, contact_name(doc))
    for doc in credit_notes:
        sign = {"ACCPAYCREDIT": -1, "ACCRECCREDIT": 1}.get(str(doc.get("Type")).upper())
        if sign and status(doc) in POSTED:
            lines(doc, sign, contact_name(doc))
    for doc in bank_transactions:
        kind = str(doc.get("Type")).upper()
        sign = 1 if kind in SPEND_TYPES else -1 if kind in RECEIVE_TYPES else None
        if sign and status(doc) == "AUTHORISED":
            lines(doc, sign, contact_name(doc))
    for doc in manual_journals:
        if status(doc) != "POSTED":
            continue
        when = parse_xero_date(doc.get("Date"))
        supplier = str(doc.get("Narration") or "").strip() or "(Manual journal)"
        for li in doc.get("JournalLines") or []:
            add(li.get("AccountCode"), supplier, when, abs(net_amount(li, doc.get("LineAmountTypes"))))

    return {k: round(v, 2) for k, v in ledger.items() if abs(round(v, 2)) >= 0.01}


def fetch_documents(api, client: str, entity: str, start: date, end: date) -> dict:
    """Read-only, paged and paced. The dates cover the prior year and this year to date."""
    where = (f"Date>=DateTime({start.year},{start.month:02d},{start.day:02d}) AND "
             f"Date<=DateTime({end.year},{end.month:02d},{end.day:02d})")
    return {"invoices": api.paged(client, entity, "invoices", "Invoices", where=where),
            "credit_notes": api.paged(client, entity, "credit-notes", "CreditNotes", where=where),
            "bank_transactions": api.paged(client, entity, "bank-transactions", "BankTransactions", where=where),
            "manual_journals": api.paged(client, entity, "manual-journals", "ManualJournals", where=where)}


def fetch_budget(api, client: str, entity: str, start: date, end: date) -> dict:
    """{account code: {month-end: amount}} from Xero's overall budget, or {}.

    A month Xero holds no figure for stays absent, and so does a nil: Xero cannot
    tell us a nil was budgeted rather than left empty, and the tabs must never
    show a budget that was not set.
    """
    overall = next((b for b in api.read(client, entity, "budgets").get("Budgets") or []
                    if str(b.get("Type")).upper() == "OVERALL"), None)
    if not overall:
        return {}
    detail = api.read(client, entity, f"budgets/{overall['BudgetID']}",
                      DateFrom=start.isoformat(), DateTo=end.isoformat()).get("Budgets") or []
    out: dict = {}
    for line in (detail[0].get("BudgetLines") or []) if detail else []:
        code = str(line.get("AccountCode") or "").strip()
        for bal in line.get("BudgetBalances") or []:
            amount = _float(bal.get("Amount"))
            period = re.fullmatch(r"(\d{4})-(\d{2})(-\d{2})?", str(bal.get("Period") or ""))
            if code and amount and period:
                out.setdefault(code, {})[month_end(int(period[1]), int(period[2]))] = amount
    return out


# --- analysis ---------------------------------------------------------------------------------

@dataclass
class Supplier:
    name: str
    status: str                         # Continuing | New this year | Stopped
    actual: dict[date, float]           # reported months
    py: dict[date, float]               # same month last year, keyed by this year's month-end


@dataclass
class AccountLine:
    account: Account
    actual: dict[date, float]           # reported months, from the trial balance
    py: dict[date, float]
    budget: dict[date, float]
    suppliers: list[Supplier] = field(default_factory=list)


@dataclass
class CategoryTab:
    key: str
    label: str
    accounts: list[AccountLine]


@dataclass
class Analysis:
    months: list[date]
    fy_months: list[date]
    tabs: list[CategoryTab]
    budget_error: str = ""


def prior_month(d: date) -> date:
    return month_end(d.year - 1, d.month)


def categories_in_scope(model: Model, settings: dict) -> list:
    chosen = settings.get("categories")
    if chosen is not None:
        return [b for b in model.pnl if b.category in chosen]
    return [b for b in model.pnl if model.section_of(b.category) in DEFAULT_SECTIONS
            and b.category not in NOT_SUPPLIER_COSTS]


def suppliers_of(code: str, docs: dict, months: list[date], fy_months: list[date]) -> list[Supplier]:
    """Continuing, then new this year, then stopped; largest first within each."""
    actual: dict = defaultdict(dict)
    py: dict = defaultdict(dict)
    prior = {prior_month(d): d for d in fy_months}
    reported = set(months)
    for (c, name, when), amount in docs.items():
        if c != code:
            continue
        if when in reported:
            actual[name][when] = amount
        elif when in prior:
            py[name][prior[when]] = amount
    ranked = []
    for name in {*actual, *py}:
        now, then = actual.get(name, {}), py.get(name, {})
        if sum(now.values()) <= 0.01 and sum(then.values()) <= 0.01:
            continue
        if now and then:
            status, rank = "Continuing", 0
        elif now:
            status, rank = "New this year", 1
        else:
            status, rank = "Stopped", 2
        size = max(abs(sum(now.values())), abs(sum(then.values())))
        ranked.append((rank, -size, name, Supplier(name, status, now, then)))
    return [s for *_, s in sorted(ranked, key=lambda t: t[:3])]


def analyse(api, client: str, profile: dict, ledger: Ledger, model: Model) -> Analysis:
    settings, entity = profile["supplier_tabs"], profile["entity"]
    months, fy_months = model.months, model.fy_months
    first = fy_months[0]
    docs = ledger_from_documents(**fetch_documents(api, client, entity,
                                                   date(first.year - 1, first.month, 1), months[-1]))

    prior_tbs = {}
    for d in fy_months:
        p = prior_month(d)
        if p in ledger.trial_balances:
            prior_tbs[d] = ledger.trial_balances[p]
        else:
            api.pace()
            prior_tbs[d] = parse_trial_balance(api.trial_balance(client, entity, p), p)

    budget, budget_error = {}, ""
    try:
        budget = fetch_budget(api, client, entity, date(first.year, first.month, 1), fy_months[-1])
    except FinanceApiError as e:
        budget_error = str(e)

    tabs = []
    for block in categories_in_scope(model, settings):
        lines = []
        for line in block.lines:
            a = line.account
            lines.append(AccountLine(
                a, {d: ledger.movement(a.id, d) for d in months},
                {d: tb.movement.get(a.id, 0.0) for d, tb in prior_tbs.items()},
                {d: v for d, v in budget.get(str(a.code), {}).items() if d in fy_months},
                suppliers_of(str(a.code), docs, months, fy_months) if a.code else []))
        tabs.append(CategoryTab(block.category, block.label, lines))
    return Analysis(months, fy_months, tabs, budget_error)


# --- controls ---------------------------------------------------------------------------------

def _diff_control(key: str, label: str, rows: list[tuple[str, float, float]]) -> Control:
    """rows: (what, expected, actual). Fails on any one row, so differences cannot offset."""
    bad = [(what, round(a - e, 2)) for what, e, a in rows if abs(round(a - e, 2)) > TOLERANCE]
    detail = "; ".join(f"{what} differs by {d:,.2f}" for what, d in bad[:12]) + ("; ..." if len(bad) > 12 else "")
    return Control(key, label, "fail" if bad else "pass", round(sum(r[1] for r in rows), 2),
                   round(sum(r[2] for r in rows), 2), detail)


def reconcile(analysis: Analysis, model: Model) -> list[Control]:
    """Suppliers to accounts for every month shown; accounts to the P&L for every
    reported month and for the prior year."""
    out = []
    lines = [a for t in analysis.tabs for a in t.accounts]
    for d in analysis.months:
        rows = [(a.account.label, a.actual.get(d, 0.0), sum(s.actual.get(d, 0.0) for s in a.suppliers))
                for a in lines]
        out.append(_diff_control(f"suppliers.account.{d}", f"Suppliers sum to each account for {month_label(d)}", rows))
    for d in analysis.fy_months:
        p = prior_month(d)
        rows = [(a.account.label, a.py.get(d, 0.0), sum(s.py.get(d, 0.0) for s in a.suppliers)) for a in lines]
        out.append(_diff_control(f"suppliers.account.{p}", f"Suppliers sum to each account for {month_label(p)}", rows))
    blocks = {b.category: b for b in model.pnl}
    for d in analysis.months:
        rows = [(t.label, -blocks[t.key].total(d), sum(a.actual.get(d, 0.0) for a in t.accounts))
                for t in analysis.tabs]
        out.append(_diff_control(f"suppliers.pnl.{d}", f"Accounts sum to the P&L for {month_label(d)}", rows))
    pye = model.prior_year_end
    if pye in model.prior_year_ends:
        rows = [(t.label, -blocks[t.key].total(pye), sum(sum(a.py.values()) for a in t.accounts))
                for t in analysis.tabs]
        out.append(_diff_control("suppliers.pnl.prior", f"Accounts sum to the P&L for the year to {month_label(pye)}",
                                 rows))
    if analysis.budget_error:
        out.append(Control("suppliers.budget", "Budget read from Xero", "warn",
                           detail=f"Budget rows left blank: {analysis.budget_error[:200]}"))
    return out


# --- workbook ---------------------------------------------------------------------------------

FIRST_MONTH = 3                  # column C
YTD, FY, KEY = 15, 16, 17        # O, P, and a hidden key the reconciliation sums on
HEAD = 4
BLOCK = [("Actual", "actual"), ("PY", "py"), ("Var GBP", "var"), ("Var %", "var_pct"), ("", "gap"),
         ("Budget", "budget"), ("Var vs Bud GBP", "var_bud"), ("Var vs Bud %", "var_bud_pct")]
BLOCK_HEIGHT = len(BLOCK) + 1    # with a blank row after
ROW = {key: i for i, (_, key) in enumerate(BLOCK)}
VAR_LABELS = tuple(label for label, key in BLOCK if key.startswith("var"))
LEVEL_STYLE = ("supplier_category", "supplier_account", "supplier_vendor")
SRC_FIRST = 5                    # E: twelve PY columns, then twelve Actual, then twelve Budget


def _sheet(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def tab_name(label: str, taken: list[str]) -> str:
    """Excel: 31 characters, none of \\ / * ? : [ ], unique ignoring case."""
    base = re.sub(r"[\\/*?:\[\]]", " ", label).strip()[:31].strip()
    name, n = base, 2
    lower = {t.lower() for t in taken}
    while name.lower() in lower:
        suffix = f" {n}"
        name, n = base[:31 - len(suffix)].strip() + suffix, n + 1
    return name


class _Source:
    """The typed numbers behind the tabs, one row per account and per supplier."""

    def __init__(self, wb, analysis: Analysis):
        self.ws = ws = wb.create_sheet(SOURCE)
        self.months = analysis.fy_months
        self.reported = analysis.months
        self.r = 5
        self.rows: dict = {}
        ws["A1"] = SOURCE
        ws["A1"].font = style.ROW_STYLES["title"]["font"]
        ws["A2"] = ("Typed numbers behind the supplier tabs. Account rows are Xero trial balance movements and "
                    "Xero's budget; supplier rows are rebuilt from Xero documents. Debit positive.")
        ws["A2"].font = style.ROW_STYLES["note"]["font"]
        head = ["Row", "Code", "Account", "Supplier"]
        head += [f"PY {month_label(prior_month(d))}" for d in self.months]
        head += [f"Actual {month_label(d)}" for d in self.months]
        head += [f"Budget {month_label(d)}" for d in self.months]
        for i, h in enumerate(head, 1):
            ws.cell(HEAD, i, h)
        style.apply_row(ws, HEAD, "header", 1, len(head), text_cols=range(1, 5))
        for letter in "CD":
            ws.column_dimensions[letter].width = 34
        ws.freeze_panes = "E5"

    def _ref(self, row: int, offset: int, d: date) -> str:
        return f"={_sheet(SOURCE)}!{col(SRC_FIRST + offset + self.months.index(d))}{row}"

    def add(self, key, kind: str, account: Account, supplier: str, actual, py, budget) -> None:
        ws, r, n = self.ws, self.r, len(self.months)
        for i, v in enumerate([kind, account.code, account.name, supplier], 1):
            cell = ws.cell(r, i, v)
            cell.font = style.font(9)
            if isinstance(v, str) and v.startswith("="):
                cell.data_type = "s"      # a supplier name is text, whatever it starts with
        for i, d in enumerate(self.months):
            ws.cell(r, SRC_FIRST + i, py.get(d, 0.0))
            if d in self.reported:
                ws.cell(r, SRC_FIRST + n + i, actual.get(d, 0.0))
            if d in budget:
                ws.cell(r, SRC_FIRST + 2 * n + i, budget[d])
        for c in range(SRC_FIRST, SRC_FIRST + 3 * n):
            ws.cell(r, c).number_format = style.NUM_2DP
        self.rows[key] = r
        self.r += 1

    def cells(self, key, budget: dict | None = None) -> tuple[dict, dict, dict]:
        """Formulas for (actual, py, budget) by month."""
        r, n = self.rows[key], len(self.months)
        return ({d: self._ref(r, n, d) for d in self.reported},
                {d: self._ref(r, 0, d) for d in self.months},
                {d: self._ref(r, 2 * n, d) for d in (budget or {})})


def _pct(num: str, base: str) -> str:
    return f"=IF({base}=0,0,({num}-{base})/ABS({base}))"


def _write_block(rendered: Rendered, ws, top: int, label: str, level: int, analysis: Analysis,
                 actual: dict, py: dict, budget: dict, key: str | None = None) -> None:
    months, reported = analysis.fy_months, analysis.months
    rows = {name: top + i for name, i in ROW.items()}
    letters = {d: col(FIRST_MONTH + i) for i, d in enumerate(months)}
    c1, c12, cp = letters[months[0]], letters[months[-1]], letters[reported[-1]]
    ytd, fy = col(YTD), col(FY)

    def put(c: str, name: str, value, fmt=style.NUM):
        if value is None:
            return
        cell = ws[f"{c}{rows[name]}"]
        cell.value = value
        cell.number_format = fmt
        cell.alignment = Alignment(horizontal="right", vertical="center")
        cell.font = style.font(9, bold=c in (ytd, fy), italic=name.startswith("var"))
        rendered.formula_cells.append((ws.title, cell.coordinate))

    def variances(c: str, has_actual: bool, has_py: bool, has_budget: bool):
        a, p, b = f"{c}{rows['actual']}", f"{c}{rows['py']}", f"{c}{rows['budget']}"
        if has_actual and has_py:
            put(c, "var", f"={a}-{p}")
            put(c, "var_pct", _pct(a, p), style.PCT)
        if has_actual and has_budget:
            put(c, "var_bud", f"={a}-{b}")
            put(c, "var_bud_pct", _pct(a, b), style.PCT)

    for d, c in letters.items():
        put(c, "actual", actual.get(d))
        put(c, "py", py.get(d))
        put(c, "budget", budget.get(d))
        variances(c, d in actual, d in py, d in budget)

    # YTD compares like with like: a budget total only if every reported month has one.
    def total(name, last):
        return f"=SUM({c1}{rows[name]}:{last}{rows[name]})"

    put(ytd, "actual", total("actual", cp))
    put(ytd, "py", total("py", cp))
    budget_ytd = all(d in budget for d in reported)
    if budget_ytd:
        put(ytd, "budget", total("budget", cp))
    variances(ytd, True, True, budget_ytd)

    year_done = len(reported) == len(months)
    if year_done:
        put(fy, "actual", total("actual", c12))
    put(fy, "py", total("py", c12))
    if budget:
        put(fy, "budget", total("budget", c12))
    variances(fy, year_done, True, all(d in budget for d in months))

    for i, (row_label, name) in enumerate(BLOCK):
        r = top + i
        if level:
            ws.row_dimensions[r].outlineLevel = level
        if name == "gap":
            ws.row_dimensions[r].height = 6
            continue
        is_var = name.startswith("var")
        ws.cell(r, 2, row_label).font = style.font(9, italic=is_var, color=style.GREY_TEXT if is_var else style.BLACK)
    ws.cell(top, 1, "  " * level + label)
    style.apply_row(ws, top, LEVEL_STYLE[level], 1, FY)
    if key:
        ws.cell(rows["actual"], KEY, f"{key}|A")
        ws.cell(rows["py"], KEY, f"{key}|P")


def _category_tab(rendered: Rendered, src: _Source, tab: CategoryTab, analysis: Analysis,
                  title: str, failed: list[str]) -> dict:
    """Writes one tab. Returns {"category": row, account id: row}."""
    ws = rendered.workbook.create_sheet(title)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 38
    ws.column_dimensions["B"].width = 14
    for i in range(12):
        ws.column_dimensions[col(FIRST_MONTH + i)].width = 10
    ws.column_dimensions[col(YTD)].width = 12
    ws.column_dimensions[col(FY)].width = 12
    ws.column_dimensions[col(KEY)].hidden = True

    ws["A1"] = f"{tab.label} - Supplier detail (accrued basis)"
    ws["A1"].font = style.ROW_STYLES["title"]["font"]
    ws["A2"] = (f"Basis: management, accrued P&L. Period to {month_label(analysis.months[-1])}. Hierarchy: Category > "
                "Nominal account > Supplier. Missing accruals show as nil for that month. Accounts are the trial "
                "balance; suppliers are rebuilt from Xero documents.")
    ws["A2"].font = style.ROW_STYLES["note"]["font"]
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=FY)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=FY)
    if failed:
        ws["A3"] = f"FAILED CONTROL: {'; '.join(failed)}. See {RECONCILIATION}."
        ws["A3"].font = style.font(9, bold=True, color=style.NEGATIVE_RED)
        ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=FY)

    ws.cell(HEAD, 1, "Line")
    ws.cell(HEAD, 2, "Basis")
    for i, d in enumerate(analysis.fy_months):
        ws.cell(HEAD, FIRST_MONTH + i, d.strftime("%b"))
    ws.cell(HEAD, YTD, "YTD")
    ws.cell(HEAD, FY, "FY")
    style.apply_row(ws, HEAD, "header", 1, FY)
    for c in range(1, FY + 1):
        ws.cell(HEAD, c).alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[HEAD].height = 22

    # Rows are laid out first, because the category row at the top sums what is below it.
    top = HEAD + 2
    positions, r = {}, top + BLOCK_HEIGHT
    for line in tab.accounts:
        positions[line.account.id] = r
        r += BLOCK_HEIGHT * (1 + len(line.suppliers))
    letters = {d: col(FIRST_MONTH + i) for i, d in enumerate(analysis.fy_months)}

    def sums(name: str, months) -> dict:
        return {d: "=" + "+".join(f"{letters[d]}{positions[a.account.id] + ROW[name]}" for a in tab.accounts)
                for d in months}

    budget_rows = {}
    for d in analysis.fy_months:
        budgeted = [a for a in tab.accounts if d in a.budget]
        if budgeted:
            budget_rows[d] = "=" + "+".join(f"{letters[d]}{positions[a.account.id] + ROW['budget']}" for a in budgeted)
    _write_block(rendered, ws, top, tab.label, 0, analysis, sums("actual", analysis.months),
                 sums("py", analysis.fy_months), budget_rows)
    for line in tab.accounts:
        a = line.account
        actual, py, budget = src.cells(a.id, line.budget)
        _write_block(rendered, ws, positions[a.id], a.label, 1, analysis, actual, py, budget)
        for i, s in enumerate(line.suppliers, 1):
            tag = {"New this year": "  [NEW]", "Stopped": "  [STOPPED]"}.get(s.status, "")
            actual, py, _ = src.cells((a.id, s.name))
            _write_block(rendered, ws, positions[a.id] + i * BLOCK_HEIGHT, f"{s.name}{tag}", 2, analysis,
                         actual, py, {}, key=a.id)

    ws.freeze_panes = "C5"
    ws.sheet_properties.outlinePr = Outline(summaryBelow=False)
    # Cost variances: more than the comparison is adverse.
    var_rows = [x for x in range(top, r) if ws.cell(x, 2).value in VAR_LABELS]
    ranges = " ".join(f"{col(FIRST_MONTH)}{x}:{col(FY)}{x}" for x in var_rows)
    ws.conditional_formatting.add(ranges, CellIsRule(operator="greaterThan", formula=["0"],
                                                     font=Font(color=style.ADVERSE_TEXT)))
    ws.conditional_formatting.add(ranges, CellIsRule(operator="lessThan", formula=["0"],
                                                     font=Font(color=style.FAVOURABLE_TEXT)))
    return {"category": top, **positions}


def _reconciliation_tab(rendered: Rendered, analysis: Analysis, model: Model, titles: dict, rows: dict,
                        failed: list[Control]) -> None:
    """The same checks as the controls, as live formulas over the tabs."""
    ws = rendered.workbook.create_sheet(RECONCILIATION)
    ws.sheet_view.showGridLines = False
    ws["A1"] = RECONCILIATION
    ws["A1"].font = style.ROW_STYLES["title"]["font"]
    ws["A2"] = (f"Every figure is a difference and should be nil. Red means more than {TOLERANCE:,.2f} out, and "
                "the same check on the Controls tab has failed.")
    ws["A2"].font = style.ROW_STYLES["note"]["font"]
    ws["A3"] = (f"FAILED: {len(failed)} check(s). See the red cells and the Controls tab." if failed
                else "All checks pass.")
    ws["A3"].font = style.font(9, bold=True, color=style.NEGATIVE_RED if failed else style.BLACK)
    ws.column_dimensions["A"].width = 46
    ws.column_dimensions["B"].width = 12
    head = ["Line", "Check", *[d.strftime("%b") for d in analysis.fy_months], "YTD", "PY FY"]
    for i, h in enumerate(head, 1):
        ws.cell(HEAD, i, h)
    style.apply_row(ws, HEAD, "header", 1, len(head), text_cols=(2,))
    ws.freeze_panes = "C5"

    letters = {d: col(FIRST_MONTH + i) for i, d in enumerate(analysis.fy_months)}
    first, last_reported = letters[analysis.fy_months[0]], letters[analysis.months[-1]]
    r = HEAD + 1

    def heading(text: str):
        nonlocal r
        ws.cell(r, 1, text)
        style.apply_row(ws, r, "subtotal", 1, len(head))
        r += 1

    def line(label: str, check: str, cells: dict, ytd=True, py_fy=None):
        nonlocal r
        ws.cell(r, 1, label).font = style.font(9)
        ws.cell(r, 2, check).font = style.font(9, italic=True, color=style.GREY_TEXT)
        for c, f in cells.items():
            ws[f"{c}{r}"] = f
        if ytd:
            ws[f"{col(YTD)}{r}"] = f"=SUM({first}{r}:{last_reported}{r})"
        if py_fy:
            ws[f"{col(FY)}{r}"] = py_fy
        for c in range(FIRST_MONTH, FY + 1):
            cell = ws.cell(r, c)
            cell.number_format = style.NUM_2DP
            cell.font = style.font(9)
            if cell.value is not None:
                rendered.formula_cells.append((ws.title, cell.coordinate))
        r += 1

    def supplier_section(title: str, tag: str, months: list[date], offset: int):
        heading(title)
        key_col = f"${col(KEY)}:${col(KEY)}"
        for tab in analysis.tabs:
            sheet = _sheet(titles[tab.key])
            for a in tab.accounts:
                at = rows[tab.key][a.account.id] + offset
                line(a.account.label, "Suppliers", {
                    letters[d]: (f'=SUMIF({sheet}!{key_col},"{a.account.id}|{tag}",{sheet}!{letters[d]}:{letters[d]})'
                                 f"-{sheet}!{letters[d]}{at}") for d in months}, ytd=tag == "A")

    supplier_section("Suppliers less account, this year", "A", analysis.months, ROW["actual"])
    supplier_section("Suppliers less account, prior year", "P", analysis.fy_months, ROW["py"])
    heading("Accounts less profit and loss")
    cols = rendered.columns
    prior = cols.prior.get(model.prior_year_end)
    pnl = _sheet(PNL)
    for tab in analysis.tabs:
        sheet, row = _sheet(titles[tab.key]), rows[tab.key]["category"]
        pr = rendered.pnl_category_rows[tab.key]
        # Costs are negative on the P&L and positive here, so the two add to nil.
        line(tab.label, "P&L", {letters[d]: f"={sheet}!{letters[d]}{row}+{pnl}!{cols.months[d]}{pr}"
                                for d in analysis.months},
             py_fy=f"={sheet}!{col(FY)}{row + ROW['py']}+{pnl}!{prior}{pr}" if prior else None)

    for i in range(FIRST_MONTH, FY + 1):
        ws.column_dimensions[col(i)].width = 10
    ws.conditional_formatting.add(
        f"{col(FIRST_MONTH)}{HEAD + 1}:{col(FY)}{r}",
        CellIsRule(operator="notBetween", formula=[f"-{TOLERANCE}", f"{TOLERANCE}"],
                   font=Font(bold=True, color=style.NEGATIVE_RED), fill=style.dxf_fill(style.FAIL_FILL)))


def render(rendered: Rendered, analysis: Analysis, model: Model, controls: list[Control]) -> None:
    wb = rendered.workbook
    src = _Source(wb, analysis)
    titles, tab_rows = {}, {}
    for tab in analysis.tabs:
        titles[tab.key] = tab_name(tab.label, [*wb.sheetnames, *titles.values(), "Controls", "Mapping",
                                               RECONCILIATION])
        for line in tab.accounts:
            src.add(line.account.id, "Account", line.account, "", line.actual, line.py, line.budget)
            for s in line.suppliers:
                src.add((line.account.id, s.name), "Supplier", line.account, s.name, s.actual, s.py, {})
    failed = [c for c in controls if c.status == "fail"]
    for tab in analysis.tabs:
        names = [a.account.label for a in tab.accounts] + [tab.label]
        notes = [c.label for c in failed if any(n in c.detail for n in names)]
        tab_rows[tab.key] = _category_tab(rendered, src, tab, analysis, titles[tab.key], notes)
    _reconciliation_tab(rendered, analysis, model, titles, tab_rows, failed)
    wb.move_sheet(SOURCE, offset=len(wb.sheetnames))      # after the tabs it feeds


def add_to_pack(rendered: Rendered, api, client: str, profile: dict, ledger: Ledger, model: Model) -> list[Control]:
    """The hook in build.py. Adds the tabs and returns their controls; does nothing
    unless the profile asks for them."""
    if profile.get("supplier_tabs") is None:
        return []
    try:
        analysis = analyse(api, client, profile, ledger, model)
    except FinanceApiError as e:
        return [Control("suppliers.read", "Supplier documents read from Xero", "fail",
                        detail=f"Supplier tabs left out: {str(e)[:300]}")]
    controls = reconcile(analysis, model)
    if analysis.tabs:
        render(rendered, analysis, model, controls)
    return controls

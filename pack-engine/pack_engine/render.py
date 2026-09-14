"""Workbook renderer.

Rules:
  - The only typed numbers are on "Source - Trial balance" (Xero trial balance
    figures, debit minus credit). Every figure on the statements is a formula,
    and every subtotal and total is a formula.
  - No hardcoded row numbers or column letters: rows are assigned while writing,
    columns come from a plan built from the number of comparative years, and
    what other sheets need is recorded as anchors and Excel defined names.
  - Months after the reporting month are left blank.

Layout on every statement: A label | B spacer | one full-year column per
comparative year, oldest first | year to date | spacer | the twelve months.
A column is added each time a year ends. Two heading rows: row 3 says what a
column is, row 4 gives its period in one format per sheet. Panes freeze at the
first month column. Each category is one total row, with its accounts grouped
beneath it, collapsed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font
from openpyxl.utils import column_index_from_string
from openpyxl.utils import get_column_letter as col
from openpyxl.workbook.defined_name import DefinedName

from . import style
from .fiscal import date_label, month_label
from .mapping import BY_KEY
from .model import CREDIT_SECTIONS, Model

SRC = "Source - Trial balance"
PNL = "Profit and loss"
BS = "Balance sheet"
CF = "Cash flow"
KIND_ROW, HEAD = 3, 4
FIRST_ROW = 5
SRC_FIRST_VALUE_COL = 8  # H


@dataclass
class Columns:
    """Where everything sits on a statement, derived from the comparative years."""
    prior: dict[date, str]          # year end -> column, oldest first
    ytd: str                        # year to date (P&L, cash flow) or this month end (balance sheet)
    spacer: str
    months: dict[date, str]         # the 12 month-ends of the financial year

    @classmethod
    def plan(cls, model: Model) -> "Columns":
        c = 3                                            # C
        prior = {}
        for ye in model.prior_year_ends:
            prior[ye] = col(c)
            c += 1
        return cls(prior=prior, ytd=col(c), spacer=col(c + 1),
                   months={d: col(c + 2 + i) for i, d in enumerate(model.fy_months)})

    @property
    def first_month(self) -> str:
        return next(iter(self.months.values()))

    @property
    def last(self) -> str:
        return list(self.months.values())[-1]

    def value_cols(self, model: Model) -> list[str]:
        return [*self.prior.values(), self.ytd, *(self.months[d] for d in model.months)]


@dataclass
class Rendered:
    workbook: Workbook
    columns: Columns
    anchors: dict[str, int] = field(default_factory=dict)          # "pnl.net_profit" -> row
    formula_cells: list[tuple[str, str]] = field(default_factory=list)
    pnl_category_rows: dict[str, int] = field(default_factory=dict)
    bs_category_rows: dict[str, int] = field(default_factory=dict)
    bs_account_rows: dict[str, int] = field(default_factory=dict)
    src_rows: dict[str, int] = field(default_factory=dict)
    src_pnl_rows: tuple[int, int] | None = None


def _q(sheet: str) -> str:
    return f"'{sheet}'"


# --- source ---------------------------------------------------------------------------------

def _src_cols(model: Model) -> dict:
    """Source tab columns: movement and closing for each FY month, then a closing-or-YTD
    column for each year end the pack uses (opening, comparatives, prior year end)."""
    n = len(model.fy_months)
    year_ends = sorted({*(ye for ye in [model.opening_year_end] if ye), *model.prior_year_ends,
                        model.prior_year_end})
    return {
        "movement": {d: col(SRC_FIRST_VALUE_COL + i) for i, d in enumerate(model.fy_months)},
        "closing": {d: col(SRC_FIRST_VALUE_COL + n + i) for i, d in enumerate(model.fy_months)},
        "year_end": {ye: col(SRC_FIRST_VALUE_COL + 2 * n + i) for i, ye in enumerate(year_ends)},
    }


def _source_sheet(out: Rendered, model: Model, ledger):
    ws = out.workbook.create_sheet(SRC)
    ws["A1"] = "Source - Trial balance"
    ws["A1"].font = style.ROW_STYLES["title"]["font"]
    ws["A2"] = ("The only typed numbers in the pack: Xero trial balances via stza-finance-api, debit minus "
                "credit. Movement is the month; closing is the balance sheet balance, or the year to date for "
                "profit and loss accounts. Every statement figure is a formula over this tab.")
    ws["A2"].font = style.ROW_STYLES["note"]["font"]
    sc = _src_cols(model)
    head = ["Code", "Account", "Xero class", "Xero type", "Reporting code", "Category", "Xero account ID"]
    head += [f"Movement {month_label(d)}" for d in model.fy_months]
    head += [f"Closing {month_label(d)}" for d in model.fy_months]
    head += [f"Closing or YTD {date_label(ye)}" for ye in sc["year_end"]]
    for i, h in enumerate(head, start=1):
        ws.cell(HEAD, i, h)
    style.apply_row(ws, HEAD, "header", 1, len(head), text_cols=range(1, 8))
    ws.column_dimensions["B"].width = 38
    ws.column_dimensions["G"].width = 38
    ws.freeze_panes = "H5"
    r = FIRST_ROW
    pnl_first = pnl_last = None
    for b in [*model.pnl, *model.bs]:
        for line in b.lines:
            a = line.account
            for i, v in enumerate([a.code, a.name, a.klass, a.type, a.reporting_code,
                                   BY_KEY[b.category].label, a.id], start=1):
                ws.cell(r, i, v)
            for d in model.months:
                ws[f"{sc['movement'][d]}{r}"] = ledger.movement(a.id, d)
                ws[f"{sc['closing'][d]}{r}"] = ledger.closing(a.id, d)
            for ye, c in sc["year_end"].items():
                ws[f"{c}{r}"] = ledger.closing(a.id, ye)
            for c in range(SRC_FIRST_VALUE_COL, len(head) + 1):
                ws.cell(r, c).number_format = style.NUM_2DP
            out.src_rows[a.id] = r
            if a.is_pnl:
                pnl_first = pnl_first or r
                pnl_last = r
            r += 1
    out.src_pnl_rows = (pnl_first, pnl_last) if pnl_first else None


def _src(model, out, account_id, kind, when) -> str:
    return f"{_q(SRC)}!{_src_cols(model)[kind][when]}{out.src_rows[account_id]}"


# --- sheet writer -------------------------------------------------------------------------

class _Writer:
    def __init__(self, out: Rendered, ws, title: str, subtitle: str,
                 prior_kind: str, current_kind: str, month_kind: str, fmt, current_period: str):
        cols = out.columns
        self.out, self.ws, self.cols, self.r = out, ws, cols, FIRST_ROW
        ws["A1"], ws["A2"] = title, subtitle
        ws["A1"].font, ws["A2"].font = style.ROW_STYLES["title"]["font"], style.ROW_STYLES["subtitle"]["font"]
        for ye, c in cols.prior.items():
            ws[f"{c}{KIND_ROW}"], ws[f"{c}{HEAD}"] = prior_kind, fmt(ye)
        ws[f"{cols.ytd}{KIND_ROW}"], ws[f"{cols.ytd}{HEAD}"] = current_kind, current_period
        ws[f"{cols.first_month}{KIND_ROW}"] = month_kind
        ws.merge_cells(f"{cols.first_month}{KIND_ROW}:{cols.last}{KIND_ROW}")
        for d, c in cols.months.items():
            ws[f"{c}{HEAD}"] = fmt(d)
        self.skip = (2, column_index_from_string(cols.spacer))
        self.last_col = column_index_from_string(cols.last)
        for row in (KIND_ROW, HEAD):
            style.apply_row(ws, row, "header", 1, self.last_col, skip_cols=self.skip)
        ws[f"{cols.first_month}{KIND_ROW}"].alignment = Alignment(horizontal="center")
        ws.column_dimensions["A"].width = 46
        for c in ("B", cols.spacer):
            ws.column_dimensions[c].width = 1.6
        for i in range(3, self.last_col + 1):
            if i not in self.skip:
                ws.column_dimensions[col(i)].width = 12
        ws.freeze_panes = f"{cols.first_month}{FIRST_ROW}"
        ws.sheet_properties.outlinePr.summaryBelow = False   # the +/- button sits on the total row
        ws.sheet_view.showGridLines = False

    def row(self, label: str, role: str, cells: dict[str, object], indent: int = 0,
            formula_required=False, grouped=False):
        r = self.r
        self.ws.cell(r, 1, ("  " * indent) + label)
        for c, v in cells.items():
            cell = self.ws[f"{c}{r}"]
            cell.value = v
            cell.number_format = style.NUM
            if formula_required and v is not None:
                self.out.formula_cells.append((self.ws.title, f"{c}{r}"))
        style.apply_row(self.ws, r, role, 1, self.last_col, skip_cols=self.skip)
        if grouped:
            dim = self.ws.row_dimensions[r]
            dim.outlineLevel = 1
            dim.hidden = True
        self.r += 1
        return r

    def blank(self):
        self.r += 1


# --- profit and loss ----------------------------------------------------------------------

def _pnl_sheet(out: Rendered, model: Model, client_label: str, period_month: date):
    ws = out.workbook.create_sheet(PNL)
    cols = out.columns
    w = _Writer(out, ws, client_label, "Profit and loss (GBP) - management presentation, not statutory accounts",
                "Full year", "Year to date", "Month", month_label, month_label(period_month))
    pcol = cols.months[period_month]
    vcols = cols.value_cols(model)

    def block(b):
        top = w.r
        first, last = top + 1, top + len(b.lines)
        w.row(b.label, "subtotal", {c: f"=SUM({c}{first}:{c}{last})" for c in vcols}, formula_required=True)
        ws.row_dimensions[top].collapsed = True
        for line in b.lines:
            r = w.r
            cells = {cols.months[d]: f"=-{_src(model, out, line.account.id, 'movement', d)}" for d in model.months}
            for ye, c in cols.prior.items():
                cells[c] = f"=-{_src(model, out, line.account.id, 'year_end', ye)}"
            cells[cols.ytd] = f"=SUM({cols.first_month}{r}:{pcol}{r})"
            w.row(line.account.label, "detail", cells, indent=1, grouped=True)
        out.pnl_category_rows[b.category] = top

    def total(label, parts: list, role, key):
        refs = [out.pnl_category_rows[p] if isinstance(p, str) else p for p in parts
                if not isinstance(p, str) or p in out.pnl_category_rows]
        cells = {c: ("=" + "+".join(f"{c}{x}" for x in refs)) if refs else "=0" for c in vcols}
        w.blank()
        r = w.row(label, role, cells, formula_required=True)
        out.anchors[f"pnl.{key}"] = r
        w.blank()
        return r

    by_section = {}
    for b in model.pnl:
        by_section.setdefault(BY_KEY[b.category].section, []).append(b)
    for b in by_section.get("turnover", []) + by_section.get("cost_of_sales", []):
        block(b)
    gp = total("Gross profit", ["turnover", "cost_of_sales"], "section_total", "gross_profit")
    overheads = by_section.get("overheads", [])
    for b in overheads:
        block(b)
    toh = total("Total overheads", [b.category for b in overheads], "subtotal", "total_overheads")
    op = total("Operating profit", [gp, toh], "section_total", "operating_profit")
    finance = by_section.get("finance", [])
    for b in finance:
        block(b)
    pbt = total("Profit before taxation", [op, *[b.category for b in finance]], "section_total", "profit_before_tax")
    for b in by_section.get("taxation", []):
        block(b)
    total("Profit for the financial period", [pbt, "taxation"], "grand_total", "net_profit")
    _negatives_red(ws, cols, w.r)


# --- balance sheet ------------------------------------------------------------------------

def _bs_sheet(out: Rendered, model: Model, client_label: str, period_month: date):
    ws = out.workbook.create_sheet(BS)
    cols = out.columns
    w = _Writer(out, ws, client_label, "Balance sheet (GBP) - management presentation, not statutory accounts",
                "Year end", "Month end", "Month end", date_label, date_label(period_month))
    pcol = cols.months[period_month]
    vcols = cols.value_cols(model)
    np_row = out.anchors["pnl.net_profit"]

    def block(b):
        sign = "-" if BY_KEY[b.category].section in CREDIT_SECTIONS else ""
        top = w.r
        first, last = top + 1, top + len(b.lines)
        w.row(b.label, "subtotal", {c: f"=SUM({c}{first}:{c}{last})" for c in vcols}, formula_required=True)
        ws.row_dimensions[top].collapsed = True
        for line in b.lines:
            r = w.r
            cells = {cols.months[d]: f"={sign}{_src(model, out, line.account.id, 'closing', d)}" for d in model.months}
            for ye, c in cols.prior.items():
                cells[c] = f"={sign}{_src(model, out, line.account.id, 'year_end', ye)}"
            cells[cols.ytd] = f"={pcol}{r}"
            w.row(line.account.label, "detail", cells, indent=1, grouped=True)
            out.bs_account_rows[line.account.id] = r
        out.bs_category_rows[b.category] = top

    def total(label, parts: list[tuple[int, str]], role, key, before=True):
        cells = {}
        for c in vcols:
            expr = "".join(f"{op}{c}{r}" for r, op in parts)
            cells[c] = "=" + (expr.lstrip("+") if expr else "0")
        if before:
            w.blank()
        r = w.row(label, role, cells, formula_required=True)
        out.anchors[f"bs.{key}"] = r
        w.blank()
        return r

    by_section = {}
    for b in model.bs:
        by_section.setdefault(BY_KEY[b.category].section, []).append(b)
    rows = out.bs_category_rows
    plus = lambda keys: [(rows[k], "+") for k in keys if k in rows]

    for b in by_section.get("fixed_assets", []):
        block(b)
    fa = total("Total fixed assets", plus(["intangible_assets", "tangible_assets", "investments"]), "subtotal", "fixed_assets")
    for b in by_section.get("current_assets", []):
        block(b)
    ca = total("Total current assets", plus(["stock", "debtors", "cash"]), "subtotal", "current_assets")
    for b in by_section.get("creditors_lt1y", []):
        block(b)
    cl = [(rows["creditors_lt1y"], "-")] if "creditors_lt1y" in rows else []
    nca = total("Net current assets (liabilities)", [(ca, "+"), *cl], "section_total", "net_current_assets")
    talcl = total("Total assets less current liabilities", [(fa, "+"), (nca, "+")], "section_total", "talcl", before=False)
    for b in by_section.get("creditors_gt1y", []) + by_section.get("provisions", []):
        block(b)
    na = total("Net assets", [(talcl, "+"), *[(rows[k], "-") for k in ("creditors_gt1y", "provisions") if k in rows]],
               "grand_total", "net_assets", before=bool(by_section.get("creditors_gt1y") or by_section.get("provisions")))

    w.row("Capital and reserves", "section", {})
    for b in by_section.get("equity", []):
        block(b)
    # Current year earnings: this year's profit to each month end; at a year end, that year's profit.
    r = w.r
    cye = {cols.months[d]: f"=SUM({_q(PNL)}!${cols.first_month}${np_row}:{cols.months[d]}{np_row})" for d in model.months}
    for ye, c in cols.prior.items():
        cye[c] = f"={_q(PNL)}!{c}{np_row}"
    cye[cols.ytd] = f"={pcol}{r}"
    cye_row = w.row("Current year earnings", "subtotal", cye, formula_required=True)
    out.anchors["bs.current_year_earnings"] = cye_row
    eq = total("Total equity", [*plus(["share_capital", "retained_earnings", "other_reserves"]), (cye_row, "+")],
               "grand_total", "total_equity")
    total("Check: net assets less total equity (should be nil)", [(na, "+"), (eq, "-")], "check", "check", before=False)
    _negatives_red(ws, cols, w.r)


# --- cash flow ----------------------------------------------------------------------------

def _cf_sheet(out: Rendered, model: Model, client_label: str, period_month: date):
    """Indirect method, built only from formulas over the P&L and balance sheet.

    Each balance sheet account's movement is placed by its cash flow class
    (mapping.cash_flow_class). Depreciation and the tax charge are added back in
    operating activities and taken off again in capital expenditure and tax paid;
    retained earnings other than the period's profit are dividends. Every movement
    lands exactly once, so the statement reconciles to the movement in cash by
    construction, and the check row proves it in every column.

    Columns match the P&L and balance sheet letter for letter: each comparative
    year is the movement from the year end before it; each month is the movement
    from the previous month end; year to date adds up the months.
    """
    ws = out.workbook.create_sheet(CF)
    cols = out.columns
    w = _Writer(out, ws, client_label, "Cash flow statement (GBP) - indirect method, management presentation",
                "Full year", "Year to date", "Month", month_label, month_label(period_month))
    pcol = cols.months[period_month]
    vcols = cols.value_cols(model)
    bsq, plq, srcq = _q(BS), _q(PNL), _q(SRC)
    np_row = out.anchors["pnl.net_profit"]
    cye_row = out.anchors["bs.current_year_earnings"]
    re_row = out.bs_category_rows.get("retained_earnings")
    cash_row = out.bs_category_rows.get("cash")
    da_row = out.pnl_category_rows.get("depreciation")
    tax_row = out.pnl_category_rows.get("taxation")
    year_end_cols = _src_cols(model)["year_end"]

    # Flow columns open from the column to their left (or, for the first one, from a
    # year end on the source tab).
    prior_items = list(cols.prior.items())
    flow_cols = [c for _, c in prior_items] + [cols.months[d] for d in model.months]
    opens_from_col: dict[str, str | None] = {}
    opens_from_date: dict[str, date] = {}
    for i, (ye, c) in enumerate(prior_items):
        if i:
            opens_from_col[c] = prior_items[i - 1][1]
        else:
            opens_from_col[c], opens_from_date[c] = None, model.opening_year_end
    for i, d in enumerate(model.months):
        c = cols.months[d]
        if i:
            opens_from_col[c] = cols.months[model.months[i - 1]]
        elif prior_items:
            opens_from_col[c] = prior_items[-1][1]
        else:
            opens_from_col[c], opens_from_date[c] = None, model.prior_year_end

    lines_by_class: dict[str, list] = {}
    for b in model.bs:
        credit = BY_KEY[b.category].section in CREDIT_SECTIONS
        for line in b.lines:
            lines_by_class.setdefault(line.cash_flow, []).append((line, credit))

    def src_year_end(c, account_id, credit):
        return f"({'-' if credit else ''}{srcq}!{year_end_cols[opens_from_date[c]]}{out.src_rows[account_id]})"

    def bs_open(c, r, account_id, credit):
        oc = opens_from_col[c]
        return f"{bsq}!{oc}{r}" if oc else src_year_end(c, account_id, credit)

    def movement_terms(c, cls, categories=None):
        """Signed movement of every account in a class: liabilities and equity as
        increases, assets as decreases, because an increase in an asset uses cash."""
        terms = []
        for line, credit in lines_by_class.get(cls, []):
            if categories and line.category not in categories:
                continue
            r = out.bs_account_rows[line.account.id]
            terms.append(("+" if credit else "-") + f"({bsq}!{c}{r}-{bs_open(c, r, line.account.id, credit)})")
        return terms

    def pl(c, row):
        return f"{plq}!{c}{row}"

    def cye_open(c):
        oc = opens_from_col[c]
        if oc:
            return f"{bsq}!{oc}{cye_row}"
        if not out.src_pnl_rows:
            return "0"
        a, z = out.src_pnl_rows
        yc = year_end_cols[opens_from_date[c]]
        return f"(-SUM({srcq}!{yc}{a}:{yc}{z}))"

    def re_open(c):
        oc = opens_from_col[c]
        if oc:
            return f"{bsq}!{oc}{re_row}"
        parts = [src_year_end(c, line.account.id, True) for line, _ in lines_by_class.get("retained_earnings", [])]
        return "(" + ("+".join(parts) if parts else "0") + ")"

    section_rows: dict[str, list[int]] = {"operating": [], "investing": [], "financing": []}

    def flow(label, section, build_terms, key):
        cells, any_terms = {}, False
        for c in flow_cols:
            terms = build_terms(c)
            any_terms = any_terms or bool(terms)
            cells[c] = f"=ROUND({''.join(terms).lstrip('+')},2)" if terms else "=0"   # pence, so noise never shows as "(0)"
        if not any_terms:
            return None
        r = w.r
        cells[cols.ytd] = f"=SUM({cols.first_month}{r}:{pcol}{r})"
        w.row(label, "detail", cells, indent=1, formula_required=True)
        section_rows[section].append(r)
        out.anchors[f"cf.{key}"] = r
        return r

    def section_total(label, section, key):
        refs = section_rows[section]
        cells = {c: ("=" + "+".join(f"{c}{x}" for x in refs)) if refs else "=0" for c in vcols}
        r = w.row(label, "subtotal", cells, formula_required=True)
        out.anchors[f"cf.{key}"] = r
        w.blank()
        return r

    w.row("Cash flows from operating activities", "section", {})
    flow("Profit for the financial period", "operating", lambda c: [f"+{pl(c, np_row)}"], "profit")
    if da_row:
        flow("Depreciation and amortisation", "operating", lambda c: [f"-{pl(c, da_row)}"], "depreciation")
    if tax_row:
        flow("Taxation charge", "operating", lambda c: [f"-{pl(c, tax_row)}"], "tax_charge")
    flow("(Increase)/decrease in stock", "operating", lambda c: movement_terms(c, "working_capital", {"stock"}), "stock")
    flow("(Increase)/decrease in debtors", "operating", lambda c: movement_terms(c, "working_capital", {"debtors"}), "debtors")
    flow("Increase/(decrease) in creditors", "operating",
         lambda c: movement_terms(c, "working_capital", {"creditors_lt1y", "creditors_gt1y"}), "creditors")
    flow("Increase/(decrease) in provisions", "operating", lambda c: movement_terms(c, "provisions"), "provisions")
    flow("Taxation paid", "operating",
         lambda c: ([f"+{pl(c, tax_row)}"] if tax_row else []) + movement_terms(c, "tax"), "tax_paid")
    op = section_total("Net cash from operating activities", "operating", "operating")

    w.row("Cash flows from investing activities", "section", {})
    flow("Purchase of fixed assets", "investing",
         lambda c: movement_terms(c, "capex") + ([f"+{pl(c, da_row)}"] if da_row else []), "capex")
    flow("Purchase of investments", "investing", lambda c: movement_terms(c, "investments"), "investments")
    inv = section_total("Net cash from investing activities", "investing", "investing")

    w.row("Cash flows from financing activities", "section", {})
    flow("Loans", "financing", lambda c: movement_terms(c, "loans"), "loans")
    flow("Share capital and other reserves", "financing", lambda c: movement_terms(c, "equity"), "equity")

    def dividends(c):
        # Retained earnings and current year earnings together move by the period's
        # profit; anything else is a distribution.
        re_close = f"{bsq}!{c}{re_row}" if re_row else "0"
        re_o = re_open(c) if re_row else "0"
        return movement_terms(c, "dividends") + [
            f"+({re_close}+{bsq}!{c}{cye_row}-{re_o}-{cye_open(c)}-{pl(c, np_row)})"]

    flow("Dividends paid", "financing", dividends, "dividends")
    fin = section_total("Net cash from financing activities", "financing", "financing")

    net = w.row("Net increase/(decrease) in cash", "section_total",
                {c: f"={c}{op}+{c}{inv}+{c}{fin}" for c in vcols}, formula_required=True)
    out.anchors["cf.net_change"] = net
    w.blank()

    def cash_at_start(c):
        if not cash_row:
            return "=0"
        if c == cols.ytd:     # the year opens where its first month opens
            c = cols.months[model.months[0]]
        oc = opens_from_col[c]
        if oc:
            return f"={bsq}!{oc}{cash_row}"
        parts = [src_year_end(c, line.account.id, False) for line, _ in lines_by_class.get("cash", [])]
        return "=" + ("+".join(parts) if parts else "0")

    start = w.row("Cash at beginning of period", "subtotal", {c: cash_at_start(c) for c in vcols}, formula_required=True)
    end = w.row("Cash at end of period", "grand_total", {c: f"={c}{start}+{c}{net}" for c in vcols}, formula_required=True)
    out.anchors["cf.cash_end"] = end
    w.blank()
    if cash_row:
        # Same letters as the balance sheet, whose year-to-date column is this month end.
        chk = w.row("Check: cash per balance sheet less cash at end of period (should be nil)", "check",
                    {c: f"=ROUND({bsq}!{c}{cash_row}-{c}{end},2)" for c in vcols}, formula_required=True)
        out.anchors["cf.check"] = chk
    _negatives_red(ws, cols, w.r)


# --- shared ---------------------------------------------------------------------------------

def _negatives_red(ws, cols: Columns, last_row):
    ws.conditional_formatting.add(
        f"C{FIRST_ROW}:{cols.last}{last_row}",
        CellIsRule(operator="lessThan", formula=["0"], font=Font(color=style.NEGATIVE_RED)))


def _define_names(out: Rendered):
    """PL_NET_PROFIT_YTD, BS_NET_ASSETS_CURRENT, CF_NET_CHANGE_PRIOR (latest comparative year)..."""
    wb, cols = out.workbook, out.columns
    sheets = {"pnl": (PNL, "PL", "YTD"), "bs": (BS, "BS", "CURRENT"), "cf": (CF, "CF", "YTD")}
    latest_prior = list(cols.prior.values())[-1] if cols.prior else None
    for key, r in out.anchors.items():
        prefix_key, base = key.split(".", 1)
        sheet, prefix, current = sheets[prefix_key]
        targets = [(current, cols.ytd)] + ([("PRIOR", latest_prior)] if latest_prior else [])
        for suffix, c in targets:
            name = f"{prefix}_{base.upper()}_{suffix}"
            wb.defined_names[name] = DefinedName(name, attr_text=f"{_q(sheet)}!${c}${r}")


def render_statements(model: Model, ledger, *, client_label: str, period_month: date) -> Rendered:
    wb = Workbook()
    wb.remove(wb.active)
    out = Rendered(workbook=wb, columns=Columns.plan(model))
    wb.create_sheet("Contents")
    _source_sheet(out, model, ledger)
    _pnl_sheet(out, model, client_label, period_month)
    _bs_sheet(out, model, client_label, period_month)
    _cf_sheet(out, model, client_label, period_month)
    wb.move_sheet(SRC, offset=len(wb.sheetnames))
    _define_names(out)
    return out

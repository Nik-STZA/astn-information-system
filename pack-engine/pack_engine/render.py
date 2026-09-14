"""Workbook renderer.

Rules:
  - The only typed numbers are on "Source - Trial balance" (Xero trial balance
    figures, debit minus credit). Every figure on the statements is a formula,
    and every subtotal and total is a formula.
  - No hardcoded row numbers: rows are assigned while writing, and the rows other
    sheets need are recorded as anchors and Excel defined names.
  - Months after the reporting month are left blank.

Layout on every statement: A label | B spacer | C/D/E headline columns | F spacer
| G-R the twelve months of the financial year. Two heading rows: row 3 says what
a column is (Month, Year to date, Prior year...), row 4 gives its period in one
format for the whole sheet. Panes freeze at G5. Each category shows as one total
row; its accounts are grouped beneath it, collapsed, and expand with the outline
buttons.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font
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
MONTH_COL0 = 7          # G
KIND_ROW, HEAD = 3, 4   # the two heading rows
FIRST_ROW = 5
SRC_FIRST_VALUE_COL = 8  # H


@dataclass
class Rendered:
    workbook: Workbook
    anchors: dict[str, int] = field(default_factory=dict)          # "pnl.net_profit" -> row
    formula_cells: list[tuple[str, str]] = field(default_factory=list)
    pnl_category_rows: dict[str, int] = field(default_factory=dict)
    bs_category_rows: dict[str, int] = field(default_factory=dict)
    bs_account_rows: dict[str, int] = field(default_factory=dict)
    src_rows: dict[str, int] = field(default_factory=dict)
    src_pnl_rows: tuple[int, int] | None = None


def _q(sheet: str) -> str:
    return f"'{sheet}'"


def _month_cols(model: Model) -> dict[date, str]:
    return {d: col(MONTH_COL0 + i) for i, d in enumerate(model.fy_months)}


def _src_col(model: Model, kind: str, month: date | None = None) -> str:
    """Column letter on the source tab. kind: movement | closing | prior | prior2."""
    n = len(model.fy_months)
    if kind == "prior":
        return col(SRC_FIRST_VALUE_COL + 2 * n)
    if kind == "prior2":
        return col(SRC_FIRST_VALUE_COL + 2 * n + 1)
    i = model.fy_months.index(month)
    return col(SRC_FIRST_VALUE_COL + i if kind == "movement" else SRC_FIRST_VALUE_COL + n + i)


class _Writer:
    def __init__(self, out: Rendered, ws, title: str, subtitle: str,
                 kinds: tuple[str, str, str, str], periods: list[str]):
        """kinds: labels for C, D, E and the monthly block; periods: C, D, E then 12 months."""
        self.out, self.ws, self.r = out, ws, FIRST_ROW
        ws["A1"], ws["A2"] = title, subtitle
        ws["A1"].font, ws["A2"].font = style.ROW_STYLES["title"]["font"], style.ROW_STYLES["subtitle"]["font"]
        last = MONTH_COL0 + 11
        for c, text in zip("CDE", kinds[:3]):
            ws[f"{c}{KIND_ROW}"] = text
        ws.cell(KIND_ROW, MONTH_COL0, kinds[3])
        ws.merge_cells(start_row=KIND_ROW, start_column=MONTH_COL0, end_row=KIND_ROW, end_column=last)
        for c, text in zip("CDE", periods[:3]):
            ws[f"{c}{HEAD}"] = text
        for i, text in enumerate(periods[3:]):
            ws.cell(HEAD, MONTH_COL0 + i, text)
        for row in (KIND_ROW, HEAD):
            style.apply_row(ws, row, "header", 1, last, skip_cols=(2, 6))
        ws.cell(KIND_ROW, MONTH_COL0).alignment = Alignment(horizontal="center")
        ws.column_dimensions["A"].width = 46
        for c in ("B", "F"):
            ws.column_dimensions[c].width = 1.6
        for i in range(3, last + 1):
            if i != 6:
                ws.column_dimensions[col(i)].width = 12
        ws.freeze_panes = "G5"
        # Group totals sit above their accounts, so the +/- button is on the total.
        ws.sheet_properties.outlinePr.summaryBelow = False
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
        style.apply_row(self.ws, r, role, 1, MONTH_COL0 + 11, skip_cols=(2, 6))
        if grouped:
            dim = self.ws.row_dimensions[r]
            dim.outlineLevel = 1
            dim.hidden = True
        self.r += 1
        return r

    def blank(self):
        self.r += 1


def _headline_periods(model: Model, period_month: date, fmt) -> list[str]:
    return [fmt(period_month), fmt(period_month), fmt(model.prior_year_end)] + [fmt(d) for d in model.fy_months]


# --- source ------------------------------------------------------------------------

def _source_sheet(out: Rendered, model: Model, ledger):
    ws = out.workbook.create_sheet(SRC)
    ws["A1"] = "Source - Trial balance"
    ws["A1"].font = style.ROW_STYLES["title"]["font"]
    ws["A2"] = ("The only typed numbers in the pack: Xero trial balances via stza-finance-api, debit minus "
                "credit. Movement is the month; closing is the balance sheet balance, or the year to date for "
                "profit and loss accounts. Every statement figure is a formula over this tab.")
    ws["A2"].font = style.ROW_STYLES["note"]["font"]
    head = ["Code", "Account", "Xero class", "Xero type", "Reporting code", "Category", "Xero account ID"]
    head += [f"Movement {month_label(d)}" for d in model.fy_months]
    head += [f"Closing {month_label(d)}" for d in model.fy_months]
    pp = ledger.prior_prior_year_end
    head += [f"Closing or YTD {date_label(model.prior_year_end)}",
             f"Closing or YTD {date_label(pp)}" if pp else "Year end before last"]
    for i, h in enumerate(head, start=1):
        ws.cell(HEAD, i, h)
    style.apply_row(ws, HEAD, "header", 1, len(head), text_cols=range(1, 8))
    ws.column_dimensions["B"].width = 38
    ws.column_dimensions["G"].width = 38
    ws.freeze_panes = "H5"
    n = len(model.fy_months)
    r = FIRST_ROW
    pnl_first = pnl_last = None
    for b in [*model.pnl, *model.bs]:
        for line in b.lines:
            a = line.account
            for i, v in enumerate([a.code, a.name, a.klass, a.type, a.reporting_code,
                                   BY_KEY[b.category].label, a.id], start=1):
                ws.cell(r, i, v)
            for i, d in enumerate(model.fy_months):
                if d in model.months:
                    ws.cell(r, SRC_FIRST_VALUE_COL + i, ledger.movement(a.id, d)).number_format = style.NUM_2DP
                    ws.cell(r, SRC_FIRST_VALUE_COL + n + i, ledger.closing(a.id, d)).number_format = style.NUM_2DP
            ws.cell(r, SRC_FIRST_VALUE_COL + 2 * n, ledger.closing(a.id, model.prior_year_end)).number_format = style.NUM_2DP
            ws.cell(r, SRC_FIRST_VALUE_COL + 2 * n + 1,
                    ledger.closing(a.id, pp) if pp else 0.0).number_format = style.NUM_2DP
            out.src_rows[a.id] = r
            if a.is_pnl:
                pnl_first = pnl_first or r
                pnl_last = r
            r += 1
    out.src_pnl_rows = (pnl_first, pnl_last) if pnl_first else None


def _src(model, out, account_id, kind, month=None) -> str:
    return f"{_q(SRC)}!{_src_col(model, kind, month)}{out.src_rows[account_id]}"


# --- profit and loss ------------------------------------------------------------------

def _pnl_sheet(out: Rendered, model: Model, client_label: str, period_month: date):
    ws = out.workbook.create_sheet(PNL)
    mcols = _month_cols(model)
    pcol = mcols[period_month]
    w = _Writer(out, ws, client_label, "Profit and loss (GBP) - management presentation, not statutory accounts",
                ("Month", "Year to date", "Prior year", "Month"),
                _headline_periods(model, period_month, month_label))
    cols = ["C", "D", "E", *(mcols[d] for d in model.months)]

    def block(b):
        top = w.r
        first, last = top + 1, top + len(b.lines)
        w.row(b.label, "subtotal", {c: f"=SUM({c}{first}:{c}{last})" for c in cols}, formula_required=True)
        ws.row_dimensions[top].collapsed = True
        for line in b.lines:
            r = w.r
            cells = {mcols[d]: f"=-{_src(model, out, line.account.id, 'movement', d)}" for d in model.months}
            cells.update({"C": f"={pcol}{r}", "D": f"=SUM(G{r}:{pcol}{r})",
                          "E": f"=-{_src(model, out, line.account.id, 'prior')}"})
            w.row(line.account.label, "detail", cells, indent=1, grouped=True)
        out.pnl_category_rows[b.category] = top

    def total(label, parts: list, role, key):
        refs = [out.pnl_category_rows[p] if isinstance(p, str) else p for p in parts
                if not isinstance(p, str) or p in out.pnl_category_rows]
        cells = {c: ("=" + "+".join(f"{c}{x}" for x in refs)) if refs else "=0" for c in cols}
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
    _negatives_red(ws, w.r)
    return mcols


# --- balance sheet --------------------------------------------------------------------

def _bs_sheet(out: Rendered, model: Model, client_label: str, period_month: date, mcols):
    ws = out.workbook.create_sheet(BS)
    pcol = mcols[period_month]
    idx = model.fy_months.index(period_month)
    prior_month = model.fy_months[idx - 1] if idx > 0 else model.prior_year_end
    prior_col = mcols[model.fy_months[idx - 1]] if idx > 0 else "E"
    periods = [date_label(period_month), date_label(prior_month), date_label(model.prior_year_end)] + \
              [date_label(d) for d in model.fy_months]
    w = _Writer(out, ws, client_label, "Balance sheet (GBP) - management presentation, not statutory accounts",
                ("Month end", "Prior month end", "Prior year end", "Month end"), periods)
    cols = ["C", "D", "E", *(mcols[d] for d in model.months)]
    np_row = out.anchors["pnl.net_profit"]

    def block(b):
        sign = "-" if BY_KEY[b.category].section in CREDIT_SECTIONS else ""
        top = w.r
        first, last = top + 1, top + len(b.lines)
        w.row(b.label, "subtotal", {c: f"=SUM({c}{first}:{c}{last})" for c in cols}, formula_required=True)
        ws.row_dimensions[top].collapsed = True
        for line in b.lines:
            r = w.r
            cells = {mcols[d]: f"={sign}{_src(model, out, line.account.id, 'closing', d)}" for d in model.months}
            cells.update({"C": f"={pcol}{r}", "D": f"={prior_col}{r}",
                          "E": f"={sign}{_src(model, out, line.account.id, 'prior')}"})
            w.row(line.account.label, "detail", cells, indent=1, grouped=True)
            out.bs_account_rows[line.account.id] = r
        out.bs_category_rows[b.category] = top

    def total(label, parts: list[tuple[int, str]], role, key, before=True):
        cells = {}
        for c in cols:
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
    cye_cells = {mcols[d]: f"=SUM({_q(PNL)}!$G${np_row}:{mcols[d]}{np_row})" for d in model.months}
    cye_cells.update({"C": f"={pcol}{w.r}", "D": f"={prior_col}{w.r}", "E": f"={_q(PNL)}!$E${np_row}"})
    cye = w.row("Current year earnings", "subtotal", cye_cells, formula_required=True)
    out.anchors["bs.current_year_earnings"] = cye
    eq = total("Total equity", [*plus(["share_capital", "retained_earnings", "other_reserves"]), (cye, "+")],
               "grand_total", "total_equity")
    total("Check: net assets less total equity (should be nil)", [(na, "+"), (eq, "-")], "check", "check", before=False)
    _negatives_red(ws, w.r)
    return prior_col


# --- cash flow ------------------------------------------------------------------------

def _cf_sheet(out: Rendered, model: Model, client_label: str, period_month: date, mcols, bs_prior_col: str):
    """Indirect method, built only from formulas over the P&L and balance sheet.

    Each balance sheet account's movement is placed by its cash flow class
    (mapping.cash_flow_class). Depreciation and the tax charge are added back
    in operating activities and taken off again in capital expenditure and tax
    paid, and retained earnings other than the period's profit are treated as
    dividends, so every movement lands exactly once and the statement
    reconciles to the movement in cash by construction; the check row proves it.
    """
    ws = out.workbook.create_sheet(CF)
    pcol = mcols[period_month]
    w = _Writer(out, ws, client_label, "Cash flow statement (GBP) - indirect method, management presentation",
                ("Month", "Year to date", "Prior year", "Month"),
                _headline_periods(model, period_month, month_label))
    months = model.months
    month_cols = [mcols[d] for d in months]
    bsq, plq, srcq = _q(BS), _q(PNL), _q(SRC)
    np_row = out.anchors["pnl.net_profit"]
    cye_row = out.anchors["bs.current_year_earnings"]
    re_row = out.bs_category_rows.get("retained_earnings")
    cash_row = out.bs_category_rows.get("cash")
    da_row = out.pnl_category_rows.get("depreciation")
    tax_row = out.pnl_category_rows.get("taxation")
    ppcol = _src_col(model, "prior2")

    lines_by_class: dict[str, list] = {}
    for b in model.bs:
        credit = BY_KEY[b.category].section in CREDIT_SECTIONS
        for line in b.lines:
            lines_by_class.setdefault(line.cash_flow, []).append((line, credit))

    def opening_col(c: str) -> str:
        i = month_cols.index(c)
        return month_cols[i - 1] if i > 0 else "E"

    def bs_close(c, r):
        return f"{bsq}!{c}{r}"

    def bs_open(c, r, account_id, credit):
        if c == "E":        # prior year: opening is the year end before last, from the source tab
            return f"({'-' if credit else ''}{srcq}!{ppcol}{out.src_rows[account_id]})"
        return f"{bsq}!{opening_col(c)}{r}"

    def movement_terms(c, cls, categories=None):
        """Signed movement of every account in a class (optionally only some
        categories): liabilities and equity as increases, assets as decreases,
        because an increase in an asset uses cash."""
        terms = []
        for line, credit in lines_by_class.get(cls, []):
            if categories and line.category not in categories:
                continue
            r = out.bs_account_rows[line.account.id]
            delta = f"({bs_close(c, r)}-{bs_open(c, r, line.account.id, credit)})"
            terms.append(("+" if credit else "-") + delta)
        return terms

    def pl(c, row):
        return f"{plq}!{c}{row}"

    def cye_open(c):
        if c == "E":
            if not out.src_pnl_rows:
                return "0"
            a, z = out.src_pnl_rows
            return f"(-SUM({srcq}!{ppcol}{a}:{ppcol}{z}))"
        return f"{bsq}!{opening_col(c)}{cye_row}"

    section_rows: dict[str, list[int]] = {"operating": [], "investing": [], "financing": []}

    def flow(label, section, build_terms, key):
        """A flow line: monthly and prior-year columns from terms; C and D from the months."""
        cells = {}
        any_terms = False
        for c in [*month_cols, "E"]:
            terms = build_terms(c)
            if terms:
                any_terms = True
            # Rounded to pence so floating-point noise never shows as "(0)".
            cells[c] = f"=ROUND({''.join(terms).lstrip('+')},2)" if terms else "=0"
        if not any_terms:
            return None
        r = w.r
        cells.update({"C": f"={pcol}{r}", "D": f"=SUM(G{r}:{pcol}{r})"})
        w.row(label, "detail", cells, indent=1, formula_required=True)
        section_rows[section].append(r)
        out.anchors[f"cf.{key}"] = r
        return r

    def section_total(label, section, key):
        cols = ["C", "D", "E", *month_cols]
        refs = section_rows[section]
        cells = {c: ("=" + "+".join(f"{c}{x}" for x in refs)) if refs else "=0" for c in cols}
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
    flow("(Increase)/decrease in stock", "operating",
         lambda c: movement_terms(c, "working_capital", {"stock"}), "stock")
    flow("(Increase)/decrease in debtors", "operating",
         lambda c: movement_terms(c, "working_capital", {"debtors"}), "debtors")
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
        terms = movement_terms(c, "dividends")
        # Retained earnings and current year earnings together move by the period's
        # profit; anything else is a distribution.
        re_close = bs_close(c, re_row) if re_row else "0"
        if re_row:
            if c == "E":
                re_open = "(" + "+".join(f"(-{srcq}!{ppcol}{out.src_rows[line.account.id]})"
                                         for line, _ in lines_by_class.get("retained_earnings", [])) + ")"
            else:
                re_open = f"{bsq}!{opening_col(c)}{re_row}"
        else:
            re_open = "0"
        terms.append(f"+({re_close}+{bs_close(c, cye_row)}-{re_open}-{cye_open(c)}-{pl(c, np_row)})")
        return terms

    flow("Dividends paid", "financing", dividends, "dividends")
    fin = section_total("Net cash from financing activities", "financing", "financing")

    cols = ["C", "D", "E", *month_cols]
    net = w.row("Net increase/(decrease) in cash", "section_total",
                {c: f"={c}{op}+{c}{inv}+{c}{fin}" for c in cols}, formula_required=True)
    out.anchors["cf.net_change"] = net
    w.blank()

    def cash_at_start(c):
        if not cash_row:
            return "=0"
        if c == "C":        # the balance sheet's own prior month end column
            return f"={bsq}!D{cash_row}"
        if c == "D":
            return f"={bsq}!E{cash_row}"
        if c == "E":
            parts = [f"{srcq}!{ppcol}{out.src_rows[line.account.id]}" for line, _ in lines_by_class.get("cash", [])]
            return "=" + ("+".join(parts) if parts else "0")
        return f"={bsq}!{opening_col(c)}{cash_row}"

    start = w.row("Cash at beginning of period", "subtotal", {c: cash_at_start(c) for c in cols}, formula_required=True)
    end = w.row("Cash at end of period", "grand_total", {c: f"={c}{start}+{c}{net}" for c in cols}, formula_required=True)
    out.anchors["cf.cash_end"] = end
    w.blank()
    if cash_row:
        # The period's closing cash is in the balance sheet's month end column (C),
        # both for the month and for the year to date; the prior year is column E.
        bs_col = lambda c: "C" if c in ("C", "D") else c
        chk = w.row("Check: cash per balance sheet less cash at end of period (should be nil)", "check",
                    {c: f"=ROUND({bsq}!{bs_col(c)}{cash_row}-{c}{end},2)" for c in cols}, formula_required=True)
        out.anchors["cf.check"] = chk
    _negatives_red(ws, w.r)


# --- shared -----------------------------------------------------------------------------

def _negatives_red(ws, last_row):
    ws.conditional_formatting.add(
        f"C{FIRST_ROW}:R{last_row}", CellIsRule(operator="lessThan", formula=["0"], font=Font(color=style.NEGATIVE_RED)))


def _define_names(out: Rendered):
    wb = out.workbook
    sheets = {"pnl": (PNL, "PL", ("MONTH", "YTD", "PRIOR")),
              "bs": (BS, "BS", ("MONTH", "PRIOR_MONTH", "PRIOR")),
              "cf": (CF, "CF", ("MONTH", "YTD", "PRIOR"))}
    for key, r in out.anchors.items():
        prefix_key, base = key.split(".", 1)
        sheet, prefix, suffixes = sheets[prefix_key]
        for suffix, c in zip(suffixes, "CDE"):
            name = f"{prefix}_{base.upper()}_{suffix}"
            wb.defined_names[name] = DefinedName(name, attr_text=f"{_q(sheet)}!${c}${r}")


def render_statements(model: Model, ledger, *, client_label: str, fy: str, prior_fy: str,
                      period_month: date) -> Rendered:
    wb = Workbook()
    wb.remove(wb.active)
    out = Rendered(workbook=wb)
    wb.create_sheet("Contents")
    _source_sheet(out, model, ledger)
    mcols = _pnl_sheet(out, model, client_label, period_month)
    bs_prior_col = _bs_sheet(out, model, client_label, period_month, mcols)
    _cf_sheet(out, model, client_label, period_month, mcols, bs_prior_col)
    wb.move_sheet(SRC, offset=len(wb.sheetnames))
    _define_names(out)
    return out

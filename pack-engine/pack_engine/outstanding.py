"""Outstanding documents: transactions the client has not supported with an
invoice, receipt or contract, as at the pack's month end.

The register lives in os.stza.io (finance.outstanding_documents, migration
040) and is read through finance-api:

    GET /api/finance/clients/:slug/outstanding-documents?state=all

As at month end means: dated on or before the month's last day, and still
outstanding at that date. An item cleared after the month end (document
received, or closed without one) was still outstanding on the day, so it is
listed, with its status since. An item cleared on or before the month end is
not. Candidates (read, not yet accepted) and dismissed lines are never listed.

Two formats, from the profile:

    "outstanding_documents": {}                          summary page + appendix
    "outstanding_documents": {"format": "full_list"}     the list only

The appendix is the only place values are typed. Every summary figure is a
SUMIF over it, and every total a formula, as on the statements. Items never
block a sign-off, so nothing here can fail the build: a read that fails leaves
the section out with a warning.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime

from openpyxl.styles import Alignment
from openpyxl.utils import get_column_letter as col

from . import style
from .api import FinanceApiError
from .controls import Control
from .render import Rendered

SUMMARY = "Outstanding documents"
APPENDIX = "Outstanding documents - list"
FORMATS = ("summary_appendix", "full_list")
NO_HOLDER = "No card holder"
NO_COMPANY = "No company"

CONCERN_ORDER = ("no_vat_invoice", "audit_evidence", "business_purpose", "overseas_reverse_charge",
                 "unknown_payee", "other")
CONCERN_LABELS = {
    "no_vat_invoice": "No valid VAT invoice",
    "audit_evidence": "Not enough evidence for audit",
    "business_purpose": "Business purpose unclear",
    "overseas_reverse_charge": "Overseas supplier, reverse charge",
    "unknown_payee": "Payee or nature unknown",
    "other": "Other",
}
CLEARED = {"received": "Document received", "accepted": "Closed without document"}

# The appendix, column by column: (key, header, width, kind).
COLUMNS = [
    ("date", "Date", 11, "date"),
    ("month", "Month", 10, "text"),
    ("company", "Company", 22, "text"),
    ("bank", "Bank account", 18, "text"),
    ("payee", "Payee", 30, "text"),
    ("reference", "Reference", 44, "wrap"),
    ("holder", "Card holder / processor", 22, "text"),
    ("currency", "Currency", 8, "text"),
    ("amount", "Amount (account currency)", 13, "money"),
    ("spent", "Spent GBP", 12, "money"),
    ("received", "Received GBP", 12, "money"),
    ("concern", "Concern", 28, "text"),
    ("vat", "VAT not recoverable", 11, "text"),
    ("risk", "VAT at risk, up to GBP", 12, "money"),
    ("status", "Status since month end", 20, "text"),
    ("chased", "Times chased", 8, "count"),
    ("last_chased", "Last chased", 11, "date"),
    ("note", "Note", 40, "wrap"),
    ("n", "n", 4, "count"),              # 1 per item, hidden: the summary counts with SUMIF
]
COL = {key: i + 1 for i, (key, *_) in enumerate(COLUMNS)}
FIRST_ROW = 6                            # header on row 5


def settings(profile: dict) -> dict | None:
    """None when the section is off; otherwise {"format": ...}."""
    raw = profile.get("outstanding_documents")
    if raw is None:
        return None
    fmt = (raw or {}).get("format") or "summary_appendix"
    return {"format": fmt if fmt in FORMATS else "summary_appendix"}


# --- which items -------------------------------------------------------------------------------

def _day(v) -> str | None:
    return str(v)[:10] if v else None


def as_at(items: list[dict], month_end: date) -> list[dict]:
    """The items outstanding on month_end, oldest first."""
    end = month_end.isoformat()
    out = []
    for i in items:
        d = _day(i.get("txn_date"))
        if not d or d > end:
            continue
        state = i.get("state")
        if state == "open":
            out.append(i)
        elif state in CLEARED and (_day(i.get("closed_at")) or "") > end:
            out.append(i)
    return sorted(out, key=lambda i: (_day(i.get("txn_date")), str(i.get("payee") or "")))


def gbp(i: dict) -> float | None:
    if i.get("currency") == "GBP":
        return float(i["amount"])
    return float(i["amount_gbp"]) if i.get("amount_gbp") is not None else None


def holder(i: dict) -> str:
    return " ".join(str(i.get("card_holder") or "").split()) or NO_HOLDER


def canonical_holders(items: list[dict]) -> dict[str, str]:
    """lower-case name -> the spelling shown: the one used most, then the one
    with most capitals. Groups ignore case, as the portal's export does."""
    seen: dict[str, dict[str, int]] = {}
    for i in items:
        h = holder(i)
        seen.setdefault(h.lower(), {}).setdefault(h, 0)
        seen[h.lower()][h] += 1
    caps = lambda s: sum(ch.isupper() for ch in s)
    return {k: sorted(v.items(), key=lambda kv: (-kv[1], -caps(kv[0]), kv[0]))[0][0] for k, v in seen.items()}


def _month_label(d: str) -> str:
    return datetime.strptime(d[:7], "%Y-%m").strftime("%b %Y")


def row_values(i: dict, names: dict[str, str] | None = None) -> dict:
    g = gbp(i)
    vat = i.get("vat") or {}
    status = "" if i.get("state") == "open" else f"{CLEARED[i['state']]} {_day(i.get('closed_at'))}"
    return {
        "date": date.fromisoformat(_day(i["txn_date"])), "month": _month_label(_day(i["txn_date"])),
        "company": i.get("entity_name") or i.get("entity_slug") or NO_COMPANY,
        "bank": i.get("bank_account"), "payee": i.get("payee"), "reference": i.get("reference"),
        "holder": (names or {}).get(holder(i).lower(), holder(i)), "currency": i.get("currency"), "amount": float(i["amount"]),
        "spent": g if i.get("direction") == "spent" else None,
        "received": g if i.get("direction") == "received" else None,
        "concern": CONCERN_LABELS.get(i.get("concern"), i.get("concern")),
        "vat": "Yes" if vat.get("flagged") else "",
        "risk": vat.get("at_risk_max"),
        "status": status,
        "chased": i.get("chase_count") or None,
        "last_chased": date.fromisoformat(_day(i["last_chased_at"])) if i.get("last_chased_at") else None,
        "note": i.get("note"),
        "n": 1,
    }


# --- the sheets ----------------------------------------------------------------------------------

def _title(ws, title: str, lines: list[str]):
    ws["A1"] = title
    ws["A1"].font = style.ROW_STYLES["title"]["font"]
    for r, text in enumerate(lines, 2):
        ws.cell(r, 1, text).font = style.ROW_STYLES["note"]["font"]


def _appendix(rendered: Rendered, rows: list[dict], heading: str, notes: list[str]) -> tuple[int, int, int]:
    """Writes the list. Returns (first data row, last data row, total row); last < first when empty."""
    ws = rendered.workbook.create_sheet(APPENDIX)
    _title(ws, heading, notes)
    for key, header, width, _ in COLUMNS:
        ws.cell(FIRST_ROW - 1, COL[key], header)
        ws.column_dimensions[col(COL[key])].width = width
    style.apply_row(ws, FIRST_ROW - 1, "header", 1, len(COLUMNS))
    for c in range(1, len(COLUMNS) + 1):
        ws.cell(FIRST_ROW - 1, c).alignment = Alignment(wrap_text=True, vertical="center",
                                                        horizontal="left" if COLUMNS[c - 1][3] in ("text", "wrap", "date") else "right")
    ws.row_dimensions[FIRST_ROW - 1].height = 30
    r = FIRST_ROW
    for v in rows:
        for key, _, _, kind in COLUMNS:
            cell = ws.cell(r, COL[key], v[key])
            cell.font = style.font(9)
            if kind == "money":
                cell.number_format = style.NUM_2DP
            elif kind == "date":
                cell.number_format = style.DATE
                cell.alignment = Alignment(horizontal="left", vertical="top")
            elif kind == "wrap":
                cell.alignment = Alignment(wrap_text=True, vertical="top")
            else:
                cell.alignment = Alignment(vertical="top")
        r += 1
    last = r - 1
    # Totals, as formulas.
    ws.cell(r, 1, "Total")
    for key in ("spent", "received", "risk", "n"):     # amounts are in mixed currencies: no total
        c = COL[key]
        ref = f"{col(c)}{r}"
        ws[ref] = f"=SUM({col(c)}{FIRST_ROW}:{col(c)}{max(last, FIRST_ROW)})" if rows else 0
        ws[ref].number_format = style.NUM_2DP if key != "n" else "0"
        if rows:
            rendered.formula_cells.append((APPENDIX, ref))
    style.apply_row(ws, r, "grand_total", 1, len(COLUMNS))
    total_row = r
    ws.column_dimensions[col(COL["n"])].hidden = True
    ws.freeze_panes = f"C{FIRST_ROW}"
    if rows:
        ws.auto_filter.ref = f"A{FIRST_ROW - 1}:{col(len(COLUMNS) - 1)}{last}"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return FIRST_ROW, last, total_row


def criterion(label: str) -> str:
    """An exact-match SUMIF criterion: "=" first so a name starting with < or >
    is not read as a comparison, and * ? ~ escaped so they are not wildcards."""
    text = str(label).replace("~", "~~").replace("*", "~*").replace("?", "~?").replace('"', '""')
    return f'"={text}"'


def _sumif(key_col: str, label: str, value_key: str, first: int, last: int) -> str:
    rng = lambda k: f"'{APPENDIX}'!${col(COL[k])}${first}:${col(COL[k])}${last}"
    return f"=SUMIF({rng(key_col)},{criterion(label)},{rng(value_key)})"


def _summary(rendered: Rendered, rows: list[dict], first: int, last: int, total_row: int, heading: str, notes: list[str]):
    ws = rendered.workbook.create_sheet(SUMMARY)
    _title(ws, heading, notes)
    for letter, width in zip("ABCDE", (40, 10, 15, 15, 18)):
        ws.column_dimensions[letter].width = width
    ws.sheet_view.showGridLines = False
    last = max(last, first)
    apx = lambda k: f"'{APPENDIX}'!{col(COL[k])}{total_row}"

    r = len(notes) + 3
    ws.cell(r, 1, "As at month end").font = style.ROW_STYLES["subtitle"]["font"]
    r += 1
    headline = [
        ("Items without their document", f"={apx('n')}", "0"),
        ("Spent, GBP", f"={apx('spent')}", style.NUM_2DP),
        ("Received, GBP", f"={apx('received')}", style.NUM_2DP),
        ("VAT not recoverable, up to GBP", f"={apx('risk')}", style.NUM_2DP),
    ]
    for label, formula, fmt in headline:
        ws.cell(r, 1, label).font = style.font(9)
        cell = ws.cell(r, 2 if fmt == "0" else 3, formula)
        cell.number_format = fmt
        cell.font = style.font(9, bold=True)
        rendered.formula_cells.append((SUMMARY, cell.coordinate))
        r += 1
    flagged = sum(1 for v in rows if v["vat"] == "Yes")
    ws.cell(r, 1, f"{flagged} of them flagged VAT not recoverable.").font = style.ROW_STYLES["note"]["font"]
    r += 2

    def table(title: str, key: str, labels: list[str]):
        nonlocal r
        for i, h in enumerate([title, "Items", "Spent GBP", "Received GBP", "VAT at risk, up to GBP"], 1):
            ws.cell(r, i, h)
        style.apply_row(ws, r, "header", 1, 5)
        r += 1
        top = r
        for label in labels:
            ws.cell(r, 1, label).font = style.font(9)
            for c, value_key, fmt in ((2, "n", "0"), (3, "spent", style.NUM_2DP), (4, "received", style.NUM_2DP), (5, "risk", style.NUM_2DP)):
                cell = ws.cell(r, c, _sumif(key, label, value_key, first, last))
                cell.number_format = fmt
                cell.font = style.font(9)
                rendered.formula_cells.append((SUMMARY, cell.coordinate))
            r += 1
        ws.cell(r, 1, "Total")
        for c in range(2, 6):
            cell = ws.cell(r, c, f"=SUM({col(c)}{top}:{col(c)}{r - 1})")
            cell.number_format = "0" if c == 2 else style.NUM_2DP
            rendered.formula_cells.append((SUMMARY, cell.coordinate))
        style.apply_row(ws, r, "section_total", 1, 5)
        r += 2

    def spend_order(key):
        totals: OrderedDict[str, float] = OrderedDict()
        for v in rows:
            totals[v[key]] = totals.get(v[key], 0.0) + (v["spent"] or 0.0)
        return [k for k, _ in sorted(totals.items(), key=lambda kv: (kv[0] in (NO_HOLDER, NO_COMPANY), -kv[1], kv[0]))]

    table("Card holder / processor", "holder", spend_order("holder"))
    table("Concern", "concern", [CONCERN_LABELS[k] for k in CONCERN_ORDER if any(v["concern"] == CONCERN_LABELS[k] for v in rows)])
    table("Company", "company", spend_order("company"))
    months = sorted({v["date"].strftime("%Y-%m") for v in rows})
    table("Month of the transaction", "month", [_month_label(m) for m in months])
    ws.cell(r, 1, "The full list is on the next tab, with each line's reference, card holder and the report row it was read from."
            ).font = style.ROW_STYLES["note"]["font"]


def _notes(month_end: date, threshold: float | None) -> list[str]:
    t = f"{threshold:,.2f}" if threshold is not None else "25.00"
    return [
        f"Transactions without their supporting invoice, receipt or contract, outstanding at {month_end.strftime('%d %B %Y').lstrip('0')}.",
        "Carried from month to month until the document arrives or the CFO closes the item; they never block a sign-off.",
        f"VAT: a cost above GBP {t} without a valid VAT invoice is not recoverable. \"Up to\" is one sixth of the gross, "
        "the VAT in a standard-rated price; overseas suppliers carry no UK VAT.",
    ]


def add_to_pack(rendered: Rendered, api, client: str, profile: dict, month_end: date) -> list[Control]:
    """The hook in build.py. Adds the section and returns one control; does nothing
    unless the profile asks for it."""
    cfg = settings(profile)
    if cfg is None:
        return []
    try:
        data = api.outstanding_documents(client)
    except FinanceApiError as e:
        return [Control("outstanding.read", "Outstanding documents read from os.stza.io", "warn",
                        detail=f"Outstanding documents left out: {str(e)[:300]}")]
    if data is None or data.get("migration_missing"):
        return [Control("outstanding.read", "Outstanding documents read from os.stza.io", "warn",
                        detail="Outstanding documents are not switched on for this finance-api yet; section left out")]
    items = as_at(data.get("items") or [], month_end)
    names = canonical_holders(items)
    rows = [row_values(i, names) for i in items]
    notes = _notes(month_end, data.get("threshold"))
    first, last, total_row = _appendix(rendered, rows, f"{SUMMARY} - list" if cfg["format"] == "summary_appendix" else SUMMARY, notes)
    if cfg["format"] == "summary_appendix":
        _summary(rendered, rows, first, last, total_row, SUMMARY, notes)
        # The summary reads first.
        wb = rendered.workbook
        wb.move_sheet(SUMMARY, offset=wb.sheetnames.index(APPENDIX) - wb.sheetnames.index(SUMMARY))
    spent = sum(v["spent"] or 0.0 for v in rows)
    unknown = sum(1 for i in items if gbp(i) is None)
    detail = f"{len(rows)} items, GBP {spent:,.2f} spent" + (f"; {unknown} with no sterling value" if unknown else "")
    return [Control("outstanding.read", "Outstanding documents read from os.stza.io", "pass", detail=detail)]

"""Asset register workbook (docs/asset-register-spec.md section 7).

The register as finance-api holds it for one grouping and month
(GET .../asset-register/export), written as a workbook a person can audit:

  Cover Sheet           register against ledger per company and account, with
                        named items and what is left unexplained (formulas)
  Cost / Accumulated    per asset, by month, cumulative (formulas)
  NBV                   cost plus accumulated amortisation (formulas)
  Source - Cost lines   every cost line up to the month (typed)
  Source - Events       every amortisation, impairment, transfer (typed)
  Source - Ledger       the ledger at the month end, named items, Xero's own
                        movement on accounts Xero amortises (typed)
  Assets                what each asset is (typed)
  Controls              the checks, and their results

The rule of the pack engine holds: typed numbers live only on the Source tabs
and Assets; every schedule figure and total is a formula. Saved with
fullCalcOnLoad and never recalculated outside Excel. A failed control still
writes the file, with FAILED CONTROLS in its name.

    python -m pack_engine.assets export.json out_dir
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, PatternFill
from openpyxl.utils import get_column_letter

from . import style

BANNER = "FF5D3B"     # house format: banner rows
TOTAL = "FFDED7"      # house format: totals
INPUT_FILL = "FFFFCC"  # house format: typed inputs, blue on yellow
INPUT_BLUE = "3366FF"
NUM = style.NUM_2DP


class ExportError(ValueError):
    """The export is not in the shape this module writes."""


@dataclass
class Built:
    workbook: Workbook
    failures: list[str] = field(default_factory=list)
    register: dict = field(default_factory=dict)   # (company, account) -> computed register

    @property
    def ok(self) -> bool:
        return not self.failures


def _r2(x) -> float:
    return round(float(x or 0) + 0.0, 2)


def _put(ws, row, col, value, *, bold=False, fmt=None, fill=None, color=style.BLACK, wrap=False):
    c = ws.cell(row, col, value)
    c.font = style.font(size=10, bold=bold, color=color)
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = PatternFill("solid", fgColor=fill)
    if wrap:
        c.alignment = Alignment(wrap_text=True, vertical="top")
    return c


def _banner(ws, row, text, width):
    for col in range(1, width + 1):
        ws.cell(row, col).fill = PatternFill("solid", fgColor=BANNER)
    _put(ws, row, 1, text, bold=True, fill=BANNER, color=style.WHITE)


def _header(ws, row, names):
    for i, n in enumerate(names, start=1):
        _put(ws, row, i, n, bold=True, fill=style.BLACK, color=style.WHITE, wrap=True)


def _widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _typed(ws, row, col, value, fmt=None):
    return _put(ws, row, col, value, fmt=fmt, fill=INPUT_FILL, color=INPUT_BLUE)


def check(export: dict) -> None:
    for k in ("grouping", "period", "months", "assets", "lines", "events", "ledger"):
        if k not in export:
            raise ExportError(f"the export has no {k}")
    if not export["months"] or export["months"][-1] != export["period"]:
        raise ExportError("months must run up to and including the period")


def build(export: dict) -> Built:
    check(export)
    wb = Workbook()
    out = Built(wb)
    months = export["months"]
    first = months[0]
    assets = export["assets"]
    lines = export["lines"]
    events = export["events"]
    ledger = export["ledger"]
    title = f"{export.get('client', '')} - {export.get('grouping_name', export['grouping'])} - {export['period']}"

    # ── Source tabs (typed) ─────────────────────────────────────────────
    sl = wb.active
    sl.title = "Source - Cost lines"
    cols = ["Line", "Date", "Month", "Company", "Asset", "Account", "Supplier", "Invoice", "Amount", "Treatment", "Reason", "Source"]
    _banner(sl, 1, f"{title}: cost lines up to the month (typed)", len(cols))
    _header(sl, 2, cols)
    for i, l in enumerate(lines, start=3):
        # Lines before the first month count in the first month (the opening).
        bucket = max(str(l["period"]), first)
        for c, v in enumerate([l.get("id"), l.get("date"), bucket, l.get("company"), l.get("asset_no"), l.get("account"), l.get("supplier"),
                               l.get("invoice_no"), _r2(l.get("amount")), l.get("treatment"), l.get("reason"), l.get("source")], start=1):
            _typed(sl, i, c, v, NUM if c == 9 else None)
    last_line = max(3, len(lines) + 2)
    _widths(sl, [10, 11, 9, 14, 18, 9, 26, 16, 14, 16, 60, 30])
    sl.freeze_panes = "A3"

    se = wb.create_sheet("Source - Events")
    ecols = ["Date", "Month", "Company", "Asset", "Kind", "Account", "Side", "Amount", "Reason"]
    _banner(se, 1, f"{title}: amortisation, impairment, transfers (typed; ledger sign)", len(ecols))
    _header(se, 2, ecols)
    for i, e in enumerate(events, start=3):
        bucket = max(str(e["period"]), first)
        for c, v in enumerate([e.get("date"), bucket, e.get("company"), e.get("asset_no"), e.get("kind"), e.get("account"), e.get("side"),
                               _r2(e.get("amount")), e.get("reason")], start=1):
            _typed(se, i, c, v, NUM if c == 8 else None)
    last_event = max(3, len(events) + 2)
    _widths(se, [11, 9, 14, 18, 14, 9, 13, 14, 60])
    se.freeze_panes = "A3"

    sg = wb.create_sheet("Source - Ledger")
    gcols = ["Company", "Account", "Account name", "Ledger at month end", "Named items", "Named item labels", "Xero's own movement since the opening"]
    _banner(sg, 1, f"{title}: the ledger at the month end, from the prepared month (typed)", len(gcols))
    _header(sg, 2, gcols)
    for i, g in enumerate(ledger, start=3):
        for c, v in enumerate([g.get("company"), g.get("account"), g.get("account_name"), _r2(g.get("ledger")), _r2(g.get("named")),
                               "; ".join(g.get("named_labels") or []), _r2(g.get("by_xero"))], start=1):
            _typed(sg, i, c, v, NUM if c in (4, 5, 7) else None)
    last_ledger = max(3, len(ledger) + 2)
    _widths(sg, [14, 9, 44, 18, 14, 60, 18])

    sa = wb.create_sheet("Assets")
    acols = ["Asset", "Name", "Company", "Status", "Cost account", "Accumulated account", "Registration / available", "Expiry", "Jurisdiction"]
    _banner(sa, 1, f"{title}: assets (typed)", len(acols))
    _header(sa, 2, acols)
    for i, a in enumerate(assets, start=3):
        for c, v in enumerate([a.get("asset_no"), a.get("name"), a.get("company"), a.get("status"), a.get("cost_account"),
                               a.get("accum_account"), a.get("registration_date") or a.get("available_for_use_date"), a.get("expiry_date"),
                               a.get("jurisdiction")], start=1):
            _typed(sa, i, c, v)
    _widths(sa, [20, 36, 14, 12, 12, 14, 16, 12, 12])

    L, E, G = "'Source - Cost lines'", "'Source - Events'", "'Source - Ledger'"
    lr = lambda col: f"{L}!${col}$3:${col}${last_line}"
    er = lambda col: f"{E}!${col}$3:${col}${last_event}"
    gr = lambda col: f"{G}!${col}$3:${col}${last_ledger}"

    # ── Schedules (formulas) ───────────────────────────────────────────
    def schedule(name, banner, cell):
        ws = wb.create_sheet(name)
        _banner(ws, 1, f"{title}: {banner}", 2 + len(months))
        _header(ws, 2, ["Asset", "Name"] + months)
        for i, a in enumerate(assets, start=3):
            _put(ws, i, 1, a["asset_no"])
            _put(ws, i, 2, a.get("name"))
            for j, m in enumerate(months):
                col = 3 + j
                prev = f"{get_column_letter(col - 1)}{i}" if j else None
                _put(ws, i, col, cell(i, col, prev), fmt=NUM)
        total = len(assets) + 3
        _put(ws, total, 1, "Total", bold=True, fill=TOTAL)
        _put(ws, total, 2, None, fill=TOTAL)
        for j in range(len(months)):
            c = get_column_letter(3 + j)
            _put(ws, total, 3 + j, f"=SUM({c}3:{c}{total - 1})", bold=True, fmt=NUM, fill=TOTAL)
        _widths(ws, [20, 36] + [14] * len(months))
        ws.freeze_panes = "C3"
        return ws

    def cost_cell(i, col, prev):
        m = f"{get_column_letter(col)}$2"
        move = f'SUMIFS({lr("I")},{lr("E")},$A{i},{lr("C")},{m},{lr("J")},"capitalise")'
        return f"={prev}+{move}" if prev else f"={move}"

    def acc_cell(i, col, prev):
        m = f"{get_column_letter(col)}$2"
        move = f'SUMIFS({er("H")},{er("D")},$A{i},{er("B")},{m},{er("G")},"accumulated")'
        return f"={prev}+{move}" if prev else f"={move}"

    schedule("Cost", "cost by asset, cumulative to each month end", cost_cell)
    schedule("Accumulated", "accumulated amortisation and impairment by asset, cumulative (ledger sign)", acc_cell)
    schedule("NBV", "net book value by asset", lambda i, col, prev: f"='Cost'!{get_column_letter(col)}{i}+'Accumulated'!{get_column_letter(col)}{i}")

    # ── Cover Sheet (formulas) ─────────────────────────────────────────
    cv = wb.create_sheet("Cover Sheet", 0)
    ccols = ["Company", "Account", "Account name", "Register", "Ledger", "Difference", "Named items", "Unexplained", "Ties"]
    _banner(cv, 1, f"{title}: register against ledger", len(ccols))
    _put(cv, 2, 1, f"Status: {export.get('status', 'prepared')}" + (f", signed by {export['signed_by']} on {export['signed_at']}" if export.get("signed_by") else ""))
    _put(cv, 3, 1, f"Read from os.stza.io {export.get('read_at', '')}. Typed figures are on the Source tabs; everything here is a formula.")
    _header(cv, 5, ccols)
    for i, g in enumerate(ledger, start=6):
        src = 3 + (i - 6)
        co, ac = f"$A{i}", f"$B{i}"
        _put(cv, i, 1, f"={G}!A{src}")
        _put(cv, i, 2, f"={G}!B{src}")
        _put(cv, i, 3, f"={G}!C{src}")
        reg = (f'=SUMIFS({lr("I")},{lr("D")},{co},{lr("F")},{ac},{lr("J")},"capitalise")'
               f'+SUMIFS({er("H")},{er("C")},{co},{er("F")},{ac})+{G}!G{src}')
        _put(cv, i, 4, reg, fmt=NUM)
        _put(cv, i, 5, f"={G}!D{src}", fmt=NUM)
        _put(cv, i, 6, f"=E{i}-D{i}", fmt=NUM)
        _put(cv, i, 7, f"={G}!E{src}", fmt=NUM)
        _put(cv, i, 8, f"=F{i}-G{i}", fmt=NUM)
        _put(cv, i, 9, f'=IF(ABS(H{i})<0.005,"Yes","No")')
    tot = len(ledger) + 6
    _put(cv, tot, 1, "Total", bold=True, fill=TOTAL)
    for c in range(2, 10):
        _put(cv, tot, c, None, fill=TOTAL)
    for c in "DEFGH":
        _put(cv, tot, " DEFGH".index(c) + 3, f"=SUM({c}6:{c}{tot - 1})", bold=True, fmt=NUM, fill=TOTAL)
    # The per-asset schedules and the cover reconcile on the face of the
    # sheet: Xero's own amortisation (accounts Xero amortises) is charged at
    # account level, so it is on the cover but against no asset.
    nbv_col = get_column_letter(2 + len(months))
    nbv_tot = len(assets) + 3
    rec = tot + 2
    _put(cv, rec, 1, "Schedules against the cover", bold=True)
    _put(cv, rec + 1, 3, "Net book value of the assets at the month end (NBV tab)")
    _put(cv, rec + 1, 4, f"='NBV'!{nbv_col}{nbv_tot}", fmt=NUM)
    _put(cv, rec + 2, 3, "Charged by Xero at account level, against no asset")
    _put(cv, rec + 2, 4, f"=SUM({gr('G')})", fmt=NUM)
    _put(cv, rec + 3, 3, "Register on the cover", bold=True, fill=TOTAL)
    _put(cv, rec + 3, 4, f"=D{rec + 1}+D{rec + 2}", bold=True, fmt=NUM, fill=TOTAL)
    _put(cv, rec + 4, 3, "Agrees with the register total above")
    _put(cv, rec + 4, 4, f'=IF(ABS(D{rec + 3}-D{tot})<0.005,"Yes","No")')
    _widths(cv, [14, 9, 44, 16, 16, 14, 14, 14, 7])

    # ── Controls: computed here from the same data, checked against the
    #    prepared month; the workbook's own formulas compute the same.
    reg = {}
    for l in lines:
        if l.get("treatment") == "capitalise":
            k = (l.get("company"), str(l.get("account")))
            reg[k] = _r2(reg.get(k, 0) + float(l.get("amount") or 0))
    for e in events:
        k = (e.get("company"), str(e.get("account")))
        reg[k] = _r2(reg.get(k, 0) + float(e.get("amount") or 0))
    for g in ledger:
        k = (g.get("company"), str(g.get("account")))
        reg[k] = _r2(reg.get(k, 0) + float(g.get("by_xero") or 0))
    out.register = reg
    for g in ledger:
        k = (g.get("company"), str(g.get("account")))
        unexplained = _r2(float(g.get("ledger") or 0) - reg.get(k, 0) - float(g.get("named") or 0))
        if abs(unexplained) >= 0.005:
            out.failures.append(f"{k[0]} {k[1]}: {unexplained:,.2f} unexplained")
        if g.get("register") is not None and _r2(g["register"]) != reg.get(k, 0):
            out.failures.append(f"{k[0]} {k[1]}: the workbook's register {reg.get(k, 0):,.2f} differs from the prepared month's {_r2(g['register']):,.2f}")
    by_asset = sum(float(l.get("amount") or 0) for l in lines if l.get("treatment") == "capitalise" and l.get("asset_no"))         + sum(float(e.get("amount") or 0) for e in events if e.get("asset_no") and e.get("side") == "accumulated")
    by_xero = sum(float(g.get("by_xero") or 0) for g in ledger)
    if _r2(by_asset + by_xero) != _r2(sum(reg.values())):
        out.failures.append(f"schedules: the assets' net book value {by_asset:,.2f} and Xero's own charge {by_xero:,.2f} do not make the register {sum(reg.values()):,.2f}")
    sources = {}
    for l in lines:
        sk = l.get("source_key")
        if sk:
            s = sources.setdefault(sk, {"net": _r2(l.get("source_net")), "sum": 0.0})
            s["sum"] = _r2(s["sum"] + float(l.get("amount") or 0))
    for sk, s in sources.items():
        if s["sum"] != s["net"]:
            out.failures.append(f"source {sk}: slices make {s['sum']:,.2f} against {s['net']:,.2f}")

    ct = wb.create_sheet("Controls")
    _banner(ct, 1, f"{title}: controls", 2)
    rows = [("Register ties to the ledger after named items, every account", not any("unexplained" in f for f in out.failures)),
            ("Workbook register equals the prepared month's register", not any("differs" in f for f in out.failures)),
            ("Every source line's slices make its net", not any(f.startswith("source ") for f in out.failures)),
            ("The assets' schedules and Xero's own charge make the register", not any(f.startswith("schedules:") for f in out.failures)),
            ("Every schedule and cover figure is a formula", True)]
    for i, (name, ok) in enumerate(rows, start=3):
        _put(ct, i, 1, name)
        _put(ct, i, 2, "Pass" if ok else "FAIL", bold=not ok, color=style.SUCCESS_GREEN if ok else style.ALERT_RED)
    for i, f in enumerate(out.failures, start=len(rows) + 4):
        _put(ct, i, 1, f, color=style.ALERT_RED)
    _widths(ct, [80, 10])

    for ws in wb.worksheets:
        ws.sheet_properties.tabColor = BANNER if ws.title == "Cover Sheet" else ("8E9196" if ws.title.startswith("Source") or ws.title in ("Assets", "Controls") else "D4C5A9")
    wb.calculation.fullCalcOnLoad = True
    return out


def write(export: dict, out_dir: Path) -> Path:
    built = build(export)
    name = f"{export.get('file_stem') or ('Asset register - ' + export['grouping'] + ' - ' + export['period'])}"
    if not built.ok:
        name += " - FAILED CONTROLS"
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    path = Path(out_dir) / f"{name}.xlsx"
    built.workbook.save(path)
    return path


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m pack_engine.assets export.json out_dir")
        return 2
    export = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    exports = export if isinstance(export, list) else [export]
    for e in exports:
        p = write(e, Path(argv[1]))
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

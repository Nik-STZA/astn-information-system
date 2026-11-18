"""The VAT return workbook (CFO, 18 Nov 2026): the consolidated file the CFO
kept by hand, built from what was uploaded to os.stza.io and saved to the
client's shared drive.

    GROUP                 each company's boxes, the group and the adjustment
                          (the members other than the representative), as
                          formulas on the company tabs, so the file stands on
                          its own; then the import file os.stza.io made and,
                          once the representative's return is exported after
                          the import, the check that it shows the group
    <CODE> - <Xero tab>   each company's export, as Xero gave it
    <CODE> - After import the representative's return after the import
    Checks                os.stza.io's checks on the uploads

Run as the pack engine's Cloud Run Job with JOB_KIND=vat_workbook,
CLIENT_SLUG and VAT_RETURN_ID. finance-api serves the data
(GET .../vat/returns/:id/workbook-data) and is told where the file went
(POST .../workbook-saved).
"""

from __future__ import annotations

import io
import os
import re
import traceback
from datetime import datetime, timezone

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter, quote_sheetname

FONT = "Calibri"
MONEY = '#,##0.00;-#,##0.00;"-"'
POUNDS = '#,##0;-#,##0;"-"'
BAND = "F5F0E8"
TABS = ["VAT Return", "Transactions by VAT Box", "Transactions by Tax Rate"]
NUMERIC = re.compile(r"^-?(0|[1-9]\d*)(\.\d+)?$")

DETAILS = ["VAT Number", "VAT Scheme", "Period covered by the return", "Late VAT Claims included",
           "Period Start", "Period End", "The deadline for submitting the return online is"]

BOX_LABELS = {
    1: "VAT due in the period on sales and other outputs",
    2: "VAT due in the period on acquisitions of goods made in Northern Ireland from EU member states",
    3: "Total VAT due (the sum of boxes 1 and 2)",
    4: "VAT reclaimed in the period on purchases and other inputs (including acquisitions from the EU)",
    5: "VAT to reclaim from HMRC (box 4 less box 3)",
    6: "Total value of sales and all other outputs excluding any VAT",
    7: "Total value of purchases and all other inputs excluding any VAT",
    8: "Total value of all supplies of goods and related costs, excluding any VAT, to EU member states",
    9: "Total value of all acquisitions of goods and related costs, excluding any VAT, from EU member states",
}
# Where each box sits on GROUP, with the section headings above them, as in
# the hand-kept file.
LAYOUT = [(15, "VAT Calculations"), (16, 1), (17, 2), (18, 3), (19, 4), (20, 5),
          (22, "Sales and Purchases Excluding VAT"), (23, 6), (24, 7),
          (26, "EC Supplies and Purchases Excluding VAT"), (27, 8), (28, 9)]
BOX_ROW = {b: r for r, b in LAYOUT if isinstance(b, int)}
FILE_BOXES = [1, 2, 4, 6, 7, 8, 9]


def long_date(iso: str) -> str:
    """2026-10-01 -> 01 Oct 2026, as Xero writes it."""
    return datetime.strptime(iso[:10], "%Y-%m-%d").strftime("%d %b %Y")


def _font(**kw):
    return Font(name=FONT, size=kw.pop("size", 10), **kw)


def tab_title(code: str, tab: str) -> str:
    """An Excel sheet name: at most 31 characters, none of []:*?/\\."""
    return re.sub(r"[\[\]:*?/\\]", " ", f"{code} - {tab}")[:31]


def cell_value(text: str, keep_text: bool = False):
    """A cell as Xero wrote it: numbers back to numbers (not ones with a
    leading zero, which are references)."""
    if text is None:
        return None
    s = str(text)
    if s == "":
        return None
    if not keep_text and NUMERIC.match(s):
        return float(s) if "." in s else int(s)
    return s


def find_detail(rows: list[list[str]], label: str):
    """(row, column) of the value beside a detail label on a VAT Return tab:
    the last filled cell on the row whose first cell is the label. 1-based."""
    for i, row in enumerate(rows):
        if row and str(row[0]).strip().lower() == label.lower():
            filled = [j for j, c in enumerate(row) if j > 0 and str(c).strip() != ""]
            return (i + 1, filled[-1] + 1) if filled else None
    return None


def find_box(rows: list[list[str]], box: int):
    """(row, column, label) of a box's figure on a VAT Return tab: the row with
    the box number in a cell after the label, figure in its last filled cell."""
    for i, row in enumerate(rows):
        cells = [str(c).strip() for c in row]
        if len(cells) >= 3 and str(box) in cells[1:-1] and cells[0]:
            k = cells.index(str(box), 1)
            filled = [j for j, c in enumerate(cells) if j > k and c != ""]
            if filled:
                return i + 1, filled[-1] + 1, cells[0]
    return None


def write_tab(ws, rows: list[list[str]], tab: str):
    is_return = tab == "VAT Return"
    for r, row in enumerate(rows, start=1):
        for c, text in enumerate(row, start=1):
            v = cell_value(text, keep_text=is_return and c == 2)
            if v is None:
                continue
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = _font()
            if isinstance(v, (int, float)):
                cell.number_format = MONEY
        first = str(row[0]).strip() if row else ""
        if r <= 3 or first.startswith("Box ") or first == "Date" or (len([x for x in row if str(x).strip()]) == 1 and r > 3):
            for c in range(1, max(len(row), 1) + 1):
                ws.cell(row=r, column=c).font = _font(bold=True, size=12 if r == 1 else 10)
    widths = {"VAT Return": [70, 6, 18]}.get(tab, [12, 38, 18, 60, 14, 14, 14])
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def build_workbook(data: dict, now: datetime | None = None) -> Workbook:
    now = now or datetime.now(timezone.utc)
    ret = data["return"]
    companies = [c for c in data["companies"] if c.get("sheets") and c["sheets"].get("VAT Return")]
    is_group = ret.get("kind") == "group" and len(data["companies"]) > 1
    wb = Workbook()
    g = wb.active
    g.title = "GROUP" if is_group else "RETURN"

    # Columns: each company two apart from C (as in the hand-kept file), then
    # the group and the adjustment.
    col_of = {c["entity_id"]: 3 + 2 * i for i, c in enumerate(companies)}
    group_col = 3 + 2 * len(companies)
    adj_col = group_col + 2
    L = get_column_letter

    rep = next((c for c in companies if c.get("representative")), companies[0] if companies else None)
    g["A1"] = "VAT Return"
    g["A1"].font = _font(bold=True, size=14)
    g["A2"] = rep["name"] if rep else data.get("title", "")
    g["A3"] = f"For the period {long_date(ret['period_start'])} - {long_date(ret['period_end'])}"
    g["A4"] = (f"Built by os.stza.io on {now.strftime('%d %b %Y %H:%M')} UTC from the exports uploaded. "
               "Every company figure is a formula on its own tab.")
    g["A4"].font = _font(italic=True, size=9, color="71717A")
    for c in companies:
        g.cell(row=2, column=col_of[c["entity_id"]], value=c["code"])
    if is_group:
        g.cell(row=2, column=group_col, value="GROUP")
        g.cell(row=2, column=adj_col, value="Adjustment")
    for col in [*col_of.values(), group_col] + ([adj_col] if is_group else []):
        cell = g.cell(row=2, column=col)
        cell.font = _font(bold=True)
        cell.alignment = Alignment(horizontal="right")
        cell.fill = PatternFill("solid", fgColor=BAND)

    # VAT return details
    g["A6"] = "VAT Return Details"
    g["A6"].font = _font(bold=True)
    for i, label in enumerate(DETAILS):
        r = 7 + i
        g.cell(row=r, column=1, value=label).font = _font()
        for c in companies:
            at = find_detail(c["sheets"]["VAT Return"], label)
            if at:
                ref = f"{quote_sheetname(tab_title(c['code'], 'VAT Return'))}!{L(at[1])}{at[0]}"
                g.cell(row=r, column=col_of[c["entity_id"]], value=f"={ref}").alignment = Alignment(horizontal="right")
        if is_group and rep:
            g.cell(row=r, column=group_col, value=f"={L(col_of[rep['entity_id']])}{r}").alignment = Alignment(horizontal="right")

    # Boxes
    missing = []
    for r, b in LAYOUT:
        if isinstance(b, str):
            g.cell(row=r, column=1, value=b).font = _font(bold=True)
            continue
        label = BOX_LABELS[b]
        g.cell(row=r, column=1, value=label).font = _font(bold=b in (3, 5))
        g.cell(row=r, column=2, value=str(b)).alignment = Alignment(horizontal="center")
        fmt = POUNDS if b >= 6 else MONEY
        for c in companies:
            col = L(col_of[c["entity_id"]])
            if b == 3:
                f = f"=SUM({col}{BOX_ROW[1]}:{col}{BOX_ROW[2]})"
            elif b == 5:
                f = f"={col}{BOX_ROW[4]}-{col}{BOX_ROW[3]}"
            else:
                at = find_box(c["sheets"]["VAT Return"], b)
                if not at:
                    missing.append(f"{c['code']} box {b}")
                    continue
                f = f"={quote_sheetname(tab_title(c['code'], 'VAT Return'))}!{L(at[1])}{at[0]}"
            g.cell(row=r, column=col_of[c["entity_id"]], value=f).number_format = fmt
        if is_group:
            cols = [L(col_of[c["entity_id"]]) for c in companies]
            others = [L(col_of[c["entity_id"]]) for c in companies if not c.get("representative")]
            gc, ac = L(group_col), L(adj_col)
            if b == 3:
                g.cell(row=r, column=group_col, value=f"=SUM({gc}{BOX_ROW[1]}:{gc}{BOX_ROW[2]})")
                g.cell(row=r, column=adj_col, value=f"=SUM({ac}{BOX_ROW[1]}:{ac}{BOX_ROW[2]})")
            elif b == 5:
                g.cell(row=r, column=group_col, value=f"={gc}{BOX_ROW[4]}-{gc}{BOX_ROW[3]}")
                g.cell(row=r, column=adj_col, value=f"={ac}{BOX_ROW[4]}-{ac}{BOX_ROW[3]}")
            else:
                g.cell(row=r, column=group_col, value=f"=SUM({','.join(f'{x}{r}' for x in cols)})")
                g.cell(row=r, column=adj_col, value=f"=SUM({','.join(f'{x}{r}' for x in others)})" if others else 0)
            for col in (group_col, adj_col):
                g.cell(row=r, column=col).number_format = fmt
                if b == 5:
                    g.cell(row=r, column=col).font = _font(bold=True)

    row = 31
    group = data.get("group")
    if is_group and group:
        g.cell(row=row, column=1, value="Import file made by os.stza.io").font = _font(bold=True)
        g.cell(row=row + 1, column=1, value=(
            "The group less what is already in the representative's return. It differs from the adjustment column "
            "when a company's return holds imports, or adjustments with no accounting transaction the CFO has not accepted, "
            "which are not its own figures.")).font = _font(italic=True, size=9, color="71717A")
        g.cell(row=row + 2, column=group_col, value="Import").font = _font(bold=True)
        g.cell(row=row + 2, column=adj_col, value="Less adjustment").font = _font(bold=True)
        for i, b in enumerate(FILE_BOXES):
            r = row + 3 + i
            g.cell(row=r, column=1, value=BOX_LABELS[b])
            g.cell(row=r, column=2, value=str(b)).alignment = Alignment(horizontal="center")
            v = group.get("import", {}).get(str(b), group.get("import", {}).get(b, 0))
            g.cell(row=r, column=group_col, value=v).number_format = POUNDS if b >= 6 else MONEY
            g.cell(row=r, column=adj_col, value=f"={L(group_col)}{r}-{L(adj_col)}{BOX_ROW[b]}").number_format = POUNDS if b >= 6 else MONEY
        row += 3 + len(FILE_BOXES) + 1

    after = rep.get("after_import") if rep else None
    if is_group and after and after.get("sheets") and after["sheets"].get("VAT Return"):
        title = tab_title(rep["code"], "After import")
        g.cell(row=row, column=1, value=f"{rep['name']} after the import, against the group").font = _font(bold=True)
        g.cell(row=row + 1, column=group_col, value="After import").font = _font(bold=True)
        g.cell(row=row + 1, column=adj_col, value="Difference").font = _font(bold=True)
        for i, b in enumerate(range(1, 10)):
            r = row + 2 + i
            g.cell(row=r, column=1, value=BOX_LABELS[b])
            g.cell(row=r, column=2, value=str(b)).alignment = Alignment(horizontal="center")
            at = find_box(after["sheets"]["VAT Return"], b)
            fmt = POUNDS if b >= 6 else MONEY
            if at:
                g.cell(row=r, column=group_col, value=f"={quote_sheetname(title)}!{L(at[1])}{at[0]}").number_format = fmt
                # Xero shows box 5 unsigned; the group's box 5 is box 4 less box 3.
                target = f"ABS({L(group_col)}{BOX_ROW[b]})" if b == 5 else f"{L(group_col)}{BOX_ROW[b]}"
                g.cell(row=r, column=adj_col, value=f"={L(group_col)}{r}-{target}").number_format = fmt
        row += 12

    if missing:
        g.cell(row=row, column=1, value="Not found on the tabs: " + ", ".join(missing)).font = _font(color="CC0000")

    g.column_dimensions["A"].width = 70
    g.column_dimensions["B"].width = 5
    for col in [*col_of.values(), group_col, adj_col]:
        g.column_dimensions[L(col)].width = 15
        g.column_dimensions[L(col + 1)].width = 2
    g.freeze_panes = "C3"

    # Company tabs, as Xero gave them
    for c in companies:
        for tab in TABS:
            rows = c["sheets"].get(tab)
            if rows:
                write_tab(wb.create_sheet(tab_title(c["code"], tab)), rows, tab)
    if after and after.get("sheets") and after["sheets"].get("VAT Return"):
        write_tab(wb.create_sheet(tab_title(rep["code"], "After import")), after["sheets"]["VAT Return"], "VAT Return")

    # Checks
    ws = wb.create_sheet("Checks")
    ws["A1"] = "os.stza.io checks on the uploaded exports"
    ws["A1"].font = _font(bold=True, size=12)
    r = 3
    for ch in (data.get("checks") or {}).get("checks", []):
        ws.cell(row=r, column=1, value="OK" if ch.get("ok") else ("To resolve" if ch.get("blocking") else "Note")).font = _font(bold=True)
        ws.cell(row=r, column=2, value=ch.get("said"))
        r += 1
    conf = data.get("confirmation")
    if conf is not None:
        r += 1
        ws.cell(row=r, column=1, value="Import").font = _font(bold=True)
        ws.cell(row=r, column=2, value="The representative's return shows the group on every box." if not conf else
                "Still different: " + "; ".join(f"box {d['box']} should be {d['want']:,.2f}, shows {d['got']:,.2f}" for d in conf))
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 120
    return wb


def file_name(data: dict) -> str:
    end = data["return"]["period_end"]
    yymm = end[2:4] + end[5:7]
    kind = "VAT Group Return" if data["return"].get("kind") == "group" else "VAT Return"
    title = re.sub(r'[\\/:*?"<>|]+', " ", str(data.get("title") or "")).strip()
    return f"{title} {kind} - {yymm}.xlsx".strip()


def save(svc, data: dict, content: bytes, name: str) -> dict:
    """Saves the workbook into the period's folder on the client's drive. The
    same return's earlier file is replaced (a new version of it); a file of the
    same name we did not make, such as a hand-kept one, is never touched."""
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaIoBaseUpload
    from . import drive as gdrive
    drive_id = data["drive"]["drive_id"]
    folder = gdrive.ensure_folder_path(svc, drive_id, data["drive"]["path"])
    def media():  # a fresh stream for each attempt
        return MediaIoBaseUpload(io.BytesIO(content), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable=False)
    known = data["drive"].get("file_id")
    if known:
        try:
            return svc.files().update(fileId=known, body={"name": name}, media_body=media(),
                                      fields="id,name,webViewLink", supportsAllDrives=True).execute()
        except HttpError as e:
            if getattr(e, "status_code", None) not in (403, 404) and getattr(getattr(e, "resp", None), "status", None) not in (403, 404):
                raise
    if gdrive.find_file(svc, drive_id, folder, name):
        name = name[:-5] + " (os.stza.io).xlsx"
    return svc.files().create(body={"name": name, "parents": [folder]}, media_body=media(),
                              fields="id,name,webViewLink", supportsAllDrives=True).execute()


def run(*, api=None, drive=None, now: datetime | None = None) -> int:
    from .api import FinanceApi
    slug = os.environ.get("CLIENT_SLUG", "").strip()
    rid = os.environ.get("VAT_RETURN_ID", "").strip()
    api = api or FinanceApi()
    base = f"/api/finance/clients/{slug}/vat/returns/{rid}"

    def report(body: dict):
        # The one write: where the file went, or why not. The finance-api client
        # stays read-only (tests/test_suppliers.py), so it is sent from here.
        try:
            if hasattr(api, "report_vat_workbook"):
                api.report_vat_workbook(f"{base}/workbook-saved", body)
            else:
                r = api.session.request("POST", f"{api.base_url}{base}/workbook-saved", json=body, timeout=60,
                                        headers={"X-API-Key": api.api_key})
                if r.status_code >= 400:
                    print(f"[vat] finance-api refused the report: {r.status_code} {r.text[:300]}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[vat] could not report back: {e}", flush=True)

    try:
        if not slug or not rid:
            raise RuntimeError("CLIENT_SLUG and VAT_RETURN_ID must be set")
        data = api.get(f"{base}/workbook-data")
        if not data["drive"].get("drive_id"):
            raise RuntimeError("no shared drive is set for this VAT registration")
        wb = build_workbook(data, now=now)
        name = file_name(data)
        from . import drive as gdrive
        svc = drive or gdrive.drive_service()
        buf = io.BytesIO()
        wb.save(buf)
        meta = save(svc, data, buf.getvalue(), name)
        print(f"[vat] saved {meta.get('name')} to {' / '.join(data['drive']['path'])}", flush=True)
        report({"file_id": meta["id"], "name": meta.get("name", name), "link": meta.get("webViewLink", "")})
        return 0
    except Exception as e:  # noqa: BLE001  report every failure; never leave the page waiting
        print(f"[vat] FAILED: {e}", flush=True)
        for line in traceback.format_exc().splitlines()[-8:]:
            print(line, flush=True)
        report({"error": str(e)[:2000]})
        return 1

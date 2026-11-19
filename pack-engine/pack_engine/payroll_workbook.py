"""The payroll working file (CFO, 19 Nov 2026): the month's workings for Xero,
built on the client's own drive beside the payroll provider's export.

os.stza.io holds only employee codes and pay figures. The provider's export,
with names and personal details, stays on the client's drive: this job opens
it there, keeps every one of its tabs exactly as the provider sent it, and adds

    Roles                     each employee code's role, as set in os.stza.io
    Capitalised Development   employer cost by code, the confirmed share per
                              project, and the amount, as formulas
    Journal - <kind>          each of the month's journals, line by line, with
                              a check that it balances

then saves the file into the same folder.

Run as the pack engine's Cloud Run Job with JOB_KIND=payroll_workbook,
CLIENT_SLUG and PAYROLL_RUN_ID. finance-api serves the data
(GET .../payroll/runs/:id/workbook-data) and is told where the file went
(POST .../workbook-saved).
"""

from __future__ import annotations

import hashlib
import io
import os
import traceback

from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from .vat_workbook import save

MONEY = '#,##0.00;-#,##0.00;"-"'
PCT = '0.00"%"'
BAND = "F5F0E8"
ROLE = {"director": "Director", "direct": "Direct staff", "intercompany": "Intercompany"}
KIND = {"payroll": "Payroll", "contracted": "Contracted", "capdev": "Cap Dev", "capdev_other": "Recharge", "capdev_contractor": "Cap Dev Contractors"}


def file_name(data: dict) -> str:
    return f"Payroll workings - {data['yymm']}.xlsx"


def _head(ws, row: int, values: list):
    for i, v in enumerate(values, start=1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor=BAND)


def _title(ws, text: str, sub: str):
    ws["A1"] = text
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = sub
    ws["A2"].font = Font(italic=True, color="8E9196")


def _unique(wb, name: str) -> str:
    """A tab name the provider's workbook does not already use."""
    base = name[:31]
    n, out = 2, base
    while out in wb.sheetnames:
        out = f"{base[:28]} {n}"
        n += 1
    return out


def build_workbook(source: bytes, data: dict):
    """The provider's workbook with the working tabs added after its own."""
    wb = load_workbook(io.BytesIO(source))
    sub = f"{data['client']}, pay date {data['pay_date']}. Built by os.stza.io from {data['source_name']}; the provider's tabs are unchanged."

    ws = wb.create_sheet(_unique(wb, "Roles"))
    _title(ws, f"Roles - {data['period']}", sub)
    _head(ws, 4, ["EmpCode", "Role", "Basic", "Employer NI", "Employer pension", "Employer cost"])
    for r, e in enumerate(data["employees"], start=5):
        ws.cell(row=r, column=1, value=e["emp_code"])
        ws.cell(row=r, column=2, value=ROLE.get(e.get("role"), "Not set"))
        for col, key in ((3, "basic"), (4, "er_nic"), (5, "er_pension")):
            ws.cell(row=r, column=col, value=e[key]).number_format = MONEY
        ws.cell(row=r, column=6, value=f"=C{r}+D{r}+E{r}").number_format = MONEY
    for col, w in zip("ABCDEF", (12, 16, 14, 14, 16, 14)):
        ws.column_dimensions[col].width = w

    projects = data.get("projects") or []
    if projects:
        ws = wb.create_sheet(_unique(wb, "Capitalised Development"))
        _title(ws, f"Capitalised development - {data['period']}", sub + f" Shares confirmed by {data.get('alloc_confirmed_by') or 'nobody yet'}"
               + (f", from: {data['alloc_note']}." if data.get("alloc_note") else "."))
        n = len(projects)
        _head(ws, 4, ["Code", "Cost"] + [f"{p} %" for p in projects] + [f"{p} £" for p in projects])
        first = 5
        # Staff at employer cost, then contractors at their bills' net cost (by code only).
        rows = [(e["emp_code"], round(e["basic"] + e["er_nic"] + e["er_pension"], 2)) for e in data["employees"]]
        rows += [(c["code"], round(c.get("cost") or 0, 2)) for c in data.get("contractors") or []]
        for r, (code, cost) in enumerate(rows, start=first):
            ws.cell(row=r, column=1, value=code)
            ws.cell(row=r, column=2, value=cost).number_format = MONEY
            shares = (data.get("alloc") or {}).get(code, {})
            for i, p in enumerate(projects):
                pct = ws.cell(row=r, column=3 + i, value=shares.get(p) or None)
                pct.number_format = PCT
                amt = ws.cell(row=r, column=3 + n + i, value=f"=ROUND($B{r}*{get_column_letter(3 + i)}{r}/100,2)")
                amt.number_format = MONEY
        last = first + len(rows) - 1
        tot = last + 1
        ws.cell(row=tot, column=1, value="Total").font = Font(bold=True)
        bills = [b for c in data.get("contractors") or [] for b in c.get("bills") or []]
        if data.get("contractors"):
            ws.cell(row=tot + 2, column=1, value="Contractors (C codes) at the net of their bills dated in the month"
                    + (f": {', '.join(bills)}." if bills else ": none this month.")).font = Font(italic=True, color="8E9196")
        for i in range(n):
            col = get_column_letter(3 + n + i)
            c = ws.cell(row=tot, column=3 + n + i, value=f"=SUM({col}{first}:{col}{last})")
            c.number_format = MONEY
            c.font = Font(bold=True)
        ws.column_dimensions["A"].width = 12
        ws.column_dimensions["B"].width = 14

    for j in data["journals"]:
        ws = wb.create_sheet(_unique(wb, f"Journal - {KIND.get(j['kind'], j['kind'])}"))
        _title(ws, f"{j['narration']} - {j['entity']}", f"Date {j['date']}. Proposed to the Journals page in os.stza.io; approved there before Xero.")
        _head(ws, 4, ["Account", "Description", "Debit", "Credit", "Tax"])
        first = 5
        for r, line in enumerate(j["lines"], start=first):
            ws.cell(row=r, column=1, value=line["account_code"])
            ws.cell(row=r, column=2, value=line["description"])
            amt = line["amount"]
            ws.cell(row=r, column=3, value=amt if amt > 0 else None).number_format = MONEY
            ws.cell(row=r, column=4, value=-amt if amt < 0 else None).number_format = MONEY
            ws.cell(row=r, column=5, value=line.get("tax_type", "NONE"))
        last = first + len(j["lines"]) - 1
        tot = last + 1
        ws.cell(row=tot, column=2, value="Total").font = Font(bold=True)
        for col in "CD":
            c = ws[f"{col}{tot}"]
            c.value = f"=SUM({col}{first}:{col}{last})"
            c.number_format = MONEY
            c.font = Font(bold=True)
        ws[f"B{tot + 1}"] = "Balances"
        ws[f"C{tot + 1}"] = f'=IF(ABS(C{tot}-D{tot})<0.005,"Yes","No")'
        for col, w in zip("ABCDE", (10, 52, 14, 14, 8)):
            ws.column_dimensions[col].width = w

    return wb


def fetch_source(svc, data: dict) -> tuple[bytes, str]:
    """The provider's export from the month's folder, checked against the file
    uploaded to os.stza.io."""
    from . import drive as gdrive
    drive_id = data["drive"]["drive_id"]
    folder = gdrive.ensure_folder_path(svc, drive_id, data["drive"]["path"])
    fid = gdrive.find_file(svc, drive_id, folder, data["source_name"])
    where = " / ".join(data["drive"]["path"])
    if not fid:
        raise RuntimeError(f"{data['source_name']} is not in {where}: put the provider's export there, then build again")
    content = svc.files().get_media(fileId=fid, supportsAllDrives=True).execute()
    if hashlib.sha256(content).hexdigest() != data["source_sha256"]:
        raise RuntimeError(f"{data['source_name']} in {where} is not the file uploaded to os.stza.io: upload that one again, or put the uploaded one in the folder")
    return content, folder


def run(*, api=None, drive=None) -> int:
    from .api import FinanceApi
    slug = os.environ.get("CLIENT_SLUG", "").strip()
    rid = os.environ.get("PAYROLL_RUN_ID", "").strip()
    api = api or FinanceApi()
    base = f"/api/finance/clients/{slug}/payroll/runs/{rid}"

    def report(body: dict):
        # The one write: where the file went, or why not.
        try:
            if hasattr(api, "report_payroll_workbook"):
                api.report_payroll_workbook(f"{base}/workbook-saved", body)
            else:
                r = api.session.request("POST", f"{api.base_url}{base}/workbook-saved", json=body, timeout=60,
                                        headers={"X-API-Key": api.api_key})
                if r.status_code >= 400:
                    print(f"[payroll] finance-api refused the report: {r.status_code} {r.text[:300]}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[payroll] could not report back: {e}", flush=True)

    try:
        if not slug or not rid:
            raise RuntimeError("CLIENT_SLUG and PAYROLL_RUN_ID must be set")
        data = api.get(f"{base}/workbook-data")
        if not data["drive"].get("drive_id"):
            raise RuntimeError("no shared drive is set in the payroll settings")
        from . import drive as gdrive
        svc = drive or gdrive.drive_service()
        source, _ = fetch_source(svc, data)
        wb = build_workbook(source, data)
        buf = io.BytesIO()
        wb.save(buf)
        name = file_name(data)
        meta = save(svc, data, buf.getvalue(), name)
        # Names only in the log: never a figure or a code.
        print(f"[payroll] saved {meta.get('name')} to {' / '.join(data['drive']['path'])}", flush=True)
        report({"file_id": meta["id"], "name": meta.get("name", name), "link": meta.get("webViewLink", "")})
        return 0
    except Exception as e:  # noqa: BLE001  report every failure; never leave the page waiting
        print(f"[payroll] FAILED: {e}", flush=True)
        for line in traceback.format_exc().splitlines()[-8:]:
            print(line, flush=True)
        report({"error": str(e)[:2000]})
        return 1

"""The payroll working file: the provider's export kept as it came, the
working tabs added, saved beside it. All data made up."""

import hashlib
import io

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font

from pack_engine import payroll_workbook as pw
from recalc import Sheetbook
from test_vat_workbook import FakeDrive, _Exec


def provider_export() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Salary Report"
    ws["A1"] = "Company Name"
    ws["B1"] = "Sample Ltd"
    ws.append([])
    ws.append(["CompanyName", "EmpCode", "Forenames", "Surname", "Basic", "EerNIC", "ErPension"])
    ws.append(["Sample Ltd", "11", "JO", "BLOGGS", 5000, 600, 300])
    ws.append(["Sample Ltd", "12", "SAM", "SAMPLE", 4000, 450, 240])
    ws["D4"].font = Font(bold=True, color="FF0000")
    ws.column_dimensions["D"].width = 31
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


SOURCE = provider_export()


def data(**kw):
    d = {
        "client": "Sample Group", "period": "2026-10", "yymm": "2610", "pay_date": "2026-10-23",
        "source_name": "Salary report M07.xlsx", "source_sha256": hashlib.sha256(SOURCE).hexdigest(),
        "drive": {"drive_id": "drive1", "path": ["Sample", "Payroll", "2610"], "file_id": None},
        "projects": ["P1", "P2"], "alloc": {"11": {"P1": 50}, "12": {"P1": 25, "P2": 25}}, "alloc_confirmed_by": "cfo@example.com",
        "employees": [
            {"emp_code": "11", "role": "director", "basic": 5000, "er_nic": 600, "er_pension": 300},
            {"emp_code": "12", "role": "direct", "basic": 4000, "er_nic": 450, "er_pension": 240},
        ],
        "journals": [
            {"kind": "payroll", "entity": "alpha-ltd", "date": "2026-10-23", "narration": "Oct 2026 Payroll",
             "lines": [{"account_code": "478", "description": "Directors Salary", "amount": 5000, "tax_type": "NONE"},
                       {"account_code": "814", "description": "Net Pay - Payroll", "amount": -5000, "tax_type": "NONE"}]},
        ],
    }
    d.update(kw)
    return d


def test_the_provider_tab_is_kept_exactly_and_the_working_tabs_follow():
    wb = pw.build_workbook(SOURCE, data())
    assert wb.sheetnames == ["Salary Report", "Roles", "Capitalised Development", "Journal - Payroll"]
    src = load_workbook(io.BytesIO(SOURCE))["Salary Report"]
    out = wb["Salary Report"]
    assert [[c.value for c in r] for r in out.iter_rows()] == [[c.value for c in r] for r in src.iter_rows()]
    assert out["D4"].font.bold and out["D4"].font.color.rgb.endswith("FF0000")
    assert out.column_dimensions["D"].width == 31


def test_the_working_tabs_hold_codes_not_names():
    wb = pw.build_workbook(SOURCE, data())
    for name in wb.sheetnames[1:]:
        text = " ".join(str(c.value) for r in wb[name].iter_rows() for c in r if c.value is not None)
        assert "BLOGGS" not in text and "JO " not in text


def test_capitalised_development_and_journal_checks_calculate():
    wb = pw.build_workbook(SOURCE, data())
    buf = io.BytesIO()
    wb.save(buf)
    s = Sheetbook(load_workbook(io.BytesIO(buf.getvalue())))
    # 11: 5900 x 50% = 2950; 12: 4690 x 25% = 1172.50 each.
    assert round(s.value("Capitalised Development", "E5"), 2) == 2950.00
    assert round(s.value("Capitalised Development", "E7"), 2) == 2950 + 1172.5
    assert round(s.value("Capitalised Development", "F7"), 2) == 1172.5
    assert s.value("Journal - Payroll", "C8") == "Yes"


def test_a_tab_name_the_provider_already_uses_is_not_overwritten():
    wb = Workbook()
    wb.active.title = "Roles"
    buf = io.BytesIO()
    wb.save(buf)
    out = pw.build_workbook(buf.getvalue(), data(projects=[]))
    assert out.sheetnames[:2] == ["Roles", "Roles 2"]


class PayrollDrive(FakeDrive):
    def __init__(self, content, existing=()):
        super().__init__(existing)
        self.content = content

    def get_media(self, fileId, **kw):
        return _Exec(self.content)


class Api:
    def __init__(self, d):
        self.d, self.posted = d, []

    def get(self, path, **kw):
        assert path.endswith("/payroll/runs/run1/workbook-data")
        return self.d

    def report_payroll_workbook(self, path, body):
        self.posted.append((path, body))


def _folders(drv):
    parent = "drive1"
    for name in ["Sample", "Payroll", "2610"]:
        drv._n += 1
        fid = f"dir{drv._n}"
        drv.items[fid] = {"name": name, "parent": parent, "folder": True}
        parent = fid
    return parent


def test_run_builds_beside_the_export_and_reports_back(monkeypatch):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("PAYROLL_RUN_ID", "run1")
    drv = PayrollDrive(SOURCE)
    folder = _folders(drv)
    drv.items["src"] = {"name": "Salary report M07.xlsx", "parent": folder, "folder": False}
    api = Api(data())
    assert pw.run(api=api, drive=drv) == 0
    assert drv.created == ["Payroll workings - 2610.xlsx"]
    assert api.posted[0][1]["name"] == "Payroll workings - 2610.xlsx"


def test_run_refuses_a_different_export(monkeypatch):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("PAYROLL_RUN_ID", "run1")
    drv = PayrollDrive(SOURCE + b"x")
    folder = _folders(drv)
    drv.items["src"] = {"name": "Salary report M07.xlsx", "parent": folder, "folder": False}
    api = Api(data())
    assert pw.run(api=api, drive=drv) == 1
    assert "is not the file uploaded" in api.posted[0][1]["error"]
    assert drv.created == []


def test_run_says_where_to_put_the_export(monkeypatch):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("PAYROLL_RUN_ID", "run1")
    drv = PayrollDrive(SOURCE)
    _folders(drv)
    api = Api(data())
    assert pw.run(api=api, drive=drv) == 1
    assert api.posted[0][1]["error"].startswith("Salary report M07.xlsx is not in Sample / Payroll / 2610")

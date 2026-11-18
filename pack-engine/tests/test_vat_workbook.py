"""The VAT return workbook: synthetic exports in Xero's layout (names and
figures made up), read back through the formula evaluator."""

from datetime import datetime, timezone

import pytest

from pack_engine import vat_workbook as vw
from recalc import Sheetbook


def export(entity, boxes, late=False):
    b = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, **boxes}
    b[3] = b[1] + b[2]
    b[5] = round(abs(b[4] - b[3]), 2)
    details = [["VAT Number", "", "GB123456789"], ["VAT Scheme", "", "Accrual"], ["Period covered by the return", "", "Monthly"]]
    if late:
        details.append(["Late VAT Claims included", "", "Yes"])
    details += [["Period Start", "", "01 Oct 2026"], ["Period End", "", "31 Oct 2026"]]
    rows = [["VAT Return"], [entity], ["For the period 01 Oct 2026 - 31 Oct 2026"], [], [], ["VAT Return Details"], *details, [], ["VAT Calculations"]]
    rows += [[f"Label {n}", str(n), str(b[n])] for n in (1, 2, 3, 4, 5)]
    rows += [[], ["Sales and Purchases Excluding VAT"], ["Label 6", "6", str(b[6])], ["Label 7", "7", str(b[7])]]
    rows += [[], ["EC Supplies"], ["Label 8", "8", str(b[8])], ["Label 9", "9", str(b[9])]]
    tx = [["Transactions by VAT Box"], [entity], ["For the period"], [], [], ["Box 4", "VAT reclaimed", "", "", str(b[4]), ""],
          ["20% (VAT on Expenses)"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
          ["03/10/2026", "Rent(469)", "00123", "Sample Landlord", str(b[4]), str(b[7])]]
    return {"VAT Return": rows, "Transactions by VAT Box": tx}


def data(after=None):
    rep = {"entity_id": "r", "name": "Rep Ltd", "code": "REP", "representative": True,
           "sheets": export("Rep Ltd", {1: 20, 4: 120, 6: 100, 7: 600}, late=True), "after_import": after}
    m1 = {"entity_id": "a", "name": "Alpha Ltd", "code": "ALP", "representative": False,
          "sheets": export("Alpha Ltd", {1: 10.5, 4: 40, 6: 52, 7: 200}), "after_import": None}
    m2 = {"entity_id": "b", "name": "Beta Ltd", "code": "BET", "representative": False,
          "sheets": export("Beta Ltd", {4: 7.25, 7: 36}), "after_import": None}
    return {
        "client": "Sample Group", "title": "Sample",
        "return": {"id": "x", "period_start": "2026-10-01", "period_end": "2026-10-31", "status": "building", "vat_number": "123456789", "kind": "group"},
        "drive": {"drive_id": "drive0000001", "path": ["Sample", "VAT", "2026", "2610"], "file_id": None},
        "companies": [rep, m1, m2],
        "checks": {"ok": True, "blocking": [], "checks": [{"key": "period", "ok": True, "blocking": False, "said": "Every export is for the period."}]},
        "group": {"import": {"1": 10.5, "2": 0, "4": 47.25, "6": 52, "7": 236, "8": 0, "9": 0}},
        "confirmation": None,
    }


NOW = datetime(2026, 11, 19, 9, 0, tzinfo=timezone.utc)


def test_group_sheet_sums_the_companies_through_formulas_on_their_tabs():
    wb = vw.build_workbook(data(), now=NOW)
    assert wb.sheetnames[:3] == ["GROUP", "REP - VAT Return", "REP - Transactions by VAT Box"]
    assert wb.sheetnames[-1] == "Checks"
    s = Sheetbook(wb)
    # Columns C, E, G are the companies (representative first), I the group, K the adjustment.
    assert [wb["GROUP"][f"{c}2"].value for c in "CEGIK"] == ["REP", "ALP", "BET", "GROUP", "Adjustment"]
    assert s.number("GROUP", "C16") == 20 and s.number("GROUP", "E16") == 10.5
    assert s.number("GROUP", "I19") == pytest.approx(167.25)          # box 4 for the group
    assert s.number("GROUP", "I20") == pytest.approx(167.25 - 30.5)   # box 5: 4 less 3
    assert s.number("GROUP", "K19") == pytest.approx(47.25)           # the members other than the representative
    assert s.number("GROUP", "I24") == 836
    # The representative's tab has the extra Late VAT Claims row: its boxes sit one row lower, and are still found.
    assert wb["GROUP"]["C16"].value == "='REP - VAT Return'!C15"
    assert wb["GROUP"]["E16"].value == "='ALP - VAT Return'!C14"
    assert s.value("GROUP", "C7") == "GB123456789"


def test_the_import_file_ties_to_the_adjustment_column():
    s = Sheetbook(vw.build_workbook(data(), now=NOW))
    labels = {s.value("GROUP", f"A{r}"): r for r in range(30, 45)}
    assert "Import file made by os.stza.io" in labels
    first = labels["Import file made by os.stza.io"] + 3
    for r in range(first, first + 7):
        assert s.number("GROUP", f"K{r}") == pytest.approx(0), r


def test_after_the_import_the_representative_is_checked_against_the_group():
    after = {"file_name": "rep-after.xlsx", "sheets": {"VAT Return": export("Rep Ltd", {1: 30.5, 4: 167.25, 6: 152, 7: 836})["VAT Return"]}}
    wb = vw.build_workbook(data(after), now=NOW)
    assert "REP - After import" in wb.sheetnames
    s = Sheetbook(wb)
    rows = [r for r in range(40, 70) if s.value("GROUP", f"I{r}") is not None and str(wb["GROUP"][f"I{r}"].value).startswith("='REP - After import'")]
    assert len(rows) == 9
    assert all(s.number("GROUP", f"K{r}") == pytest.approx(0) for r in rows)


def test_xero_text_comes_back_as_numbers_but_references_keep_their_zeros():
    wb = vw.build_workbook(data(), now=NOW)
    ws = wb["ALP - Transactions by VAT Box"]
    assert ws["E9"].value == 40 and ws["C9"].value == "00123"
    assert wb["ALP - VAT Return"]["B14"].value == "1"


def test_file_name_and_sheet_titles():
    assert vw.file_name(data()) == "Sample VAT Group Return - 2610.xlsx"
    assert vw.tab_title("LONGCO", "Transactions by Tax Rate") == "LONGCO - Transactions by Tax Ra"


class _Exec:
    def __init__(self, v):
        self.v = v

    def execute(self):
        return self.v


class FakeDrive:
    def __init__(self, existing=()):
        self.items = {f"f{i}": {"name": n, "parent": p, "folder": False} for i, (n, p) in enumerate(existing)}
        self.created, self.updated, self._n = [], [], 0

    def files(self):
        return self

    def list(self, q, **kw):
        parent = q.split("'")[1]
        name = q.split("name = '")[1].split("'")[0]
        folder = "mimeType = " in q
        return _Exec({"files": [{"id": i} for i, v in self.items.items() if v["parent"] == parent and v["name"] == name and v["folder"] == folder]})

    def create(self, body, media_body=None, **kw):
        self._n += 1
        fid = f"new{self._n}"
        folder = body.get("mimeType", "").endswith("folder")
        self.items[fid] = {"name": body["name"], "parent": body["parents"][0], "folder": folder}
        if not folder:
            self.created.append(body["name"])
        return _Exec({"id": fid, "name": body["name"], "webViewLink": f"https://drive.google.com/file/d/{fid}"})

    def update(self, fileId, body=None, media_body=None, **kw):
        self.updated.append(fileId)
        return _Exec({"id": fileId, "name": body["name"], "webViewLink": f"https://drive.google.com/file/d/{fileId}"})


class FakeApi:
    def __init__(self, d):
        self.d, self.posted = d, []

    def get(self, path, params=None, **kw):
        assert path.endswith("/workbook-data")
        return self.d

    def report_vat_workbook(self, path, body):
        self.posted.append((path, body))
        return {"ok": True}


def test_run_saves_beside_a_hand_kept_file_without_touching_it(monkeypatch, tmp_path):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("VAT_RETURN_ID", "x")
    d = data()
    drive = FakeDrive()
    # The folders exist and hold the hand-kept file of the same name.
    drive.items.update({"s": {"name": "Sample", "parent": "drive0000001", "folder": True},
                        "v": {"name": "VAT", "parent": "s", "folder": True},
                        "y": {"name": "2026", "parent": "v", "folder": True},
                        "m": {"name": "2610", "parent": "y", "folder": True},
                        "hand": {"name": "Sample VAT Group Return - 2610.xlsx", "parent": "m", "folder": False}})
    api = FakeApi(d)
    assert vw.run(api=api, drive=drive, now=NOW) == 0
    assert drive.created == ["Sample VAT Group Return - 2610 (os.stza.io).xlsx"]
    path, body = api.posted[0]
    assert path.endswith("/workbook-saved") and body["file_id"] == "new1" and body["link"].startswith("https://drive.google.com/")


def test_run_replaces_its_own_earlier_file(monkeypatch):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("VAT_RETURN_ID", "x")
    d = data()
    d["drive"]["file_id"] = "earlier01"
    drive = FakeDrive()
    api = FakeApi(d)
    assert vw.run(api=api, drive=drive, now=NOW) == 0
    assert drive.updated == ["earlier01"] and drive.created == []


def test_run_reports_a_failure(monkeypatch):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("VAT_RETURN_ID", "x")
    d = data()
    d["drive"]["drive_id"] = None
    api = FakeApi(d)
    assert vw.run(api=api, drive=FakeDrive(), now=NOW) == 1
    assert "no shared drive" in api.posted[0][1]["error"]


def test_the_report_back_is_one_post_to_finance_api(monkeypatch):
    monkeypatch.setenv("CLIENT_SLUG", "sample")
    monkeypatch.setenv("VAT_RETURN_ID", "x")

    class Resp:
        status_code, text = 200, ""

    class Session:
        def __init__(self):
            self.calls = []

        def request(self, method, url, **kw):
            self.calls.append((method, url, kw["json"], kw["headers"]))
            return Resp()

    class Api:
        base_url, api_key = "https://api.example", "k"

        def __init__(self):
            self.session = Session()

        def get(self, path, **kw):
            return data()

    api = Api()
    assert vw.run(api=api, drive=FakeDrive(), now=NOW) == 0
    method, url, body, headers = api.session.calls[0]
    assert method == "POST" and url == "https://api.example/api/finance/clients/sample/vat/returns/x/workbook-saved"
    assert body["file_id"] and headers == {"X-API-Key": "k"}

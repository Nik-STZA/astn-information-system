from datetime import datetime

import pytest

import pack_engine.build as build_mod
import pack_engine.job as job
from fake_api import FakeApi
from pack_engine.drive import output_folder_path


class FakeDrive:
    """Just enough of the Drive v3 client: folders by name under a parent, uploads."""

    def __init__(self):
        self.items = {}          # id -> {name, parent, folder}
        self.uploads = []
        self._n = 0

    def files(self):
        return self

    def list(self, q, **kw):
        parent = q.split("'")[1]
        name = q.split("name = '")[1].split("'")[0]
        found = [{"id": i} for i, v in self.items.items() if v["parent"] == parent and v["name"] == name and v["folder"]]
        return _Exec({"files": found})

    def create(self, body, media_body=None, **kw):
        self._n += 1
        fid = f"id{self._n}"
        folder = body.get("mimeType", "").endswith("folder")
        self.items[fid] = {"name": body["name"], "parent": body["parents"][0], "folder": folder}
        if not folder:
            self.uploads.append((body["name"], body["parents"][0]))
        return _Exec({"id": fid, "webViewLink": f"https://drive.example/{fid}"})

    def path_of(self, fid):
        parts = []
        while fid in self.items:
            parts.append(self.items[fid]["name"])
            fid = self.items[fid]["parent"]
        return list(reversed(parts))


class _Exec:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


PROFILE = {"client": "demo", "label": "DEMO", "legal_name": "Demo Ltd", "entity": "demo",
           "year_end_month": 3, "first_year_end": "2026-03-31", "framework": "FRS 102 Section 1A",
           "currency": "GBP", "branding": {"tab_colours": None},
           "output": {"drive_id": "drive-finance", "folder_path": ["Management accounts", "{fy}", "{yymm}", "Drafts"]}}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(build_mod, "load_profile", lambda c: PROFILE)
    monkeypatch.setattr(job, "load_profile", lambda c: PROFILE)
    monkeypatch.setattr(build_mod, "FinanceApi", lambda: FakeApi())
    for k, v in {"CLIENT_SLUG": "demo", "PERIOD": "2026-05", "RUN_ID": "run-1",
                 "FINANCE_API_URL": "https://api.example", "FINANCE_API_KEY": "k"}.items():
        monkeypatch.setenv(k, v)
    posted = []
    monkeypatch.setattr(job.requests, "post",
                        lambda url, json, timeout, headers: posted.append((url, json)) or type("R", (), {"status_code": 200})())
    return posted


def test_folder_path_uses_the_financial_year_and_month():
    assert output_folder_path(["Management accounts", "{fy}", "{yymm}", "Drafts"], fy="FY27", period="2026-08") == \
        ["Management accounts", "FY27", "2608", "Drafts"]


def test_a_run_saves_the_pack_to_the_profile_folder_and_reports_success(env):
    drive = FakeDrive()
    assert job.run(drive=drive, now=datetime(2026, 6, 10, 9, 30)) == 0
    names = [n for n, _ in drive.uploads]
    assert names == ["DEMO - Management Pack - May2026 - draft 2026-06-10 0930.xlsx",
                     "DEMO - Management Pack - May2026 - draft 2026-06-10 0930 - controls.json"]
    assert drive.path_of(drive.uploads[0][1]) == ["Management accounts", "FY27", "2605", "Drafts"]
    url, body = env[-1]
    assert url == "https://api.example/api/finance/report-runs/run-1/complete"
    assert body["status"] == "succeeded" and len(body["outputFiles"]) == 2


def test_existing_folders_are_reused_not_duplicated(env):
    drive = FakeDrive()
    job.run(drive=drive, now=datetime(2026, 6, 10, 9, 30))
    job.run(drive=drive, now=datetime(2026, 6, 10, 9, 31))
    assert sum(1 for v in drive.items.values() if v["folder"]) == 4


def test_failed_controls_still_save_the_pack_and_report_failed_with_files(env, monkeypatch):
    monkeypatch.setattr(build_mod, "FinanceApi", lambda: FakeApi(xero_net_profit_offset=1.0))
    drive = FakeDrive()
    assert job.run(drive=drive, now=datetime(2026, 6, 10, 9, 30)) == 3
    _, body = env[-1]
    assert body["status"] == "failed" and body["outputFiles"]
    assert "controls failed" in body["error"] and "FAILED CONTROLS" in body["outputFiles"][0]["name"]


def test_any_error_is_reported_so_the_run_never_hangs(env, monkeypatch):
    monkeypatch.setenv("PERIOD", "")
    assert job.run(drive=FakeDrive()) == 1
    _, body = env[-1]
    assert body["status"] == "failed" and "PERIOD" in body["error"]


def test_draft_names_use_uk_time_not_the_containers_utc(monkeypatch, tmp_path):
    from datetime import timezone
    import pack_engine.build as b
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            utc = datetime(2026, 9, 14, 16, 5, tzinfo=timezone.utc)      # 17:05 in London (BST)
            return utc.astimezone(tz) if tz else utc.replace(tzinfo=None)
    monkeypatch.setattr(b, "datetime", Clock)
    monkeypatch.setattr(b, "load_profile", lambda c: PROFILE)
    res = b.build("demo", "2026-05", tmp_path, api=FakeApi())
    assert "draft 2026-09-14 1705" in res.path.name


"""Outstanding documents in the pack: which items, the two formats, formulas only."""

from datetime import date, datetime

import openpyxl
import pytest

from fake_api import FakeApi
from pack_engine import build as build_mod, outstanding as od
from pack_engine.api import FinanceApiError
from recalc import Sheetbook

NOW = datetime(2026, 6, 10, 9, 30)
MAY_END = date(2026, 5, 31)


def item(**o):
    base = {"state": "open", "txn_date": "2026-05-10", "payee": "Supplier A", "reference": "Supplier A - Jo Bloggs",
            "card_holder": "Jo Bloggs", "bank_account": "Main account", "entity_slug": "alpha-ltd", "entity_name": "Alpha Ltd",
            "direction": "spent", "amount": 120.0, "currency": "GBP", "amount_gbp": None, "concern": "no_vat_invoice",
            "note": None, "chase_count": 0, "last_chased_at": None, "closed_at": None,
            "vat": {"flagged": True, "at_risk_max": 20.0, "reason": None}}
    base.update(o)
    return base


REGISTER = [
    item(),
    item(txn_date="2026-04-02", payee="Hotel", amount=600.0, card_holder="Sam Smith", concern="business_purpose",
         vat={"flagged": True, "at_risk_max": 100.0}, chase_count=2, last_chased_at="2026-05-20", note="Asked twice"),
    item(txn_date="2026-05-03", payee="Software Inc", currency="USD", amount=50.0, amount_gbp=40.0, card_holder="jo  bloggs",
         concern="overseas_reverse_charge", vat={"flagged": False, "at_risk_max": None}),
    item(txn_date="2026-05-20", payee="Refund Co", direction="received", amount=30.0, card_holder=None, concern="other",
         vat={"flagged": False, "at_risk_max": None}, entity_name="Beta Ltd", entity_slug="beta-ltd"),
    # Outstanding at 31 May, document received in June: listed, with its status since.
    item(txn_date="2026-05-25", payee="Printer", amount=90.0, state="received", closed_at="2026-06-04T10:00:00Z",
         vat={"flagged": True, "at_risk_max": 15.0}),
    # Cleared before the month end: not listed.
    item(txn_date="2026-05-01", payee="Cleared", state="received", closed_at="2026-05-31T09:00:00Z"),
    item(txn_date="2026-05-01", payee="Closed", state="accepted", closed_at="2026-05-15T09:00:00Z"),
    # After the month end, still a candidate, or dismissed: not listed.
    item(txn_date="2026-06-01", payee="June cost"),
    item(payee="Waiting", state="candidate"),
    item(payee="Gone", state="dismissed", closed_at="2026-05-02T00:00:00Z"),
]


class Books(FakeApi):
    def __init__(self, register=REGISTER, error=None, missing=False):
        super().__init__()
        self.register, self.error, self.missing, self.asked = register, error, missing, 0

    def outstanding_documents(self, client):
        self.asked += 1
        if self.error:
            raise FinanceApiError(self.error)
        if self.missing:
            return None
        return {"items": self.register, "threshold": 25}


@pytest.fixture
def profile(monkeypatch):
    p = {"client": "demo", "label": "DEMO", "legal_name": "Demo Ltd", "entity": "demo",
         "year_end_month": 3, "first_year_end": "2026-03-31", "framework": "FRS 102 Section 1A",
         "currency": "GBP", "branding": {"tab_colours": None}, "outstanding_documents": {}}
    monkeypatch.setattr(build_mod, "load_profile", lambda client: p)
    return p


def build(tmp_path, api):
    res = build_mod.build("demo", "2026-05", tmp_path, api=api, now=NOW)
    return res, openpyxl.load_workbook(res.path)


def control(res):
    return next(c for c in res.controls if c.key == "outstanding.read")


# --- which items ---------------------------------------------------------------------------

def test_as_at_lists_what_was_outstanding_at_the_month_end():
    payees = [i["payee"] for i in od.as_at(REGISTER, MAY_END)]
    assert payees == ["Hotel", "Software Inc", "Supplier A", "Refund Co", "Printer"]


def test_off_unless_the_profile_asks(tmp_path, profile):
    del profile["outstanding_documents"]
    api = Books()
    res, wb = build(tmp_path, api)
    assert api.asked == 0
    assert od.SUMMARY not in wb.sheetnames and od.APPENDIX not in wb.sheetnames
    assert not any(c.key.startswith("outstanding") for c in res.controls)


# --- summary and appendix ------------------------------------------------------------------

def test_summary_then_list_before_the_controls(tmp_path, profile):
    res, wb = build(tmp_path, Books())
    names = wb.sheetnames
    assert names.index(od.SUMMARY) + 1 == names.index(od.APPENDIX) < names.index("Controls")
    assert control(res).status == "pass" and control(res).detail == "5 items, GBP 850.00 spent"
    assert res.failed == []


def test_the_list_has_every_item_with_its_columns(tmp_path, profile):
    _, wb = build(tmp_path, Books())
    ws = wb[od.APPENDIX]
    head = [ws.cell(od.FIRST_ROW - 1, c).value for c in range(1, len(od.COLUMNS) + 1)]
    assert head[:7] == ["Date", "Month", "Company", "Bank account", "Payee", "Reference", "Card holder / processor"]
    rows = list(ws.iter_rows(min_row=od.FIRST_ROW, max_row=od.FIRST_ROW + 4, values_only=True))
    byname = {r[od.COL["payee"] - 1]: r for r in rows}
    assert byname["Software Inc"][od.COL["spent"] - 1] == 40.0 and byname["Software Inc"][od.COL["holder"] - 1] == "Jo Bloggs"
    assert byname["Refund Co"][od.COL["received"] - 1] == 30.0 and byname["Refund Co"][od.COL["holder"] - 1] == od.NO_HOLDER
    assert byname["Printer"][od.COL["status"] - 1] == "Document received 2026-06-04"
    assert byname["Hotel"][od.COL["chased"] - 1] == 2 and byname["Hotel"][od.COL["concern"] - 1] == "Business purpose unclear"
    assert ws.cell(od.FIRST_ROW + 5, 1).value == "Total"
    assert ws.column_dimensions[openpyxl.utils.get_column_letter(od.COL["n"])].hidden


def test_every_summary_figure_is_a_formula_that_reads_back(tmp_path, profile):
    res, wb = build(tmp_path, Books())
    ws, book = wb[od.SUMMARY], Sheetbook(wb)
    assert next(c for c in res.controls if c.key == "workbook.formulas").status == "pass"
    values = {}
    for r in range(1, ws.max_row + 1):
        label = ws.cell(r, 1).value
        if label and isinstance(ws.cell(r, 2).value, str) and ws.cell(r, 2).value.startswith("="):
            values.setdefault(label, []).append([book.number(od.SUMMARY, ws.cell(r, c).coordinate) for c in range(2, 6)])
        elif label and isinstance(ws.cell(r, 3).value, str) and ws.cell(r, 3).value.startswith("="):
            values.setdefault(label, []).append(book.number(od.SUMMARY, ws.cell(r, 3).coordinate))
    assert values["Spent, GBP"] == [850.0] and values["Received, GBP"] == [30.0]
    assert values["VAT not recoverable, up to GBP"] == [135.0]
    # Card holders by spend; one spelling of a name is one row; no one last.
    holders = [ws.cell(r, 1).value for r in range(1, ws.max_row + 1)
               if ws.cell(r, 1).value in ("Sam Smith", "Jo Bloggs", "jo bloggs", od.NO_HOLDER)]
    assert holders == ["Sam Smith", "Jo Bloggs", od.NO_HOLDER]
    assert values["Jo Bloggs"] == [[3, 250.0, 0, 35.0]] and values[od.NO_HOLDER] == [[1, 0, 30.0, 0]]
    assert values["Sam Smith"] == [[1, 600.0, 0, 100.0]]
    assert values["Business purpose unclear"] == [[1, 600.0, 0, 100.0]]
    assert values["Beta Ltd"] == [[1, 0, 30.0, 0]]
    assert values["Apr 2026"] == [[1, 600.0, 0, 100.0]] and values["May 2026"] == [[4, 250.0, 30.0, 35.0]]
    totals = values["Total"]
    assert all(t == [5, 850.0, 30.0, 135.0] for t in totals) and len(totals) == 4


def test_full_list_format_is_the_list_only(tmp_path, profile):
    profile["outstanding_documents"] = {"format": "full_list"}
    _, wb = build(tmp_path, Books())
    assert od.SUMMARY not in wb.sheetnames and od.APPENDIX in wb.sheetnames
    assert wb[od.APPENDIX]["A1"].value == od.SUMMARY


def test_an_unknown_format_falls_back_to_summary_and_appendix():
    assert od.settings({"outstanding_documents": {"format": "nope"}}) == {"format": "summary_appendix"}
    assert od.settings({}) is None


def test_no_items_still_writes_the_section(tmp_path, profile):
    res, wb = build(tmp_path, Books(register=[]))
    assert control(res).detail == "0 items, GBP 0.00 spent"
    assert wb[od.APPENDIX].cell(od.FIRST_ROW, 1).value == "Total"
    assert res.failed == []


# --- never fails the build -----------------------------------------------------------------

def test_a_failed_read_leaves_the_section_out_with_a_warning(tmp_path, profile):
    res, wb = build(tmp_path, Books(error="GET failed 502"))
    assert control(res).status == "warn" and "left out" in control(res).detail
    assert od.APPENDIX not in wb.sheetnames
    assert res.failed == []


def test_a_finance_api_without_the_register_warns(tmp_path, profile):
    res, _ = build(tmp_path, Books(missing=True))
    assert control(res).status == "warn"


def test_a_name_with_wildcard_characters_matches_only_itself(tmp_path, profile):
    register = [item(card_holder="A*B Ltd", amount=10.0), item(card_holder="AxB Ltd", amount=5.0),
                item(card_holder="<Jo>", amount=7.0)]
    assert od.criterion("A*B Ltd") == '"=A~*B Ltd"' and od.criterion('Say "hi"') == '"=Say ""hi"""'
    _, wb = build(tmp_path, Books(register=register))
    ws, book = wb[od.SUMMARY], Sheetbook(wb)
    got = {ws.cell(r, 1).value: book.number(od.SUMMARY, ws.cell(r, 3).coordinate)
           for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value in ("A*B Ltd", "AxB Ltd", "<Jo>")}
    assert got == {"A*B Ltd": 10.0, "AxB Ltd": 5.0, "<Jo>": 7.0}

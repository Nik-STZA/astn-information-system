"""Saved mappings and client categories from finance-api (migration 017)."""

import json
from datetime import datetime
from pathlib import Path

import openpyxl
import pytest

import fake_api
from fake_api import FakeApi
from pack_engine import build as build_mod
from pack_engine.api import FinanceApi
from pack_engine.ledger import account_from_xero
from pack_engine.mapping import CATEGORIES, categories_from_api, propose, resolve_mapping

NOW = datetime(2026, 6, 10, 9, 30)
CASES = json.loads((Path(__file__).parent / "mapping_rule_cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["note"] for c in CASES])
def test_rules_match_the_cases_shared_with_finance_api(case):
    a = account_from_xero({"AccountID": "x", **case["account"]})
    assert resolve_mapping([a])["x"].category == case["expected"]


def standard_rows(**changes):
    rows = [{"key": c.key, "label": c.label, "statement": c.statement, "section": c.section,
             "sortOrder": c.order, "cashFlow": c.cash_flow, "active": True} for c in CATEGORIES]
    for key, patch in changes.items():
        rows = [{**r, **patch} if r["key"] == key else r for r in rows]
    return rows


def saved(status="approved", categories=None, overrides=None):
    """Every fake account saved with its rule category, as the portal would after 'approve all'."""
    mappings = []
    for a in fake_api.ACCOUNTS:
        acc = account_from_xero(a)
        m = {"accountId": acc.id, "code": acc.code, "name": acc.name, "class": acc.klass,
             "category": propose(acc).category, "cashFlow": None, "status": status, "source": "rule",
             "reason": "rule", "approvedBy": "nik@stza.io" if status == "approved" else None,
             "approvedAt": "2026-09-14T17:00:00Z" if status == "approved" else None}
        mappings.append({**m, **((overrides or {}).get(acc.id, {}))})
    return {"categories": categories if categories is not None else standard_rows(), "mappings": mappings}


@pytest.fixture
def profile(monkeypatch):
    p = {"client": "demo", "label": "DEMO", "legal_name": "Demo Ltd", "entity": "demo",
         "year_end_month": 3, "first_year_end": "2026-03-31", "framework": "FRS 102 Section 1A",
         "currency": "GBP", "branding": {"tab_colours": None}}
    monkeypatch.setattr(build_mod, "load_profile", lambda client: p)
    return p


def control(res, key):
    return next(c for c in res.controls if c.key == key)


def rows_labelled(ws):
    return {str(ws.cell(r, 1).value).strip(): r for r in range(5, ws.max_row + 1) if ws.cell(r, 1).value}


def test_a_fully_approved_mapping_passes_the_approval_control(tmp_path, profile):
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=saved()), now=NOW)
    assert res.failed == []
    assert control(res, "mapping.approved").status == "pass"
    wb = openpyxl.load_workbook(res.path)
    assert "approved in the portal" in " ".join(str(wb["Contents"].cell(r, 1).value) for r in range(1, 12))
    statuses = {wb["Mapping"].cell(r, 9).value for r in range(5, wb["Mapping"].max_row + 1)} - {None}
    assert statuses == {"Approved"}


def test_saved_but_unapproved_and_rule_only_accounts_warn(tmp_path, profile):
    data = saved(status="proposed")
    data["mappings"] = [m for m in data["mappings"] if m["accountId"] != "a-rent"]    # nothing saved for rent
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    c = control(res, "mapping.approved")
    assert c.status == "warn" and "saved but not approved" in c.detail and "1 mapped by rule only" in c.detail
    assert res.failed == []


def test_an_older_finance_api_falls_back_to_rules_with_a_warning(tmp_path, profile):
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=None), now=NOW)
    c = control(res, "mapping.approved")
    assert c.status == "warn" and "no saved mappings" in c.detail
    assert res.failed == []


def test_the_saved_category_wins_over_the_rule(tmp_path, profile):
    data = saved(overrides={"a-rent": {"category": "administrative"}})
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    ws = openpyxl.load_workbook(res.path)["Profit and loss"]
    rows = rows_labelled(ws)
    assert "Establishment costs" not in rows
    assert rows["469 - Rent"] > rows["Administrative expenses"]
    assert res.failed == []


def test_a_category_switched_off_for_the_client_leaves_a_gap_that_fails(tmp_path, profile):
    data = saved(categories=standard_rows(establishment={"active": False}))
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    gap = next(c for c in res.failed if c.key == "mapping.coverage")
    assert "469 - Rent" in gap.detail


def test_a_client_only_category_is_drawn_in_its_section_and_the_statements_still_tie(tmp_path, profile):
    rows = standard_rows() + [{"key": "pension_costs", "label": "Pension costs", "statement": "pnl",
                               "section": "overheads", "sortOrder": 35, "cashFlow": None, "active": True}]
    data = saved(categories=rows, overrides={"a-pen": {"category": "pension_costs"}})
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    ws = openpyxl.load_workbook(res.path)["Profit and loss"]
    labels = rows_labelled(ws)
    assert labels["Staff costs"] < labels["Pension costs"] < labels["Establishment costs"] < labels["Total overheads"]
    toh = ws.cell(labels["Total overheads"], 6).value
    assert f"F{labels['Pension costs']}" in toh


def test_management_ebitda_sits_after_cash_overheads_and_before_depreciation(tmp_path, profile):
    rows = standard_rows() + [{"key": "capitalised_dev", "label": "Capitalised Development", "statement": "pnl",
                               "section": "overheads", "sortOrder": 45, "cashFlow": None, "active": True}]
    data = saved(categories=rows, overrides={"a-pen": {"category": "capitalised_dev"}})
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    ws = openpyxl.load_workbook(res.path)["Profit and loss"]
    labels = rows_labelled(ws)
    assert labels["Capitalised Development"] < labels["Total overheads"] < labels["Management EBITDA"] < labels["Operating profit"]
    ebitda = ws.cell(labels["Management EBITDA"], 6).value
    assert f"F{labels['Gross profit']}" in ebitda and f"F{labels['Total overheads']}" in ebitda
    if "Depreciation and amortisation" in labels:
        assert labels["Management EBITDA"] < labels["Depreciation and amortisation"] < labels["Operating profit"]
        assert f"F{labels['Depreciation and amortisation']}" in ws.cell(labels["Operating profit"], 6).value
        assert f"F{labels['Depreciation and amortisation']}" not in ws.cell(labels["Total overheads"], 6).value


def test_sublines_group_a_category_and_its_total_is_theirs(tmp_path, profile):
    data = saved(overrides={"a-sal": {"subline": "Salaries"}, "a-pen": {"subline": "Pensions & benefits"}})
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    ws = openpyxl.load_workbook(res.path)["Profit and loss"]
    labels = rows_labelled(ws)
    sal_head, pen_head, staff = labels["Salaries"], labels["Pensions & benefits"], labels["Staff costs"]
    assert staff < sal_head < labels["477 - Salaries"] < pen_head < labels["481 - Pension"]
    assert ws.cell(staff, 6).value == f"=F{sal_head}+F{pen_head}"
    assert ws.cell(sal_head, 6).value == f"=SUM(F{sal_head + 1}:F{sal_head + 1})"
    assert ws.row_dimensions[sal_head].outlineLevel == 1 and ws.row_dimensions[labels["477 - Salaries"]].outlineLevel == 2
    # A category with no sub-lines draws as before.
    rent = labels["Establishment costs"]
    assert ws.cell(rent, 6).value.startswith("=SUM(")


def test_a_cash_flow_override_moves_one_account(tmp_path, profile):
    data = saved(overrides={"a-cred": {"cashFlow": "loans"}})
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    wb = openpyxl.load_workbook(res.path)
    cf = rows_labelled(wb["Cash flow"])
    bs_row = rows_labelled(wb["Balance sheet"])["800 - Accounts Payable"]
    assert f"'Balance sheet'!G{bs_row}" in wb["Cash flow"].cell(cf["Loans"], 7).value
    assert "Increase/(decrease) in creditors" not in cf     # nothing else is working capital credit


def test_categories_the_pack_cannot_draw_are_refused():
    with pytest.raises(ValueError, match="cannot draw"):
        categories_from_api(standard_rows(turnover={"section": "fixed_assets"}))


def test_account_mapping_is_none_when_finance_api_has_no_such_route():
    class Resp:
        status_code, text = 404, "Cannot GET"

    class Session:
        def get(self, *a, **k):
            return Resp()

    api = FinanceApi("https://api.example", "k", session=Session(), sleep=lambda s: None)
    assert api.account_mapping("demo", "demo") is None


def test_a_statutory_template_has_no_ebitda_and_depreciation_sits_in_overheads(tmp_path, profile):
    data = {**saved(), "layout": {"template": "standard_statutory", "ebitda": False,
                                  "labels": {"total_overheads": "Total administrative expenses"}}}
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    ws = openpyxl.load_workbook(res.path)["Profit and loss"]
    labels = rows_labelled(ws)
    assert "Management EBITDA" not in labels and "Total overheads" not in labels
    toh = labels["Total administrative expenses"]
    op = ws.cell(labels["Operating profit"], 6).value
    assert op == f"=F{labels['Gross profit']}+F{toh}"
    if "Depreciation and amortisation" in labels:
        assert labels["Depreciation and amortisation"] < toh
        assert f"F{labels['Depreciation and amortisation']}" in ws.cell(toh, 6).value


def test_the_template_names_the_subtotals_and_orders_the_sublines(tmp_path, profile):
    data = {**saved(overrides={"a-sal": {"subline": "Salaries"}, "a-pen": {"subline": "Pensions & benefits"}}),
            "layout": {"template": "x", "ebitda": True, "labels": {"net_profit": "Net profit"},
                       "sublineOrder": {"staff_costs": ["pensions  &  BENEFITS", "Salaries"]}}}
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    labels = rows_labelled(openpyxl.load_workbook(res.path)["Profit and loss"])
    assert "Net profit" in labels and "Profit for the financial period" not in labels
    assert "Management EBITDA" in labels
    assert labels["Staff costs"] < labels["Pensions & benefits"] < labels["Salaries"]


def test_no_layout_draws_as_before():
    from pack_engine.mapping import Layout, layout_from_api
    assert layout_from_api(None) == Layout()
    assert layout_from_api({"labels": {"bogus": "x"}}).label("gross_profit") == "Gross profit"


def test_the_template_names_the_lines_below_ebitda(tmp_path, profile):
    data = {**saved(), "layout": {"template": "x", "ebitda": True, "belowEbitda": ["depreciation", "establishment"]}}
    res = build_mod.build("demo", "2026-05", tmp_path, api=FakeApi(saved_mapping=data), now=NOW)
    assert res.failed == []
    ws = openpyxl.load_workbook(res.path)["Profit and loss"]
    labels = rows_labelled(ws)
    est = labels["Establishment costs"]
    assert labels["Total overheads"] < labels["Management EBITDA"] < est < labels["Operating profit"]
    assert f"F{est}" not in ws.cell(labels["Total overheads"], 6).value
    assert f"F{est}" in ws.cell(labels["Operating profit"], 6).value

"""Supplier tabs. All figures and names here are made up.

The fake company (fake_api.py) has salaries 300 and pension 30 in April and May,
rent 100 in both, and salaries 400 in the prior year, booked in March 2026.
"""

from datetime import date, datetime

import openpyxl
import pytest

from fake_api import FakeApi
from pack_engine import api as api_mod
from pack_engine import build as build_mod
from pack_engine import suppliers as sup
from pack_engine.api import FinanceApi, FinanceApiError
from recalc import Sheetbook

NOW = datetime(2026, 6, 10, 9, 30)
APR, MAY = date(2026, 4, 30), date(2026, 5, 31)
STAFF, RENT = "Staff costs", "Establishment costs"
SOURCE_RECON = sup.RECONCILIATION


def bill(amount, code, when, supplier, status="AUTHORISED", kind="ACCPAY", **extra):
    return {"Type": kind, "Status": status, "Date": when, "Contact": {"Name": supplier},
            "LineItems": [{"AccountCode": code, "LineAmount": amount}], **extra}


def journal(amount, code, when, narration, status="POSTED"):
    return {"Status": status, "Date": when, "Narration": narration,
            "JournalLines": [{"AccountCode": code, "LineAmount": amount}]}


def clean_books():
    """Documents that tie to the fake company's trial balances exactly."""
    return {
        "Invoices": [bill(100, "469", "2026-04-01", "Landlord Co"), bill(100, "469", "2026-05-01", "Landlord Co"),
                     bill(30, "481", "2026-04-30", "Pension Co"), bill(30, "481", "2026-05-31", "Pension Co")],
        "CreditNotes": [],
        "BankTransactions": [],
        "ManualJournals": [journal(300, "477", "2026-04-30", "Payroll April"),
                           journal(300, "477", "2026-05-31", "Payroll May"),
                           journal(400, "477", "2026-03-31", "Payroll prior year")],
    }


class Books(FakeApi):
    """FakeApi with finance-api's document reads."""

    def __init__(self, docs=None, budgets=None, budget_error=None, read_error=None, **kw):
        super().__init__(**kw)
        self.docs = docs if docs is not None else clean_books()
        self.budgets, self.budget_error, self.read_error = budgets, budget_error, read_error
        self.reads = []

    def pace(self):
        self.reads.append("pace")

    def paged(self, client, entity, resource, key, **params):
        self.reads.append((resource, params))
        if self.read_error:
            raise FinanceApiError(self.read_error)
        return self.docs[key]

    def read(self, client, entity, resource, **params):
        self.reads.append((resource, params))
        if self.budget_error:
            raise FinanceApiError(self.budget_error)
        if resource == "budgets":
            return {"Budgets": [{"BudgetID": "b-1", "Type": "OVERALL"}] if self.budgets else []}
        return {"Budgets": [{"BudgetLines": self.budgets}]}


@pytest.fixture
def profile(monkeypatch):
    p = {"client": "demo", "label": "DEMO", "legal_name": "Demo Ltd", "entity": "demo",
         "year_end_month": 3, "first_year_end": "2026-03-31", "framework": "FRS 102 Section 1A",
         "currency": "GBP", "branding": {"tab_colours": None}, "supplier_tabs": {}}
    monkeypatch.setattr(build_mod, "load_profile", lambda client: p)
    return p


def build(tmp_path, api):
    res = build_mod.build("demo", "2026-05", tmp_path, api=api, now=NOW)
    return res, openpyxl.load_workbook(res.path)


def row_of(ws, label, start=5):
    return next(r for r in range(start, ws.max_row + 1) if str(ws.cell(r, 1).value or "").strip() == label)


def fails(res):
    return {c.key: c for c in res.failed if c.key.startswith("suppliers")}


# --- the defect: months overstated ------------------------------------------------------------

def laptop_journal_feed(journals):
    """aggregate_journals from the laptop script, reduced to its arithmetic."""
    out = {}
    for j in journals:
        for line in j["JournalLines"]:
            amt = abs(float(line["NetAmount"]))
            out[j["Month"]] = out.get(j["Month"], 0) + amt
    return out


def test_the_laptop_journal_feed_overstates_a_month_with_a_reversal():
    # Xero's feed for a bill of 100 edited to 90 in the month: the original, its
    # reversal, and the replacement. The ledger's cost is 90; abs() says 290.
    feed = [{"Month": 5, "JournalLines": [{"NetAmount": v}]} for v in (100, -100, 90)]
    assert laptop_journal_feed(feed) == {5: 290.0}
    docs = sup.ledger_from_documents(manual_journals=[journal(100, "469", "2026-05-01", "x"),
                                                      journal(-100, "469", "2026-05-02", "x"),
                                                      journal(90, "469", "2026-05-03", "x")])
    assert docs == {("469", "x", MAY): 90.0}


def test_a_reversal_reduces_the_supplier_it_belongs_to():
    docs = sup.ledger_from_documents(manual_journals=[journal(500, "469", "2026-04-30", "Accrual"),
                                                      journal(-500, "469", "2026-05-01", "Accrual")])
    assert docs == {("469", "Accrual", APR): 500.0, ("469", "Accrual", MAY): -500.0}


def test_a_credit_note_reduces_spend():
    docs = sup.ledger_from_documents(credit_notes=[bill(40, "469", "2026-05-02", "Landlord Co", kind="ACCPAYCREDIT")])
    assert docs == {("469", "Landlord Co", MAY): -40.0}


@pytest.mark.parametrize("status", ["DRAFT", "SUBMITTED", "VOIDED", "DELETED"])
def test_a_bill_that_has_not_reached_the_ledger_is_not_spend(status):
    assert sup.ledger_from_documents(invoices=[bill(999, "469", "2026-05-02", "Landlord Co", status=status)]) == {}


@pytest.mark.parametrize("status,counted", [("POSTED", True), ("DRAFT", False), ("VOIDED", False)])
def test_only_posted_journals_count(status, counted):
    assert bool(sup.ledger_from_documents(manual_journals=[journal(10, "469", "2026-05-02", "x", status)])) == counted


def test_money_received_on_a_cost_account_and_recharges_reduce_it():
    docs = sup.ledger_from_documents(
        invoices=[bill(25, "469", "2026-05-02", "Tenant Co", kind="ACCREC")],
        bank_transactions=[{"Type": "RECEIVE", "Status": "AUTHORISED", "Date": "2026-05-03", "Contact": {"Name": "Tenant Co"},
                            "LineItems": [{"AccountCode": "469", "LineAmount": 5}]},
                           {"Type": "SPEND", "Status": "DELETED", "Date": "2026-05-03", "Contact": {"Name": "Tenant Co"},
                            "LineItems": [{"AccountCode": "469", "LineAmount": 5000}]}])
    assert docs == {("469", "Tenant Co", MAY): -30.0}


def test_a_supplier_that_nets_to_a_credit_keeps_its_row():
    only = sup.suppliers_of("469", {("469", "Refund Co", MAY): -30.0}, [APR, MAY], [APR, MAY])
    assert [(s.name, s.status, s.actual) for s in only] == [("Refund Co", "New this year", {MAY: -30.0})]


def test_tax_inclusive_lines_and_foreign_currency_are_net_and_in_base_currency():
    doc = bill(240, "469", "/Date(1777593600000+0000)/", "Overseas Co", LineAmountTypes="Inclusive", CurrencyRate=2.0)
    doc["LineItems"][0]["TaxAmount"] = 40
    assert sup.ledger_from_documents(invoices=[doc]) == {("469", "Overseas Co", date(2026, 5, 31)): 100.0}


# --- a clean build ----------------------------------------------------------------------------

def test_a_clean_build_passes_every_control_and_adds_the_tabs(tmp_path, profile):
    res, wb = build(tmp_path, Books())
    assert [c.label for c in res.failed] == []
    assert wb.sheetnames == ["Contents", "Profit and loss", "Balance sheet", "Cash flow", STAFF, RENT,
                             SOURCE_RECON, sup.SOURCE, "Controls", "Mapping", "Source - Trial balance"]
    keys = {c.key for c in res.controls}
    assert {f"suppliers.account.{APR}", f"suppliers.account.{MAY}", "suppliers.account.2026-03-31",
            "suppliers.account.2025-05-31", f"suppliers.pnl.{MAY}", "suppliers.pnl.prior"} <= keys


def test_without_the_profile_setting_nothing_is_read_or_added(tmp_path, profile):
    del profile["supplier_tabs"]
    api = Books()
    res, wb = build(tmp_path, api)
    assert api.reads == []
    assert wb.sheetnames == ["Contents", "Profit and loss", "Balance sheet", "Cash flow", "Controls", "Mapping",
                             "Source - Trial balance"]
    assert not any(c.key.startswith("suppliers") for c in res.controls)


def test_the_tab_keeps_the_laptop_layout(tmp_path, profile):
    _, wb = build(tmp_path, Books())
    ws = wb[STAFF]
    assert ws["A1"].value == "Staff costs - Supplier detail (accrued basis)"
    assert [ws.cell(4, c).value for c in (1, 2, 3, 14, 15, 16)] == ["Line", "Basis", "Apr", "Mar", "YTD", "FY"]
    assert [ws.cell(6 + i, 2).value for i in range(8)] == ["Actual", "PY", "Var GBP", "Var %", None, "Budget",
                                                           "Var vs Bud GBP", "Var vs Bud %"]
    assert ws.cell(6, 1).value == STAFF
    assert ws.freeze_panes == "C5" and ws.sheet_properties.outlinePr.summaryBelow is False
    account = row_of(ws, "477 - Salaries")
    vendor = row_of(ws, "Payroll April  [NEW]")
    assert ws.row_dimensions[6].outlineLevel == 0
    assert ws.row_dimensions[account].outlineLevel == 1 and ws.row_dimensions[vendor].outlineLevel == 2
    assert ws.column_dimensions["Q"].hidden


def test_values_read_back_correctly(tmp_path, profile):
    _, wb = build(tmp_path, Books())
    book = Sheetbook(wb)
    ws = wb[RENT]
    at = lambda c, r: book.value(RENT, f"{c}{r}")
    top = 6                                                           # category block
    assert (at("C", top), at("D", top), at("O", top)) == (100, 100, 200)
    assert at("E", top) is None                                       # June not reported
    account = row_of(ws, "469 - Rent")
    assert (at("D", account), at("O", account)) == (100, 200)
    vendor = row_of(ws, "Landlord Co  [NEW]")
    assert (at("C", vendor), at("D", vendor), at("O", vendor)) == (100, 100, 200)
    salaries = row_of(wb[STAFF], "477 - Salaries")
    assert book.value(STAFF, f"N{salaries + 1}") == 400               # PY, March column
    assert book.value(STAFF, f"P{salaries + 1}") == 400               # PY full year
    assert book.value(STAFF, f"O{salaries + 1}") == 0                 # PY to May only
    assert book.value(STAFF, f"P{salaries}") is None                  # the year is not finished
    assert book.value(STAFF, f"C{salaries + 2}") == 300               # Var = 300 - 0
    assert book.value(STAFF, f"C{salaries + 3}") == 0                 # Var % with no PY


def test_totals_are_formulas_and_controls_see_them(tmp_path, profile):
    res, wb = build(tmp_path, Books())
    ws = wb[STAFF]
    pension, salaries = row_of(ws, "481 - Pension"), row_of(ws, "477 - Salaries")
    assert {salaries, pension} and ws["C6"].value == f"=C{salaries}+C{pension}"
    assert ws[f"C{salaries}"].value.startswith("='Source - Supplier ledger'!")
    assert ws[f"O{salaries}"].value == f"=SUM(C{salaries}:D{salaries})"
    typed = [c.coordinate for r in ws.iter_rows(min_row=5, max_col=16, min_col=3) for c in r
             if isinstance(c.value, (int, float))]
    assert typed == []
    assert next(c for c in res.controls if c.key == "workbook.formulas").status == "pass"


def test_a_missing_accrual_shows_as_nil_for_that_supplier_and_month(tmp_path, profile):
    docs = clean_books()
    docs["Invoices"][1]["Contact"]["Name"] = "Other Co"     # May's rent came from someone else
    res, wb = build(tmp_path, Books(docs))
    assert res.failed == []                                  # the account still ties
    ws, book = wb[RENT], Sheetbook(wb)
    vendor = row_of(ws, "Landlord Co  [NEW]")
    assert ws[f"D{vendor}"].value is not None                # a formula, not a blank
    assert book.value(RENT, f"D{vendor}") == 0
    assert ws[f"D{vendor}"].number_format == '#,##0;(#,##0);"-"'
    assert ws[f"E{vendor}"].value is None                    # an unreported month is blank, not nil


def test_status_tags_order_continuing_new_stopped(tmp_path, profile):
    docs = clean_books()
    docs["Invoices"][0] = bill(60, "469", "2026-04-01", "Landlord Co")
    docs["Invoices"].append(bill(40, "469", "2026-04-02", "New Co"))
    docs["Invoices"].append(bill(10, "469", "2025-06-01", "Landlord Co"))
    docs["Invoices"].append(bill(5, "469", "2025-06-01", "Gone Co"))
    res, wb = build(tmp_path, Books(docs))
    ws = wb[RENT]
    labels = [str(ws.cell(r, 1).value).strip() for r in range(row_of(ws, "469 - Rent") + 1, ws.max_row + 1)
              if ws.cell(r, 1).value]
    assert labels == ["Landlord Co", "New Co  [NEW]", "Gone Co  [STOPPED]"]


def test_fills_fonts_and_number_formats(tmp_path, profile):
    _, wb = build(tmp_path, Books())
    ws = wb[RENT]
    hdr, cat, acc, ven = ws["C4"], ws["C6"], ws[f"C{row_of(ws, '469 - Rent')}"], ws[f"C{row_of(ws, 'Landlord Co  [NEW]')}"]
    assert hdr.fill.fgColor.rgb.endswith("000000") and hdr.font.color.rgb.endswith("FFFFFF")
    assert cat.fill.fgColor.rgb.endswith("000000") and cat.font.color.rgb.endswith("FFFFFF") and cat.font.bold
    assert acc.fill.fgColor.rgb.endswith("D9D9D9") and acc.font.bold
    assert ven.fill.fgColor.rgb.endswith("F2F2F2") and ven.font.bold
    assert all(c.font.name == "Calibri" for c in (hdr, cat, acc, ven))
    assert ws["C8"].number_format == '#,##0;(#,##0);"-"' and ws["C9"].number_format == '0.0%;(0.0%);"-"'
    assert ws["P6"].fill.fgColor.rgb.endswith("000000") and ws["Q6"].value is None


def test_conditional_formats_cover_exactly_the_variance_rows(tmp_path, profile):
    _, wb = build(tmp_path, Books())
    ws = wb[RENT]
    var_rows = {r for r in range(6, ws.max_row + 1)
                if ws.cell(r, 2).value in ("Var GBP", "Var %", "Var vs Bud GBP", "Var vs Bud %")}
    assert var_rows
    formats = list(ws.conditional_formatting)
    assert len(formats) == 1
    rules = {r.operator: r for r in formats[0].rules}
    assert rules["greaterThan"].dxf.font.color.rgb.endswith("9C0006")     # more cost: adverse
    assert rules["lessThan"].dxf.font.color.rgb.endswith("006100")        # less cost: favourable
    covered = {(rng.min_row, rng.min_col, rng.max_row, rng.max_col) for rng in formats[0].sqref.ranges}
    assert covered == {(r, 3, r, 16) for r in var_rows}


def test_a_period_at_the_year_end_fills_the_fy_column(tmp_path, profile, monkeypatch):
    import fake_api
    for m in range(6, 13):
        monkeypatch.setitem(fake_api.MONTHS, build_mod.month_end(2026, m), {})
    for y, m in ((2027, 1), (2027, 2), (2027, 3)):
        monkeypatch.setitem(fake_api.MONTHS, build_mod.month_end(y, m), {})
    res = build_mod.build("demo", "2027-03", tmp_path, api=Books(), now=NOW)
    wb = openpyxl.load_workbook(res.path)
    ws, book = wb[RENT], Sheetbook(wb)
    account = row_of(ws, "469 - Rent")
    assert book.value(RENT, f"P{account}") == 200 and book.value(RENT, f"P{account + 2}") == 200
    assert fails(res) == {}


# --- budget -----------------------------------------------------------------------------------

def balances(*pairs):
    return [{"Period": p, "Amount": a} for p, a in pairs]


def test_no_budget_leaves_the_rows_blank_never_nil(tmp_path, profile):
    res, wb = build(tmp_path, Books())
    assert res.failed == []
    ws = wb[RENT]
    for r in (6, row_of(ws, "469 - Rent"), row_of(ws, "Landlord Co  [NEW]")):
        for offset in (sup.ROW["budget"], sup.ROW["var_bud"], sup.ROW["var_bud_pct"]):
            cells = [ws.cell(r + offset, c).value for c in range(3, 17)]
            assert cells == [None] * 14
    assert not any(c.key == "suppliers.budget" for c in res.controls)


def test_a_budget_fills_only_the_months_and_accounts_that_have_one(tmp_path, profile):
    budgets = [{"AccountCode": "469", "BudgetBalances": balances(("2026-04", 90), ("2026-05", 120), ("2026-06", 0))}]
    api = Books(budgets=budgets)
    res, wb = build(tmp_path, api)
    assert res.failed == []
    ws, book = wb[RENT], Sheetbook(wb)
    budget, acc = sup.ROW["budget"], row_of(ws, "469 - Rent")
    assert book.value(RENT, f"C{acc + budget}") == 90 and book.value(RENT, f"D{acc + budget}") == 120
    assert ws[f"E{acc + budget}"].value is None                     # a nil is not a budget
    assert book.value(RENT, f"C{acc + sup.ROW['var_bud']}") == 10
    assert book.value(RENT, f"D{acc + sup.ROW['var_bud']}") == -20
    assert book.value(RENT, f"O{acc + sup.ROW['var_bud']}") == -10   # YTD
    assert book.value(RENT, f"P{acc + budget}") == 210               # FY
    assert ws[f"P{acc + sup.ROW['var_bud']}"].value is None          # the year is not finished
    assert book.value(RENT, f"C{6 + budget}") == 90                  # the category carries it up
    vendor = row_of(ws, "Landlord Co  [NEW]")
    assert ws[f"C{vendor + budget}"].value is None                   # no budget by supplier
    staff = wb[STAFF]
    assert staff[f"C{6 + budget}"].value is None                     # nothing budgeted in this category
    assert ("budgets/b-1", {"DateFrom": "2026-04-01", "DateTo": "2027-03-31"}) in api.reads


def test_a_budget_missing_a_reported_month_has_no_ytd_comparison(tmp_path, profile):
    budgets = [{"AccountCode": "469", "BudgetBalances": balances(("2026-05", 120))}]
    _, wb = build(tmp_path, Books(budgets=budgets))
    ws = wb[RENT]
    acc = row_of(ws, "469 - Rent")
    assert ws[f"O{acc + sup.ROW['budget']}"].value is None and ws[f"O{acc + sup.ROW['var_bud']}"].value is None
    assert ws[f"D{acc + sup.ROW['var_bud']}"].value is not None


def test_an_unreadable_budget_leaves_blank_rows_and_says_so(tmp_path, profile):
    res, wb = build(tmp_path, Books(budget_error="GET budgets failed 502"))
    assert res.failed == []
    warning = next(c for c in res.controls if c.key == "suppliers.budget")
    assert warning.status == "warn" and "left blank" in warning.detail
    assert wb[RENT][f"C{6 + sup.ROW['budget']}"].value is None


# --- controls ---------------------------------------------------------------------------------

def test_suppliers_short_of_an_account_fail_and_the_pack_shows_it(tmp_path, profile):
    docs = clean_books()
    del docs["Invoices"][1]                                 # May's rent bill is missing
    res, wb = build(tmp_path, Books(docs))
    assert list(fails(res)) == [f"suppliers.account.{MAY}"]
    failure = fails(res)[f"suppliers.account.{MAY}"]
    assert failure.status == "fail" and "469 - Rent differs by -100.00" in failure.detail
    assert "FAILED CONTROLS" in res.path.name
    contents = [wb["Contents"].cell(r, 1).value for r in range(1, 12)]
    assert any("FAILED" in str(v) for v in contents)
    controls = wb["Controls"]
    row = next(r for r in range(5, controls.max_row + 1) if controls.cell(r, 1).value == failure.label)
    assert controls.cell(row, 2).value == "FAIL"
    assert wb[RENT]["A3"].value.startswith("FAILED CONTROL: Suppliers sum to each account for May 2026")
    assert wb[STAFF]["A3"].value is None
    rec, book = wb[SOURCE_RECON], Sheetbook(wb)
    assert rec["A3"].value.startswith("FAILED")
    line = row_of(rec, "469 - Rent")
    assert book.value(SOURCE_RECON, f"C{line}") == 0 and book.value(SOURCE_RECON, f"D{line}") == -100


def test_a_failure_is_never_a_warning_and_differences_cannot_offset(tmp_path, profile):
    docs = clean_books()
    docs["Invoices"][1] = bill(150, "469", "2026-05-01", "Landlord Co")     # 50 over on rent
    docs["Invoices"][3] = bill(30 - 50, "481", "2026-05-31", "Pension Co")  # 50 under on salaries...
    res, _ = build(tmp_path, Books(docs))
    failure = fails(res)[f"suppliers.account.{MAY}"]
    assert failure.status == "fail"
    assert failure.difference == 0.0                                        # totals agree; the accounts do not
    assert "469 - Rent" in failure.detail and "481 - Pension" in failure.detail


def test_prior_year_months_are_checked_by_month(tmp_path, profile):
    docs = clean_books()
    docs["ManualJournals"][2]["Date"] = "2026-02-28"          # right year, wrong month
    res, _ = build(tmp_path, Books(docs))
    assert set(fails(res)) == {"suppliers.account.2026-02-28", "suppliers.account.2026-03-31"}


def test_a_bill_awaiting_approval_does_not_fail_the_tie(tmp_path, profile):
    docs = clean_books()
    docs["Invoices"].append(bill(5000, "469", "2026-05-20", "Landlord Co", status="SUBMITTED"))
    res, _ = build(tmp_path, Books(docs))
    assert res.failed == []


def test_rounding_inside_the_tolerance_passes_and_above_it_fails(tmp_path, profile):
    docs = clean_books()
    docs["Invoices"][1] = bill(100.60, "469", "2026-05-01", "Landlord Co")
    res, _ = build(tmp_path, Books(docs))
    assert fails(res) == {}
    docs["Invoices"][1] = bill(101.60, "469", "2026-05-01", "Landlord Co")
    res, _ = build(tmp_path / "b", Books(docs))
    assert list(fails(res)) == [f"suppliers.account.{MAY}"]


def test_accounts_short_of_the_pnl_fail(tmp_path, profile):
    """Drive the control directly: an account dropped from a tab."""
    from pack_engine.ledger import fetch_ledger
    from pack_engine.fiscal import FiscalCalendar
    from pack_engine.mapping import resolve_mapping
    from pack_engine.model import build_model
    api, cal = Books(), FiscalCalendar(3)
    ledger = fetch_ledger(api, "demo", "demo", cal, "2026-05", first_year_end=date(2026, 3, 31))
    model = build_model(ledger, resolve_mapping(ledger.active_accounts()))
    analysis = sup.analyse(api, "demo", profile, ledger, model)
    assert all(c.status == "pass" for c in sup.reconcile(analysis, model))
    staff = next(t for t in analysis.tabs if t.key == "staff_costs")
    staff.accounts = [a for a in staff.accounts if a.account.code != "481"]
    bad = {c.key: c for c in sup.reconcile(analysis, model) if c.status == "fail"}
    assert set(bad) == {f"suppliers.pnl.{APR}", f"suppliers.pnl.{MAY}"}
    assert "Staff costs differs by -30.00" in bad[f"suppliers.pnl.{MAY}"].detail


def test_the_reconciliation_tab_recalculates_to_nil_and_ties_to_the_pnl(tmp_path, profile):
    res, wb = build(tmp_path, Books())
    rec, book = wb[SOURCE_RECON], Sheetbook(wb)
    assert rec["A3"].value == "All checks pass."
    formulas = [c for r in rec.iter_rows(min_row=5) for c in r if isinstance(c.value, str) and c.value.startswith("=")]
    assert len(formulas) > 20
    assert all(abs(book.value(SOURCE_RECON, c.coordinate)) < 0.005 for c in formulas)
    line = row_of(rec, STAFF, start=row_of(rec, "Accounts less profit and loss"))
    assert "'Profit and loss'!" in rec[f"C{line}"].value and "'Profit and loss'!" in rec[f"P{line}"].value
    cf = list(rec.conditional_formatting)
    assert len(cf) == 1 and cf[0].rules[0].operator == "notBetween"
    assert cf[0].rules[0].formula == ["-1.0", "1.0"] and cf[0].rules[0].dxf.fill.bgColor.rgb.endswith("F8D7DA")


def test_the_engine_and_the_workbook_agree_with_the_pnl_sign(tmp_path, profile):
    _, wb = build(tmp_path, Books())
    book = Sheetbook(wb)
    pnl = wb["Profit and loss"]
    row = row_of(pnl, RENT)
    assert book.value("Profit and loss", f"F{row}") == -100 and book.value(RENT, "C6") == 100


def test_a_failed_document_read_fails_a_control_and_keeps_the_pack(tmp_path, profile):
    res, wb = build(tmp_path, Books(read_error="GET invoices failed 502"))
    assert [c.key for c in res.failed] == ["suppliers.read"]
    assert RENT not in wb.sheetnames and "FAILED CONTROLS" in res.path.name


def test_a_chosen_category_list_limits_the_tabs(tmp_path, profile):
    profile["supplier_tabs"] = {"categories": ["establishment"]}
    res, wb = build(tmp_path, Books())
    assert RENT in wb.sheetnames and STAFF not in wb.sheetnames and res.failed == []


@pytest.mark.parametrize("label,taken,expected", [
    ("Legal: and / professional [fees]", [], "Legal  and   professional  fees"),
    ("A" * 40, [], "A" * 31),
    ("Cash flow", ["Cash flow"], "Cash flow 2"),
    ("B" * 31, ["B" * 31], "B" * 29 + " 2"),
])
def test_tab_names_are_legal_and_unique(label, taken, expected):
    assert sup.tab_name(label, taken) == expected


# --- reads and rate limits --------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self.body, self.text = status, body, str(body)

    def json(self):
        return self.body


class FakeSession:
    def __init__(self, pages):
        self.pages, self.urls = pages, []

    def get(self, url, params=None, timeout=None, headers=None):
        self.urls.append((url, params))
        batch = self.pages[(params or {}).get("page", 1) - 1]
        return FakeResponse(200, {"entity": "x", "data": {"Invoices": batch}})


def client_with(pages):
    slept = []
    fin = FinanceApi("http://api", "k", session=FakeSession(pages), sleep=slept.append)
    t = [0.0]
    fin.clock = lambda: t[0]
    return fin, slept


def test_paged_reads_go_through_the_read_only_passthrough_until_a_short_page():
    fin, slept = client_with([[{"n": i} for i in range(100)], [{"n": 100}]])
    rows = fin.paged("c", "e", "invoices", "Invoices", where="x")
    assert len(rows) == 101
    assert fin.session.urls == [("http://api/api/finance/clients/c/xero/e/read/invoices", {"page": 1, "where": "x"}),
                                ("http://api/api/finance/clients/c/xero/e/read/invoices", {"page": 2, "where": "x"})]


def test_reads_stay_under_xeros_sixty_a_minute():
    fin, slept = client_with([[{"n": i} for i in range(100)]] * 4 + [[]])
    fin.paged("c", "e", "invoices", "Invoices")
    assert slept == [pytest.approx(api_mod.READ_INTERVAL)] * 4       # no time passes in the fake clock
    assert 60 / api_mod.READ_INTERVAL < 60


def test_a_runaway_list_stops_rather_than_truncates(monkeypatch):
    monkeypatch.setattr(api_mod, "MAX_PAGES", 2)
    fin, _ = client_with([[{"n": i} for i in range(100)]] * 2)
    with pytest.raises(FinanceApiError, match="more than 2 pages"):
        fin.paged("c", "e", "invoices", "Invoices")


def test_the_build_reads_only_what_it_needs(tmp_path, profile):
    api = Books()
    build(tmp_path, api)
    resources = [r[0] for r in api.reads if r != "pace"]
    assert resources == ["invoices", "credit-notes", "bank-transactions", "manual-journals", "budgets"]
    where = api.reads[0][1]["where"]
    assert where == "Date>=DateTime(2025,04,01) AND Date<=DateTime(2026,05,31)"
    # Twelve prior-year months, one already fetched for the P&L: each new trial balance is paced.
    assert api.reads.count("pace") == 11


def test_no_write_verbs_in_the_new_reads():
    src = open(sup.__file__, encoding="utf-8").read() + open(api_mod.__file__, encoding="utf-8").read()
    assert ".post(" not in src and ".put(" not in src and ".patch(" not in src and ".delete(" not in src


def test_a_supplier_name_is_never_a_formula(tmp_path, profile):
    docs = clean_books()
    docs["Invoices"][0] = bill(100, "469", "2026-04-01", "=1+1 Trading")
    docs["Invoices"][1] = bill(100, "469", "2026-05-01", "=1+1 Trading")
    res, wb = build(tmp_path, Books(docs))
    assert res.failed == []
    ws = wb[sup.SOURCE]
    cell = next(c for row in ws.iter_rows(min_col=4, max_col=4, min_row=5) for c in row if c.value == "=1+1 Trading")
    assert cell.data_type == "s"

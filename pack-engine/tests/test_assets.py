"""The asset register workbook: formulas compute the register, controls hold."""

from openpyxl import load_workbook

from pack_engine import assets
from tests.recalc import Sheetbook


def export(**over):
    e = {
        "client": "Sample Group", "grouping": "dev_project", "grouping_name": "Development projects",
        "period": "2026-10", "months": ["2026-08", "2026-09", "2026-10"], "status": "prepared",
        "assets": [
            {"asset_no": "IA-001", "name": "Track one", "company": "Alpha Ltd", "status": "wip", "cost_account": "780"},
            {"asset_no": "IA-002", "name": "Track two", "company": "Alpha Ltd", "status": "wip", "cost_account": "783", "accum_account": "782"},
        ],
        "lines": [
            # Before the opening: counted in the first month.
            {"id": 1, "date": "2025-03-01", "period": "2025-03", "company": "Alpha Ltd", "asset_no": "IA-001", "account": "780",
             "amount": 1000, "treatment": "capitalise", "source_key": "inv-1", "source_net": 1500},
            {"id": 2, "date": "2025-03-01", "period": "2025-03", "company": "Alpha Ltd", "asset_no": "IA-002", "account": "783",
             "amount": 500, "treatment": "capitalise", "source_key": "inv-1", "source_net": 1500},
            {"id": 3, "date": "2026-09-12", "period": "2026-09", "company": "Alpha Ltd", "asset_no": "IA-002", "account": "783",
             "amount": 216.67, "treatment": "capitalise"},
            {"id": 4, "date": "2026-10-22", "period": "2026-10", "company": "Alpha Ltd", "asset_no": None, "account": "780",
             "amount": 80, "treatment": "expense_research"},
        ],
        "events": [
            {"date": "2026-10-31", "period": "2026-10", "company": "Alpha Ltd", "asset_no": "IA-002", "kind": "amortisation",
             "account": "782", "side": "accumulated", "amount": -20},
        ],
        "ledger": [
            {"company": "Alpha Ltd", "account": "780", "account_name": "Track one (WIP) (780)", "ledger": 1001.02, "named": 1.02,
             "named_labels": ["Residual carried"], "register": 1000},
            {"company": "Alpha Ltd", "account": "783", "account_name": "Track two (WIP) (783)", "ledger": 716.67, "named": 0, "register": 716.67},
            {"company": "Alpha Ltd", "account": "782", "account_name": "Track two acc (782)", "ledger": -27.67, "named": 0, "by_xero": -7.67, "register": -27.67},
        ],
    }
    e.update(over)
    return e


def test_the_cover_computes_the_register_with_formulas_and_ties(tmp_path):
    path = assets.write(export(), tmp_path)
    assert "FAILED" not in path.name
    wb = load_workbook(path)
    assert wb.calculation.fullCalcOnLoad
    book = Sheetbook(wb)
    cover = wb["Cover Sheet"]
    rows = {book.value("Cover Sheet", f"B{r}"): r for r in range(6, 9)}
    assert book.number("Cover Sheet", f"D{rows['780']}") == 1000
    assert round(book.number("Cover Sheet", f"H{rows['780']}"), 2) == 0  # 1.02 difference carried as a named item
    assert round(book.number("Cover Sheet", f"D{rows['783']}"), 2) == 716.67
    assert round(book.number("Cover Sheet", f"D{rows['782']}"), 2) == -27.67  # event plus Xero's own movement
    for r in range(6, 9):
        assert str(cover[f"D{r}"].value).startswith("=")
        assert book.value("Cover Sheet", f"I{r}") == "Yes"


def test_schedules_are_cumulative_by_month_with_the_opening_in_the_first(tmp_path):
    wb = load_workbook(assets.write(export(), tmp_path))
    book = Sheetbook(wb)
    # IA-002 is row 4: 500 at the opening, +216.67 in September.
    assert book.number("Cost", "C4") == 500
    assert round(book.number("Cost", "D4"), 2) == 716.67
    assert round(book.number("Cost", "E4"), 2) == 716.67
    assert book.number("Accumulated", "E4") == -20
    assert round(book.number("NBV", "E4"), 2) == 696.67
    assert str(wb["Cost"]["E4"].value).startswith("=")


def test_a_register_that_does_not_tie_still_writes_the_file_marked_failed(tmp_path):
    e = export()
    e["ledger"][1]["ledger"] = 800
    path = assets.write(e, tmp_path)
    assert path.name.endswith("FAILED CONTROLS.xlsx")
    wb = load_workbook(path)
    assert "unexplained" in " ".join(str(c.value) for row in wb["Controls"].iter_rows() for c in row if c.value)


def test_slices_that_do_not_make_their_invoice_fail_a_control(tmp_path):
    e = export()
    e["lines"][1]["amount"] = 400
    e["ledger"][1]["ledger"] = 616.67
    e["ledger"][1]["register"] = 616.67
    built = assets.build(e)
    assert any(f.startswith("source inv-1") for f in built.failures)


def test_refuses_an_export_without_its_months():
    import pytest
    with pytest.raises(assets.ExportError):
        assets.build(export(months=["2026-08"]))


def test_the_cover_reconciles_the_schedules_and_xeros_own_charge(tmp_path):
    # Written into a folder that does not exist yet.
    path = assets.write(export(), tmp_path / "new" / "folder")
    assert path.exists() and "FAILED" not in path.name
    wb = load_workbook(path)
    book = Sheetbook(wb)
    # Ledger rows 6-8, total row 9, the reconciliation from row 11.
    assert round(book.number("Cover Sheet", "D12"), 2) == 1696.67  # NBV of the assets
    assert round(book.number("Cover Sheet", "D13"), 2) == -7.67  # Xero's own charge, against no asset
    assert round(book.number("Cover Sheet", "D14"), 2) == round(book.number("Cover Sheet", "D9"), 2) == 1689.00
    assert book.value("Cover Sheet", "D15") == "Yes"
    controls = {wb["Controls"][f"A{r}"].value: wb["Controls"][f"B{r}"].value for r in range(3, 9)}
    assert controls["The assets' schedules and Xero's own charge make the register"] == "Pass"


def test_schedules_that_do_not_make_the_register_fail_a_control(tmp_path):
    e = export()
    e["events"][0]["asset_no"] = None  # a charge on an account but against no asset, and not Xero's
    built = assets.build(e)
    assert any(f.startswith("schedules:") for f in built.failures)

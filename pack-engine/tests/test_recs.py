"""Balance sheet recs workbook. Every workbook is read back from disk."""

import json
import shutil
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl
import pytest
from PIL import Image

from pack_engine import build as build_mod, recs, style
from recs_fixture import complete_group, group

NOW = datetime(2026, 7, 7, 8, 30)
STZA = {"label": "Placeholder", "branding": {}}


def write(tmp_path, raw=None, profile=None):
    path, rendered = recs.write(recs.parse(raw or group()), profile or STZA, tmp_path, NOW)
    return path, rendered, openpyxl.load_workbook(path)


def find(ws, text, column=None):
    for row in ws.iter_rows():
        for c in row:
            if c.value == text and (column is None or c.column_letter == column):
                return c
    raise AssertionError(f"{text!r} not on {ws.title}")


def index_rows(ws):
    head = find(ws, "Entity").row
    r, rows = head + 1, []
    while ws[f"A{r}"].value:
        rows.append(r)
        r += 1
    return rows


# --- tabs and links ----------------------------------------------------------------------

def test_tabs_one_tb_per_company_one_schedule_per_entity(tmp_path):
    _, _, wb = write(tmp_path)
    assert wb.sheetnames[:5] == ["Recs index", "How to read", "TB Alpha Trading Ltd", "TB Beta Services Ltd", "Attachments"]
    assert "Cover R01 Prepayments" in wb.sheetnames
    assert "R01 Alpha Trading Ltd 0620" in wb.sheetnames and "R01 Beta Services Ltd 620" in wb.sheetnames
    assert all(len(n) <= 31 for n in wb.sheetnames)


def test_trial_balance_is_whole_with_run_time_and_balance_check(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["TB Alpha Trading Ltd"]
    assert [c.value for c in ws[5]] == ["Date", "Entity", "Code", "Account Name", "Class", "Debit", "Credit", "Net (Dr-Cr)"]
    assert ws["B4"].value == datetime(2026, 7, 3, 9, 15)
    assert ws["B4"].number_format == style.DATE_TIME
    assert sum(1 for r in range(6, 20) if ws[f"D{r}"].value and ws[f"C{r}"].value) == 8   # P&L and nil rows too
    total = find(ws, "Total").row
    assert ws[f"F{total}"].value == f"=SUM(F6:F{total - 1})"
    assert ws[f"H{total + 1}"].value == f"=ROUND(F{total}-G{total},2)"
    assert "Debits equal credits" in ws[f"D{total + 2}"].value
    assert ws["F6"].font.color.rgb.endswith(style.INPUT_BLUE) and ws["F6"].number_format == style.NUM_2DP


def test_every_cover_ledger_figure_links_to_the_right_tb_row(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["Cover R01 Prepayments"]
    assert [ws[f"{c}11"].value for c in "ABCEGIK"] == ["Entity", "GL acc", "GL Name", "GL (per TB)", "Schedule",
                                                       "Variance", "Comment"]
    for r, sheet in ((12, "TB Alpha Trading Ltd"), (13, "TB Beta Services Ltd")):
        target = ws[f"E{r}"].value
        assert target.startswith(f"='{sheet}'!$H$")
        row = int(target.rsplit("$", 1)[1])
        assert wb[sheet][f"C{row}"].value == ws[f"B{r}"].value
        assert ws[f"G{r}"].value.startswith("='R01 ")
        assert ws[f"I{r}"].value == f"=E{r}-G{r}"
    assert ws["A14"].value == "GROUP TOTAL"
    assert [ws[f"{c}14"].value for c in "EGI"] == ["=SUM(E12:E13)", "=SUM(G12:G13)", "=SUM(I12:I13)"]


def test_leading_zero_codes_do_not_collide(tmp_path):
    raw = group()
    raw["entities"][0]["trial_balance"]["rows"].append(
        {"code": "620", "name": "Other", "statement": "bs", "debit": 1, "credit": 1})
    _, _, wb = write(tmp_path, raw)
    ws = wb["Cover R01 Prepayments"]
    row = int(ws["E12"].value.rsplit("$", 1)[1])
    assert wb["TB Alpha Trading Ltd"][f"C{row}"].value == "0620"     # a direct link, not a SUMIFS on the code


# --- index -------------------------------------------------------------------------------

def test_index_lists_every_balance_with_status_and_live_checks(tmp_path):
    _, rendered, wb = write(tmp_path)
    ws = wb["Recs index"]
    rows = index_rows(ws)
    listed = {(ws[f"A{r}"].value, ws[f"B{r}"].value): ws[f"G{r}"].value for r in rows}
    assert len(listed) == 9
    assert listed[("Alpha Trading Ltd", "800")] == "No rec"
    assert listed[("Beta Services Ltd", "820")] == "Unsigned - awaiting review"
    assert ("Alpha Trading Ltd", "200") not in listed
    assert listed[("Alpha Trading Ltd", "090")].startswith("=IF(ROUND(F")
    assert "SUMPRODUCT" in ws["G9"].value and "COUNTIFS" in ws["H9"].value and '"MISSING"' in ws["I9"].value
    assert ws["A5"].value.startswith("=IF(") and "INCOMPLETE" in ws["A5"].value
    assert not rendered.complete


def test_status_cannot_be_overclaimed(tmp_path):
    raw = group()
    raw["recs"][2]["status"] = "approved"       # the record says approved; only one person signed
    _, rendered, wb = write(tmp_path, raw)
    assert wb["Cover R03 Accruals"]["A8"].value == "UNSIGNED - awaiting review - not complete"
    bad = next(c for c in rendered.controls if c.key == "recs.status")
    assert bad.status == "fail" and "Accruals" in bad.detail


@pytest.mark.parametrize("change,expected", [
    (lambda r: r["sign_offs"]["approved"].update(date=None), "awaiting CFO approval"),   # a name without a date
    (lambda r: r["sign_offs"].pop("prepared"), "not yet prepared"),                      # a gap stops the count
    (lambda r: r.update(status="draft"), "not yet prepared"),                            # reopened
])
def test_unsigned_is_never_complete(tmp_path, change, expected):
    raw = complete_group()
    change(raw["recs"][0])
    path, rendered, wb = write(tmp_path, raw)
    ws = wb["Cover R01 Prepayments"]
    assert ws["A8"].value == f"UNSIGNED - {expected} - not complete"
    assert ws["A8"].fill.fgColor.rgb.endswith(style.ALERT_RED)
    assert not rendered.complete and "INCOMPLETE" in path.name


def test_missing_sign_off_shows_not_signed_in_red(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["Cover R03 Accruals"]
    label = find(ws, "CFO Approved")
    cell = ws[f"C{label.row}"]
    assert cell.value == "NOT SIGNED" and cell.font.color.rgb.endswith(style.ALERT_RED)
    assert ws[f"G{label.row}"].value is None


def test_signed_rec_on_a_moved_ledger_is_not_complete(tmp_path):
    raw = complete_group()
    raw["recs"][1]["entities"][0]["ledger"] = 4999.00
    _, rendered, wb = write(tmp_path, raw)
    assert wb["Cover R02 Bank"]["A8"].value.startswith("SIGNED BUT THE LEDGER HAS MOVED")
    assert not rendered.complete


def test_complete_group_is_complete(tmp_path):
    path, rendered, wb = write(tmp_path, complete_group())
    assert rendered.complete and "INCOMPLETE" not in path.name
    assert not [c for c in rendered.controls if c.status == "fail"]


def test_sign_off_name_is_canonical(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["Cover R01 Prepayments"]
    assert ws[f"C{find(ws, 'CFO Approved').row}"].value == "Nik M CA(SA)"
    assert recs.person("NIK SURNAME") == recs.person("nik m") == "Nik M CA(SA)"
    assert recs.person("Nikita Example") == "Nikita Example"


# --- schedules ---------------------------------------------------------------------------

def test_amortised_schedule_matches_the_template_grid(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["R01 Alpha Trading Ltd 0620"]
    assert [ws[f"{c}5"].value for c in "BDFJK"] == ["Supplier", "Release to (P&L a/c)", "Total cost (net)", "Months", "Monthly"]
    assert ws["L5"].value.date() == date(2026, 4, 1) and ws["L5"].number_format == "mmm-yy"
    assert ws["I6"].value.date() == date(2026, 4, 1)       # commenced mid-month: the 1st of that month
    assert "EDATE" in ws["L6"].value and ws["J6"].value.startswith("=IF(")
    assert ws.freeze_panes == "L6"
    balance = find(ws, "Balance c/f")
    assert ws[f"{balance.column_letter}6"].value.startswith("=F6-")
    assert find(ws, "TOTAL").row == 7
    assert ws[f"{balance.column_letter}7"].value.startswith("=SUM(")


def test_attachment_reference_links_to_the_document(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["R02 Alpha Trading Ltd 090"]
    assert ws["F6"].value == "Att-02"
    assert ws["F6"].hyperlink is not None
    att = wb["Attachments"]
    assert att["A6"].value == "Att-02" and att["C6"].hyperlink.target.startswith("https://")


def test_line_without_a_document_is_flagged(tmp_path):
    _, rendered, wb = write(tmp_path)
    ws = wb["R03 Beta Services Ltd 820"]
    assert ws["F7"].value == "NONE" and ws["F7"].font.color.rgb.endswith(style.ALERT_RED)
    assert next(c for c in rendered.controls if c.key == "recs.attachments").status == "warn"


def test_unknown_attachment_fails_and_support_with_no_lines_becomes_a_line(tmp_path):
    raw = group()
    raw["recs"][0]["entities"][1]["lines"][0]["attachment"] = "Att-99"
    _, rendered, wb = write(tmp_path, raw)
    assert next(c for c in rendered.controls if c.key == "recs.attachment_refs").status == "fail"
    assert wb["R02 Beta Services Ltd 090"]["G6"].value == 800.00


# --- safety ------------------------------------------------------------------------------

def test_text_from_a_record_cannot_become_a_formula(tmp_path):
    raw = group()
    raw["recs"][0]["entities"][0]["lines"][0]["item"] = '=HYPERLINK("http://example.invalid","x")'
    raw["recs"][0]["entities"][0]["comment"] = "=1+1"
    _, _, wb = write(tmp_path, raw)
    assert wb["R01 Alpha Trading Ltd 0620"]["B6"].data_type == "s"
    assert wb["Cover R01 Prepayments"]["K12"].data_type == "s"


def test_no_em_dashes_anywhere(tmp_path):
    raw = group()
    raw["recs"][0]["description"] = "Costs \u2014 prepaid \u2013 in advance"
    _, _, wb = write(tmp_path, raw)
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                assert "\u2014" not in str(c.value or "") and "\u2013" not in str(c.value or ""), c.coordinate


def test_awkward_entity_names_make_legal_unique_tabs(tmp_path):
    raw = group()
    raw["entities"][0]["name"] = "Alpha's [Trading]: Holdings/Services International Limited"
    raw["entities"][1]["name"] = "Alpha's [Trading]: Holdings/Services International Limited Two"
    _, _, wb = write(tmp_path, raw)
    assert all(len(n) <= 31 and not set(n) & set("[]:*?/\\'") for n in wb.sheetnames)
    assert len({n.lower() for n in wb.sheetnames}) == len(wb.sheetnames)


@pytest.mark.parametrize("change,message", [
    (lambda g: g["entities"][0]["trial_balance"]["rows"][0].update(statement="bad"), "statement"),
    (lambda g: g["entities"][0]["trial_balance"]["rows"].append(dict(g["entities"][0]["trial_balance"]["rows"][0])), "twice"),
    (lambda g: g["recs"][0].update(status="done"), "status"),
    (lambda g: g["recs"][0]["entities"][0].update(entity="nobody"), "unknown entity"),
    (lambda g: g["recs"][0]["entities"][0]["lines"][0].update(amount=float("nan")), "not a number"),
    (lambda g: g["recs"][0]["entities"][0]["lines"][0].update(attachment="doc1"), "not like Att-01"),
    (lambda g: g["recs"][1]["entities"][0].update(gl_code="0620"), "two reconciliations"),
    (lambda g: g["recs"][1]["entities"][0].update(gl_code="200"), "profit and loss"),
    (lambda g: g.update(period_end="June"), "not a date"),
])
def test_bad_input_is_refused(change, message):
    raw = group()
    change(raw)
    with pytest.raises(recs.RecInputError, match=message):
        recs.parse(raw)


# --- branding ----------------------------------------------------------------------------

def logo(folder, name="client.png", size=(300, 100)):
    Image.new("RGB", size, (10, 20, 30)).save(folder / name)
    return name


def test_stza_is_the_default_brand(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["Cover R01 Prepayments"]
    assert ws["B11"].fill.fgColor.rgb.endswith(style.STZA_REC_COLOURS["primary"])
    assert ws["A11"].fill.fgColor.rgb.endswith(style.STZA_REC_COLOURS["accent"])
    assert ws["B11"].font.color.rgb.endswith(style.WHITE)
    assert len(ws._images) == 1 and len(wb["Recs index"]._images) == 1


def test_logo_sits_where_the_template_has_it_and_widths_match(tmp_path):
    _, _, wb = write(tmp_path)
    ws = wb["Cover R01 Prepayments"]
    frm = ws._images[0].anchor._from
    assert (frm.col, frm.row, frm.colOff) == (10, 0, 2047875)
    expected = dict(A=30.4, B=12.3, C=40.1, D=0.9, E=14, F=0.9, G=14, H=0.9, I=12, J=0.9, K=82.1)
    assert {k: round(ws.column_dimensions[k].width, 1) for k in expected} == expected


def test_client_branding_and_dark_text_on_a_light_header(tmp_path):
    name = logo(tmp_path)
    profile = {"label": "P", "branding": {"mode": "client", "logo_file": name,
                                          "colours": {"primary": "#FFEE00", "accent": "ABCDEF", "band": "#EEEEEE"}}}
    brand = recs.resolve_brand(profile, tmp_path)
    assert (brand.primary, brand.accent, brand.band, brand.warnings) == ("FFEE00", "ABCDEF", "EEEEEE", [])
    assert brand.logo_size == (300, 100)
    assert recs._on(brand.primary) == style.BLACK


@pytest.mark.parametrize("colour", ["red", "#12345", "12345G", "url(x)", None, 123])
def test_bad_colour_falls_back_to_stza_with_a_warning(tmp_path, colour):
    profile = {"branding": {"mode": "client", "logo_file": logo(tmp_path),
                            "colours": {"primary": colour, "accent": "#111111", "band": "#EEEEEE"}}}
    brand = recs.resolve_brand(profile, tmp_path)
    assert brand.primary == style.STZA_REC_COLOURS["primary"] and brand.accent == "111111"
    assert any("primary" in w for w in brand.warnings)


@pytest.mark.parametrize("name", ["../stza.png", "..\\stza.png", "/etc/passwd.png", "C:\\x.png", "a/b.png", "x.svg",
                                  "x.gif", "missing.png", None, 5])
def test_unsafe_logo_names_fall_back(tmp_path, name):
    brand = recs.resolve_brand({"branding": {"mode": "client", "logo_file": name}}, tmp_path)
    assert brand.logo == recs.load_logo(recs.STZA_LOGO)[0] and brand.warnings


def test_fake_gif_and_oversized_logos_fall_back(tmp_path):
    (tmp_path / "fake.png").write_bytes(b"<svg onload=alert(1)>")
    Image.new("RGB", (5, 5)).save(tmp_path / "gif.png", format="GIF")
    logo(tmp_path, "huge.png", (recs.LOGO_MAX_SIDE + 1, 10))
    (tmp_path / "heavy.png").write_bytes(b"0" * (recs.LOGO_MAX_BYTES + 1))
    for name in ("fake.png", "gif.png", "huge.png", "heavy.png"):
        with pytest.raises(ValueError):
            recs.load_logo(name, tmp_path)


def test_unknown_mode_is_stza_and_branding_warning_reaches_the_controls(tmp_path):
    _, rendered, _ = write(tmp_path, profile={"label": "P", "branding": {"mode": "neon"}})
    assert next(c for c in rendered.controls if c.key == "recs.branding").status == "warn"


def test_stza_profile_resolves():
    brand = recs.resolve_brand(build_mod.load_profile("stza"))
    assert brand.mode == "stza" and not brand.warnings


# --- hook --------------------------------------------------------------------------------

def test_hook_is_off_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv(recs.ENV_INPUT, raising=False)
    assert recs.rec_files(STZA, "2026-06", tmp_path, NOW) == []
    assert list(tmp_path.iterdir()) == []


def test_hook_writes_the_companion_when_given_an_input(tmp_path, monkeypatch):
    src = tmp_path / "input.json"
    src.write_text(json.dumps(group()), encoding="utf-8")
    monkeypatch.setenv(recs.ENV_INPUT, str(src))
    made = recs.rec_files(STZA, "2026-06", tmp_path / "out", NOW)
    assert len(made) == 1 and made[0].name.endswith("INCOMPLETE.xlsx")
    with pytest.raises(recs.RecInputError, match="not 2026-07"):
        recs.rec_files(STZA, "2026-07", tmp_path / "out", NOW)


# --- recalculation -----------------------------------------------------------------------

def _recalc(src: Path, dst_dir: Path) -> Path | None:
    """Recalculate in LibreOffice if present, else Excel on Windows. None if neither."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        subprocess.run([soffice, "--headless", "--convert-to", "xlsx", "--outdir", str(dst_dir), str(src)],
                       check=True, timeout=180, capture_output=True)
        return dst_dir / src.name
    excel = Path(r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE")
    if sys.platform == "win32" and excel.exists():
        dst = dst_dir / src.name
        script = ("$x=New-Object -ComObject Excel.Application;$x.Visible=$false;$x.DisplayAlerts=$false;"
                  f"$w=$x.Workbooks.Open('{src}');$x.CalculateFull();$w.SaveAs('{dst}',51);$w.Close($false);$x.Quit()")
        subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, timeout=180, capture_output=True)
        return dst
    return None


@pytest.fixture(params=["mixed", "complete"])
def recalculated(request, tmp_path):
    raw = group() if request.param == "mixed" else complete_group()
    path, rendered, _ = write(tmp_path, raw)
    out = tmp_path / "recalc"
    out.mkdir()
    done = _recalc(path, out)
    if done is None:
        pytest.skip("no LibreOffice or Excel here")
    return request.param, rendered, openpyxl.load_workbook(done, data_only=True), recs.parse(raw)


def test_recalculated_workbook_has_no_errors_and_ties_to_python(recalculated):
    kind, rendered, wb, grp = recalculated
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                assert not (isinstance(c.value, str) and c.value.startswith("#")), f"{ws.title}!{c.coordinate} {c.value}"
    for ws in wb.worksheets:
        if ws.title.startswith("TB "):
            assert ws["D3"].value == "Debits equal credits"
    idx = wb["Recs index"]
    for r in range(9, 9 + len(grp.entities)):
        assert idx[f"I{r}"].value == "OK" and idx[f"G{r}"].value == idx[f"H{r}"].value
    net = {(e.name, t.code): t.net for e in grp.entities for t in e.rows}
    for r in index_rows(idx):
        assert idx[f"D{r}"].value == pytest.approx(net[(idx[f"A{r}"].value, idx[f"B{r}"].value)])
    # Python's view of each schedule agrees with what the formulas produce.
    entities = {e.key: e.name for e in grp.entities}
    for rec in grp.recs:
        ws = wb[rendered.covers[rec.key]]
        for i, row in enumerate(rec.entities):
            assert ws[f"G{12 + i}"].value == pytest.approx(recs._support(grp, row)), entities[row.entity]
    if kind == "complete":
        assert idx["A5"].value == recs.SIGNED_BANNER
        assert all(idx[f"G{r}"].value == recs.SIGNED for r in index_rows(idx))
        assert wb["R01 Alpha Trading Ltd 0620"]["C4"].value == recs.SIGNED_BANNER
    else:
        assert idx["A5"].value.startswith("INCOMPLETE - ")
        cover = wb["Cover R03 Accruals"]
        assert cover["I12"].value == pytest.approx(-25.00)
        assert cover["A8"].value.startswith("UNSIGNED")
        assert wb["Cover R01 Prepayments"]["E14"].value == pytest.approx(1200.00)

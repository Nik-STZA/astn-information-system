"""Balance sheet reconciliations workbook.

Excel exists for one purpose: the completed month-end pack saved to the client's
own drive. There is no ad hoc download and no portal route. This module writes a
companion workbook next to the management pack; job.py saves it with the rest.
It is off unless PACK_RECS_JSON names an input file (see rec_files).

Tabs: Recs index, How to read, one TB tab per company, Attachments, then for each
reconciliation a cover and one schedule per entity. The only typed numbers are
trial balance debits and credits and schedule inputs (blue). Everything else is
a formula: every cover ledger figure is a direct link to a row on that company's
TB tab, and totals, variances and the completeness checks are live.

A status is never taken on trust. It is worked out from the sign-offs, and the
lower of that and the record's own status wins, so a reconciliation cannot read
as complete unless all three people have signed with a date.


INPUT: one JSON object for a group and month end. Plain data, no client logic.

{
  "group": "Placeholder Group",            // cover "Company"
  "period_end": "2026-06-30",
  "currency": "GBP",                       // one currency for the workbook
  "entities": [
    {
      "key": "alpha",                      // referenced by recs[].entities[].entity
      "name": "Alpha Trading Ltd",
      "trial_balance": {
        "run_at": "2026-07-03T09:15:00+01:00",   // when it was pulled
        "source": "Xero via stza-finance-api",
        "rows": [                          // the FULL trial balance, every account
          {"code": "620", "name": "Prepayments", "statement": "bs",   // bs | pnl
           "debit": 1200.00, "credit": 0}  // closing balance (Xero's YTD columns)
        ]
      }
    }
  ],
  "attachments": [                         // one numbering for the whole workbook
    {"ref": "Att-01", "name": "Invoice 1001.pdf",
     "url": "https://drive.google.com/..."}  // optional; https only
  ],
  "recs": [
    {
      "key": "prepayments",
      "title": "Prepayments",
      "description": "Prepaid supplier costs",
      "status": "reviewed",                // draft | prepared | reviewed | approved
      "sign_offs": {                       // a sign-off counts only with name AND date
        "prepared": {"name": "Jo Bloggs", "position": "Finance manager", "date": "2026-07-04"},
        "reviewed": {"name": "Sam Example", "position": "Financial controller", "date": "2026-07-05"},
        "approved": null
      },
      "entities": [                        // one per entity and GL account
        {
          "entity": "alpha",
          "gl_code": "620",                // must match a TB row for that entity
          "gl_name": "Prepayments",
          "ledger": 1200.00,               // balance the rec was prepared against
          "support": 1200.00,              // optional; must equal the schedule total.
                                           // With no lines it becomes a single line
          "comment": "",
          "lines": [                       // the schedule. Sign as the TB: Dr +, Cr -
            {"item": "Supplier One", "description": "Annual licence",
             "reference": "INV-1001", "date": "2026-01-10",
             "attachment": "Att-01",       // one reference per line
             "amount": 1200.00,            // balance, or total cost when amortised
             "note": "",
             "amortisation": {             // optional; gives the monthly release grid
               "start": "2026-01-01", "end": "2026-12-31",
               "commenced": "2026-01-01",  // treated as the 1st of that month
               "release_to": "Software (460)"}}
          ]
        }
      ]
    }
  ]
}
"""

from __future__ import annotations

import io
import json
import math
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.drawing.image import Image as XlImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font
from openpyxl.utils import get_column_letter as col
from openpyxl.utils.units import pixels_to_EMU
from PIL import Image as PILImage

from . import ENGINE_VERSION, style
from .controls import TOLERANCE, Control, failed, formula_controls
from .fiscal import date_label

ENV_INPUT = "PACK_RECS_JSON"
LOGOS = Path(__file__).resolve().parent.parent / "profiles" / "logos"
STZA_LOGO = "stza.png"
LOGO_MAX_BYTES = 2_000_000
LOGO_MAX_SIDE = 4000
LOCAL_TZ = ZoneInfo("Europe/London")

NIK_SIGN_OFF = "Nik M CA(SA)"
STATUSES = ("draft", "prepared", "reviewed", "approved")
ROLES = (("prepared", "Prepared"), ("reviewed", "Reviewed"), ("approved", "CFO Approved"))
STAGE_TEXT = ("not yet prepared", "awaiting review", "awaiting CFO approval")
BS, PNL = "Balance sheet", "Profit and loss"
STATEMENTS = {"bs": BS, "pnl": PNL}
SIGNED = "Signed"
SIGNED_BANNER = "Signed and complete"
MAX_MONTHS = 120

INDEX, HOW, ATTACH = "Recs index", "How to read", "Attachments"
MAX_TAB = 31


class RecInputError(ValueError):
    """The input does not match the shape documented above."""


# --- text --------------------------------------------------------------------------------

def clean(value) -> str:
    """Text as it may appear in the workbook: no em or en dashes, no characters
    that are illegal in the file format, no surrounding space."""
    text = "" if value is None else str(value)
    return ILLEGAL_CHARACTERS_RE.sub("", text.replace("—", "-").replace("–", "-")).strip()


def person(name) -> str:
    """Nik signs one way only, whatever the record holds."""
    text = clean(name)
    return NIK_SIGN_OFF if re.match(r"nik\b", text, re.I) else text


# --- input -------------------------------------------------------------------------------

@dataclass
class TbRow:
    code: str
    name: str
    statement: str
    debit: float
    credit: float

    @property
    def net(self) -> float:
        return self.debit - self.credit

    @property
    def key(self) -> str:
        return self.code or self.name       # Xero allows an account with no code


@dataclass
class Entity:
    key: str
    name: str
    run_at: datetime
    source: str
    rows: list[TbRow]


@dataclass
class Amortisation:
    start: date
    end: date
    commenced: date
    release_to: str


@dataclass
class Line:
    item: str
    description: str = ""
    reference: str = ""
    when: date | None = None
    attachment: str = ""
    amount: float = 0.0
    note: str = ""
    amortisation: Amortisation | None = None


@dataclass
class RecEntity:
    entity: str
    gl_code: str
    gl_name: str
    ledger: float | None
    support: float | None
    comment: str
    lines: list[Line]

    @property
    def key(self) -> str:
        return self.gl_code or self.gl_name


@dataclass
class SignOff:
    name: str
    position: str
    when: date


@dataclass
class Rec:
    key: str
    title: str
    description: str
    status: str
    sign_offs: dict[str, SignOff]
    entities: list[RecEntity]

    @property
    def signed_stage(self) -> int:
        """How many sign-offs are in place, in order: a gap stops the count."""
        n = 0
        for role, _ in ROLES:
            if role not in self.sign_offs:
                break
            n += 1
        return n

    @property
    def stage(self) -> int:
        return min(STATUSES.index(self.status), self.signed_stage)

    @property
    def signed(self) -> bool:
        return self.stage == len(ROLES)


@dataclass
class Attachment:
    ref: str
    name: str
    url: str


@dataclass
class Group:
    name: str
    period_end: date
    currency: str
    entities: list[Entity]
    attachments: list[Attachment]
    recs: list[Rec]


def _text(obj: dict, name: str, where: str) -> str:
    text = clean(obj.get(name))
    if not text:
        raise RecInputError(f"{where}: {name} is required")
    return text


def _number(value, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise RecInputError(f"{where}: {value!r} is not a number")
    return float(value)


def _optional_number(value, where: str) -> float | None:
    return None if value is None else _number(value, where)


def _date(value, where: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise RecInputError(f"{where}: {value!r} is not a date (YYYY-MM-DD)") from None


def _run_at(value, where: str) -> datetime:
    try:
        when = datetime.fromisoformat(str(value))
    except ValueError:
        raise RecInputError(f"{where}: {value!r} is not a date and time") from None
    # Excel holds no time zone, so show it in UK time like the rest of the pack.
    return when.astimezone(LOCAL_TZ).replace(tzinfo=None) if when.tzinfo else when


def _parse_tb_row(row: dict, where: str) -> TbRow:
    statement = row.get("statement")
    if statement not in STATEMENTS:
        raise RecInputError(f"{where}: statement must be bs or pnl, not {statement!r}")
    return TbRow(clean(row.get("code")), _text(row, "name", where), STATEMENTS[statement],
                 _number(row.get("debit", 0), where), _number(row.get("credit", 0), where))


def _parse_entity(raw: dict) -> Entity:
    key = _text(raw, "key", "entity")
    name = _text(raw, "name", f"entity {key}")
    where = f"entity {key} trial balance"
    tb = raw.get("trial_balance") or {}
    rows = [_parse_tb_row(r, where) for r in tb.get("rows") or []]
    if not rows:
        raise RecInputError(f"{where}: no rows")
    keys = [r.key for r in rows]
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    if dupes:
        raise RecInputError(f"{where}: account appears twice: {', '.join(dupes)}")
    return Entity(key, name, _run_at(tb.get("run_at"), where), clean(tb.get("source")) or "Not stated", rows)


def _parse_line(raw: dict, where: str) -> Line:
    amort = None
    if raw.get("amortisation"):
        a = raw["amortisation"]
        start, end = _date(a.get("start"), where), _date(a.get("end"), where)
        if end < start:
            raise RecInputError(f"{where}: amortisation ends before it starts")
        c = _date(a.get("commenced") or a.get("start"), where)
        amort = Amortisation(start, end, c.replace(day=1), clean(a.get("release_to")))
    ref = clean(raw.get("attachment"))
    if ref and not re.fullmatch(r"Att-\d{2,4}", ref):
        raise RecInputError(f"{where}: attachment reference {ref!r} is not like Att-01")
    return Line(item=_text(raw, "item", where), description=clean(raw.get("description")),
                reference=clean(raw.get("reference")),
                when=_date(raw["date"], where) if raw.get("date") else None,
                attachment=ref, amount=_number(raw.get("amount"), where), note=clean(raw.get("note")),
                amortisation=amort)


def _parse_rec(raw: dict, known_entities: set[str]) -> Rec:
    key = _text(raw, "key", "rec")
    where = f"rec {key}"
    status = raw.get("status")
    if status not in STATUSES:
        raise RecInputError(f"{where}: status must be one of {', '.join(STATUSES)}, not {status!r}")
    sign_offs = {}
    for role, _ in ROLES:
        s = (raw.get("sign_offs") or {}).get(role) or {}
        if clean(s.get("name")) and s.get("date"):
            sign_offs[role] = SignOff(person(s["name"]), clean(s.get("position")), _date(s["date"], where))
    entities = []
    for e in raw.get("entities") or []:
        ekey = _text(e, "entity", where)
        if ekey not in known_entities:
            raise RecInputError(f"{where}: unknown entity {ekey!r}")
        lines = [_parse_line(ln, f"{where} {ekey}") for ln in e.get("lines") or []]
        entities.append(RecEntity(ekey, clean(e.get("gl_code")), clean(e.get("gl_name")),
                                  _optional_number(e.get("ledger"), where),
                                  _optional_number(e.get("support"), where),
                                  clean(e.get("comment")), lines))
    if not entities:
        raise RecInputError(f"{where}: no entities")
    return Rec(key, _text(raw, "title", where), clean(raw.get("description")), status, sign_offs, entities)


def parse(raw: dict) -> Group:
    """The checked input. Raises RecInputError on anything off the documented shape."""
    if not isinstance(raw, dict):
        raise RecInputError("the input must be one JSON object")
    entities = [_parse_entity(e) for e in raw.get("entities") or []]
    if not entities:
        raise RecInputError("no entities")
    keys = [e.key for e in entities]
    if len(set(keys)) != len(keys):
        raise RecInputError("two entities share a key")
    recs = [_parse_rec(r, set(keys)) for r in raw.get("recs") or []]
    seen = set()
    for rec in recs:
        for re_ in rec.entities:
            pair = (re_.entity, re_.key)
            if pair in seen:
                raise RecInputError(f"{re_.entity} {re_.key} is on two reconciliations")
            seen.add(pair)
    for e in entities:
        pnl = {t.key for t in e.rows if t.statement == PNL}
        for rec in recs:
            for re_ in rec.entities:
                if re_.entity == e.key and re_.key in pnl:
                    raise RecInputError(f"{rec.key}: {re_.key} is a profit and loss account")
    attachments, refs = [], set()
    for a in raw.get("attachments") or []:
        ref = _text(a, "ref", "attachment")
        if not re.fullmatch(r"Att-\d{2,4}", ref) or ref in refs:
            raise RecInputError(f"attachment {ref!r} is malformed or repeated")
        refs.add(ref)
        attachments.append(Attachment(ref, clean(a.get("name")), clean(a.get("url"))))
    return Group(_text(raw, "group", "input"), _date(raw.get("period_end"), "input"),
                 _text(raw, "currency", "input"), entities, attachments, recs)


# --- branding ----------------------------------------------------------------------------

@dataclass
class Brand:
    mode: str
    primary: str
    accent: str
    band: str
    tabs: dict
    logo: bytes
    logo_size: tuple[int, int]
    warnings: list[str] = field(default_factory=list)


def _colour(value) -> str | None:
    text = value.strip().lstrip("#") if isinstance(value, str) else ""
    return text.upper() if re.fullmatch(r"[0-9A-Fa-f]{6}", text) else None


def _on(colour: str) -> str:
    """Black or white, whichever reads on this fill."""
    r, g, b = (int(colour[i:i + 2], 16) for i in (0, 2, 4))
    return style.BLACK if 0.299 * r + 0.587 * g + 0.114 * b > 150 else style.WHITE


def load_logo(name, logos_dir: Path = LOGOS) -> tuple[bytes, tuple[int, int]]:
    """A logo by bare file name from profiles/logos, proved to be a real PNG or JPEG
    of sensible size. Raises ValueError saying why not."""
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*\.(png|jpe?g)", name, re.I):
        raise ValueError("logo_file must be a bare .png or .jpg file name")
    path = logos_dir / name
    if not path.is_file():
        raise ValueError(f"no such logo {name}")
    data = path.read_bytes()
    if len(data) > LOGO_MAX_BYTES:
        raise ValueError(f"logo {name} is over {LOGO_MAX_BYTES:,} bytes")
    try:
        with PILImage.open(io.BytesIO(data)) as img:
            fmt, size = img.format, img.size
            img.verify()
    except (OSError, SyntaxError, ValueError, PILImage.DecompressionBombError) as e:
        raise ValueError(f"logo {name} is not a readable image: {e}") from None
    if fmt not in ("PNG", "JPEG"):
        raise ValueError(f"logo {name} is {fmt}, not PNG or JPEG")
    if max(size) > LOGO_MAX_SIDE:
        raise ValueError(f"logo {name} is over {LOGO_MAX_SIDE} pixels")
    return data, size


def resolve_brand(profile: dict, logos_dir: Path = LOGOS) -> Brand:
    """STZA unless the profile says mode client. Each bad or missing client field
    falls back to STZA on its own, with a warning; branding never stops a build."""
    b = profile.get("branding") or {}
    colours, warnings = dict(style.STZA_REC_COLOURS), []
    mode = b.get("mode") or "stza"
    if mode not in ("stza", "client"):
        warnings.append(f"Unknown branding mode {mode!r}: STZA branding used")
        mode = "stza"
    logo_name = STZA_LOGO
    if mode == "client":
        for key in colours:
            value = _colour((b.get("colours") or {}).get(key))
            if value:
                colours[key] = value
            else:
                warnings.append(f"Client colour {key} is missing or not a hex colour: STZA colour used")
        logo_name = b.get("logo_file")
    try:
        logo, size = load_logo(logo_name, logos_dir)
    except ValueError as e:
        warnings.append(f"{e}: STZA logo used")
        logo, size = load_logo(STZA_LOGO)
    tabs = b.get("tab_colours")
    return Brand(mode, colours["primary"], colours["accent"], colours["band"],
                 tabs if isinstance(tabs, dict) else style.STZA_TAB_COLOURS, logo, size, warnings)


def _place_logo(ws, brand: Brand, column: int, col_offset_emu: int = 0, box=(570, 133)):
    """Top of the sheet, scaled down to fit the box, keeping its proportions."""
    w, h = brand.logo_size
    scale = min(1.0, box[0] / w, box[1] / h)
    img = XlImage(io.BytesIO(brand.logo))
    img.width, img.height = round(w * scale), round(h * scale)
    marker = AnchorMarker(col=column, colOff=col_offset_emu, row=0, rowOff=0)
    img.anchor = OneCellAnchor(_from=marker, ext=XDRPositiveSize2D(pixels_to_EMU(img.width), pixels_to_EMU(img.height)))
    ws.add_image(img)


# --- figures in Python, the same way the formulas work them out --------------------------

def _round(value: float, places: int = 0) -> float:
    """ROUND as Excel does it: halves away from zero, not to the nearest even."""
    f = 10 ** places
    return math.copysign(math.floor(abs(value) * f + 0.5 + 1e-9) / f, value)


def _months_of(a: Amortisation) -> int:
    return max(1, int(_round((a.end - a.start).days / 30.4375)))


def _edate(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + months, 12)
    return date(y, m + 1, 1)


def line_balance(line: Line, period_end: date) -> float:
    a = line.amortisation
    if not a:
        return line.amount
    months = _months_of(a)
    released = sum(1 for i in range(months) if _edate(a.commenced, i) <= period_end)
    if released >= months:
        return 0.0
    return line.amount - _round(line.amount / months, 2) * released


# --- workbook helpers --------------------------------------------------------------------

def _f(size=11, bold=False, color=style.BLACK, italic=False):
    return style.font(size, bold=bold, color=color, italic=italic)


def put(ws, ref: str, value, font=None, fmt=None, wrap=False, border=None, fill=None):
    """Write a value. Text from a record is always text, even if it starts with "=":
    only `formula` writes a formula."""
    cell = ws[ref]
    cell.value = value
    if isinstance(value, str):
        cell.data_type = "s"
    cell.font = font or _f()
    if fmt:
        cell.number_format = fmt
    if wrap:
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    if border:
        cell.border = border
    if fill:
        cell.fill = fill
    return cell


BOX = Border(top=style.thin, bottom=style.thin, left=style.thin, right=style.thin)


def _head(ws, row: int, columns: dict[str, str], colour: str, height=None):
    for c, label in columns.items():
        cell = put(ws, f"{c}{row}", label, _f(9, bold=True, color=_on(colour)), border=BOX, fill=style.fill(colour))
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    if height:
        ws.row_dimensions[row].height = height


def _widths(ws, widths: dict[str, float]):
    for c, w in widths.items():
        ws.column_dimensions[c].width = w


def _page(ws, grid=False):
    ws.sheet_view.showGridLines = grid
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def _ok_fill(colour: str):
    f = style.fill(colour)
    f.bgColor = f.fgColor       # a conditional format reads the background colour
    return f


def _status_style(ws, ref: str, good: str = SIGNED, strong=False):
    """Red until proved signed: only the exact good text turns a cell green, so
    anything unexpected reads as not done."""
    first = ref.split(":")[0]
    if strong:
        base_font, base_fill = _f(11, bold=True, color=style.WHITE), style.fill(style.ALERT_RED)
        ok_font, ok_fill = Font(bold=True, color=style.WHITE), _ok_fill(style.SUCCESS_GREEN)
    else:
        base_font, base_fill = _f(10, bold=True, color=style.ALERT_RED), style.fill(style.ALERT_TINT)
        ok_font, ok_fill = Font(bold=True, color=style.SUCCESS_GREEN), _ok_fill(style.SUCCESS_TINT)
    for row in ws[ref] if ":" in ref else ((ws[ref],),):
        for cell in row:
            cell.font, cell.fill = base_font, base_fill
    letter = re.match(r"[A-Z]+", first).group()
    anchor = first.replace(letter, f"${letter}", 1)     # the banner spans columns; its text is in the first
    ws.conditional_formatting.add(ref, FormulaRule(formula=[f'{anchor}="{good}"'], font=ok_font, fill=ok_fill))


def _nonzero_red(ws, ref: str):
    first = ref.split(":")[0]
    ws.conditional_formatting.add(ref, FormulaRule(formula=[f"ROUND({first},2)<>0"],
                                                   font=Font(bold=True, color=style.ALERT_RED)))


def _tab(raw: str, used: set, suffix: str = "") -> str:
    """A legal, unique tab name. Apostrophes go too, so formulas need no escaping."""
    base = re.sub(r"\s+", " ", re.sub(r"[\[\]:*?/\\']", "", raw)).strip()
    n, name = 1, ""
    while True:
        tail = suffix if n == 1 else f"{suffix} {n}"
        name = (base[:MAX_TAB - len(tail)].rstrip() + tail).strip()
        if name.lower() not in used:
            used.add(name.lower())
            return name
        n += 1


def _q(sheet: str) -> str:
    return f"'{sheet}'"


# --- rendering ---------------------------------------------------------------------------

@dataclass
class TbTab:
    sheet: str
    first: int
    last: int
    rows: dict[str, int]
    total: int
    result: str             # cell saying debits equal credits

    def net(self, row: int) -> str:
        return f"{_q(self.sheet)}!$H${row}"


@dataclass
class CoverRow:
    sheet: str
    row: int


@dataclass
class IndexRow:
    entity: Entity
    code: str
    name: str
    tb_row: int | None
    balance: float
    rec: Rec | None = None
    rec_entity: RecEntity | None = None


@dataclass
class Rendered:
    """Also what controls.formula_controls expects: workbook and formula_cells."""
    workbook: Workbook
    formula_cells: list[tuple[str, str]] = field(default_factory=list)
    controls: list[Control] = field(default_factory=list)
    tb: dict[str, TbTab] = field(default_factory=dict)
    covers: dict[str, str] = field(default_factory=dict)
    cover_rows: dict[tuple[str, str], CoverRow] = field(default_factory=dict)
    attachment_rows: dict[str, int] = field(default_factory=dict)
    used_tabs: set = field(default_factory=set)
    complete: bool = False

    def formula(self, ws, ref: str, text: str, font=None, fmt=None, border=None, fill=None):
        cell = ws[ref]
        cell.value = text
        cell.font = font or _f()
        if fmt:
            cell.number_format = fmt
        if border:
            cell.border = border
        if fill:
            cell.fill = fill
        self.formula_cells.append((ws.title, ref))
        return cell


def _tb_tab(out: Rendered, group: Group, e: Entity, brand: Brand) -> None:
    name = _tab(f"TB {e.name}", out.used_tabs)
    ws = out.workbook.create_sheet(name)
    put(ws, "A1", f"{e.name} - full trial balance", _f(12, bold=True))
    put(ws, "A2", "Source:")
    put(ws, "B2", e.source)
    put(ws, "A3", "As at:")
    put(ws, "B3", group.period_end, _f(10, color=style.INPUT_BLUE), style.DATE)
    put(ws, "A4", "Run at:")
    put(ws, "B4", e.run_at, _f(10, color=style.INPUT_BLUE), style.DATE_TIME)
    for b in ("B3", "B4"):
        ws[b].alignment = Alignment(horizontal="left")
    _head(ws, 5, dict(zip("ABCDEFGH", ("Date", "Entity", "Code", "Account Name", "Class", "Debit", "Credit",
                                       "Net (Dr-Cr)"))), brand.primary)
    r, rows = 6, {}
    blue = _f(10, color=style.INPUT_BLUE)
    for row in e.rows:
        put(ws, f"A{r}", group.period_end, fmt=style.DATE, border=BOX)
        put(ws, f"B{r}", e.name, border=BOX)
        put(ws, f"C{r}", row.code, fmt="@", border=BOX)
        put(ws, f"D{r}", row.name, border=BOX)
        put(ws, f"E{r}", row.statement, border=BOX)
        put(ws, f"F{r}", row.debit, blue, style.NUM_2DP, border=BOX)
        put(ws, f"G{r}", row.credit, blue, style.NUM_2DP, border=BOX)
        out.formula(ws, f"H{r}", f"=F{r}-G{r}", fmt=style.NUM_2DP, border=BOX)
        rows[row.key] = r
        r += 1
    last, total = r - 1, r
    band = style.fill(brand.band)
    bold = _f(10, bold=True, color=_on(brand.band))
    for c in "ABCDEFGH":
        ws[f"{c}{total}"].fill = band
    put(ws, f"D{total}", "Total", bold, fill=band)
    for c in "FGH":
        out.formula(ws, f"{c}{total}", f"=SUM({c}6:{c}{last})", bold, style.NUM_2DP, fill=band)
    check = total + 1
    put(ws, f"D{check}", "Check: debits less credits (should be nil)", _f(9, italic=True))
    out.formula(ws, f"H{check}", f"=ROUND(F{total}-G{total},2)", _f(9, italic=True), style.NUM_2DP)
    result = check + 1
    out.formula(ws, f"D{result}", f'=IF(H{check}=0,"Debits equal credits","OUT OF BALANCE")', _f(10, bold=True))
    put(ws, "D2", "Trial balance check:", _f(10, bold=True))
    out.formula(ws, "D3", f"=D{result}", _f(10, bold=True))
    for ref in ("D3", f"D{result}"):
        ws.conditional_formatting.add(ref, FormulaRule(formula=[f'{ref}<>"Debits equal credits"'],
                                                       font=Font(bold=True, color=style.ALERT_RED)))
    _widths(ws, dict(A=12, B=32, C=9, D=42, E=15, F=14, G=14, H=14))
    ws.freeze_panes = "A6"
    _page(ws, grid=True)
    out.tb[e.key] = TbTab(name, 6, last, rows, total, f"{_q(name)}!$D${result}")


def _attachment_cell(out: Rendered, ws, ref: str, line: Line):
    if line.attachment and line.attachment in out.attachment_rows:
        cell = put(ws, ref, line.attachment, Font(name=style.FONT, size=11, underline="single"), border=BOX)
        cell.hyperlink = f"#{_q(ATTACH)}!A{out.attachment_rows[line.attachment]}"
        cell.font = Font(name=style.FONT, size=11, underline="single")
    else:
        text = f"{line.attachment} NOT FOUND" if line.attachment else "NONE"
        put(ws, ref, text, _f(11, bold=True, color=style.ALERT_RED), border=BOX)


def _sched_head(ws, group, e, rec, row: RecEntity, banner: str, out: Rendered):
    put(ws, "A1", f"{e.name} - {rec.title} schedule", _f(12, bold=True))
    put(ws, "A2", f"Account: {' '.join(x for x in (row.gl_code, row.gl_name) if x)}")
    put(ws, "B3", "Report date:")
    put(ws, "C3", group.period_end, _f(10, color=style.INPUT_BLUE), style.DATE)
    ws["C3"].alignment = Alignment(horizontal="left")
    put(ws, "A4", "Status:", _f(10, bold=True))
    out.formula(ws, "C4", f"={banner}")
    _status_style(ws, "C4", good=SIGNED_BANNER)


def _plain_schedule(out: Rendered, ws, lines: list[Line], brand: Brand) -> str:
    _head(ws, 5, dict(zip("ABCDEFGH", ("No", "Supplier / item", "Description", "Reference", "Date", "Attachment",
                                       "Amount", "Note"))), brand.primary, 33.75)
    blue = _f(10, color=style.INPUT_BLUE)
    r = 6
    for i, ln in enumerate(lines, 1):
        put(ws, f"A{r}", i, border=BOX)
        put(ws, f"B{r}", ln.item, wrap=True, border=BOX)
        put(ws, f"C{r}", ln.description, wrap=True, border=BOX)
        put(ws, f"D{r}", ln.reference, wrap=True, border=BOX)
        put(ws, f"E{r}", ln.when, blue, style.DATE, border=BOX)
        _attachment_cell(out, ws, f"F{r}", ln)
        put(ws, f"G{r}", ln.amount, blue, style.NUM_2DP, border=BOX)
        put(ws, f"H{r}", ln.note, wrap=True, border=BOX)
        r += 1
    last = max(r - 1, 6)
    total = last + 1
    band = style.fill(brand.band)
    for c in "ABCDEFGH":
        ws[f"{c}{total}"].fill = band
    put(ws, f"B{total}", "TOTAL", _f(10, bold=True, color=_on(brand.band)), fill=band)
    out.formula(ws, f"G{total}", f"=SUM(G6:G{last})", _f(10, bold=True, color=_on(brand.band)), style.NUM_2DP, fill=band)
    _widths(ws, dict(A=7, B=28, C=38, D=18, E=13, F=12, G=15, H=46))
    return f"G{total}"


def _month_grid(lines: list[Line], period_end: date) -> list[date]:
    starts = [ln.amortisation.commenced for ln in lines if ln.amortisation]
    ends = [_edate(ln.amortisation.commenced, _months_of(ln.amortisation) - 1) for ln in lines if ln.amortisation]
    first, last = min(starts), max(*ends, period_end.replace(day=1))
    months, d = [], first
    while d <= last:
        months.append(d)
        d = _edate(d, 1)
        if len(months) > MAX_MONTHS:
            raise RecInputError(f"amortisation runs over more than {MAX_MONTHS} months")
    return months


def _amortised_schedule(out: Rendered, group: Group, ws, lines: list[Line], brand: Brand) -> str:
    months = _month_grid(lines, group.period_end)
    first_m, n = 12, len(months)
    last_m = first_m + n - 1
    released, balance, attach, note = (col(last_m + i) for i in (1, 2, 3, 4))
    m1, mz = col(first_m), col(last_m)
    head = dict(zip("ABCDEFGHIJK", ("No", "Supplier", "Description", "Release to (P&L a/c)", "Invoice ref & date",
                                    "Total cost (net)", "Service start", "Service end", "Amort. commenced", "Months",
                                    "Monthly")))
    head.update({released: f"Released to {group.period_end.strftime('%d-%b').lstrip('0')}", balance: "Balance c/f",
                 attach: "Attachment", note: "Note"})
    _head(ws, 5, head, brand.primary, 33.75)
    hfont = _f(9, bold=True, color=_on(brand.primary))
    for i, d in enumerate(months):
        c = put(ws, f"{col(first_m + i)}5", d, hfont, "mmm-yy", border=BOX, fill=style.fill(brand.primary))
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[col(first_m + i)].width = 9
    blue = _f(10, color=style.INPUT_BLUE)
    r = 6
    for i, ln in enumerate(lines, 1):
        a = ln.amortisation
        put(ws, f"A{r}", i, border=BOX)
        put(ws, f"B{r}", ln.item, wrap=True, border=BOX)
        put(ws, f"C{r}", ln.description, wrap=True, border=BOX)
        put(ws, f"D{r}", a.release_to if a else "", wrap=True, border=BOX)
        inv = " ".join(x for x in (ln.reference, date_label(ln.when) if ln.when else "") if x)
        put(ws, f"E{r}", inv, wrap=True, border=BOX)
        put(ws, f"F{r}", ln.amount, blue, style.NUM_2DP, border=BOX)
        for c, v in (("G", a.start if a else None), ("H", a.end if a else None), ("I", a.commenced if a else None)):
            put(ws, f"{c}{r}", v, blue, style.DATE, border=BOX)
        out.formula(ws, f"J{r}", f'=IF(OR(G{r}="",H{r}=""),"",MAX(1,ROUND((H{r}-G{r})/30.4375,0)))', border=BOX)
        out.formula(ws, f"K{r}", f'=IF(ISNUMBER(J{r}),ROUND(F{r}/J{r},2),"")', fmt=style.NUM_2DP, border=BOX)
        for j in range(n):
            c = col(first_m + j)
            # The last month takes what is left, so a finished item ends on exactly nil.
            out.formula(ws, f"{c}{r}",
                        f'=IF(OR($I{r}="",ISNUMBER($K{r})=FALSE),0,IF(AND({c}$5>=$I{r},{c}$5<EDATE($I{r},$J{r})),'
                        f'IF({c}$5=EDATE($I{r},$J{r}-1),$F{r}-$K{r}*($J{r}-1),$K{r}),0))',
                        fmt=style.NUM_MONTH, border=BOX)
        out.formula(ws, f"{released}{r}", f'=SUMIF(${m1}$5:${mz}$5,"<="&$C$3,${m1}{r}:${mz}{r})',
                    fmt=style.NUM_2DP, border=BOX)
        out.formula(ws, f"{balance}{r}", f"=F{r}-{released}{r}", fmt=style.NUM_2DP, border=BOX)
        _attachment_cell(out, ws, f"{attach}{r}", ln)
        put(ws, f"{note}{r}", ln.note, wrap=True, border=BOX)
        r += 1
    last, total = r - 1, r
    band = style.fill(brand.band)
    bold = _f(10, bold=True, color=_on(brand.band))
    for c in range(1, last_m + 5):
        ws.cell(total, c).fill = band
    put(ws, f"B{total}", "TOTAL", bold, fill=band)
    for c in ("F", released, balance):
        out.formula(ws, f"{c}{total}", f"=SUM({c}6:{c}{last})", bold, style.NUM_2DP, fill=band)
    _widths(ws, dict(A=4, B=20, C=28, D=15, E=18, F=13, G=12, H=12, I=13, J=7, K=10))
    _widths(ws, {released: 13, balance: 14, attach: 11, note: 46})
    ws.freeze_panes = f"{m1}6"
    return f"{balance}{total}"


def _schedule(out: Rendered, group: Group, rec: Rec, row: RecEntity, e: Entity, prefix: str, banner: str,
              brand: Brand) -> str:
    """The schedule tab; returns a reference to its total."""
    suffix = f" {row.gl_code}" if row.gl_code else ""
    name = _tab(f"{prefix} {e.name}", out.used_tabs, suffix)
    ws = out.workbook.create_sheet(name)
    _sched_head(ws, group, e, rec, row, banner, out)
    lines = list(row.lines)
    if not lines and row.support is not None:
        lines = [Line(item="Supporting balance per record", amount=row.support,
                      note="No line detail on the record")]
    if any(ln.amortisation for ln in lines):
        total = _amortised_schedule(out, group, ws, lines, brand)
    else:
        total = _plain_schedule(out, ws, lines, brand)
    _page(ws, grid=True)
    return f"{_q(name)}!{total}"


def _cover(out: Rendered, group: Group, rec: Rec, number: int, brand: Brand) -> None:
    prefix = f"R{number:02d}"
    name = _tab(f"Cover {prefix} {rec.title}", out.used_tabs)
    ws = out.workbook.create_sheet(name)
    out.covers[rec.key] = name
    entities = {e.key: e for e in group.entities}
    codes = list(dict.fromkeys(r.gl_code or r.gl_name for r in rec.entities))
    meta = (("Company", group.name), ("Month End", group.period_end), ("GL Account", ", ".join(codes)),
            ("Description:", rec.description or rec.title), ("Currency:", group.currency))
    for r, (label, value) in enumerate(meta, 2):
        put(ws, f"B{r}", label, _f(10, bold=True))
        c = put(ws, f"C{r}", value, fmt=style.DATE if isinstance(value, date) else None)
        c.alignment = Alignment(horizontal="left")
    head = 11
    _head(ws, head, dict(B="GL acc", C="GL Name", E="GL (per TB)", G="Schedule", I="Variance", K="Comment"), brand.primary)
    _head(ws, head, dict(A="Entity"), brand.accent)
    first = head + 1
    last = first + len(rec.entities) - 1
    total = last + 1
    # Written first: the schedules show the banner, and the banner needs these rows.
    if rec.signed:
        moved = any(_ledger_moved(group, row) for row in rec.entities)
        banner = ("SIGNED BUT THE LEDGER HAS MOVED SINCE - not complete, needs re-signing" if moved else
                  f'=IF(SUMPRODUCT(--(ROUND(I{first}:I{last},2)<>0))=0,"{SIGNED_BANNER}",'
                  f'"SIGNED BUT VARIANCE OPEN - not complete")')
    else:
        banner = f"UNSIGNED - {STAGE_TEXT[rec.stage]} - not complete"
    if banner.startswith("="):
        out.formula(ws, "A8", banner)
    else:
        put(ws, "A8", banner)
    _status_style(ws, "A8:K8", good=SIGNED_BANNER, strong=True)
    banner_ref = f"{_q(name)}!$A$8"
    number_fmt = dict(fmt=style.NUM_2DP, border=BOX)
    for i, row in enumerate(rec.entities):
        r = first + i
        e = entities[row.entity]
        tb = out.tb[row.entity]
        tb_row = tb.rows.get(row.key)
        gl_name = row.gl_name or next((t.name for t in e.rows if t.key == row.key), "")
        put(ws, f"A{r}", e.name, border=BOX)
        put(ws, f"B{r}", row.gl_code, fmt="@", border=BOX)
        put(ws, f"C{r}", gl_name, border=BOX)
        out.formula(ws, f"E{r}", f"={tb.net(tb_row)}" if tb_row else "=0", **number_fmt)
        sched = _schedule(out, group, rec, row, e, prefix, banner_ref, brand)
        out.formula(ws, f"G{r}", f"={sched}", **number_fmt)
        out.formula(ws, f"I{r}", f"=E{r}-G{r}", **number_fmt)
        put(ws, f"K{r}", row.comment, wrap=True, border=BOX)
        out.cover_rows[(row.entity, row.key)] = CoverRow(name, r)
    put(ws, f"A{total}", "GROUP TOTAL", _f(10, bold=True))
    for c in "EGI":
        out.formula(ws, f"{c}{total}", f"=SUM({c}{first}:{c}{last})", _f(10, bold=True), style.NUM_2DP)
    _nonzero_red(ws, f"I{first}:I{total}")
    so = total + 5
    for c, label in (("C", "Name"), ("E", "Position"), ("G", "Date")):
        put(ws, f"{c}{so}", label, _f(10, bold=True))
    for i, (role, label) in enumerate(ROLES, 1):
        r = so + i
        put(ws, f"B{r}", label, _f(10, bold=True))
        s = rec.sign_offs.get(role)
        if s:
            put(ws, f"C{r}", s.name)
            put(ws, f"E{r}", s.position).alignment = Alignment(shrink_to_fit=True)
            c = put(ws, f"G{r}", s.when, fmt=style.DATE)
            c.alignment = Alignment(horizontal="left")
        else:
            put(ws, f"C{r}", "NOT SIGNED", _f(11, bold=True, color=style.ALERT_RED), fill=style.fill(style.ALERT_TINT))
    _widths(ws, dict(A=30.4, B=12.3, C=40.1, D=0.9, E=14, F=0.9, G=14, H=0.9, I=12, J=0.9, K=82.1))
    _place_logo(ws, brand, 10, 2047875)
    _page(ws)


def _ledger_moved(group: Group, row: RecEntity) -> bool:
    if row.ledger is None:
        return False
    tb = next(e for e in group.entities if e.key == row.entity)
    current = next((t for t in tb.rows if t.key == row.key), None)
    return current is not None and abs(current.net - row.ledger) >= TOLERANCE


def _index_rows(group: Group) -> list[IndexRow]:
    """Every balance sheet account with a balance, plus anything a reconciliation
    covers even at nil, so a schedule against a cleared account still shows."""
    rec_of = {(r.entity, r.key): (rec, r) for rec in group.recs for r in rec.entities}
    rows = []
    for e in group.entities:
        placed = set()
        for i, t in enumerate(e.rows):
            pair = rec_of.get((e.key, t.key))
            if t.statement == BS and abs(t.net) >= TOLERANCE or pair:
                rows.append(IndexRow(e, t.code, t.name, i, t.net, *(pair or (None, None))))
                placed.add(t.key)
        for (ekey, key), (rec, r) in rec_of.items():
            if ekey == e.key and key not in placed:
                rows.append(IndexRow(e, r.gl_code, r.gl_name, None, 0.0, rec, r))
    return rows


def _row_status(group: Group, row: IndexRow, r: int) -> str:
    if row.rec is None:
        return "No rec"
    if row.tb_row is None:
        return "Not on trial balance"
    if not row.rec.signed:
        return f"Unsigned - {STAGE_TEXT[row.rec.stage]}"
    if _ledger_moved(group, row.rec_entity):
        return "Signed - ledger moved, re-sign"
    return f'=IF(ROUND(F{r},2)<>0,"Signed - variance open","{SIGNED}")'


def _index(out: Rendered, ws, group: Group, brand: Brand, now: datetime) -> None:
    rows = _index_rows(group)
    n_e = len(group.entities)
    sum_head, sum_first = 8, 9
    sum_last = sum_first + n_e - 1
    head = sum_last + 3
    first = head + 1
    last = max(first + len(rows) - 1, first)
    put(ws, "A1", "Balance sheet reconciliations", _f(13, bold=True))
    for r, (label, value) in enumerate((("Company", group.name), ("Month End", group.period_end),
                                        ("Currency", group.currency)), 2):
        put(ws, f"A{r}", label, _f(10, bold=True))
        c = put(ws, f"B{r}", value, fmt=style.DATE if isinstance(value, date) else None)
        c.alignment = Alignment(horizontal="left")
    n = f"ROWS(G{first}:G{last})"
    done = f'COUNTIF(G{first}:G{last},"{SIGNED}")'
    ok = f'COUNTIF(I{sum_first}:I{sum_last},"OK")'
    out.formula(ws, "A5",
                f'=IF({ok}<{n_e},"INCOMPLETE - an account with a balance is missing or a trial balance does not balance",'
                f'IF({done}={n},"{SIGNED_BANNER}","INCOMPLETE - "&({n}-{done})&" of "&{n}&" accounts not signed off"))')
    _status_style(ws, "A5:I5", good=SIGNED_BANNER, strong=True)

    put(ws, f"A{sum_head - 1}", "Completeness: every trial balance against this index", _f(10, bold=True))
    _head(ws, sum_head, dict(zip("ABCDEFGHI", ("Company", "TB run at", "TB check", "Debits", "Credits", "Difference",
                                               "Balance sheet accounts with a balance (per TB)", "Listed below",
                                               "Check"))), brand.primary, 36)
    for i, e in enumerate(group.entities):
        r = sum_first + i
        tb = out.tb[e.key]
        q = _q(tb.sheet)
        put(ws, f"A{r}", e.name, border=BOX)
        out.formula(ws, f"B{r}", f"={q}!$B$4", fmt=style.DATE_TIME, border=BOX)
        out.formula(ws, f"C{r}", f"={tb.result}", border=BOX)
        out.formula(ws, f"D{r}", f"={q}!$F${tb.total}", fmt=style.NUM_2DP, border=BOX)
        out.formula(ws, f"E{r}", f"={q}!$G${tb.total}", fmt=style.NUM_2DP, border=BOX)
        out.formula(ws, f"F{r}", f"=ROUND(D{r}-E{r},2)", fmt=style.NUM_2DP, border=BOX)
        rng = lambda c: f"{q}!${c}${tb.first}:${c}${tb.last}"
        out.formula(ws, f"G{r}", f'=SUMPRODUCT(({rng("E")}="{BS}")*(ROUND({rng("H")},2)<>0))', fmt="0", border=BOX)
        out.formula(ws, f"H{r}", f'=COUNTIFS($A${first}:$A${last},A{r},$D${first}:$D${last},"<>0")', fmt="0", border=BOX)
        out.formula(ws, f"I{r}", f'=IF(AND(F{r}=0,G{r}=H{r},ROUND(SUMIFS({rng("H")},{rng("E")},"{BS}")'
                                 f'-SUMIFS($D${first}:$D${last},$A${first}:$A${last},A{r}),2)=0),"OK","MISSING")',
                    _f(10, bold=True), border=BOX)
    ws.conditional_formatting.add(f"I{sum_first}:I{sum_last}", FormulaRule(
        formula=[f'I{sum_first}<>"OK"'], font=Font(bold=True, color=style.ALERT_RED)))

    put(ws, f"A{head - 1}", "Index: every balance sheet account with a balance", _f(10, bold=True))
    _head(ws, head, dict(zip("ABCDEFGH", ("Entity", "GL acc", "GL Name", "Balance per TB", "Schedule", "Variance",
                                          "Status", "Reconciliation"))), brand.primary)
    number_fmt = dict(fmt=style.NUM_2DP, border=BOX)
    for i, row in enumerate(rows):
        r = first + i
        tb = out.tb[row.entity.key]
        put(ws, f"A{r}", row.entity.name, border=BOX)
        put(ws, f"B{r}", row.code, fmt="@", border=BOX)
        put(ws, f"C{r}", row.name, border=BOX)
        key = row.code or row.name
        out.formula(ws, f"D{r}", f"=ROUND({tb.net(tb.rows[key])},2)" if row.tb_row is not None else "=0", **number_fmt)
        link = out.cover_rows.get((row.entity.key, key))
        if link:
            q = _q(link.sheet)
            out.formula(ws, f"E{r}", f"={q}!$G${link.row}", **number_fmt)
            out.formula(ws, f"F{r}", f"={q}!$I${link.row}", **number_fmt)
            c = put(ws, f"H{r}", link.sheet, Font(name=style.FONT, size=10, underline="single"), border=BOX)
            c.hyperlink = f"#{q}!A1"
            c.font = Font(name=style.FONT, size=10, underline="single")
        else:
            for c in "EF":
                ws[f"{c}{r}"].border = BOX
            ws[f"H{r}"].border = BOX
        status = _row_status(group, row, r)
        if status.startswith("="):
            out.formula(ws, f"G{r}", status, border=BOX)
        else:
            put(ws, f"G{r}", status, border=BOX)
    if rows:
        _status_style(ws, f"G{first}:G{last}")
        _nonzero_red(ws, f"F{first}:F{last}")
    out.controls = [*_controls(group, rows, brand, out)]
    formulas = formula_controls(out)
    out.controls.extend(formulas)
    signed_rows = [r for r in rows if r.rec and r.rec.signed and r.tb_row is not None
                   and not _ledger_moved(group, r.rec_entity)
                   and abs(r.balance - _support(group, r.rec_entity)) < TOLERANCE]
    out.complete = len(signed_rows) == len(rows) and not failed(out.controls)

    r = last + 2
    put(ws, f"A{r}", "Checks at build time", _f(10, bold=True))
    _head(ws, r + 1, dict(A="Check", C="Detail", G="Status"), brand.primary)
    for c in "BDEF":
        ws[f"{c}{r + 1}"].fill = style.fill(brand.primary)
    r += 2
    for c in out.controls:
        put(ws, f"A{r}", c.label, _f(10))
        put(ws, f"C{r}", c.detail, _f(10))
        put(ws, f"G{r}", c.status.upper(), _f(10, bold=True, color=style.ALERT_RED if c.status != "pass" else style.BLACK))
        r += 1
    put(ws, f"A{r + 1}", f"Built {now.strftime('%d %b %Y %H:%M').lstrip('0')} by pack engine {ENGINE_VERSION}.",
        _f(8, italic=True, color=style.GREY_TEXT))
    _widths(ws, dict(A=32, B=17, C=40, D=14, E=14, F=13, G=36, H=30, I=11))
    _place_logo(ws, brand, 6, 0, box=(420, 76))
    _page(ws)


def _support(group: Group, row: RecEntity) -> float:
    if row.lines:
        return sum(line_balance(ln, group.period_end) for ln in row.lines)
    return row.support or 0.0


def _controls(group: Group, rows: list[IndexRow], brand: Brand, out: Rendered) -> list[Control]:
    out_of_balance = [e.name for e in group.entities
                      if abs(sum(t.debit for t in e.rows) - sum(t.credit for t in e.rows)) >= TOLERANCE]
    no_rec = [r for r in rows if r.rec is None]
    off_tb = [r for r in rows if r.rec is not None and r.tb_row is None]
    unsigned = list(dict.fromkeys(r.title for r in group.recs if not r.signed))
    overclaimed = [r.title for r in group.recs if STATUSES.index(r.status) > r.signed_stage]
    all_rows = [(rec, r) for rec in group.recs for r in rec.entities]
    moved = [f"{rec.title} {r.entity}" for rec, r in all_rows if _ledger_moved(group, r)]
    net_of = {(e.key, t.key): t.net for e in group.entities for t in e.rows}
    variances = [f"{rec.title} {r.entity}" for rec, r in all_rows
                 if abs(net_of.get((r.entity, r.key), 0.0) - _support(group, r)) >= TOLERANCE]
    unsupported = [f"{rec.title} {r.entity}" for rec, r in all_rows if not r.lines and r.support is None]
    differs = [f"{rec.title} {r.entity}" for rec, r in all_rows if r.lines and r.support is not None
               and abs(_support(group, r) - r.support) >= TOLERANCE]
    lines = [ln for _, r in all_rows for ln in r.lines]
    no_doc = [ln.item for ln in lines if not ln.attachment]
    bad_ref = sorted({ln.attachment for ln in lines if ln.attachment and ln.attachment not in out.attachment_rows})
    bad_url = [a.ref for a in group.attachments if a.url and not _safe_url(a.url)]

    def check(key, label, items, bad="fail", ok_detail=""):
        names = "; ".join(str(i) for i in items[:12]) + ("; ..." if len(items) > 12 else "")
        return Control(key, label, bad if items else "pass", detail=names if items else ok_detail)

    return [
        check("recs.tb_balances", "Every trial balance balances", out_of_balance),
        check("recs.coverage", "Every balance sheet account with a balance has a reconciliation",
              [f"{r.entity.name} {r.code or r.name}" for r in no_rec], ok_detail=f"{len(rows)} accounts"),
        check("recs.on_tb", "Every reconciled account is on its trial balance",
              [f"{r.entity.name} {r.code or r.name}" for r in off_tb]),
        check("recs.signed", "Every reconciliation is signed", unsigned),
        check("recs.status", "No record claims more than its sign-offs show", overclaimed),
        check("recs.ledger", "No ledger balance has moved since the reconciliation was prepared", moved),
        check("recs.variance", "Every variance is nil", variances),
        check("recs.support", "Every reconciliation has support", unsupported),
        check("recs.support_ties", "Stated support equals the schedule total", differs),
        check("recs.attachment_refs", "Every attachment reference is on the Attachments tab", bad_ref),
        check("recs.attachments", "Every schedule line has an attachment", no_doc, bad="warn"),
        check("recs.attachment_links", "Attachment links are https", bad_url, bad="warn"),
        check("recs.branding", "Branding as set in the profile", brand.warnings, bad="warn",
              ok_detail=f"{brand.mode} branding"),
    ]


def _safe_url(url: str) -> bool:
    try:
        parts = urlparse(url)
    except ValueError:
        return False
    return parts.scheme == "https" and bool(parts.netloc)


def _attachments(out: Rendered, ws, group: Group, brand: Brand) -> None:
    put(ws, "A1", "Attachments", _f(12, bold=True))
    put(ws, "A2", "Supporting documents, referenced from each schedule line.", _f(8, italic=True, color=style.GREY_TEXT))
    _head(ws, 4, dict(A="Ref", B="Document", C="Link"), brand.primary)
    for r, a in enumerate(group.attachments, 5):
        put(ws, f"A{r}", a.ref, border=BOX)
        put(ws, f"B{r}", a.name, border=BOX)
        c = put(ws, f"C{r}", "", border=BOX)
        if a.url and _safe_url(a.url):
            c.value, c.hyperlink = "Open", a.url
            c.font = Font(name=style.FONT, size=11, underline="single")
    _widths(ws, dict(A=10, B=60, C=10))
    _page(ws, grid=True)


def _how_to_read(ws, group: Group, brand: Brand) -> None:
    put(ws, "A1", f"{group.name} - balance sheet reconciliations", _f(13, bold=True))
    rows = [
        ("As at", f"{date_label(group.period_end)} | {group.currency}"),
        None,
        ("READING A LINE", "Blue cells are inputs (from the document or the ledger); black cells are formulas."),
        ("Recs index", "Every balance sheet account with a balance, with its status. The completeness table proves "
                       "nothing with a balance is missing, against each trial balance, live."),
        ("Status", f"{SIGNED} means prepared, reviewed, and CFO approved, each with a name and date, and no variance. "
                   "Anything else is shown in red and is not complete."),
        None,
        ("RECONCILIATION", "Each cover compares the ledger, linked by formula to that company's trial balance tab, "
                           "with the total of each schedule. Variance is ledger less schedule and should be nil."),
        ("Trial balances", "One tab per company: the full trial balance, the date and time it was run, and a check "
                           "that debits equal credits."),
        ("Signs", "Schedules follow the trial balance: debits positive, credits in brackets."),
        None,
        ("SCHEDULES", "A line is either a balance, or a total cost released monthly across its service period. "
                      "Balance c/f is total cost less released to the report date. The last month releases "
                      "whatever remains, so a finished item ends on nil."),
        ("Attachments", "Each schedule line carries a reference (Att-01) to a document on the Attachments tab. "
                        "NONE in red means the line has no document."),
    ]
    for r, row in enumerate(rows, 2):
        if row:
            put(ws, f"A{r}", row[0], _f(10, bold=True))
            put(ws, f"B{r}", row[1], _f(10), wrap=True)
    _widths(ws, dict(A=22, B=100))
    _page(ws)


def render(group: Group, profile: dict, now: datetime | None = None) -> Rendered:
    now = now or datetime.now(LOCAL_TZ)
    brand = resolve_brand(profile)
    wb = Workbook()
    wb.remove(wb.active)
    out = Rendered(workbook=wb)
    out.used_tabs.update(x.lower() for x in (INDEX, HOW, ATTACH))
    index = wb.create_sheet(INDEX)
    how = wb.create_sheet(HOW)
    _how_to_read(how, group, brand)
    for e in group.entities:
        _tb_tab(out, group, e, brand)
    attach = wb.create_sheet(ATTACH)
    out.attachment_rows = {a.ref: r for r, a in enumerate(group.attachments, 5)}
    _attachments(out, attach, group, brand)
    for i, rec in enumerate(group.recs, 1):
        _cover(out, group, rec, i, brand)
    _index(out, index, group, brand, now)
    for ws in wb.worksheets:
        role = ("control" if ws.title in (INDEX, HOW, ATTACH) else "detail" if ws.title.startswith("TB ")
                else "summary" if ws.title.startswith("Cover ") else "entity")
        colour = _colour(brand.tabs.get(role))
        ws.sheet_properties.tabColor = colour or style.STZA_TAB_COLOURS[role]
    wb.calculation.fullCalcOnLoad = True
    return out


def file_name(profile: dict, group: Group, now: datetime, complete: bool) -> str:
    label = re.sub(r'[<>:"/\\|?*]', "", clean(profile.get("label")) or group.name)
    return (f"{label} - Balance Sheet Recs - {group.period_end.strftime('%b%Y')} - {now.strftime('%Y-%m-%d %H%M')}"
            + ("" if complete else " - INCOMPLETE") + ".xlsx")


def write(group: Group, profile: dict, out_dir: Path, now: datetime | None = None) -> tuple[Path, Rendered]:
    now = now or datetime.now(LOCAL_TZ)
    rendered = render(group, profile, now)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / file_name(profile, group, now, rendered.complete)
    rendered.workbook.save(path)
    return path, rendered


def rec_files(profile: dict, period: str, out_dir: Path, now: datetime | None = None) -> list[Path]:
    """The hook in build.py. Off unless PACK_RECS_JSON names an input file, so a live
    build is unchanged. Wiring to the finance-api rec record replaces this file read."""
    source = os.environ.get(ENV_INPUT, "").strip()
    if not source:
        return []
    group = parse(json.loads(Path(source).read_text(encoding="utf-8")))
    if group.period_end.strftime("%Y-%m") != period:
        raise RecInputError(f"{source} is for {group.period_end}, not {period}")
    return [write(group, profile, out_dir, now)[0]]

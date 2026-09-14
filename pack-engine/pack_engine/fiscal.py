"""Financial-year calendar.

Every period calculation in the engine goes through here, so a client whose
year ends in March (STZA) and one whose year ends in December (Feldspar) are
handled by the same code. A year is named after the calendar year it ends in:
the year ending 31 March 2027 is FY27.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date


def month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def parse_period(period: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d{4})-(0[1-9]|1[0-2])", str(period))
    if not m:
        raise ValueError(f"period must be YYYY-MM, got {period!r}")
    return int(m.group(1)), int(m.group(2))


@dataclass(frozen=True)
class FiscalCalendar:
    year_end_month: int  # 1-12; 3 for a 31 March year end

    def __post_init__(self):
        if not 1 <= self.year_end_month <= 12:
            raise ValueError("year_end_month must be 1-12")

    def fy_end_year(self, year: int, month: int) -> int:
        """Calendar year in which the financial year containing (year, month) ends."""
        return year if month <= self.year_end_month else year + 1

    def fy_months(self, period: str) -> list[date]:
        """The 12 month-ends of the financial year containing `period`."""
        y, m = parse_period(period)
        end_year = self.fy_end_year(y, m)
        start_month = self.year_end_month % 12 + 1
        start_year = end_year if start_month == 1 else end_year - 1
        out = []
        yy, mm = start_year, start_month
        for _ in range(12):
            out.append(month_end(yy, mm))
            yy, mm = (yy + 1, 1) if mm == 12 else (yy, mm + 1)
        return out

    def months_to_date(self, period: str) -> list[date]:
        """Month-ends from the start of the financial year up to `period`."""
        y, m = parse_period(period)
        target = month_end(y, m)
        return [d for d in self.fy_months(period) if d <= target]

    def fy_start(self, period: str) -> date:
        first = self.fy_months(period)[0]
        return date(first.year, first.month, 1)

    def prior_year_end(self, period: str) -> date:
        first = self.fy_months(period)[0]
        return month_end(first.year - 1, 12) if first.month == 1 else month_end(first.year, first.month - 1)

    def label(self, period: str) -> str:
        y, m = parse_period(period)
        return f"FY{self.fy_end_year(y, m) % 100:02d}"

    def prior_label(self, period: str) -> str:
        y, m = parse_period(period)
        return f"FY{(self.fy_end_year(y, m) - 1) % 100:02d}"


def month_label(d: date) -> str:
    return d.strftime("%b %Y")          # "Aug 2026"


def date_label(d: date) -> str:
    return f"{d.day} {d.strftime('%b %Y')}"   # "31 Aug 2026" - no ordinals, per house style

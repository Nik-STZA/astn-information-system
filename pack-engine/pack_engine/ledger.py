"""Ledger: every account's figures for the financial year, from Xero trial balances.

Verified on STZA's Xero on 14 Sep 2026, a trial balance dated at a month-end has:
  - "Debit" / "Credit": that month's MOVEMENT, for every account;
  - "YTD Debit" / "YTD Credit": financial-year-to-date for profit and loss
    accounts, and the CLOSING BALANCE for balance sheet accounts.
So one trial balance per month-end, plus one at the prior year end, gives the
whole pack. Accounts are keyed by Xero AccountID, never by name, because names
repeat and change.

All amounts are stored signed as debit minus credit. Presentation signs are the
statement model's business.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .fiscal import month_end

PNL_CLASSES = {"REVENUE", "EXPENSE"}


@dataclass(frozen=True)
class Account:
    id: str
    code: str | None
    name: str
    klass: str          # ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    type: str           # BANK, CURRENT, OVERHEADS, ...
    reporting_code: str | None
    reporting_name: str | None
    status: str = "ACTIVE"

    @property
    def is_pnl(self) -> bool:
        return self.klass in PNL_CLASSES

    @property
    def label(self) -> str:
        return f"{self.code} - {self.name}" if self.code else self.name


def account_from_xero(a: dict) -> Account:
    return Account(id=a["AccountID"], code=a.get("Code"), name=a.get("Name", ""),
                   klass=a.get("Class", ""), type=a.get("Type", ""),
                   reporting_code=a.get("ReportingCode"),
                   reporting_name=a.get("ReportingCodeName"),
                   status=a.get("Status", "ACTIVE"))


def _num(v) -> float:
    if v in (None, ""):
        return 0.0
    return float(str(v).replace(",", ""))


def report_rows(report: dict):
    """Yield (section title, row type, label, account id, [values]) for a Xero report."""
    def walk(rows, section):
        for r in rows:
            kind = r.get("RowType")
            if kind == "Section":
                yield from walk(r.get("Rows", []), r.get("Title") or section)
            elif kind in ("Row", "SummaryRow"):
                cells = r.get("Cells", [])
                if not cells:
                    continue
                acct = next((a.get("Value") for a in (cells[0].get("Attributes") or [])
                             if a.get("Id") == "account"), None)
                yield section or "", kind, cells[0].get("Value"), acct, [c.get("Value") for c in cells[1:]]
    yield from walk(report.get("Rows", []), None)


@dataclass
class TrialBalance:
    as_at: date
    movement: dict[str, float] = field(default_factory=dict)   # account id -> Dr - Cr for the month
    ytd: dict[str, float] = field(default_factory=dict)        # account id -> Dr - Cr YTD / closing
    total_debit: float = 0.0
    total_credit: float = 0.0
    total_ytd_debit: float = 0.0
    total_ytd_credit: float = 0.0
    unidentified: list[str] = field(default_factory=list)       # rows with values but no account id


def parse_trial_balance(report: dict, as_at: date) -> TrialBalance:
    tb = TrialBalance(as_at=as_at)
    for section, kind, label, acct, vals in report_rows(report):
        vals = (vals + ["", "", "", ""])[:4]
        if kind == "SummaryRow" and str(label).strip().lower() == "total":
            tb.total_debit, tb.total_credit, tb.total_ytd_debit, tb.total_ytd_credit = map(_num, vals)
            continue
        if kind != "Row":
            continue
        dr, cr, ydr, ycr = map(_num, vals)
        if not acct:
            if any((dr, cr, ydr, ycr)):
                tb.unidentified.append(str(label))
            continue
        tb.movement[acct] = round(dr - cr, 2)
        tb.ytd[acct] = round(ydr - ycr, 2)
    return tb


@dataclass
class Ledger:
    accounts: dict[str, Account]
    months: list[date]                      # month-ends of the FY to date
    fy_months: list[date]                   # all 12 month-ends of the FY
    prior_year_end: date
    trial_balances: dict[date, TrialBalance]
    # The year end before last: opening balances for the prior-year cash flow.
    prior_prior_year_end: date | None = None

    def movement(self, account_id: str, month: date) -> float:
        tb = self.trial_balances.get(month)
        return tb.movement.get(account_id, 0.0) if tb else 0.0

    def closing(self, account_id: str, month: date) -> float:
        """Balance sheet accounts: closing balance. P&L accounts: FY to date."""
        tb = self.trial_balances.get(month)
        return tb.ytd.get(account_id, 0.0) if tb else 0.0

    def active_accounts(self) -> list[Account]:
        """Accounts with any movement or balance in the FY to date or at the prior year end."""
        seen = set()
        for tb in self.trial_balances.values():
            seen.update(k for k, v in tb.movement.items() if v)
            seen.update(k for k, v in tb.ytd.items() if v)
        return [self.accounts[i] for i in self.accounts if i in seen]

    def unknown_account_ids(self) -> list[str]:
        ids = set()
        for tb in self.trial_balances.values():
            ids.update(tb.movement)
        return sorted(i for i in ids if i not in self.accounts)


def fetch_ledger(api, client: str, entity: str, cal, period: str) -> Ledger:
    accounts = {a.id: a for a in map(account_from_xero, api.accounts(client, entity))}
    months = cal.months_to_date(period)
    pye = cal.prior_year_end(period)
    ppye = month_end(pye.year - 1, pye.month)
    tbs = {}
    for d in [ppye, pye, *months]:
        tbs[d] = parse_trial_balance(api.trial_balance(client, entity, d), d)
    return Ledger(accounts=accounts, months=months, fy_months=cal.fy_months(period),
                  prior_year_end=pye, trial_balances=tbs, prior_prior_year_end=ppye)

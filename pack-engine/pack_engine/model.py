"""Statement model: pure data, no Excel.

The workbook is written from this model with formulas, and the controls compare
this model with Xero's own reports, so the two views of the numbers are checked
against each other and against Xero.

Presentation signs: on the P&L, income is positive and costs negative (credit
positive). On the balance sheet, assets are positive and liabilities and equity
are shown as positive amounts (credit positive).

Figures are asked for by date: a month-end of the current financial year gives
that month (P&L) or that month-end balance (balance sheet); a prior year end
gives that full year (P&L) or that year-end balance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .ledger import Account, Ledger
from .mapping import BY_KEY, Category, Mapping, cash_flow_class


@dataclass
class Line:
    account: Account
    category: str
    values: dict[date, float]            # current year months, presentation sign
    priors: dict[date, float]            # year end -> full year (P&L) or balance (BS)
    opening: float = 0.0                 # at the year end before the oldest comparative
    cash_flow: str | None = None         # balance sheet lines: where the movement goes on the cash flow

    def at(self, d: date) -> float:
        return self.values[d] if d in self.values else self.priors.get(d, 0.0)


@dataclass
class Block:
    category: str
    label: str
    lines: list[Line] = field(default_factory=list)

    def total(self, d: date) -> float:
        return round(sum(l.at(d) for l in self.lines), 2)


@dataclass
class Model:
    months: list[date]
    fy_months: list[date]
    prior_year_end: date
    prior_year_ends: list[date]          # headline comparatives, oldest first
    opening_year_end: date | None
    pnl: list[Block]
    bs: list[Block]
    gaps: list[Mapping]
    categories: dict[str, Category] = field(default_factory=lambda: dict(BY_KEY))

    def section_of(self, category: str) -> str:
        return self.categories[category].section

    def _sum(self, blocks, d: date, sections: set[str] | None = None) -> float:
        return round(sum(b.total(d) for b in blocks
                         if sections is None or self.section_of(b.category) in sections), 2)

    # --- profit and loss --------------------------------------------------------
    def net_profit(self, d: date) -> float:
        """A month of this year, or a whole prior year (by its year end)."""
        return self._sum(self.pnl, d)

    def net_profit_ytd(self, month: date) -> float:
        return round(sum(self.net_profit(m) for m in self.months if m <= month), 2)

    # --- balance sheet ----------------------------------------------------------
    def assets(self, d: date) -> float:
        return self._sum(self.bs, d, {"fixed_assets", "current_assets"})

    def liabilities(self, d: date) -> float:
        return self._sum(self.bs, d, {"creditors_lt1y", "creditors_gt1y", "provisions"})

    def current_year_earnings(self, d: date) -> float:
        return self.net_profit_ytd(d) if d in self.months else self.net_profit(d)

    def equity(self, d: date) -> float:
        return round(self._sum(self.bs, d, {"equity"}) + self.current_year_earnings(d), 2)

    def net_assets(self, d: date) -> float:
        return round(self.assets(d) - self.liabilities(d), 2)


# Balance sheet sections whose accounts are credit-natural (shown as positive credits).
CREDIT_SECTIONS = {"creditors_lt1y", "creditors_gt1y", "provisions", "equity"}


def build_model(ledger: Ledger, mapping: dict[str, Mapping],
                categories: dict[str, Category] | None = None) -> Model:
    cats = categories or BY_KEY
    active = ledger.active_accounts()
    gaps = [mapping[a.id] for a in active if mapping.get(a.id) is None or mapping[a.id].is_gap]
    year_ends = sorted({*ledger.prior_year_ends, ledger.prior_year_end})
    pnl_blocks: dict[str, Block] = {}
    bs_blocks: dict[str, Block] = {}
    for a in active:
        m = mapping.get(a.id)
        if m is None or m.is_gap:
            continue
        cat = cats[m.category]
        if cat.statement == "pnl":
            # Credit positive. A trial balance at a year end gives that full year for P&L accounts.
            sign = -1
            values = {d: round(sign * ledger.movement(a.id, d), 2) for d in ledger.months}
            cash_flow = None
        else:
            sign = -1 if cat.section in CREDIT_SECTIONS else 1
            values = {d: round(sign * ledger.closing(a.id, d), 2) for d in ledger.months}
            cash_flow = cash_flow_class(a, cat.key, cats, m.cash_flow)
        priors = {ye: round(sign * ledger.closing(a.id, ye), 2) for ye in year_ends}
        opening = round(sign * ledger.closing(a.id, ledger.opening_year_end), 2) if ledger.opening_year_end else 0.0
        blocks = pnl_blocks if cat.statement == "pnl" else bs_blocks
        blocks.setdefault(cat.key, Block(cat.key, cat.label)).lines.append(
            Line(a, cat.key, values, priors, opening, cash_flow))

    order = {k: c.order for k, c in cats.items()}
    for b in (*pnl_blocks.values(), *bs_blocks.values()):
        b.lines.sort(key=lambda l: (l.account.code or "zzz", l.account.name))
    return Model(months=ledger.months, fy_months=ledger.fy_months, prior_year_end=ledger.prior_year_end,
                 prior_year_ends=list(ledger.prior_year_ends), opening_year_end=ledger.opening_year_end,
                 pnl=sorted(pnl_blocks.values(), key=lambda b: order[b.category]),
                 bs=sorted(bs_blocks.values(), key=lambda b: order[b.category]),
                 gaps=gaps, categories=dict(cats))

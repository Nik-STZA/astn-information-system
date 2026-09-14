"""Statement model: pure data, no Excel.

The workbook is written from this model with formulas, and the controls compare
this model with Xero's own reports, so the two views of the numbers are checked
against each other and against Xero.

Presentation signs: on the P&L, income is positive and costs negative (credit
positive). On the balance sheet, assets are positive and liabilities and equity
are shown as positive amounts (credit positive).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .ledger import Account, Ledger
from .mapping import BY_KEY, CATEGORIES, Mapping


@dataclass
class Line:
    account: Account
    category: str
    values: dict[date, float]                 # presentation sign
    prior: float = 0.0                        # P&L: prior FY total; BS: prior year-end balance


@dataclass
class Block:
    category: str
    lines: list[Line] = field(default_factory=list)

    @property
    def label(self) -> str:
        return BY_KEY[self.category].label

    def total(self, month: date) -> float:
        return round(sum(l.values.get(month, 0.0) for l in self.lines), 2)

    def prior_total(self) -> float:
        return round(sum(l.prior for l in self.lines), 2)


@dataclass
class Model:
    months: list[date]
    fy_months: list[date]
    prior_year_end: date
    pnl: list[Block]
    bs: list[Block]
    gaps: list[Mapping]

    # --- profit and loss --------------------------------------------------------
    def _pnl_sum(self, month: date | None, sections: set[str] | None = None) -> float:
        total = 0.0
        for b in self.pnl:
            if sections is None or BY_KEY[b.category].section in sections:
                total += b.prior_total() if month is None else b.total(month)
        return round(total, 2)

    def net_profit(self, month: date) -> float:
        return self._pnl_sum(month)

    def net_profit_ytd(self, month: date) -> float:
        return round(sum(self.net_profit(m) for m in self.months if m <= month), 2)

    def prior_net_profit(self) -> float:
        return self._pnl_sum(None)

    # --- balance sheet ----------------------------------------------------------
    def _bs_sum(self, month: date | None, sections: set[str]) -> float:
        total = 0.0
        for b in self.bs:
            if BY_KEY[b.category].section in sections:
                total += b.prior_total() if month is None else b.total(month)
        return round(total, 2)

    def assets(self, month: date | None) -> float:
        return self._bs_sum(month, {"fixed_assets", "current_assets"})

    def liabilities(self, month: date | None) -> float:
        return self._bs_sum(month, {"creditors_lt1y", "creditors_gt1y", "provisions"})

    def current_year_earnings(self, month: date | None) -> float:
        return self.prior_net_profit() if month is None else self.net_profit_ytd(month)

    def equity(self, month: date | None) -> float:
        return round(self._bs_sum(month, {"equity"}) + self.current_year_earnings(month), 2)

    def net_assets(self, month: date | None) -> float:
        return round(self.assets(month) - self.liabilities(month), 2)


# Balance sheet sections whose accounts are credit-natural (shown as positive credits).
CREDIT_SECTIONS = {"creditors_lt1y", "creditors_gt1y", "provisions", "equity"}


def build_model(ledger: Ledger, mapping: dict[str, Mapping]) -> Model:
    active = ledger.active_accounts()
    gaps = [mapping[a.id] for a in active if mapping.get(a.id) is None or mapping[a.id].is_gap]
    pnl_blocks: dict[str, Block] = {}
    bs_blocks: dict[str, Block] = {}
    for a in active:
        m = mapping.get(a.id)
        if m is None or m.is_gap:
            continue
        cat = BY_KEY[m.category]
        if cat.statement == "pnl":
            # Credit positive; monthly movement; prior = prior FY to date at its year end.
            values = {d: round(-ledger.movement(a.id, d), 2) for d in ledger.months}
            prior = round(-ledger.closing(a.id, ledger.prior_year_end), 2)
            pnl_blocks.setdefault(cat.key, Block(cat.key)).lines.append(Line(a, cat.key, values, prior))
        else:
            sign = -1 if cat.section in CREDIT_SECTIONS else 1
            values = {d: round(sign * ledger.closing(a.id, d), 2) for d in ledger.months}
            prior = round(sign * ledger.closing(a.id, ledger.prior_year_end), 2)
            bs_blocks.setdefault(cat.key, Block(cat.key)).lines.append(Line(a, cat.key, values, prior))

    order = {c.key: c.order for c in CATEGORIES}
    sort_lines = lambda b: sorted(b.lines, key=lambda l: (l.account.code or "zzz", l.account.name))
    for b in (*pnl_blocks.values(), *bs_blocks.values()):
        b.lines = sort_lines(b)
    return Model(months=ledger.months, fy_months=ledger.fy_months, prior_year_end=ledger.prior_year_end,
                 pnl=sorted(pnl_blocks.values(), key=lambda b: order[b.category]),
                 bs=sorted(bs_blocks.values(), key=lambda b: order[b.category]),
                 gaps=gaps)

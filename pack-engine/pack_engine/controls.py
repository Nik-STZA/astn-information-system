"""Controls. A failed control does not stop the file being written; it puts
"FAILED CONTROLS" in the file name and the reason on the Controls tab, because a
pack that is wrong in a known way is more useful to review than no pack.

Ties to Xero use Xero's own P&L and balance sheet reports, fetched separately
from the trial balances the pack is built from, and compare TOTALS only: Xero's
P&L merges some accounts into one line (STZA 498 and 499 appear as "Foreign
Currency Gains and Losses"), so account-by-account comparison would be wrong.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta

from .fiscal import date_label, month_end, month_label
from .ledger import Ledger, report_rows
from .model import Model

TOLERANCE = 0.005


@dataclass
class Control:
    key: str
    label: str
    status: str                 # pass | warn | fail
    expected: float | None = None
    actual: float | None = None
    detail: str = ""

    @property
    def difference(self) -> float | None:
        if self.expected is None or self.actual is None:
            return None
        return round(self.actual - self.expected, 2)

    def as_dict(self) -> dict:
        d = asdict(self)
        d["difference"] = self.difference
        return d


def _tie(key, label, expected, actual, detail="") -> Control:
    ok = expected is not None and actual is not None and abs(actual - expected) < TOLERANCE
    return Control(key, label, "pass" if ok else "fail", expected, actual,
                   detail if ok or expected is not None else f"{detail} Xero report has no such total.".strip())


def report_total(report: dict, label: str) -> float | None:
    for _, _, row_label, _, vals in report_rows(report):
        if str(row_label).strip().lower() == label.lower():
            try:
                return float(str(vals[0]).replace(",", "") or 0)
            except (IndexError, ValueError):
                return None
    return None


def mapping_controls(ledger: Ledger, model: Model, mapping: dict | None = None,
                     saved_available: bool = True) -> list[Control]:
    out = []
    if model.gaps:
        names = "; ".join(g.account.label for g in model.gaps)
        out.append(Control("mapping.coverage", "Every account with activity is mapped", "fail",
                           detail=f"Unmapped: {names}"))
    else:
        out.append(Control("mapping.coverage", "Every account with activity is mapped", "pass",
                           detail=f"{len(ledger.active_accounts())} accounts mapped"))
    unknown = ledger.unknown_account_ids()
    out.append(Control("mapping.known_accounts", "Every trial balance account is in Xero's chart of accounts",
                       "fail" if unknown else "pass", detail=", ".join(unknown)))
    out.append(approval_control(ledger, mapping or {}, saved_available))
    return out


def approval_control(ledger: Ledger, mapping: dict, saved_available: bool) -> Control:
    label = "Account mapping approved"
    if not saved_available:
        return Control("mapping.approved", label, "warn",
                       detail="finance-api has no saved mappings to read, so every account was mapped by rule. "
                              "See the Mapping tab.")
    active = ledger.active_accounts()
    waiting = [a for a in active if a.id not in mapping or mapping[a.id].status != "approved"]
    if not waiting:
        return Control("mapping.approved", label, "pass", detail=f"All {len(active)} accounts with activity approved")
    proposed = [a for a in waiting if a.id in mapping and mapping[a.id].status == "proposed"]
    by_rule = [a for a in waiting if a not in proposed]
    parts = []
    if proposed:
        parts.append(f"{len(proposed)} saved but not approved")
    if by_rule:
        parts.append(f"{len(by_rule)} mapped by rule only")
    names = "; ".join(a.label for a in waiting[:12]) + ("; ..." if len(waiting) > 12 else "")
    return Control("mapping.approved", label, "warn",
                   detail=f"{len(active) - len(waiting)} of {len(active)} approved; {', '.join(parts)}. "
                          f"Approve in the portal's Chart of accounts tab: {names}")


def ledger_controls(ledger: Ledger) -> list[Control]:
    out = []
    for d, tb in sorted(ledger.trial_balances.items()):
        ok = (abs(tb.total_debit - tb.total_credit) < TOLERANCE
              and abs(tb.total_ytd_debit - tb.total_ytd_credit) < TOLERANCE
              and not tb.unidentified)
        detail = "" if not tb.unidentified else f"Rows with no Xero account id: {', '.join(tb.unidentified)}"
        out.append(Control(f"tb.balances.{d}", f"Trial balance balances at {date_label(d)}",
                           "pass" if ok else "fail", tb.total_debit, tb.total_credit, detail))
    # Xero's financial year must start where the profile says: in the first month
    # of the year, year-to-date equals the month for every P&L account.
    first = ledger.months[0]
    tb = ledger.trial_balances[first]
    wrong = [ledger.accounts[a].label for a in tb.movement
             if a in ledger.accounts and ledger.accounts[a].is_pnl
             and abs(tb.ytd.get(a, 0.0) - tb.movement.get(a, 0.0)) >= TOLERANCE]
    out.append(Control("xero.financial_year", f"Xero's financial year starts in {first.strftime('%B')}",
                       "fail" if wrong else "pass",
                       detail=("Year to date differs from the month for: " + "; ".join(wrong)) if wrong else
                              "Year to date equals the month for every P&L account in the first month"))
    return out


def xero_tie_controls(api, client: str, entity: str, cal, period: str, model: Model) -> list[Control]:
    pm = model.months[-1]
    out = []
    pl_m = api.profit_and_loss(client, entity, date(pm.year, pm.month, 1), pm)
    pl_y = api.profit_and_loss(client, entity, cal.fy_start(period), pm)
    out.append(_tie("xero.pnl.month", f"Net profit for {month_label(pm)} ties to Xero",
                    report_total(pl_m, "Net Profit"), model.net_profit(pm)))
    out.append(_tie("xero.pnl.ytd", "Net profit for the year to date ties to Xero",
                    report_total(pl_y, "Net Profit"), model.net_profit_ytd(pm)))
    # Every comparative year shown in the pack, not just the latest.
    for ye in model.prior_year_ends:
        start = month_end(ye.year - 1, ye.month) + timedelta(days=1)
        pl = api.profit_and_loss(client, entity, start, ye)
        out.append(_tie(f"xero.pnl.year.{ye}", f"Net profit for the year to {date_label(ye)} ties to Xero",
                        report_total(pl, "Net Profit"), model.net_profit(ye)))
    for as_at in (*model.prior_year_ends, pm):
        bs = api.balance_sheet(client, entity, as_at)
        lbl = date_label(as_at)
        out.append(_tie(f"xero.bs.assets.{as_at}", f"Total assets at {lbl} tie to Xero",
                        report_total(bs, "Total Assets"), model.assets(as_at)))
        out.append(_tie(f"xero.bs.liabilities.{as_at}", f"Total liabilities at {lbl} tie to Xero",
                        report_total(bs, "Total Liabilities"), model.liabilities(as_at)))
        out.append(_tie(f"xero.bs.equity.{as_at}", f"Total equity at {lbl} ties to Xero",
                        report_total(bs, "Total Equity"), model.equity(as_at)))
    return out


def balance_controls(model: Model) -> list[Control]:
    return [_tie(f"bs.balances.{d}", f"Net assets equal total equity at {date_label(d)}",
                 model.equity(d), model.net_assets(d))
            for d in (*model.prior_year_ends, *model.months)]


def formula_controls(rendered) -> list[Control]:
    typed = [f"{s}!{c}" for s, c in rendered.formula_cells
             if not str(rendered.workbook[s][c].value or "").startswith("=")]
    return [Control("workbook.formulas", "Every subtotal and total is a formula",
                    "fail" if typed else "pass",
                    detail=("Typed values at " + ", ".join(typed[:10])) if typed else
                           f"{len(rendered.formula_cells)} total cells checked")]


def failed(controls: list[Control]) -> list[Control]:
    return [c for c in controls if c.status == "fail"]

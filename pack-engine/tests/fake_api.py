"""A fake stza-finance-api serving Xero-shaped reports for a made-up company.

Nothing here is real client data. Movements are given per month per account;
the fake derives trial balances (month movement, YTD / closing), P&L and
balance sheet reports the way Xero lays them out, so the engine is tested
against the same shapes it meets in production.
"""

from __future__ import annotations

from datetime import date


def acct(id_, code, name, klass, type_, rc):
    return {"AccountID": id_, "Code": code, "Name": name, "Class": klass, "Type": type_,
            "ReportingCode": rc, "ReportingCodeName": rc, "Status": "ACTIVE"}


ACCOUNTS = [
    acct("a-rev", "200", "Sales", "REVENUE", "REVENUE", "REV"),
    acct("a-sal", "477", "Salaries", "EXPENSE", "OVERHEADS", "EXP.STF.WAG"),
    acct("a-pen", "481", "Pension", "EXPENSE", "OVERHEADS", "EXP"),
    acct("a-rent", "469", "Rent", "EXPENSE", "OVERHEADS", "EXP.EST.REN"),
    acct("a-tax", "500", "Corporation Tax", "EXPENSE", "OVERHEADS", "EXP.TAX.COR"),
    acct("a-bank", "600", "Bank", "ASSET", "BANK", "ASS"),
    acct("a-deb", "610", "Accounts Receivable", "ASSET", "CURRENT", "ASS.CUR.REC.TRA"),
    acct("a-cred", "800", "Accounts Payable", "LIABILITY", "CURRLIAB", "LIA.CUR.TRA"),
    acct("a-ctp", "830", "Corporation tax provision", "LIABILITY", "CURRLIAB", "LIA.CUR.TAX.COR"),
    acct("a-re", "960", "Retained Earnings", "EQUITY", "EQUITY", "EQU.RET"),
]

# Signed debit minus credit movements. Each month balances.
# Prior year (to 31 Mar 2026): sales 1000, salaries 400, tax 100 -> profit 500,
# banked 500 net of an unpaid tax provision. At the year end Xero shows profit
# as current year earnings, so retained earnings are nil until the year rolls.
PRIOR_YEAR = {"a-rev": -1000.0, "a-sal": 400.0, "a-tax": 100.0, "a-bank": 600.0, "a-ctp": -100.0}
MONTHS = {
    date(2026, 4, 30): {"a-rev": -800.0, "a-sal": 300.0, "a-pen": 30.0, "a-rent": 100.0,
                        "a-bank": 270.0, "a-deb": 150.0, "a-cred": -50.0},
    date(2026, 5, 31): {"a-rev": -900.0, "a-sal": 300.0, "a-pen": 30.0, "a-rent": 100.0,
                        "a-bank": 520.0, "a-deb": -100.0, "a-cred": 50.0},
}
PRIOR_YEAR_END = date(2026, 3, 31)
PNL_IDS = {"a-rev", "a-sal", "a-pen", "a-rent", "a-tax"}


def _cells(label, acct_id, *vals):
    attrs = [{"Value": acct_id, "Id": "account"}] if acct_id else None
    first = {"Value": label, **({"Attributes": attrs} if attrs else {})}
    return {"RowType": "Row", "Cells": [first, *[{"Value": v} for v in vals]]}


class FakeApi:
    def __init__(self, xero_net_profit_offset=0.0, extra_account=None):
        self.offset = xero_net_profit_offset
        self.accounts_list = list(ACCOUNTS) + ([extra_account] if extra_account else [])
        self.calls = []

    # -- helpers ----------------------------------------------------------------
    def _balances(self, as_at: date):
        """(month movement, ytd-or-closing) per account at a month-end."""
        month = MONTHS.get(as_at, PRIOR_YEAR if as_at == PRIOR_YEAR_END else {})
        closing = {}
        for aid, v in PRIOR_YEAR.items():
            if aid not in PNL_IDS or as_at == PRIOR_YEAR_END:
                closing[aid] = closing.get(aid, 0.0) + v
        if as_at > PRIOR_YEAR_END:
            # year rolled: prior year profit sits in retained earnings
            prior_profit = sum(v for k, v in PRIOR_YEAR.items() if k in PNL_IDS)
            closing["a-re"] = closing.get("a-re", 0.0) + prior_profit
            for d, mv in MONTHS.items():
                if d <= as_at:
                    for aid, v in mv.items():
                        closing[aid] = closing.get(aid, 0.0) + v
        return month, closing

    # -- API surface -----------------------------------------------------------
    def accounts(self, client, entity):
        self.calls.append(("accounts",))
        return self.accounts_list

    def trial_balance(self, client, entity, as_at):
        self.calls.append(("tb", as_at))
        month, closing = self._balances(as_at)
        rows, tdr, tcr, tydr, tycr = [], 0.0, 0.0, 0.0, 0.0
        for a in self.accounts_list:
            aid = a["AccountID"]
            m, c = month.get(aid, 0.0), closing.get(aid, 0.0)
            if not m and not c:
                continue
            dr, cr = (m, 0) if m >= 0 else (0, -m)
            ydr, ycr = (c, 0) if c >= 0 else (0, -c)
            tdr, tcr, tydr, tycr = tdr + dr, tcr + cr, tydr + ydr, tycr + ycr
            rows.append(_cells(f"{a['Name']} ({a['Code']})", aid,
                               f"{dr:.2f}" if dr else "", f"{cr:.2f}" if cr else "",
                               f"{ydr:.2f}" if ydr else "", f"{ycr:.2f}" if ycr else ""))
        return {"Rows": [
            {"RowType": "Header", "Cells": [{"Value": "Account"}]},
            {"RowType": "Section", "Title": "Accounts", "Rows": rows},
            {"RowType": "Section", "Title": "", "Rows": [
                {"RowType": "SummaryRow", "Cells": [{"Value": "Total"}, {"Value": f"{tdr:.2f}"},
                                                    {"Value": f"{tcr:.2f}"}, {"Value": f"{tydr:.2f}"},
                                                    {"Value": f"{tycr:.2f}"}]}]}]}

    def profit_and_loss(self, client, entity, start, end):
        self.calls.append(("pl", start, end))
        if end <= PRIOR_YEAR_END:
            net = -sum(v for k, v in PRIOR_YEAR.items() if k in PNL_IDS)
        else:
            net = -sum(v for d, mv in MONTHS.items() if start <= d <= end
                       for k, v in mv.items() if k in PNL_IDS)
        return {"Rows": [{"RowType": "Section", "Title": "", "Rows": [
            {"RowType": "Row", "Cells": [{"Value": "Net Profit"}, {"Value": f"{net + self.offset:.2f}"}]}]}]}

    def balance_sheet(self, client, entity, as_at):
        self.calls.append(("bs", as_at))
        _, closing = self._balances(as_at)
        klass = {a["AccountID"]: a["Class"] for a in self.accounts_list}
        assets = sum(v for k, v in closing.items() if klass.get(k) == "ASSET")
        liabs = -sum(v for k, v in closing.items() if klass.get(k) == "LIABILITY")
        equity = assets - liabs
        row = lambda l, v: {"RowType": "SummaryRow", "Cells": [{"Value": l}, {"Value": f"{v:.2f}"}]}
        return {"Rows": [{"RowType": "Section", "Title": "", "Rows": [
            row("Total Assets", assets), row("Total Liabilities", liabs), row("Total Equity", equity)]}]}

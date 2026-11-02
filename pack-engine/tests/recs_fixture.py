"""A made-up group for the balance sheet recs workbook. All names and figures are
placeholders; no real client data belongs here."""

from __future__ import annotations


def _row(code, name, statement, debit=0, credit=0):
    return {"code": code, "name": name, "statement": statement, "debit": debit, "credit": credit}


def _signed(*roles):
    people = {"prepared": ("Jo Bloggs", "Finance manager", "2026-07-04"),
              "reviewed": ("Sam Example", "Financial controller", "2026-07-05"),
              "approved": ("Nik", "CFO", "2026-07-06")}
    return {r: dict(zip(("name", "position", "date"), people[r])) for r in roles}


def group() -> dict:
    """Alpha is signed and clean except one unreconciled account; Beta is unsigned
    and has a variance on one line, so every state shows in one workbook."""
    return {
        "group": "Placeholder Group",
        "period_end": "2026-06-30",
        "currency": "GBP",
        "attachments": [
            {"ref": "Att-01", "name": "Supplier One invoice.pdf", "url": "https://drive.google.com/file/d/placeholder1"},
            {"ref": "Att-02", "name": "Bank statement June.pdf", "url": "https://drive.google.com/file/d/placeholder2"},
            {"ref": "Att-03", "name": "Accruals working.pdf", "url": ""},
        ],
        "entities": [
            {"key": "alpha", "name": "Alpha Trading Ltd", "trial_balance": {
                "run_at": "2026-07-03T09:15:00+01:00", "source": "Xero via stza-finance-api",
                "rows": [
                    _row("090", "Business bank account", "bs", debit=5000.00),
                    _row("0620", "Prepayments", "bs", debit=900.00),
                    _row("800", "Accounts payable", "bs", credit=1500.00),
                    _row("950", "Share capital", "bs", credit=100.00),
                    _row("960", "Retained earnings", "bs", credit=2300.00),
                    _row("200", "Sales", "pnl", credit=4000.00),
                    _row("400", "Software", "pnl", debit=2000.00),
                    _row("404", "Bank fees", "pnl", debit=0, credit=0),
                ]}},
            {"key": "beta", "name": "Beta Services Ltd", "trial_balance": {
                "run_at": "2026-07-03T09:20:00+01:00", "source": "Xero via stza-finance-api",
                "rows": [
                    _row("090", "Business bank account", "bs", debit=800.00),
                    _row("620", "Prepayments", "bs", debit=300.00),
                    _row("820", "Accruals", "bs", credit=250.00),
                    _row("960", "Retained earnings", "bs", credit=600.00),
                    _row("200", "Sales", "pnl", credit=1000.00),
                    _row("400", "Software", "pnl", debit=750.00),
                ]}},
        ],
        "recs": [
            {"key": "prepayments", "title": "Prepayments", "description": "Prepaid supplier costs",
             "status": "approved", "sign_offs": _signed("prepared", "reviewed", "approved"),
             "entities": [
                 {"entity": "alpha", "gl_code": "0620", "gl_name": "Prepayments", "ledger": 900.00, "comment": "Ties",
                  "lines": [
                      {"item": "Supplier One", "description": "Annual licence", "reference": "INV-1001",
                       "date": "2026-01-10", "attachment": "Att-01", "amount": 1200.00,
                       "amortisation": {"start": "2026-04-01", "end": "2027-03-31", "commenced": "2026-04-15",
                                        "release_to": "Software (400)"}},
                  ]},
                 {"entity": "beta", "gl_code": "620", "gl_name": "Prepayments", "ledger": 300.00,
                  "lines": [
                      {"item": "Supplier Two", "description": "Deposit held", "reference": "INV-2001",
                       "attachment": "Att-01", "amount": 300.00, "note": "Held, no release yet"},
                  ]},
             ]},
            {"key": "bank", "title": "Bank", "description": "Bank accounts to statements",
             "status": "approved", "sign_offs": _signed("prepared", "reviewed", "approved"),
             "entities": [
                 {"entity": "alpha", "gl_code": "090", "gl_name": "Business bank account", "ledger": 5000.00,
                  "lines": [{"item": "Statement balance", "reference": "June", "attachment": "Att-02", "amount": 5000.00}]},
                 {"entity": "beta", "gl_code": "090", "gl_name": "Business bank account", "ledger": 800.00,
                  "support": 800.00, "lines": []},
             ]},
            {"key": "accruals", "title": "Accruals", "description": "Accrued costs",
             "status": "prepared", "sign_offs": _signed("prepared"),
             "entities": [
                 {"entity": "beta", "gl_code": "820", "gl_name": "Accruals", "ledger": -250.00,
                  "comment": "Audit fee estimate to be agreed",
                  "lines": [
                      {"item": "Audit fee", "description": "Estimate", "attachment": "Att-03", "amount": -200.00},
                      {"item": "Sundry", "description": "No document yet", "amount": -25.00},
                  ]},
             ]},
        ],
    }


def complete_group() -> dict:
    """Every account reconciled, signed, and nil variance."""
    g = group()
    g["entities"] = [g["entities"][0]]
    rows = g["entities"][0]["trial_balance"]["rows"]
    g["recs"] = [g["recs"][0], g["recs"][1]]
    for rec in g["recs"]:
        rec["entities"] = [e for e in rec["entities"] if e["entity"] == "alpha"]
    extra = []
    for t in rows:
        if t["statement"] == "bs" and t["code"] not in ("0620", "090"):
            net = t["debit"] - t["credit"]
            extra.append({"entity": "alpha", "gl_code": t["code"], "gl_name": t["name"], "ledger": net,
                          "lines": [{"item": "Listing", "attachment": "Att-03", "amount": net}]})
    g["recs"].append({"key": "other", "title": "Other balances", "status": "approved",
                      "sign_offs": _signed("prepared", "reviewed", "approved"), "entities": extra})
    return g

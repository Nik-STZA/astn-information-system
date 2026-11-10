# Pack engine

A client-neutral management pack build. STZA is the pilot client; Feldspar stays
on the legacy pipeline (`stza-xero-reporting`) until the engine matches it.

```
calendar -> ledger -> mapping -> statement model -> workbook -> controls
```

| Module | Does |
|---|---|
| `fiscal.py` | Financial-year calendar for any year end (STZA: 31 March, so FY27 is April 2026 to March 2027) |
| `api.py` | Reads Xero only through stza-finance-api. The engine never holds Xero credentials |
| `ledger.py` | One trial balance per month-end, plus the prior year end, keyed by Xero AccountID |
| `mapping.py` | Puts each account in a pack category by rule, recording why. Approved mappings from finance-api will replace the rules at `resolve_mapping` |
| `model.py` | Profit and loss and balance sheet figures, as data |
| `render.py` | The workbook. The only typed numbers are on "Source - Trial balance"; every statement figure and total is a formula, and rows are found by what they are, never by number |
| `recs.py` | Balance sheet reconciliations workbook, written next to the pack. Off unless `PACK_RECS_JSON` names an input file. See below |
| `controls.py` | Checks that fail the build: mapping coverage, trial balances balance, Xero's financial year matches the profile, the balance sheet balances, net profit and balance sheet totals tie to Xero's own reports, totals are formulas |
| `suppliers.py` | Optional Category > Account > Supplier tabs, with their own controls (see below) |
| `outstanding.py` | Optional outstanding documents summary and list, as at month end (see below) |

A failed control still writes the workbook, with `FAILED CONTROLS` in its name.

## Supplier tabs

Off unless the profile has `"supplier_tabs": {}`, or
`"supplier_tabs": {"categories": ["staff_costs", "establishment"]}` to choose the
categories. By default every cost of sales and overhead category except
depreciation and foreign exchange, which Xero posts without a document.

Each category gets a tab of Actual, PY, Var, Var %, Budget, Var vs Bud and Var %,
by month, YTD and FY, for the category, each account and each supplier. Xero's
/Journals feed is not available to this app, so suppliers are rebuilt from bills,
sales invoices, credit notes, bank transactions and manual journals; accounts come
from the same trial balances as the P&L. Amounts are signed, and only what has
reached the ledger counts: a bill awaiting approval does not. Budget is Xero's
overall budget by account. Where there is none the rows stay blank.

Controls, per month: suppliers sum to each account (this year and each month of
last year), and accounts sum to the P&L. More than 1.00 out on any one account fails
the build, and the "Supplier reconciliation" tab shows it as live formulas. A cost
posted outside those documents (Xero Payroll, Xero Expenses) fails this control until
its cause is dealt with. There is no balancing row.

Document reads and the extra trial balances are paced at about 54 calls a minute
(`READ_INTERVAL` in `api.py`), because finance-api's limiter caps concurrency only.

## What Xero's trial balance means

Verified on STZA's Xero, 14 September 2026. A trial balance dated at a month-end has:

- **Debit / Credit**: that month's movement, for every account.
- **YTD Debit / YTD Credit**: financial year to date for profit and loss accounts, and the closing balance for balance sheet accounts.

Xero's profit and loss report merges some accounts into one line (STZA's 498 and
499 show as "Foreign Currency Gains and Losses"), so ties to Xero compare totals,
never individual accounts.

## Run

```
pip install -r requirements.txt
FINANCE_API_URL=... FINANCE_API_KEY=... python -m pack_engine.build --client stza --period 2026-08 --out ./drafts
```

Exit code 0 when every control passes, 3 when the pack was written but a control failed.
Client settings live in `profiles/<client>.json`; the design moves them into `finance.pack_profiles`.

## Test

```
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/ -q
```

The tests use a fake finance-api serving a made-up company in Xero's report shapes. No real client figures are committed.

## Account mapping

Each account's reporting category is approved in the portal (client > Chart of
accounts) and read from finance-api at build time
(`GET /api/finance/clients/:slug/entities/:entity/account-mapping`, migration 017).
Categories are the standard set in `pack_engine/mapping.py`, which a client can
rename, reorder or switch off, plus categories only that client has. Accounts with
nothing saved fall back to the rules, and the "Account mapping approved" control
warns until every account with activity is approved. finance-api ports the rules
for the portal's suggestions; `tests/mapping_rule_cases.json` is shared by both test
suites so they cannot drift.

## Outstanding documents

Off unless the profile has `"outstanding_documents": {}` (a summary page and the
full list after it) or `{"format": "full_list"}` (the list only). Read from
os.stza.io's register through finance-api
(`GET /api/finance/clients/:slug/outstanding-documents?state=all`, migrations 040
and 041).

As at the pack's month end: items dated on or before it that were still
outstanding that day. One cleared afterwards is listed with its status since; one
cleared on or before the month end is not; candidates and dismissed lines never
are. The list is the only place values are typed. The summary (items, spent,
received and VAT at risk by card holder, concern, company and month) is SUMIFs
over it with exact-match criteria, so a name holding `*` or `?` matches only
itself. Card holders group ignoring case, under the spelling used most.

Items never block a sign-off, so the section cannot fail the build: a failed read,
or a finance-api without the register, leaves it out with a warning on Controls.

## Balance sheet recs

`recs.py` writes a companion workbook for a group and month end. Excel appears only
here, in the pack saved to the client's own drive: there is no ad hoc download and
no portal route. The input shape is documented at the top of `recs.py`; the fixture
in `tests/recs_fixture.py` is a working example. Wiring to the finance-api rec
record replaces the file read in `rec_files`; until then live builds are unchanged.

A rec reads as complete only with three dated sign-offs, no variance, and a ledger
that has not moved since. Anything else is red, and the file name says INCOMPLETE.

Branding, optional in a profile under `branding`: `mode` (`stza` or `client`),
`logo_file` (a bare PNG or JPEG name in `profiles/logos`), and `colours`
(`primary`, `accent`, `band`, as hex). A missing or invalid field falls back to
STZA with a warning on the Recs index.

## Deploy

The Cloud Run Job is deployed by hand from this directory:

```
gcloud run jobs deploy pack-engine --source . --region europe-west1 --project africanstn-research
```

## Not built yet

From the 11 September 2026 design: dashboard, ageing, commentary, the
statutory-format P&L, and a LibreOffice recalculation test in CI.

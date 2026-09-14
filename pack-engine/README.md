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
| `controls.py` | Checks that fail the build: mapping coverage, trial balances balance, Xero's financial year matches the profile, the balance sheet balances, net profit and balance sheet totals tie to Xero's own reports, totals are formulas |

A failed control still writes the workbook, with `FAILED CONTROLS` in its name.

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

## Deploy

The Cloud Run Job is deployed by hand from this directory:

```
gcloud run jobs deploy pack-engine --source . --region europe-west1 --project africanstn-research
```

## Not built yet

From the 11 September 2026 design: dashboard, ageing, commentary, the
statutory-format P&L, and a LibreOffice recalculation test in CI.

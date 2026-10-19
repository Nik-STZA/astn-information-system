# Xero capability register - v0.1

**Date:** 16 October 2026
**Purpose:** Nik's requirement - "all Xero developer API capabilities or more are working", on the portal and the laptop alike. This is the list the phase 0 test harness proves, capability by capability.

## Facts this rests on (verified, not assumed)

- **One Xero app already.** Since 16 Sep 2026 the laptop MCP and finance-api both use the **STZA Finance** app (`8A909173…`). Feldspar_API (`8EA540A6…`) is retired. They hold **separate grants** on that one app.
- **Both grants now have the same 23 scopes.** The portal went from 14 to 23 on 16 Oct 2026 (PR #30) and all four portal entities reconnected the same day. Since PR #31, one reconnect per client updates all of that client's entities.
- **Unavailable to any app created after 2 Mar 2026, laptop included:** `accounting.transactions`, `accounting.reports.read` (broad), and `accounting.journals.read` (no granular replacement). `/Journals` cannot be read by either front end. The portal's `journals` read resource therefore cannot work and should be removed.

## Scope gap (portal grant needs these to match the laptop)

| Scope | Laptop | Portal |
|---|---|---|
| openid, profile, email, offline_access | yes | openid, offline_access only |
| accounting.settings | write | read only |
| accounting.contacts | write | read only |
| accounting.invoices | write | read only |
| accounting.payments | write | read only |
| accounting.banktransactions | write | read only |
| accounting.manualjournals | write | write |
| accounting.attachments | yes | **no** |
| files | yes | **no** |
| assets | yes | **no** |
| accounting.budgets.read, accounting.reports.budgetsummary.read | yes | **no** |
| payroll.settings.read, payroll.payruns.read | yes | **no** |
| report scopes (TB, P&L, BS, aged, bank summary, exec summary) | yes | yes |

Fix: request the laptop's 23 in finance-api; one reconnect covers all five organisations ("Continue with 5 organisations").

## Capability matrix

Status: **L** = laptop tool exists, **P** = portal endpoint exists, **-** = missing. "Tier" is the laptop write tier (`note`, `draft`, `post`, `send`, `settle`, `setup`, `conversion`).

| Area | Capability | Laptop tool | L | P | Tier |
|---|---|---|---|---|---|
| Organisation | org details, actions, users, currencies, branding, CIS | get_organisation, get_organisation_actions, get_users, get_currencies, get_branding_themes, get_cis_settings | L | - | read |
| Settings | chart, tax rates, tracking | get_accounts, get_tax_rates, get_tracking_categories | L | P | read |
| Settings | change settings | upsert_setting | L | - | setup |
| Settings | conversion balances | post_conversion_setup | L | - | conversion |
| Reports | TB, P&L, BS, aged, bank summary | pull_trial_balance, get_profit_and_loss, get_balance_sheet, get_aged_*, get_bank_balances | L | P | read |
| Reports | executive summary, budget summary, published reports, schedules | get_summary_report, get_report, get_published_reports, get_schedule_data | L | part | read |
| Contacts | read, search, groups | get_contacts, get_contact_by_id, search_contacts, get_contact_groups | L | part | read |
| Contacts | create / update | upsert_contact | L | - | draft |
| Bills & invoices | read, document PDF | get_invoices, get_invoice_by_id, get_invoice_document | L | part | read |
| Bills & invoices | create / update to SUBMITTED | upsert_invoice | L | - | draft |
| Bills & invoices | repeating | upsert_repeating_invoice | L | - | draft |
| Bills & invoices | email to customer | email_invoice | L | - | send |
| Credit notes | read, create, allocate, unallocate | get_credit_notes, upsert_credit_note, allocate_credit, remove_allocation | L | part | draft / settle |
| Payments | read, record, delete | get_payments, record_payment, delete_payment | L | part | settle |
| Prepayments / overpayments | read | get_prepayments, get_overpayments | L | - | read |
| Bank | transactions read / write, transfers | get_bank_transactions, upsert_bank_transaction, get_bank_transfers, create_bank_transfer | L | part | draft / settle |
| Journals | manual journals read / post / status | get_manual_journals, post_journal, post_journal_from_csv, update_journal_status | L | P | draft / post |
| Journals | ledger journals (`/Journals`) | get_journal, get_account_transactions | **blocked by Xero** | - | - |
| Attachments | list, fetch, upload | list_attachments, fetch_attachment, upload_attachment | L | - | draft |
| Files (Documents) | inbox, content, associations, upload, link | get_files, upload_file, associate_file | L | - | draft |
| History | read, add note | get_history, add_history_note | L | read only | note |
| Linked transactions | billable expenses | upsert_linked_transaction | L | - | draft |
| Items, quotes, POs, receipts, expense claims | read | get_items, get_quotes, get_purchase_orders, get_receipts, get_expense_claims | L | - | read |
| Fixed assets | read, create | get_fixed_assets, create_fixed_asset | L | - | draft |
| Payroll (UK) | pay runs, reference data | get_pay_runs, get_payroll_reference | L | - | read |
| Controls | duplicate / bill checks | check_bill | L | - | read |
| Plumbing | connections, entities, credentials | get_connections, list_entities, validate_credentials | L | part | read |

**Summary:** the laptop covers the Xero API this app is allowed; the portal covers reading and reporting plus manual journals, roughly a fifth of it.

## "Or more": what the Xero API cannot do at all

Proven or documented gaps, so nobody plans on them:

| Need | Why not via API | Route |
|---|---|---|
| Receipts, expense claims (`/Receipts`, `/ExpenseClaims`) | 401 on this app, laptop included (16 Oct 2026); retired expenses endpoints | Xero Expenses in the UI |
| Published reports list (`/Reports`) | 401; needs broad `accounting.reports.read` | Named report endpoints |
| Bank reconciliation matching | No API for statement lines or matching | Xero JAX / Nik in Xero (already the rule in `ap-bill-lane`) |
| Ledger journals (`/Journals`) | Scope refused for post-March apps | Rebuild from invoices, bank transactions, payments, manual journals |
| Approve a bill (AUTHORISED) | Possible, but deliberately refused by the write lane | Nik in Xero |
| Period lock dates | Not writable over the API | Nik in Xero (open item 72) |
| MTD VAT return submission | Not in the public API | Xero's own HMRC filing |
| Documents "Match" button | No API equivalent of the UI action | `associate_file` (POST association) |
| Bank feeds, Finance API, Projects, Practice Manager | Separate, mostly partner-restricted APIs | Out of scope unless a need appears |

## Phase 0 test harness (to build)

1. **Same 23 scopes on the portal grant.** Probe the authorize URL first; reconnect once.
2. **finance-api gets an endpoint for every row above**, with the laptop's write tiers, dry runs, confirmation and audit log. The laptop tool then calls that endpoint (one engine).
3. **Harness:** for each row, a read test against a live entity and, for every write, a full create-read-reverse test **in the Xero Demo Company only**. The output is this table with a pass/fail column and a date, for both front ends.
4. **CI parity test:** fails if a laptop tool has no finance-api endpoint, or if a row in this register has no passing test.

## Read results, 16 Oct 2026 (`finance-api/scripts/xero-read-check.js`)

Every read endpoint, called through finance-api on the live service, paced under Xero's rate limit.

| Entity | Pass | Not passing, and why |
|---|---|---|
| STZA | 81/81 | - (STZA runs payroll in Xero; pay run totals and reference data read) |
| Feldspar Group Holdings | 72/80 | 8 payroll: Xero Payroll not provisioned. Expected: Feldspar payroll runs externally and is posted as an imported journal (Nik, 16 Oct 2026) |
| Feldspar Ltd | 74/82 | 8 payroll: same, expected |
| Ultraspeed Digital | 80/91 | 8 payroll: same, expected; 3 = one file Xero lists but answers 404 for |

Each failure was reproduced on the laptop MCP. No read works on the laptop and fails on the portal. **Reads: parity reached.** Next: writes, tested in the Xero Demo Company only.

## Write results, 16 Oct 2026 (note and draft tiers, `finance-api/scripts/xero-write-check.js`)

Run on STZA only, as agreed with Nik: every record in DRAFT, labelled STZA-TEST, deleted by Nik afterwards.

| Capability | Result |
|---|---|
| Contact create, update | pass |
| Contact with bank details | refused, as designed |
| Bill create and update in DRAFT | pass |
| Bill to AUTHORISED, archived account, float amount, duplicate supplier number | refused, as designed |
| Credit note create in DRAFT | pass |
| History note | pass |
| Attachment upload | pass |
| Xero Files upload | pass after PR #35 (multipart boundary made deterministic for idempotent retries) |
| Files association (Documents "Match") | pass; a second association refused |
| Linked transaction (billable expense) | pass |

**Note and draft writes: parity reached.** Next: post, send, settle, setup and conversion, with dry-run confirmation codes. These are not run live without Nik's say-so.

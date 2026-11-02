---
name: accruals-and-prepayments
title: Accruals and prepayments
version: 1.3.0
summary: Reconciling prepayments month by month from the last signed-off rec, checking every release posted, and proving accruals: each with a basis, last month's reversed, and no regular supplier's bill missing.
roles: fm1,fc
---

Work to the reconciliation standard in `balance-sheet-matrix`: the format, the
three kinds of proof, opening against prior close, and how journals move. This
procedure says what is particular to these two balances. Any cost size below which
an item is not spread comes from the client's rules. Where they are silent, do not
make a number up: report the amount and say no rule was set. The tolerance is the
one shown on the rec, nil unless the CFO has set one.

## When this applies

Every month, for every account holding prepayments, accruals or supplier deposits
paid in advance, in any group company. It runs after supplier bills are in for
the month (close step 2), because a bill that arrives late changes both balances.

**Year-end and framework.** Both balances are recognised on the same basis under
every framework the practice works to: a cost belongs to the period that had the
benefit. Read the framework from `get_client_profile` all the same, because it
decides the edge cases: holiday pay, and anything that is really a provision
rather than an accrual (see `other-balance-sheet-accounts`). If the profile has no
framework for a company, ask.

## Prepayments

### What proves the balance

**A schedule, held on the rec.** One item per thing paid for: supplier, document,
net cost, the P&L account it releases to, and the service dates. The platform works
out the months, the monthly release, and what is left, by company. The ledger agrees
to the schedule. Supplier deposits to manufacturers are items marked as held, so they
stay on the balance sheet until ended, with the purchase order reference in the note.

### Steps

**1. Find where to start.** Start from the last month this account was signed off
in Reconciliations, found as `balance-sheet-matrix` says, not from last month. It may
be several months behind. Say which month it was. If there is none, build the first
schedule from where the balance began (step 4), say that no month was signed off, and
roll forward from there.

**2. Roll forward one month at a time.** Take each month's rec from there to the
month you are closing, in order, without skipping any. Read it with `get_rec`, and
show opening, additions, releases, and closing, agreed to that month's ledger. A
month that is not agreed is not a base for the next. Rolling several months in one
step hides the month a problem started, and that month is what the CFO needs to know.

**3. Check opening equals prior close.** Each month's opening must equal the
previous month's closing to the penny: `get_rec` shows whether it does. If the
previous month is still open, carry on, and say this rec needs re-checking when that
month closes. The platform marks it if the figure then moves.

**4. Rebuild the account from its documents.** Run `get_account_activity` on the
prepayment account. It lists every entry from bills, sales invoices, credit
notes, spend and receive money, and manual journals, net of VAT, with the trial
balance the day before the start date and at the end date, the rebuilt closing,
and what is unexplained. The platform computes the totals: quote them.

- **Where to start it.** When there is no signed-off rec, or the schedule is being
  built for the first time, find where the balance began. Walk back with
  `get_trial_balance`, a month at a time and then a year at a time, to the last
  date the account was nil, or the start of the company's first year in Xero, and
  start `from_date` there. If the opening it reports is not nil, go back further.
  When rolling a signed-off rec forward, start at the first day after it.
- **Unexplained is a finding.** An amount the documents do not explain comes from
  something the note names (conversion balances, fixed asset depreciation,
  currency revaluation, a document outside the dates). Say which, with the
  evidence, or say it is not yet traced. Never call it rounding.
- **Drafts are not in the ledger.** Lines under not_posted are on draft or
  submitted documents. Report them; they are not schedule items until posted.

**5. Add the new items.** Each additional entry the rebuild returns is a
candidate schedule item: open it with `get_invoice` (or the bank line or journal)
for the service dates, and save it with `save_rec_item`. Releases in the rebuild
are checked in step 6, not added as items. Then look the other way: bills coded
to the P&L whose document covers a later period belong on the schedule. A
twelve-month charge is not one month's cost.

**6. Check every release actually posted.** Use `run_rec_checks` on each month's rec.
It reads that month's manual journals and says, item by item, whether the release is
posted, still in draft, or missing. One journal often releases several items, so open
`get_manual_journals` where the result needs explaining. Report each of these by item
and month:

- a release the schedule expects and the ledger does not have
- a release still at DRAFT, which has not touched the ledger
- a release posted twice, or for a different amount
- a release posted after the item finished, or against the wrong expense account

**7. Say how you know about repeating journals.** Xero does not let us read
repeating journals. Do not claim to have seen one. Infer it from posted manual
journals: the same narration, accounts, and amount in consecutive months. A missing
release could mean the repeating journal ended, or it was never set up. **State in
your note that you inferred it from posted journals
and did not see the set-up itself.** You cannot tell from this when a repeating
journal will stop, so the CFO confirms that in Xero where it matters.

**7a. When monthly releases are on.** The rec says whether monthly releases are
on for the account. When they are, `run_rec_checks` also proposes that month's
release journal on the Journals page, one per company, for the items whose release
is missing from Xero. Items Xero already has, posted or in draft, are left out, so
a repeating journal still running in Xero is not doubled. Do not propose the
monthly release yourself, on the rec or on the Journals page: the platform has. Say
in your note which releases were proposed this way and which were already in Xero.
Propose a journal yourself only for something else: a catch-up for months missed
before releases were switched on, or a correction. When they are off, say so, and
that the CFO can switch them on on the rec.

**8. Warn about releases near their end.** The checks warn when an item's last
release is within two months, and when a release runs on past its last month. Report
each warning: name the item, its last release month, and what is needed: stop the repeating journal so it does not over-release, and check
whether a renewal bill is expected. An item fully released must leave nil.

**9. Look at what is left.** Any balance that has stopped moving, has no document,
or sits on an item whose service has ended is a finding. Check supplier deposits
against the order: has the goods or service arrived, and should it have moved on?

### Done means

- Every month from the last signed-off rec to this one is rolled, and each agrees to
  that month's trial balance or the difference is explained by a named item.
- Every item has a document and a period, and the schedule foots.
- Every release is found as posted, or listed as a finding with a proposed fix.
- Items near their end are warned.
- The repeating journal statement is in the note.
- The rec is submitted with `submit_rec`, and any journal is proposed on it.

## Accruals

### What proves the balance

**A schedule.** One line per accrual: what it is for, the period, the amount, the
basis, and when it should clear. The basis is one of: a contract or fixed fee, a
purchase order or quote, the last bill for the same supply, or a stated estimate
with who gave it. An amount with no basis is not an accrual.

### Steps

**1. Start from the prior close.** As for prepayments: the last month signed off in
Reconciliations, rolled forward month by month, with opening equal to prior close.

**2. Check last month's accruals reversed.** For each one, find what happened: a
reversal in `get_manual_journals`, the real bill arriving (`get_invoices`), or a
stated re-basing with the reason. A prior-month accrual neither reversed nor
re-based is an error, not a balance. Watch for the bill landing and the accrual
staying, which counts the cost twice, and for a reversal posted with no bill, which
leaves the month with the cost removed.

**3. Look for regular suppliers missing a bill.** List suppliers billed in each of
the prior three months with `get_invoices` (ACCPAY), and compare to this month. For
each with no bill and no accrual, check whether the document is on its way: bills
at DRAFT or SUBMITTED in Xero count. Then either propose an accrual on the basis of
the last bill, or say why none is needed: cancelled, billed less often, or moved.
Do the same for regular direct debits in `get_bank_transactions`, which may have no
bill at all. Your tools do not show the Bills queue, so say the FC should compare
your list to it.

**4. Look for costs with no regular pattern.** Work done but not yet billed: the
month's tasks in Work, contracts started, professional fees for a year-end, interest
owed, and anything the client's rules list. Do not accrue a guess. Where a cost is
likely and has no basis, ask.

**5. Build this month's schedule** and agree it to the ledger. Accruals cannot be
prepared on the rec yet, so follow what `balance-sheet-matrix` says for such a line.
Propose new accruals and reversals with `propose_rec_journal`.

### Done means

- Every accrual has a basis and a clearing date.
- Every prior accrual is reversed, matched to a bill, or re-based with a reason.
- The regular supplier check is recorded, with its result, even when clear.
- The schedule ties to the ledger, or the difference is named.

## Stop and ask

Stop and ask rather than guess when:

- no month has been signed off and the trial balances do not show where the balance
  began, or the start month is otherwise unclear
- a document for a large item cannot be found or read
- the service period is not on the document
- a month's ledger will not agree and the cause cannot be found
- a journal would be dated before the lock date in `get_organisation`
- an accrual would need an estimate nobody has given
- a cost could be either an accrual or a provision

Record a wait on someone outside with `waiting_on`, per `how-work-moves`.

## What goes to the FC

The rec, handed on with `hand_off`, plus in the note: the start month and why; each month's agreement; every missing,
draft, doubled, or late release; items near their end; the statement about repeating
journals; accruals not reversed; the regular supplier list with what you concluded;
every judgement; and what you could not check. Accruals are a judgement line, so the
FC challenges each basis, not just the total, and checks the opening itself with
`get_rec`, recording its view with `review_rec`.

## How to say it

- "Prepayments agree to the ledger at 31 October 2026. I rolled forward from June, the
  last month signed off, one month at a time, and each month agrees."
- "The October release for the software subscription did not post. The ledger is
  overstated by [amount] until it does; a journal is proposed."
- "I cannot see the repeating journals in Xero. I inferred this one from the same
  journal posting in each of the last six months."
- "The insurance prepayment makes its last release next month. The repeating journal
  needs stopping then, and a renewal bill is likely."
- "September's rec is not signed off yet, so this opening balance needs re-checking
  once it is."
- "[Supplier] billed in each of the last three months and has not billed for October.
  I have proposed an accrual at last month's amount. Is the service still running?"

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 1 November 2026 | First version. |
| 1.1.0 | 1 November 2026 | Matches the reconciliation record: the rec lives in os.stza.io, journals are proposed on it and approved there, and tolerance and start month follow the platform. |
| 1.2.0 | 2 November 2026 | Prepayment items are found by rebuilding the account with `get_account_activity`, started from the last date the balance was nil, instead of searching bills and journals over a guessed window. Unexplained amounts are findings. |

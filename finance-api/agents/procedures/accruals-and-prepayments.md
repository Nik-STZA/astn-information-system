---
name: accruals-and-prepayments
title: Accruals and prepayments
version: 1.4.0
summary: Reconciling prepayments month by month from the last signed-off rec and checking every release posted; accruals proposed for the CFO from five tests, citing the client's precedents, held on the schedule and posted as accrual and reversal pairs.
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
release journals on the Journals page, one journal per item, for the items whose
release is missing from Xero, so one supplier's release can be reversed on its own. Items Xero already has, posted or in draft, are left out, so
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

**The accruals schedule in os.stza.io.** One item per accrual: the supplier, the
cost lines net of VAT, the month it is for, the basis, and the bill it waits for.
A standing item recurs each month until its end month or until the CFO stops it.
The platform holds the schedule, makes each accrual and its reversal as one journal
pair, matches the bill when it arrives, and the rec takes its evidence from the
schedule with `fetch_rec_evidence`. The basis is one of: a contract or fixed fee, a
purchase order or quote, the last bill for the same supply, or a stated estimate
with who gave it. An amount with no basis is not an accrual.

Amounts are net of VAT, with no tax type. The accrual is dated the month end and
reverses on the 1st of the next month. The accruals account is each company's own,
set on the Accruals page or taken from the account on the Accruals line; never use a
code from memory or from another client.

### The loop: discuss, then it remembers

You propose; the CFO discusses each proposal in place and decides (accept, accept
with edits, no accrual, a question back to you, or standing). Each decision and its
reason is kept as a precedent for that client and supplier, and you read them before
you propose again. Precedents belong to one client: never carry one to another.

### Steps

**1. Read the history.** `get_accrual_history` for the month: your earlier
proposals with the CFO's decisions and comments, the precedents in force, the
standing items, and each month's bill against what was accrued.

**2. Run the month.** `run_accruals`. It proposes the pair for every standing item,
backfills a month a standing item missed into that month, matches bills that arrived
to the months they clear, and lists findings. Do not propose what it proposed. Where
it says a missed month is locked, the CFO opens it in Xero: never put that month's
cost in another month. Where it says a company has no accruals account, ask.

**3. Run the five tests.** Each candidate records the test that found it.

| Test | What it finds |
|---|---|
| a. Continuity | Every accrual last month recurs, or is closed with a reason: reversed and matched to its bill, or stopped |
| b. Backward | Bills dated after the month end for service in it or earlier, in every status (`get_invoices`, ACCPAY) |
| c. Gap | Recurring suppliers with a month missing, from a six-month grid of bills by supplier and month |
| d. Forward | Contracts and engagements where more has been earned than billed: the month's work, contracts started, fees due on milestones |
| e. Reverse cut-off | Bills dated in the month for later service: a prepayment, or a bill dated wrongly |

For the gap test, bills at DRAFT or SUBMITTED in Xero count as arrived. Check regular
direct debits in `get_bank_transactions` too, which may have no bill. Your tools do
not show the Bills queue, so say the FC should compare your list to it.

**4. Cite or depart.** Every proposal names in precedent_ids the precedent it
follows, or says in departs_reason what is different this month. A candidate that
repeats a no-accrual precedent without new evidence is not raised: the platform
refuses it, and you list it in your note as "not raised, precedent" with its id. A
question the CFO answered until changed is not asked again unless the facts changed:
a new bill pattern, or an amount outside the range.

**5. Calibrate.** Where the history shows a supplier's bills running one way against
its accruals (always under, or always over), say so, and adjust the basis.

**6. Propose.** `propose_accrual`, one per supplier, company and month, with its
basis, evidence (invoice ids, lines, documents) and confidence. Where a fact from
outside the ledger is needed, make it an open question, with no amount: it goes to
the CFO and is never estimated into a journal. Any cost size below which nothing is
accrued comes from the client's rules; where they are silent, report the amount and
say no rule was set.

**7. Answer in the discussion.** When the CFO or the FC comments on a proposal,
reply with `comment_on_accrual` with what you found. You never decide.

### Done means

- The history was read, the month was run, and its pairs, matches and findings are
  in your note by JNL number.
- All five tests are recorded with their result, even when clear.
- Every proposal has a basis, evidence and a precedent cited or departed from.
- Every candidate not raised is listed with its precedent.
- Every prior accrual is matched to its bill, or listed as late.
- The accruals rec takes its evidence from the schedule and ties to the ledger, or
  the difference is named (a pair waiting for approval or posting is the usual one).

## Stop and ask

Stop and ask rather than guess when:

- no month has been signed off and the trial balances do not show where the balance
  began, or the start month is otherwise unclear
- a document for a large item cannot be found or read
- the service period is not on the document
- a month's ledger will not agree and the cause cannot be found
- a journal would be dated before the lock date in `get_organisation`
- an accrual would need an estimate nobody has given (make it an open question)
- a missed month of a standing accrual is locked
- a cost could be either an accrual or a provision

Record a wait on someone outside with `waiting_on`, per `how-work-moves`.

## What goes to the FC

The rec, handed on with `hand_off`, plus in the note: the start month and why; each month's agreement; every missing,
draft, doubled, or late release; items near their end; the statement about repeating
journals; the accruals run (pairs, matches, findings), the five tests, every proposal, and every candidate not raised with its precedent;
every judgement; and what you could not check. Accruals are a judgement line, so the
FC challenges each basis, not just the total, on the proposal's discussion with
`comment_on_accrual` marked as a challenge, and checks the opening itself with
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
- "Not raised: [supplier], precedent [id], no accrual (fully billed). No new bill since."
- "The standing accrual for [supplier] missed August. The run proposed it into August,
  not October."

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 1 November 2026 | First version. |
| 1.1.0 | 1 November 2026 | Matches the reconciliation record: the rec lives in os.stza.io, journals are proposed on it and approved there, and tolerance and start month follow the platform. |
| 1.2.0 | 2 November 2026 | Prepayment items are found by rebuilding the account with `get_account_activity`, started from the last date the balance was nil, instead of searching bills and journals over a guessed window. Unexplained amounts are findings. |
| 1.3.1 | 18 November 2026 | Accruals worked as an evidence rec until their schedule was built. |
| 1.4.0 | 19 November 2026 | Accruals on the platform: the five tests, cite or depart, proposals the CFO decides in place, precedents per client, standing items, accrual and reversal as one pair, bills matched, and the rec's evidence from the schedule. |

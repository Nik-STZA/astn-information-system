---
name: accruals-and-prepayments
title: Accruals and prepayments
version: 1.0.0
summary: Reconciling prepayments month by month from the last signed-off rec, checking every release posted, and proving accruals: each with a basis, last month's reversed, and no regular supplier's bill missing.
roles: fm1,fc
---

Work to the reconciliation standard in `balance-sheet-matrix`: the format, the
three kinds of proof, opening against prior close, and how journals move. This
procedure says what is particular to these two balances. Tolerances, release
basis and any cost size below which an item is not spread come from the client's
rules. Where the rules are silent, do not make a number up: report the amount and
say no rule was set.

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

**A schedule.** One line per item, carrying: supplier, document, total paid, the
service period, the monthly release, released to date, and what is left. The
ledger agrees to the schedule. Supplier deposits to manufacturers are kept as
their own class with the purchase order reference.

### Steps

**1. Find where to start.** Start from the last month the CFO signed off, not from
last month. The latest real reconciliation may be several months behind. Take that
month's closing schedule as the opening position and say which month it was. If
you cannot find a signed-off schedule, stop (see below).

**2. Roll forward one month at a time.** Work every month from there to the month
you are closing, in order, without skipping any. For each month show opening,
additions, releases and closing, and agree the closing to that month end's trial
balance with `get_trial_balance` for that date. A month that is not agreed is not
a base for the next. Rolling several months in one step hides the month a problem
started, and that month is what the CFO needs to know.

**3. Check opening equals prior close.** Each month's opening must equal the
previous month's closing to the penny. If the previous month is still open, not
yet signed off, carry on and mark this rec **to re-check** once it is signed off.

**4. Add the month's new items.** Use `get_invoices` and `get_invoice` for bills
coded to the prepayment account, plus `get_bank_transactions`,
`get_credit_notes` and `get_manual_journals`. Each new item goes on the schedule
with its service period, taken from the document. Then look the other way: bills
coded to the P&L whose document covers a later period belong on the schedule. A
twelve-month charge is not one month's cost.

**5. Check every release actually posted.** For each item and each month, find the
release in `get_manual_journals` with status POSTED, and compare the amount and
accounts to the schedule. Report each of these by item and month:

- a release the schedule expects and the ledger does not have
- a release still at DRAFT, which has not touched the ledger
- a release posted twice, or for a different amount
- a release posted after the item finished, or against the wrong expense account

**6. Say how you know about repeating journals.** Xero's repeating journal set-up
may not be readable through this platform's connection. Do not claim to have seen
it. Infer it from posted manual journals: the same narration, accounts, and amount
in consecutive months. **State in your rec that you inferred it from posted journals
and did not see the set-up itself.** You cannot tell from this when a repeating
journal will stop, so the CFO confirms that in Xero where it matters.

**7. Warn about releases near their end.** For each item whose last release falls
within the warning window in the client's rules, say so, or use this month and next
where no window is set and say you did. Name the item, its last release month, and
what is needed: stop the repeating journal so it does not over-release, and check
whether a renewal bill is expected. An item fully released must leave nil.

**8. Look at what is left.** Any balance that has stopped moving, has no document,
or sits on an item whose service has ended is a finding. Check supplier deposits
against the order: has the goods or service arrived, and should it have moved on?

### Done means

- Every month from the last signed-off rec to this one is rolled, and each agrees to
  that month's trial balance or the difference is explained by a named item.
- Every item has a document and a period, and the schedule foots.
- Every release is found as posted, or listed as a finding with a proposed fix.
- Items near their end are warned.
- The repeating journal statement is in the rec.

## Accruals

### What proves the balance

**A schedule.** One line per accrual: what it is for, the period, the amount, the
basis, and when it should clear. The basis is one of: a contract or fixed fee, a
purchase order or quote, the last bill for the same supply, or a stated estimate
with who gave it. An amount with no basis is not an accrual.

### Steps

**1. Start from the prior close.** As for prepayments: the last signed-off month,
rolled forward month by month, with opening equal to prior close. Mark the rec
**to re-check** if the prior month is still open.

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

**5. Build this month's schedule** and agree it to the ledger. Propose new accruals
and reversals per the journal steps in `balance-sheet-matrix`.

### Done means

- Every accrual has a basis and a clearing date.
- Every prior accrual is reversed, matched to a bill, or re-based with a reason.
- The regular supplier check is recorded, with its result, even when clear.
- The schedule ties to the ledger, or the difference is named.

## Stop and ask

Stop and ask rather than guess when:

- there is no signed-off schedule to start from, or the start month is unclear
- a document for a large item cannot be found or read
- the service period is not on the document
- a month's ledger will not agree and the cause cannot be found
- a release would land in a period before the lock date in `get_organisation`
- an accrual would need an estimate nobody has given
- a cost could be either an accrual or a provision

Record a wait on someone outside with `waiting_on`, per `how-work-moves`.

## What goes to the FC

The rec, plus: the start month and why; each month's agreement; every missing,
draft, doubled, or late release; items near their end; the statement about repeating
journals; accruals not reversed; the regular supplier list with what you concluded;
every judgement; and what you could not check. Accruals are a judgement line, so the
FC challenges each basis, not just the total, and re-runs the opening check itself.

## How to say it

- "Prepayments agree to the ledger at 31 October 2026. I rolled forward from the last
  signed-off rec, June, one month at a time, and each month agrees."
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

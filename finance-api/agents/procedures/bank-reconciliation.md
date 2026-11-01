---
name: bank-reconciliation
title: Bank reconciliation
version: 1.0.0
summary: Proving every bank, card, deposit and payment provider account to its statement at the month end, with unreconciled lines listed and aged.
roles: fm1,fc
---

Work to the reconciliation standard in `balance-sheet-matrix`: the format, the
three kinds of proof, opening against prior close, and how journals move. This
procedure says what is particular to cash. Tolerances come from the client's
rules. Where the rules are silent, a difference is reported at its full amount
and never called small.

## When this applies

Every month, for every account in `get_chart_of_accounts` that holds money or
money in transit, in every group company: current, deposit, savings and foreign
currency accounts, credit cards, payment providers, merchant accounts, and any
clearing account between them. An account with a nil ledger balance but a
statement showing money is in scope; so is a dormant account that is still open.

Each account has one owner company, so the cover shows that company's ledger. Where
the same bank GL account appears in several companies, it is one rec with one row each.

## What proves the balance

**Outside evidence: the statement from the bank or provider at the month end.**
The ledger never proves itself, and neither does a list of reconciled lines.

The closing balance on the statement has to reach you as a document: attached to a
record in Xero, or given by a person in the conversation. This platform's connection
does not read the statement balance from Xero's bank feed. `get_bank_summary` and
`get_trial_balance` give the ledger side only.

## Steps

1. **List the accounts** and pull each ledger balance from `get_trial_balance` at
   the month end. Agree them to `get_bank_summary`, and explain any difference.
2. **Get the statement** closing balance and date for each. It must be the month-end
   date, or a later statement showing the balance at that date. Open it with
   `read_attachment`. If it is not there, record the wait (see below).
3. **Check opening equals prior close** per the standard, and mark the rec **to
   re-check** if the prior month is still open.
4. **List what is not reconciled.** Use `get_bank_transactions` and `get_payments`,
   which say whether each line is reconciled, for the month and earlier. Note that
   bank transfers between accounts are not listed by these tools, so say whether
   any are in the difference.
5. **Build the reconciliation.** Statement balance, less payments in the ledger
   not yet on the statement, plus receipts in the ledger not yet on the statement,
   plus or minus statement lines not yet in the ledger, equals the ledger balance.
   Show each line with its date, amount and age.
6. **Investigate old items.** Anything over a month old is investigated, not carried.
   Open the line, its document and `get_history`. Say what it is, and what clears it.
7. **Look at last month's list.** Each item cleared this month, or is still listed.
   An item that dropped off without clearing is a finding.
8. **Look for what should not be there:** a duplicated line, the same receipt both
   coded and matched to an invoice, a transfer booked on one side only, a clearing
   account that does not return to nil, and an account going the wrong way.
9. **Foreign currency accounts:** reconcile in the account's own currency first,
   then show the reporting currency at the closing rate and name the rate's source.
10. **Bank against registers.** Run the control in `balance-sheet-matrix`: any
    payment over the client's threshold that matches no register row is raised by
    name. If the client has set no threshold, say the control was not run and why.

Do not touch the bank side. Reconciling lines in Xero, and matching bank lines to
bills, is done by a person. A journal is proposed only for something truly missing
from the ledger, such as bank interest or charges, never to force agreement.

## Done means

- Every account has a statement balance at the month end, or a named exception.
- The reconciliation arrives at the ledger balance, with the difference shown.
- Every unreconciled line is listed with its age.
- Anything over a month old has a cause and a next step.
- Last month's items are all accounted for.

## Stop and ask

Stop and ask rather than guess when:

- a statement is missing: record the wait with `waiting_on` and a chase date, name
  the account, and mark it not proved. The rest of the accounts carry on
- the statement date is not the month end and no balance at that date can be seen
- a statement cannot be opened or read
- the difference cannot be traced to lines
- an account is on a statement or in a bank line but not in the chart
- a payment looks like it went to the wrong person, or was not authorised: raise it
  with the CFO and do not put the detail in a note others can read
- an account's ledger balance suggests money is missing

## What goes to the FC

The rec for each account, plus: which statements were seen and their dates; which
were not; the unreconciled list with ages; old items with causes; movement against
last month's list; and any journal suggested. The FC opens at least the statement
for each account itself and re-runs the sum from statement to ledger.

## How to say it

- "The current account agrees to the bank statement at 31 October 2026. Three payments
  totalling [amount] have left the ledger and not yet reached the statement; all are
  from the last two days of the month."
- "No statement for the deposit account, so it is not proved. I have asked for it and
  will chase on 5 November 2026."
- "A receipt of [amount] from August is still unreconciled. It looks like a customer
  payment coded twice; the bank line's history in Xero shows it was edited in September."
- "I could not see the bank feed's balance, so this rests on the PDF statement I was
  given."

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 1 November 2026 | First version. |

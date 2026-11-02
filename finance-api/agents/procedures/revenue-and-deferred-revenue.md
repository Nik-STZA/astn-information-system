---
name: revenue-and-deferred-revenue
title: Revenue and deferred revenue
version: 1.1.0
summary: Rolling deferred income forward by contract, tying billing to revenue, proving accrued income, and applying the client's reporting framework, including the FRS 102 changes from 2026.
roles: fm1,fc
---

Work to the reconciliation standard in `balance-sheet-matrix`: the format, the
three kinds of proof, opening against prior close, and how journals move. This
procedure says what is particular to revenue. The client's revenue policy comes
from the client's rules. The tolerance is the one shown on the rec, nil unless the
CFO has set one.

Use the words the matrix sets: **deferred income** for billed and not yet earned,
**accrued income** (or contract asset) for earned and not yet billed, and **customer
deposits** for money held against an order. Customer deposits are reconciled under
`other-balance-sheet-accounts`. Never call anything income received in advance.

## When this applies

Every month, for every deferred income, accrued income and contract asset account,
in any group company, after sales invoices are raised (close step 3). A company with
no such balance still checks cut-off and looks for items that should be deferred.

## What proves the balance

**A schedule by contract or customer.** For deferred income: contract, invoice, total,
the period or the thing to be delivered, released to date, and what is left. For
accrued income: contract, what was delivered, the amount, and when it will be billed.

Release is driven by the schedule, and never plugged to reach a balance. Where a
billing system exists, its report is outside evidence for billings, and it ties to
the ledger, as the AR Clerk's work should show.

## Steps

1. **Start from the prior close.** The last month signed off in Reconciliations,
   rolled forward month by month without skipping, opening equal to prior close.
2. **Read the terms.** For each new contract, get the terms from the client's rules,
   the invoice and its attachments. What was promised, and when is it delivered?
3. **Add billings.** `get_invoices` and `get_invoice` for the month, ACCREC, with
   `get_credit_notes`. Each line either belongs to the month, or goes on the schedule.
   Look for invoices coded to revenue covering a later period.
4. **Release.** Work out what was earned in the month on the contract's basis.
   Check the release posted in `get_manual_journals`. Xero does not let us read
   repeating journals, so if you rely on a pattern of posted journals, say you
   inferred it. **Status POSTED only**: a draft has not happened.
5. **Roll it.** Opening plus billings less releases equals closing, by contract, tied
   to the ledger.
6. **Accrued income.** Each item has evidence of delivery. Check last month's items
   were billed and cleared, and that the same work is not both accrued and invoiced.
7. **Age the balance.** A deferred item past its service end, or with nothing released
   in months, is revenue not recognised or a refund owed. An accrued item unbilled for
   several months may not be billable. Explain each one.
8. **Credit notes and cancellations.** A cancelled contract's deferred balance needs
   a decision. Do not release it to revenue by default.
9. **Cut-off.** Record the last invoice raised in the month and the first of the next.
   Check that delivery falls on the right side.
10. **Reasonableness.** Compare revenue with last month and with the contract list.
    A customer who stopped, or a jump with no new contract, needs a cause.

## Reporting treatment

Read the framework from `get_client_profile` and the year end from `get_organisation`.
**The treatment turns on which period a company is in, not on today's date.**

| Framework | What it means here |
|---|---|
| FRS 102, FRS 102 Section 1A, periods beginning before 1 January 2026 | The earlier Section 23: revenue when risks and rewards pass, and by stage of completion for services. |
| FRS 102, FRS 102 Section 1A, periods beginning on or after 1 January 2026 | The amended Section 23, a five-step model based on IFRS 15: find the contract, the promises, the price, share the price across the promises, and recognise as each is delivered. |
| IFRS | IFRS 15. |
| FRS 105, IFRS for SMEs, US GAAP | **CFO to confirm** the treatment. Stop and ask before relying on a view of your own. |

**Under the five-step model**, look harder at: contracts bundling several promises,
such as set-up with subscription, or hardware with support; set-up fees that may not
be a separate promise; discounts and credits that change the price; and agent or
principal, where a customer pays gross and the client keeps a share.

**CFO to confirm, for each client, before the first rec in a period under the amended
standard:**

- whether the change altered any contract's timing, or only its disclosure
- which transition route was taken, and any adjustment to opening reserves
- whether the costs of winning or fulfilling a contract are now held on the balance
  sheet, under the client's policy
- that Section 1A companies follow the same recognition rules
- whether FRS 105 revenue rules changed for a micro-entity client

Do not re-open a prior period yourself. If the new rules would change a signed-off
number, that is a question for the CFO.

## Done means

- Deferred income rolls forward by contract, month by month, and ties to the ledger.
- Accrued income has evidence of delivery for each item, and last month's are cleared.
- Billing ties to revenue and deferred income, or the difference is named.
- Old items are explained.
- Cut-off is recorded.
- The basis used is stated: framework, and which Section 23 version, where that applies.

## Stop and ask

Stop and ask rather than guess when:

- a contract or its terms cannot be found
- delivery cannot be evidenced
- a contract has several promises and the price split is not agreed
- a customer dispute, cancellation, or refund affects the balance
- the framework or the period's version of the standard is unclear
- a journal would be dated before the lock date in `get_organisation`
- the treatment could change revenue in a signed-off period

## What goes to the FC

These recs cannot be prepared on the rec yet, so this goes per `balance-sheet-matrix`.
The working, the schedule by contract, the roll-forward, the tie to billing, the aged
items, cut-off documents, the framework basis, each judgement with what it does to
revenue, and what you could not verify. Deferred income and accrued income are
judgement lines, so the FC challenges the release basis on the largest contracts and
reads the contract itself where it can.

## How to say it

- "Deferred income agrees to the contract schedule at 31 October 2026: opening, plus
  October's billing, less October's release."
- "The annual support invoice to [customer] was coded fully to revenue. Most of it
  belongs in deferred income; a journal is proposed."
- "[Amount] has sat in deferred income since March with nothing released, and the
  service ended in June. Either it should be revenue or the customer is owed it. Which?"
- "This client's first year under the new FRS 102 revenue rules began on 1 January
  2026. I have used the five-step approach for the new contract. Whether any older
  contracts change needs your view."

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 1 November 2026 | First version. |
| 1.1.0 | 1 November 2026 | Matches the reconciliation record: the rec lives in os.stza.io, journals are proposed on it and approved there, and tolerance and start month follow the platform. |

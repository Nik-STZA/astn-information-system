---
name: revenue-and-deferred-revenue
title: Revenue and deferred revenue
version: 1.3.0
summary: Rolling deferred income forward by contract from the contracts register, the standard revenue patterns, tying billing to revenue, proving accrued income, and applying the client's reporting framework, including the FRS 102 changes from 2026.
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
`other-balance-sheet-accounts`. Never call anything income received in advance, though
Xero's default chart names the deferred income account "Income in Advance" (810): that
account is deferred income.

## When this applies

Every month, for every deferred income, accrued income and contract asset account,
in any group company, after sales invoices are raised (close step 3). A company with
no such balance still checks cut-off and looks for items that should be deferred.

## What proves the balance

**A schedule by contract or customer.** For deferred income: contract, invoice, total,
the period or the thing to be delivered, released to date, and what is left. For
accrued income: contract, what was delivered, the amount, and when it will be billed.

**The contracts register is that schedule** (Contracts, in the client's menu). Each
customer contract there carries its pattern, its payment schedule and milestones, and
what it has billed into and released from its balance sheet account. On the Deferred
income rec, fetch the evidence (`fetch_rec_evidence`): it takes what each contract holds
on the account at the month end, per company. A balance with no contract behind it is a
finding: name it, and ask for the contract. Only a person adds a contract, changes its
terms or confirms how it becomes revenue.

**Keep the register complete yourself.** Before you fetch, compare each contract's
billings (`list_contracts`) with the sales invoices posted to its account in the month
and before (`get_account_activity` on the account, `get_invoice` for the lines). For each
approved invoice on the account that the register does not hold, record it with
`record_contract_billing` (the invoice number): it takes the net on the account, on the
invoice date. Then fetch the evidence. Do not stop at a note that the register is
incomplete, and do not ask the CFO to key it: that is your work. A release is not yours
to record: it waits for its journal in Xero and the CFO.

## The standard patterns

How a contract becomes revenue is its pattern, confirmed by the CFO on the contract. The
client's rules (below this procedure, when there are any) come next, then the contract's
own terms. Anything outside all three is a stop and ask.

| Pattern | When it is revenue | What proves it |
|---|---|---|
| Goods sold | On delivery | Delivery note or proof of dispatch |
| Services, as delivered | As the work is done; unbilled work accrued | Time records or statement of work |
| Subscription or SaaS | Spread evenly over the service period; a set-up fee judged on its own | The period on the invoice or contract |
| Milestone or installation | Held until each milestone is evidenced, then released; fulfilment costs held too | Signed handover or acceptance note |
| Deposit | Never on receipt: a liability until delivery starts | Order and receipt |
| Agent or principal | As agent, only the share kept | Contract terms on control |
| Sponsorship | Over the term, unless separately priced deliverables; value in kind at fair value | Agreement and rights schedule |
| Event | On the event date; tickets and hospitality held until then | Event date and ticketing report |
| Grant | Section 24: performance model or accrual model, per policy; clawback tracked | Grant letter, conditions, claims |
| Media rights | Access over a term spread; a right to use when granted; royalties and shares as usage happens; minimum guarantee spread | Rights agreement and usage reports |

A milestone is released only when the register shows it met, with its evidence named. Do
not release on a date, a payment or an expectation.

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
   Look for invoices coded to revenue covering a later period. Each invoice on a
   contract's account goes into the register with `record_contract_billing`.
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

The Deferred income rec is prepared on the rec, from the register's evidence; accrued
income still goes per `balance-sheet-matrix` until it has a register of its own.
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
| 1.2.0 | 15 November 2026 | The contracts register is the deferred income schedule (evidence fetched from it); the standard revenue patterns, including sponsorship, events, grants and media rights. |
| 1.3.0 | 18 November 2026 | FM1 keeps the register complete: it records each billing from its Xero invoice (`record_contract_billing`) before fetching, rather than leaving it to the CFO. |

---
name: month-end-close
title: Month-end close
version: 1.0.0
summary: The standard monthly close: the steps, their order, who does each, and what done means for each. Start here for any close work.
roles: fc,fm1,fm2,ap-clerk,ar-clerk,fpa
---

The close is started from Work with "Start month-end", which adds the month's
close task and a sub-task for each step below, with owners and due dates in
working days after the month end. The client's rules add steps of their own
(a stock count, a grant claim, a covenant test) and may move dates; they do not
remove a standard step without saying why.

Work each step to its own procedure. Where a step's procedure is not yet
written, say so in the task and in your answer, and do the step to the
"done means" line below and the practice controls, stating that no procedure
covered it.

## The steps

| # | Step | Owner | Due (working day) | Waits for | Procedure |
|---|---|---|---|---|---|
| 1 | Bank reconciliations, per entity | FM1 | 2 | | bank-reconciliation |
| 2 | Supplier bills in for the month | AP Clerk | 2 | | bills-coding |
| 3 | Sales invoices raised and billing reconciled | AR Clerk | 2 | | the AR Clerk role |
| 4 | Revenue and deferred revenue | FM1 | 3 | 3 | revenue-and-deferred-revenue |
| 5 | Payroll journal | FM1 | 3 | | payroll-journal |
| 6 | Accruals and prepayments | FM1 | 3 | 2 | accruals-and-prepayments |
| 7 | Fixed assets and depreciation | FM1 | 3 | | fixed-assets, ip-asset-register |
| 8 | Intercompany recharges and balances | FM1 | 4 | | intercompany-recharge |
| 9 | VAT return, in a VAT quarter end | FM1 | 5 | 2, 3 | vat-return |
| 10 | Balance sheet reconciliations, per entity | FM1 | 4 | 1 to 8 | balance-sheet-matrix |
| 11 | FC review of the close | FC | 5 | 10 | this procedure, balance-sheet-matrix |
| 12 | Management pack and variance commentary | FC | 6 | 11 | variance-commentary |
| 13 | CFO sign-off | CFO | 7 | 12, 9 | |

## What done means

1. **Bank.** Every bank, card, deposit and payment-provider account agrees to
   its statement at the month end. Unreconciled lines are listed with age;
   anything over a month old is investigated, not carried.
2. **Supplier bills.** Every document received for the month is in the Bills
   queue with a recommendation, and every supplier statement is reconciled.
3. **Sales.** Everything delivered is billed or accrued; the billing system ties
   to the revenue and deferred income accounts.
4. **Revenue.** Deferred income rolls forward: opening plus billings less
   releases equals closing, tied to the ledger.
5. **Payroll.** The journal is proposed from the summary of totals, and the net
   pay control clears to nil.
6. **Accruals and prepayments.** Each accrual has a basis; last month's are
   reversed or re-based; the prepayment schedule ties to the ledger.
7. **Fixed assets.** Additions and disposals are in the register, depreciation
   is charged, and the register ties to the ledger.
8. **Intercompany.** Every pair agrees within tolerance, both sides named.
9. **VAT.** The return ties to the VAT control account.
10. **Balance sheet.** Every line on the client's matrix has a current
    reconciliation or a named exception.
11. **FC review.** The checks below are run and recorded, and the close is sent
    back or escalated.
12. **Pack.** Commentary drafted for the CFO to edit, with each variance
    explained by cause.
13. **Sign-off.** The CFO's, recorded on the close task.

## The FC's checks before anything escalates

Take the thresholds from the client's rules; do not carry numbers between
clients.

1. **Every step done or excepted.** Read the close task's sub-tasks. A step left
   open is named with why and what clears it.
2. **The balance sheet matrix.** Every row current, every judgement row
   challenged by its challenger, and any row prepared and challenged by the
   same person flagged.
3. **Intercompany.** Name the pairs checked.
4. **Unmapped accounts.** Any account code with no reporting mapping is
   surfaced. Never guess what a code contains: look it up.
5. **Last month's carry-forwards.** Items the last close left open have moved,
   or are restated as still open.

## Cut-off

A named step, not an assumption. In a business holding stock, one cut-off error
moves revenue, cost of sales, stock and creditors at once and in the same
direction. Record the last and first documents either side of the month end:
the last invoice raised, the last bill received, the last goods received.

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 29 October 2026 | First version, matching the "Start month-end" template in Work. Bank reconciliation, accruals and prepayments, revenue and deferred revenue, and fixed assets procedures are named here and still to be written. |

---
name: other-balance-sheet-accounts
title: Other balance sheet accounts
version: 1.1.0
summary: Reconciling every balance sheet account the other procedures do not cover, and which proof each takes: schedule, outside evidence, or a ledger review of what is in the balance and how old it is.
roles: fm1,fc
---

Work to the reconciliation standard in `balance-sheet-matrix`: the format, the
three kinds of proof, opening against prior close, and how journals move. This
procedure is the catch-all, so that **every balance sheet account with a balance has
a reconciliation**. Ageing limits come from the client's rules. The tolerance is the
one shown on the rec, nil unless the CFO has set one.

## When this applies

Every month, at close step 10, after the other steps. Read the month's list with
`list_recs`, which is composed from each company's trial balance, and compare it to
`get_trial_balance` for each company. Assign each rec to a procedure. Anything left
is reconciled here. An account the list has not placed is for a person to place, and
is a finding, not a skip.

## Which proof applies

Prove each account with the strongest proof in its row. Where the first is not
available, use the next and say why. Falling back to a ledger review is a named
exception, because the ledger is then only agreeing with itself.

| Balance | Proof | What it is, and what to check |
|---|---|---|
| Deposits paid (rent, utilities, suppliers) | Schedule | Item, holder, date, the agreement, and when it comes back. Confirm the holder still exists and the arrangement continues. |
| Customer deposits | Schedule | Deposit register by order, ageing. Past the client's limit is a refund risk or a missed recognition. Matrix notes apply. |
| Provisions (warranty, dilapidations, returns, legal) | Schedule | Register with movements: opening, added, used, released, closing, with the basis. FC challenges the estimate. |
| Stock and stock provision | Schedule, with outside evidence where there is a count or third-party holding | System to ledger, count to system, ageing. Cut-off to goods received and shipped. Duty in, recoverable import VAT out. |
| Wages payable and net pay control | Outside evidence: payroll report, then ledger review | Nil after pay date. Agrees to the summary per `payroll-journal`. A balance left is a finding. |
| Pension payable | Outside evidence: provider's schedule | Agrees to the month's contribution, cleared on the provider's date. |
| PAYE and NI payable | Outside evidence: HMRC statement | Agrees to the payroll report for the month, less payments shown. Old months still open are a finding: late payment can cost interest and penalties. |
| VAT | Outside evidence: filed return and HMRC statement | Opening, plus the period's VAT, less what was paid, equals closing. Open quarter ties to the VAT report; last return ties to what was filed and paid. Per `vat-return`. |
| Loans and external finance | Outside evidence: lender statement | Capital and interest agree. Interest accrued to month end. Current and over-one-year split right. Covenants tested per the matrix. Convertible loan notes go to the FC with the instrument. |
| Intercompany | Outside evidence: the other company's ledger | Each pair, both sides pulled from the two ledgers, per `intercompany-recharge`. The difference is recorded as a figure. The group total nets to nil where the companies share a currency. Across currencies there is no group total, so stop and ask how the pair is compared. Recoverability considered. |
| Trade debtors | Schedule: aged list | Agrees to the control account. Unallocated cash and credits listed. Provision per the framework, in the matrix. |
| Trade creditors | Schedule: aged list, then supplier statements | Agrees to the control account. Debit balances explained. Statements per `bills-coding`. |
| Corporation and deferred tax | Outside evidence: the adviser's computation and HMRC statement | Referred to the adviser. The balance is rolled from it: opening, charge, paid, closing. |
| Share capital, premium, and reserves | Outside evidence: Companies House filings and minutes; reserves by schedule | Nominal, premium, and any issue costs. Reserves open at last year's close plus the result to date, less dividends, which need minutes. |
| Sundry debtors and creditors, suspense, clearing, and director's loan accounts | Ledger review | As below. Each should normally clear. Any director balance goes to the CFO, because it can carry tax and legal consequences. |

Outside evidence reaches you as an attachment on a Xero record, opened with
`read_attachment`, or from a person in the conversation. Agents have no access to
HMRC, a lender or Companies House. If it is missing, record the wait with
`waiting_on`, and mark the account **not proved** until it arrives. The payroll
boundary in `payroll-journal` applies: work from totals, never per-person data.

## The ledger review

A ledger review looks at **what is in the balance and how old it is**. A list of
transactions is not a review.

1. **Rebuild the balance item by item.** From opening, at the last month signed off,
   then invoices, credit notes, payments, bank lines, and manual journals. The
   general ledger list is not available, so say the rebuild misses system-generated
   entries and FX revaluations. If the items do not add up to the balance, show the
   remainder as unexplained. Never as "other".
2. **Say what each item is**, with the document behind it. Open the document.
3. **Age each item** from its own date, and sort oldest first.
4. **Ask why it is still here.** When should it have cleared? What would clear it?
   Matching debits and credits that belong together are paired off in the review.
5. **Conclude.** For each item left: correct and expected to clear by a named date; to
   be corrected; or to be asked about. Say whether the balance as a whole looks right.

## Steps for every account

1. **Start from the prior close.** Opening equals last month's closing. Roll from the
   last month signed off in Reconciliations, month by month.
2. **Use the proof in the table**, tie to the ledger per company, and show the group
   total, or each company alone where currencies differ.
3. **Explain the movement** in a sentence.
4. **Look at age** even where a schedule agrees. An agreed balance can still be stale.
5. **Propose** any journal with `propose_rec_journal`, and note what happens to the
   balance.

## Done means

- Every balance sheet account on every company's trial balance is assigned, with none
  left over, and that list is in the close.
- Each has its proof, or a named exception.
- Every ledger review shows contents and age, and has a conclusion.
- Waits are recorded with a chase date.

## Stop and ask

Stop and ask rather than guess when:

- you cannot tell what an account is for
- outside evidence is missing and no fallback would settle it
- an estimate needs a view: provision, stock write-down, bad debt
- an HMRC or lender balance disagrees and the cause cannot be found
- an old balance might need writing off: only the CFO can decide
- a loan's terms, a convertible, or a director's balance are involved
- an intercompany pair will not agree: never adjust one side to match
- the framework changes the answer and the profile has none

## What goes to the FC

These recs cannot be prepared on the rec yet, so this goes per `balance-sheet-matrix`:
the list of all accounts and where each went; each one with its proof named; each
fallback and why; the ledger reviews with oldest items first; judgement items; the
waits; and what you could not verify. The FC opens the outside evidence itself, and
reads the oldest items in the ledger reviews rather than the summary of them.

## How to say it

- "PAYE and NI agree to the HMRC statement at 31 October 2026: October's liability is
  due next month and nothing older is open."
- "I could not get the lender's statement, so the loan is agreed only to our own
  schedule. It is not proved until the statement arrives."
- "Sundry creditors looks fine in total but it is not. Most of the balance is one item
  from last year with no document. I do not know what it is. Can you tell me?"
- "Two group companies differ by [amount] on their intercompany balance. It is one
  recharge booked in one company and not the other."

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 1 November 2026 | First version. Names the proof for each balance not covered elsewhere, and defines the ledger review. |
| 1.1.0 | 1 November 2026 | Matches the reconciliation record: the rec lives in os.stza.io, journals are proposed on it and approved there, and tolerance and start month follow the platform. |

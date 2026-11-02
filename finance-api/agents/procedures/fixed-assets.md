---
name: fixed-assets
title: Fixed assets
version: 1.1.0
summary: Proving tangible and intangible assets and lease balances to a register: additions, disposals and depreciation rolled forward and tied to the ledger.
roles: fm1,fc
---

Work to the reconciliation standard in `balance-sheet-matrix`: the format, the
three kinds of proof, opening against prior close, and how journals move. This
procedure says what is particular to fixed assets. Capitalisation limits, useful
lives, and depreciation methods come from the client's accounting policies and
rules, never from here. The tolerance is the one shown on the rec, nil unless the
CFO has set one.

## When this applies

Every month, for every cost and accumulated depreciation account of tangible assets,
intangible assets and, where the framework puts them on the balance sheet,
right-of-use assets and lease liabilities. Patents and trade marks follow
`ip-asset-register`, which owns their treatment; capitalised development costs
need the client's register. Both still use the one standard rec format. Cost and
accumulated depreciation are separate GL accounts, so each is its own rec.

## What proves the balance

**A schedule: the fixed asset register**, cost and accumulated depreciation, by class.
Normally this is Xero's register, read with `get_fixed_assets`. Where a client keeps
a register outside Xero, it reaches you as an attachment or from a person, and you
say so. The register is proved by a roll-forward: opening, additions, disposals,
depreciation, closing, for cost and for depreciation separately.

Xero's depreciation is posted by Xero and is not a manual journal, so you will not
find it in `get_manual_journals`. Prove the charge from the account movements in
`get_trial_balance` and the P&L charge in `get_profit_and_loss`. If the client books
depreciation by manual journal, say so and check those too.

## Steps

1. **Start from the prior close.** The last month signed off in Reconciliations,
   rolled forward month by month, with opening equal to prior close.
2. **Pull the register**: `get_fixed_assets` with status REGISTERED, and again with
   DRAFT and DISPOSED. The result says if it is incomplete: if so, say the list was
   cut short. Agree cost and accumulated depreciation to the trial balance by class.
3. **Additions.** Look at bills and bank lines coded to the asset accounts with
   `get_invoices`, `get_invoice` and `get_bank_transactions`. Each should be in the
   register, with a date in service, and fit the client's capitalisation rule.
4. **Draft assets.** An asset at DRAFT is not depreciating. Say how long it has been
   there and what is needed to register it. Registering is for a person.
5. **Look the other way.** Search repairs, software, equipment and professional fee
   accounts for items that look like assets, and asset accounts for items that look
   like costs. Where a bill does not say enough, read the document.
6. **Disposals.** Any sale, write-off or scrapping in the month, from the Work tasks,
   sales invoices, or a bank receipt. Cost and depreciation come out and the gain
   or loss is shown separately. A disposal with no proceeds needs a reason.
7. **Depreciation.** Recompute one month by class from cost, life and method and
   compare to the charge posted. Check the last month depreciation was run. A month
   with no charge is a finding.
8. **Fully depreciated and unusual items.** Assets past their life and still in use,
   negative book values, and an asset still depreciating after sale.
9. **Impairment.** Ask whether anything happened that suggests an asset is worth
   less: closed site, cancelled project, lost contract. Note the answer. This is a
   judgement for the FC and CFO, so raise it, and do not book it.
10. **Annual check.** At year end, and at the time the client's rules set, confirm
    the assets still exist. The register proves cost; only someone looking proves
    existence.

## Reporting treatment

Read the framework from `get_client_profile`, and the year end from `get_organisation`.

| Framework | What it means here |
|---|---|
| FRS 102, FRS 102 Section 1A | Tangible assets under section 17, intangibles under section 18. Development costs are a policy choice. Leases: see below. |
| FRS 105 | Assets at cost less depreciation. No revaluation. Development costs are expensed. **CFO to confirm** before relying on this line. Lessees keep leases off the balance sheet. |
| IFRS | IAS 16, IAS 38 (development capitalised where the criteria are met) and IFRS 16. |
| IFRS for SMEs, US GAAP | **CFO to confirm** the treatment before relying on anything here. Stop and ask. |

**Leases under FRS 102 from 2026.** For accounting periods beginning on or after
1 January 2026, the amended FRS 102 Section 20 brings most lessee leases onto the
balance sheet as a right-of-use asset and a lease liability, on a model based on IFRS
16. Short-term and low-value leases can stay off the balance sheet. Lessor accounting
largely stays as it was. A company with a calendar year meets this first in the
period that started on 1 January 2026; a company with another year end meets it later.

**CFO to confirm, for each client, before the first lease rec:**

- the transition method and what it did to opening reserves
- which reliefs were taken, and how the discount rate was set
- that Section 1A companies follow the same recognition rules
- the deferred tax on transition, which goes to the client's tax adviser (see
  `how-work-moves`)

Where a right-of-use asset exists, the lease register proves both it and the
liability: payment schedule, rate, interest, and repayment. Both sides tie to the
same register. Show the current and non-current split. Check each payment in the
bank matches the register. Compare the list to rent and hire costs in the P&L, to
catch a lease that never made it on.

## Done means

- Cost and accumulated depreciation agree to the register by class, or the
  difference is named.
- The roll-forward foots, month by month from the last month signed off.
- Additions and disposals are found, and each has a document.
- Depreciation is recomputed and agrees, and the month was run.
- Leases are on the right basis for the framework, or the question is with the CFO.

## Stop and ask

Stop and ask rather than guess when:

- the client has no written capitalisation rule, life, or method for a class
- the framework is missing, or a company's first period under the 2026 changes is
  not clear
- a cost could be capital or revenue and the amount matters
- an asset belongs to another group company: see `intercompany-recharge`
- a lease has terms you cannot read, such as a variable rent or a break clause
- depreciation in the ledger and the register differ and the cause cannot be found
- a journal would be dated before the lock date in `get_organisation`

## What goes to the FC

Fixed asset recs cannot be prepared on the rec yet, so this goes per
`balance-sheet-matrix`. The working, the roll-forward by class, the additions and disposals lists, drafts in the
register, the depreciation proof and its result, items that look misclassified, any
impairment question, and for leases, each judgement and the **CFO to confirm** points
still open. The FC recomputes the depreciation for a class itself.

## How to say it

- "Fixed assets agree to the register at 31 October 2026, by class, and October's
  depreciation has been run."
- "A laptop bought in September is in the equipment account but not the register, so it
  is not depreciating. It needs adding in Xero."
- "This bill reads as a website rebuild and is coded to marketing. If it meets the
  client's capitalisation rule, it belongs in assets. Please confirm."
- "The office lease should come onto the balance sheet this year under the new FRS 102
  rules. I have not done so, because the client's transition choices are not recorded."

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 1 November 2026 | First version. |
| 1.1.0 | 1 November 2026 | Matches the reconciliation record: the rec lives in os.stza.io, journals are proposed on it and approved there, and tolerance and start month follow the platform. |

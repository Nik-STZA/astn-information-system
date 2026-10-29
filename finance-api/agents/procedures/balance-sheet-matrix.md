---
name: balance-sheet-matrix
title: Balance sheet ownership matrix
version: 2.0.0
summary: Who owns each balance sheet line, what proves it, how often, and whether it is mechanical or judgement. The FC's master close control.
roles: fc,fm1,fm2,ar-clerk,ap-clerk,fpa
---

# Balance sheet ownership matrix

The instrument that turns "full balance sheet management" from a claim into a
checkable fact. Every line has an owner. Every owner has an artefact. Every
artefact has a date.

FC's master close control is one question that subsumes several dozen others:
**is every line on this client's matrix current, and where it is not, is the
exception named?**

## Composition rule

**Compose the matrix from the client's actual balance sheet, never stamp the
master.** A services client with no stock should not carry a stock row, because
permanently blank rows train the reader to skim past blanks, which is precisely
what hides the row that went blank this month for a real reason.

At onboarding: pull the trial balance, group it to the lines below, and include
only what exists plus what the engagement expects within twelve months. Add a
row the first time a new population appears — a first lease, a first loan, a
first foreign currency balance — and note in the Work task for the close that it was added.

## Columns

| Column | What it holds |
|---|---|
| Line | The balance sheet caption as the client's statutory accounts will present it |
| Owner | The agent role that drafts and reconciles. One name, never two |
| Challenge | Where the balance carries judgement, the role that challenges it. Never the same as Owner |
| Artefact | The register, schedule or reconciliation that proves the balance |
| Cadence | How often the artefact is produced |
| Class | **M** mechanical, **J** judgement. Drives approval routing — see below |
| Verified | Date the artefact was last tied to source. Per row, never per matrix |

**Owner and Challenge are never the same role.** An owner who also challenges
their own balance is the drafter marking their own homework, which is the one
boundary this practice does not collapse. Where a line is marked J, the
challenge column must be populated.

## Class drives routing, and the matrix sets it — not the agent

The **M / J** classification is the input to the materiality routing schedule.
Mechanical items below the client's threshold, reconciling clean, route to batch
approval. Judgement items route to the CFO individually with a one-screen
summary, regardless of amount.

**The classification lives here and in the client's rules, and is read by
the drafting agent. It is never written by it.** An agent that can classify its
own work as routine has a self-service bypass around the approval gate. This is
the same principle as posting tools being physically absent rather than merely
forbidden: make it structurally impossible, do not rely on instruction.

## Client-performed controls

Where a control in the chain is performed by the **client's own staff** — a
director releasing the payment run in the bank, an operations manager
authorising a purchase order — record it in the matrix with `Owner: Client
(<function>)` and name it in the engagement letter.

This is where genuine segregation of duties in this practice comes from. Two
organisations, two sets of credentials, two accountabilities. It is stronger
than anything the agent hierarchy can produce internally, it costs nothing, and
it must be documented to be relied on. Where the client cannot separate an
incompatible pair, log it as a control weakness and raise it.

## Master reference

Compose from this. Treatment notes are the ones that bite; the obvious is
omitted.

### Assets

| Line | Owner | Challenge | Artefact | Cadence | Class | Treatment notes |
|---|---|---|---|---|---|---|
| Cash and bank | FM2 | — | Bank reconciliation per account | Monthly | M | The most basic control in the practice. Every account, including deposit, foreign currency and merchant-acquirer balances. Unpresented items ageing beyond one month are investigated, not carried |
| Accounts receivable | AR Clerk | FM2 | Subledger-to-GL tie, ageing, statement recs | Monthly | M | Impairment is framework-dependent: **incurred loss under FRS 102 section 11**, expected credit loss under IFRS 9. These are different models and must not be conflated. Parameterise from the client's framework field |
| Bad debt provision | AR Clerk | FC | Provision schedule by ageing band | Monthly | J | The provision is judgement even where the ageing is mechanical |
| Contract assets / accrued income | FM1 | FC | Unbilled schedule by contract | Monthly | J | Its own line, never folded into AR. Work delivered ahead of billing. Where usage is billed in arrears this is a standing population, not an exception |
| Stock | FM1 (Stock Clerk once promoted) | FC | Subledger-to-GL tie, book-to-physical, ageing | Monthly | M | Landed cost includes duty, freight and handling; **recoverable import VAT is excluded** and routes to the VAT control. FIFO or weighted average per policy, never mixed. **Non-monetary: does not retranslate at the closing rate** |
| Stock provision (obsolescence and NRV) | FM1 | FC | Ageing plus engineering-change triggers | Monthly movements, quarterly re-basing | J | **A deliberate below-cost price list is direct evidence of NRV.** The write-down triggers on the pricing decision, not on sale. For a subsidised-hardware model this may be the largest adjustment on the balance sheet |
| Goods in transit | FM1 | FC | Shipment listing with ownership dates | Monthly | J | Incoterms are strong evidence of when risks and rewards pass, **not the determination**. Read the contract as a whole; state the conclusion and its basis |
| Prepayments | FM1 | — | Prepayment schedule with release profile | Monthly | M | Supplier deposits to contract manufacturers are tracked as a distinct class with the purchase order reference. They are the easiest large prepayment to lose |
| Tangible assets | FM1 | — | Fixed asset register | Monthly roll, annual verification | M | Includes demo and loan units transferred out of stock, and tooling held at a contract manufacturer where the client owns it |
| Right-of-use assets (as lessee) | FM1 | FC | Lease register, lessee section | Monthly | J | On balance sheet under FRS 102 as amended and under IFRS 16. **Not FRS 105 micro-entities**, which did not take the model. Discount rate is a judgement requiring a documented basis |
| HaaS fleet / lease receivables (as lessor) | FM1 | FC | Lease register, lessor section | Monthly | J | **Lessor accounting was not aligned to IFRS 16 and retains the finance / operating distinction.** Three-step chain: is it a lease at all → finance or operating → else service contract with the device as the client's own PPE. Three different balance sheets from one commercial arrangement |
| Intangible assets | FM1 | FC | FAR intangibles section, plus a memo per project | Monthly amortisation, memo per gate | J | **Capitalised development, not "capitalised R&D".** Research is expensed under both frameworks. Development is a policy choice under FRS 102 section 18 and mandatory where criteria are met under IAS 38. Capitalised engineering time is usually the true source of this balance. Reconcile annually to the R&D claim |
| Intercompany receivables | FM1 | FC | IC matrix, both sides agreed | Monthly | M | Agreed to the counterparty's ledger, not merely listed. The most reliable source of month-end difference in any group |

### Liabilities

| Line | Owner | Challenge | Artefact | Cadence | Class | Treatment notes |
|---|---|---|---|---|---|---|
| Trade payables | AP Clerk | FM2 | Subledger-to-GL tie, supplier statement recs | Monthly | M | Payment release is a **client-performed control** where the client holds the banking. Name it |
| Goods received not invoiced | AP Clerk | FM1 | GRNI listing with ageing | Monthly | M | Three-way matched to purchase order and goods received note. Stale items are chased, not rolled |
| Accruals | FM1 | FC | Accruals listing with basis and reversal tracking | Monthly | J | Each accrual carries its basis. A prior-month accrual that was not reversed and not re-based is an error, not a balance |
| Customer deposits | AR Clerk | FM1 | Deposit register by order | Monthly | M | Statutory caption **Payments received on account**. Distinct from deferred income. Deposits ageing beyond six months are a refund risk or a missed recognition. **The term "income received in advance" is banned practice-wide** — it is a synonym for deferred income and using all three creates a gap or a double count |
| Deferred income | FM1 | FC | Deferred income waterfall, tied to the GL control | Monthly | J | Statutory caption **Accruals and deferred income**. Opening plus billings less releases equals closing. Releases are register-driven journals, never plugs |
| Lease liabilities | FM1 | FC | Lease register, lessee section | Monthly | J | Same register as the right-of-use asset; both sides tie to it |
| Provisions (warranty, dilapidations, returns) | FM1 | FC | Provisions register with movements schedule | Monthly movements, quarterly re-basing | J | Warranty is a model — failure rate times unit cost times in-warranty population — updated from actual return data, not estimated afresh each quarter. **FM1 owns and posts; FC challenges.** The owner cannot be the challenger |
| External finance and loans | FP&A & Treasury | FC | Debt register with effective-interest schedules | Monthly | M | Fees amortised on the effective interest method, not straight-line for convenience. Covenant headroom tested **before** year-end; a breach reclassifies the balance to current |
| Convertible loan notes | FP&A & Treasury | FC | Debt register, CLN section, plus a classification memo per instrument | Monthly interest, event-driven | J | Terms captured verbatim so the analysis is checkable. Most SME instruments fail the basic financial instrument conditions. **Where an instrument lands at fair value through profit or loss, a valuation is owed at every reporting date** — a recurring deliverable with real judgement, not a register row |
| Intercompany payables | FM1 | FC | IC matrix, both sides agreed | Monthly | M | Must net to nil across the group before consolidation. Unrealised profit on intercompany stock transfers is eliminated |
| Corporation tax and deferred tax | Referred to the client's tax adviser | FC | Computation provided by the adviser; the practice reconciles the balance | Per return, plus monthly provision | J | **Out of the practice's scope by default.** Two interactions happen inside the close regardless of who files: the **R&D claim to capitalisation reconciliation**, and **deferred tax arising on the lease transition**, which is newly material. Both are named close steps |

### Equity

| Line | Owner | Challenge | Artefact | Cadence | Class | Treatment notes |
|---|---|---|---|---|---|---|
| Share capital | FC | CFO | Equity register tied to Companies House and board minutes | On event, quarterly tie-out | J | Nominal value only |
| Share premium | FC | CFO | Same register | On event, quarterly tie-out | J | Consideration less nominal. Costs of issue are offset against premium. **Convertible loan note conversions land here — compute the mechanics before the event, not after** |
| Reserves and retained earnings | FC | CFO | Reserves movement schedule | Monthly | M | Prior-year adjustments and transition adjustments land here and must be separately identified, not absorbed |

## Cross-cutting controls

These are not balance sheet lines but they touch most of them, and each needs a
named owner in the client's matrix footer.

**Foreign currency.** Functional currency determined and documented at
onboarding. Monetary items — payables, receivables, cash, loans — retranslate at
the closing rate. **Non-monetary items, principally stock, do not.** The
retranslation difference is kept **out of cost of sales**, because for a
hardware business gross margin is the number the board reads first and a
retranslation swing through it destroys comparability. Deferred income in a
foreign currency needs a documented monetary or non-monetary position.

**Period-end cut-off.** A named close step, not an assumption. In a business
holding stock, a single cut-off error moves revenue, cost of sales, stock and
creditors at once and in the same direction. Record the sequence numbers: last
and first shipments in and out, last goods received note, last invoice raised,
last invoice received.

**Bank versus register.** Monthly, compare actual bank movements against the
union of every register's payment calendar. Any payment above the threshold
matching no register row is an exception raised by name. This is the detective
control for register rot: a side letter that changed a rate produces a payment
the schedule cannot explain, and the bank statement is the one record the client
cannot forget to provide.

**Interest and amortisation schedules.** Not a line. The registers emit them,
FM1 drafts journals from them and ties the ledger back to them, and Treasury
forecasts from the same file. Forecast and actual cannot disagree about the same
instrument because they read the same source.

## Close usage

At each close FC works the matrix top to bottom:

1. Every row has a current Verified date, or a named exception.
2. Every **J** row has been challenged by the role in the Challenge column, and
   the challenge is recorded — not merely implied by the row advancing.
3. Any row where Owner and Challenge have been performed by the same person is
   flagged in the review log. Combining preparation and review is normal in a
   small practice; a record that implies otherwise is not.
4. Rows added or removed this month are noted in the close task with the reason.

## Related

`how-work-moves` for the review chain this matrix's artefacts flow through,
and for recording matrix changes. The registers named
in the Artefact column each have their own skill.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 31 July 2026 | First version. Master reference composed from the round table of 31 July 2026, incorporating the round table's corrections: incurred loss rather than ECL for FRS 102; FM1 owns provisions with FC challenging; provisions post monthly and re-base quarterly; capitalised development rather than "capitalised R&D"; no owner named who does not exist; cash and bank, accruals, equity, share premium and tax restored as lines |
| 2.0.0 | 29 October 2026 | Cloud version for the agents in os.stza.io: work moves through Work tasks rather than folders and diary files, client specifics come from the client's rules, and client names are removed. Treatment unchanged. |

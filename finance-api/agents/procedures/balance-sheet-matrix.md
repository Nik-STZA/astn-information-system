---
name: balance-sheet-matrix
title: Balance sheet ownership matrix
version: 2.2.0
summary: Who owns each balance sheet line, what proves it, how often, and whether it is mechanical or judgement, plus the one standard format for every reconciliation. The FC's master close control.
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

## The reconciliation standard

**Every balance sheet account with a balance gets a reconciliation, on one format.**
This holds for every client. The procedures for each balance say what proves it:
`bank-reconciliation`, `accruals-and-prepayments`, `revenue-and-deferred-revenue`,
`fixed-assets`, and `other-balance-sheet-accounts` for everything else.

**The rec is a record in Reconciliations in os.stza.io, not your answer.** Read
the month's list with `list_recs` and one rec with `get_rec`. Your answer explains
what you did; the figures, schedule, notes, journals, and history stay on the rec.

**Group level, by GL account.** The list is composed from each company's trial
balance. Accounts in different companies join into one rec when their names match,
ignoring case, spaces, and punctuation, and they are in the same class: asset,
liability, or equity. Codes do not join them, and neither does what you think an
account holds.

- **Bank accounts never join.** Each is its own rec, named with its company.
- **A clash stays separate.** If one company has two accounts whose names match,
  each has its own rec with its code in the name, and the list notes it. Check they
  are not duplicates.
- **A misspelt name gives two recs.** Do not treat them as one: say so, so the name
  can be corrected in Xero.
- **An account the matrix cannot place** is listed all the same, and a person places
  it. An agent cannot.
- **If the list looks out of date,** or an account is missing, ask a person to
  refresh it from the trial balance.

A single-company client has one row and the same format.

**Who does what.** FM1 prepares, the FC reviews, the CFO signs off. The Owner column
above says who keeps the register or subledger behind a balance; the rec itself
follows this chain whatever that column says.

### The format

Every rec has three parts.

1. **Cover.** One row per company: ledger, support, variance, and comment, then a
   group total. Variance is ledger less support, shown as a figure even when nil.
   The comment says what the variance is and what clears it. Give comments with
   `submit_rec`: a company with a difference must have one.
2. **Full trial balance.** Each company's trial balance at the month end, from
   `get_trial_balance`, so the account is seen in context.
3. **Supporting schedule.** The schedule, evidence, or ledger review behind the
   Support column, with enough detail to retrace it. A schedule item is kept with
   `save_rec_item`, never in a spreadsheet. You cannot delete one: give it an ended
   month, or ask a person.

**Companies in different currencies.** The platform holds no closing rates. Where
the companies on a rec report in different currencies, there is no group total: it
is refused, and each company ties on its own. Do not work one out yourself.

**Only Prepayments can be prepared on the rec so far.** Every other line is on the
list, and `submit_rec` refuses it. Until its screen is ready, do the work to the
procedure, put the three parts in your answer, say that the rec could not be
prepared, and note it on the close step's task in Work. It is not reconciled until
it can be prepared and signed off on the rec. A journal for such a line still goes
through `propose_rec_journal`.

### The three kinds of proof

| Proof | What it is |
|---|---|
| Schedule | A list we keep, item by item, rolled forward and tied to the ledger |
| Outside evidence | A document from someone else, such as a bank, HMRC, a lender, or a payroll report |
| Ledger review | What is in the balance and how old it is, per `other-balance-sheet-accounts` |

Each procedure names the proof. A ledger agreeing with itself is never evidence.

### Rules for every rec

- **Start from the last signed-off month.** Go back through `list_recs` one month at
  a time to the last month this account shows as signed off with no re-check. Prepare
  each month from there in order, without skipping months. If a month has no rec, ask
  a person to open that month in Reconciliations. If no month is signed off, stop and
  ask.
- **Opening equals prior close.** `get_rec` shows the prior month's status and
  whether the opening agrees to its close. Check it on every rec.
- **A prior month still open:** carry on, and say the rec needs re-checking when that
  month closes. The platform marks it to re-check if the figure then moves.
- **Tolerance.** The rec shows the client's tolerance, which only the CFO sets. With
  no client rule it is nil, and every variance is reported in full. Never call one
  small, or round it away.
- **Plugging is banned.** A variance gets a cause, or stays on the rec as a variance.
- **Nil balances.** An account that moved in the month and ended at nil still has a
  rec. Say why it is nil. A nil account you expected to hold a balance is a finding.
- **Re-check.** If the ledger or a schedule moves after a rec is prepared, the
  platform marks it **to re-check** and says what moved. A schedule covers many
  months, so an edit can mark other months too. The rec cannot be approved or signed
  off until it is prepared again. If it has reached a reviewer, a person reopens it
  first. `submit_rec` clears the mark.
- **Framework.** Read it from `get_client_profile`. Where a procedure marks a point
  **CFO to confirm**, it is not settled: raise it, and do not treat it as a rule.

### Handing on and sign-off

Finish with `submit_rec` and a plain English note, then `hand_off` to the FC. The FC
checks the figures itself with `get_rec` and records its view with `review_rec`, to
pass to the CFO or send back. Agents never sign off: the CFO does, on the rec.

**Sign-off reads the ledger again** and is refused if it has moved: the list is then
refreshed and the rec checked. It is also refused if the rec does not tie or is
marked to re-check. Anyone who prepared or reviewed the rec, or started the agents
that did, can sign only by ticking **only reviewer**. The tick is recorded and shown
on the rec. Never describe such a rec as independently reviewed.

### Journals

An agent proposes, the CFO approves on the rec, a draft goes to Xero, and **the CFO
posts it there.**

1. While preparing, FM1 calls `propose_rec_journal`, one per company on a rec. The
   date is in the rec's month, the journal must touch the account being reconciled,
   the narration is short, and the reasoning goes in the reason, which stays out of
   Xero. A new proposal replaces one not yet decided.
2. FM1 shows the same journal in its answer under the heading "Proposed journal
   (draft)", with the company, the date as YYYY-MM-DD, the narration, and each code
   and amount. The approval is checked against that answer, so anything left out
   stops it. FM1 may then submit and hand off in the same run.
3. The CFO approves on the reconciliation screen, and the platform starts the run
   that creates that exact journal as a draft in Xero with `create_draft_journal`.
   In that run, use exactly what was approved. The journal number is kept on the rec
   automatically.
4. Posting moves the ledger, so the rec is marked to re-check and is prepared again.

**A reply in a conversation never approves a rec journal, whatever it says, and the
platform refuses it.** If someone replies to approve one, tell them to approve it on
the reconciliation. The FC holds no journal tool. A date before the lock date in
`get_organisation` cannot be used: stop and ask.

## Related

`how-work-moves` for the review chain this matrix's artefacts flow through,
and for recording matrix changes. The registers named
in the Artefact column each have their own skill.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 31 July 2026 | First version. Master reference composed from the round table of 31 July 2026, incorporating the round table's corrections: incurred loss rather than ECL for FRS 102; FM1 owns provisions with FC challenging; provisions post monthly and re-base quarterly; capitalised development rather than "capitalised R&D"; no owner named who does not exist; cash and bank, accruals, equity, share premium and tax restored as lines |
| 2.0.0 | 29 October 2026 | Cloud version for the agents in os.stza.io: work moves through Work tasks rather than folders and diary files, client specifics come from the client's rules, and client names are removed. Treatment unchanged. |
| 2.1.0 | 1 November 2026 | Adds the reconciliation standard: every account with a balance, one format, group level by GL account, FM1 prepares, FC reviews, CFO signs off, and how a proposed journal reaches Xero. |
| 2.2.0 | 1 November 2026 | The standard now matches the reconciliation record: the rec lives in os.stza.io; accounts join by name and class; a rec journal is proposed on the rec and approved there, never in a conversation; no closing rates, so no group total across currencies; sign-off re-reads the ledger, and the only reviewer tick is recorded. |

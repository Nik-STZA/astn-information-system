# Asset register - build spec

Status: agreed with the CFO, 16 November 2026. Revised the same day after an
independent review against the code (three blockers fixed: rec hook, period
lock, journal idempotency), then after a second review against the code and
Xero, with the CFO's decisions recorded in section 12. Build step 1 (PR A) is
migration 049, the grouping catalogue, the engine and the `create_fixed_asset`
block; nothing else is built yet.
Built with Claude Code. Client neutral; pilot client Feldspar Sport Group
(FGH, FSL, UDL), with groupings switched on per client.

## 1. Why

Feldspar's development and intellectual property assets are held in four Excel
registers, rolled by hand each month:

| Register | Asset classes | Accounts (company) |
|---|---|---|
| IA Track Development | Development WIP: Extreme Track, F1 Track, Mass Market Track, Universal Sensor Platform | 778-786 (UDL) |
| IP Patents and Trademarks | Patents, trade marks, domains | 772-774 (FGH); 775-777 (FSL, UDL); 770; 415 impairment; 417 amortisation |
| Performance Surface Assets | Tangible performance surfaces | 738 WIP (UDL); completed-asset accounts not yet created in Xero (TBD1-TBD12) |
| Software Development | Internal staff time capitalised | 787-789 (UDL) - **paused, CFO 16 Nov 2026** |

The files are detailed and formula driven, and that detail must not be lost.
What they cannot do: pull from Xero, record who decided a treatment and why,
let agents propose work safely (scripted saves strip formula caches;
LibreOffice zeroes XLOOKUP), or notice when amortisation has stopped. The
October 2026 IP close found two months of amortisation missing in every
company because a register that stopped charging still agreed with a ledger
that stopped too.

The Fixed assets page today mirrors Xero's own register, which holds one
patent. About GBP 2.15m of development WIP sits outside it ("needs its own
schedule"). This builds that schedule.

## 2. Principles carried from the decision log

- **The portal drives the work** (decision 12). Agents run on the local runner
  and return proposals; the portal queues and records.
- **Scripts compute, agents interpret** (decision 20). The monthly roll-forward,
  amortisation and the tie to the ledger are deterministic code. Agents propose
  allocations and treatments from precedent and evidence.
- **Approvals live in the portal** (decision 1). No treatment stands and no
  journal goes to Xero without CFO approval.
- **Every ledger write is traceable both ways** (decision 2), using the existing
  `finance.journals` pipeline with a new source.
- **What was decided cannot be rewritten** (the principle of decision 11, which
  makes `finance.notes` append only by trigger, `src/modules/finance/db/migrations/005-notes.sql`;
  in the current migrations folder the same pattern is `029-client-master.sql`,
  `shared.client_events_append_only`). `finance.audit_log` has no such trigger,
  so the register does not rely on it: `asset_events` and `asset_approvals` are
  append only by trigger, and a signed month is locked (4.6). Nothing goes to
  Xero History beyond the short line it already gets.

## 3. Groupings, proof and per-client enablement

The register is client neutral. What differs between clients is **which kinds
of asset they hold**, and each kind is proved differently. So the unit of
configuration is the **grouping**: a kind of asset with its own lifecycle,
fields, policy template and proof. Groupings are defined once, in code, like the
lines in `bs-matrix.js`. A client switches on the groupings it needs.

### 3.1 The grouping catalogue (code, `finance-api/lib/asset-groupings.js`)

Each grouping declares:

- **matrix line** it proves: `intangible` or `ppe` (later `investments`,
  `rou`). Owner, challenge and class stay properties of the line, as now
- **standard and policy template**: default life, method, start trigger and
  convention, capitalisation eligibility list, with paragraph references
- **lifecycle**: the statuses allowed and the event that moves each one
- **fields**: which asset and cost-line fields apply (IP fields, project and
  phase fields, quantity and location)
- **splits** allowed on a cost line (by phase, by percentage of time, by
  country, tangible against inventory)
- **proof**: the checks that must pass and the evidence that must be attached
  before the line can be signed off (3.2)
- **export template**: which tabs and columns the workbook carries

First catalogue, from the four Feldspar registers:

| Grouping | Line | Standard (FRS 102) | Lifecycle | Feldspar register |
|---|---|---|---|---|
| `dev_project` - developed intangible, project WIP | intangible | s18.8H criteria, s18.8K policy | research - wip - available - impaired | IA Track Development |
| `software_internal` - internal staff time capitalised | intangible | s18.8H criteria, s18.8K policy | wip by layer and version - available | Software Development |
| `ip_registered` - patents, trade marks, designs, domains | intangible | s18.4 (acquired separately), s18.8C (internally generated brands not recognised), s18.8H (internally generated patents meet the development criteria) | pending - registered - lapsed or impaired | IP Patents and Trademarks |
| `tangible_build` - self-constructed tangible asset with WIP | ppe | s17 | wip - completed - in use - disposed | Performance Surface Assets |

For `ip_registered` the eligibility list is held per IP class, because the
basis differs: trade mark filing and registration fees paid to an attorney or
office are the cost of a separately acquired legal right, not of the brand
itself, which is never recognised (s18.8C, IAS 38.63); patent drafting and
prosecution follow the development criteria; searches and landscaping are
research and expensed. Each class's row cites its basis, so the treatment on a
cost line can always say why.

Later, without changing the model: `goodwill` (s19, annual impairment),
`software_purchased` (licences), `ppe_standard` (the Xero register mirror that
already exists on the Fixed assets page).

### 3.2 Proof by grouping

Common to every grouping (the register cannot be signed off without them):

1. Trial balance for the month foots: total debits equal total credits, and the
   sum by account equals Xero's own report total for the same date
2. Register ties to the ledger per entity and account, within the client's
   `client_finance_config.rec_tolerance` (default 0, migration 032)
3. Every cost line's slices sum to its source line
4. No unallocated cost line older than the month, or each one carries a question
5. Expected charge equals the ledger movement on the accumulated account
6. Every account placed on the `intangible` or `ppe` matrix line, of any Xero
   account type, is owned by an enabled grouping, by Xero's own fixed asset
   register, or listed as outside any register. (The Fixed assets page lists
   only Xero type FIXED, which misses intangibles held under other non-current
   types.)

Specific to the grouping:

| Grouping | Extra checks | Evidence before sign-off |
|---|---|---|
| `dev_project` | Six recognition criteria assessed per project, dated; research and development split recorded on each cost line; no amortisation without a signed available-for-use date | Criteria memo per project; CFO available-for-use sign-off with evidence (e.g. not "commissioned" but "capable of operating", per the Cardiff ruling of 2 Nov 2026) |
| `software_internal` | Monthly time split ties to the capitalisation credit account (464); split rows at 2dp; no tangible memo layer reaches the software accounts | Time attestation for the month, reviewed by someone other than the person who attests |
| `ip_registered` | Account class matches IPO status (pending against registered); renewal and expiry dates held; office-action costs only before registration; intercompany recharge raised on both sides where billed and owning entity differ | IPO record link per asset; status sweep date |
| `tangible_build` | Quantity and location held; surplus split between asset and inventory recorded or carried as a named item; completed-asset accounts exist before a transfer | Installation and condition evidence; physical check annually |

**How it plugs into the reconciliations - the Deferred income pattern.**
Today `workable(lineKey, proof)` takes only the line and the proof
(`recs.js:174-183`, called about eight times in `recs-routes.js`), and both
`intangible` and `ppe` are already `proof: "schedule"` (`bs-matrix.js:20,22`),
so they are unworkable ("only the Prepayments schedule is"). Recs are also
keyed across companies by account **name**, not code (`032`, `rec_accounts`),
so one rec can hold, say, FSL 775 and UDL 775.

The register therefore follows what migration 047 did for Deferred income
(build step 6; nothing of this is in migration 049):

- add `intangible` and `ppe` to `REGISTER_SCHEDULED` in `recs.js`, so they are
  worked as evidence recs, **only for a client with a grouping enabled on that
  line**: the set applies to every client today, so the change is gated per
  client and STZA's own `ppe` rec is unchanged;
- on `ppe`, accounts Xero's register owns (Feldspar UDL 720/721) still need
  evidence: the Xero register mirror (`fixed-assets.js`, `ledgerTie`, live as
  #158) writes it with its own method, alongside the asset register's;
- a grouping expects its accounts on one line, but **placement is the CFO's**
  (`rec_accounts.line_key`, migration 032). The rec reads the placement and
  reports a different one (`placementIssue`, `lib/asset-groupings.js`); it never
  assumes either way. (16 Nov 2026: the CFO is re-placing 772-789 from `ppe` to
  `intangible`; 738 and 720/721 stay on `ppe`.)
- when the month's checks run, write the register's closing figure per company
  for each rec account into `finance.rec_evidence` with a new method
  `asset_register`, kind `outside_evidence`, carrying the register period id;
- resolve a grouping's account map (Xero AccountID per company) to the rec
  account through the same account-key rule `rec_accounts` uses, and **refuse
  to prepare the rec** when any company's account on it is not covered by an
  enabled grouping or by Xero's register, with the reason;
- update `recs-evidence.test.js:14`, which asserts `ppe` is unworkable today.

No new `workable()` signature, no change to the eight callers.

### 3.3 Per-client enablement (`finance.asset_groupings_client`)

One row per client and grouping:

- `enabled`, enabled by and when (CFO only, audited)
- numbering scheme (`{ENTITY}-TMK-{0000}`, `UDL-PSA-{00000}`)
- policy: the template, or a client override, effective dated
- suppliers to watch at intake
- export: folder path pattern and branding, as pack profiles do
- `paused` (Feldspar Software Development, 16 Nov 2026): data kept, no intake,
  no proposals, rec shown as paused not failing

**The account map (`finance.asset_account_map`).** Which ledger accounts a
grouping uses is held per company, by Xero AccountID (so a renumbered chart
does not break it), with the account's role (cost, WIP, accumulated, charge,
impairment, capitalisation credit), **who amortises it** (`amortised_by`:
`register` or `xero`, CFO decision 9) and the dates it applies from and to. A
mapping ends by date, never by deletion. Ownership is per account and dated, not
per grouping, because:

- **one account can serve more than one grouping.** UDL 789 Software (WIP)
  holds Software's staff time and IA Track's third-party cost (the Peacock
  platform). Each cost line names its grouping; the tie sums all groupings on
  the account. Groupings that share an account must agree on who amortises it
  (`mapIssues`, `lib/asset-register.js`);
- **who amortises an account changes on a date.** The FSL trade marks
  (775/776) and the FGH patent (772/773) stay in Xero's register for FY26 and
  move at the planned cut-off: a `xero` row to 31 Dec 2026 and a `register` row
  from 1 Jan 2027 (UDL's trade marks: 10, item 2).

Switching a grouping on runs a dry check first: the company's framework has a
template (`enableIssues`, 3.4), which ledger accounts it would map, where the
map would disagree on who amortises an account, how each account is placed on
the Reconciliations page, and which asset accounts remain outside any register.

**Xero's register is refused an account the register amortises.** While
`amortised_by = 'register'` on an account (on the purchase date or today), a
new asset whose type posts to it, or a new asset type on it, is refused with
the reason (`registerOwnedIssue`, `lib/xero-changes.js`). The check runs on
both ways in: the proposal (`fixedAssetProposal`, for the runner's agents) and
the write route `POST .../write/fixed-assets` that Cowork calls directly. An
asset is never depreciated by Xero and amortised by the register at once.
Accounts mapped `xero` are not refused.

### 3.4 Reporting framework

The framework is already held per company: `finance.entities.reporting_framework`
(FRS 105, FRS 102 Section 1A, FRS 102, IFRS, IFRS for SMEs, US GAAP, Other),
with notes for agents in `lib/profile.js`. The register **reads it, never
stores its own copy**, so a company's framework is set in one place.

**Templates are keyed by grouping and framework.** Each grouping carries one
policy template and one set of proof checks per framework it supports. At
launch: FRS 102 and IFRS. `'FRS 102 Section 1A'` maps explicitly to the FRS 102
template (same recognition and measurement), so it is not refused.
Enabling a grouping for a company whose framework has no template is
**refused, with the reason**, rather than falling back to another framework's
rules (decision 21: refuse to guess).

Where the frameworks differ for these groupings:

| Point | FRS 102 | IFRS | What the register does |
|---|---|---|---|
| Development costs meeting the criteria | Policy choice to capitalise or expense, applied consistently (criteria s18.8H, choice s18.8K) | Must be capitalised (IAS 38.57) | FRS 102: the client's election is recorded on the policy. IFRS: a cost line expensed on a project whose criteria are met is a finding |
| Useful life | Always finite; if it cannot be estimated reliably, no more than 10 years (s18.19-18.20) | May be indefinite: not amortised, tested for impairment annually (IAS 38.88, 38.107) | IFRS templates allow `indefinite`; FRS 102 templates refuse it |
| Goodwill (later grouping) | Amortised; no more than 10 years if not reliably estimable (s19.23) | Not amortised; annual impairment test (IAS 36) | Separate templates |
| Impairment testing | When there is an indicator (s27) | Annually for goodwill, indefinite-life intangibles and **intangibles not yet available for use** (IAS 36.10) | IFRS adds an annual impairment test, dated and evidenced, to `dev_project` and `software_internal` WIP proof |
| Borrowing costs on qualifying assets | Policy choice (s25.2) | Must be capitalised (IAS 23) | IFRS adds a borrowing-cost check to `dev_project` and `tangible_build` where funding is interest bearing |
| Residual value and life review | When there is an indicator | At least at each year end (IAS 16.51; IAS 38.102 and 38.104) | IFRS adds a year-end review event |

Two cases the model allows for from the start, built later:

- **Dual basis.** A subsidiary reports FRS 102 while the group reports IFRS (or
  an investor asks for it). Policies, events and the monthly figures carry a
  `basis`. Only the company's own framework proposes journals to Xero; any other
  basis produces an adjustment schedule by account for consolidation and the
  pack. V1 runs a single basis, but the column exists so dual is additive.
- **Transition.** A framework change is effective dated on the company. The
  opening adjustments (FRS 102 s35 or IFRS 1) are one `transition` event per
  asset, approved by the CFO, so history before the date is not rewritten.

A policy that cites a different framework from its company is a finding. For
Feldspar today: the companies report FRS 102 while the IA Track policy tab
cites IAS 38 with 120 months. That is part of Flag 3, and the build surfaces it
rather than carrying it.

## 4. Data model

Nine tables, all in `finance`, all keyed to `shared.clients` and
`finance.entities`, created by migration `049-asset-register.sql`:
`asset_groupings_client` and `asset_account_map` (3.3), `asset_policies`,
`assets`, `asset_cost_lines`, `asset_approvals`, `asset_events`,
`asset_register_periods` and `asset_planned_lines` (11.2).

- Amounts `numeric(14,2)` in the **company's base currency**, as the ledger
  holds them. A foreign-currency invoice keeps its original amount and rate as
  information; the slice amount is the base-currency net Xero posted.
- No row is deleted: as in migration 047, there is no DELETE grant, and rows
  end by state (`withdrawn`, `rejected`, `superseded`) or by date.
- Client and company keys are `ON DELETE RESTRICT`, not the codebase's usual
  `CASCADE`: a client holding asset history cannot be deleted with it, and an
  append-only table would otherwise either block the delete or lose history.

### 4.1 `finance.asset_policies` - the rules an asset follows

One row per grouping, framework and client, created from the grouping's
template for that framework and overridable. Carries `basis`, and is effective
dated so a policy change does not rewrite history.

- class key and name (e.g. `dev_wip_track`, `patent`, `trade_mark`, `domain`,
  `performance_surface`, `software_internal`)
- standard and paragraph references (e.g. FRS 102 s18.8H; `capitalisation-policy.md` s9)
- life in months, method (straight line), residual value
- start convention: `month_following` or `same_month`, and the trigger
  (`available_for_use`, `registration`, `grant`)
- what may be capitalised (the eligibility table from the IA Track
  Capitalisation Policy tab), held as a list of treatment codes with reasons
- `effective_from`, `effective_to`, approved by and when
- `conflict_note`: an open policy conflict shown on every asset that uses it
  (Flag 3: 36 months from available for use against 120 months from completion,
  both posting to 789)

### 4.2 `finance.assets` - the register

One row per asset or sub-asset. Keeps the existing numbering.

- `grouping` (from the catalogue; replaces the four workbook names)
- entity, asset number (`FSL-TMK-0001`, `UDL-PSA-00001`, IA asset no.), name
- `parent_asset_id`: sub-assets (`FSL-TMK-0008-CA-R` under `FSL-TMK-0008`) and
  the engineers' component split. A parent can hold cost not yet split to its
  components; the unsplit amount is shown, not hidden
- policy id; cost, accumulated amortisation and charge account codes (resolved
  to Xero AccountID per entity)
- status: `research`, `wip`, `pending`, `available`, `registered`, `impaired`,
  `disposed`
- dates: filing, registration, expiry, renewal, completion
- **available-for-use date**: recorded as a signed `transfer` event (4.4) with
  CFO signature, timestamp and an evidence reference; the column on the asset
  is a derived copy of that event, never written directly. The only thing that
  starts amortisation. Never derived from an invoice, a release log or a deploy
- IP fields: registration no., jurisdiction, IP owner, local IPO URL, WIPO URL,
  category
- tangible fields: location, quantity (for the Cardiff surplus split)
- `source_ref`: workbook, tab and row it was migrated from

### 4.3 `finance.asset_cost_lines` - the invoice ledger

Replaces the supplier invoice tabs (CDP, Venture Proof, Productiving, Astra,
JNDC, Sports Labs, Chambers for Sport, WIP Invoice Schedule). One row per slice
of an invoice.

Source
- `source_type`: `invoice`, `manual_journal`, `bank_transaction` (each with its
  Xero id and line id, required) or `workbook`: a row migrated from a register
  workbook whose Xero id is not known, which must carry `source_ref` instead
- supplier, invoice no., invoice date, net, VAT, gross, currency, billed entity,
  document link
- for a manual journal line, the source amount is the line's amount (debit
  positive); there is no VAT
- billed entity and owning entity kept separately (FGH bills for FSL trade
  marks; UDL settles group invoices)

Description - every field the tabs hold today
- proposal no., phase, phase name, work description, item, item type,
  jurisdiction, cost per country, R&D claim milestone, IPO status
- `fields` jsonb for anything supplier specific not worth a column

Allocation
- asset id (or null while unallocated), **amount** (stored, not a percentage;
  the October note showed CDP's rounded percentages put GBP 4.00 into the
  register)
- percentage kept as information only

Treatment
- `treatment`: `capitalise`, `expense_research`, `expense_admin`, `training`,
  `marketing`, `inventory`, `other_register`
- `reason`: policy paragraph id plus free text (the Venture Proof "Treatment
  Explanation" column, for every supplier)
- `expected_account` (from treatment and asset) against `posted_account` (from
  Xero). A mismatch is a finding, with the fix route: `edit_bill` (preferred,
  keeps document and ledger aligned, as on 5 Oct 2026) or `journal`. The tie
  holds a line on its **posted** account, so it compares like with like and the
  error shows once, as the mismatch (e.g. LTD-504736 and LTD-504738, posted to
  787, belonging in 786 and 789, until the bills are edited in Xero)

Approval
- state `proposed` / `approved` / `rejected` / `withdrawn`; every change of
  state is a row in `asset_approvals` (append only: who, role, when, from, to,
  reason), so the cost line holds the current state and the history cannot be
  edited

Invariant: for each source invoice line, the slices sum to its net amount to the
penny. Enforced by a check run on every write and shown on the page
(`sliceIssues`). The database enforces what it can on each row: capitalised
cost has an asset, an approved line has a treatment and a reason, a workbook
row has its `source_ref`.

### 4.4 `finance.asset_events` - what happens to an asset

Append only by trigger (`finance.asset_append_only`, the 029 pattern). A wrong
event is answered by a reversing event, never edited.

- `opening` (accumulated amortisation brought forward at the opening date; cost
  comes from the migrated cost lines), `transfer` (WIP or pending to available
  or registered: signed, with evidence, enforced by the database),
  `amortisation`, `impairment`, `impairment_test` (with or without a charge),
  `disposal`, `reclass` (including a parent's split to its components),
  `catch_up`, `transition`, `reversal`
- `basis` (the framework the event is measured under)
- period, amount, accounts, reason, signed by and when, evidence reference
- the link to the journal it produced is held from the journal side (4.5),
  because an event cannot be updated after it is written

### 4.5 Journals - source, link and duplicates

**Not in migration 049** (CFO, 16 Nov 2026). The September and October roll
proposes no journal: nothing is available for use, and the FSL and UDL trade
marks and the FGH patent are amortised by Xero's register until 1 Jan 2027. The
`finance.journals` change goes in its own migration, shipped with the first
register journal and before the 1 Jan 2027 cut-off, extending `finance.journals`
as 034 and 035 did for prepayments:

- drop and re-add `journals_source_check` with
  `('person', 'agent', 'schedule', 'asset')`
- **granularity, decided in that migration**: the CFO leans to one journal per
  company, grouping, month and kind, with one line per account (one per asset
  would be about 89 journals a month for FSL's trade marks alone). The
  journal's events are linked through a link table (journal id, event id),
  written when the journal is proposed, since events cannot be updated
- one live journal per company, grouping, month and kind:
  `UNIQUE (entity_id, asset_grouping, period, asset_kind) WHERE source = 'asset'
  AND state IN ('proposed', 'approved', 'draft_created', 'posted')`, with a
  check that `source = 'asset'` has its grouping and kind. **The unique index
  names `asset_kind`**: the first draft of this spec added a column
  `asset_kind` but indexed `kind`, which does not exist
- `journals.sourceOf` (`journals.js:146-151`) gains an `asset` branch so these
  show as the register's, not an agent's

Before proposing, the engine looks for **the same journal already in Xero or on
the Journals page by hand**: same company, month, accounts and amount. If found,
it is linked, not proposed again. Today's check (`recs-routes.js:895-900`, for
releases) looks only at the Journals page; "already in Xero" needs a read of
Xero's manual journals or the account's movements, built with that migration. This is what stops the September and October roll re-proposing the FSL
and FGH amortisation being fixed by hand now. Nothing is proposed into a month
on or before Xero's period lock date; a charge missed in a locked month is
proposed as a `catch_up` in the first open month.

### 4.6 `finance.asset_register_periods` - the signed month

One row per client, grouping and month (a workbook covers every company in its
grouping: the IP register holds FGH, FSL and UDL on one Cover Sheet): status
`open` / `prepared` / `signed`, the figures per company, asset and account at
sign-off (a snapshot, as `recs.signed_snapshot`), the trial balance it was tied
to, signed by and when.

- Cost lines dated in a signed month, and events in it, cannot be added or
  changed: finance-api refuses the write with the reason (`lockIssue`) and the
  database refuses it too (`finance.asset_period_lock` trigger), for a cost
  line on its old date and its new one. A correction is a `reclass` or
  `catch_up` event in an open month. Other groupings' months are unaffected.
- Re-opening a signed month is a CFO action, audited, and marks the month's
  recs to re-check, as recs do today.
- The acceptance test (8) compares against these snapshots, so September and
  October are reproducible.

## 5. The monthly engine (deterministic, finance-api)

For each asset, account and month:

```
opening + additions +/- transfers - amortisation - impairment = closing
```

Defined so nothing is guessed:

- **Additions** are approved cost lines with treatment `capitalise`, in the
  month of the **invoice date** (the date Xero posts the bill to the ledger;
  for a manual journal, its date). Other treatments are listed, not added.
- **Amortisation** starts per the policy's start convention from the signed
  available-for-use (or registration, or grant) event; straight line over the
  remaining life on cost less residual; pence rounding taken in the final month
  so the total equals cost exactly.
- **A parent with cost not yet split** to its components amortises as one asset
  on the parent's policy from the parent's trigger. Splitting later moves cost
  and accumulated amortisation to the children pro rata to the split, as a
  `reclass` event; no charge is restated.
- **Currency**: base currency throughout (4).

Then:

1. **Tie to the ledger** per entity and account against the trial balance,
   difference shown as found, never explained away (as `fixed-assets.js`).
   Tolerance `client_finance_config.rec_tolerance`; variances at 2dp. Known
   residuals are **named items**, shown beside the difference with their label
   and never netted into it; the row ties only when the difference less the
   named items is within tolerance (`tie`).
2. **Expected-charge control**, by who amortises the account (3.3):
   - `register`: prior accumulated amortisation plus this month's expected
     charge, against the ledger. A frozen account fails even when the register
     froze too (`expectedChargeControl`).
   - `xero`: Xero's own register is the schedule, so the control is whether
     its depreciation has run for the month, from `settings.lastDepreciationDate`
     as the Fixed assets page reads it (`xeroRunControl`). On 16 Nov 2026 FGH
     and FSL were last run to 31 Aug 2026 (Sep and Oct not run: the 2 x 366.23
     and 2 x 45.48), UDL to 31 Oct 2026.
3. **Trial balance footing**: debits equal credits, and the account totals
   equal Xero's own report totals for the date, before anything is compared
   (the August IA Track defect) (`tbFooting`).
4. **Unallocated and mismatch lists**: cost lines without an asset, slices that
   do not sum, posted account differing from expected (`sliceIssues`,
   `lineFindings`).
5. **Proposals** (from the journal migration, 4.5): the month's amortisation and
   any catch-up onto the Journals page for CFO approval, subject to the
   duplicate check and lock date.
6. **Rec evidence** (build step 6): the closing figures written to
   `rec_evidence` (3.2).

## 6. Agent workflow

1. **Intake (AP clerk / FM1)**: pull the month's bills from asset suppliers and
   any bill or journal touching an asset account, including miscoded ones
   (e.g. LTD-504651 coded 442, belonging in 738).
2. **Propose**: allocate each line to an asset and treatment from precedent - the
   same proposal and phase go to the same asset as before (the October IA Track
   note did this by hand against the February tranche). Unclear lines are
   proposed as unallocated with a question.
3. **Review**: FM2 and FC, then CFO approval on the Review page.
4. **Go-live**: the agent asks the VP or CEO for each WIP asset's status
   monthly; the CFO signs an available-for-use date with evidence.
5. **Close**: the engine runs, journals are proposed, recs are proved.

## 7. Excel export (pack engine)

A new `pack_engine/assets.py`, following `render.py`'s rule: **typed numbers
only on source tabs; every schedule figure and total is a formula.**

Per register, the same shape as today's files:

- Cover Sheet: GL against register against variance, per entity and account,
  plus the expected-charge line
- one invoice tab per supplier (typed source rows) with treatment and reason
  columns
- asset tabs (WIP Assets / Tracking of all IA / Registered and Pending / Cost)
- monthly schedules - Cost, WIP, Charge, Accumulated, NBV - as SUMIFS formulas
  over the invoice tab, columns to the reporting month
- Trial balance source tab
- the month's recon note, from the audit log and findings
- Feldspar house format (banners `#FF5D3B`, headers black, totals `#FFDED7`,
  inputs `#3366FF` on `#FFFFCC`, Calibri 10, accounting format, dash for zero)

Controls as in `controls.py`: register ties to ledger, slices sum, totals are
formulas, TB foots. A failed control **still writes the workbook, with
`FAILED CONTROLS` in its name** (`controls.py:1-3`), so a failure is visible
and nothing is silently withheld. Written with openpyxl with `fullCalcOnLoad`
set, as `pack_engine/recs.py` does; never recalculated with LibreOffice. Saved to the client
folder (Drive) by period: `Month-end/FY26/YYMM/`.

## 8. Migration from the workbooks

One-off loader (`scripts/asset-register-import.py`), reading each file's
values and formulas, writing JSON for a finance-api bulk endpoint.

- Values are read with `data_only=True`, which only works on a file last saved
  by Excel. The October files were written by script and their caches are
  stripped. They are **copied to a scratch folder and the copies** opened and
  saved in Excel on the laptop; the client folders are never touched. The
  loader **refuses any cell that has a formula but no cached value**, naming
  the cell, rather than reading it as empty.
- It records, on every row's `source_ref`, the original file's path, modified
  time and SHA-256, and the SHA-256 of the re-saved copy it actually read.

- Opening position at **31 August 2026** (Xero locked): every asset and every
  invoice slice, with `source_ref` back to workbook, tab and row
- Must tie to the 31 August trial balance per entity and account to the penny
  before it is accepted. Known residuals carried as named items, not absorbed:
  - IA Track GBP 1.37 (unexplained)
  - Software's share of 789 and 787: Software is paused (not loaded), but 789
    is shared with IA Track, so Software's balance on it, from the 2608
    Software file, is a named item on the 789 tie; likewise 787 until the
    LTD-504736 and LTD-504738 bill edits move those lines to 786 and 789
  - the surplus Cardiff sensor platforms parked in 738 (CFO, 2 Nov 2026),
    pending the tangible against inventory split
- **Acceptance test**: roll September and October in the system and generate
  the workbooks; figures must match the October IA Track and IP files and the
  September Performance Surface file (after the known pending items: the 787
  bill edits, the FSL and FGH amortisation, FSL-TMK-0008-CA-R). **Performance
  Surface October has no file to compare against** (not started; UDL 738 moved
  +30,610 in October): its proof is the trial balance tie and the slice sums
  only, and the test says so
- Sources: `Month-end/FY26/2608/` (opening), `2609/`, `2610/`

## 9. Build order

The first increment is whatever produces the September and October registers;
editing pages and agents come after, because that roll is mostly migrated data.

1. **PR A** (this PR). Migration `049-asset-register.sql` (048 is the highest
   today): the nine tables, append-only triggers, the signed-month lock
   trigger, grants; no journals change and no `rec_evidence` method (4.5, 3.2).
   Additive and re-runnable; applied by the CFO before merge. The grouping
   catalogue in `lib/asset-groupings.js`, tested like `bs-matrix.js`. The
   `create_fixed_asset` block (3.3) on the proposal and on the write route.
2. Also PR A: the engine (`lib/asset-register.js`, pure and tested without Xero
   like `fixed-assets.js`): roll-forward, period lock, slice sums, tie with
   named items, expected charge (register) and Xero run date (Xero), trial
   balance footing, map disagreements. The duplicate-journal check comes with
   the journal migration.
3. **PR B**: importer and the 31 August tie, IP and Performance Surface first.
4. **PR C**: export in the pack engine, and the acceptance test against the
   October files.
5. Read-only pages under `/finance/clients/[slug]/fixed-assets`: Register,
   Cost lines, Policies, Monthly schedule, Findings.
6. The rec hook (3.2) and the close step proved by the register.
7. Editing pages (allocation, treatment, go-live sign-off), then agent intake
   and proposals on the runner.

Performance Surface and IP first (smaller, IP already proven by the October
note), IA Track next, Software last once unpaused.

## 10. Open decisions for the CFO

1. **Policy per class** - resolve Flag 3 (36 against 120 months; available for
   use against completion) before any WIP asset goes live. Not needed for the
   September and October roll, where nothing is live.
2. ~~Who runs amortisation~~ **Settled** (CFO decision 9, 16 Nov 2026; see 3.3
   and 12): per grouping, per client, per account and dated. Open detail: Xero's
   register also holds a **UDL trade mark** type on 775/776 (seen 16 Nov 2026),
   which the decision did not name. Assumed to follow the FSL trade marks
   (Xero to 31 Dec 2026, register from 1 Jan 2027) until the CFO says otherwise.
3. **Month convention** for go-live (Flag 1).
4. **Performance Surface completed-asset accounts** - TBD1-TBD12 need creating
   in Xero before the first transfer.
5. **Engineers' component split** - load as child assets with cost unsplit at
   the parent, then allocate.

## 11. Forecast layer and the budget feed

### 11.1 How the budget gets asset figures today (checked 16 Nov 2026)

The budget in use is **V17** (`Feldspar Budgeting - V17 - Rev, logistics and
CDP Update with League exclusion.xlsx`). V18 and V19 are rebuilds in progress
and **not in use** (CFO, 16 Nov 2026); both inherit the same links.

V17 takes every asset figure, actual and forecast, across the whole timeline
(Jul 2023 to 2031-2036), by external link to a register workbook's Summary tab:

| Budget tab | Linked file (Finance / Budgets and Forecasts / Capex Budgeting) | Rows read |
|---|---|---|
| Intangible Assets | `Feldspar  IA Track Development  V5.xlsx`, Summary | cost, acc. amortisation, charge, WIP per track |
| Intangible Assets | `Feldspar  Software Development  V5.xlsx`, Summary | software WIP |
| Intangible Assets | `Feldspar - IP Patents and Trademarks - V2.xlsx`, Summary 2 | patents and trade marks per entity |
| Performance Surface Assets | `Feldspar - Performance Surface Assets - V3 - No league data.xlsx` | cost, depreciation, NBV per asset type (TBD1-TBD12) |

These are **budget copies**, separate from the month-end registers in
`Month-end/FY26/YYMM/`. Each register therefore exists twice and can drift; the
links read fixed cell addresses, so an inserted row in a register moves the
budget silently. The V18 rebuild's closing note records a GBP 439,712.54 double count
of 786 that inflated the modelled raise, from a mapping typo in this area.

### 11.2 What changes

One register serves both. The forecast lives in os.stza.io next to the actuals,
never mixed with them:

- **Planned cost lines**: their own table, `finance.asset_planned_lines`
  (CFO, 16 Nov 2026), not a `kind` on the actual cost lines. An actual line's
  Xero source, posted account, slice-sum rule and period lock are hard
  constraints a planned line cannot meet; mixing them would make those
  columns nullable and put a filter on every actual query, and one missed
  filter would put forecast into a signed register. Each planned line has a
  `scenario` and a `forecast_version`, a supplier and expected date, payment
  days, and the commitment it comes from (proposal and phase, contract,
  purchase order). When the real invoice arrives the actual cost line records
  which planned line it settles (`settles_planned_id`); the planned line is
  marked settled, and any remainder stays planned or is withdrawn.
- **Forecast fields on the asset**: expected go-live (or registration, or
  grant) date, confidence, and the evidence for it. The signed date (4.4) still
  alone starts actual amortisation; the expected date drives forecast
  amortisation only.
- **Tags** on assets and cost lines: budget line code (the V19 line code
  scheme, `V19 Line Codes - Draft.csv`) and raise bucket (`Master Mapping with
  Raise Buckets`, built for the V19 rebuild), so use of funds and EIS evidence come from the ledger.
- **Cash timing** from supplier payment terms, and recoverable VAT, for the
  cashflow refresh (capex by supplier row, never aggregated).

The engine (5) runs the same roll-forward forward in time for a chosen
scenario and version: planned additions, expected transfers, forecast
amortisation, by month, entity and account.

### 11.3 The feed into the budget model (until the budget moves into os.stza.io)

A generated **drop-in workbook** in long form, one row per entity, account,
asset group, month and basis, with columns for actual or forecast, scenario,
version, amount, line code and raise bucket. The budget model's Intangible
Assets and Performance Surface Assets tabs are repointed once to `SUMIFS` over
that table by entity, account, group and month, replacing the external links to
the four budget copies. No cell-address links, so an inserted row cannot move
the budget.

V17 is left as it is. The repoint is built into whichever rebuild (V18 or V19)
goes live, so a budget in use is not re-plumbed. Months up to the last signed register period read `actual`; later
months read the chosen scenario.

The drop-in carries a control row per entity and account: actual months equal
the signed register snapshots (4.6), forecast months equal the engine's output
for the named version. The four Capex Budgeting copies are then retired, after
one month run in parallel shows the live model unchanged except where the
copies were stale.

### 11.4 How the FP&A agent works it

Forward-looking only; it never posts and never changes actuals (FM1 owns the
close). Monthly, after the register period is signed:

1. Reforecast proposals: new proposals, invoices and supplier mail update
   planned lines; VP and CEO status updates expected go-live dates; slippage is
   flagged (e.g. Cardiff still calibrating). The CFO approves before anything
   changes.
2. Budget against actual per asset and project: spend, timing, amortisation,
   with the variance explained from cost lines.
3. Scenarios: "go-live slips three months" is one parameter; amortisation, cash
   and runway follow.
4. On CFO approval of a rebase: regenerate the drop-in and the per-company Xero
   budget import files (the format already used for the V19 rebase, 5 Nov 2026).

### 11.5 Later: the budget in os.stza.io

Budget versions, drivers, people costs, revenue, funding and the Xero budget
push move into os.stza.io as their own build. The register's forecast is then
one input among several. The rule throughout: **the register owns asset
numbers; the budget owns everything else; neither holds a copy of the other's.**

Build order addition: the planned lines table, and the forecast fields and tags
on assets and planned lines, go in migration 049 (nullable or empty, so nothing
waits on them); the drop-in export comes after the acceptance test (9, step 4).

## 12. Decision record and facts checked, 16 November 2026

**CFO decisions** (planning session, 16 Nov 2026; not re-opened without asking):

1. Build in os.stza.io; not Power Query, not an Excel rebuild.
2. Excel stays as an export with live formulas, saved to client folders.
3. One cost-line ledger, working like a FAR, with treatment and reason.
4. Groupings defined once in code, switched on per client, with proof checks.
5. Framework read from `finance.entities.reporting_framework`; FRS 102 and IFRS
   templates; no template means refuse; dual basis and transition designed in.
6. Agents propose, the CFO approves; nothing posts to Xero without approval;
   events and approvals append only.
7. Software Development paused: build the grouping, do not load or roll it.
8. First increment: migration 049, engine with period lock, importer and the
   31 Aug tie, export and acceptance test. Then read-only pages, the rec hook,
   editing pages and agents.
9. Who amortises is per grouping, per client: Feldspar's four groupings are
   `register` for life; ordinary equipment (UDL 720/721) stays in Xero's
   register; FSL trade marks and the FGH patent move from Xero at 1 Jan 2027.
10. The register holds the forecast (11); the signed date alone starts actual
    amortisation.
11. The FP&A agent is forward-looking only and never posts.

**Decided on the second review** (CFO, 16 Nov 2026):

- Journal changes out of 049, into the migration that ships the first register
  journal; the `kind` / `asset_kind` slip is fixed there (4.5). Granularity is
  decided there; the CFO leans to one journal per company, grouping, month and
  kind, with a line per account.
- Ownership by a dated `asset_account_map` with `amortised_by`, several
  groupings per account, and the `create_fixed_asset` block in
  `lib/xero-changes.js` (3.3).
- Planned lines in their own table (11.2).
- `ON DELETE RESTRICT`; the 029 append-only pattern; signed months per
  grouping; Xero's last depreciation date as the control for Xero-owned
  accounts; Software's 789/787 share as named items; Performance Surface
  October proved by the trial balance only; October files re-saved on copies,
  with hashes (4, 4.4, 4.6, 5, 8).
- Placement: the CFO re-places 772-789 from `ppe` to `intangible` on the
  Reconciliations page (738, 720 and 721 stay on `ppe`); the code checks
  placement and assumes neither way (3.2).
- The Fixed assets tie to the ledger is live: `ledgerTie` in
  `finance-api/lib/fixed-assets.js`, squash-merged as #158; the branch
  `fixed-asset-tie` is spent.

**Facts read from Xero, 16 Nov 2026** (read only):

| Company | Asset types in Xero's register | Cost / accumulated accounts | Last depreciation run |
|---|---|---|---|
| FGH | Intangible asset - Patent; Patents (Registered) | 772 / 773 (charge 417) | 31 Aug 2026 |
| FSL | Intangible asset | 775 / 776 (charge 417) | 31 Aug 2026 |
| UDL | Computer Equipment; Office Equipment; Intangible asset - Trade Mark | 720 / 721; Office Equipment's own; 775 / 776 (charge 417) | 31 Oct 2026 |

- All three companies carry the same codes 415, 417, 464, 720, 721, 738 and
  770-789 in their charts; the AccountIDs differ per company, which is why the
  account map holds AccountIDs.
- Reporting codes: 772-777 are `ASS` in all three companies; 778-789 are
  `ASS.NCA.FIX` in FGH and UDL and `ASS` in FSL. None is `ASS.NCA.INT`. This
  affects Xero's own reports, not the register; noted for the annual accounts.
- No TBD1-TBD12 accounts exist in any company (10, item 4).
- 417 Amortisation is the charge account of every intangible type in Xero's
  register. When a register-amortised asset also charges 417, the charge
  control reads the accumulated accounts, not 417, so the two sources on 417
  are never compared with each other.

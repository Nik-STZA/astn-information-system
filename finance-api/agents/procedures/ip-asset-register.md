---
name: ip-asset-register
title: IP asset register
version: 2.0.0
summary: Patents and trade marks: capitalise or expense, amortisation, pending assets, and the monthly close of the register against the ledger.
roles: fm1,fc
---

# IP asset register - patents and trade marks

Purchased and registered intellectual property: the register, the monthly close, and the
treatment decisions that feed it. GL accounts in scope, named by what they hold. The client's
codes for each are in its rules or its chart of accounts; look them up, never assume them:

| Account | Holds |
|---|---|
| Patents (registered) / accumulated amortisation | Granted patents at cost, and amortisation to date |
| Patents (pending) | Costs of applications not yet granted |
| Trade marks (registered) / accumulated amortisation | Registered marks at cost, and amortisation to date |
| Trade marks (pending) | Costs of applications not yet registered |
| Amortisation (P&L) | The monthly charge |
| Impairment (P&L) | Write-offs, kept separate from amortisation |

**Out of scope:** internally generated development costs (FRS 102 s18 development - the client's
capitalisation policy and its own WIP register) and tangible assets (s17).

## Authority - read this before you decide anything

**The client's purchased-intangibles policy is authoritative on treatment. This skill is the
procedure, not the policy.** Where they conflict, the policy wins and the conflict is a finding.

Read, in this order:

1. The client's purchased-intangibles policy, in the client's rules at the end of this
   procedure - recognition, amortisation commencement, useful lives, pending assets, impairment.
   If it is not there, stop and add a Work task asking for it.
2. The client's rules - framework, entities, currency, entity prefixes, account codes.
3. The register workbook's own instructions sheet, if it has one. Treat it as a secondary
   source: it is not version-controlled and can drift from the policy.

**Never infer a treatment rule from the register's change log.** A change log records what was
done; only the policy says what should be done. Where a log entry asserts a rule the policy does
not carry, raise it rather than follow it.

## The rules that get got wrong

**Amortisation starts on registration or grant, not on filing.** That is the date the asset is
available for use in the manner intended by management (FRS 102 s18.21). For a trade mark it is
the registration date; for a patent it is the grant date. Confirm against the client policy -
this is the single most-contested parameter in an IP register.

**Procedural milestones are not grant.** A patent application that is *published* is not granted.
Publication issues a publication number that looks exactly like a registration number, and the
UK IPO does not complete its investigations until at least three months after publication. So on
publication: record the number and date, leave the asset in pending, do not transfer, do not
start amortising. Treat an attorney's "one step closer" as what it is.

**Pending assets are not amortised.** Costs sit in the pending accounts until registration or grant.

**Transfer on registration is a sequence, not a reclass.** Update the status; enter the actual
registration or grant date; enter the actual expiry date; debit the registered account and credit the pending account for the
capitalised cost; remove from the pending sheet. Missing the last step leaves the asset counted
twice in monitoring.

**Capitalise vs expense on attorney invoices** - the test is whether the cost secures the legal
right or merely maintains it:

| Cost | Treatment |
|---|---|
| Prior art / state-of-the-art searches, freedom-to-operate, clearance searches, IP landscape | **Expense** - research phase |
| Application drafting, official filing fees, agent fees for filing, designation fees | **Capitalise** |
| Examination responses, office action responses, amendment fees, grant/registration fees | **Capitalise** - directly attributable to securing the right |
| Renewal and maintenance fees | **Expense** - maintains, does not enhance |
| Opposition, infringement, cease-and-desist, or any action against a third party **once the right is registered** | **Expense** - protects a right already held |
| Action against a third party's earlier right brought **to clear a citation blocking the entity's own unregistered application** (non-use cancellation, invalidation, revocation) | **Check the client policy.** Capitalise where the policy sets the boundary at registration - the action is the means of obtaining the asset (FRS 102 s18.4 / IAS 38.27). Expense where it does not |
| Litigation for damages, account of profits or costs recovery | **Expense** - never a cost of the asset |
| Extension to a new jurisdiction (Madrid, PCT national phase) | **Capitalise as a new asset** - new right, new territory |

Invoices arrive with several lines on different sides of this table. Classify per line, record
the justification per line, and never classify an invoice as a whole.

**The adversarial character of a proceeding does not decide its treatment; whether the right
exists yet does.** An offensive action can be capital and a defensive action can be revenue.
A client policy that lists only "opposition" and "infringement" on the expense side has not
addressed an action brought to clear a blocking citation, and that gap is a finding to raise
rather than a question to answer from the table. Where one action straddles registration,
apportion on the attorney's own time analysis and document the split.

**Impairment on a pending asset** is triggered by terminal outcomes - refusal that is final,
abandonment, withdrawal, lapse. Whether a *provisional* refusal or an office action is an
indicator is a client policy question with a real answer: check the policy, do not assume.
Write it off, debiting impairment and crediting the pending account, and log it.

## Month-end close

**Step 1 - pull the ledger from the accounting system, by API, for every entity in scope.**

This is the step that carries the control, and it is the one most often short-cut. These
registers typically reconcile by comparing the register to a *trial balance tab inside the
workbook* that someone typed. That control compares the register to a transcription, so a wrong
transcription makes it agree with itself and the reconciliation signs clean against a figure
that was never in the ledger. It has happened. Pull the real balances and verify the tab against
them; a difference is a finding, not a cell to correct quietly.

IP registers are usually multi-entity. Pull every entity, not the one you looked at last month.

**Step 1a - when the ledger cannot be decomposed, rebuild it; do not infer it.** The read
that answers *"what is this balance made of"* is the accounting system's journals endpoint.
Where the API grant does not include it, that read fails for every entity and no amount of
retrying changes it. Rebuild the account instead, in this order, and stop as soon as the
balance is fully explained:

1. **Invoices for the period, filtered to the account** - supplier, number, date, per-line
   amount, tax type, and whether a source document is attached.
2. **Two trial balances**, opening and closing. Their difference is the movement the
   rebuild has to reach. A rebuild that lands short is incomplete, not approximately right.
3. **Aged payables or receivables by contact** - confirms a document is genuinely posted
   rather than merely drafted, and surfaces invoices the period filter missed.
4. **Manual journals, every entity in the group, not just the one holding the balance.**
   This is the step that is skipped and the one that most often holds the answer: a cost
   billed to one entity and borne by another leaves the paying entity's account looking
   nil or unexplained until the receiving entity's journal is read.
5. **Bank transactions** for anything settled directly without a bill.

State the limitation in the reconciliation note: a rebuild misses system-generated entries,
FX revaluations and anything else that exists only in the general ledger. It is sufficient
to identify and support a balance; it is not equivalent to a drill-down, and the gap is a
defect to log against the integration, not a working practice to settle for.

**Step 2 - update the register for the month's events.** New filings, registrations, grants,
refusals, abandonments, status changes. Where an attorney report is the source, take the
attorney's per-jurisdiction status as authoritative over an optimistic internal status.

**Step 3 - classify new attorney invoices**, per line, per the table above.

**Step 4 - recompute, do not read.** Derive the register's figures from its own inputs rather
than trusting cached spreadsheet values. A workbook that has been through a scripted edit may
carry no cached results at all, and then a reader sees blanks where the control should be.

**Step 5 - reconcile and explain.** Register against ledger, per account, per entity. Explain
every variance. Sub-pound residuals are usually rounding inside the register's own arithmetic -
diagnose them once rather than carrying them forward monthly as "known".

**Step 6 - review pending items** for impairment indicators and re-rate on examination outcomes.
An attorney confirming no further objections is an outcome and should move the rating.

**Step 7 - propose the journals.** Amortisation to the amortisation charge against the
accumulated amortisation account, transfers from WIP, impairments to the impairment charge,
and accruals where a registration precedes its invoice. The account codes are the client's,
from its rules or `get_chart_of_accounts`; never assume them.

**Step 8 - evidence it.** Reconciliation to the client's mandated path, preparer and reviewer
recorded, the task updated per `how-work-moves`. Nothing is signed by the preparer alone.

## Asset numbering

`<entity prefix>-<type>-<sequence>[-<jurisdiction>]`, e.g. `ABC-TMK-0014-AU`, `ABH-PAT-0003`.
Type codes: `TMK` trade mark, `PAT` patent, `TBD` budget placeholder. The prefix is the **owning
entity** and must match the entity column. Numbers are globally unique and never reused. The
sequence increments across all jurisdictions, not within one. International filings of the same
mark are separate assets with jurisdiction suffixes.

## Watch for

- **Placeholder dates.** Pending assets often carry an estimated registration date to drive a
  forecast. Once that estimate is in the past it is generating amortisation on an asset that was
  never granted. Check every pending asset's estimated date is still in the future.
- **An asset in pending but absent from the schedules**, or present in both. Either breaks the
  monitoring count.
- **The FA sub-ledger.** The accounting system's own fixed-asset module frequently does not tie
  to the GL control accounts, and may hold assets belonging to a different group entity. That is
  a sub-ledger rebuild, separate from the register reconciliation, and it has no GL impact - say
  so rather than letting it contaminate the variance.
- **The entity paying the attorney is not always the entity that owns the mark.** In a
  group, one company commonly settles the whole IP portfolio while the rights are registered
  to another. The capitalised cost belongs to the **registered owner**; the payer holds an
  intercompany receivable and keeps the creditor. So check two things every month: that each
  capitalised cost sits in the owning entity, and that the recharge was actually raised this
  month rather than only in the month somebody last remembered. A pending account that is nil
  when you expected a balance is as much a finding as one that is unexpectedly full - and the
  creditor staying with the payer means the register must say, in terms, which entity settles
  it, or the invoice gets paid twice.
- **Attorney reports and registry records disagreeing.** Where they do, the registry is the
  record and the disagreement goes to the attorney as a query. Do not resolve it by picking one.
- **Unsolicited invoices after publication.** Publication puts the application on a public
  register and attracts official-looking invoices for "publication fees" or "register entry"
  from parties that are not the client's attorneys. They are a known fraud pattern. Any IP
  invoice not from the appointed attorney is refused, not coded - tell the AP lane.

## Related

- `practice-controls` - preloaded; the approval gate and evidence rules
- `balance-sheet-matrix` - owns the Intangible assets line: FM1 prepares, FC reviews, judgement class
- `how-work-moves` - the review chain
- The client's purchased-intangibles policy - authoritative on treatment
- The client's BS reconciliation styling convention, where one exists, for presentation

## Change log

- **1.1.0 (7 Oct 2026)** - Three gaps found on the first month-end close run under 1.0.0,
  all surfaced by one GBP 3,226.00 movement on a trade marks pending account. **Step 1a**
  added: the journals endpoint was not in the Xero app's scope grant, so step 1 could pull
  balances but nothing could decompose them, and the rebuild from invoices, trial balances,
  aged payables and journals was improvised. It is now a named procedure with its limits
  stated, and the missing scope is logged as a defect against the integration rather than
  absorbed as a working practice. **The capitalise/expense table** split the adversarial row:
  it put opposition and infringement on the expense side as costs protecting an existing
  right, which did not reach a non-use cancellation brought to clear a citation blocking an
  unregistered application - an offensive action that is nonetheless directly attributable to
  obtaining the asset. The table now defers that to the client policy and says the boundary
  is registration, not adversarial character. **A watch-for item** added for the payer-versus-
  owner split: the cost had been recharged correctly in August and not in September, so the
  paying entity's account looked clean one month and carried someone else's intangible the
  next.
- **1.0.0 (6 Oct 2026)** - Lifted from a client IP register's own `Instructions & Controls`
  sheet (v2.0, March 2026), which was a well-written procedure trapped inside a 2MB workbook on
  a shared drive: not version-controlled, not loadable by an agent, and not referenced by the
  balance sheet matrix. Generalised and placed under version control. Treatment rules
  deliberately defer to the client policy rather than being restated, after the source
  workbook's change log was found to assert an amortisation-start basis its governing policy did
  not carry. CFO reaffirmed 6 Oct 2026 that patents amortise from grant date.
- **2.0.0 (29 Oct 2026)** - Cloud version for the agents in os.stza.io: work moves through Work tasks, client specifics come from the client's rules, client names removed. Treatment unchanged.

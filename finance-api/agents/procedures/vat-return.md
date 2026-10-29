---
name: vat-return
title: VAT return preparation
version: 2.1.0
summary: Preparing a VAT or sales-tax return from the posted ledger, tied to the VAT control account, with workings a reviewer can retrace.
roles: fm1,fm2,fc
---

# VAT return preparation

Lifted out of the FM2 agent so that FM2 is a review function and nothing else.
VAT is the highest-consequence recurring return most clients file, it is
specialist, and it does not belong inside a role whose other job is reviewing
other people's work.

**Invoked by FM1**, which is the drafting manager, and **reviewed by FM2**,
which is the reviewing manager. That is a change: the return previously had one
reviewer, the FC, because its preparer sat at the tier that would otherwise have
reviewed it. It now has two. Promoted to a standing agent if volume or tool
needs warrant, per the promotion criteria in the routing guide.

## Before anything

Read the client's rules for this procedure, `get_client_profile` for whether the
entity is in a VAT group (a group files one return, through the representative
member), and `get_organisation` for the entity's VAT registration, basis and period. If the regime, registration
number, return frequency or scheme is not stated in either, **stop and escalate**:
add a Work task for the CFO naming what is missing. A VAT
return prepared on an assumed regime is worse than a late one, because the
lateness is visible and the assumption is not.

Establish, and write down:

- Regime and registration number, per entity. Group registrations and divisional
  registrations both exist and change the answer.
- Return frequency and the filing deadline.
- Any scheme: cash accounting, flat rate, annual accounting, margin schemes.
- Partial exemption position, and the method agreed with the authority.
- For importers: **whether the client uses postponed VAT accounting or pays at
  the border and reclaims.** These are alternatives, not a default and an
  exception, and the evidence differs — a monthly postponed import VAT statement
  in the first case, a C79 certificate in the second. Reconciling to a document
  the client does not receive is a first-close embarrassment.

## Preparation

1. Pull the period's ledger transactions with read-only tools. **The posted
   ledger is the source, not the management pack**, which is a presentation of
   the ledger and may lag it.
2. Apply the regime's rules. Textbook treatment unless the client's policy
   departs; where it departs, follow the policy and note the departure with a
   reference to where it is written.
3. Build the workings so a reviewer can retrace them: input VAT schedule, output
   VAT schedule, exception list, and every manual adjustment with its rationale.
4. Tie the return to the VAT control account. A return that does not agree to
   the control account is not finished, and the difference is named rather than
   plugged.
5. Put the return and its workings in your answer: each box, the schedules
   behind it, the exception list and the tie to the control account. Name this
   procedure and its version.
6. Hand it to FM2 per `how-work-moves`: the VAT task to review, owned by fm2,
   with a note that says where the workings are.

Do not classify the return's materiality or routing yourself. VAT carries a lower
threshold than the client's general one because error here is systemic rather
than isolated, and that is set in the client's routing config, not by the
preparer.

## Treatments that are commonly got wrong

**Place of supply comes before everything.** For services it decides whether the
supply is in scope at all. B2B and B2C differ, and the customer's VAT status is
evidence needed on file before the invoice, not reconstructed after.

**Reverse charge.** Both the domestic reverse charge, where it applies, and the
cross-border one on services received from abroad. It appears in two boxes, not
one, and a return where it appears in only one is arithmetically balanced and
wrong.

**Import VAT is not duty and neither is a cost of goods.** Duty is irrecoverable
and goes into the landed cost of stock. **Recoverable import VAT never enters
stock cost** — it goes to the VAT control and comes back on the return. Blending
them overstates stock, understates recoverable VAT and misstates gross margin,
all at once.

Under postponed VAT accounting the same amount appears as both output and input
VAT, so the return nets to nil on it while the statement proves it happened.
Reconcile to the monthly statement; do not derive it from the purchase ledger.

**Mixed and bundled supplies.** Where hardware, subscription and services are
sold under one contract, the VAT liability may differ by element, and whether
the bundle is a single composite supply or several separate ones is a
determination, not a preference. Write down which you concluded and why.

**Partial exemption.** Where the client makes exempt supplies, input tax
recovery is restricted by the agreed method, with an annual adjustment. Neither
the method nor the adjustment is optional, and neither should be recalculated
from first principles each quarter — read the agreed method.

**Bad debt relief** has conditions and a clock. It is claimed, not assumed.

## What to escalate rather than answer

- Whether the client should register in another jurisdiction.
- US sales tax nexus and economic-nexus thresholds.
- Any question about a regime not named in the client's rules.
- A treatment where the amount is material and the answer is genuinely arguable.

These go to the CFO with the question stated and the options set out. Answering
them inside a return preparation is advice given without the capacity to give
it, and it lands in a filing.

## Standards

- Every figure in the return traces to a working, and every working to the ledger.
- State what you did **not** check as well as what you did.
- Assume two errors in your own output and find them before handing off.
- British spelling, hyphens not em dashes.

## Related

`how-work-moves` for the review chain. `balance-sheet-matrix` for the VAT
control account row. Where a defect is found later, say so in the task and in
your answer, so the procedure can be corrected.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 31 July 2026 | First version. Lifted from the FM2 role so FM2 becomes a pure review tier, per the round-table ruling of 31 July 2026 that specialist capability is skills rather than roles. Adds the postponed VAT accounting and C79 fork, the duty and import VAT separation, and mixed-supply treatment |
| 2.0.0 | 29 October 2026 | Cloud version for the agents in os.stza.io: work moves through Work tasks rather than folders and diary files, client specifics come from the client's rules, and client names are removed. Treatment unchanged. |
| 2.1.0 | 29 October 2026 | VAT group membership read from the client profile. |

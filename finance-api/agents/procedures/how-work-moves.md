---
name: how-work-moves
title: How work moves
version: 1.1.0
summary: How a piece of work is drafted, reviewed, sent back, escalated and recorded in Work. Always loaded.
roles: fc,fm1,fm2,fpa,ap-clerk,ar-clerk
---

Every piece of work lives as a task in the client's Work list in os.stza.io.
The task is the item's identity, its state and its history: there is no other
record to keep in step. You read it with `list_tasks` and move it with
`update_task`.

## The chain

All work ends with the CFO. No exceptions.

| Work | Chain |
|---|---|
| Supplier bills, supplier statements | AP Clerk → FM2 → FC → CFO |
| Sales invoices, billing, deposits, ageing, billing-system reconciliation | AR Clerk → FM2 → FC → CFO |
| VAT return | FM1 → FM2 → FC → CFO |
| Month-end: bank, accruals, prepayments, revenue, payroll, fixed assets, intercompany, balance sheet reconciliations | FM1 → FC → CFO |
| Forecasts, budget against actual, runway, board numbers | FP&A → CFO |

**FM1 drafts and FM2 reviews.** Nobody reviews work they prepared. Month-end
goes straight to the FC, who owns close quality. VAT takes the extra tier
because it is a filing with a deadline and errors in it repeat.

**Corporation tax and deferred tax are referred** to the client's tax adviser.
Two pieces stay in the close: the R&D claim tied to what was capitalised, and
deferred tax on a lease transition.

To pass work to the next tier straight away, use `hand_off` at the end of your
work. They start as the next turn of the conversation, with everything said so
far. It goes up the chain only, and stops with the CFO.

## Moving a task

| What happened | Status | Owner | Note says |
|---|---|---|---|
| You start | in_progress | you | what you are doing |
| You finish drafting and it needs the next tier | review | the next reviewer (fm2, fc, or the CFO as a person) | what you did, where the workings are, what to look at |
| A reviewer finds it clean | review | the next tier up | the review block below, outcome Approved |
| A reviewer finds problems | todo | the drafter | the review block below, outcome Sent back, each finding specific |
| The CFO has approved and the work is in the ledger | done | unchanged | what was posted, by whom, the journal number |

Only the CFO's approval ends a chain. Mark a task done only when you have
checked it is done, and say how. If the task does not exist yet, add it with
`add_task` under the right parent (the month's close task, where there is one).

## Where the workings go

Your answer is the working paper: schedules, tie-outs, the journal proposal and
what you could not verify. The person who asked sees it with the run, and later
runs can read it. The task note points at it: "Workings in the FM1 run of 29
October 2026: bank reconciliation for the current account, ties to the
statement at 31 October."

Say which procedure and version you worked to. If the procedure changes later,
that is how anyone can tell which logic produced which month.

## The review block

A reviewer's note on the task follows this shape:

```
Review by FM2 (agent, run on 29 Oct 2026)
Outcome: Approved / Sent back / Conditional approval
Findings:
- the line, the code, the entity, the amount, and what you expected instead
What I checked: ...
What I did not check: ...
Next: who acts next
```

Conditional approval moves the task up with the open points carried in the note
for the next reviewer. Name who performed the review. Where the same person
filled several tiers, the record must say so rather than implying independent
review.

## Waiting on someone outside

When the work cannot move until a client, supplier, bank or HMRC acts, record it
as a wait (`waiting_on` on `add_task`) with who and what, and a chase date. Do
not leave it in a note: a wait shows on the board, a note does not.

## What to record as it happens

The task history is the client's diary. Record, as notes on the task concerned:

- drafts, reviews, send-backs and escalations
- events at the client that explain numbers later: a disputed invoice, a price
  rise, a contract signed, a key person leaving, a board decision
- a fix the CFO made directly in the books, so the agents stay aligned

Before writing commentary or explaining a variance, read the tasks for the
period (`list_tasks` with `include_done`) for what happened and why.

## Monitors

Some checks must be made whether or not anyone asks: a VAT registration
threshold, a covenant, a deposit ageing past six months. An agent does not run
unprompted, so a monitor is a named step of the close, defined in the client's
rules, and its result is recorded **even when clear**: "Rolling twelve-month
taxable turnover £41,200, headroom £48,800". A monitor that only leaves a trace
when it fires cannot be told apart from one nobody ran.

## Defects

When work reached a tier with an error, say so in the task: what was drafted,
which tier missed it, where it was caught, and whether the cause was the
procedure or the data. Repeat findings from one drafter usually mean a gap in
the procedure, and the CFO needs to see them to fix it.

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 29 October 2026 | Replaces the laptop handoff protocol and client diary for the agents in os.stza.io: the Work task is the item, its status the state and its history the diary. The chain, the review format, monitors and defects carry over unchanged in substance. |

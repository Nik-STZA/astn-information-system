# Accruals: agent proposals, CFO discussion, and a history the agents learn from

Status: draft for review, 18 November 2026. Worked example: the Feldspar September and October 2026 review
(`feldspar-sport-group/reconciliations/2026-11-18-accruals-review-sep-oct-2026.md`).

## 1. What exists and what does not

**Exists.**

- `agents/procedures/accruals-and-prepayments.md` v1.3.1. FM1 prepares, FC challenges. The accruals half
  already asks for a basis per line, last month's reversals checked, and regular suppliers missing a bill.
- Client rules on the Procedures page (migration 025). These are additions approved by the CFO and merged
  into what an agent reads.
- Prepayment schedules on the rec, with monthly releases (migrations 034 and 035). The platform proposes one
  release journal per item for any month Xero does not show as released.
- The supplier-proposal pattern (`supplier-decision.js`). The model proposes and the CFO decides with a
  named decision (approved, edited, question, rejected and so on), and the decision is kept.
- The Journals register (migration 033): propose, the CFO approves, finance-api creates a Xero DRAFT.
- The Review inbox.

**Missing**, and these are why Feldspar's accruals were nil at 30 September and 31 October:

1. **Accruals cannot be prepared on the rec.** The procedure says so (step 5). There is no schedule, so
   there is nothing for 805 to tie to and nothing to roll forward.
2. **An agent's suggestion has no place to be discussed.** It is either a journal proposal, which is
   approve or reject, or prose in a note. The useful part of the Feldspar review was the back and forth:
   - "Sheridans fully billed";
   - "the candidate starts 25 November";
   - "smoothed, no catch-ups".

   None of that survives the session.
3. **Nothing is learned.** Next month the agent would raise Sheridans again, ask about the CDP accrual
   again, and propose the Spencer Barden catch-up again.
4. **An accrual and its reversal are two unrelated journals.** That means two proposals and two approvals.
   Five accruals became ten approvals. Nothing links the reversal to the bill it waits for.

## 2. What we are building

```
FM1 agent runs the five tests (section 3)
   -> accrual proposals, each with basis, evidence, confidence and the precedent it relies on
   -> CFO discusses each one in place: decides, edits, asks, or says why not
   -> each decision and its reason is kept as a precedent for that client and supplier
   -> accepted proposals become schedule items on the accruals rec
   -> the platform proposes the accrual and its reversal as ONE journal pair
   -> one approval, two Xero drafts
   -> next month: reversal matched to the bill; accrual vs bill difference recorded
   -> the agent reads the precedents and the differences before it proposes again
```

## 3. The five tests the agent runs

These are taken from the Feldspar review. The standard procedure already covers tests b and c; the rest are
added.

| Test | What it finds | Example from Feldspar, Sep/Oct 2026 |
|---|---|---|
| a. Continuity | Every accrual last month recurs or is closed with a reason | Spencer Barden accrued May and June, then nothing for July and August |
| b. Backward | Bills dated after month end for earlier service (all statuses) | ACP Tokyo travel, 21-29 Sep, billed 22 Oct |
| c. Gap | Recurring suppliers with a month missing (six-month grid) | Sheridans: nothing billed after August |
| d. Forward | Contracts and engagements where more has been earned than billed | Gradi sprint, Extra Play search balance, CDP call-downs |
| e. Reverse cut-off | Bills dated in the period for later service | Channon 118 (October work dated 22 Sep) |

Each candidate records:

- the test that found it;
- its basis, using the procedure's four kinds:
  - contract or fixed fee;
  - purchase order or quote;
  - last bill for the same supply;
  - estimate, saying who gave it;
- evidence references (invoice id, line, document);
- confidence (high, medium or open);
- **the precedent it follows or departs from** (section 5).

"Open" means a fact is needed from outside the ledger. Those candidates go to the CFO as questions. They are
never estimated into a journal.

## 4. Data model (migration 062)

`finance.accrual_proposals`, one row per candidate per company per month:

- client, entity, period (month end), supplier (contact id and name), test (`continuity`, `backward`, `gap`,
  `forward`, `reverse_cutoff`);
- proposed lines: Dr account, amount net of VAT, description;
- service period from and to; basis kind; basis text; evidence (json: invoice ids, line numbers, document
  refs); confidence;
- `precedent_ids` (the precedents the agent cited);
- proposer (agent or person), run id;
- `decision`: `pending`, `accept`, `accept_edited`, `no_accrual`, `question`, `standing`, or `superseded`.
  - `no_accrual` needs a reason.
  - `question` keeps the proposal open.
  - `standing` accepts it and makes it recur (section 6).
- `decision_reason`, decided_by, decided_at.

`finance.accrual_comments`: a thread per proposal. Author (person or agent), body, created_at. The CFO can
write "Sheridans fully billed as of 18 Nov"; the agent can reply with what it found. Same rules as the Work
comments: append-only, and an agent may reply but not decide.

`finance.accrual_precedents`: one row per decided proposal, written in the same transaction as the decision.

- client, supplier, entity, test, decision, reason (the CFO's words);
- the facts it rested on (service month, amount, basis kind);
- `applies_to`: `this_month` or `until_changed`. The CFO sets this; the default is `this_month`.

Promoting a precedent to a client rule is a button. It drafts an addition to `accruals-and-prepayments` on
the Procedures page for the CFO to approve, so standing principles go through the existing approval gate.
Examples:

- "smoothed, no catch-ups: backfill missed months";
- "floor GBP 250 per supplier per month";
- "Sheridans: ask before accruing".

`finance.accrual_items`: the schedule on the accruals rec, mirroring prepayment items (migrations 034 and
035).

- One per accepted proposal: account, amount, service period, basis, expected clearing (the bill it waits
  for, or the month).
- `standing` flag, with monthly amount and end month.
- `cleared_by`: the bill id once matched, and `clearing_difference` (bill net less accrual).

## 5. How the agent learns

Before proposing, the agent calls a new tool, `get_accrual_history(client, months=12)`. It returns, per
supplier, the agent's last proposals with their decisions, reasons and comments, the standing items, and
clearing differences.

The procedure changes to require three things:

1. **Cite or depart.** Every proposal names the precedent it follows, or says why this month differs. A
   proposal that repeats a `no_accrual` precedent without new evidence is not raised; it goes in the run
   note as "not raised, precedent X".
2. **Ask the same question once.** A question the CFO has answered with `until_changed` is not asked again
   unless the facts change (for example, a new bill pattern or an amount outside the range).
3. **Calibrate.** Where clearing differences for a supplier run one way, say so and adjust the basis. An
   example would be accruals always 20% under the bill.

This is the "discuss, then it remembers" loop. It is per client by design: one client's precedents never
reach another client's agent.

## 6. Standing accruals (the Spencer Barden case)

A `standing` decision makes an item recur: the same supplier, amount and account each month until its end
month or until stopped. Each month the platform:

- proposes the pair (accrual on the last day, reversal on the 1st) for every standing item with no matching
  bill dated inside that service month;
- flags any standing item whose expected bill did not arrive by the 15th;
- **runs the continuity check against the previous month.** A standing item that stopped without a
  `no_accrual` decision is a finding. Missed months are proposed as a backfill into their own months, never
  as a catch-up in the current month (Feldspar client rule, CFO 18 Nov 2026). If a missed month is locked,
  the finding asks the CFO to open it; the agent does not substitute.

## 7. The journal pair, and the Journals page

An accepted proposal or a standing item makes **one register entry with two Xero drafts**:

- accrual dated the month end;
- reversal dated the 1st of the following month (Feldspar precedent `bdd96811` / `0eba6088`).

Both carry the same short narration ("Accrual: Spencer Barden SB/010, September services" and
"Reversal: ..."). The basis, evidence and decision stay in os.stza.io.

- **One approval creates both drafts**, under the keys `journal id + attempt + leg`, so neither can be made
  twice.
- Narration is under 120 characters. The reason never goes to Xero, which is the existing rule.
- Accounts come from the client profile, not from the code (805 Accruals, `LIA.CUR.ACC`). This is item 71's
  lesson: the old sweep hard-coded 830, Corporation Tax.
- The month end runs the 805 tie-out: the ledger at month end equals the schedule, to the penny.

**Journals page changes.** These are the CFO's "clunky" points; the list is to be completed with him.

- Approve several at once, from the list or the Review inbox, with one confirmation listing what will be
  created.
- Show pairs as one row with both legs.
- Filter by source (register, rec, accruals, VAT clearing) and by company.
- (CFO to add.)

## 8. Agent permissions

| Action | FM1 | FC | CFO |
|---|---|---|---|
| Run the tests and raise proposals | yes | no | yes |
| Comment | yes | yes | yes |
| Challenge (comment marked as challenge) | no | yes | yes |
| Decide, set standing, promote to rule | no | no | yes |
| Approve the journal pair | no | no | yes |

This matches the existing journal rule: an agent proposes, and only a person with the CFO role approves, in
os.stza.io. Claude reaches this only through finance-api (the practice MCP), whichever licence the seat is on.

## 9. Back-load and acceptance test

Back-load Feldspar from the 18 November review:

- the six CFO decisions, as precedents (Sheridans, Extra Play, CDP, Channon, Irwin, Fora);
- Spencer Barden as a standing item from July 2026;
- ACP Tokyo as a one-off item.

The acceptance test is a run for November 2026 on Feldspar that:

1. raises the November Spencer Barden pair from the standing item, without being asked;
2. does **not** raise Sheridans, CDP or Fora, citing the precedents;
3. matches the September and October reversals to SB/010 and SB/011 with nil clearing difference;
4. ties 805 at 30 November to the schedule;
5. puts every open question in the Review inbox, and nothing else.

## 10. Decisions for the CFO

1. Is the default for `applies_to` `this_month`? (Suggested yes: the CFO opts in to "until changed".)
2. Should the GBP 250 floor be a client rule per client, or a practice default?
3. Should the agent run on a schedule (the 3rd working day, with a re-run on the 15th) or on request?
4. What else is clunky on the Journals page (section 7)?

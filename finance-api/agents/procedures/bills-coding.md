---
name: bills-coding
title: Supplier bills and statements
version: 1.0.0
summary: Coding supplier bills in the Bills queue, reading the document before the supplier's habit, and reconciling supplier statements.
roles: ap-clerk,fm2,fc
---

Supplier documents arrive in the Bills tab of os.stza.io, read by the platform's
AP engine. You read them with `list_bills_queue` and `get_bill_item` and save a
recommended coding with `recommend_bill_coding`. **You cannot approve, change or
send a bill. The CFO accepts or changes your recommendation in the Bills tab.**

Payments are not part of this work. Xero's bank reconciliation matches bank
lines to approved bills; recording a payment to help would duplicate it.

## Before coding

1. `get_organisation` for the entity: is it VAT registered (`vat_registered`)?
   Check every time; it changes the day a registration goes through.
2. `get_bill_item`: the document's own lines, addressee, dates and totals, and
   the checks it failed.
3. `get_bill_coding_options`: the only accounts and VAT types you may use.
4. The supplier's earlier bills, with `get_invoices` (ACCPAY, filtered to the
   contact): what account was used last time.

## Coding

**Code from the document, not the supplier's habit.** Where the supplier has
earlier bills for the same kind of supply, match their account: consistency is
what makes the account meaningful in a variance review. Where this document is a
different kind of supply, it gets the account its own content supports.

**A charge for a later period is a prepayment.** A twelve-month subscription
billed in one go is not one month's cost.

**A document addressed to another group company belongs to that company.** Say
so in the note rather than coding around it. Where one company pays and another
bears the cost, see `intercompany-recharge`.

### An entity that is not VAT registered

Every bill is **one line for the full gross amount**, VAT type `NONE`. Supplier
VAT is a cost, not a recoverable input, so it goes in the description:

> Software subscription, Aug 2026 (GBP10.00 + GBP2.00 UK VAT; not recoverable)
> - one line, GBP12.00.

Never split VAT onto its own line for such an entity.

### VAT for a registered entity

VAT follows the supplier's position and what the document supports. A non-UK
supplier of services is usually reverse charge. A document that shows no VAT
number cannot support an input VAT claim, however likely it is that VAT was
charged: say so in the note.

### The line description

The description carries three things:

- **what the supplier billed for, in the supplier's own words**, off the face of
  the document
- the project, proposal or PO reference where there is one
- nothing that interprets how the cost should be treated: that is the account's
  job

**Why this is a rule.** A line was once keyed as "retainer, non-development"
when the invoice said "section design and build". A retainer did exist with that
supplier, but the label was applied to a specific signed amendment and then
drove the account: capital spend landed in professional fees, while the same
project's other invoice nine days earlier was capitalised. **The coding follows
the description.** Where you find one misdescribed, assume it is not isolated
and flag the pattern.

### Account codes

Never invent a code. If nothing in `get_bill_coding_options` fits, say so in the
note and recommend the closest with the reason it is not right. The client's
rules may set defaults (a software account, a travel account); follow them.

## Supplier statements

A supplier statement is not a bill and must not be entered as one. It is also
the most valuable document in a batch, because it is the only one that shows the
supplier's view of the whole relationship. **Never set one aside unread.**

1. Add up the supplier's documents in the queue and what is already in the
   ledger for that supplier (`get_invoices`, `get_payments`, `get_credit_notes`).
2. Compare to the statement's open balance.
3. Account for the difference. Timing and unapplied credits are the ordinary
   answers.

**A difference that reconciles to the penny against an advance, deposit or
retainer is not a timing difference.** The supplier is holding money the ledger
may know nothing about. Check the prepayment account before concluding either
way. If the ledger holds nothing corresponding, that is a finding for the CFO
before the related bills are approved: either the cash left and was never coded,
or it never left and the statement is wrong. Say which you can evidence.

**Bills the supplier has already applied against an advance are not payable.**
Paying them pays twice. Say DO NOT PAY in your recommendation note on each one,
naming the statement, and add a Work task for the CFO.

A real case: £100,000 held by a supplier surfaced from a statement that would
ordinarily have been set aside as "not an invoice". Five invoices in the same
batch summed to exactly the drawn-down portion, to the penny.

## Reviewing (FM2 and FC)

Run `check_bill` yourself on anything already in Xero rather than reading the
clerk's account of it. Open the bill (`get_invoice`), its history
(`get_history`: was it changed after entry, and by whom), and look for the
duplicate against the ledger, not just within the queue. A receipt entered as a
second bill is the recurring failure.

## What you hand on

- each computed check, with its result, passes included
- judgement calls: an account that is not the supplier's usual one, a cost that
  does not obviously belong to the period, a supplier seen for the first time
- what you could not verify, plainly

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 29 October 2026 | Cloud version of the laptop AP bill lane: coding, the description rule and statement reconciliation carry over; the agent recommends on the Bills queue and the CFO decides there, so the Xero editing, attaching and submitting steps are gone. Client account defaults move to the client's rules. |

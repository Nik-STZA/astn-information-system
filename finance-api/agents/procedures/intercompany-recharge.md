---
name: intercompany-recharge
title: Intercompany recharge
version: 2.0.0
summary: Booking a cost one group company pays and another bears, with the evidence on both sides and the intercompany pair agreed at period end.
roles: fm1,fc,ap-clerk,fm2
---

# Intercompany recharge

A cost arrives in one entity and belongs in another. This is the procedure for moving it,
evidencing it, and proving at period end that both sides agree.

Client specifics - entity names and prefixes, the intercompany account codes, currency, GAAP,
VAT grouping, materiality - are in the client's rules at the end of this procedure. **Read them first.** STZA defaults
otherwise: GBP, UK GAAP / FRS 102, British English.

## The constraint that shapes everything

**An accounting system cannot post across entities.** Each entity is a separate ledger with its
own trial balance. One document can only ever touch one of them. So a recharge is always at
least two bookings in two ledgers, and the pair only agrees because someone made it agree -
nothing enforces it.

Three consequences follow, and they are the whole of this skill:

1. **The receiving entity's side is always a journal.** There is no route that avoids it. You can
   remove the paying entity's journal; you cannot remove the receiver's.
2. **That journal has no source document unless you put one there.** The supplier invoice lives
   in the paying entity's ledger. The receiving entity capitalises or expenses a figure with
   nothing behind it.
3. **Nothing reconciles the two ledgers automatically.** A recharge that is raised on one side
   and not the other produces two internally consistent trial balances that are both wrong.

## Which entity bears the cost

Decide this before booking anything, and write down why:

| Question | The cost belongs to |
|---|---|
| Who receives the benefit of the supply? | That entity |
| For an asset: which entity is the **registered legal owner**? | The owner, regardless of who paid |
| For employment costs: which entity gets the output of the work? | That entity, apportioned where split |
| For a shared function: which entities use it, and on what measurable basis? | Each, on that basis |

**The entity named on the invoice is the one that owes the supplier. It is not necessarily the
one that bears the cost.** Those are two different questions and a register that records only
one of them will mislead. Where a register tracks assets, it needs both a "billed to" and an
"owner" column, because for IP, licences and group-negotiated contracts they routinely differ.

## The two routes, and when each applies

### Route A - code the bill straight to intercompany

In the paying entity, the bill line is coded to the intercompany receivable, not to the expense
or asset account. The paying entity never touches its own cost account.

```
Paying entity      DR  Intercompany receivable       net
                   DR  VAT input (if recoverable)    tax
                   CR  Accounts payable              gross
Receiving entity   DR  Expense / asset               net        <- journal
                   CR  Intercompany payable          net
```

**Use this as the default** where the beneficiary is known when the invoice is keyed and the
whole cost belongs to one other entity. It is better than Route B for one reason that matters
more than it sounds: **it removes a monthly step that can be forgotten.** A recharge journal in
the paying entity is a separate action with no document forcing it, and the month it is missed,
the paying entity's account carries a cost it does not own while the owner's register
understates. Neither side looks wrong on its own.

### Route B - post the cost, then recharge it out

The paying entity codes the bill normally, then journals the cost out.

```
Paying entity      DR  Expense / asset               net        <- on the bill
                   CR  Accounts payable              gross
                   DR  Intercompany receivable       net        <- journal
                   CR  Expense / asset               net
Receiving entity   DR  Expense / asset               net        <- journal
                   CR  Intercompany payable          net
```

**Use this when the cost has to be measured in the paying entity first:**

- **Payroll.** The gross must land in the entity running the payroll so the payroll-to-GL bridge
  control can foot. Recharge the qualifying share afterwards. See `payroll-journal`.
- **An apportionment.** Where a cost splits across entities on a percentage known only at close.
- **A partial recharge.** Where the paying entity retains some of the cost itself.
- **A locked or closed period on the bill**, where editing is not available.

### Where a bill has already been keyed to the wrong account

Prefer **editing the bill** over adding a journal: edit where it is unpaid,
the period is unlocked, and the tax treatment does not change. The document then agrees with
itself, and one record says one thing rather than two records needing reconciliation forever.

Two limits in practice:

- **Agents do not edit bills.** Prepare the exact change, state the before and after, and hand
  it to the CFO, who edits the bill or approves a journal.
- **Editing the bill does not move the cost between entities.** It can only change which account
  in the *paying* entity is debited. The receiving entity still needs its journal.

## Evidence - the part that gets skipped

**Route A leaves no trace of a recharge in the paying entity's ledger.** There is no journal, no
narration, nothing that reads as a cross-charge. And the receiving entity holds a journal for a
figure whose only support sits in another company's books. An auditor on the receiving entity
goes looking for a mirror journal in the payer, finds nothing, and cannot tell whether the other
side was ever booked.

So the receiving entity's journal carries two things, every time:

**1. The supplier document itself.** Manual journals are an attachable resource type - do not
assume otherwise. You cannot move files, so name the document for the person who posts:

- `list_attachments` on the paying entity's bill to get the exact file name
- In the journal proposal, say which file goes on the receiving entity's journal, and add a
  Work task to attach it once the journal is created as a draft
- Once attached, `list_attachments` on the journal confirms it. Check it; do not assume it

Where the recharge is an apportionment rather than a whole invoice, attach the workings as well -
the percentage, its basis, and who attested it. A journal for 40% of something needs the 40%
evidenced, not just the invoice it came from.

**2. A note that says where the other side was booked**, in the journal's narration and as a
history note for the person posting to add. Name the entity, the route, the document or journal
id, and - where Route A was used - say **explicitly that no mirror journal exists**. Also record
the expected intercompany pair figure, so the next person can check it in one step. A history
note is unchangeable and travels with the record; a working paper does not.

## The creditor does not move

**Recharging a cost does not transfer the liability.** The supplier is owed by the entity it
invoiced, whatever happens to the cost afterwards. This is the error that actually costs money,
because a bill visible in the receiving entity's register looks payable from there.

- Put **DO NOT PAY FROM \<other entity\>** in the journal's narration and the history note.
- Repeat it in any register that shows the asset or cost, naming the entity that settles it.
  The register is where someone looks before paying, not the journal.
- A status alone protects nothing: an authorised bill appears in the payment run regardless.

## VAT

**Inside a VAT group or a single registration:** intra-group supplies are disregarded. **Recharge
at net.** The input tax stays with the entity that received the supply and is recovered by the
group. No output tax on the recharge, no VAT invoice between the entities.

**Outside a group:** the recharge is itself a supply. The paying entity raises a proper VAT
invoice to the receiver and accounts for output tax; the receiver recovers input tax subject to
its own status and partial exemption. Recharge at net plus VAT. Do not reach for
disbursement or paid-as-agent treatment to avoid this - it is narrow, it has conditions, and it
is a question for the client's adviser rather than an assumption.

**The trap, either way:** changing a bill line's account code can make the system **reset that
line's tax rate to the new account's default.** Intercompany accounts are balance-sheet accounts
and usually default to no VAT, so the input tax silently disappears, the document total drops by
the tax, and the supplier is still owed the gross. **Check the document total is unchanged before
saving**, and check the tax rate on every line that carried one. This is the single most likely
way to break an otherwise correct reclass.

## Transfer pricing

A straight pass-through of a third-party cost at cost is normally unobjectionable. A recharge of
**services** - management time, shared functions, use of assets - may require an arm's length
basis and a mark-up depending on jurisdiction, group size and whether the entities are in
different tax jurisdictions. **Flag it; do not invent a rate or a basis.** Note what the recharge
is, that a basis is needed, and whose decision it is.

## Period end

1. **Reconcile every bilateral pair.** The payer's receivable and the receiver's payable, equal
   and opposite, at the same date. With three entities that is three pairs, not two.
2. **Record the actual variance figure, not pass or fail.** A tolerance hides a drifting
   residual: a sub-tolerance break passes silently every month and compounds. A figure in the
   recon makes the drift visible.
3. **Check this month's recharges were actually raised.** List the period's third-party costs
   that belong to another entity, and confirm each has its other side. **A nil balance where you
   expected one is a finding** - it may mean the recharge was raised, or that the cost was never
   put there at all, and those look identical from one ledger.
4. **Confirm the receiving entity did something with it.** A recharge that lands in the receiver's
   expense or WIP and is never capitalised, amortised or released is half a booking.
5. **Check no recharged creditor has been settled by the wrong entity.**
6. **Where routes changed between months, say so in the recon.** Route A one month and Route B the
   next reach the same place by different entries; undocumented, it reads as an inconsistency.

## Watch for

- **A cost sitting in the payer that belongs elsewhere, with no recharge raised.** Invisible from
  either ledger alone. The payer's account looks like ordinary activity; the owner's looks
  complete. Only the two together show it.
- **Both sides raised for the same cost.** The mirror of the above, and the likelier error once
  someone goes looking for a missed recharge: the direct-coded bill plus a recharge journal
  double-counts, and the account goes negative rather than to nil. A negative balance on an asset
  or intercompany account is almost always this.
- **The intercompany pair agreeing because both sides were posted from the same working paper.**
  That is the self-confirming control pattern. Pull both balances from the two ledgers by API.
- **Entity names that differ by one word.** Groups with similar names are a known source of
  posting to the wrong company. Confirm the entity before every write, per `practice-controls`.
- **A recharge to an entity that cannot pay it.** An intercompany receivable from a loss-making
  or dormant subsidiary is a recoverability question, not just a reclass.
- **Rounding on apportionments.** A three-way percentage split does not sum to the whole in pence.
  Put the residual somewhere deliberate and say where.

## Related

- `practice-controls` - preloaded; the approval gate, entity confirmation, evidence rules
- `bills-coding` - coding the bill in the paying entity
- `payroll-journal` - the payroll bridge; this skill handles its recharge leg
- `ip-asset-register` - where the owner and the payer differ by design
- `balance-sheet-matrix` - assigns one owner per balance sheet line, intercompany accounts included
- The client's rules - entities, intercompany codes, VAT grouping, tolerances

## Change log

- **1.0.0 (7 Oct 2026)** - Written after a client close where GBP 3,226.00 of trade mark cost
  sat in the paying entity's own intangibles account because the September recharge was never
  raised, while the August equivalent had been. Neither entity's ledger showed the problem alone:
  the payer's account read nil in August precisely *because* the recharge had been done, so a nil
  balance and a correct balance were indistinguishable. The fix the CFO chose - reclass the bills
  to intercompany rather than add journals - is Route A here, and it is the default in this skill
  because it deletes the step that was forgotten. The evidence section exists because the
  resulting journal in the receiving entity had no source document and no mirror journal to point
  at; manual journals turned out to be attachable, which had been assumed otherwise.
- **2.0.0 (29 Oct 2026)** - Cloud version for the agents in os.stza.io: work moves through Work tasks, client specifics come from the client's rules, client names removed. Treatment unchanged.

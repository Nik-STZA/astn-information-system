---
name: variance-commentary
title: Variance commentary
version: 2.0.0
summary: Drafting the month's management pack commentary to the CFO's Finance Director standard: investigate supplier-level spend first, then explain the month as a Finance Director would to a CEO, in os.stza.io for the CFO to edit and approve.
roles: fc,fpa,fm1
---

The commentary explains what happened in the month, why, what it means and what
should be done about it. It is a first draft for the CFO, who edits and approves
it. This procedure carries the CFO's Finance Director Commentary Standard (18
November 2026), which applies to every management pack the practice prepares.

## Where the commentary lives

Each month's commentary is held in os.stza.io, not in files: the highlights (the
words, beside the figures they explain) and the dashboard (figures only), as the
pack build reads them. Read it with `get_pack_commentary`, last month's too. Start
a month from your analysis by loading the whole highlights file with
`import_pack_commentary`; change words with `edit_pack_commentary`, by the paths
`get_pack_commentary` gives. You edit only the text fields. If a figure looks
wrong, say so in your note and to the CFO; never type over it. Nothing reaches the
pack until the CFO approves the month.

## Investigate first

Do not start writing once you have the headline figures.

1. **Actuals by month** with `get_profit_and_loss` and timeframe MONTH: the
   reporting month, the year to date, and the three months before it.
2. **The plan.** `get_budget_summary` where the budget is held in Xero. If no
   budget is available to you, say so and compare with the same month last year
   and the prior three months instead, labelled as such. Never invent a budget or
   forecast comparison.
3. **Materiality** from the client's rules. Where none is set, explain any line
   that moved by more than 10 per cent and £5,000, and say that default was used.
4. **Supplier-level spend, for every material cost category.** `get_invoices`
   (ACCPAY) and `get_bank_transactions` for the month, by account, tied to the
   P&L by company, account and month. For each category: the largest suppliers;
   this month against last month and the year to date; increases, new suppliers,
   suppliers who stopped or did not bill; recurring against one-off; possible
   duplicates; concentration on one supplier; costs in the wrong group company;
   recharges and intercompany; costs that may be capital rather than expense;
   costs incurred but not yet billed. Read the invoice descriptions: do not assume
   what a supplier does from its name.
5. **What happened at the client**: the month's tasks and notes in Work, the
   threads, the open reconciliations and their reconciling items.
6. **Cash and funding**: the bank position, the month's significant receipts and
   payments, funding received and expected, loans from directors and
   shareholders, and the runway where it can be worked out reliably. Do not
   confuse profit with cash.

## Understand the story

Decide what matters before writing. What changed since last month, what drives
the result, what is recurring and what exceptional, what trend is building (if a
cost has risen three months running, say so), what management should worry
about, and what needs deciding. Do not treat every movement as equally
important. Explain how movements relate: more development spend may be good for
the product and still matter for cash, capitalisation and future amortisation.

## Structure

1. **Executive overview**: the month's performance, the main movements and what
   drove them, the commercial developments, and the one issue management most
   needs to know. Readable on its own; not a repeat of the dashboard.
2. **Revenue and trading**, where there is any.
3. **Operating costs**, from the supplier analysis: recurring, exceptional,
   investment, new commitments, and anything unexplained.
4. **EBITDA and profitability**: management EBITDA kept apart from the statutory
   result and the adjustments between them.
5. **Cash and funding**, given proper attention.
6. **Balance sheet and investment**: development spend, fixed assets, debtors and
   creditors, loans, intercompany, working capital, and why they matter.
7. **Risks, issues and decisions**: what needs attention, why, and what happens
   next. Not a generic risk register.

Where it helps, a supplier table per category: supplier, this month, last month,
year to date, movement, and the explanation or what is still being found out. It
supports the words; it does not replace them.

## Rules for every variance

1. **Never invent a supplier, a reference, an amount or an explanation.** Every
   figure comes from a tool result; an inference is said to be one.
2. **Attribute to suppliers**, choosing the few that explain the movement rather
   than listing them all.
3. **Timing or substance.** Say whether the amount is right and the month wrong,
   or the monthly cost has changed.
4. **Type each line**: recurring, can be flexed by management, timing, one-off
   this month, one-off in the year to date, or mostly recurring with a one-off
   element.
5. **Name the basis**: which budget and version, or which comparison.
6. **Say plainly what you could not find out**, and what is needed to find out:
   "Professional fees rose sharply, but the transactions available do not show
   which suppliers were behind it. That needs looking at before we can say why."
7. **Numbers win.** If a note contradicts the ledger, say so. Never hide an
   unresolved reconciliation, and never mix group and company figures.

## The full-year read

For operating costs, EBITDA, net result and revenue: the full-year budget, the
year-to-date actual for N months, the straight-line estimate (year to date × 12 /
N), and one sentence on what it means.

## Writing

Write as an experienced Finance Director talking a CEO through the month over a
coffee: intelligent, commercially aware, warm, clear, honest and willing to
challenge. Explain; do not just describe.

- Flowing paragraphs that develop naturally. Do not cut the commentary short to
  hit a length, and do not pad it either.
- £, not GBP. Contractions now and then where they read naturally.
- Avoid: short disconnected sentences; lists of figures without their meaning;
  starting sentence after sentence with "The business recorded" or "The group
  reported"; "notably", "furthermore", "therefore", "consequently", "in
  comparison"; "an area to monitor" and "remains an area of focus"; brackets
  stuffed with extra figures; the same formula for every paragraph; saying the
  same thing in two sections; placeholders such as TBC.
- Not "Legal and professional fees increased by £24k. Marketing decreased by £7k."
  but "The loss grew in October mainly because professional fees were much higher
  than in recent months. Marketing gave some of that back after September's
  campaign. The fees deserve a closer look: which suppliers drove them, and
  whether we should expect them again."

`get_pack_commentary` lists wording the standard asks you to avoid, field by
field. Clear it before handing over.

## Before you hand it over

Read it from beginning to end. Does it sound like a good Finance Director? Would
a CEO find it easy and interesting? Does it explain why, not only what? Were the
suppliers behind material spend investigated? Are facts kept apart from
assumptions, and are the decisions clear? If not, improve it.

Then write a short note to the CFO, as the version note and in your answer: the
sources and tabs you could read; the categories where supplier analysis was done
and those where it could not be; the significant supplier movements; what remains
unexplained and what would resolve it; and the decisions needed.

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 29 October 2026 | Cloud version of the laptop BvA commentary: the evidence comes from the agent's own ledger reads rather than a local analyser and workbook, and the pack styling stays with the pack build. Supplier attribution, timing against run rate, line types, the budget stamp and the full-year read carry over. |
| 2.0.0 | 19 November 2026 | The CFO's Finance Director Commentary Standard (18 November 2026): investigate supplier-level spend before writing, the structure, the Finance Director's voice and the words to avoid, honesty about what could not be found, and the closing note to the CFO. The word limits are gone. The commentary is drafted in os.stza.io with the new tools and approved there by the CFO. |

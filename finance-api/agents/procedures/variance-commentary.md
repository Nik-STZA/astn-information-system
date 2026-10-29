---
name: variance-commentary
title: Variance commentary
version: 1.0.0
summary: Drafting the explanation of actuals against budget or last year for the management pack: evidence first, supplier attribution, timing against run rate, plain words.
roles: fc,fpa,fm1
---

The commentary explains why the numbers moved. It is a first draft for the CFO,
who edits and owns it.

## Evidence first, words second

Collect the evidence before writing a sentence:

1. **Actuals by month** with `get_profit_and_loss` and timeframe MONTH: the
   reporting month, the year to date, and the three months before it.
2. **The plan.** `get_budget_summary` where the budget is held in Xero. If no
   budget is available to you, say so and compare with the same month last year
   and the prior three months instead, labelled as such.
3. **Materiality** from the client's rules. Where none is set, explain any line
   that moved by more than 10 per cent and £5,000, and say that default was used.
4. **For each material line, the suppliers behind it.** `get_invoices` (ACCPAY)
   and `get_bank_transactions` for the month, by account: the top contributors,
   suppliers new this month, and regular suppliers who did not bill.
5. **What happened at the client**: the month's tasks and their notes in Work.

## Rules for every variance

1. **Never invent a supplier, a reference or an amount.** Every figure comes
   from a tool result.
2. **Attribute to suppliers.** For an adverse line, name the top one to three
   suppliers with amounts. For a favourable line caused by a regular supplier
   not billing, name them and add "verify: cancelled, or invoice missing?". For
   a new supplier, say so.
3. **Timing or substance.** Say whether the amount is right and the month wrong
   (an invoice that slipped, a phasing difference), or the monthly cost has
   changed.
4. **Type each line**: recurring, can be flexed by management, timing, one-off
   this month, one-off in the year to date, or mostly recurring with a one-off
   element. This is what turns a variance table into a forecast.
5. **Name the basis**: which budget and version, or which comparison, in a line
   at the top.
6. **Confidence.** Where a variance could not be fully sourced, say "verify with
   the owner" and why.
7. **Numbers win.** If a task note contradicts the ledger, say so; do not
   draft around it.

## The full-year read

For operating costs, EBITDA, net result and revenue: the full-year budget, the
year-to-date actual for N months, the straight-line estimate (year to date × 12
/ N), and one sentence on what it means. "Year-to-date spend is 89% of the
full-year operating cost budget" is the sentence a board needs and a variance
table cannot give.

## Writing

The practice controls' writing rules apply in full: this is the text most likely
to reach a board. One or two sentences per line, 40 to 150 words; the main
commentary 200 to 250 words. Past tense for what happened, present for where
things stand. Each comment stands alone, for a reader with no prior context.

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 29 October 2026 | Cloud version of the laptop BvA commentary: the evidence comes from the agent's own ledger reads rather than a local analyser and workbook, and the pack styling stays with the pack build. Supplier attribution, timing against run rate, line types, the budget stamp and the full-year read carry over. |

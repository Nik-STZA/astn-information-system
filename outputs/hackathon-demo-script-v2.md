# STZA Finance OS — Hackathon Demo (v2, 11 Sep 2026)

One line: **"An AI finance team that works on your live Xero books, and that you can trust with real money, because every number is checked and nothing moves without a human."**

---

## 5-minute prep (do this before you go on)

1. **Portal:** os.stza.io → Finance → Clients → STZA → **Agents** tab.
2. **Queue the "after" for the trust story.** Type: *"Pull our P&L for Jan 2026 to Aug 2026 by month"* and queue it. It should come back in about 40 seconds with revenue totalling **£53,095.60**. The broken run from this morning (£200,248.60) stays in the list underneath. That pair is your best slide.
3. Open a **Xero** tab on STZA's P&L, so you can show a number matches.
4. Keep the laptop awake, because the agent runner runs on it.
5. Only if the **Reports** tab shows AP ageing / Management pack as Live: open AP ageing for Feldspar (group view).

---

## The 3-minute core

**0:00 – Problem (20s)**
"I'm a CA and a fractional CFO for UK and South African SMEs. Month-end is still people copying numbers out of Xero into spreadsheets. So I built my finance team as agents that work on the live books."

**0:20 – Live: ask the finance team (50s)**
In the Agents tab, pick **FC** and ask something short and safe:
> *"What is outstanding from customers at 31 Aug 2026?"*

While it runs (8–20 s): "That's a Financial Controller agent calling Xero through our own API on Google Cloud. Every run records who asked, which tools it used and what it cost. This one costs about two pence."

Then open a finished run and **reply to it**. That's follow-up conversations, shipped today:
> *"Which of those are overdue?"*

"It keeps the conversation going, like a colleague would."

**1:10 – The trust story (70s)** ← the part that wins
Open the two P&L runs side by side.
"This morning the AI told me revenue for Jan–Aug was **£200,248**. Confident, nicely formatted, and wrong. The real figure is **£53,095**. Xero returns overlapping windows when you ask for comparatives, and the agent summed them."

"Most people fix that with a better prompt. I don't trust prompts with money. I fixed it in code. The platform now asks Xero for one whole month at a time and does the adding up itself, so the model never totals anything. We found three separate ways Xero's comparison columns mislead today, and each one is now a test." (Point at the corrected run.)

"Same principle for money moving. I asked the agent to post a £20,000 provision journal. It **refused and drafted it for review**, because posting goes through a governed endpoint. The journal must balance to the penny, the approval text must match exactly what a human saw, it defaults to draft, it can't post twice, and every step is audited."

**2:20 – The business (30s)**
"STZA's own books were client one; Feldspar Group, three entities, is next. It's a fractional CFO practice with an AI team behind it. It makes one qualified accountant the reviewer of a whole finance function instead of its bottleneck. We charge per entity per month."

**2:50 – Close (10s)**
"AI that does the work, code that checks the AI, and a human who signs. Thank you."

---

## If you have longer (add in this order)

- **AP ageing, group view** (only if the Reports tab shows it Live): "Every supplier we owe, across three companies, bucketed by age, intercompany flagged, exported to CSV. The old version silently stopped at 100 bills and counted drafts."
- **Management pack button** (only if Live, and only for **July 2026**, because August commentary isn't written yet): "This used to mean opening PowerShell and running a nine-stage pipeline. Now it's a button. It builds the 26-tab pack and the board deck and saves them to the finance drive as drafts, because a human signs off, not the machine." It takes several minutes, so start it before you go on and show the finished build.
- **IT spend question:** only re-run it after the per-month fix is live; the earlier answer understated every 31-day month. True August IT software: £242.37.

---

## Q&A, answered truthfully

**Which AI?** Claude Sonnet 5 through Anthropic's commercial API, not a consumer chat subscription. We're moving to Claude on Google's Vertex AI in the EU, so client data sits under the Google Cloud data processing agreement.

**Do you store financial data?** We store the question, the answer and an audit trail of what the agent did: tool names and file paths, never raw ledger contents. Xero is read live. Xero tokens are in Google Secret Manager and the portal sits behind Google's identity-aware proxy.

**How do you know the numbers are right?** "Scripts compute, agents interpret." Arithmetic and period logic live in tested code, not in the model. And this morning's story shows we check answers against the source. That's how we found and fixed two real Xero traps in a day.

**Can it post journals / pay suppliers?** Journals: yes, through a governed endpoint with exact balancing, approval text matching, idempotency, draft by default and a full audit trail. The agent drafts; a human approves. Payments: no, by design.

**What does it cost to run?** Pennies per question. Each run shows its own cost: 2p to 17p today.

**Why not just ChatGPT plus Xero?** You'd get this morning's £200k answer and no way to know it was wrong. The value is the controls, the multi-entity plumbing and the audit trail.

**Pricing?** Still validating. Per entity per month, alongside the fractional CFO retainer.

---

## Don't say (it isn't true)

- "Zero cost / no API keys": runs cost pennies and use an API key.
- "Bring your own ChatGPT or Gemini": not how it works today.
- "We never store financial data": answers with figures are stored.
- "Journal posting isn't built": it is, through the governed endpoint.

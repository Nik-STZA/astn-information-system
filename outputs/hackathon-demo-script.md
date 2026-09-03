# STZA Finance Platform — Hackathon Demo Script

**Event:** 11 September 2026 hackathon
**Duration:** 3 minutes live, then Q&A
**Presenter:** Nik Mladenovic, CA(SA), STZA

---

## Setup (before you go on)

- Cowork open with Xero MCP connected
- Portal (os.stza.io) open in a second tab, Finance > STZA > Agent Runs visible
- One completed agent run already showing (the July month-end review) so the audience can see formatted output

---

## Beat 1 — The problem (30 seconds)

"I'm a fractional CFO. I run month-end closes, review aged debtors, prepare board packs — across multiple clients, each with their own Xero.

The problem: every finance team runs on the same reports, pulled manually, formatted in spreadsheets, emailed around. The data is live in Xero but the workflow is stuck in 2015.

What if your finance team could just talk to the books?"

---

## Beat 2 — Live demo in Cowork (90 seconds)

Open Cowork. Type naturally:

> "Show me the aged receivables for STZA as at today. Who owes us money and how overdue are they?"

**While it runs:** "This is hitting live Xero data through an MCP connection. No API key management, no middleware — Claude calls the Xero tools directly. The cost of this query is zero to me beyond my existing Claude subscription."

**When results appear:** Point out the formatted table, the ageing buckets, the specific invoice details.

Follow up conversationally:

> "Revenue dropped 10% in July. Pull the P&L for July vs June and tell me what moved."

**While it runs:** "Notice I'm not switching tools, not opening a report builder. I'm having the same conversation I'd have with a finance manager sitting next to me."

**When results appear:** "Comparative P&L, variance analysis, and it's flagged the revenue drop and the specific client concentration. That's an auditor's instinct — trained into the system prompt."

---

## Beat 3 — The operational layer (30 seconds)

Switch to the portal tab.

"For teams, there's a second layer. The portal lets you queue structured work — a month-end review, a bank rec check — and it runs asynchronously using the same Xero tools. Each agent role has a defined scope: Financial Controller, FP&A, AP Clerk. You can see who handled it, what tools they used, what it cost."

Point to the agent badge, the tool usage, the cost line.

"The conversational interface is for the CFO. The portal is for the team. Same data, same tools, different surfaces."

---

## Beat 4 — The model (30 seconds)

"The architecture is BYOAI — Bring Your Own AI. The platform provides the tools and the data connections. Users bring their own Claude, ChatGPT, or Gemini subscription. That means:

- Zero per-token cost for us as the platform operator
- Users get the conversational interface they already pay for
- We charge for platform access and data connections, not for AI compute

We're starting with fractional finance for UK and South African SMEs. The Xero integration is live. POPIA compliance tooling is next."

---

## Close

"If you're interested in piloting this for your finance function, or you want to talk about the platform architecture, come find me. Nik Mladenovic, STZA."

---

## Backup questions and answers

**Q: What about data security?**
A: Xero OAuth with per-user tokens. The platform never stores financial data — it queries live and returns results. Audit trail logs every tool call by user and timestamp.

**Q: Why not just use ChatGPT with Xero directly?**
A: You could, but you'd need to build the tool definitions, handle multi-entity auth, scope access per client, and maintain the prompts. We've done that. The platform is the plumbing.

**Q: What's the pricing model?**
A: Still being validated. GDPR Article 27 representative services charge EUR 1,200-3,600/year per client. We're looking at similar tiers for finance platform access — monthly per-entity pricing.

**Q: Can it post journals / make payments?**
A: Journal posting is on the roadmap — the write-path design is done (draft-then-post with bidirectional traceability) but not yet implemented in the core platform. A separate Cowork plugin can post journals via Xero. Payments are read-only by design — the system can prepare a payment run but a human approves and executes. That's a deliberate control.

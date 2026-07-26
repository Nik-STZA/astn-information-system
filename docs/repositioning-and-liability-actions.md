# Repositioning & liability — action list

**Date:** 2026-07-26. One page you can work from. Rationale + sources: `docs/market-analysis-2026-07.md`.
**Core message:** the product is ahead of the business. The bottleneck is *not* more features — it's
positioning, proof-of-payment, liability, and distribution. Fix those before writing more code.

---

## Repositioning — from "AI compliance SaaS" to "human-accountable multi-jurisdiction advisory"

**Old (weak):** "An AI tool that assesses your policies for POPIA/GDPR compliance."
→ commoditised by ChatGPT, undifferentiated vs Priviso/NetDocuments, sells the AI (which isn't the moat).

**New (defensible):**
> *"Expert-signed data-protection compliance for organisations operating across Africa, the Gulf and
> Europe — where the global tools are blind to POPIA/PDPL and the local firms only cover one country.
> We read your actual documents, cross-check every finding across two models and a qualified human, and
> hand you a cited redline your lawyer can adopt."*

**Lead with:** (1) native emerging-market depth (POPIA/PAIA/PDPL/FADP in one workflow), (2) a named
accountable human, (3) cross-border multi-entity handling. **Stop leading with:** the dual-model AI
(it's hygiene, not a moat — say it once, in the methodology, never as the headline).

**Target buyer (in priority order):**
1. Cross-border **multinationals / groups** facing Nigeria/Saudi/DIFC registration + audit machinery
2. **Regulated verticals** with budget: fintech, health, insurance, marketing-heavy firms
3. **Sports bodies** (biometrics = special-category; multi-regime by nature) — the beachhead + logos
4. SME mass market — **only** when a forcing function is present (procurement, funding DD, breach, audit).
   Do **not** build the financial model on unforced SME demand.

---

## Prove it's a business (next, before more build)

- [ ] Convert **ProTouch into a paid, closed engagement** and treat it as *willingness-to-pay validation*,
      not just delivery. Record what they'd actually pay, and for what (one-off vs ongoing).
- [ ] Land **3–5 paying engagements in the cross-border/regulated segment**. If you can't, the "product"
      thesis is unproven — that's the signal, not a reason to add features.
- [ ] Design **recurring revenue**: monitoring + re-assessment on regulatory change (the change-triggered
      engine already supports this) + a DPO-as-a-service retainer. A one-off $2k is a day-rate; the
      subscription must sell *ongoing* value.
- [ ] **Systematisation test:** run the exact assessment manually 5–10× and hand the workflow to someone
      else without re-explaining. Until that works, it's consulting, not a product.

## Distribution (the real bottleneck)

- [ ] Build a **referral channel** through people who see the forcing-function triggers first:
      accountants/auditors, boutique law firms, VCs doing DD, and cross-border corporate service providers.
- [ ] One repeatable, low-cost acquisition motion — not paid ads into a vitamin market.

## Liability — fix before scaling client work (potentially fatal if ignored)

- [ ] **Scope every engagement tightly** in writing: what's in, what's out, and that deliverables are a
      *starting point for the client's own legal review*.
- [ ] Frame all output as **"regulatory-lens information, not legal advice"** — consistently, in the
      product UI, the reports, and the contract. (The engine already footers this; make the contract match.)
- [ ] **Partner with a qualified lawyer per jurisdiction** (SA / UK / UAE) to sign off client-facing legal
      documents. This is the incumbents' survival model — the licensed human owns the risk.
- [ ] Secure **affirmative AI professional-indemnity cover** (not "silent" cover). Document your AI
      governance — the mandatory, logged human-review step is an insurance precondition (already built).
- [ ] Confirm the **DPA-covered AI tiers** are in place before any client personal data flows (Vertex
      Gemini under Google Cloud DPA + Anthropic commercial DPA — already flagged in the project notes).
- [ ] Get a view on **unauthorised-practice-of-law** exposure in each target jurisdiction (SA LPC, UK SRA/
      LSA reserved activities). Where drafting legal documents crosses the line, route it through the lawyer.

## Benchmark the competitors (this week)

- [ ] Hands-on test **Priviso** and **NetDocuments Privacy Policy Analyzer** — run a sample policy through
      each, compare output quality, citations, and redraft usefulness against ours. (Access/how-to-test
      findings appended once the competitor-review research lands.)
- [ ] Note where they're weak (jurisdiction depth? human accountability? emerging-market coverage?
      redline export?) — that's your wedge, or your warning.

---

## The one honest sentence

Treat *"this is a scalable SaaS"* as the hypothesis to **disprove**, not the plan. If the evidence says
it's a high-quality, tech-enabled boutique in a real niche — that's a good business worth building
deliberately, on services economics and trust, with the software as *your* leverage. Just don't spend
another month polishing the engine to avoid answering: **who pays, how much, how often, and who's liable.**

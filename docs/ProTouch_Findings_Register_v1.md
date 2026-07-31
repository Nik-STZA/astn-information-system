# STZA Working Evidence Register — ProTouch Sports / Podium Pursuit

**Client:** ProTouch Sports (Pty) Ltd
**Engagement:** Data Protection Readiness Assessment
**Register version:** v1.0 | 24 July 2026
**Status:** Pre-engagement (working paper — not for client distribution)

---

## Classification definitions

These classifications apply to all findings in this register and all subsequent assessment deliverables. They form part of STZA's standard assessment methodology.

**Finding** — Available evidence indicates a governance gap, inconsistency, or missing control requiring remediation.

**Confirmation required** — Available evidence is insufficient to reach a conclusion. Further information or clarification is required.

**Observation** — A noteworthy point that may warrant future attention but does not currently indicate a governance deficiency.

**Outside scope** — Identified during the assessment but not evaluated because it falls outside the agreed engagement.

---

## Risk ratings

Where a risk rating is assigned, the following scale applies:

- **Critical** — Immediate regulatory exposure or breach risk; requires urgent remediation.
- **High** — Material governance gap that should be addressed before formal DPO/IO appointment or regulatory engagement.
- **Medium** — Governance weakness that should be addressed as part of a structured remediation programme.
- **Low** — Minor gap or improvement opportunity; no immediate regulatory risk.
- **N/A** — Risk rating not applicable (outside scope items).

---

## Register

### Governance domain

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-001 | Finding | Privacy Policy v4.0 §2; Cookie Policy v1.0 §2 | High | The Privacy Policy and Cookie Policy both name Blocksport AG as the platform operator and reference a Data Processing Agreement that is "in force" with 2021 EU SCCs. This DPA was not provided in the document pack. | Obtain the Blocksport AG DPA for review. If no executed DPA exists, this is a critical finding — the Privacy Policy makes a public claim that a DPA is in force. | Yes |
| DP-002 | Finding | DPO Review Pack v1.1 §§2.2, 4.2, 4.4, 6 | High | The DPO Review Pack references "the Layer 2 DPIA" as an authoritative document underpinning the lawful basis analysis for derived index scores. This DPIA was not provided in the document pack and does not appear to have been completed. | Obtain the Layer 2 DPIA or confirm it has not been prepared. If unprepared, this is a material gap given the nature of the processing (automated profiling of athletes using scraped data). | Yes |
| DP-003 | Finding | DPO Cover Note (list of 7 documents); document pack (4 received) | Medium | The DPO Cover Note lists 7 documents submitted for DPO review. Only 4 were provided to STZA: Privacy Policy v4.0, Cookie Policy v1.0, Fund Your Passion Terms v1.0, and the Cover Note itself. Missing: Annexure A (Identity), Annexure B-1 (BuntuAI Architecture), Annexure B-2 (Scraper Directory), Annexure B-4 (BuntuAI Technical Overview). These intelligence annexures describe the actual scraping and AI processing architecture. | Request the missing annexures. These are essential to assessing the data collection and processing architecture, particularly the lawful basis for scraping and AI-derived profiling. | Yes |
| DP-004 | Finding | All documents | High | Every document in the pack is addressed to or prepared for "the Data Protection Officer." All sign-off blocks are blank. There is no evidence a DPO (PDPL) or Information Officer (POPIA) has been appointed. The entire document set has "interim-use status pending final counsel sign-off" (Annexure H). | Confirm whether a DPO/IO has been appointed. If not, assess readiness for appointment as part of the deliverables. Note: this is precisely what our engagement is designed to address. | Yes |

### Accountability and controller identity

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-005 | Finding | Privacy Policy v4.0 (ProTouch as controller); FAQ v1.1 Q5 (Podium Pursuit "being established as a separate entity"); DPO Review Pack §4.6 (UAE registration, entity separation) | Medium | ProTouch Sports (Pty) Ltd is named as responsible party/controller in all public-facing documents. However, Podium Pursuit is described as UAE-registered and being spun out as a separate entity. The DPO Review Pack §4.6 correctly identifies the accountability question during and after entity separation, but no resolution is documented. | Clarify the intended controller structure: who is accountable during the transition, and who will be accountable post-separation? The Privacy Policy will need updating to reflect the final structure. | Yes |
| DP-006 | Confirmation required | Privacy Policy v4.0 (references Information Regulator); Annexure H (lists registration as "Planned") | Medium | Both policies reference the Information Regulator as the supervisory authority. Annexure H lists Information Officer registration as "Planned" rather than "Operational." No registration number appears in any document. | Confirm Information Officer registration status. If not registered, assess timeline and requirements. Evidence of registration was not provided. | Yes |

### Jurisdictional coverage

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-007 | Confirmation required | Privacy Policy v4.0 (lists POPIA, GDPR, Swiss FADP — no UAE PDPL); Annexure H §corridor posture (lists POPIA, UAE PDPL, GDPR); DPO Review Pack §4.6 (UAE registration) | Medium | The Privacy Policy does not mention the UAE PDPL at all, despite other documents in the pack describing the platform entity as UAE-registered and Annexure H identifying UAE PDPL as a key regulatory corridor. The FAQ (Q22) also omits UAE PDPL, listing only POPIA, GDPR, and Swiss FADP. | Confirm whether the public Privacy Policy should describe the applicability of the UAE PDPL, given the stated UAE platform structure elsewhere in the document suite. | Yes |
| DP-008 | Confirmation required | Privacy Policy v4.0 (applies GDPR to EEA data subjects); Annexure H (lists EU representative as "Planned") | Medium | The Privacy Policy claims GDPR applicability for EEA data subjects. Annexure H lists EU representative appointment under Article 27 as "Planned" rather than "Operational." The platform appears to contemplate EEA data subjects. | Confirm the Article 27 representative position. If EEA data subjects are being processed, the need for an EU representative should be confirmed with legal counsel. | Yes |
| DP-009 | Confirmation required | Privacy Policy v4.0 (lists Swiss FADP as applicable); no Swiss representative mentioned | Low | The Privacy Policy lists the Swiss FADP as an applicable regime. No Swiss representative is mentioned and no explanation is provided of how Swiss data subjects are identified or handled differently from GDPR subjects. | Confirm whether Swiss FADP coverage requires specific measures beyond GDPR compliance (representative, specific disclosures). | Yes |
| DP-010 | Finding | FAQ v1.1 Q22 (claims POPIA + GDPR + Swiss FADP); Privacy Policy v4.0 (same three regimes); Annexure H (POPIA + UAE PDPL + GDPR); engagement scope (POPIA primary, PDPL observations, GDPR dropped) | Low | The documents are internally inconsistent about which regulatory regimes apply. Different documents cite different combinations. This creates confusion about the actual regulatory posture and may result in incomplete compliance coverage. | Reconcile the regulatory regime list across all documents as part of the assessment. The engagement scope addresses POPIA as primary with PDPL observations. | Yes |

### Operator/processor management

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-011 | Finding | Privacy Policy v4.0 §2 (lists Apify, Anthropic, OpenAI as sub-operators) | Medium | The Privacy Policy names three sub-operators: Apify (scraping, EU/US), Anthropic (narrative analysis, US), and OpenAI (sentiment analysis, US). No DPAs with these processors were provided in the document pack. Cross-border transfers to US-based processors are referenced with SCCs, but no evidence of executed SCCs was provided. | Request DPAs with Apify, Anthropic, and OpenAI, or confirm that none exist. This is already in the engagement scope (section 6, item 3). | Yes |
| DP-012 | Observation | Privacy Policy v4.0 §3; Fund Your Passion Terms v1.0 §8 | Low | Both the Privacy Policy and Terms of Use reference "third-party payment providers" as operators without naming them. Whether the omission matters depends on the actual processing arrangements — many privacy policies describe processor categories rather than naming every vendor. | Review payment processor arrangements during the assessment. Determine whether naming is required under POPIA or whether categorical description is sufficient. | Maybe |

### Automated decision-making and AI governance

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-013 | Confirmation required | Privacy Policy v4.0 §4 (indices "are not general automated decisions"); DPO Review Pack §4.4 (asks DPO to confirm this position) | Medium | The Privacy Policy asserts that the AVI, SPI, CAI, and SVI indices "are not general automated decisions producing legal or similarly significant effects" under Article 22 GDPR / s71 POPIA. This is a legal conclusion. The DPO Review Pack correctly identifies this as requiring DPO confirmation. The AVI directly affects commercial opportunities and sponsorship valuation, which could be argued as "similarly significant." | Assess the automated decision-making position as part of the POPIA compliance review. This requires careful analysis of whether the index scores produce effects that meet the threshold. STZA will note this as a confirmation-required item, not assert a conclusion. | Yes |

### Operational readiness

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-014 | Observation | FAQ v1.1 Q17, Q32; DPO Review Pack §2.2, §4.2; Introduction Primer (7-day contest commitment); Privacy Policy v4.0 §9 (30-day data subject request period) | Low | Multiple documents commit publicly to resolving contested Index scores within 7 days. The Privacy Policy provides 30 days for data subject requests. These appear to be two distinct processes: an operational SLA for index contests and a statutory response period for POPIA section 23 requests. They can coexist if described properly, but should be investigated to confirm they are not presented as the same process. | Verify during document review that the 7-day contest commitment and the 30-day statutory period are clearly distinguished in all relevant documents. If they are being conflated, recommend clarification. | Yes (if conflated) |
| DP-015 | Finding | FAQ v1.1 Q39 ("athlete-backed securities" decision "still open"); DPO Review Pack §4.7 ("That business decision has now been made") | Low | Internal inconsistency between documents regarding whether the decision on financial products / athlete-backed securities has been finalised. Likely version lag rather than a substantive conflict, but indicates the document set has not been fully reconciled. | Flag as part of the document consistency review. Recommend reconciliation of all documents to a single consistent position. | Yes |
| DP-016 | Finding | Annexure H (overall); multiple documents | Medium | The document suite demonstrates sophisticated governance design: layered lawful bases, DPIAs, legitimate interests analysis, AI governance frameworks, operator management, international transfer mechanisms, and contest mechanisms. However, several governance artefacts that underpin these statements either have not been supplied or are described as "Planned" rather than "Operational." This is a gap between governance maturity (high) and operational maturity (developing). This is the central finding of the pre-engagement review. | Frame the assessment around the operational maturity gap. The architecture is sound; the evidence base needs to catch up. This is exactly what a readiness assessment is designed to address. | Yes (as framing) |

### Digital assets and emerging areas

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| DP-017 | Outside scope | Privacy Policy v4.0 §3.2 (mentions "Super Fan Token participation" and "wallet address") | N/A | The Privacy Policy references Super Fan Tokens and wallet addresses — a crypto/blockchain element not discussed in detail elsewhere in the document pack. Potential regulatory implications exist but are not assessed as part of this engagement. | Consider specialist review if the Super Fan Token functionality is developed further. Note as outside scope in the findings report only if specifically relevant. | No (unless requested) |

### Pre-engagement intelligence (internal only — not for client report)

| Ref | Classification | Evidence | Risk | Finding | Recommendation | Client-facing |
|---|---|---|---|---|---|---|
| INT-001 | Internal | Google Play / Apple App Store metadata | N/A | Blocksport AG confirmed as the app developer/publisher via app store research. App store data safety declarations may contain discrepancies with the Privacy Policy. Rebecca described the platform as using "a white-label platform" without naming Blocksport. | Reserve for assessment phase. Compare app store declarations against Privacy Policy during the platform walkthrough. Do not reference independent app store research in the scope or pre-engagement communications. | No |
| INT-002 | Internal | protouch.africa live site review | N/A | The ProTouch website showed limited evidence of cookie consent implementation at time of review. The Cookie Policy describes a consent banner and preference centre that may not be operational. | Verify during the platform walkthrough (scope section 4.4). | No |
| INT-003 | Internal | Privacy Policy v4.0 §2 (describes Blocksport "write-back" mechanism for BuntuAI scores) | N/A | The Privacy Policy describes enriched BuntuAI data being written back to Blocksport's infrastructure. This means AI-derived profiling scores are being stored on a third-party platform. The DPA should address this specifically — it's not standard operator processing. | Examine the Blocksport DPA (if provided) for specific coverage of write-back / enriched data storage. If the DPA is generic, this is a finding. | No (becomes client-facing finding during assessment) |

---

## Document inventory

| # | Document | Version | Date | Provided | Status |
|---|---|---|---|---|---|
| 1 | Podium Pursuit Privacy Policy | v4.0 | June 2026 | Yes | Interim — pending DPO review |
| 2 | Podium Pursuit Cookie Policy | v1.0 | June 2026 | Yes | Interim — pending DPO review |
| 3 | DPO Review Pack — Positioning Change | v1.1 | 8 July 2026 | Yes | All response columns blank |
| 4 | Annexure H — Data Protection | Undated | Unknown | Yes | Self-assessed as "current" |
| 5 | Fund Your Passion Terms of Use | v1.0 | 8 July 2026 | Yes | Active |
| 6 | Podium Pursuit Complete FAQ | v1.1 | Unknown | Yes | Active |
| 7 | Podium Pursuit Introduction Primer | Undated | Unknown | Yes | Active |
| 8 | DPO Cover Note | Undated | 8 July 2026 | Yes | Lists 7 documents; 4 provided |
| 9 | Annexure A — Identity | Unknown | Unknown | No | Referenced in Cover Note |
| 10 | Annexure B-1 — BuntuAI Architecture | Unknown | Unknown | No | Referenced in Cover Note |
| 11 | Annexure B-2 — Scraper Directory | Unknown | Unknown | No | Referenced in Cover Note |
| 12 | Annexure B-4 — BuntuAI Technical Overview | Unknown | Unknown | No | Referenced in Cover Note |
| 13 | Layer 2 DPIA | Unknown | Unknown | No | Referenced in DPO Review Pack |
| 14 | Blocksport AG DPA | Unknown | Unknown | No | Referenced in Privacy Policy |
| 15 | Apify DPA | Unknown | Unknown | No | Sub-operator per Privacy Policy |
| 16 | Anthropic DPA | Unknown | Unknown | No | Sub-operator per Privacy Policy |
| 17 | OpenAI DPA | Unknown | Unknown | No | Sub-operator per Privacy Policy |
| 18 | PAIA Section 51 manual | Unknown | Unknown | No | Required under PAIA |
| 19 | Breach notification procedure | Unknown | Unknown | No | Expected governance artefact |
| 20 | Information Regulator registration | N/A | Unknown | No | Status unknown |

---

## Version history

| Version | Date | Author | Changes |
|---|---|---|---|
| v1.0 | 24 July 2026 | STZA (NM) | Initial register — pre-engagement findings from document pack review |

---

*This register is an STZA internal working paper. It is subject to the NDA dated 26 June 2026 but is not a client deliverable. The client-facing findings report will be produced as part of the engagement deliverables.*

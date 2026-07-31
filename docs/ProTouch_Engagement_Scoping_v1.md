# ProTouch / Podium Pursuit — engagement scoping

**Prepared:** 22 July 2026
**Author:** Nik Mladenovic, CA(SA), STZA
**Status:** Internal working document — not for client distribution
**Classification:** Confidential, subject to mutual NDA v6 (executed 26 June 2026)

---

## 1. Context and constraints

Rebecca Eliot (ProTouch Sports) has submitted a document pack of 8 documents for DPO/IO review and sign-off. Before committing to that role, two prerequisites must be satisfied:

**Insurance.** Professional indemnity insurance covering DPO (UAE PDPL) and IO (POPIA) scope is not yet in place. Until it is, STZA can only provide consulting and advisory services — not act as, or hold itself out as, the appointed DPO or Information Officer. Any engagement letter must be explicit that this is a data protection readiness assessment, not a DPO appointment.

**PDPL training.** The Data Privacy Office EU UAE PDPL course (~GBP 500-700) has not been completed. Until it is, PDPL-specific advice should be limited to observations and flagged as requiring specialist confirmation. POPIA advice can be given with confidence (Moonstone Managing POPIA + i2 Comply Advanced Online Data Protection and GDPR credentials held).

**Practical consequence:** the engagement is scoped as a **Data Protection Readiness Assessment** — a consulting engagement that produces a gap analysis and recommendations, explicitly not a DPO/IO sign-off.

---

## 2. Document pack assessment

### 2.1 What was received

| # | Document | Version | Format | Quality |
|---|---|---|---|---|
| 1 | DPO Cover Note | — | .docx | Good — clear framing of what is being submitted and what remains open |
| 2 | DPO Review Pack — Positioning Change | v1.1 | .docx | Strong — substantive repositioning with explicit DP commitments |
| 3 | Annexure H — Data Protection (investor-facing) | — | .docx | Substantially current; two optional alignment updates noted |
| 4 | Fund Your Passion — Terms of Use | v1.0 | .docx | Clean; POPIA-aligned definitions |
| 5 | Complete FAQ | v1.1 | .docx | Comprehensive project explainer |
| 6 | Privacy Policy | v4.0 | .pdf | Interim pending DPO review — see findings below |
| 7 | Cookie Policy | v1.0 | .pdf | Clean structure, good practice |
| 8 | Introduction Primer | — | .pdf | Narrative overview, not a compliance document |

### 2.2 What is missing from the pack

The Cover Note references work done but several supporting documents have not been provided:

| Missing document | Why it matters | Priority |
|---|---|---|
| **DPIA (Data Protection Impact Assessment)** | The Positioning Change doc references DPIA for L2 (Derived Index) processing. Without seeing it, the lawful basis chain cannot be verified. | Critical |
| **PAIA Section 51 manual** | POPIA requires every private body to have a PAIA manual filed with the Information Regulator. Not referenced anywhere. | Critical |
| **Blocksport DPA** | Referenced as updated but not provided. Blocksport is the primary operator/processor. | High |
| **Apify DPA / processing terms** | Apify (web scraper) is listed as an operator in the Privacy Policy. Processing agreement status unknown. | High |
| **Anthropic / OpenAI DPAs** | Listed as operators for AI analysis. Need to confirm: (a) DPAs in place, (b) model training opt-out confirmed, (c) data retention terms. | High |
| **Information Regulator registration** | ProTouch should be registered as a responsible party with the IR. Status not documented. | High |
| **Internal process documentation** | The Cover Note mentions this as something Rebecca was asked to provide. Not in the pack. | Medium |
| **U18 removal evidence** | Cover Note says under-18 athletes have been removed. No evidence of the process or completeness. | Medium |

### 2.3 Cross-document findings

**Finding 1: U18 inconsistency (medium risk).** The main system has an absolute under-18 exclusion for athletes. The Fund Your Passion Terms of Use (section on usage) references an 18+ requirement but includes a guardian consent provision for minors. This likely applies to donors/fans rather than athletes, but the drafting is ambiguous. The Privacy Policy and the FAQ both state an unqualified U18 exclusion. The ToU should be aligned — either clarify that the guardian consent applies only to the crowdfunding donor side (not athlete profiles), or remove it if Fund Your Passion also excludes minors entirely.

**Finding 2: Four-layer architecture not reflected in Privacy Policy (medium risk).** The Positioning Change doc makes the four-layer data architecture public (L1 Public Record, L2 Derived Index, L3 Enriched Profile, L4 Commercial Matching) with escalating lawful bases. The Privacy Policy v4.0 does not map its data categories to these four layers. This is the alignment gap the Cover Note itself identifies. Until the Privacy Policy reflects the four layers, there is a disconnect between what ProTouch commits to publicly and what the legal document says.

**Finding 3: DPO/IO referenced as if appointed (low risk, but misleading).** Annexure H and other documents reference a DPO as part of the governance structure. No DPO or IO is appointed. This is not misleading in an investor document (it describes the target posture), but any document that states a DPO "is" in place rather than "will be" appointed needs correction.

**Finding 4: Lawful basis for web scraping needs DPIA support (high risk).** The system uses Apify to scrape public data. The claimed lawful basis is legitimate interest (public record). Post-Clearview AI (multiple EU DPA enforcement actions, Italian Garante EUR 20m fine March 2022), blanket reliance on legitimate interest for systematic scraping of biometric-adjacent data (athlete photos, performance records) requires a documented DPIA with a balancing test. The DPIA has not been provided.

**Finding 5: AI processing transparency (medium risk).** Anthropic and OpenAI are listed as operators. The Privacy Policy discloses this, which is good practice. However: (a) it is unclear whether athlete data is sent to these providers in identifiable form or pseudonymised first, (b) model training opt-out status is not documented, (c) the data retention and deletion terms with these providers are not specified. Given the regulatory trajectory (EU AI Act, POPIA condition 7 security safeguards), this needs tighter documentation.

**Finding 6: Cross-border transfer mechanisms incomplete (medium risk).** The Privacy Policy and Cookie Policy both acknowledge cross-border transfers (to Switzerland for Blocksport, to the US for Anthropic/OpenAI/potentially Apify). POPIA section 72 requires either adequate protection, binding corporate rules, consent, or contractual terms. The specific transfer mechanism for each operator is not documented. GDPR requires SCCs or adequacy decisions. The Cookie Policy references Google's processing terms but the Privacy Policy does not specify the mechanism for each operator.

**Finding 7: Cookie consent implementation unclear (low risk).** The Cookie Policy describes a cookie preference centre and banner. It is unclear whether these are actually implemented on the live platform or are aspirational. If the platform is live and serving analytics cookies without a consent mechanism, that is an ePrivacy (and by extension POPIA) gap.

**Finding 8: No breach notification procedure documented (medium risk).** POPIA section 22 requires notification to the Information Regulator and data subjects "as soon as reasonably possible" after a breach. UAE PDPL has similar requirements. No breach notification procedure has been provided. For a system processing data on 6,000+ athletes across 62 nations, this is a material gap.

### 2.4 Live surface findings (app stores and website — 23 July 2026)

These findings were identified by reviewing the live Google Play listing, Apple App Store listing, and protouch.africa website. None of this was covered in the document pack.

**Finding 9: App store privacy policy mismatch (high risk).** The Podium Pursuit Africa app is published on both Google Play (package: `io.protouch.app`) and Apple App Store (ID: 1548631900) by **Blocksport AG** (Zug, Switzerland), not ProTouch. Both stores link to Blocksport AG's privacy policy at blocksport.io/privacy-policy — NOT the ProTouch/Podium Pursuit Privacy Policy v4.0 submitted for review. Users downloading and using the app are governed by a completely different privacy policy than the one Rebecca submitted. This is a fundamental disconnect: the ProTouch privacy posture we were asked to review has no legal connection to the actual app that fans download and use.

**Finding 10: Google Play declares data is not encrypted (medium risk).** The Google Play Data Safety section states "Data isn't encrypted." For an app processing personal data (contact info, user IDs, device IDs) on users across multiple jurisdictions, unencrypted data is a POPIA section 19 (security safeguards) concern and a GDPR Article 32 concern. This needs verification — it may be a Blocksport declaration issue rather than a technical reality, but it is what users and regulators see.

**Finding 11: Google Play "no data shared" contradicts Privacy Policy (medium risk).** Google Play declares "No data shared with third parties." The Privacy Policy v4.0 lists Blocksport AG, Apify, Anthropic, and OpenAI as operators/processors who receive personal data. Either the Data Safety declaration is inaccurate, or the data flows differ between the app and the web platform. Either way, there is a mismatch between what Google Play tells users and what the privacy documentation states.

**Finding 12: Age rating vs chat functionality and U18 policy (low-medium risk).** The app is rated 3+ (Google Play) / 4+ (Apple App Store). Apple notes the app "Contains Messaging and Chat." The Podium Pursuit system has an absolute U18 exclusion for athletes, but the app is a fan platform — are fan users permitted to be under 18? If children can register and use the chat features, there are additional POPIA obligations for processing children's data (section 35: prior consent of a competent person, i.e. parent/guardian). The age rating suggests children are expected users. The Fund Your Passion ToU guardian consent provision (Finding 1) adds to this ambiguity.

**Finding 13: No cookie consent mechanism on protouch.africa (medium risk, confirmed).** Finding 7 from the document review flagged this as unclear. The live website confirms it: protouch.africa has no visible cookie banner or consent mechanism. The Cookie Policy v1.0 describes a preference centre and banner that do not appear to be implemented. The privacy policy PDF is hosted on a different subdomain (`buntuai.podiumpursuit.africa/privacy-policy-06-26.pdf`), linked from the footer. If analytics or advertising cookies are being served without consent, this is an ePrivacy and POPIA gap.

**Finding 14: No structured DSAR mechanism (low risk).** The website provides only a general email contact (rebecca@protouch.africa). There is no dedicated data subject request form, portal, or documented channel for exercising rights under POPIA section 23-25 or GDPR Articles 15-22. For an organisation processing data on 6,000+ athletes, a structured DSAR intake mechanism should exist.

**Finding 15: In-app purchases and digital collectibles (observation).** The Apple App Store lists in-app purchases ($0.99 each) for "SUPER FANS" digital collectibles by country (Algeria, Angola, Benin, etc.). The Google Play listing references "Fan Pass Tokens" and "Fan Investor Tokens" as upcoming features. If tokens have financial characteristics, this may engage financial services regulation (FSCA in South Africa, SCA in UAE) alongside data protection. This is beyond our scope but should be flagged to ProTouch for independent legal advice.

**Source URLs (accessed 23 July 2026):**
- Google Play: https://play.google.com/store/apps/details?id=io.protouch.app&hl=en
- Apple App Store: https://apps.apple.com/us/app/podium-pursuit-africa/id1548631900
- ProTouch website: https://protouch.africa
- App-linked privacy policy: https://blocksport.io/privacy-policy/

---

## 3. Engagement scope — Data Protection Readiness Assessment

### 3.1 What this engagement is

A fixed-fee consulting engagement to assess ProTouch Sports / Podium Pursuit's data protection compliance posture and produce a prioritised gap analysis with recommendations. It is scoped as advisory work under STZA's existing consulting practice.

### 3.2 What this engagement is not

This engagement does not constitute:
- Appointment as Data Protection Officer (UAE PDPL)
- Appointment as Information Officer (POPIA)
- Legal advice (Nik is CA(SA), not an attorney; legal questions to be referred to Grant Morgan or another qualified attorney)
- Sign-off or certification of any document
- Ongoing monitoring or retainer services (those would follow as a separate Stage 2 engagement)

### 3.3 Proposed deliverables

| # | Deliverable | Description |
|---|---|---|
| 1 | **Document pack gap analysis** | Review of the 8 submitted documents plus any additional documents received, identifying gaps, inconsistencies, and areas requiring attention. Cross-referenced against POPIA requirements; observations (not formal advice) on PDPL and GDPR. |
| 2 | **Missing documents register** | Itemised list of documents that should exist but have not been provided (DPIA, PAIA manual, operator DPAs, breach procedure, IR registration confirmation). Priority-ranked. |
| 3 | **Compliance findings report** | Structured findings by domain (lawful basis, data subject rights, cross-border transfers, security, breach management, special categories, operator management). Each finding rated by severity and mapped to the relevant POPIA section. |
| 4 | **Remediation roadmap** | Prioritised action plan with estimated effort, sequenced by regulatory risk. Distinguishes between what ProTouch can do themselves and what requires professional input. |
| 5 | **DPO/IO readiness assessment** | Assessment of whether the organisation is ready for a DPO/IO appointment, and what would need to be in place before STZA would accept such an appointment. |

### 3.4 What is needed from ProTouch to start

Before the assessment can commence, Rebecca should provide:

1. DPIA (referenced in the Positioning Change document)
2. Blocksport DPA (referenced as updated)
3. Apify processing terms or DPA
4. Anthropic and OpenAI processing terms, including model training opt-out confirmation
5. Information Regulator registration status (confirmation or registration number)
6. PAIA Section 51 manual (or confirmation that one does not exist)
7. Internal data protection processes and procedures (however informal)
8. Evidence of the U18 athlete removal process
9. Access to the live platform for a brief walkthrough (cookie consent, privacy notice placement, data subject request mechanism)

### 3.5 Pricing

**Settled at GBP 2,000** — first engagement, relationship-building pricing. Below the Stage 1 DPO review benchmark (GBP 4,500-6,000) and below the consulting-only range initially considered (GBP 3,000-4,000). Effective rate ~GBP 400/day across ~5 days. Accepted on the basis that this is the first client through the practice, the scope has been capped to 3 regions, and the engagement builds the operational template for future work.

| Element | Amount | Notes |
|---|---|---|
| Fixed fee — readiness assessment | GBP 2,000 | POPIA primary assessment + PDPL/GDPR observations |
| Estimated effort | ~5 days | Document review, platform walkthrough, report drafting, one feedback session |
| Payment terms | 50% on engagement (GBP 1,000), 50% on delivery (GBP 1,000) | Standard STZA terms |
| Out-of-scope work | GBP 550/day | Any work beyond the 5 deliverables above, agreed in writing |

**Jurisdictional scope cap:** POPIA is the primary assessed jurisdiction. UAE PDPL and EU GDPR are covered as cross-reference observations only — material gaps flagged but not formally assessed. Deeper PDPL and GDPR assessments can be offered as follow-on engagements at a separate fee.

**Note on GDPR tooling:** The AfricanSTN compliance OS does not yet have EU GDPR requirements loaded in the knowledge base. GDPR observations will be manual. GDPR knowledge base build is a separate workstream.

**Entity:** STZA (Sports Tech Africa Limited, UK) contracts for the engagement. If and when the engagement progresses to DPO/IO appointment, the entity structure (STZA for DPO, AfricanSTN for IO) will be confirmed with Grant Morgan.

### 3.6 Timeline

| Week | Activity |
|---|---|
| 1 | Receive outstanding documents from Rebecca; initial document review |
| 2 | Complete document review; platform walkthrough; draft findings |
| 3 | Complete findings report and remediation roadmap; internal QA |
| 4 | Deliver final report; one feedback session with Rebecca |

### 3.7 Prerequisites before sending to Rebecca

1. ~~Grant Morgan input on engagement structure and entity~~ — **descoped** (not being brought in at this stage)
2. ~~Decision on whether to quote at the lower end or mid-range~~ — **settled at GBP 2,000** (relationship-building, first client)
3. ~~Engagement letter drafted~~ — **draft v2 complete** (`STZA_ProTouch_Engagement_Scope_Draft_v1.md`), needs final review
4. ~~Soften section 3~~ — **done** (renamed to "Scope boundaries and next steps", reframed positively)
5. **Nik final read-through** — then send to Rebecca

---

## 4. Mapping to the AfricanSTN compliance OS

### 4.1 Current OS capability

The AfricanSTN information system has a compliance engine (V1 POPIA-only + V2 multi-jurisdiction) that can support this engagement operationally. The relevant components:

| Component | Status | Relevance to ProTouch |
|---|---|---|
| **Prospects pipeline** | Live | ProTouch/Podium Pursuit should be added as a prospect |
| **Client management** | Live | Convert to client when engagement starts |
| **V2 document ingest** | Live (API) | Can ingest Privacy Policy, Cookie Policy via URL from protouch.africa |
| **V2 knowledge base** | Live | POPIA requirements loaded; UAE PDPL partially loaded |
| **V2 assessment engine** | Live | Can run automated assessment against ingested documents |
| **Remediation board** | Live | Can track remediation items from the assessment |
| **Breach register** | Live | Available for breach tracking if/when DPO role is active |
| **DSAR tracking** | Live | Available for data subject request management |
| **Audit trail** | Live | All actions logged |

### 4.2 What to do now

**Step 1: Add ProTouch as a prospect in the pipeline.**
- Company: ProTouch Sports (Pty) Ltd
- Website: protouch.africa
- Contact: Rebecca Eliot, Co-Founder
- Privacy Policy URL: (to be confirmed — check if live at protouch.africa/privacy or similar)
- Status: Engaged (NDA signed)

**Step 2: Convert to client when engagement letter is signed.**
- Triggers creation in clients table with contact records
- Enables document ingest and assessment runs

**Step 3: Ingest documents via V2 engine.**
- Privacy Policy v4.0 — ingest via URL if published, or via API document upload
- Cookie Policy v1.0 — same approach
- Fund Your Passion Terms of Use — via upload (not typically at a public URL)
- Other documents (FAQ, Positioning Change, Annexure H) — these are internal/investor docs, not compliance documents per se, but could be ingested for cross-reference

**Step 4: Run V2 POPIA assessment.**
- The engine will analyse ingested documents against the POPIA knowledge base
- Produces automated findings that can then be reviewed and refined manually
- Gives a baseline compliance score

**Step 5: Layer manual findings on top.**
- The automated assessment catches keyword-level gaps
- The cross-document findings (section 2.3 above) are manual observations that need to be added as additional findings
- The missing documents register items become remediation board entries

### 4.3 OS gaps to address for this engagement

| Gap | Impact | Fix |
|---|---|---|
| **Document upload UI missing** | Cannot upload non-web documents (DPIA, PAIA manual, DPAs) through the frontend. API supports it but no UI. | Build document upload component (Claude Code backlog item) |
| **V2 pipeline URL guessing** | Pipeline appends /privacy, /privacy-policy to company website rather than using actual URLs. ProTouch may have non-standard URL paths. | Fix pipeline to use prospect record URL fields (Claude Code backlog item) |
| **Manual finding entry** | No UI to add manual findings (the cross-document issues). Findings are only created by the automated engine. | Add manual finding creation to the client workspace |
| **PDPL knowledge base incomplete** | UAE PDPL requirements may not be fully loaded. Until PDPL training is complete, this is low priority. | Complete after PDPL training |

### 4.4 Value of running through the OS

Running this engagement through the OS serves three purposes:

1. **Operational IP.** The ProTouch engagement becomes the template for how STZA delivers compliance advisory. Every step, finding, and remediation item is captured in the system rather than in ad-hoc documents.

2. **Demonstration.** A completed assessment in the OS is a live demo of the compliance engine's capability — useful for future client acquisition and for the AfricanSTN data protection offering.

3. **Quality assurance.** The automated assessment provides a baseline that catches gaps the manual review might miss, and vice versa. Two-pass coverage.

---

## 5. Recommended sequence of actions

| # | Action | Owner | Dependency | Status |
|---|---|---|---|---|
| 1 | Send Rebecca a list of documents still needed (section 3.4) | Nik | None | Ready to send |
| 2 | Get Grant Morgan's input on engagement structure | Nik | Sent instruction on 26 June — follow up | Pending |
| 3 | Enrol in Data Privacy Office EU UAE PDPL course | Nik | None — can run concurrently | Pending |
| 4 | Obtain PI insurance quotes | Nik | Grant Morgan broker recommendation | Blocked on #2 |
| 5 | Add ProTouch as prospect in OS pipeline | Nik / Claude Code | OS access | Ready |
| 6 | Draft engagement letter (consulting scope, not DPO) | Nik + Claude | Grant Morgan input (#2), pricing decision | Blocked on #2 |
| 7 | Build document upload UI in OS | Claude Code | Backlog item | Ready to build |
| 8 | Fix V2 pipeline URL handling | Claude Code | Backlog item | Ready to build |
| 9 | Receive outstanding documents from Rebecca | Rebecca | #1 sent | Waiting |
| 10 | Convert ProTouch to client in OS; ingest documents; run V2 assessment | Nik | Engagement signed (#6), documents received (#9) | Blocked |

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Acting as DPO without insurance | Low (awareness is high) | Critical — personal liability, SAICA disciplinary | Engagement letter explicitly scopes as consulting, not DPO appointment. No sign-off authority. |
| Providing PDPL advice without adequate training | Medium | High — incorrect advice, liability | Limit PDPL content to observations flagged as requiring specialist confirmation. Complete training before any formal PDPL advisory. |
| Rebecca interprets consulting as DPO commitment | Low | Medium — expectation mismatch | Clear engagement letter. Separate Stage 2 for DPO appointment with distinct prerequisites. |
| Scope creep — engagement expands beyond readiness assessment | Medium | Medium — unpaid work, resource drain | Fixed fee with explicit out-of-scope day rate. Deliverables list is closed. |
| Clearview-adjacent scraping risk for ProTouch | Medium | High — regulatory action against ProTouch, reputational risk for STZA if associated | Flag in findings report. Recommend DPIA with balancing test. STZA's assessment, not endorsement. |
| SAICA ethics — independence if future co-founder relationship | Low (current) | High | Grant Morgan to advise on independence. If co-founder discussion advances, DPO/IO role becomes conflicted and must be declined. |

---

*End of scoping document.*

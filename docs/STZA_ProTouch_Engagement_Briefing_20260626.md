# STZA / ProTouch engagement — cowork briefing
**Prepared:** 26 June 2026
**Purpose:** Hand-off summary for a cowork agent to review the documents produced for the ProTouch / Podium Pursuit engagement and the STZA internal capability build.
**Author of source work:** Claude session with Nik Mladenovic (STZA, AfricanSTN).
---
## 1. Situation summary
Rebecca Eliot (Co-Founder, ProTouch Sports (Pty) Ltd / Podium Pursuit) has approached Nik about becoming her external fractional Data Protection Officer (UAE, under PDPL) and Information Officer (South Africa, under POPIA) for the Podium Pursuit venture.
The relationship is under mutual NDA (v6, executed 26 June 2026 both sides). Rebecca has completed a compliance clean-up (updated privacy policies, cookie policy, DPA with Blocksport, removed under-18 athletes, aligned to POPIA/GDPR). She has asked for a proposal.
Nik has replied by WhatsApp acknowledging the work, saying he will review and come back with terms next week, and has followed up by email with a request for the underlying compliance documents (privacy policy, cookie policy, Blocksport DPA, U18 controls, internal processes) so he can conduct a proper review.
Nik's position: the DPO/IO engagement is not a given. Before committing, he wants:
1. To review the compliance material Rebecca sends through
2. To sort professional indemnity insurance covering DPO/IO scope
3. Comfort with the structural and legal position (via commercial attorney Grant Morgan)
4. To use the engagement to shake down STZA's internal practice systems in the background — she experiences a polished professional engagement, Nik uses the engagement as the crucible for building the practice's operational IP
## 2. Documents produced during this work
All documents listed below have been produced by Claude in collaboration with Nik across the session. They live in the Claude session outputs directory and need to be moved to STZA's canonical file locations.
### 2.1 Client-facing documents (ProTouch-specific)
| Document | Version | Path | Status |
|---|---|---|---|
| Mutual NDA (baseline) | v1 | `/mnt/user-data/outputs/STZA_AfricanSTN_x_ProTouch_Mutual_NDA_v1.docx` | Superseded |
| Mutual NDA | v2 | `/mnt/user-data/outputs/STZA_AfricanSTN_x_ProTouch_Mutual_NDA_v2.docx` | Superseded |
| Mutual NDA | v3 | `/mnt/user-data/outputs/STZA_ProTouch_Mutual_NDA_v3.docx` | Superseded |
| Mutual NDA | v4 | `/mnt/user-data/outputs/STZA_ProTouch_Mutual_NDA_v4.docx` | Superseded |
| Mutual NDA | v5 | `/mnt/user-data/outputs/STZA_ProTouch_Mutual_NDA_v5.docx` | Superseded |
| Mutual NDA | v6 | `/mnt/user-data/outputs/STZA_ProTouch_Mutual_NDA_v6.docx` | EXECUTED both sides 26 Jun 2026 |
| ProTouch / Podium Pursuit — Working Audit | v1 | `/mnt/user-data/outputs/ProTouch_Podium_Pursuit_Working_Audit_v1.docx` | Internal working document |
| ProTouch / Podium Pursuit — Working Audit | v1.1 | `/mnt/user-data/outputs/ProTouch_Podium_Pursuit_Working_Audit_v1_1.docx` | Latest internal audit |
**Note on the NDA sequence.** Evolution v1 → v6 involved: party simplification (folding AfricanSTN into the STZA Group definition rather than as a separate signatory); governing law choice cycling through and settling on South African law; addition of a non-circumvention clause (clause 4); a no-obligation-to-proceed clause (11.7); notices provision (11.8); Business Day definition (1.3); an assignment-with-continuing-liability clause (11.5) allowing ProTouch to assign to its future UAE entity with continuing liability unless a novation is agreed; a 5-year survival period from the later of disclosure or termination; a deliberate-misuse liability carve-out (10.4); and a data protection clause referencing POPIA, UK GDPR and PDPL/DIFC/ADGM. Rebecca signed and returned v6 with a mirror paragraph extending her side's protection to Podium Pursuit and named IP (BuntuAI, Intelligence Engine of the Athlete Economy, Athlete Value Index, Social Value Index, Commercial Activation Index) whether or not incorporated. Nik reviewed the changes, was comfortable, and signed as-is on the CA(SA) ethics-and-integrity principle of avoiding drama.
### 2.2 STZA internal capability documents (reusable across future engagements)
| Document | Version | Path | Purpose |
|---|---|---|---|
| POPIA and PDPL — convergences, divergences, and operational implications | v1.0 | `/mnt/user-data/outputs/STZA_Internal_POPIA_PDPL_Reference_v1.docx` | Internal STZA reference for cross-border data protection advisory work in SA and UAE. ~14 pages, 7 sections plus cross-reference table. Not client-facing. |
| Combined fractional DPO (UAE) and IO (SA) — Role Specification | v1.0 | `/mnt/user-data/outputs/STZA_DPO_IO_Role_Specification_v1.docx` | Reusable STZA template for the dual-regime fractional appointment. ~14 pages, 10 sections plus person specification appendix. Client-shareable (redacted or in full depending on engagement). |
| STZA / AfricanSTN — Licensed Access Architecture Considerations | v1.0 | `/mnt/user-data/outputs/STZA_AfricanSTN_Licensed_Access_Architecture_Considerations_v1.docx` | Internal note on licensed-access data architecture (informed by a specific lesson learned but neutrally framed). ~8 sections. |
| AfricanSTN — Technical Briefing | v1.1 | `/mnt/user-data/outputs/AfricanSTN_Technical_Briefing_v1_1.docx` | For sharing under NDA. Architecture and methodology at principle level; withholds sources, taxonomy detail, and model config as editorial IP. **HOLD — needs registration number correction from 2026/02895/07 → 2026/020895/07 in sections 1 and 7 before any send. Nik holding until (a) NDA signed [now done] and (b) online registry demo-ready.** |
### 2.3 Codebase and operational documents
| Document | Path | Purpose |
|---|---|---|
| CLAUDE.md | `/mnt/user-data/outputs/CLAUDE.md` | Standing context file for the `astn-information-system` dashboard repo. Includes schema facts, brand rules, deployment settings, deployment gotchas. Belongs at the root of the dashboard repo. |
| Day 1 Quick Start | `/mnt/user-data/outputs/Day1_Quick_Start.md` | Guide for the dashboard Day 1 build. |
| Day 1 Fix bundle v2 | `/mnt/user-data/outputs/day1-fix-v2/` | Four fix files (overview.ts, registry-page.tsx, RecentItemsFeed.tsx, README.md) addressing six bugs identified in the initial Day 1 deployment. |
| Backup Runbook (WIF) | `/mnt/user-data/outputs/BACKUP_RUNBOOK_v2_WIF.md` | Operational runbook for the nightly backup pipeline (GitHub Actions → GCS `stza-africanstn-db-backups`, europe-west2, WIF auth). |
| Backup README | `/mnt/user-data/outputs/README_BACKUP.md` | Companion README for the backup bundle. |
| Backup bundle | `/mnt/user-data/outputs/astn-database-backup-bundle.zip` | Complete initial backup pipeline scaffolding. |
## 3. Suggested filing locations in the shared drive
| Document | Suggested location |
|---|---|
| Executed NDA v6 | `I:\Shared drives\Clients\Pro touch Africa & Podium Pursuit\NDA\` |
| ProTouch Working Audit v1.1 | `I:\Shared drives\Clients\Pro touch Africa & Podium Pursuit\Working notes\` |
| POPIA/PDPL Reference v1.0 | `I:\Shared drives\Clients\stza\Knowledge base\Data protection\` |
| DPO/IO Role Specification v1.0 | `I:\Shared drives\Clients\stza\Knowledge base\Practice templates\` |
| Licensed Access Architecture note | `I:\Shared drives\Clients\stza\Knowledge base\Architecture\` |
| AfricanSTN Technical Briefing v1.1 | `I:\Shared drives\Clients\stza\AfricanSTN\Information system\Briefings\` |
| Dashboard code files (CLAUDE.md, day1-fix-v2) | `C:\Dev\astn-information-system\` (working) plus commit to GitHub `Nik-STZA/astn-information-system` |
| Backup runbook | `C:\Dev\astn-sports-database\` (working) plus commit to GitHub `Nik-STZA/astn-sports-database` |
## 4. What is decided and settled
- **NDA is executed.** Rebecca signed and returned v6; Nik reviewed her changes, confirmed comfort with them (the added paragraph extending her side to Podium Pursuit and named IP is reciprocal to the STZA Group extension); Nik signed as-is and returned by email.
- **The DPO/IO engagement is not committed.** Nik is reviewing before responding with terms.
- **Fee structure benchmarked.** UK fractional DPO market: dominant SME band EUR 1,150-2,900/mo (GBP 1,000-2,500), premium/multi-jurisdictional GBP 5,000+/mo. SA outsourced IO: ZAR 8,000-25,000/mo (GBP 350-1,100). Podium Pursuit sits in the upper-middle for dual-regime complexity. Proposed structure: Stage 1 review GBP 4,500-6,000 fixed fee (split ~GBP 3,500 STZA + ~GBP 1,500 AfricanSTN); Stage 2 retainer GBP 2,000-2,500/mo combined (split ~GBP 1,400-1,800 STZA DPO + GBP 600-700 AfricanSTN IO); out-of-scope day rate GBP 750-950; 12-month term with 90-day notice.
- **Entity structure proposed but not confirmed.** Lean toward STZA contracting for the DPO piece and AfricanSTN contracting for the IO piece, with matched insurance in each jurisdiction. Grant Morgan (commercial attorney, not CA) to confirm.
- **Credentials position clarified.** Nik holds Moonstone (Managing POPIA) and i2 Comply (Advanced Online Data Protection and GDPR). Recommended top-up: Data Privacy Office EU UAE PDPL course (~GBP 500-700) as the jurisdiction-specific overlay. IAPP CIPP/E as a longer-term consideration for Q4 2026 / Q1 2027.
- **Tooling stack decided (revised through the session).** ClickUp for project and task management; Xero Projects for time tracking (removes Harvest, ~GBP 130/yr saved); Xero for accounting (separate STZA UK and AfricanSTN SA orgs); Google Workspace for documents and eSignature (removes DocuSign, ~GBP 120/yr saved); Supabase Pro upgrade needed ($25/mo) before any client compliance data lands; GitHub for the practice knowledge base, templates, client audit working notes (private repos); HubSpot Free or in-ClickUp CRM. Total new annual spend ~GBP 320. **Notion to be phased out** — Nik does not enjoy the interface; Feldspar audit content already exists as canonical markdown files in the shared drive, so the Notion pages are mirrors that can be retired; research agent and LinkedIn workflows will be replaced by pages in the AfricanSTN dashboard (Day 4 and Day 5 of the build).
- **Approach to Rebecca engagement decided.** Use the engagement in the background to shake down STZA's internal systems (templates, methodology, tooling, quality bar). She never sees this — she experiences a polished professional engagement. Two-tier internal notes discipline: engagement notes (client-specific, subject to NDA) versus practice notes (abstracted lessons stripped of her specific facts).
## 5. What is pending or in progress
Priority order:
1. **Grant Morgan engagement.** Nik to send a short instruction email to Grant Morgan (commercial attorney, BCom LLB, 15 years, focus on incorporation/investment/exit) engaging him formally as legal adviser on the ProTouch structuring, tax treatment (STZA UK vs AfricanSTN SA vs personal), PI broker recommendation, and independence-vs-co-founder question. NDA clause 1.2 covers professional advisers as Authorised Recipients so no separate consent needed from Rebecca.
2. **PI insurance quote.** Two policies likely: STZA UK PI covering DPO/UAE scope; AfricanSTN SA PI covering IO/POPIA scope. Retroactive cover, run-off cover, regulator-facing cover, DPO/IO named specifically. Broker recommendation from Grant.
3. **Compliance material from Rebecca.** Email request sent on 26 June 2026 for: updated privacy policy, cookie policy, Blocksport DPA, description of U18 controls, internal process documentation. Nik to review as the basis for the Stage 1 compliance review.
4. **Three NDA-adjacent verifications.** CIPC company register check on 2015/151949/07 at Plettenberg Bay address; protouch.africa domain authenticity; the 2015 vs 2016 registration-year discrepancy from the earlier call.
5. **Engagement letter draft.** Applies the DPO/IO Role Specification (v1.0) to ProTouch-specific facts with proposed pricing, service levels, indemnities, entity structure. Wait for Grant's input on structure and insurance quote before finalising.
6. **AfricanSTN Technical Briefing correction.** Fix registration number 2026/02895/07 → 2026/020895/07 in sections 1 and 7 before any send. Hold until online registry demo-ready.
7. **UAE PDPL top-up course enrolment.** Data Privacy Office EU course. Not blocker for engagement start — can be underway concurrently.
8. **Dashboard Day 1 fix deployment confirmation.** Files at `/mnt/user-data/outputs/day1-fix-v2/` — need confirmation these have been deployed via Claude Code session, or re-run.
9. **Dashboard Days 2 and 3.** Registry browser (filters, pagination, detail pages, edit form); profile report builder.
10. **Dashboard Days 4 and 5** (post-Rebecca engagement start, informed by real engagement needs). Pipeline review page replacing Notion Pipeline Items; LinkedIn Drafts page replacing Notion LinkedIn Drafts. Research agent to be reconfigured to stop writing to Notion once the dashboard pages work.
11. **Supabase Pro upgrade** ($25/mo, signs DPA). Should happen before any client compliance data lands.
12. **RLS fix** on `organizations_backup_2026_05_13_pre_review` (still has RLS disabled — 5-minute ALTER TABLE).
13. **Provenance review** of the AfricanSTN registry (audit of rows sourced from paid trial of an external provider whose ToS prohibits scraping; Nik has decided not to commercialise the data and to disengage from that provider).
14. **ClickUp workspace setup** — one space per client, one space for AfricanSTN registry work, one space for general STZA operations.
15. **GitHub practice knowledge base setup** — private repo(s) for STZA knowledge base (POPIA/PDPL reference, role spec, templates, policies, skills definitions), separate repo for client audit working notes (Feldspar existing, ProTouch/Podium Pursuit new).
16. **Notion phase-out** — stop dual-maintaining Feldspar audit pages; move research agent review UI to dashboard; leave Notion archive in place; cancel any paid plan once nothing active remains.
## 6. What would benefit from cowork agent review
If the cowork agent's role is to critique the work rather than continue it, the highest-value review targets are:
- **POPIA/PDPL Reference v1.0.** Is the substantive law accurate? Are the cross-references correct? Are the practical implications sensible? Anything missing?
- **DPO/IO Role Specification v1.0.** Does it stand up as a professional services template? Are the service levels realistic? Are the independence provisions correct? Would a serious client take it seriously?
- **Proposed fee structure and market benchmarking.** Are the numbers defensible? Are the splits between STZA and AfricanSTN sensible? Is the year-one total (~GBP 28,500-36,000) justified for the complexity level?
- **The approach to using Rebecca's engagement as a background shakedown for STZA's internal systems.** Is the two-tier notes discipline (engagement notes vs practice notes) sound? Are there NDA risks in the approach that have been under-weighted?
- **The tooling stack decisions.** Is ClickUp + Xero Projects + Google Workspace + GitHub + Supabase Pro genuinely the right stack, or is there a better alternative? Is the phase-out of Notion the right call given Feldspar's existing usage pattern?
- **The credentialing position.** Is Moonstone + i2 Comply + a Data Privacy Office EU top-up genuinely sufficient for the dual role, or is IAPP CIPP/E needed before the engagement starts rather than as a Q4 2026 add?
## 7. Key contextual facts a reviewer needs to know
- Nik is CA(SA) — the SAICA code and ethics/integrity framework guides many of the decisions in this thread.
- Nik is moving to Johannesburg near-term; the JHB move is confirmed and shapes the SA-law choice on the NDA.
- STZA is Sports Tech Africa Limited (UK, Companies House 16850337, incorporated 12 Nov 2025); AfricanSTN is African Sports Technology Network (Pty) Ltd (SA, reg 2026/020895/07, IR registration 2026-002350).
- Nik has professional indemnity through SAICA (accounting scope) — DPO/IO scope needs to be checked as an extension or a separate policy.
- Rebecca is a warm, pre-existing relationship. The engagement is genuinely wanted on both sides. The care in structure is about doing it properly, not about hedging against a difficult counterparty.
- Feldspar Sports is STZA's largest active engagement — separate from ProTouch. Feldspar-related audit content should not be mentioned to Rebecca and vice versa; keep boundaries clean.
---
*End of briefing.*

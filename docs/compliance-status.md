# Compliance engine — working status & resume notes

**Last updated:** 2026-07-26. Rolling status/handoff for the STZA/AfricanSTN data-protection
compliance service. Read alongside `docs/compliance-engine-principles.md` (the invariants + lessons).

---

## Entity & compliance state

Two distinct legal entities in a group, linked by an Intragroup Data Transfer Agreement.

| | Sports Tech Africa Ltd (UK) | African Sports Technology Network (Pty) Ltd (SA) |
|---|---|---|
| Client record id | `44e44f01-5af1-426e-98da-87d84ed7632a` | `c2083a18-58db-4c1a-80f0-fbc26c6169e0` |
| Company reg | UK | 2026/020895/07 |
| Regimes | UK/EU GDPR **+ POPIA** (SA data incl. juristic persons) | POPIA |
| Assessments | GDPR #8 (54/100, keyword) · **POPIA #11 (60/100, dual-model)** | **POPIA #9 (60/100, dual-model)** |
| Remediation board | GDPR (4) + POPIA (2) | POPIA (2) |
| Regulators | ICO (GDPR) · IR **2026-062278** (POPIA) | IR **2026-002350** (POPIA) |
| PAIA manual | **needs its own** (generate — mode 2) | has one (ingested) |

**Shared instrument:** one joint privacy policy (stza.io), copied to both records preserving
`content_hash` (the shared-document key). STZA's own board already carries GDPR+POPIA for it, so no
cross-entity merge is needed yet.

### Real POPIA gaps found (dual-model, both entities — same joint policy)
- **Special Personal Information (s26-33)** — "we do not *directly* collect..." (should be
  *intentionally*); flagged, models disagreed → your review.
- **Breach Notification (s22)** — generic public clause; the internal playbook covers it but
  mis-cites s22(4) for the publicity direction (should be **s22(5)**). Resolution already refined.

The keyword engine had marked all 10 POPIA domains "present" (flat 70) — the dual-model engine is
what surfaced these. That's the false-present fix.

---

## What is built & deployed (all live)

- **Dual-model assessment engine** — Gemini + Claude read the documents, judge each requirement
  present/partial/absent with a verified verbatim quote, adjudicate (disagree → conservative +
  review). `server-lib-assessment.js` + `server-assessment-v2-routes.js`. UI: gold "Run dual-model
  assessment" button on the client panel (vs fast "Run keyword analysis").
- **Jurisdiction-native remediation board** — `compliance_remediation` (migration 023), fed by real
  assessment findings, grouped by jurisdiction, framework-agnostic. `server-remediation-v2-routes.js`.
- **Dual-model resolution engine** — per finding: gaps + redraft + citations, cross-checked.
  Prompt refined to tag **[Statutory]** vs **[Enhancement]**, route to the right instrument,
  distinguish subsections, conditional role framing, verify prescribed forms.
  `server-lib-resolution.js`.
- **Radar** — reads the real assessment's `domain_scores` (not heuristics).
- **Document generation — mode 1 (amendment schedule / redline pack)** — `server-document-gen-routes.js`
  + `src/lib/reports/amendmentSchedule.ts`. Button "Download amendment schedule (.docx)" on the
  remediation tab. Per document, per clause: current gap → proposed wording, tagged
  Statutory/Enhancement with citation + regime. Confirmed-only unless "include drafts" ticked.

Backend = Cloud Run (`africastn-api`), frontend = Cloud Run (Next.js), both via GitHub Actions.

---

## Resume here → drive the full cycle

Goal: a complete amendment schedule for the joint privacy policy (and per-instrument docs).

1. **Generate resolutions on every board item** (both boards). Currently only 4 have resolutions
   (STZA: Accountability, DSR; AfricanSTN: Special Info, Breach). Open each remaining item →
   "Generate resolution".
2. **Review & confirm** each resolution (the human-adjudication step). Pay attention to the
   `needs_review` / model-disagreement flags — those are where the models diverged.
3. **Download the amendment schedule** (confirmed-only) per client → the redline pack for counsel.

---

## Backlog / next builds

- **Document generation mode 2 — template generation**: STZA's PAIA manual from AfricanSTN's PAIA
  template, parameterised (STZA Ltd, IR 2026-062278, its IO, record categories), "pending legal review".
- **ChatGPT/OpenAI as 3rd model** (2-of-3 quorum) — parked at your request; needs OpenAI key in
  Secret Manager, then `callOpenAIJudge` in `server-lib-assessment.js` + 3-way adjudicate.
- STZA needs its own processor register + ROPA (currently all on AfricanSTN).
- T&Cs — parked until GTM/public (must then meet ISO 27001/27701).

---

## Ops notes

- **Cloud SQL access:** `scratchpad/cloud-sql-proxy.exe africanstn-research:europe-west1:africastn-db
  --port 15432 --gcloud-auth` (background) + node/pg on 127.0.0.1:15432. `DB_PASSWORD` from
  `gcloud secrets versions access latest --secret=db-password`.
- **gcloud auth expires mid-session** → the proxy starts resetting connections (`ECONNRESET`).
  Fix: run `! gcloud auth login`, then kill + relaunch the proxy from the scratchpad.
- Deployed API calls use the `api-key` secret (not the proxy), so they survive proxy death.

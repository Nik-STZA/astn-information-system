# Compliance engagement SOP

Standard operating procedure for running a client compliance engagement through
the STZA OS. Written 22 July 2026 after the first full self-assessment
(Sports Tech Africa Ltd) surfaced the process requirements below.

## Principles

1. **Never assume the client's position.** The assessment engine identifies
   gaps; it does not know the client's business reality. Every gap must be
   shared with the client and their input requested before a remediation
   position is documented. (Example from the STA self-assessment: the Special
   Personal Information finding was resolved by the principal confirming no
   special-category data is held — a position statement, not a new control.
   An assumption either way would have been wrong.)
2. **Everything on the record.** Each engagement step is logged as a
   compliance activity (Compliance → client panel → + Activity) so the audit
   trail shows what was done, when, by whom, and on what basis.
3. **Client documents stay client-scoped.** Where an engagement exposes STZA
   to client special-category data, the engagement letter governs it and
   access remains restricted to the client.

## Standard workflow

| # | Step | Where in the tool | Record kept |
|---|---|---|---|
| 1 | Onboard client (convert from prospect — carries IR verification and links the records) | Compliance → prospect panel → Convert to client | `activity_type: onboarding` |
| 2 | Ingest document suite (privacy policy, terms, PAIA manual, DTA, incident response, security policies) | Run compliance analysis (URL docs); direct uploads via API until the upload UI ships | document store (hash-deduplicated) |
| 3 | Run assessment (per jurisdiction) | Client panel → select jurisdiction → Run compliance analysis | `analysis_runs` / assessment record |
| 4 | **Share gaps with client and request input** — send the assessment report; for each finding ask: is this a real gap, a documented-position gap, or out of scope? | Assessment report (View full report → print/PDF); log the exchange under Correspondence | `activity_type: gap_analysis` + correspondence entries |
| 5 | Record client positions — only after client input | Tasks (one per agreed action) + Remediation board (generate from findings, then edit per client input) | tasks + remediation items |
| 6 | Remediate — client or STZA performs the work | Remediation board status transitions | remediation item history + audit log |
| 7 | Re-ingest updated documents and re-run assessment | Same as 2–3 | new assessment (score delta = evidence of improvement) |
| 8 | Close the loop — final report to client | Assessment report + closing activity | `activity_type: report` |

## Process improvement log

Maintained here so the SOP itself has an audit trail. Add an entry whenever
the process changes and why.

- **2026-07-22** — Initial SOP. Drivers from the STA self-assessment:
  (a) conversion previously created unlinked client records, stranding IR
  verification on the prospect — fixed with prospect_id linkage + Convert
  button; (b) no document upload UI — direct ingestion via API used as the
  interim; upload UI on the roadmap; (c) findings → remediation generation
  existed but was not discoverable — now part of the standard workflow
  (step 5); (d) client-input principle adopted (principle 1) — gaps are
  shared and confirmed, not assumed.

## Roadmap items this SOP depends on

- Document upload UI (PAIA manuals and other non-URL documents)
- Client input request flow — a shareable gap summary with per-finding
  client responses captured against the assessment
- Template generation — produce client-ready draft documents (PAIA manual,
  DTA, incident response, privacy policy) from STZA templates, parameterised
  per client, always marked "pending client legal review"

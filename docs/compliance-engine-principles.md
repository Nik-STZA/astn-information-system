# Compliance engine — design principles & lessons

This document governs every build and rebuild of the STZA / AfricanSTN multi-jurisdiction
compliance engine. It exists because the engine is becoming a **productised, subscription
service**: correctness compounds, and every rebuild must be a genuine improvement on the last,
not a re-introduction of a past mistake. **Read this before changing the engine; append to the
Lessons log when a rebuild corrects something.**

## Invariants (must hold in every version)

1. **Jurisdiction-agnostic by construction.** No framework name may be hardcoded in engine logic
   — not POPIA, not GDPR, not any future law. Everything derives from data:
   `compliance_jurisdictions → compliance_domains → compliance_requirements → assessment_findings`,
   with the statutory citation read from `compliance_requirements.legislation_ref`.
   **Acceptance test:** adding a new country (e.g. Nigeria NDPA, Kenya DPA) must be a pure
   data-seed operation — seed the jurisdiction, domains, requirements, evidence keywords — with
   **zero code change**. Run an assessment and its findings, remediation, board grouping, and
   citations all appear automatically. If any new jurisdiction needs a code change to show up,
   the build has failed this invariant.

2. **One record per legal person.** A client record represents exactly one legal entity
   (its own registration, its own responsible party / controller, its own regulator). Groups are
   modelled as multiple linked records, never conflated. The responsible party can differ per
   jurisdiction; never assume the trading name is the legal entity.

3. **No implicit matching across entities.** Never resolve a client to related data by
   company_name, trading name, or any fuzzy key. Use explicit ids. Name-matching silently
   cross-wires entities in a group and is prohibited.

4. **The V2 engine is the single source of truth.** Remediation, scores, and the radar read the
   real assessment (`compliance_assessments` / `assessment_findings`), never the legacy V1 prospect
   pipeline (`prospect_analysis` / `prospect_assessments`). V1 is legacy; do not extend it.

5. **Dual-model + human adjudication, always.** Findings and resolutions are produced by
   independent models, cross-checked, and quote-verified against source text. Model agreement is
   **not** proof of correctness (models share blind spots) — a human review step is mandatory
   before anything is client-facing. Client personal data only flows through **DPA-covered** AI
   tiers.

6. **Everything on record, reversibly.** Every generated artifact cites a requirement + evidence;
   every state change is audit-logged; destructive regeneration is scoped to a single
   (client, assessment) pair and never touches another entity's data.

7. **Migrations are forward-only and idempotent.** Versioned, `IF NOT EXISTS` / `ON CONFLICT`,
   safe to re-run. App-owned tables only (see Lesson 2026-07-25c).

## Lessons log (what we did wrong, so we don't repeat it)

Append here whenever a rebuild corrects a real defect. Date + one-line cause + the rule it created.

- **2026-07-25a — Entity conflation.** One client record ("Sports Tech Africa Ltd") held two
  distinct legal entities' data: the UK company (GDPR controller) and African Sports Technology
  Network (Pty) Ltd (SA, the POPIA responsible party). → Invariant 2. Fix: split into two records,
  POPIA content stayed with the SA entity.

- **2026-07-25b — Framework hardcoding.** The remediation generator hardcoded POPIA
  (`POPIA_REFS`, `popia_reference` column) so a GDPR assessment still produced POPIA-referenced
  items. → Invariant 1. Fix: jurisdiction-agnostic bridge reading `assessment_findings` +
  `legislation_ref`.

- **2026-07-25c — Name-matching landmine + un-alterable legacy table.** The V1 generator matched
  client→prospect **by company_name**; after the entity split the UK record matched the leftover
  prospect and generated the wrong-jurisdiction items, **wiping the other entity's board**. Root
  cause: `remediation_items` is owned by `app_user` (app can't ALTER it) and its FKs bind it to the
  V1 prospect pipeline (`prospect_assessments`, `prospect_analysis`), so it cannot even hold a V2
  assessment link. → Invariants 3 & 4. Fix: new app-owned, jurisdiction-native
  `compliance_remediation` table (migration 023); retire the V1 name-matching generator for
  compliance clients.

- **2026-07-25d — Radar invented scores.** The compliance radar computed arbitrary heuristics from
  operational tables instead of reading `domain_scores`. → Invariant 4. Fix: radar reads the real
  assessment, falls back to clearly-labelled heuristics only when no assessment exists.

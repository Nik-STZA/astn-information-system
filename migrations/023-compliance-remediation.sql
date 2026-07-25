-- 023 — Jurisdiction-native remediation board (V2 engine)
--
-- WHY (see docs/compliance-engine-principles.md, Lesson 2026-07-25c):
-- The legacy `remediation_items` table is owned by app_user (the app can't ALTER it) and its
-- foreign keys bind it to the V1 prospect pipeline (assessment_id -> prospect_assessments,
-- finding_id -> prospect_analysis). It therefore CANNOT hold a link to a V2 assessment or finding,
-- and its POPIA-shaped columns (popia_reference) hardcode a single framework. This migration
-- introduces an app-owned, jurisdiction-agnostic remediation table fed directly by the V2 engine
-- (compliance_assessments / assessment_findings). Adding a new country requires NO change here —
-- jurisdiction_code + legal_reference carry whatever framework the assessment used.
--
-- Ownership: created by africastn_app (app-owned) so future migrations can ALTER it.
-- Soft references (no cross-owner FKs) because compliance_assessments/assessment_findings are
-- postgres-owned and compliance_clients is app_user-owned; app-level integrity is enforced in the
-- route layer. This mirrors the existing remediation_resolutions pattern.

CREATE TABLE IF NOT EXISTS compliance_remediation (
  id                 SERIAL PRIMARY KEY,
  client_id          UUID    NOT NULL,           -- soft ref compliance_clients(id)
  assessment_id      INTEGER NOT NULL,           -- soft ref compliance_assessments(id)  [V2]
  finding_id         INTEGER,                    -- soft ref assessment_findings(id)      [V2]
  jurisdiction_code  TEXT    NOT NULL,           -- 'gdpr' | 'popia' | 'uae_pdpl' | 'swiss_fadp' | any future
  domain_code        TEXT,                       -- compliance_domains.code
  requirement_code   TEXT,                       -- compliance_requirements.code
  legal_reference    TEXT,                       -- statutory citation, ANY framework (from legislation_ref)
  category           TEXT,                       -- domain name (human label)
  title              TEXT    NOT NULL,           -- requirement name
  description        TEXT,                       -- the finding_text (the gap)
  severity           TEXT,                       -- critical | high | medium | low
  finding_status     TEXT,                       -- source finding status: absent | partial
  recommendation     TEXT,
  status             TEXT    NOT NULL DEFAULT 'open',   -- open | in_progress | resolved | verified | accepted_risk
  assigned_to        TEXT,
  due_date           DATE,
  started_date       DATE,
  resolved_date      DATE,
  verified_date      DATE,
  verified_by        TEXT,
  resolution_summary TEXT,
  evidence_urls      TEXT[],
  created_by         TEXT    DEFAULT 'nik@stza.io',
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Board queries: by client, grouped/filtered by jurisdiction.
CREATE INDEX IF NOT EXISTS idx_comp_remediation_client_jur
  ON compliance_remediation (client_id, jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_comp_remediation_assessment
  ON compliance_remediation (assessment_id);

-- One remediation item per (assessment, finding): lets regeneration be an idempotent upsert
-- scoped to a single assessment, so it never touches another entity's board (Invariant 6).
CREATE UNIQUE INDEX IF NOT EXISTS uq_comp_remediation_assessment_finding
  ON compliance_remediation (assessment_id, finding_id)
  WHERE finding_id IS NOT NULL;

-- Resolutions (migration 022) link to the new board via a distinct column so legacy
-- remediation_item_id values never collide with new compliance_remediation ids.
ALTER TABLE remediation_resolutions
  ADD COLUMN IF NOT EXISTS remediation_id INTEGER;   -- soft ref compliance_remediation(id)
CREATE INDEX IF NOT EXISTS idx_remediation_resolutions_remediation_id
  ON remediation_resolutions (remediation_id);
-- One resolution per V2 remediation item (enables ON CONFLICT upsert from the generator).
CREATE UNIQUE INDEX IF NOT EXISTS uq_remediation_resolutions_remediation_id
  ON remediation_resolutions (remediation_id) WHERE remediation_id IS NOT NULL;

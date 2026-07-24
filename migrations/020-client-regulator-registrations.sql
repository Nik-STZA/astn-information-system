-- Migration 020: Jurisdiction-aware regulator registrations
-- Date: 24 July 2026
-- Purpose: The compliance_clients table has a single POPIA-centric
--          `ir_registration_number` (SA Information Regulator). A multi-jurisdiction
--          service needs to capture registration with the RELEVANT regulator per
--          jurisdiction — UK ICO (GDPR), Information Regulator (POPIA), UAE Data
--          Office (PDPL), FDPIC (Swiss). This normalises that.
--
-- Registration status is also assessment evidence (an attestation): e.g. ICO
-- registration supports the GDPR Accountability & Governance domain, but it is a
-- client-record fact, NOT something in the privacy policy — so it must be fed to
-- the assessor as attestation evidence, not extracted from documents.
--
-- Idempotent. Run against Cloud SQL (africastn_os).

BEGIN;

CREATE TABLE IF NOT EXISTS client_regulator_registrations (
    id                   SERIAL PRIMARY KEY,
    client_id            UUID NOT NULL REFERENCES compliance_clients(id) ON DELETE CASCADE,
    jurisdiction_code    TEXT NOT NULL,   -- gdpr | popia | uae_pdpl | swiss_fadp
    regulator            TEXT NOT NULL,   -- 'UK ICO', 'Information Regulator (SA)', 'UAE Data Office', 'FDPIC'
    registration_number  TEXT,
    registration_date    DATE,
    status               TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered', 'pending', 'not_required', 'exempt', 'unknown')),
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, jurisdiction_code, regulator)
);

CREATE INDEX IF NOT EXISTS idx_client_regulator_registrations_client
    ON client_regulator_registrations(client_id);

-- ── Seed Sports Tech Africa Ltd (STZA) — its known registrations ─────────────

-- UK ICO (GDPR — STZA is UK-registered, so this is its primary regulator).
-- Principal-attested: registered. Number left null pending confirmation (the
-- legacy compliance_clients.ir_registration_number 2026-062278 is in the
-- SA-Information-Regulator field; confirm whether that is the ICO or the SA IR ref).
INSERT INTO client_regulator_registrations (client_id, jurisdiction_code, regulator, registration_number, status, notes)
SELECT id, 'gdpr', 'UK ICO', NULL, 'registered',
       'Principal-attested ICO registration (UK GDPR / DPA 2018 data protection fee). Confirm registration number.'
FROM compliance_clients WHERE company_name = 'Sports Tech Africa Ltd'
ON CONFLICT (client_id, jurisdiction_code, regulator) DO NOTHING;

-- Carry the existing SA Information Regulator value across (if present) so it is
-- captured jurisdiction-aware too. Treated as the SA IR number per its field name.
INSERT INTO client_regulator_registrations (client_id, jurisdiction_code, regulator, registration_number, registration_date, status, notes)
SELECT id, 'popia', 'Information Regulator (South Africa)', ir_registration_number, ir_registration_date::date,
       CASE WHEN ir_registration_number IS NOT NULL THEN 'registered' ELSE 'unknown' END,
       'Migrated from compliance_clients.ir_registration_number.'
FROM compliance_clients
WHERE company_name = 'Sports Tech Africa Ltd' AND ir_registration_number IS NOT NULL
ON CONFLICT (client_id, jurisdiction_code, regulator) DO NOTHING;

COMMIT;

-- Verify:
--   SELECT cc.company_name, r.jurisdiction_code, r.regulator, r.registration_number, r.status
--   FROM client_regulator_registrations r JOIN compliance_clients cc ON cc.id=r.client_id
--   ORDER BY cc.company_name, r.jurisdiction_code;

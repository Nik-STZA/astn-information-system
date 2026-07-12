-- Migration 007: IR register verification fields on compliance_prospects
-- Date: 12 July 2026
-- Purpose: Support verified IR registration status rather than manual boolean.
-- See: popia-engine-improvement-roadmap.md, Gap 1, Phase B.
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=130.211.64.150 dbname=africastn user=africastn_app" -f 007-ir-verification.sql

BEGIN;

-- ─── Add verification columns to compliance_prospects ──────────────────────

DO $$
BEGIN
    -- When was the IR register last checked for this prospect?
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_verified_date'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_verified_date DATE;
    END IF;

    -- How was verification performed?
    -- manual_portal = operator searched eservices.inforegulator.org.za
    -- automated     = agent-based verification (future Phase C)
    -- assumed       = not verified, value assumed from prior research
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_verification_method'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_verification_method TEXT
            CHECK (ir_verification_method IN ('manual_portal', 'automated', 'assumed'));
    END IF;

    -- Free-text notes from the verification (e.g., search terms used, false positives encountered)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_verification_notes'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_verification_notes TEXT;
    END IF;

    -- The exact entity name found on the IR register (may differ from company_name)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_entity_name'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_entity_name TEXT;
    END IF;

    -- The IR registration number (format YYYY-NNNNNN)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_registration_no'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_registration_no TEXT;
    END IF;

    -- The Information Officer name recorded on the register
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_io_name'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_io_name TEXT;
    END IF;

    -- The IO designation/role recorded on the register
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_io_designation'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_io_designation TEXT;
    END IF;
END $$;

-- ─── Backfill existing rows: mark current ir_registered values as "assumed" ─

UPDATE compliance_prospects
SET ir_verification_method = 'assumed',
    ir_verification_notes = 'Pre-verification: value set during initial research, not verified against IR eServices portal.'
WHERE ir_registered IS NOT NULL
  AND ir_verification_method IS NULL;

COMMIT;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'compliance_prospects'
  AND column_name LIKE 'ir_%'
ORDER BY ordinal_position;

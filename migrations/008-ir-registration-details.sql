-- Migration 008: Additional IR registration detail fields
-- Date: 16 July 2026
-- Purpose: Capture registration date and organisation type from the IR eServices portal.
-- These fields were identified as missing during live testing (Bug #1).
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=130.211.64.150 dbname=africastn user=africastn_app" -f 008-ir-registration-details.sql

BEGIN;

DO $$
BEGIN
    -- The date the entity was registered with the Information Regulator
    -- (distinct from ir_verified_date which is when WE checked the register)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_registration_date'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_registration_date DATE;
    END IF;

    -- Organisation type as classified by the IR: 'Private Body' or 'Public Body'
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'ir_organisation_type'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN ir_organisation_type TEXT
            CHECK (ir_organisation_type IN ('Private Body', 'Public Body'));
    END IF;
END $$;

COMMIT;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'compliance_prospects'
  AND column_name LIKE 'ir_%'
ORDER BY ordinal_position;

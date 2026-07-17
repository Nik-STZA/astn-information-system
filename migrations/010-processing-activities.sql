-- Migration 010: Processing activities (ROPA) and special categories register
-- Date: 17 July 2026
-- Purpose: Structured data capture for POPIA compliance assessments.
--
-- client_processing_activities: Records what personal data the client processes,
--   on what legal basis, for what purpose, and with what safeguards. Foundation
--   for accurate ROPA (Record of Processing Activities) per POPIA s14.
--
-- client_special_categories: Tracks which of the 9 POPIA special personal
--   information categories (s26-33) the client processes, with safeguards
--   and s57 prior authorisation status.
--
-- FK type: UUID — matches compliance_clients.id (UUID PK) and migration 009.
-- Entity PKs: SERIAL — consistent with migration 006 entity tables.
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=<IP> dbname=africastn_os user=africastn_app" -f 010-processing-activities.sql

BEGIN;

-- ─── 1. client_processing_activities ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_processing_activities (
    id                      SERIAL PRIMARY KEY,
    client_id               UUID NOT NULL REFERENCES compliance_clients(id) ON DELETE CASCADE,

    -- What is processed
    activity_name           TEXT NOT NULL,               -- e.g. "Customer account registration"
    description             TEXT,                        -- detailed description of the processing
    personal_data_types     TEXT[],                      -- e.g. ['name', 'email', 'phone', 'ID number']
    data_subject_categories TEXT[],                      -- e.g. ['customers', 'employees', 'website visitors']
    estimated_volume        TEXT,                        -- '<1,000', '1,000-10,000', '10,000-100,000', '100,000+'

    -- Legal basis (POPIA s11)
    legal_basis             TEXT NOT NULL,               -- consent, contract, legal_obligation, legitimate_interest, public_interest, vital_interest
    legal_basis_detail      TEXT,                        -- specific justification

    -- Purpose and retention
    purpose                 TEXT NOT NULL,               -- why this data is processed
    retention_period        TEXT,                        -- e.g. "7 years after contract end"
    retention_basis         TEXT,                        -- legal or business justification for retention

    -- Data flows
    recipients              TEXT[],                      -- who receives the data
    cross_border            BOOLEAN DEFAULT FALSE,
    transfer_countries      TEXT[],                      -- ISO codes of recipient countries
    transfer_mechanism      TEXT,                        -- adequate_protection, consent, binding_rules, contractual

    -- Security
    security_measures       TEXT,                        -- description of safeguards

    -- Metadata
    status                  TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'under_review')),
    last_reviewed           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_activities_client ON client_processing_activities(client_id);
CREATE INDEX IF NOT EXISTS idx_processing_activities_status ON client_processing_activities(status);

-- ─── 2. client_special_categories ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_special_categories (
    id                      SERIAL PRIMARY KEY,
    client_id               UUID NOT NULL REFERENCES compliance_clients(id) ON DELETE CASCADE,

    -- Which category (POPIA s26-33)
    category                TEXT NOT NULL
        CHECK (category IN (
            'religious_beliefs', 'race_ethnicity', 'trade_union',
            'political', 'health', 'sex_life', 'biometric',
            'criminal', 'children'
        )),
    is_processed            BOOLEAN DEFAULT FALSE,      -- does the client process this category?

    -- If processed: what and how
    processing_description  TEXT,                        -- what processing occurs
    volume_estimate         TEXT,                        -- approximate number of data subjects
    legal_basis             TEXT,                        -- consent, employment_law, public_interest, etc.
    safeguards              TEXT,                        -- what protections are in place

    -- IR prior authorisation (s57)
    prior_auth_required     BOOLEAN,                    -- is s57 prior authorisation needed?
    prior_auth_status       TEXT
        CHECK (prior_auth_status IN ('not_required', 'pending', 'submitted', 'approved', 'refused')),
    prior_auth_reference    TEXT,                        -- IR reference number
    prior_auth_date         DATE,                        -- date authorisation granted/submitted

    -- Assessment
    compliance_status       TEXT DEFAULT 'not_assessed'
        CHECK (compliance_status IN ('not_assessed', 'compliant', 'partial', 'non_compliant')),
    last_assessed           TIMESTAMPTZ,
    assessor_notes          TEXT,

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(client_id, category)
);

CREATE INDEX IF NOT EXISTS idx_special_categories_client ON client_special_categories(client_id);
CREATE INDEX IF NOT EXISTS idx_special_categories_category ON client_special_categories(category);

-- ─── 3. updated_at triggers ───────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_processing_activities_updated') THEN
        CREATE TRIGGER trg_processing_activities_updated
            BEFORE UPDATE ON client_processing_activities
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_special_categories_updated') THEN
        CREATE TRIGGER trg_special_categories_updated
            BEFORE UPDATE ON client_special_categories
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;

-- ─── 4. Grant permissions ─────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON client_processing_activities TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_special_categories TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE client_processing_activities_id_seq TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE client_special_categories_id_seq TO africastn_app;

-- Verify
SELECT 'client_processing_activities' AS tbl, count(*) FROM client_processing_activities
UNION ALL
SELECT 'client_special_categories', count(*) FROM client_special_categories;

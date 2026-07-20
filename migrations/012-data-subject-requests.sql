-- Migration 012: Data Subject Requests (DSARs)
-- Date: 20 July 2026
-- Purpose: Track POPIA s23-25 data subject requests (access, correction, deletion)
--          with statutory deadlines, response tracking, and audit integration.
--
-- POPIA timelines:
--   s23 Access request: respond within a "reasonable time" (Regulator guidance: 30 days)
--   s24 Correction/deletion: respond within a "reasonable time" (30 days)
--   s25 Notification to third parties of correction/deletion
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=<IP> dbname=africastn_os user=postgres" -f 012-data-subject-requests.sql

BEGIN;

-- ─── 1. data_subject_requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_subject_requests (
    id                      SERIAL PRIMARY KEY,
    client_id               UUID NOT NULL REFERENCES compliance_clients(id),

    -- Request details
    request_type            TEXT NOT NULL
        CHECK (request_type IN ('access', 'correction', 'deletion', 'objection', 'portability', 'other')),
    description             TEXT,                           -- free-text description of the request

    -- Data subject
    data_subject_name       TEXT NOT NULL,
    data_subject_email      TEXT,
    data_subject_phone      TEXT,
    data_subject_id_type    TEXT,                           -- id_number, passport, other
    data_subject_id_ref     TEXT,                           -- masked reference (do NOT store full ID)
    data_subject_category   TEXT,                           -- customer, employee, supplier, website_visitor, other
    identity_verified       BOOLEAN DEFAULT FALSE,

    -- Workflow
    status                  TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'identity_verification', 'in_progress', 'awaiting_info',
                          'completed', 'refused', 'escalated', 'closed')),
    priority                TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    assigned_to             TEXT,                           -- who is handling this

    -- Dates and deadlines
    received_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    acknowledged_date       DATE,                           -- date we acknowledged receipt
    deadline                DATE,                           -- statutory response deadline (auto: received + 30 days)
    completed_date          DATE,
    closed_date             DATE,

    -- Response
    response_summary        TEXT,                           -- what action was taken
    refusal_reason          TEXT,                           -- if refused, why (POPIA s18 exemptions)
    third_parties_notified  BOOLEAN DEFAULT FALSE,          -- s25: were third parties told of correction/deletion?
    third_party_details     TEXT,                           -- which third parties were notified

    -- Evidence
    evidence_description    TEXT,
    evidence_urls           TEXT[],                         -- links to supporting documents

    -- Metadata
    notes                   TEXT,
    created_by              TEXT NOT NULL DEFAULT 'system',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_client ON data_subject_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_dsar_status ON data_subject_requests(status);
CREATE INDEX IF NOT EXISTS idx_dsar_type ON data_subject_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_dsar_deadline ON data_subject_requests(deadline);
CREATE INDEX IF NOT EXISTS idx_dsar_received ON data_subject_requests(received_date);

-- ─── 2. Auto-set deadline to received_date + 30 days ─────────────────────────

CREATE OR REPLACE FUNCTION set_dsar_deadline()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deadline IS NULL THEN
        NEW.deadline := NEW.received_date + INTERVAL '30 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_dsar_set_deadline') THEN
        CREATE TRIGGER trg_dsar_set_deadline
            BEFORE INSERT ON data_subject_requests
            FOR EACH ROW EXECUTE FUNCTION set_dsar_deadline();
    END IF;
END $$;

-- ─── 3. updated_at trigger ───────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_dsar_updated') THEN
        CREATE TRIGGER trg_dsar_updated
            BEFORE UPDATE ON data_subject_requests
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;

-- ─── 4. Grant permissions ────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON data_subject_requests TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE data_subject_requests_id_seq TO africastn_app;

-- Verify
SELECT 'data_subject_requests' AS tbl, count(*) FROM data_subject_requests;

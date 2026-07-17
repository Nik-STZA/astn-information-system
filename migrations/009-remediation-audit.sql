-- Migration 009: Remediation Items and Audit Log
-- Date: 16 July 2026
-- Purpose: Support client-facing compliance remediation tracking and full audit trail.
--
-- remediation_items: Links each assessment finding to an actionable work item with
-- status tracking, assignment, due dates, and evidence documentation.
--
-- audit_log: Immutable event recording for all compliance actions — suitable for
-- presenting to client, Information Regulator, or any stakeholder.
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=<IP> dbname=africastn_os user=africastn_app" -f 009-remediation-audit.sql

BEGIN;

-- ─── 1. remediation_items ──────────────────────────────────────────────────
-- One row per finding from an assessment, tracking remediation through to verification.

CREATE TABLE IF NOT EXISTS remediation_items (
    id                  SERIAL PRIMARY KEY,
    client_id           UUID NOT NULL REFERENCES compliance_clients(id),
    prospect_id         UUID REFERENCES compliance_prospects(id),
    assessment_id       INTEGER REFERENCES prospect_assessments(id),
    finding_id          INTEGER REFERENCES prospect_analysis(id),

    -- Finding details (denormalised for display without joins)
    category            TEXT NOT NULL,           -- check_category from finding
    title               TEXT NOT NULL,           -- human-readable title
    description         TEXT,                    -- full finding text
    severity            TEXT NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info', 'compliant')),
    popia_reference     TEXT,                    -- e.g. 's55-56', 's72', 's8-12'
    recommendation      TEXT,                    -- recommended action from finding

    -- Remediation tracking
    status              TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved', 'verified', 'not_applicable', 'accepted_risk')),
    assigned_to         TEXT,
    due_date            DATE,
    started_date        DATE,
    resolved_date       DATE,
    verified_date       DATE,
    verified_by         TEXT,

    -- Evidence and resolution
    resolution_summary  TEXT,                    -- what was done to resolve
    evidence_description TEXT,                   -- description of evidence provided
    evidence_urls       TEXT[],                  -- links to supporting documents

    -- Metadata
    created_by          TEXT NOT NULL DEFAULT 'system',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remediation_client ON remediation_items(client_id);
CREATE INDEX IF NOT EXISTS idx_remediation_prospect ON remediation_items(prospect_id);
CREATE INDEX IF NOT EXISTS idx_remediation_assessment ON remediation_items(assessment_id);
CREATE INDEX IF NOT EXISTS idx_remediation_status ON remediation_items(status);
CREATE INDEX IF NOT EXISTS idx_remediation_severity ON remediation_items(severity);
CREATE INDEX IF NOT EXISTS idx_remediation_due ON remediation_items(due_date);

-- ─── 2. audit_log ──────────────────────────────────────────────────────────
-- Immutable event log. No UPDATE or DELETE should ever be run against this table.
-- Every compliance-relevant action gets a row here.

CREATE TABLE IF NOT EXISTS audit_log (
    id                  SERIAL PRIMARY KEY,
    client_id           UUID REFERENCES compliance_clients(id),
    prospect_id         UUID REFERENCES compliance_prospects(id),

    -- What happened
    entity_type         TEXT NOT NULL,            -- 'remediation_item', 'assessment', 'finding', 'engagement', 'io_registration', 'breach_incident'
    entity_id           INTEGER,                  -- PK of the affected row
    action              TEXT NOT NULL,             -- 'created', 'status_changed', 'note_added', 'evidence_attached', 'assessment_generated', 'assigned', 'verified'
    description         TEXT NOT NULL,             -- human-readable description of what happened

    -- Change details (for status changes)
    field_changed       TEXT,                      -- which field changed, if applicable
    old_value           TEXT,
    new_value           TEXT,

    -- Who and when
    performed_by        TEXT NOT NULL,              -- email or system identifier
    performed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Additional context
    metadata            JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_client ON audit_log(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_prospect ON audit_log(prospect_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_performed_at ON audit_log(performed_at);

-- ─── 3. updated_at trigger for remediation_items ───────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_remediation_items_updated') THEN
        CREATE TRIGGER trg_remediation_items_updated
            BEFORE UPDATE ON remediation_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;

-- ─── 4. Grant permissions to API connection user ──────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON remediation_items TO africastn_app;
GRANT SELECT, INSERT ON audit_log TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE remediation_items_id_seq TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO africastn_app;

-- Verify
SELECT 'remediation_items' AS tbl, count(*) FROM remediation_items
UNION ALL
SELECT 'audit_log', count(*) FROM audit_log;

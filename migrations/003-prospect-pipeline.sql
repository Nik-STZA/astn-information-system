-- Migration 003: Prospect Research & Assessment Pipeline
-- Date: 7 July 2026
-- Ref: prospect-research-pipeline-architecture.md
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=130.211.64.150 dbname=africastn user=africastn_app" -f 003-prospect-pipeline.sql

BEGIN;

-- ─── 1. prospect_documents ──────────────────────────────────────────────────
-- Stores URLs and content for each prospect's legal/privacy documents.

CREATE TABLE IF NOT EXISTS prospect_documents (
    id                SERIAL PRIMARY KEY,
    prospect_id       INTEGER NOT NULL REFERENCES compliance_prospects(id) ON DELETE CASCADE,
    document_type     TEXT NOT NULL,
        -- privacy_policy, dpa, terms_of_service, eula, cookie_policy,
        -- sub_processor_list, annual_report, press_release, other
    document_title    TEXT,
    source_url        TEXT,
    snapshot_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    pdf_storage_path  TEXT,          -- GCS path if stored externally
    html_snapshot     TEXT,          -- raw HTML if captured from web
    markdown_content  TEXT,          -- converted markdown for analysis
    conversion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (conversion_status IN ('pending', 'converting', 'converted', 'failed', 'not_needed')),
    conversion_error  TEXT,
    file_hash         TEXT,          -- SHA-256 for change detection
    metadata          JSONB DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_docs_prospect ON prospect_documents(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_docs_type ON prospect_documents(document_type);

-- ─── 2. prospect_analysis ───────────────────────────────────────────────────
-- Structured findings from document analysis against POPIA checklist.

CREATE TABLE IF NOT EXISTS prospect_analysis (
    id                  SERIAL PRIMARY KEY,
    prospect_id         INTEGER NOT NULL REFERENCES compliance_prospects(id) ON DELETE CASCADE,
    document_id         INTEGER REFERENCES prospect_documents(id) ON DELETE SET NULL,
    analysis_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    jurisdiction        TEXT NOT NULL DEFAULT 'POPIA',
    check_category      TEXT NOT NULL,
        -- popia_mention, biometric_classification, cross_border_transfers,
        -- information_officer, data_subject_rights, breach_notification,
        -- consent_mechanism, special_pi_handling, sa_jurisdiction,
        -- sub_processor_compliance, children_data
    finding             TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info', 'compliant')),
    evidence_quote      TEXT,
    evidence_location   TEXT,        -- section/page reference in source document
    recommendation      TEXT,
    agent_model         TEXT,
    agent_version       TEXT,
    human_reviewed      BOOLEAN NOT NULL DEFAULT FALSE,
    reviewer_notes      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_prospect ON prospect_analysis(prospect_id);
CREATE INDEX IF NOT EXISTS idx_analysis_category ON prospect_analysis(check_category);
CREATE INDEX IF NOT EXISTS idx_analysis_severity ON prospect_analysis(severity);
CREATE INDEX IF NOT EXISTS idx_analysis_jurisdiction ON prospect_analysis(jurisdiction);

-- ─── 3. prospect_assessments ────────────────────────────────────────────────
-- Generated assessments that feed the report output.

CREATE TABLE IF NOT EXISTS prospect_assessments (
    id                    SERIAL PRIMARY KEY,
    prospect_id           INTEGER NOT NULL REFERENCES compliance_prospects(id) ON DELETE CASCADE,
    assessment_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    assessment_version    INTEGER NOT NULL DEFAULT 1,
    status                TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'reviewed', 'approved', 'sent', 'superseded')),

    -- Structured scores (0-10 scale, NULL if not assessable)
    score_ir_registration     NUMERIC(3,1),
    score_biometric_handling  NUMERIC(3,1),
    score_cross_border        NUMERIC(3,1),
    score_consent_mechanism   NUMERIC(3,1),
    score_breach_notification NUMERIC(3,1),
    score_data_subject_rights NUMERIC(3,1),
    score_overall             NUMERIC(3,1),

    overall_severity      TEXT
        CHECK (overall_severity IN ('critical', 'high', 'medium', 'low')),

    -- Structured content (drives report generation)
    executive_summary     TEXT,
    risk_factors          JSONB,      -- [{level, factor, note}]
    key_findings          JSONB,      -- [{finding_id, category, severity, finding, evidence}]
    recommendations       JSONB,      -- [{priority, action, rationale}]

    -- Generation metadata
    generated_by          TEXT NOT NULL DEFAULT 'human'
        CHECK (generated_by IN ('agent', 'human')),
    agent_model           TEXT,
    agent_version         TEXT,
    human_reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
    reviewer_notes        TEXT,

    -- Output files
    report_docx_path      TEXT,
    report_pdf_path       TEXT,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_prospect ON prospect_assessments(prospect_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON prospect_assessments(status);

-- ─── 4. Extend compliance_prospects ─────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'research_status'
    ) THEN
        ALTER TABLE compliance_prospects
            ADD COLUMN research_status TEXT NOT NULL DEFAULT 'not_started'
                CHECK (research_status IN (
                    'not_started', 'collecting', 'collected',
                    'analysing', 'analysed', 'assessed', 'complete'
                ));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'last_research_date'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN last_research_date DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'document_count'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN document_count INTEGER NOT NULL DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'finding_count'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN finding_count INTEGER NOT NULL DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_prospects' AND column_name = 'critical_finding_count'
    ) THEN
        ALTER TABLE compliance_prospects ADD COLUMN critical_finding_count INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- ─── 5. updated_at trigger ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prospect_documents_updated') THEN
        CREATE TRIGGER trg_prospect_documents_updated
            BEFORE UPDATE ON prospect_documents
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prospect_assessments_updated') THEN
        CREATE TRIGGER trg_prospect_assessments_updated
            BEFORE UPDATE ON prospect_assessments
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;

-- Verify
SELECT 'prospect_documents' AS tbl, count(*) FROM prospect_documents
UNION ALL
SELECT 'prospect_analysis', count(*) FROM prospect_analysis
UNION ALL
SELECT 'prospect_assessments', count(*) FROM prospect_assessments;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'compliance_prospects'
  AND column_name IN ('research_status', 'last_research_date', 'document_count', 'finding_count', 'critical_finding_count')
ORDER BY ordinal_position;

-- Migration 013: Compliance Analysis Foundation
-- Date: 21 July 2026
-- Purpose: Create the 5-layer compliance analysis architecture tables as specified
--          in compliance-analysis-architecture-v1.md. Seeds POPIA and UAE PDPL
--          jurisdictions with domains, requirements, keywords, and cross-jurisdiction
--          mappings.
--
-- This migration creates:
--   Layer 1: compliance_documents, document_sections
--   Layer 2: compliance_jurisdictions, compliance_domains, compliance_requirements,
--            evidence_keywords, requirement_mappings, ir_monitoring_items
--   Layer 3: compliance_evidence
--   Layer 4: compliance_assessments, assessment_findings
--   Support: compliance_engagements, assessment_document_scope
--
-- Run against Cloud SQL (africastn-research) as postgres user:
--   psql "host=<IP> dbname=africastn_os user=postgres" -f 013-compliance-analysis-foundation.sql

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 2: COMPLIANCE KNOWLEDGE BASE
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 2.1 Legislation registry ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_jurisdictions (
    id              SERIAL PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    short_name      TEXT NOT NULL,
    country_iso     TEXT,
    enacted_date    DATE,
    effective_date  DATE,
    regulator_name  TEXT,
    regulator_url   TEXT,
    version         TEXT NOT NULL DEFAULT '1.0',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    -- Configurable scoring weights per jurisdiction (section 15.1)
    scoring_config  JSONB NOT NULL DEFAULT '{
        "min_weight": 0.30,
        "avg_weight": 0.70,
        "mandatory_domains": []
    }',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2.2 Compliance domains ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_domains (
    id              SERIAL PRIMARY KEY,
    jurisdiction_id INTEGER NOT NULL REFERENCES compliance_jurisdictions(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    display_order   INTEGER NOT NULL DEFAULT 0,
    weight          NUMERIC(3,2) NOT NULL DEFAULT 1.00,

    UNIQUE(jurisdiction_id, code),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2.3 Compliance requirements ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_requirements (
    id              SERIAL PRIMARY KEY,
    domain_id       INTEGER NOT NULL REFERENCES compliance_domains(id),
    jurisdiction_id INTEGER NOT NULL REFERENCES compliance_jurisdictions(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    legislation_ref TEXT,

    -- Finding templates (migrated from POPIA_RULES)
    absent_severity  TEXT NOT NULL DEFAULT 'medium',
    absent_finding   TEXT NOT NULL,
    absent_recommendation TEXT NOT NULL,
    partial_severity TEXT NOT NULL DEFAULT 'medium',
    partial_finding  TEXT NOT NULL,
    partial_recommendation TEXT NOT NULL,
    present_severity TEXT NOT NULL DEFAULT 'low',
    present_finding  TEXT NOT NULL,
    present_recommendation TEXT NOT NULL,

    -- Evidence expectations
    evidence_types   TEXT[] NOT NULL DEFAULT '{}',
    min_evidence_for_present INTEGER NOT NULL DEFAULT 2,
    min_evidence_for_partial INTEGER NOT NULL DEFAULT 1,

    display_order    INTEGER NOT NULL DEFAULT 0,

    UNIQUE(jurisdiction_id, code),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2.4 Evidence keywords ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence_keywords (
    id              SERIAL PRIMARY KEY,
    requirement_id  INTEGER NOT NULL REFERENCES compliance_requirements(id),
    pattern         TEXT NOT NULL,
    pattern_flags   TEXT NOT NULL DEFAULT 'i',
    keyword_class   TEXT NOT NULL DEFAULT 'general'
        CHECK (keyword_class IN ('general', 'jurisdiction_specific', 'negative')),
    weight          NUMERIC(3,2) NOT NULL DEFAULT 1.00,
    description     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_keywords_requirement
    ON evidence_keywords(requirement_id);

-- ─── 2.5 Cross-jurisdiction requirement mappings ────────────────────────────

CREATE TABLE IF NOT EXISTS requirement_mappings (
    id              SERIAL PRIMARY KEY,
    requirement_a   INTEGER NOT NULL REFERENCES compliance_requirements(id),
    requirement_b   INTEGER NOT NULL REFERENCES compliance_requirements(id),
    mapping_type    TEXT NOT NULL DEFAULT 'equivalent'
        CHECK (mapping_type IN ('equivalent', 'similar', 'partial', 'superset', 'subset')),
    notes           TEXT,

    UNIQUE(requirement_a, requirement_b),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2.6 IR monitoring items (POPIA-specific) ──────────────────────────────

CREATE TABLE IF NOT EXISTS ir_monitoring_items (
    id              SERIAL PRIMARY KEY,
    jurisdiction_id INTEGER NOT NULL REFERENCES compliance_jurisdictions(id),
    item_number     INTEGER NOT NULL,
    description     TEXT NOT NULL,
    requirement_ids INTEGER[] NOT NULL DEFAULT '{}',
    evidence_types  TEXT[] NOT NULL DEFAULT '{}',

    UNIQUE(jurisdiction_id, item_number),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 1: DOCUMENT PROCESSING
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_documents (
    id              SERIAL PRIMARY KEY,
    client_id       UUID NOT NULL REFERENCES compliance_clients(id),

    -- Document metadata
    document_type   TEXT NOT NULL DEFAULT 'other'
        CHECK (document_type IN (
            'privacy_policy', 'terms_of_service', 'cookie_policy',
            'data_processing_agreement', 'paia_manual', 'ropa',
            'breach_procedure', 'retention_policy', 'security_policy',
            'training_material', 'consent_form', 'impact_assessment',
            'marketing_policy', 'annual_report', 'other'
        )),
    title           TEXT NOT NULL,
    source_url      TEXT,
    file_path       TEXT,

    -- Content
    raw_content     TEXT,
    processed_content TEXT,
    content_hash    TEXT,
    word_count      INTEGER,
    language        TEXT DEFAULT 'en',

    -- Processing state
    status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'processed', 'error')),
    processing_error TEXT,
    processed_at    TIMESTAMPTZ,

    -- Version tracking
    version         INTEGER NOT NULL DEFAULT 1,
    supersedes_id   INTEGER REFERENCES compliance_documents(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_documents_client
    ON compliance_documents(client_id);

-- ─── Document sections ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_sections (
    id              SERIAL PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES compliance_documents(id) ON DELETE CASCADE,
    section_type    TEXT NOT NULL DEFAULT 'body'
        CHECK (section_type IN (
            'title', 'heading', 'body', 'definition', 'list',
            'table', 'footer', 'legal_reference', 'contact_info'
        )),
    heading         TEXT,
    content         TEXT NOT NULL,
    section_order   INTEGER NOT NULL DEFAULT 0,
    word_count      INTEGER,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_sections_document
    ON document_sections(document_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 3: EVIDENCE EXTRACTION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_evidence (
    id              SERIAL PRIMARY KEY,
    client_id       UUID NOT NULL REFERENCES compliance_clients(id),
    requirement_id  INTEGER NOT NULL REFERENCES compliance_requirements(id),

    -- Source
    document_id     INTEGER REFERENCES compliance_documents(id),
    section_id      INTEGER REFERENCES document_sections(id),

    -- Extraction
    extraction_method TEXT NOT NULL DEFAULT 'keyword'
        CHECK (extraction_method IN (
            'keyword', 'section_analysis', 'entity_extraction',
            'manual_attestation', 'external_verification', 'ai_agent'
        )),
    matched_text    TEXT,
    context_text    TEXT,
    keyword_id      INTEGER REFERENCES evidence_keywords(id),

    -- Structured data from entity extraction
    extracted_entities JSONB,

    -- Confidence
    confidence      TEXT NOT NULL DEFAULT 'medium'
        CHECK (confidence IN ('high', 'medium', 'low', 'very_low')),
    confidence_factors JSONB,

    -- Manual attestation fields
    attested_by     TEXT,
    attestation_date DATE,
    attestation_notes TEXT,

    -- Immutable once created (append-only)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_evidence_client
    ON compliance_evidence(client_id);
CREATE INDEX IF NOT EXISTS idx_compliance_evidence_requirement
    ON compliance_evidence(requirement_id);
CREATE INDEX IF NOT EXISTS idx_compliance_evidence_document
    ON compliance_evidence(document_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SUPPORT: ENGAGEMENT LETTERS (section 15.5)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_engagements (
    id                      SERIAL PRIMARY KEY,
    client_id               UUID NOT NULL REFERENCES compliance_clients(id),

    -- Engagement terms
    engagement_type         TEXT NOT NULL DEFAULT 'standard'
        CHECK (engagement_type IN (
            'standard', 'limited_assurance', 'gap_analysis',
            'ir_monitoring_response', 'self_assessment'
        )),
    engagement_ref          TEXT,

    -- Scope
    jurisdiction_ids        INTEGER[] NOT NULL,
    scope_description       TEXT NOT NULL,
    limitations             TEXT,

    -- Terms
    engagement_date         DATE NOT NULL,
    fee_basis               TEXT
        CHECK (fee_basis IN ('fixed', 'subscription', 'hourly')),
    fee_amount              NUMERIC(10,2),
    fee_currency            TEXT DEFAULT 'GBP',

    -- Responsible practitioner
    engagement_partner      TEXT NOT NULL,
    engagement_partner_email TEXT,

    -- Status
    status                  TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued', 'accepted', 'completed', 'cancelled')),
    accepted_at             TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_engagements_client
    ON compliance_engagements(client_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 4: ASSESSMENT ENGINE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_assessments (
    id              SERIAL PRIMARY KEY,
    client_id       UUID NOT NULL REFERENCES compliance_clients(id),
    jurisdiction_id INTEGER NOT NULL REFERENCES compliance_jurisdictions(id),
    engagement_id   INTEGER REFERENCES compliance_engagements(id),

    -- Assessment metadata
    assessment_type TEXT NOT NULL DEFAULT 'full'
        CHECK (assessment_type IN ('full', 'gap_analysis', 'reassessment', 'self_assessment')),
    engine_version  TEXT NOT NULL,

    -- Scoring
    overall_score   NUMERIC(5,2),
    domain_scores   JSONB,
    confidence_level TEXT DEFAULT 'medium'
        CHECK (confidence_level IN ('high', 'medium', 'low', 'very_low')),

    -- Status and lifecycle
    status          TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'reviewed', 'superseded', 'stale')),
    completed_at    TIMESTAMPTZ,
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,

    -- Retention (section 15.2)
    retention_expires_at TIMESTAMPTZ,

    -- Working papers
    working_papers  JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_assessments_client
    ON compliance_assessments(client_id);
CREATE INDEX IF NOT EXISTS idx_compliance_assessments_jurisdiction
    ON compliance_assessments(jurisdiction_id);

-- ─── Assessment findings ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assessment_findings (
    id              SERIAL PRIMARY KEY,
    assessment_id   INTEGER NOT NULL REFERENCES compliance_assessments(id) ON DELETE CASCADE,
    requirement_id  INTEGER NOT NULL REFERENCES compliance_requirements(id),
    domain_id       INTEGER NOT NULL REFERENCES compliance_domains(id),

    -- Finding
    status          TEXT NOT NULL
        CHECK (status IN ('absent', 'partial', 'present')),
    severity        TEXT NOT NULL
        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'compliant')),
    finding_text    TEXT NOT NULL,
    recommendation  TEXT NOT NULL,

    -- Evidence chain
    evidence_ids    INTEGER[] NOT NULL DEFAULT '{}',
    evidence_count  INTEGER NOT NULL DEFAULT 0,
    confidence      TEXT NOT NULL DEFAULT 'medium'
        CHECK (confidence IN ('high', 'medium', 'low', 'very_low')),
    confidence_factors JSONB,

    -- Scoring
    score           NUMERIC(5,2),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_findings_assessment
    ON assessment_findings(assessment_id);

-- ─── Assessment document scope (section 15.3 — change propagation) ──────────

CREATE TABLE IF NOT EXISTS assessment_document_scope (
    assessment_id   INTEGER NOT NULL REFERENCES compliance_assessments(id) ON DELETE CASCADE,
    document_id     INTEGER NOT NULL REFERENCES compliance_documents(id),
    PRIMARY KEY (assessment_id, document_id)
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: POPIA JURISDICTION
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Jurisdiction ───────────────────────────────────────────────────────────

INSERT INTO compliance_jurisdictions (code, name, short_name, country_iso, enacted_date, effective_date, regulator_name, regulator_url, scoring_config)
VALUES (
    'popia',
    'Protection of Personal Information Act, Act 4 of 2013',
    'POPIA',
    'ZA',
    '2013-11-19',
    '2021-07-01',
    'Information Regulator (South Africa)',
    'https://www.justice.gov.za/inforeg/',
    '{"min_weight": 0.30, "avg_weight": 0.70, "mandatory_domains": ["information_officer"]}'
);

-- ─── Domains (10) ───────────────────────────────────────────────────────────

INSERT INTO compliance_domains (jurisdiction_id, code, name, description, display_order, weight) VALUES
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'information_officer', 'Information Officer Registration', 'POPIA s55-56, s58 — appointment and registration of Information Officer', 1, 1.50),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'lawful_processing', 'Lawful Basis for Processing', 'POPIA s8-12 — conditions for lawful processing', 2, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'consent_mechanism', 'Consent Mechanisms', 'POPIA s11 — consent requirements', 3, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'cross_border_transfer', 'Cross-border Data Transfers', 'POPIA s72 — transborder information flows', 4, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'data_subject_rights', 'Data Subject Rights', 'POPIA s23-25 — access, correction, deletion', 5, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'breach_notification', 'Breach Notification', 'POPIA s22 — security compromise notification', 6, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'special_categories', 'Special Personal Information', 'POPIA s26-33 — special categories and children', 7, 1.30),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'retention_and_purpose', 'Retention and Purpose Limitation', 'POPIA s13-14 — purpose specification and retention', 8, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'security_safeguards', 'Security Safeguards', 'POPIA s19 — technical and organisational measures', 9, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 'direct_marketing', 'Direct Marketing', 'POPIA s69 — direct marketing restrictions', 10, 0.80);

-- ─── Requirements: information_officer ──────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'information_officer' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s55_io_appointment',
    'Appoint an Information Officer',
    's55-56',
    'critical',
    'No evidence of an appointed Information Officer or registration with the South African Information Regulator. For a foreign entity processing South African personal information, this is a direct violation of POPIA s55-56 and s58.',
    'Appoint and register an Information Officer with the SA Information Regulator per POPIA s55-56. As a foreign entity, s58 requires appointment of a representative domiciled in South Africa.',
    'high',
    'A data protection role (DPO or privacy officer) is referenced in the documentation, but there is no evidence of a POPIA-specific Information Officer appointment or registration with the South African Information Regulator.',
    'Extend the existing data protection role to include POPIA Information Officer responsibilities and register with the SA Information Regulator per s55-56.',
    'low',
    'Documentation references a data protection officer or privacy officer role. However, specific POPIA Information Officer registration should be verified with the Information Regulator.',
    'Verify that the Information Officer registration with the SA Information Regulator is current and covers processing of South African personal information.',
    ARRAY['privacy_policy', 'other'],
    1
);

-- ─── Requirements: lawful_processing ────────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'lawful_processing' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s8_lawful_basis',
    'Lawful Basis for Processing',
    's8-12',
    'high',
    'The privacy documentation does not establish a clear lawful basis for processing South African personal information as required under POPIA s8-12.',
    'Identify and document the lawful basis for each category of processing activity involving South African personal data, per POPIA s8-12.',
    'medium',
    'A lawful basis for processing is referenced (likely under GDPR or general terms), but no POPIA-specific justification under s8-12 is provided.',
    'Map existing GDPR lawful bases to POPIA equivalents and explicitly reference POPIA s8-12 in documentation applicable to South African data subjects.',
    'low',
    'Lawful processing bases are documented. Verify that these are mapped to POPIA s8-12 requirements specifically.',
    'Ensure POPIA-specific conditions for lawful processing under s8-12 are explicitly addressed in privacy documentation.',
    ARRAY['privacy_policy', 'data_processing_agreement'],
    1
);

-- ─── Requirements: consent_mechanism ────────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'consent_mechanism' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s11_consent',
    'Consent Mechanisms',
    's11',
    'high',
    'No consent mechanism is described in the documentation. If processing relies on consent as a lawful basis under POPIA s11, it must be specific, informed, voluntary, and capable of withdrawal.',
    'Implement clear consent mechanisms that meet POPIA s11 requirements: consent must be specific, informed, given voluntarily, and the data subject must be able to withdraw consent.',
    'medium',
    'Consent mechanisms are referenced but may not fully meet POPIA s11 requirements for being specific, informed, voluntary, and withdrawable.',
    'Review consent mechanisms against POPIA s11 requirements and ensure withdrawal of consent is clearly communicated and easily exercisable.',
    'low',
    'Consent mechanisms are documented including collection and withdrawal processes.',
    'Verify that consent mechanisms specifically comply with POPIA s11 requirements for South African data subjects.',
    ARRAY['privacy_policy', 'consent_form'],
    1
);

-- ─── Requirements: cross_border_transfer ────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'cross_border_transfer' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s72_cross_border',
    'Cross-border Data Transfers',
    's72',
    'high',
    'No cross-border data transfer mechanisms or disclosures are described despite the company being domiciled outside South Africa. Under POPIA s72, transfers of personal information outside South Africa require specific safeguards.',
    'Disclose cross-border data transfer practices and implement safeguards per POPIA s72 — either through adequate protection in the recipient country, binding corporate rules, consent, or contractual obligations.',
    'medium',
    'Cross-border data transfers are acknowledged (likely under GDPR mechanisms) but POPIA s72 specific safeguards for South African personal information transfers are not addressed.',
    'Extend existing cross-border transfer mechanisms to specifically address POPIA s72 requirements for South African personal data.',
    'low',
    'Cross-border data transfer mechanisms are documented.',
    'Verify that cross-border transfer safeguards are specifically mapped to POPIA s72 for South African personal data.',
    ARRAY['privacy_policy', 'data_processing_agreement'],
    1
);

-- ─── Requirements: data_subject_rights ──────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'data_subject_rights' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s23_data_subject_rights',
    'Data Subject Rights',
    's23-25',
    'high',
    'Data subject rights are not clearly communicated in the documentation. POPIA s23-25 requires that data subjects be informed of their rights to access, correct, and delete personal information and to object to processing.',
    'Clearly communicate data subject rights per POPIA s23-25 including the right to request access (s23), correction or deletion (s24), and to object to processing (s11(3)).',
    'medium',
    'Some data subject rights are mentioned but the documentation does not comprehensively cover all POPIA s23-25 rights (access, correction, deletion, objection).',
    'Expand documentation to cover all POPIA s23-25 data subject rights and provide clear mechanisms for South African data subjects to exercise these rights.',
    'compliant',
    'Data subject rights including access, correction, and deletion are documented.',
    'Ensure these rights explicitly reference POPIA s23-25 and provide a clear exercise mechanism for South African data subjects.',
    ARRAY['privacy_policy'],
    1
);

-- ─── Requirements: breach_notification ──────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'breach_notification' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s22_breach_notification',
    'Breach Notification',
    's22',
    'medium',
    'No data breach notification commitment is described. POPIA s22 requires notification to the Information Regulator and affected data subjects as soon as reasonably possible after a compromise.',
    'Implement a breach notification procedure that meets POPIA s22 requirements — notify the Information Regulator and affected data subjects as soon as reasonably possible after discovery of a security compromise.',
    'medium',
    'A breach notification commitment exists (likely aligned to GDPR requirements) but does not specifically reference POPIA s22 or notification to the South African Information Regulator.',
    'Extend breach notification procedures to specifically include notification to the SA Information Regulator per POPIA s22, in addition to any existing GDPR notification obligations.',
    'low',
    'Breach notification procedures are documented.',
    'Verify that breach notification procedures include the SA Information Regulator as a notifiable authority per POPIA s22.',
    ARRAY['privacy_policy', 'breach_procedure'],
    1
);

-- ─── Requirements: special_categories ───────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'special_categories' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s26_special_categories',
    'Special Personal Information',
    's26-33',
    'critical',
    'No mention of special personal information handling despite the company likely processing biometric, health, or performance data. POPIA s26-33 imposes additional requirements on processing special personal information including prior authorisation from the Information Regulator.',
    'Identify all special personal information processed (including biometric and health data) and implement POPIA s26-33 safeguards. Obtain prior authorisation from the Information Regulator per s57 if processing biometric data.',
    'high',
    'Special categories of data (biometric, health, or sensitive data) are acknowledged but safeguards specific to POPIA s26-33 are not addressed. Prior authorisation from the Information Regulator may be required per s57.',
    'Map special personal information processing to POPIA s26-33 requirements and apply for prior authorisation from the Information Regulator per s57 where required (particularly for biometric data processing).',
    'medium',
    'Special personal information handling is addressed in the documentation.',
    'Verify that special personal information safeguards specifically comply with POPIA s26-33 and that prior authorisation has been obtained from the Information Regulator where required.',
    ARRAY['privacy_policy', 'impact_assessment'],
    1
);

-- ─── Requirements: retention_and_purpose ────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'retention_and_purpose' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s13_retention',
    'Retention and Purpose Limitation',
    's13-14',
    'medium',
    'No data retention policy or purpose limitation is described. POPIA s13-14 requires that personal information be retained only for as long as necessary for the purpose it was collected.',
    'Implement and document a data retention policy that limits retention to the purpose of collection per POPIA s13-14, with specified retention periods and deletion procedures.',
    'low',
    'Some retention or purpose limitation language exists but specific retention periods are not defined or POPIA s13-14 is not specifically referenced.',
    'Define specific retention periods for each category of South African personal data and ensure alignment with POPIA s13-14 purpose limitation requirements.',
    'compliant',
    'Data retention and purpose limitation policies are documented with specified retention periods.',
    'Verify retention periods align with POPIA s13-14 requirements for South African personal data.',
    ARRAY['privacy_policy', 'retention_policy'],
    1
);

-- ─── Requirements: security_safeguards ──────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'security_safeguards' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s19_security',
    'Security Safeguards',
    's19',
    'medium',
    'No security safeguards are described. POPIA s19 requires appropriate technical and organisational measures to secure personal information against loss, damage, and unauthorised access.',
    'Document and implement appropriate technical and organisational security measures per POPIA s19, including access controls, encryption, and security incident procedures.',
    'low',
    'Some security measures are referenced but a comprehensive description of technical and organisational safeguards per POPIA s19 is not provided.',
    'Expand security documentation to comprehensively address POPIA s19 requirements including technical measures (encryption, access controls) and organisational measures (staff training, security policies).',
    'compliant',
    'Security safeguards including technical and organisational measures are documented.',
    'Verify that security measures specifically meet POPIA s19 requirements for South African personal data processing.',
    ARRAY['privacy_policy', 'security_policy'],
    1
);

-- ─── Requirements: direct_marketing ─────────────────────────────────────────

INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'direct_marketing' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'popia')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'popia'),
    'popia_s69_direct_marketing',
    'Direct Marketing',
    's69',
    'low',
    'No direct marketing practices are described. If the company engages in direct marketing to South African data subjects, POPIA s69 requires prior consent and an opt-out mechanism.',
    'If engaging in direct marketing to South African data subjects, implement POPIA s69 requirements including prior consent and a clear opt-out mechanism.',
    'low',
    'Marketing practices are mentioned but POPIA s69 requirements for direct marketing to South African data subjects are not specifically addressed.',
    'Review direct marketing practices against POPIA s69 and ensure prior consent and opt-out mechanisms are in place for South African data subjects.',
    'compliant',
    'Direct marketing practices are documented with consent and opt-out mechanisms.',
    'Verify that direct marketing practices comply with POPIA s69 for South African data subjects.',
    ARRAY['privacy_policy', 'marketing_policy'],
    1
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: POPIA EVIDENCE KEYWORDS
-- Migrated from POPIA_RULES[].keywords and POPIA_RULES[].sa_keywords
-- ═══════════════════════════════════════════════════════════════════════════════

-- information_officer keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'information officer', 'general', 'Generic IO reference'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'responsible party', 'general', 'POPIA term for data controller'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'privacy officer', 'general', 'Generic privacy role'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'data protection officer', 'general', 'DPO reference'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), '\bDPO\b', 'general', 'DPO abbreviation'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'privacy lead', 'general', 'Privacy role variant'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'information regulator', 'jurisdiction_specific', 'SA Information Regulator'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), '\bPOPIA\b', 'jurisdiction_specific', 'POPIA Act reference'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'south africa', 'jurisdiction_specific', 'SA jurisdiction'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), 'section 5[5-8]', 'jurisdiction_specific', 'POPIA IO sections'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), '\bs5[5-8]\b', 'jurisdiction_specific', 'POPIA IO section shorthand');

-- lawful_processing keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'lawful basis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'legal basis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'grounds for processing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'legitimate interest', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'contractual necessity', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'legal obligation', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'vital interest', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'public interest', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'performance of a contract', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'section [89]\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'section 1[0-2]\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), 'condition[s]? for lawful processing', 'jurisdiction_specific', NULL);

-- consent_mechanism keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), '\bconsent\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), '\bopt[- ]?in\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'withdraw.*consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'consent.*withdraw', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'revoke.*consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), '\bvoluntary\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'informed consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'explicit consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'section 11', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), '\bs11\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), 'specific.*informed.*voluntary', 'jurisdiction_specific', NULL);

-- cross_border_transfer keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'cross[- ]?border', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'international transfer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'transfer.*(?:data|personal|information)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'third countr', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'outside.*(?:south africa|SA|EEA|EU)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'adequate.*protection', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'binding corporate rules', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'standard contractual clauses', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), '\bSCC\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), '\bBCR\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'section 72', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), '\bs72\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), 'information regulator', 'jurisdiction_specific', NULL);

-- data_subject_rights keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'right.*access', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'access.*(?:data|information|personal)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'right.*correct', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'rectif', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'right.*delet', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'erasure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'right to be forgotten', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'right.*object', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'data portability', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'subject access request', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), '\bSAR\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), '\bDSAR\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), 'section 2[3-5]', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), '\bs2[3-5]\b', 'jurisdiction_specific', NULL);

-- breach_notification keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), '(?:data )?breach', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'security incident', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'notif.*breach', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'breach.*notif', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), '72 hours', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'without (?:undue )?delay', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'incident response', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'security compromise', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'section 22', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), '\bs22\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), 'information regulator', 'jurisdiction_specific', NULL);

-- special_categories keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'biometric', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'health data', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'medical', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'special.*(?:personal|categor)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'sensitive.*(?:data|information)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'children', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'child(?:ren)?(?:''s)? data', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'minor', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'genetic', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'racial', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'ethnic', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'religio', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'political', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'sex(?:ual)? (?:life|orientation)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'trade union', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'physiological', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'performance data', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'athlete', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'player data', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'section 2[6-9]', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'section 3[0-3]', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'prior authoris', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), 'information regulator', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), '\bs57\b', 'jurisdiction_specific', NULL);

-- retention_and_purpose keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'retention', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'data retention', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'retention period', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'purpose.*(?:limit|specific)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'specific purpose', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'no longer necessary', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'delet.*(?:after|when|once)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'destroy', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'store.*(?:period|duration|time)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), 'section 1[3-4]', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), '\bs1[3-4]\b', 'jurisdiction_specific', NULL);

-- security_safeguards keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'security', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'encrypt', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'access control', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'technical.*measure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'organisational.*measure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'organizational.*measure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'confidential', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'integrity', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'ISO 27001', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'SOC 2', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'security certif', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'firewall', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'pseudonymis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'anonymis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), 'section 19', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), '\bs19\b', 'jurisdiction_specific', NULL);

-- direct_marketing keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'direct marketing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'marketing.*(?:consent|opt)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'opt[- ]?out', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'unsubscribe', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'promotional', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'newsletter', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'marketing.*(?:email|communication)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'electronic.*marketing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), '\bPOPIA\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), 'section 69', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s69_direct_marketing'), '\bs69\b', 'jurisdiction_specific', NULL);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: IR MONITORING EXERCISE ITEMS (15 items)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO ir_monitoring_items (jurisdiction_id, item_number, description, evidence_types) VALUES
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 1, 'Processing activities overview with data subject counts', ARRAY['ropa']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 2, 'Subsidiaries and branches', ARRAY['other']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 3, 'Employee count', ARRAY['other']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 4, 'Deputy Information Officer designation with proof of registration', ARRAY['other']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 5, 'Compliance framework (privacy policy, retention policy, security policy)', ARRAY['privacy_policy', 'retention_policy', 'security_policy']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 6, 'POPIA training records', ARRAY['training_material']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 7, 'Risk register for personal information risks', ARRAY['impact_assessment']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 8, 'Risk mitigation/implementation plan', ARRAY['other']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 9, 'Incident response plan', ARRAY['breach_procedure']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 10, 'PAIA manual', ARRAY['paia_manual']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 11, 'Personal Information Impact Assessment', ARRAY['impact_assessment']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 12, 'Legitimate Interest Assessments (where applicable)', ARRAY['impact_assessment']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 13, 'Direct marketing report with consent mechanisms', ARRAY['marketing_policy', 'consent_form']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 14, 'POPIA-related complaints received (annual count)', ARRAY['other']),
((SELECT id FROM compliance_jurisdictions WHERE code = 'popia'), 15, 'Security compromises experienced (annual count)', ARRAY['breach_procedure']);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: UAE PDPL JURISDICTION
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO compliance_jurisdictions (code, name, short_name, country_iso, enacted_date, effective_date, regulator_name, regulator_url, scoring_config)
VALUES (
    'uae_pdpl',
    'Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data',
    'UAE PDPL',
    'AE',
    '2021-09-26',
    '2022-01-02',
    'Federal Authority for Artificial Intelligence and Data',
    'https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws',
    '{"min_weight": 0.30, "avg_weight": 0.70, "mandatory_domains": ["data_protection_officer"]}'
);

-- ─── UAE PDPL Domains (10) ──────────────────────────────────────────────────

INSERT INTO compliance_domains (jurisdiction_id, code, name, description, display_order, weight) VALUES
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'data_protection_officer', 'Data Protection Officer', 'Art 10, Executive Regulations — DPO appointment and registration', 1, 1.40),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'lawful_processing', 'Lawful Basis for Processing', 'Art 4-5 — purpose limitation and lawful basis', 2, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'consent_mechanism', 'Consent and Legal Bases', 'Art 6-7 — consent requirements and processing without consent', 3, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'cross_border_transfer', 'Cross-border Data Transfers', 'Art 22-23 — transfer safeguards and impact assessments', 4, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'data_subject_rights', 'Data Subject Rights', 'Art 13-17 — access, rectification, erasure, portability, objection', 5, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'breach_notification', 'Breach Notification', 'Art 21 — 72-hour notification to Federal Authority', 6, 1.30),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'sensitive_data', 'Sensitive Personal Data', 'Art 7 — health, biometric, genetic, racial, religious, political, criminal', 7, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'retention_and_purpose', 'Retention and Purpose Limitation', 'Art 8-9 — RoPA and retention limits', 8, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'security_safeguards', 'Technical and Organisational Measures', 'Art 20 — encryption, access controls, pseudonymisation', 9, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'), 'transparency', 'Transparency and Privacy Notices', 'Art 12 — plain-language privacy notices at collection', 10, 1.00);

-- ─── UAE PDPL Requirements ──────────────────────────────────────────────────

-- DPO
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'data_protection_officer' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art10_dpo_appointment',
    'Appoint a Data Protection Officer',
    'Art 10, Executive Regulations',
    'critical',
    'No evidence of a Data Protection Officer appointment. The UAE PDPL Executive Regulations require DPO appointment where processing is high-risk, involves sensitive data at scale, or includes large-scale monitoring.',
    'Appoint a DPO with expert knowledge of data protection law and register their contact details with the Federal Authority for Artificial Intelligence and Data.',
    'high',
    'A privacy or compliance role exists but it is unclear whether a formal DPO has been appointed meeting UAE PDPL requirements — independence, expertise, and registration with the Federal Authority.',
    'Formalise the DPO appointment ensuring independence from conflicts of interest, documented reporting line, and registration with the Federal Authority.',
    'low',
    'A Data Protection Officer or equivalent role is documented.',
    'Verify that the DPO meets UAE PDPL independence requirements and that contact details are registered with the Federal Authority and available to data subjects.',
    ARRAY['privacy_policy', 'other'],
    1
);

-- Lawful processing
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'lawful_processing' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art4_purpose_limitation',
    'Purpose Limitation and Lawful Basis',
    'Art 4-5',
    'high',
    'No documented lawful basis for processing personal data of UAE-based individuals. UAE PDPL Art 4-5 requires data to be collected for specified, explicit, and legitimate purposes with a documented lawful basis.',
    'Identify and document the lawful basis for each processing activity involving UAE personal data, per UAE PDPL Art 4-5.',
    'medium',
    'A lawful basis for processing is referenced but may not specifically address UAE PDPL Art 4-5 requirements for purpose specification and legitimacy.',
    'Map existing lawful basis documentation to UAE PDPL Art 4-5 and ensure each processing purpose is specified and legitimate.',
    'low',
    'Lawful basis and purpose limitation are documented.',
    'Verify that documentation specifically addresses UAE PDPL Art 4-5 for processing of UAE-based individuals'' personal data.',
    ARRAY['privacy_policy', 'data_processing_agreement'],
    1
);

-- Consent
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'consent_mechanism' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art6_consent',
    'Consent Requirements',
    'Art 6-7',
    'high',
    'No consent mechanism is documented. Under UAE PDPL Art 6, consent is the default legal basis and must be freely given, informed, explicit, specific to the processing activity, and revocable at any time.',
    'Implement consent mechanisms meeting UAE PDPL Art 6 requirements: freely given, informed, explicit, specific, and revocable. Where processing without consent is relied upon under Art 7, document which exemption applies.',
    'medium',
    'Consent mechanisms exist but may not meet all UAE PDPL Art 6 requirements (freely given, informed, explicit, specific, revocable).',
    'Review consent flows against UAE PDPL Art 6 and document any reliance on Art 7 exemptions (public interest, vital interests, contract performance, etc.).',
    'low',
    'Consent mechanisms are documented with collection and withdrawal processes.',
    'Verify that consent mechanisms meet UAE PDPL Art 6 standards and that any processing without consent is documented under Art 7 exemptions.',
    ARRAY['privacy_policy', 'consent_form'],
    1
);

-- Cross-border transfers
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'cross_border_transfer' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art22_transfer_safeguards',
    'Cross-border Transfer Safeguards',
    'Art 22-23',
    'high',
    'No cross-border transfer mechanisms documented. UAE PDPL Art 22-23 requires transfers outside the UAE to have either an adequacy decision, contractual safeguards, or explicit consent, with documented impact assessments for higher-risk destinations.',
    'Document all cross-border data transfers and implement safeguards per UAE PDPL Art 22-23 — adequacy, contractual safeguards, or explicit consent. Conduct impact assessments for higher-risk transfer destinations.',
    'medium',
    'Cross-border transfers are acknowledged but UAE PDPL Art 22-23 specific safeguards and impact assessments are not documented.',
    'Map existing transfer mechanisms to UAE PDPL Art 22-23 requirements and conduct documented impact assessments for higher-risk destinations.',
    'low',
    'Cross-border transfer safeguards are documented.',
    'Verify that transfer safeguards and impact assessments meet UAE PDPL Art 22-23 requirements.',
    ARRAY['privacy_policy', 'data_processing_agreement', 'impact_assessment'],
    1
);

-- Data subject rights
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'data_subject_rights' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art13_rights',
    'Data Subject Rights',
    'Art 13-17',
    'high',
    'Data subject rights are not communicated. UAE PDPL Art 13-17 grants five core rights (access, rectification, erasure, portability, objection) that must be honoured within 30 days.',
    'Document and communicate all five UAE PDPL data subject rights (Art 13-17) with a clear 30-day response mechanism for individuals in the UAE.',
    'medium',
    'Some data subject rights are referenced but the full suite under UAE PDPL Art 13-17 (access, rectification, erasure, portability, objection) is not comprehensively addressed.',
    'Expand documentation to cover all five rights under UAE PDPL Art 13-17 and implement a 30-day response SLA.',
    'compliant',
    'Data subject rights including access, rectification, erasure, portability, and objection are documented.',
    'Verify that the 30-day response timeline is implemented and rights are specifically mapped to UAE PDPL Art 13-17.',
    ARRAY['privacy_policy'],
    1
);

-- Breach notification
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'breach_notification' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art21_breach',
    'Breach Notification',
    'Art 21',
    'high',
    'No breach notification commitment documented. UAE PDPL Art 21 requires notification to the Federal Authority within 72 hours and to affected data subjects unless data was encrypted or risk has been mitigated.',
    'Implement a breach notification procedure with a 72-hour notification window to the Federal Authority for Artificial Intelligence and Data per UAE PDPL Art 21.',
    'medium',
    'A breach notification procedure exists but does not specifically address the UAE PDPL Art 21 72-hour timeline or notification to the Federal Authority.',
    'Update breach procedures to include the 72-hour Federal Authority notification and document the data subject notification exemptions under Art 21.',
    'low',
    'Breach notification procedures with timeline commitments are documented.',
    'Verify that the 72-hour notification to the Federal Authority is specifically addressed and that data subject notification exemptions are documented.',
    ARRAY['privacy_policy', 'breach_procedure'],
    1
);

-- Sensitive data
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'sensitive_data' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art7_sensitive',
    'Sensitive Personal Data Processing',
    'Art 7',
    'critical',
    'No mention of sensitive personal data handling. UAE PDPL Art 7 defines sensitive data (health, biometric, genetic, racial, religious, political, criminal records) and requires explicit consent or a specific legal exemption for processing.',
    'Identify all sensitive personal data processed and implement UAE PDPL Art 7 safeguards — explicit consent or documented legal exemption for each category.',
    'high',
    'Sensitive data categories are acknowledged but safeguards specific to UAE PDPL Art 7 (explicit consent or legal exemption) are not clearly documented.',
    'Map sensitive data processing to UAE PDPL Art 7 categories and document the explicit consent or legal exemption relied upon for each.',
    'medium',
    'Sensitive personal data handling is addressed in the documentation.',
    'Verify that safeguards specifically comply with UAE PDPL Art 7 and that explicit consent or legal exemptions are documented for each sensitive data category.',
    ARRAY['privacy_policy', 'impact_assessment'],
    1
);

-- Retention and RoPA
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'retention_and_purpose' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_ropa',
    'Record of Processing Activities and Retention',
    'Art 8-9, Executive Regulations',
    'medium',
    'No Record of Processing Activities or retention policy documented. UAE PDPL Executive Regulations require a RoPA covering purposes, categories, recipients, transfers, and retention schedules.',
    'Establish a RoPA per UAE PDPL Executive Regulations and document retention periods for each processing category per Art 8-9.',
    'low',
    'Some retention or processing documentation exists but does not constitute a complete RoPA as required by UAE PDPL Executive Regulations.',
    'Expand documentation into a formal RoPA covering all required fields: purposes, categories, recipients, cross-border transfers, and retention schedules.',
    'compliant',
    'A Record of Processing Activities and retention policy are documented.',
    'Verify that the RoPA meets UAE PDPL Executive Regulations requirements and that retention periods are specified per Art 8-9.',
    ARRAY['ropa', 'retention_policy'],
    1
);

-- Security safeguards
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'security_safeguards' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art20_security',
    'Technical and Organisational Measures',
    'Art 20',
    'medium',
    'No security safeguards described. UAE PDPL Art 20 requires appropriate technical (encryption, access controls, pseudonymisation) and organisational (staff training, security policies) measures.',
    'Implement and document technical and organisational security measures per UAE PDPL Art 20, including encryption, access controls, pseudonymisation, and regular security assessments.',
    'low',
    'Some security measures are referenced but a comprehensive description of Art 20-compliant technical and organisational safeguards is not provided.',
    'Expand security documentation to comprehensively address UAE PDPL Art 20 requirements for both technical and organisational measures.',
    'compliant',
    'Security safeguards including technical and organisational measures are documented.',
    'Verify that security measures meet UAE PDPL Art 20 requirements for processing of UAE-based individuals'' personal data.',
    ARRAY['security_policy', 'privacy_policy'],
    1
);

-- Transparency
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'transparency' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'uae_pdpl'),
    'uae_pdpl_art12_transparency',
    'Transparency and Privacy Notices',
    'Art 12',
    'high',
    'No privacy notice or transparency information provided to data subjects. UAE PDPL Art 12 requires clear, plain-language information at collection: controller identity, purposes, legal basis, categories, recipients, cross-border details, and retention periods.',
    'Publish a privacy notice meeting UAE PDPL Art 12 requirements covering: controller identity, processing purposes, legal basis, data categories, third-party recipients, cross-border transfer details, and retention periods.',
    'medium',
    'A privacy notice exists but may not cover all UAE PDPL Art 12 required fields (controller identity, purposes, legal basis, categories, recipients, transfers, retention).',
    'Review the privacy notice against UAE PDPL Art 12 and ensure all required disclosures are present in clear, plain language.',
    'low',
    'A comprehensive privacy notice is provided to data subjects.',
    'Verify that the privacy notice specifically addresses all UAE PDPL Art 12 disclosure requirements.',
    ARRAY['privacy_policy'],
    1
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: UAE PDPL EVIDENCE KEYWORDS
-- ═══════════════════════════════════════════════════════════════════════════════

-- DPO keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'data protection officer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), '\bDPO\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'privacy officer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'information officer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'privacy lead', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'UAE Data Office', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'Federal Authority.*(?:AI|Artificial|Data)', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'United Arab Emirates', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'Decree.Law.*45', 'jurisdiction_specific', NULL);

-- Lawful processing keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'lawful basis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'legal basis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'legitimate interest', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'purpose.*(?:limit|specific)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'performance of a contract', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'article [45]', 'jurisdiction_specific', NULL);

-- Consent keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), '\bconsent\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), 'explicit consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), 'informed consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), 'withdraw.*consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), 'revoke.*consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), '\bopt[- ]?in\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), 'article [67]', 'jurisdiction_specific', NULL);

-- Cross-border transfer keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'cross[- ]?border', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'international transfer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'transfer.*(?:data|personal|information)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'adequate.*protection', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'standard contractual clauses', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'outside.*UAE', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'article 2[23]', 'jurisdiction_specific', NULL);

-- Data subject rights keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'right.*access', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'right.*correct', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'rectif', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'right.*delet', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'erasure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'data portability', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'right.*object', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), '\bDSAR\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'article 1[3-7]', 'jurisdiction_specific', NULL);

-- Breach notification keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), '(?:data )?breach', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), 'security incident', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), '72 hours', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), 'breach.*notif', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), 'incident response', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), 'Federal Authority', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), 'article 21', 'jurisdiction_specific', NULL);

-- Sensitive data keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'biometric', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'health data', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'genetic', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'sensitive.*(?:data|information)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'racial', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'religio', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'political', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'criminal', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'article 7', 'jurisdiction_specific', NULL);

-- Retention/RoPA keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), 'record of processing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), '\bRoPA\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), 'retention', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), 'retention period', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), 'no longer necessary', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), 'processing.*activit', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), '\bUAE\b', 'jurisdiction_specific', NULL);

-- Security keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'encrypt', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'access control', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'pseudonymis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'technical.*measure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'organisational.*measure', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'ISO 27001', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'SOC 2', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'security certif', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'article 20', 'jurisdiction_specific', NULL);

-- Transparency keywords
INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), 'privacy.*(?:notice|policy|statement)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), 'data.*collection.*notice', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), 'fair processing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), 'transparenc', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), 'information.*provided.*(?:collect|gather)', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), '\bPDPL\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), '\bUAE\b', 'jurisdiction_specific', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art12_transparency'), 'article 12', 'jurisdiction_specific', NULL);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: CROSS-JURISDICTION MAPPINGS (POPIA ↔ UAE PDPL)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO requirement_mappings (requirement_a, requirement_b, mapping_type, notes) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'popia_s55_io_appointment'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art10_dpo_appointment'), 'equivalent', 'IO (POPIA) ≈ DPO (UAE PDPL) — both require appointment and regulator registration'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s8_lawful_basis'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art4_purpose_limitation'), 'equivalent', 'Both require documented lawful basis for processing'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s11_consent'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art6_consent'), 'equivalent', 'Both require specific, informed, voluntary, revocable consent'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s72_cross_border'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art22_transfer_safeguards'), 'equivalent', 'Both require safeguards for international transfers'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s23_data_subject_rights'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art13_rights'), 'equivalent', 'Both grant access, correction, deletion, objection; UAE adds portability'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s22_breach_notification'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art21_breach'), 'similar', 'UAE: 72h fixed deadline; POPIA: "as soon as reasonably possible"'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s26_special_categories'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art7_sensitive'), 'similar', 'Similar categories but POPIA includes children separately (s34-35); UAE categories slightly different'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s13_retention'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_ropa'), 'similar', 'UAE bundles RoPA with retention; POPIA separates purpose limitation from record-keeping'),
((SELECT id FROM compliance_requirements WHERE code = 'popia_s19_security'), (SELECT id FROM compliance_requirements WHERE code = 'uae_pdpl_art20_security'), 'equivalent', 'Both require appropriate technical and organisational measures');


COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANTS — give africastn_app CRUD access to all new tables
-- (outside transaction to match migration convention)
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_jurisdictions TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_domains TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_requirements TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence_keywords TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON requirement_mappings TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ir_monitoring_items TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_documents TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_sections TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_evidence TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_engagements TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_assessments TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_findings TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_document_scope TO africastn_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO africastn_app;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 'compliance_jurisdictions' AS tbl, count(*) FROM compliance_jurisdictions
UNION ALL SELECT 'compliance_domains', count(*) FROM compliance_domains
UNION ALL SELECT 'compliance_requirements', count(*) FROM compliance_requirements
UNION ALL SELECT 'evidence_keywords', count(*) FROM evidence_keywords
UNION ALL SELECT 'requirement_mappings', count(*) FROM requirement_mappings
UNION ALL SELECT 'ir_monitoring_items', count(*) FROM ir_monitoring_items
UNION ALL SELECT 'compliance_documents', count(*) FROM compliance_documents
UNION ALL SELECT 'document_sections', count(*) FROM document_sections
UNION ALL SELECT 'compliance_evidence', count(*) FROM compliance_evidence
UNION ALL SELECT 'compliance_engagements', count(*) FROM compliance_engagements
UNION ALL SELECT 'compliance_assessments', count(*) FROM compliance_assessments
UNION ALL SELECT 'assessment_findings', count(*) FROM assessment_findings;

-- Migration 018: Seed GDPR + Swiss FADP control frameworks
-- Date: 24 July 2026
-- Purpose: Make the compliance engine genuinely multi-jurisdiction. The engine
--          already has POPIA and UAE PDPL seeded (migration 013). This adds the
--          EU/UK GDPR and the revised Swiss FADP as jurisdictions plus their
--          14-domain control frameworks, with citations verified 24 Jul 2026 and
--          recorded in STZA_Data_Protection_Engagement_Methodology_v1.1
--          (Common Control Framework §3).
--
-- Scope of THIS migration: jurisdictions + the 14 weighted control domains
--   (the citation spine). It intentionally does NOT yet seed the per-requirement
--   finding templates + evidence keywords (the assessment-content layer that
--   produces automated findings) for GDPR/Swiss. That is the next increment and a
--   candidate for AI-assisted generation (draft finding templates per requirement
--   from the verified citations, then human-verify) — mirroring the depth of the
--   POPIA/UAE-PDPL requirement seeds in migration 013.
--
-- Domain codes are a consistent 14-code set so jurisdictions are cross-mappable
--   via requirement_mappings. (POPIA/UAE PDPL in 013 predate this set and use
--   their own codes; harmonising them is a later, optional refactor.)
--
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING on the unique keys).
--
-- Run against Cloud SQL (africastn-research / africastn_os):
--   psql "host=<proxy-ip> dbname=africastn_os user=postgres" -f 018-seed-gdpr-swiss-frameworks.sql

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- JURISDICTION: EU/UK GDPR
-- UK GDPR reuses identical article numbering (read with DPA 2018); practical
-- divergences (ICO, age-13 consent, IDTA transfers, PECR marketing) are handled
-- as engagement observations, not a separate jurisdiction, for now.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO compliance_jurisdictions (code, name, short_name, country_iso, enacted_date, effective_date, regulator_name, regulator_url, scoring_config)
VALUES (
    'gdpr',
    'General Data Protection Regulation (EU) 2016/679',
    'GDPR',
    'EU',
    '2016-04-27',
    '2018-05-25',
    'European Data Protection Board / national supervisory authorities (UK: ICO)',
    'https://edpb.europa.eu/',
    '{"min_weight": 0.30, "avg_weight": 0.70, "mandatory_domains": ["lawful_processing", "security_safeguards"]}'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO compliance_domains (jurisdiction_id, code, name, description, display_order, weight) VALUES
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'accountability_governance', 'Accountability & Governance', 'GDPR Art 5(2), 24, 30, 37-39 — accountability, records of processing (ROPA), and DPO', 1, 1.50),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'lawful_processing', 'Lawful Basis for Processing', 'GDPR Art 6 — one of six lawful bases (incl. legitimate interests)', 2, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'consent', 'Consent', 'GDPR Art 4(11), 7 — freely given, specific, informed, unambiguous, withdrawable', 3, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'purpose_retention', 'Purpose Limitation & Retention', 'GDPR Art 5(1)(b),(e) — purpose limitation and storage limitation', 4, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'minimisation_accuracy', 'Data Minimisation & Accuracy', 'GDPR Art 5(1)(c),(d) — adequate/relevant/limited, accurate and up to date', 5, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'transparency_notice', 'Transparency / Notice', 'GDPR Art 12-14 — information to be provided to the data subject', 6, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'data_subject_rights', 'Data Subject Rights', 'GDPR Art 15-22 — access, rectification, erasure, restriction, portability, objection, automated decisions', 7, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'special_categories', 'Special Categories & Children', 'GDPR Art 9-10 (special/criminal data); Art 8 (children''s consent)', 8, 1.30),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'security_safeguards', 'Security of Processing', 'GDPR Art 32 — technical and organisational measures appropriate to risk', 9, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'breach_notification', 'Breach Notification', 'GDPR Art 33-34 — 72h notification to authority; notify data subjects where high risk', 10, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'cross_border_transfer', 'Cross-border Transfers', 'GDPR Art 44-49 — adequacy, appropriate safeguards (SCCs/BCRs), derogations', 11, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'processors_third_parties', 'Processors & Third Parties', 'GDPR Art 28 — binding processor contract with mandatory Art 28(3) terms', 12, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'dpia_high_risk', 'DPIA / High-risk Processing', 'GDPR Art 35-36 — DPIA for high-risk processing; prior consultation', 13, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'), 'direct_marketing', 'Direct Marketing', 'GDPR Art 21 right to object; e-marketing under ePrivacy Directive / UK PECR', 14, 0.80)
ON CONFLICT (jurisdiction_id, code) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- JURISDICTION: Swiss revised FADP (nFADP, SR 235.1, in force 1 Sep 2023)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO compliance_jurisdictions (code, name, short_name, country_iso, enacted_date, effective_date, regulator_name, regulator_url, scoring_config)
VALUES (
    'swiss_fadp',
    'Swiss Federal Act on Data Protection (revFADP / nFADP, SR 235.1)',
    'Swiss FADP',
    'CH',
    '2020-09-25',
    '2023-09-01',
    'Federal Data Protection and Information Commissioner (FDPIC)',
    'https://www.edoeb.admin.ch/',
    '{"min_weight": 0.30, "avg_weight": 0.70, "mandatory_domains": ["security_safeguards"]}'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO compliance_domains (jurisdiction_id, code, name, description, display_order, weight) VALUES
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'accountability_governance', 'Accountability & Governance', 'revFADP Art 10 (data protection advisor, voluntary), Art 12 (register of processing; <250-employee low-risk exemption)', 1, 1.50),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'lawful_processing', 'Lawfulness & Principles', 'revFADP Art 6 (principles: lawful, good faith, proportionate, transparent), Art 30-31 (justification for private processing)', 2, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'consent', 'Consent', 'revFADP Art 6(6)-(7) — voluntary + informed; express consent for sensitive data / high-risk profiling / automated decisions', 3, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'purpose_retention', 'Purpose Limitation & Retention', 'revFADP Art 6(3)-(4) — recognisable, specified purpose; proportionate retention', 4, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'minimisation_accuracy', 'Data Minimisation & Accuracy', 'revFADP Art 6(2),(5), Art 7 — proportionality, accuracy, privacy by default', 5, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'transparency_notice', 'Duty to Inform', 'revFADP Art 19-21 — duty to inform, exceptions, notice of automated decisions', 6, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'data_subject_rights', 'Data Subject Rights', 'revFADP Art 25 (access), 28 (portability), 32 (rectification/erasure via civil claim)', 7, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'special_categories', 'Sensitive Data & High-risk', 'revFADP Art 5(c) (sensitive data definition), 5(g) (high-risk profiling), 6(7) (express consent); no dedicated children''s regime', 8, 1.30),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'security_safeguards', 'Data Security', 'revFADP Art 8 + Data Protection Ordinance — technical and organisational measures', 9, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'breach_notification', 'Breach Notification', 'revFADP Art 24 — notify FDPIC "as soon as possible" (high-risk only; no fixed 72h deadline)', 10, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'cross_border_transfer', 'Cross-border Disclosure Abroad', 'revFADP Art 16 (adequacy / safeguards), Art 17 (exceptions)', 11, 1.20),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'processors_third_parties', 'Processors (Order Processing)', 'revFADP Art 9 — delegation by contract; processor limits; sub-processing needs approval', 12, 1.10),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'dpia_high_risk', 'DPIA / Prior Consultation', 'revFADP Art 22 (DPIA for high-risk), Art 23 (consult FDPIC)', 13, 1.00),
((SELECT id FROM compliance_jurisdictions WHERE code = 'swiss_fadp'), 'direct_marketing', 'Direct Marketing', 'revFADP Art 31(2)(c) (overriding interest presumption); e-marketing under Unfair Competition Act (UWG Art 3(1)(o))', 14, 0.80)
ON CONFLICT (jurisdiction_id, code) DO NOTHING;

COMMIT;

-- Verification (run after apply):
--   SELECT j.short_name, count(d.*) AS domains
--   FROM compliance_jurisdictions j LEFT JOIN compliance_domains d ON d.jurisdiction_id = j.id
--   GROUP BY j.short_name ORDER BY j.short_name;
--   Expect: GDPR 14, POPIA 10, UAE PDPL <n>, Swiss FADP 14.

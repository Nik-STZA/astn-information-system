-- Migration 019: Seed GDPR requirement finding-templates + evidence keywords
-- Date: 24 July 2026
-- Purpose: Add the assessment-content layer for GDPR (one primary requirement per
--          of the 14 domains from migration 018), so the engine produces automated
--          findings for GDPR the same way it does for POPIA/UAE PDPL. Finding text
--          is GDPR-native (neutral controller/processor framing). Citations verified
--          24 Jul 2026 (Common Control Framework §3, methodology v1.1).
--
-- Run once, after migration 018. Idempotent on the requirement rows
--   (ON CONFLICT (jurisdiction_id, code) DO NOTHING); keyword rows assume a single
--   application (matching the migration 013 convention).
--
-- Run against Cloud SQL (africastn_os):
--   node apply <this file>   (or psql -f)

BEGIN;

-- ── 1. Accountability & governance ──────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'accountability_governance' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art30_accountability', 'Accountability, Records of Processing and DPO', 'Art 5(2), 24, 30, 37-39',
    'high',
    'There is no evidence of a record of processing activities (Art 30), a designated Data Protection Officer where required (Art 37), or documented accountability measures (Art 5(2), 24).',
    'Establish a record of processing activities per Art 30, assess whether a DPO is mandatory under Art 37, and document the technical and organisational measures that demonstrate accountability under Art 24.',
    'medium',
    'Some governance elements are referenced (a privacy contact or policy) but a complete Art 30 record of processing and a documented DPO position or accountability framework are not evidenced.',
    'Complete the Art 30 record of processing activities and formalise the DPO assessment and accountability documentation.',
    'low',
    'Records of processing, a data protection lead, and accountability measures are documented. Confirm the Art 30 record is current and any mandatory DPO appointment is notified to the supervisory authority.',
    'Keep the Art 30 record under review and confirm DPO details are published and notified where Art 37 applies.',
    ARRAY['ropa','privacy_policy','other'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 2. Lawful basis ─────────────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'lawful_processing' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art6_lawful_basis', 'Lawful Basis for Processing', 'Art 6',
    'high',
    'The documentation does not identify a lawful basis under Art 6 for each processing purpose. Processing without an identifiable Art 6 basis is unlawful.',
    'Identify and document one of the six Art 6 lawful bases for each processing activity; where legitimate interests is relied on, complete and retain a legitimate interests assessment.',
    'medium',
    'A lawful basis is referenced generally but is not mapped to specific processing purposes, or the basis for some purposes is unclear.',
    'Map each processing purpose to a specific Art 6 basis and document the assessment, particularly any legitimate interests balancing test.',
    'low',
    'Lawful bases are documented against processing purposes. Verify each basis is appropriate and that legitimate interests assessments are recorded where used.',
    'Review the basis-to-purpose mapping periodically and retain legitimate interests assessments.',
    ARRAY['privacy_policy','data_processing_agreement'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 3. Consent ──────────────────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'consent' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art7_consent', 'Valid Consent', 'Art 4(11), 7',
    'high',
    'Where processing relies on consent, there is no evidence that consent meets the Art 7 standard - freely given, specific, informed, unambiguous, and as easy to withdraw as to give.',
    'Implement consent mechanisms meeting Art 4(11) and Art 7: a clear affirmative action, granular per-purpose options, an accessible withdrawal route, and records demonstrating consent.',
    'medium',
    'Consent is collected but may not fully meet Art 7 - for example bundled consent, pre-ticked boxes, or no clear withdrawal route.',
    'Review consent flows against Art 7: unbundle purposes, remove pre-ticked options, and provide an accessible withdrawal mechanism with retained proof of consent.',
    'low',
    'Consent capture and withdrawal mechanisms are documented. Verify consent records are retained and withdrawal is as easy as giving consent.',
    'Confirm consent records are demonstrable and periodically re-validated.',
    ARRAY['privacy_policy','consent_form','cookie_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 4. Purpose limitation & retention ───────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'purpose_retention' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art5_purpose_retention', 'Purpose Limitation and Retention', 'Art 5(1)(b),(e)',
    'medium',
    'No purpose limitation or storage limitation is documented. Art 5(1)(b) requires specified, explicit, legitimate purposes and Art 5(1)(e) requires data not be kept longer than necessary.',
    'Document the specific purposes for each data category and a retention schedule with defined periods and deletion procedures per Art 5(1)(b),(e).',
    'low',
    'Purposes or retention are mentioned but specific retention periods are not defined for all data categories.',
    'Define retention periods for every data category and align processing to the stated purposes.',
    'compliant',
    'Purpose limitation and a retention schedule with defined periods are documented.',
    'Verify retention periods are enforced by deletion routines and reviewed periodically.',
    ARRAY['privacy_policy','retention_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 5. Data minimisation & accuracy ─────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'minimisation_accuracy' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art5_minimisation', 'Data Minimisation and Accuracy', 'Art 5(1)(c),(d)',
    'medium',
    'There is no evidence that data collection is limited to what is necessary (Art 5(1)(c)) or that data is kept accurate and corrected where needed (Art 5(1)(d)).',
    'Review data collection against each purpose to remove unnecessary fields, and implement a process to keep data accurate and correct inaccuracies per Art 5(1)(c),(d).',
    'low',
    'Minimisation or accuracy is addressed in principle but collection scope or correction processes are not evidenced.',
    'Evidence the minimisation review and the accuracy/correction process.',
    'compliant',
    'Data minimisation and accuracy measures are documented.',
    'Periodically re-review collected fields against purpose and confirm correction workflows operate.',
    ARRAY['privacy_policy','ropa'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 6. Transparency / notice ────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'transparency_notice' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art13_transparency', 'Transparency and Privacy Notice', 'Art 12-14',
    'high',
    'A privacy notice providing the Art 13/14 information is not evidenced, or key disclosures (controller identity, purposes, lawful basis, recipients, transfers, retention, rights) are missing.',
    'Publish a concise, accessible privacy notice containing all Art 13 (data from the individual) and Art 14 (data obtained indirectly) information, in clear language per Art 12.',
    'medium',
    'A privacy notice exists but omits some Art 13/14 elements such as lawful basis, retention periods, international transfers, or the full set of data-subject rights.',
    'Complete the privacy notice against an Art 13/14 checklist, ensuring lawful basis, retention, transfers, and rights are all disclosed.',
    'low',
    'A privacy notice covering the Art 13/14 information is published. Verify completeness and that it is provided at the point of collection.',
    'Confirm the notice is layered/accessible and kept current with processing changes.',
    ARRAY['privacy_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 7. Data subject rights ──────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'data_subject_rights' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art15_dsr', 'Data Subject Rights', 'Art 15-22',
    'high',
    'The documentation does not describe how data subjects exercise their Art 15-22 rights (access, rectification, erasure, restriction, portability, objection, and rights relating to automated decision-making).',
    'Establish and publish procedures for handling Art 15-22 requests within the one-month statutory timeframe, including identity verification and response logging.',
    'medium',
    'Some rights are mentioned but the documentation does not cover the full Art 15-22 set or the request-handling process and timeframes.',
    'Extend the rights procedure to cover all Art 15-22 rights, the one-month response deadline, and Art 22 automated-decision safeguards.',
    'compliant',
    'Data-subject rights and a request procedure are documented.',
    'Verify request handling meets the one-month deadline and that Art 22 automated decision-making, if used, has safeguards.',
    ARRAY['privacy_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 8. Special categories & children ────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'special_categories' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art9_special', 'Special Category and Children Data', 'Art 9-10; Art 8',
    'critical',
    'Where special category data (Art 9), criminal-offence data (Art 10), or children data (Art 8) are processed, there is no evidence of an Art 9(2) condition, appropriate policy document, or age-appropriate safeguards.',
    'Identify all special category, criminal-offence, and children data; document the Art 9(2) condition relied on and, where required, an appropriate policy document, plus age-verification and parental-consent controls under Art 8.',
    'high',
    'Special category or children data processing is acknowledged but the Art 9(2) condition or children safeguards are not clearly documented.',
    'Document the specific Art 9(2) condition for each special-category purpose and implement Art 8 age-appropriate measures where children data is processed.',
    'medium',
    'Special category and children data handling is addressed. Verify the Art 9(2) condition is valid and children safeguards are effective.',
    'Confirm the Art 9(2) condition, appropriate policy document, and age-verification controls remain adequate.',
    ARRAY['privacy_policy','impact_assessment'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 9. Security safeguards ──────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'security_safeguards' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art32_security', 'Security of Processing', 'Art 32',
    'high',
    'There is no evidence of technical and organisational measures appropriate to the risk under Art 32 (such as encryption, access control, resilience, and testing).',
    'Document and implement Art 32 security measures proportionate to the risk, including access controls, encryption in transit and at rest where appropriate, and a process for testing effectiveness.',
    'medium',
    'Security is referenced but a description of technical and organisational measures under Art 32 is incomplete.',
    'Expand security documentation to comprehensively evidence Art 32 measures and their periodic testing.',
    'low',
    'Technical and organisational security measures are documented. Verify they are proportionate to risk and periodically tested.',
    'Confirm Art 32 measures are reviewed and tested on a defined cadence.',
    ARRAY['privacy_policy','security_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 10. Breach notification ─────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'breach_notification' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art33_breach', 'Personal Data Breach Notification', 'Art 33-34',
    'high',
    'No breach-response procedure is evidenced. Art 33 requires notification to the supervisory authority within 72 hours where feasible, and Art 34 requires notifying affected individuals where there is a high risk.',
    'Implement a breach-response procedure that detects, assesses, and notifies the supervisory authority within 72 hours under Art 33, notifies data subjects under Art 34 where high risk, and maintains a breach register.',
    'medium',
    'A breach commitment exists but does not clearly reflect the Art 33 72-hour timeline, the Art 34 high-risk notification duty, or breach record-keeping.',
    'Align the breach procedure to the Art 33 72-hour deadline and Art 34 individual-notification threshold, and maintain a breach register.',
    'low',
    'A breach-notification procedure is documented. Verify it reflects the 72-hour Art 33 timeline and Art 34 thresholds and that a breach register is kept.',
    'Confirm the procedure is tested and the breach register is maintained.',
    ARRAY['privacy_policy','breach_procedure'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 11. Cross-border transfers ──────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'cross_border_transfer' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art44_transfers', 'International Data Transfers', 'Art 44-49',
    'high',
    'Personal data appears to be transferred outside the EEA/UK without an evidenced Chapter V mechanism (adequacy, appropriate safeguards such as SCCs/BCRs, or an Art 49 derogation).',
    'Map all international transfers and put a valid Art 44-49 mechanism in place for each - adequacy, Standard Contractual Clauses (or the UK IDTA/Addendum), BCRs, or a documented Art 49 derogation, supported by a transfer risk assessment.',
    'medium',
    'Transfers are acknowledged but the transfer mechanism is unclear or a transfer risk assessment is not evidenced for all recipients.',
    'Confirm and document the Art 46 safeguard for each transfer and complete a transfer risk assessment.',
    'low',
    'International transfer mechanisms are documented. Verify each transfer has a valid Chapter V basis and current SCCs/IDTA where used.',
    'Keep transfer mechanisms and the transfer register current as recipients change.',
    ARRAY['privacy_policy','data_processing_agreement'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 12. Processors & third parties ──────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'processors_third_parties' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art28_processors', 'Processor Agreements', 'Art 28',
    'high',
    'There is no evidence of Art 28-compliant contracts with processors. Engaging a processor without the mandatory Art 28(3) terms is a direct compliance gap.',
    'Put Art 28-compliant data processing agreements in place with every processor, containing the mandatory Art 28(3) terms, and maintain a list of processors and sub-processors.',
    'medium',
    'Processor relationships are referenced but Art 28 agreements are not evidenced for all processors, or lack the mandatory terms.',
    'Ensure a signed Art 28 DPA with each processor and maintain an up-to-date sub-processor list.',
    'low',
    'Processor agreements are documented. Verify each contains the Art 28(3) mandatory terms and that the sub-processor list is current.',
    'Review DPAs and the sub-processor list periodically and on any change of processor.',
    ARRAY['data_processing_agreement','privacy_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 13. DPIA / high-risk ────────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'dpia_high_risk' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art35_dpia', 'Data Protection Impact Assessment', 'Art 35-36',
    'medium',
    'Where processing is likely to result in a high risk (such as large-scale profiling or special category data), no DPIA is evidenced as required by Art 35.',
    'Screen processing against the Art 35 high-risk criteria and complete a DPIA for qualifying activities; consult the supervisory authority under Art 36 where residual high risk remains.',
    'low',
    'A DPIA process is referenced but DPIAs are not evidenced for the relevant high-risk processing.',
    'Complete DPIAs for the identified high-risk processing and record the outcomes.',
    'compliant',
    'DPIA screening and completed DPIAs are documented.',
    'Keep DPIAs under review and repeat where processing materially changes.',
    ARRAY['impact_assessment','privacy_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;

-- ── 14. Direct marketing ────────────────────────────────────────────────────
INSERT INTO compliance_requirements (domain_id, jurisdiction_id, code, name, legislation_ref, absent_severity, absent_finding, absent_recommendation, partial_severity, partial_finding, partial_recommendation, present_severity, present_finding, present_recommendation, evidence_types, display_order)
VALUES (
    (SELECT id FROM compliance_domains WHERE code = 'direct_marketing' AND jurisdiction_id = (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr')),
    (SELECT id FROM compliance_jurisdictions WHERE code = 'gdpr'),
    'gdpr_art21_marketing', 'Direct Marketing', 'Art 21 (+ ePrivacy/PECR)',
    'low',
    'Where direct marketing is carried out, there is no evidence of a right-to-object mechanism (Art 21) or of the consent/soft opt-in and cookie rules under the ePrivacy Directive / UK PECR.',
    'Implement an easy opt-out honouring the absolute Art 21 right to object, and ensure electronic marketing and cookies meet ePrivacy/PECR consent requirements.',
    'low',
    'Marketing practices are mentioned but the objection mechanism or ePrivacy/PECR consent basis is not fully evidenced.',
    'Confirm an opt-out on every marketing communication and a valid ePrivacy/PECR consent or soft opt-in basis.',
    'compliant',
    'Direct marketing controls including opt-out and consent are documented.',
    'Verify suppression lists operate and cookie consent meets PECR/ePrivacy.',
    ARRAY['privacy_policy','marketing_policy','cookie_policy'], 1
) ON CONFLICT (jurisdiction_id, code) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE KEYWORDS (general + GDPR-specific patterns; regex, case-insensitive)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO evidence_keywords (requirement_id, pattern, keyword_class, description) VALUES
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art30_accountability'), 'record of processing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art30_accountability'), '\bROPA\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art30_accountability'), 'data protection officer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art30_accountability'), '\bDPO\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art30_accountability'), 'accountab', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art30_accountability'), 'article 3[07]|articles? 37', 'jurisdiction_specific', 'Art 30/37'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art6_lawful_basis'), 'lawful basis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art6_lawful_basis'), 'legal basis', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art6_lawful_basis'), 'legitimate interest', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art6_lawful_basis'), 'article 6', 'jurisdiction_specific', 'Art 6'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art7_consent'), '\bconsent\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art7_consent'), 'withdraw consent', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art7_consent'), 'opt.?in', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art7_consent'), 'article 7', 'jurisdiction_specific', 'Art 7'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art5_purpose_retention'), 'purpose limitation', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art5_purpose_retention'), 'retention period', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art5_purpose_retention'), 'storage limitation', 'general', NULL),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art5_minimisation'), 'data minimi[sz]ation', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art5_minimisation'), 'accurate', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art5_minimisation'), 'adequate, relevant', 'general', NULL),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art13_transparency'), 'privacy notice', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art13_transparency'), 'privacy policy', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art13_transparency'), 'information we collect', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art13_transparency'), 'article 1[34]', 'jurisdiction_specific', 'Art 13/14'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art15_dsr'), 'right of access|subject access', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art15_dsr'), 'right to erasure|right to be forgotten', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art15_dsr'), 'data portability', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art15_dsr'), 'data subject rights', 'general', NULL),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art9_special'), 'special categor', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art9_special'), 'sensitive (personal )?data', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art9_special'), 'health data|biometric|genetic', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art9_special'), 'child|minor|under 1[36]', 'general', 'children'),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art9_special'), 'article 9', 'jurisdiction_specific', 'Art 9'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art32_security'), 'technical and organi[sz]ational', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art32_security'), 'encryption', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art32_security'), 'access control', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art32_security'), 'article 32', 'jurisdiction_specific', 'Art 32'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art33_breach'), 'data breach|personal data breach', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art33_breach'), 'breach notification', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art33_breach'), '72 hours', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art33_breach'), 'supervisory authority', 'general', NULL),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art44_transfers'), 'international (data )?transfer', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art44_transfers'), 'standard contractual clauses|\bSCCs?\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art44_transfers'), 'adequacy', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art44_transfers'), '\bIDTA\b|binding corporate rules', 'general', NULL),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art28_processors'), 'data processing agreement|\bDPA\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art28_processors'), 'processor', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art28_processors'), 'sub.?processor', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art28_processors'), 'article 28', 'jurisdiction_specific', 'Art 28'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art35_dpia'), 'data protection impact assessment', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art35_dpia'), '\bDPIA\b', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art35_dpia'), 'article 35', 'jurisdiction_specific', 'Art 35'),

((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art21_marketing'), 'direct marketing', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art21_marketing'), 'unsubscribe|opt.?out', 'general', NULL),
((SELECT id FROM compliance_requirements WHERE code = 'gdpr_art21_marketing'), '\bPECR\b|ePrivacy', 'jurisdiction_specific', 'PECR/ePrivacy');

COMMIT;

-- Verification (run after apply):
--   SELECT j.short_name, count(r.*) AS requirements, count(k.*) AS keywords
--   FROM compliance_jurisdictions j
--   LEFT JOIN compliance_requirements r ON r.jurisdiction_id = j.id
--   LEFT JOIN evidence_keywords k ON k.requirement_id = r.id
--   WHERE j.code = 'gdpr' GROUP BY j.short_name;
--   Expect: GDPR 14 requirements.

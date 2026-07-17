/**
 * Multi-Jurisdiction Data Protection Assessment Engine
 *
 * Version: 1.0.0
 * Date: 14 July 2026
 *
 * Generalises the POPIA-only rule-based engine (v2.1.0) to support
 * any jurisdiction in the jurisdictions/ directory.
 *
 * Exports:
 *   loadJurisdiction(jurisdictionId, dir)   → jurisdiction JSON object
 *   generateRulesForJurisdiction(jd)         → rules array (same shape as POPIA_RULES)
 *   analyseDocumentsMultiJurisdiction(docs, prospect, jd) → findings[]
 *   generateMultiJurisdictionAssessment(findings, prospect, jd) → assessment object
 *
 * The scoring formula (40% min + 60% avg) is jurisdiction-agnostic.
 */

const fs = require("fs");
const path = require("path");

const ENGINE_VERSION = "3.0.0";

// ─── Jurisdiction Loader ──────────────────────────────────────────────────────

const _jurisdictionCache = {};

/**
 * Load a jurisdiction JSON by ID (e.g., "ZA-POPIA", "NG-NDPA").
 * Looks for a file matching `jurisdiction-{id}.json` in the given directory.
 * Falls back to scanning all files for a matching jurisdiction_id.
 */
function loadJurisdiction(jurisdictionId, jurisdictionsDir) {
  if (_jurisdictionCache[jurisdictionId]) {
    return _jurisdictionCache[jurisdictionId];
  }

  const normalised = jurisdictionId.toUpperCase();

  // Try direct filename match first
  const candidates = [
    `jurisdiction-${jurisdictionId}.json`,
    `jurisdiction-${normalised}.json`,
    `jurisdiction-${jurisdictionId.toLowerCase()}.json`,
  ];

  for (const candidate of candidates) {
    const filePath = path.join(jurisdictionsDir, candidate);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      _jurisdictionCache[jurisdictionId] = data;
      return data;
    }
  }

  // Scan directory for matching jurisdiction_id
  const files = fs.readdirSync(jurisdictionsDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const filePath = path.join(jurisdictionsDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const id = data.jurisdiction_metadata?.jurisdiction_id;
    if (id && id.toUpperCase() === normalised) {
      _jurisdictionCache[jurisdictionId] = data;
      return data;
    }
  }

  throw new Error(`Jurisdiction not found: ${jurisdictionId}`);
}

/**
 * List all available jurisdiction IDs.
 */
function listJurisdictions(jurisdictionsDir) {
  const files = fs.readdirSync(jurisdictionsDir).filter((f) => f.endsWith(".json"));
  const jurisdictions = [];
  for (const file of files) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(jurisdictionsDir, file), "utf8")
      );
      const meta = data.jurisdiction_metadata;
      if (meta) {
        jurisdictions.push({
          id: meta.jurisdiction_id,
          name: meta.jurisdiction_name,
          law: meta.law_short_name || meta.law_name_english,
          status: meta.law_status,
          tier: meta.complexity_tier,
        });
      }
    } catch (_) {
      // Skip malformed files
    }
  }
  return jurisdictions.sort((a, b) => (a.tier || 99) - (b.tier || 99));
}

// ─── Regex helpers ────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionRefsToRegexes(sectionRef) {
  if (!sectionRef) return [];
  // Extract section/article references like "s22", "Art 33", "Section 72"
  const patterns = [];
  const refs = String(sectionRef).split(/[,;]/);
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    // Match patterns like "s22", "s55-56", "Art 33", "Section 72"
    const match = trimmed.match(
      /(?:section|s|art(?:icle)?\.?)\s*(\d+(?:[-(]\d+[)]?)?)/i
    );
    if (match) {
      patterns.push(new RegExp(`\\b(?:section|s|art(?:icle)?\\.?)\\s*${escapeRegex(match[1])}\\b`, "i"));
    }
  }
  return patterns;
}

// ─── Rule Generator ───────────────────────────────────────────────────────────

/**
 * Generic keywords per category — detect the concept in any document.
 * These are jurisdiction-agnostic.
 */
const GENERIC_KEYWORDS = {
  information_officer: [
    /information officer/i, /responsible party/i, /privacy officer/i,
    /data protection officer/i, /\bDPO\b/, /privacy lead/i,
  ],
  lawful_processing: [
    /lawful basis/i, /legal basis/i, /grounds for processing/i,
    /legitimate interest/i, /contractual necessity/i, /legal obligation/i,
    /vital interest/i, /public interest/i, /performance of a contract/i,
  ],
  consent_mechanism: [
    /\bconsent\b/i, /opt[- ]?in/i, /withdraw.*consent/i,
    /consent.*withdraw/i, /revoke.*consent/i, /voluntary/i,
    /informed consent/i, /explicit consent/i,
  ],
  cross_border_transfer: [
    /cross[- ]?border/i, /international transfer/i,
    /transfer.*(?:data|personal|information)/i,
    /third countr/i, /adequate.*protection/i,
    /binding corporate rules/i, /standard contractual clauses/i,
    /\bSCC\b/, /\bBCR\b/,
  ],
  data_subject_rights: [
    /right.*access/i, /access.*(?:data|information|personal)/i,
    /right.*correct/i, /rectif/i, /right.*delet/i, /erasure/i,
    /right to be forgotten/i, /right.*object/i, /data portability/i,
    /subject access request/i, /\bSAR\b/, /\bDSAR\b/,
  ],
  breach_notification: [
    /(?:data )?breach/i, /security incident/i, /notif.*breach/i,
    /breach.*notif/i, /72 hours/i, /without (?:undue )?delay/i,
    /incident response/i, /security compromise/i,
  ],
  special_categories: [
    /biometric/i, /health data/i, /medical/i,
    /special.*(?:personal|categor)/i, /sensitive.*(?:data|information)/i,
    /children/i, /child(?:ren)?(?:'s)? data/i, /minor/i, /genetic/i,
    /racial/i, /ethnic/i, /religio/i, /political/i,
    /sex(?:ual)? (?:life|orientation)/i, /trade union/i,
    /physiological/i, /performance data/i, /athlete/i, /player data/i,
  ],
  retention_and_purpose: [
    /retention/i, /data retention/i, /retention period/i,
    /purpose.*(?:limit|specific)/i, /specific purpose/i,
    /no longer necessary/i, /delet.*(?:after|when|once)/i,
    /destroy/i, /store.*(?:period|duration|time)/i,
  ],
  security_safeguards: [
    /security/i, /encrypt/i, /access control/i,
    /technical.*measure/i, /organisational.*measure/i,
    /organizational.*measure/i, /confidential/i, /integrity/i,
    /ISO 27001/i, /SOC 2/i, /security certif/i, /firewall/i,
    /pseudonymis/i, /anonymis/i,
  ],
  direct_marketing: [
    /direct marketing/i, /marketing.*(?:consent|opt)/i,
    /opt[- ]?out/i, /unsubscribe/i, /promotional/i,
    /newsletter/i, /marketing.*(?:email|communication)/i,
    /electronic.*marketing/i,
  ],
};

/**
 * Generate jurisdiction-specific keyword patterns from the jurisdiction JSON.
 */
function generateJurisdictionKeywords(jd, category) {
  const patterns = [];
  const lawName = jd.jurisdiction_metadata?.law_short_name;
  const countryName = jd.jurisdiction_metadata?.jurisdiction_name;
  const authorityName = jd.supervisory_authority?.authority_name;
  const authorityAcronym = jd.supervisory_authority?.authority_acronym;

  // Always add law name and country
  if (lawName) patterns.push(new RegExp(`\\b${escapeRegex(lawName)}\\b`, "i"));
  if (countryName) patterns.push(new RegExp(escapeRegex(countryName), "i"));
  if (authorityName) patterns.push(new RegExp(escapeRegex(authorityName), "i"));
  if (authorityAcronym && authorityAcronym.length >= 2) {
    patterns.push(new RegExp(`\\b${escapeRegex(authorityAcronym)}\\b`));
  }

  // Add section-specific references
  const sectionMap = {
    information_officer: jd.representative_and_dpo,
    lawful_processing: jd.lawful_processing_bases,
    consent_mechanism: jd.lawful_processing_bases,
    cross_border_transfer: jd.cross_border_transfers,
    data_subject_rights: jd.data_subject_rights,
    breach_notification: jd.breach_notification,
    special_categories: jd.special_categories,
    retention_and_purpose: null,
    security_safeguards: null,
    direct_marketing: jd.electronic_marketing,
  };

  const section = sectionMap[category];
  if (section) {
    // Extract section_ref, dpo_section_ref, etc.
    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith("_ref") && typeof value === "string") {
        patterns.push(...sectionRefsToRegexes(value));
      }
    }
  }

  return patterns;
}

/**
 * Generate finding text for a given category and level using jurisdiction data.
 */
function generateFinding(jd, category, level) {
  const lawName = jd.jurisdiction_metadata?.law_short_name || "the data protection law";
  const fullLawName = jd.jurisdiction_metadata?.law_name_english || lawName;
  const countryName = jd.jurisdiction_metadata?.jurisdiction_name || "the jurisdiction";
  const authorityName = jd.supervisory_authority?.authority_name || "the supervisory authority";
  const rep = jd.representative_and_dpo || {};
  const breach = jd.breach_notification || {};
  const xborder = jd.cross_border_transfers || {};
  const marketing = jd.electronic_marketing || {};
  const special = jd.special_categories || {};
  const dpoTitle = rep.dpo_title_local || "Data Protection Officer";
  const foreignRepRequired = rep.foreign_entity_representative_required === true;

  const templates = {
    information_officer: {
      absent: {
        severity: foreignRepRequired ? "critical" : "high",
        finding: `No evidence of an appointed ${dpoTitle} or registration with ${authorityName}. ` +
          (foreignRepRequired
            ? `For a foreign entity processing ${countryName} personal information, this is a direct violation of ${lawName} requirements for representative/officer appointment.`
            : `${lawName} requires appointment of a ${dpoTitle} under specified conditions.`),
        recommendation: `Appoint and register a ${dpoTitle} with ${authorityName} per ${lawName} requirements.` +
          (foreignRepRequired
            ? ` As a foreign entity, appointment of a local representative is a legal requirement.`
            : ``),
      },
      partial: {
        severity: "high",
        finding: `A data protection role (DPO or privacy officer) is referenced in the documentation, but there is no evidence of a ${lawName}-specific ${dpoTitle} appointment or registration with ${authorityName}.`,
        recommendation: `Extend the existing data protection role to include ${lawName} ${dpoTitle} responsibilities and register with ${authorityName}.`,
      },
      present: {
        severity: "low",
        finding: `Documentation references a data protection officer or privacy officer role. However, specific ${lawName} ${dpoTitle} registration should be verified with ${authorityName}.`,
        recommendation: `Verify that the ${dpoTitle} registration with ${authorityName} is current and covers processing of ${countryName} personal information.`,
      },
    },

    lawful_processing: {
      absent: {
        severity: "high",
        finding: `The privacy documentation does not establish a clear lawful basis for processing ${countryName} personal information as required under ${lawName}.`,
        recommendation: `Identify and document the lawful basis for each category of processing activity involving ${countryName} personal data, per ${lawName}.`,
      },
      partial: {
        severity: "medium",
        finding: `A lawful basis for processing is referenced (likely under GDPR or general terms), but no ${lawName}-specific justification is provided.`,
        recommendation: `Map existing lawful bases to ${lawName} equivalents and explicitly reference ${lawName} in documentation applicable to ${countryName} data subjects.`,
      },
      present: {
        severity: "low",
        finding: `Lawful processing bases are documented. Verify that these are mapped to ${lawName} requirements specifically.`,
        recommendation: `Ensure ${lawName}-specific conditions for lawful processing are explicitly addressed in privacy documentation.`,
      },
    },

    consent_mechanism: {
      absent: {
        severity: "high",
        finding: `No consent mechanism is described in the documentation. If processing relies on consent as a lawful basis under ${lawName}, it must meet the law's specific requirements for valid consent.`,
        recommendation: `Implement clear consent mechanisms that meet ${lawName} requirements for valid consent in ${countryName}.`,
      },
      partial: {
        severity: "medium",
        finding: `Consent mechanisms are referenced but may not fully meet ${lawName} requirements for being specific, informed, and withdrawable.`,
        recommendation: `Review consent mechanisms against ${lawName} requirements and ensure withdrawal of consent is clearly communicated and easily exercisable.`,
      },
      present: {
        severity: "low",
        finding: `Consent mechanisms are documented including collection and withdrawal processes.`,
        recommendation: `Verify that consent mechanisms specifically comply with ${lawName} requirements for ${countryName} data subjects.`,
      },
    },

    cross_border_transfer: {
      absent: {
        severity: xborder.general_restriction ? "high" : "medium",
        finding: `No cross-border data transfer mechanisms or disclosures are described despite the company being domiciled outside ${countryName}. ` +
          (xborder.general_restriction
            ? `Under ${lawName}, transfers of personal information outside ${countryName} require specific safeguards.`
            : `${lawName} may impose conditions on international data transfers.`),
        recommendation: `Disclose cross-border data transfer practices and implement safeguards per ${lawName}` +
          (xborder.adequacy_mechanism ? ` — either through adequacy determination, ` : ` — `) +
          (xborder.binding_corporate_rules ? `binding corporate rules, ` : ``) +
          `consent, or contractual obligations.`,
      },
      partial: {
        severity: "medium",
        finding: `Cross-border data transfers are acknowledged (likely under GDPR mechanisms) but ${lawName} specific safeguards for ${countryName} personal information transfers are not addressed.`,
        recommendation: `Extend existing cross-border transfer mechanisms to specifically address ${lawName} requirements for ${countryName} personal data.`,
      },
      present: {
        severity: "low",
        finding: `Cross-border data transfer mechanisms are documented.`,
        recommendation: `Verify that cross-border transfer safeguards are specifically mapped to ${lawName} for ${countryName} personal data.`,
      },
    },

    data_subject_rights: {
      absent: {
        severity: "high",
        finding: `Data subject rights are not clearly communicated in the documentation. ${lawName} requires that data subjects be informed of their rights to access, correct, and delete personal information.`,
        recommendation: `Clearly communicate data subject rights per ${lawName} including the right to request access, correction or deletion, and to object to processing.`,
      },
      partial: {
        severity: "medium",
        finding: `Some data subject rights are mentioned but the documentation does not comprehensively cover all ${lawName} rights.`,
        recommendation: `Expand documentation to cover all ${lawName} data subject rights and provide clear mechanisms for ${countryName} data subjects to exercise these rights.`,
      },
      present: {
        severity: "compliant",
        finding: `Data subject rights including access, correction, and deletion are documented.`,
        recommendation: `Ensure these rights explicitly reference ${lawName} and provide a clear exercise mechanism for ${countryName} data subjects.`,
      },
    },

    breach_notification: {
      absent: {
        severity: breach.mandatory ? "medium" : "low",
        finding: breach.mandatory
          ? `No data breach notification commitment is described. ${lawName} requires notification to ${authorityName}` +
            (breach.authority_notification_timeframe ? ` within ${breach.authority_notification_timeframe}` : ``) +
            ` and affected data subjects after a compromise.`
          : `No data breach notification commitment is described. While ${lawName} may not mandate breach notification, best practice requires a breach response procedure.`,
        recommendation: breach.mandatory
          ? `Implement a breach notification procedure that meets ${lawName} requirements — notify ${authorityName}` +
            (breach.authority_notification_timeframe ? ` within ${breach.authority_notification_timeframe}` : ` as required`) +
            ` and affected data subjects.`
          : `Implement a breach notification procedure aligned with best practices.`,
      },
      partial: {
        severity: "medium",
        finding: `A breach notification commitment exists but does not specifically reference ${lawName} or notification to ${authorityName}.`,
        recommendation: `Extend breach notification procedures to specifically include notification to ${authorityName} per ${lawName}.`,
      },
      present: {
        severity: "low",
        finding: `Breach notification procedures are documented.`,
        recommendation: `Verify that breach notification procedures include ${authorityName} as a notifiable authority per ${lawName}.`,
      },
    },

    special_categories: {
      absent: {
        severity: special.biometric_data_rules || special.health_data_rules ? "critical" : "high",
        finding: `No mention of special personal information handling despite the company likely processing biometric, health, or performance data. ${lawName} imposes additional requirements on processing special personal information.`,
        recommendation: `Identify all special personal information processed (including biometric and health data) and implement ${lawName} safeguards.`,
      },
      partial: {
        severity: "high",
        finding: `Special categories of data (biometric, health, or sensitive data) are acknowledged but safeguards specific to ${lawName} are not addressed.`,
        recommendation: `Map special personal information processing to ${lawName} requirements.`,
      },
      present: {
        severity: "medium",
        finding: `Special personal information handling is addressed in the documentation.`,
        recommendation: `Verify that special personal information safeguards specifically comply with ${lawName}.`,
      },
    },

    retention_and_purpose: {
      absent: {
        severity: "medium",
        finding: `No data retention policy or purpose limitation is described. ${lawName} requires that personal information be retained only for as long as necessary for the purpose it was collected.`,
        recommendation: `Implement and document a data retention policy that limits retention to the purpose of collection per ${lawName}, with specified retention periods and deletion procedures.`,
      },
      partial: {
        severity: "low",
        finding: `Some retention or purpose limitation language exists but specific retention periods are not defined or ${lawName} is not specifically referenced.`,
        recommendation: `Define specific retention periods for each category of ${countryName} personal data and ensure alignment with ${lawName} purpose limitation requirements.`,
      },
      present: {
        severity: "compliant",
        finding: `Data retention and purpose limitation policies are documented with specified retention periods.`,
        recommendation: `Verify retention periods align with ${lawName} requirements for ${countryName} personal data.`,
      },
    },

    security_safeguards: {
      absent: {
        severity: "medium",
        finding: `No security safeguards are described. ${lawName} requires appropriate technical and organisational measures to secure personal information against loss, damage, and unauthorised access.`,
        recommendation: `Document and implement appropriate technical and organisational security measures per ${lawName}, including access controls, encryption, and security incident procedures.`,
      },
      partial: {
        severity: "low",
        finding: `Some security measures are referenced but a comprehensive description of technical and organisational safeguards per ${lawName} is not provided.`,
        recommendation: `Expand security documentation to comprehensively address ${lawName} requirements including technical measures (encryption, access controls) and organisational measures (staff training, security policies).`,
      },
      present: {
        severity: "compliant",
        finding: `Security safeguards including technical and organisational measures are documented.`,
        recommendation: `Verify that security measures specifically meet ${lawName} requirements for ${countryName} personal data processing.`,
      },
    },

    direct_marketing: {
      absent: {
        severity: marketing.opt_in_required ? "medium" : "low",
        finding: marketing.opt_in_required
          ? `No direct marketing practices are described. If the company engages in direct marketing to ${countryName} data subjects, ${lawName} requires prior consent and an opt-out mechanism.`
          : `No direct marketing practices are described. ${lawName} may impose requirements on electronic marketing to ${countryName} data subjects.`,
        recommendation: marketing.opt_in_required
          ? `If engaging in direct marketing to ${countryName} data subjects, implement ${lawName} requirements including prior consent and a clear opt-out mechanism.`
          : `Review ${lawName} requirements for electronic marketing to ${countryName} data subjects.`,
      },
      partial: {
        severity: "low",
        finding: `Marketing preferences or opt-out mechanisms are mentioned but ${lawName} specific requirements for direct marketing to ${countryName} data subjects are not addressed.`,
        recommendation: `Ensure direct marketing practices to ${countryName} data subjects specifically comply with ${lawName}.`,
      },
      present: {
        severity: "compliant",
        finding: `Direct marketing consent and opt-out mechanisms are documented.`,
        recommendation: `Verify that direct marketing practices comply with ${lawName} for ${countryName} data subjects.`,
      },
    },
  };

  return templates[category]?.[level] || {
    severity: "medium",
    finding: `Assessment against ${lawName} for ${category.replace(/_/g, " ")} could not be completed.`,
    recommendation: `Review ${lawName} requirements for ${category.replace(/_/g, " ")}.`,
  };
}

/**
 * Generate a rules array for a jurisdiction, matching the shape of POPIA_RULES.
 */
function generateRulesForJurisdiction(jd) {
  const categories = Object.keys(GENERIC_KEYWORDS);
  const dpoTitle = jd.representative_and_dpo?.dpo_title_local || "Data Protection Officer";

  const labelMap = {
    information_officer: `${dpoTitle} Registration/Appointment`,
    lawful_processing: "Lawful Basis for Processing",
    consent_mechanism: "Consent Mechanisms",
    cross_border_transfer: "Cross-border Data Transfers",
    data_subject_rights: "Data Subject Rights",
    breach_notification: "Breach Notification",
    special_categories: "Special Personal Information",
    retention_and_purpose: "Retention and Purpose Limitation",
    security_safeguards: "Security Safeguards",
    direct_marketing: "Direct Marketing",
  };

  return categories.map((category) => {
    const absent = generateFinding(jd, category, "absent");
    const partial = generateFinding(jd, category, "partial");
    const present = generateFinding(jd, category, "present");

    return {
      category,
      label: labelMap[category] || category.replace(/_/g, " "),
      keywords: GENERIC_KEYWORDS[category],
      jurisdiction_keywords: generateJurisdictionKeywords(jd, category),
      absent,
      partial,
      present,
    };
  });
}

// ─── Document Analysis ────────────────────────────────────────────────────────

/**
 * Analyse documents against jurisdiction-specific rules.
 * Same matching algorithm as v2.1.0, but parameterised.
 */
function analyseDocumentsMultiJurisdiction(documents, prospect, jd) {
  const rules = generateRulesForJurisdiction(jd);
  const findings = [];
  const countryName = (jd.jurisdiction_metadata?.jurisdiction_name || "").toLowerCase();
  const isForeignEntity =
    (prospect.company_country || "").toLowerCase() !== countryName;
  const rep = jd.representative_and_dpo || {};

  // IR-specific fields (ZA-POPIA backward compat)
  const isNotRegistered = prospect.ir_registered === false;

  for (const rule of rules) {
    const keywordMatches = [];
    const jurisdictionMatches = [];

    for (const doc of documents) {
      const content = doc.markdown_content || "";

      for (const kw of rule.keywords) {
        const match = content.match(kw);
        if (match) {
          const idx = match.index;
          const start = Math.max(0, idx - 80);
          const end = Math.min(content.length, idx + match[0].length + 80);
          const context = content
            .slice(start, end)
            .replace(/\n+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          keywordMatches.push({
            keyword: match[0],
            context,
            docTitle: doc.document_title || doc.document_type,
          });
        }
      }

      for (const kw of rule.jurisdiction_keywords) {
        if (kw.test(content)) {
          jurisdictionMatches.push(kw.source);
        }
      }
    }

    // Determine finding level: absent / partial / present
    let level;
    if (keywordMatches.length === 0) {
      level = "absent";
    } else if (jurisdictionMatches.length === 0) {
      level = "partial";
    } else {
      level = "present";
    }

    // Context-aware overrides
    if (rule.category === "information_officer") {
      // For ZA-POPIA: use IR registration status
      if (jd.jurisdiction_metadata?.jurisdiction_id === "ZA-POPIA" && isNotRegistered) {
        level = "absent";
      } else if (isForeignEntity && rep.foreign_entity_representative_required && level === "present") {
        level = "partial";
      }
    }

    const template = rule[level];
    const firstMatch = keywordMatches[0] || null;

    findings.push({
      check_category: rule.category,
      finding: template.finding,
      severity: template.severity,
      evidence_quote: firstMatch ? firstMatch.context : null,
      evidence_location: firstMatch
        ? `${firstMatch.docTitle} (keyword: "${firstMatch.keyword}")`
        : `Not found in ${documents.length} document(s) analysed`,
      recommendation: template.recommendation,
    });
  }

  return findings;
}

// ─── Assessment Generator ─────────────────────────────────────────────────────

const SEVERITY_SCORES = {
  compliant: 9, info: 8, low: 7, medium: 4, high: 2, critical: 0,
};

const SCORE_FIELD_MAP = {
  information_officer: "score_ir_registration",
  special_categories: "score_biometric_handling",
  cross_border_transfer: "score_cross_border",
  consent_mechanism: "score_consent_mechanism",
  breach_notification: "score_breach_notification",
  data_subject_rights: "score_data_subject_rights",
};

/**
 * Generate a scored assessment from analysis findings.
 * Same scoring formula as v2.1.0 (40% min + 60% avg).
 */
function generateMultiJurisdictionAssessment(findings, prospect, jd) {
  const lawName = jd.jurisdiction_metadata?.law_short_name || "the data protection law";
  const fullLawName = jd.jurisdiction_metadata?.law_name_english || lawName;
  const countryName = jd.jurisdiction_metadata?.jurisdiction_name || "the jurisdiction";
  const authorityName = jd.supervisory_authority?.authority_name || "the supervisory authority";
  const isForeignEntity =
    (prospect.company_country || "").toLowerCase() !==
    (countryName || "").toLowerCase();

  // Domain scores
  const domainScores = {};
  for (const [category, field] of Object.entries(SCORE_FIELD_MAP)) {
    const match = findings.find((f) => f.check_category === category);
    domainScores[field] = match ? (SEVERITY_SCORES[match.severity] ?? 5) : 5;
  }

  const allScores = Object.values(domainScores);
  const minScore = Math.min(...allScores);
  const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  domainScores.score_overall = Math.round(minScore * 0.4 + avgScore * 0.6);

  let overallSeverity;
  if (domainScores.score_overall <= 2) overallSeverity = "critical";
  else if (domainScores.score_overall <= 4) overallSeverity = "high";
  else if (domainScores.score_overall <= 6) overallSeverity = "medium";
  else overallSeverity = "low";

  // Severity counts
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;
  const compliantCount = findings.filter((f) => f.severity === "compliant").length;

  const companyName = prospect.company_name;
  const country = prospect.company_country || "an undisclosed jurisdiction";

  // Executive summary — parameterised
  let summary = "";
  summary += `${companyName}, domiciled in ${country}, has been assessed against the ${fullLawName} (${lawName}). `;
  summary += `The assessment identified ${findings.length} findings across 10 ${lawName} compliance domains: `;
  summary += `${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low severity, and ${compliantCount} compliant. `;
  summary += `The overall compliance score is ${domainScores.score_overall}/10, rated as ${overallSeverity} risk.\n\n`;

  if (criticalCount > 0) {
    const criticalCategories = findings
      .filter((f) => f.severity === "critical")
      .map((f) => f.check_category.replace(/_/g, " "));
    summary += `Critical areas of concern include: ${criticalCategories.join(", ")}. `;
    summary += `These represent direct non-compliance with ${lawName} requirements that could result in enforcement action by ${authorityName}. `;
  }

  // ZA-POPIA specific: IR registration details (backward compatible)
  if (jd.jurisdiction_metadata?.jurisdiction_id === "ZA-POPIA") {
    if (prospect.ir_registered === false) {
      summary += `The company is not currently registered with the ${authorityName}. `;
      const verifiedVia =
        prospect.ir_verification_method === "manual_portal"
          ? `This was verified against the ${authorityName}'s eServices portal on ${prospect.ir_verified_date || "an unrecorded date"}. `
          : prospect.ir_verification_method === "automated"
          ? `This was verified automatically against the ${authorityName} register on ${prospect.ir_verified_date || "an unrecorded date"}. `
          : `Note: this status has not been independently verified against the ${authorityName}'s register. `;
      summary += verifiedVia;
      if (isForeignEntity) {
        summary += `As a foreign entity processing ${countryName} personal information, registration of an Information Officer per POPIA s55-56 and appointment of a representative per s58 is a legal requirement.\n\n`;
      }
    } else if (prospect.ir_registered === true && prospect.ir_entity_name) {
      summary += `The company is registered with the ${authorityName} as "${prospect.ir_entity_name}"`;
      if (prospect.ir_registration_no) summary += ` (registration no. ${prospect.ir_registration_no})`;
      summary += `. `;
      if (prospect.ir_io_name) {
        summary += `The appointed Information Officer is ${prospect.ir_io_name}`;
        if (prospect.ir_io_designation) summary += ` (${prospect.ir_io_designation})`;
        summary += `. `;
      }
      if (prospect.ir_verified_date) {
        summary += `Verified via ${authorityName} eServices portal on ${prospect.ir_verified_date}. `;
      }
    }
  }

  // Generic remediation recommendation
  const topCategories = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 3)
    .map((f) => f.check_category.replace(/_/g, " "));

  if (topCategories.length > 0) {
    summary += `Immediate remediation is recommended, prioritising ${topCategories.join(", ")}.`;
  }

  // Risk factors
  const riskFactors = [];

  // ZA-POPIA specific: IR registration
  if (jd.jurisdiction_metadata?.jurisdiction_id === "ZA-POPIA") {
    if (prospect.ir_registered === false) {
      const verNote =
        !prospect.ir_verification_method || prospect.ir_verification_method === "assumed"
          ? " (not independently verified — status assumed from prior research)"
          : ` (verified via ${authorityName} eServices portal on ${prospect.ir_verified_date || "unrecorded date"})`;
      riskFactors.push({
        level: "critical",
        factor: "No IO registration",
        note: `The company is not registered with the ${authorityName} despite processing ${countryName} personal data${verNote}`,
      });
    }
    if (!prospect.ir_verification_method || prospect.ir_verification_method === "assumed") {
      riskFactors.push({
        level: "high",
        factor: "IR registration not verified",
        note: `The IR registration status has not been independently verified against the ${authorityName}'s eServices portal. Verification is required before this assessment can be finalised.`,
      });
    }
  }

  if (criticalCount > 0) {
    riskFactors.push({
      level: "critical",
      factor: "Critical compliance gaps",
      note: `${criticalCount} critical finding(s) identified representing direct ${lawName} violations`,
    });
  }
  if (isForeignEntity) {
    riskFactors.push({
      level: "high",
      factor: "Foreign entity extraterritoriality",
      note: `As a foreign entity, ${lawName} extraterritorial jurisdiction may apply if processing ${countryName} personal data or using means in ${countryName}`,
    });
  }
  if (highCount > 0) {
    riskFactors.push({
      level: "high",
      factor: "Significant compliance gaps",
      note: `${highCount} high-severity finding(s) materially increase regulatory risk`,
    });
  }

  // Key findings — top 8
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4, compliant: 5 };
  const sortedFindings = [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
  );
  const keyFindings = sortedFindings
    .slice(0, Math.min(8, sortedFindings.length))
    .map((f) => ({
      finding_id: f.id || null,
      category: f.check_category,
      severity: f.severity,
      finding: f.finding,
      evidence: f.evidence_quote || null,
    }));

  // Recommendations — top 6
  const recommendations = sortedFindings
    .filter((f) => f.recommendation && f.severity !== "compliant")
    .slice(0, 6)
    .map((f, i) => ({
      priority: i + 1,
      action: f.recommendation,
      rationale: `Addresses ${f.severity}-severity finding in ${f.check_category.replace(/_/g, " ")}`,
    }));

  // IR verification metadata (ZA-POPIA specific, included for backward compat)
  const irVerification = jd.jurisdiction_metadata?.jurisdiction_id === "ZA-POPIA"
    ? {
        ir_registered: prospect.ir_registered,
        ir_verified: !!(prospect.ir_verification_method && prospect.ir_verification_method !== "assumed"),
        ir_verified_date: prospect.ir_verified_date || null,
        ir_verification_method: prospect.ir_verification_method || null,
        ir_entity_name: prospect.ir_entity_name || null,
        ir_registration_no: prospect.ir_registration_no || null,
        ir_io_name: prospect.ir_io_name || null,
        ir_io_designation: prospect.ir_io_designation || null,
      }
    : null;

  const result = {
    ...domainScores,
    overall_severity: overallSeverity,
    jurisdiction_id: jd.jurisdiction_metadata?.jurisdiction_id,
    jurisdiction_name: countryName,
    law_name: lawName,
    engine_version: ENGINE_VERSION,
    executive_summary: summary,
    risk_factors: riskFactors,
    key_findings: keyFindings,
    recommendations,
  };

  if (irVerification) {
    result.ir_verification = irVerification;
  }

  return result;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ENGINE_VERSION,
  loadJurisdiction,
  listJurisdictions,
  generateRulesForJurisdiction,
  analyseDocumentsMultiJurisdiction,
  generateMultiJurisdictionAssessment,
  SEVERITY_SCORES,
  SCORE_FIELD_MAP,
};

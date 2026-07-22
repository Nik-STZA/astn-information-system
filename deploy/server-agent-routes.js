/**
 * Agent routes patch for Cloud Run server.js
 *
 * ADD these route blocks AFTER the pipeline routes (documents, analysis, assessments).
 *
 * Provides three agent endpoints:
 *  - POST /api/compliance/prospects/:id/ingest   — fetch & store prospect documents
 *  - POST /api/compliance/prospects/:id/analyse   — run POPIA compliance analysis (rule-based)
 *  - POST /api/compliance/prospects/:id/assess    — generate scored assessment (rule-based)
 *
 * PREREQUISITES:
 *  1. npm install node-html-markdown
 *  2. The pipeline routes (server-pipeline-routes.js) must already be applied
 *
 * DEPENDENCIES (add at the top of server.js alongside existing requires):
 *
 *   const { NodeHtmlMarkdown } = require("node-html-markdown");
 *   const crypto = require("crypto");
 *
 *   const nhm = new NodeHtmlMarkdown();
 *
 * NOTE: This version uses a deterministic rule-based POPIA analysis engine.
 * No external LLM API is required.
 */

const crypto = require("crypto");

const ANALYSIS_ENGINE_VERSION = "2.2.0";

// ─── Helper: format a date value (Date object or ISO string) ───────────────

function formatDate(val) {
  if (!val) return null;
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const day = d.getUTCDate();
    const months = ["January","February","March","April","May","June",
      "July","August","September","October","November","December"];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return String(val);
  }
}

// ─── Helper: clean scraped markdown for analysis ───────────────────────────

function cleanMarkdown(raw) {
  if (!raw) return "";
  let text = raw;
  // Strip repeated navigation/menu patterns (lines of just "* Link" items)
  text = text.replace(/^(\s*\*\s+\[.*?\]\(.*?\)\s*\n){5,}/gm, "");
  // Strip HTML artifacts
  text = text.replace(/<[^>]+>/g, " ");
  // Collapse excessive whitespace and bullet noise
  text = text.replace(/(\s*\*\s*){3,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\s{3,}/g, " ");
  return text.trim();
}

// ─── Helper: fetch a URL and convert to markdown ────────────────────────────

async function fetchAndConvert(url, nhm) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AfricanSTN-Compliance-Agent/1.0)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { error: `HTTP ${res.status}`, html: null, markdown: null };
    }

    const contentType = res.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      const text = await res.text();
      return { error: null, html: null, markdown: text.slice(0, 100000) };
    }

    const html = await res.text();
    const markdown = nhm.translate(html);

    return {
      error: null,
      html: html.slice(0, 500000),
      markdown: markdown.slice(0, 100000),
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      error: err.name === "AbortError" ? "Timeout after 15s" : err.message,
      html: null,
      markdown: null,
    };
  }
}

// Map prospect URL fields to document_type values
const URL_FIELD_MAP = {
  privacy_policy_url: "privacy_policy",
  terms_url: "terms_of_service",
  app_store_url: "other",
  linkedin_url: "other",
};

// ─── Rule-based POPIA Compliance Analysis Engine ──────────────────────────
//
// Deterministic keyword/pattern matching against 10 POPIA check categories.
// No external LLM API required.

const POPIA_RULES = [
  {
    category: "information_officer",
    label: "Information Officer Registration",
    keywords: [
      /information officer/i, /responsible party/i, /privacy officer/i,
      /data protection officer/i, /\bDPO\b/, /privacy lead/i,
    ],
    sa_keywords: [
      /information regulator/i, /\bPOPIA\b/i, /south africa/i,
      /section 5[5-8]/i, /\bs5[5-8]\b/i,
    ],
    absent: {
      severity: "critical",
      finding:
        "No evidence of an appointed Information Officer or registration with the South African Information Regulator. For a foreign entity processing South African personal information, this is a direct violation of POPIA s55-56 and s58.",
      recommendation:
        "Appoint and register an Information Officer with the SA Information Regulator per POPIA s55-56. As a foreign entity, s58 requires appointment of a representative domiciled in South Africa.",
    },
    partial: {
      severity: "high",
      finding:
        "A data protection role (DPO or privacy officer) is referenced in the documentation, but there is no evidence of a POPIA-specific Information Officer appointment or registration with the South African Information Regulator.",
      recommendation:
        "Extend the existing data protection role to include POPIA Information Officer responsibilities and register with the SA Information Regulator per s55-56.",
    },
    present: {
      severity: "low",
      finding:
        "Documentation references a data protection officer or privacy officer role. However, specific POPIA Information Officer registration should be verified with the Information Regulator.",
      recommendation:
        "Verify that the Information Officer registration with the SA Information Regulator is current and covers processing of South African personal information.",
    },
  },
  {
    category: "lawful_processing",
    label: "Lawful Basis for Processing",
    keywords: [
      /lawful basis/i, /legal basis/i, /grounds for processing/i,
      /legitimate interest/i, /contractual necessity/i, /legal obligation/i,
      /vital interest/i, /public interest/i, /performance of a contract/i,
    ],
    sa_keywords: [
      /\bPOPIA\b/i, /section [89]\b/i, /section 1[0-2]\b/i,
      /condition[s]? for lawful processing/i,
    ],
    absent: {
      severity: "high",
      finding:
        "The privacy documentation does not establish a clear lawful basis for processing South African personal information as required under POPIA s8-12.",
      recommendation:
        "Identify and document the lawful basis for each category of processing activity involving South African personal data, per POPIA s8-12.",
    },
    partial: {
      severity: "medium",
      finding:
        "A lawful basis for processing is referenced (likely under GDPR or general terms), but no POPIA-specific justification under s8-12 is provided.",
      recommendation:
        "Map existing GDPR lawful bases to POPIA equivalents and explicitly reference POPIA s8-12 in documentation applicable to South African data subjects.",
    },
    present: {
      severity: "low",
      finding:
        "Lawful processing bases are documented. Verify that these are mapped to POPIA s8-12 requirements specifically.",
      recommendation:
        "Ensure POPIA-specific conditions for lawful processing under s8-12 are explicitly addressed in privacy documentation.",
    },
  },
  {
    category: "consent_mechanism",
    label: "Consent Mechanisms",
    keywords: [
      /\bconsent\b/i, /\bopt[- ]?in\b/i, /withdraw.*consent/i,
      /consent.*withdraw/i, /revoke.*consent/i, /\bvoluntary\b/i,
      /informed consent/i, /explicit consent/i,
    ],
    sa_keywords: [
      /\bPOPIA\b/i, /section 11/i, /\bs11\b/i,
      /specific.*informed.*voluntary/i,
    ],
    absent: {
      severity: "high",
      finding:
        "No consent mechanism is described in the documentation. If processing relies on consent as a lawful basis under POPIA s11, it must be specific, informed, voluntary, and capable of withdrawal.",
      recommendation:
        "Implement clear consent mechanisms that meet POPIA s11 requirements: consent must be specific, informed, given voluntarily, and the data subject must be able to withdraw consent.",
    },
    partial: {
      severity: "medium",
      finding:
        "Consent mechanisms are referenced but may not fully meet POPIA s11 requirements for being specific, informed, voluntary, and withdrawable.",
      recommendation:
        "Review consent mechanisms against POPIA s11 requirements and ensure withdrawal of consent is clearly communicated and easily exercisable.",
    },
    present: {
      severity: "low",
      finding:
        "Consent mechanisms are documented including collection and withdrawal processes.",
      recommendation:
        "Verify that consent mechanisms specifically comply with POPIA s11 requirements for South African data subjects.",
    },
  },
  {
    category: "cross_border_transfer",
    label: "Cross-border Data Transfers",
    keywords: [
      /cross[- ]?border/i, /international transfer/i,
      /transfer.*(?:data|personal|information)/i,
      /third countr/i, /outside.*(?:south africa|SA|EEA|EU)/i,
      /adequate.*protection/i, /binding corporate rules/i,
      /standard contractual clauses/i, /\bSCC\b/, /\bBCR\b/,
    ],
    sa_keywords: [
      /\bPOPIA\b/i, /section 72/i, /\bs72\b/i, /information regulator/i,
    ],
    absent: {
      severity: "high",
      finding:
        "No cross-border data transfer mechanisms or disclosures are described despite the company being domiciled outside South Africa. Under POPIA s72, transfers of personal information outside South Africa require specific safeguards.",
      recommendation:
        "Disclose cross-border data transfer practices and implement safeguards per POPIA s72 — either through adequate protection in the recipient country, binding corporate rules, consent, or contractual obligations.",
    },
    partial: {
      severity: "medium",
      finding:
        "Cross-border data transfers are acknowledged (likely under GDPR mechanisms) but POPIA s72 specific safeguards for South African personal information transfers are not addressed.",
      recommendation:
        "Extend existing cross-border transfer mechanisms to specifically address POPIA s72 requirements for South African personal data.",
    },
    present: {
      severity: "low",
      finding:
        "Cross-border data transfer mechanisms are documented.",
      recommendation:
        "Verify that cross-border transfer safeguards are specifically mapped to POPIA s72 for South African personal data.",
    },
  },
  {
    category: "data_subject_rights",
    label: "Data Subject Rights",
    keywords: [
      /right.*access/i, /access.*(?:data|information|personal)/i,
      /right.*correct/i, /rectif/i, /right.*delet/i, /erasure/i,
      /right to be forgotten/i, /right.*object/i, /data portability/i,
      /subject access request/i, /\bSAR\b/, /\bDSAR\b/,
    ],
    sa_keywords: [/\bPOPIA\b/i, /section 2[3-5]/i, /\bs2[3-5]\b/i],
    absent: {
      severity: "high",
      finding:
        "Data subject rights are not clearly communicated in the documentation. POPIA s23-25 requires that data subjects be informed of their rights to access, correct, and delete personal information and to object to processing.",
      recommendation:
        "Clearly communicate data subject rights per POPIA s23-25 including the right to request access (s23), correction or deletion (s24), and to object to processing (s11(3)).",
    },
    partial: {
      severity: "medium",
      finding:
        "Some data subject rights are mentioned but the documentation does not comprehensively cover all POPIA s23-25 rights (access, correction, deletion, objection).",
      recommendation:
        "Expand documentation to cover all POPIA s23-25 data subject rights and provide clear mechanisms for South African data subjects to exercise these rights.",
    },
    present: {
      severity: "compliant",
      finding:
        "Data subject rights including access, correction, and deletion are documented.",
      recommendation:
        "Ensure these rights explicitly reference POPIA s23-25 and provide a clear exercise mechanism for South African data subjects.",
    },
  },
  {
    category: "breach_notification",
    label: "Breach Notification",
    keywords: [
      /(?:data )?breach/i, /security incident/i, /notif.*breach/i,
      /breach.*notif/i, /72 hours/i, /without (?:undue )?delay/i,
      /incident response/i, /security compromise/i,
    ],
    sa_keywords: [
      /\bPOPIA\b/i, /section 22/i, /\bs22\b/i, /information regulator/i,
    ],
    absent: {
      severity: "medium",
      finding:
        "No data breach notification commitment is described. POPIA s22 requires notification to the Information Regulator and affected data subjects as soon as reasonably possible after a compromise.",
      recommendation:
        "Implement a breach notification procedure that meets POPIA s22 requirements — notify the Information Regulator and affected data subjects as soon as reasonably possible after discovery of a security compromise.",
    },
    partial: {
      severity: "medium",
      finding:
        "A breach notification commitment exists (likely aligned to GDPR requirements) but does not specifically reference POPIA s22 or notification to the South African Information Regulator.",
      recommendation:
        "Extend breach notification procedures to specifically include notification to the SA Information Regulator per POPIA s22, in addition to any existing GDPR notification obligations.",
    },
    present: {
      severity: "low",
      finding:
        "Breach notification procedures are documented.",
      recommendation:
        "Verify that breach notification procedures include the SA Information Regulator as a notifiable authority per POPIA s22.",
    },
  },
  {
    category: "special_categories",
    label: "Special Personal Information",
    keywords: [
      /biometric/i, /health data/i, /medical/i,
      /special.*(?:personal|categor)/i, /sensitive.*(?:data|information)/i,
      /children/i, /child(?:ren)?(?:'s)? data/i, /minor/i, /genetic/i,
      /racial/i, /ethnic/i, /religio/i, /political/i,
      /sex(?:ual)? (?:life|orientation)/i, /trade union/i,
      /physiological/i, /performance data/i, /athlete/i, /player data/i,
    ],
    sa_keywords: [
      /\bPOPIA\b/i, /section 2[6-9]/i, /section 3[0-3]/i,
      /prior authoris/i, /information regulator/i, /\bs57\b/i,
    ],
    absent: {
      severity: "critical",
      finding:
        "No mention of special personal information handling despite the company likely processing biometric, health, or performance data. POPIA s26-33 imposes additional requirements on processing special personal information including prior authorisation from the Information Regulator.",
      recommendation:
        "Identify all special personal information processed (including biometric and health data) and implement POPIA s26-33 safeguards. Obtain prior authorisation from the Information Regulator per s57 if processing biometric data.",
    },
    partial: {
      severity: "high",
      finding:
        "Special categories of data (biometric, health, or sensitive data) are acknowledged but safeguards specific to POPIA s26-33 are not addressed. Prior authorisation from the Information Regulator may be required per s57.",
      recommendation:
        "Map special personal information processing to POPIA s26-33 requirements and apply for prior authorisation from the Information Regulator per s57 where required (particularly for biometric data processing).",
    },
    present: {
      severity: "medium",
      finding:
        "Special personal information handling is addressed in the documentation.",
      recommendation:
        "Verify that special personal information safeguards specifically comply with POPIA s26-33 and that prior authorisation has been obtained from the Information Regulator where required.",
    },
  },
  {
    category: "retention_and_purpose",
    label: "Retention and Purpose Limitation",
    keywords: [
      /retention/i, /data retention/i, /retention period/i,
      /purpose.*(?:limit|specific)/i, /specific purpose/i,
      /no longer necessary/i, /delet.*(?:after|when|once)/i,
      /destroy/i, /store.*(?:period|duration|time)/i,
    ],
    sa_keywords: [/\bPOPIA\b/i, /section 1[3-4]/i, /\bs1[3-4]\b/i],
    absent: {
      severity: "medium",
      finding:
        "No data retention policy or purpose limitation is described. POPIA s13-14 requires that personal information be retained only for as long as necessary for the purpose it was collected.",
      recommendation:
        "Implement and document a data retention policy that limits retention to the purpose of collection per POPIA s13-14, with specified retention periods and deletion procedures.",
    },
    partial: {
      severity: "low",
      finding:
        "Some retention or purpose limitation language exists but specific retention periods are not defined or POPIA s13-14 is not specifically referenced.",
      recommendation:
        "Define specific retention periods for each category of South African personal data and ensure alignment with POPIA s13-14 purpose limitation requirements.",
    },
    present: {
      severity: "compliant",
      finding:
        "Data retention and purpose limitation policies are documented with specified retention periods.",
      recommendation:
        "Verify retention periods align with POPIA s13-14 requirements for South African personal data.",
    },
  },
  {
    category: "security_safeguards",
    label: "Security Safeguards",
    keywords: [
      /security/i, /encrypt/i, /access control/i,
      /technical.*measure/i, /organisational.*measure/i,
      /organizational.*measure/i, /confidential/i, /integrity/i,
      /ISO 27001/i, /SOC 2/i, /security certif/i, /firewall/i,
      /pseudonymis/i, /anonymis/i,
    ],
    sa_keywords: [/\bPOPIA\b/i, /section 19/i, /\bs19\b/i],
    absent: {
      severity: "medium",
      finding:
        "No security safeguards are described. POPIA s19 requires appropriate technical and organisational measures to secure personal information against loss, damage, and unauthorised access.",
      recommendation:
        "Document and implement appropriate technical and organisational security measures per POPIA s19, including access controls, encryption, and security incident procedures.",
    },
    partial: {
      severity: "low",
      finding:
        "Some security measures are referenced but a comprehensive description of technical and organisational safeguards per POPIA s19 is not provided.",
      recommendation:
        "Expand security documentation to comprehensively address POPIA s19 requirements including technical measures (encryption, access controls) and organisational measures (staff training, security policies).",
    },
    present: {
      severity: "compliant",
      finding:
        "Security safeguards including technical and organisational measures are documented.",
      recommendation:
        "Verify that security measures specifically meet POPIA s19 requirements for South African personal data processing.",
    },
  },
  {
    category: "direct_marketing",
    label: "Direct Marketing",
    keywords: [
      /direct marketing/i, /marketing.*(?:consent|opt)/i,
      /opt[- ]?out/i, /unsubscribe/i, /promotional/i,
      /newsletter/i, /marketing.*(?:email|communication)/i,
      /electronic.*marketing/i,
    ],
    sa_keywords: [/\bPOPIA\b/i, /section 69/i, /\bs69\b/i],
    absent: {
      severity: "low",
      finding:
        "No direct marketing practices are described. If the company engages in direct marketing to South African data subjects, POPIA s69 requires prior consent and an opt-out mechanism.",
      recommendation:
        "If engaging in direct marketing to South African data subjects, implement POPIA s69 requirements including prior consent and a clear opt-out mechanism.",
    },
    partial: {
      severity: "low",
      finding:
        "Marketing preferences or opt-out mechanisms are mentioned but POPIA s69 specific requirements for direct marketing to South African data subjects are not addressed.",
      recommendation:
        "Ensure direct marketing practices to South African data subjects specifically comply with POPIA s69 — prior consent and opt-out mechanism.",
    },
    present: {
      severity: "compliant",
      finding:
        "Direct marketing consent and opt-out mechanisms are documented.",
      recommendation:
        "Verify that direct marketing practices comply with POPIA s69 for South African data subjects.",
    },
  },
];

/**
 * Analyse documents against POPIA rules using keyword/pattern matching.
 * Returns an array of findings in the same shape as the original API response.
 */
function analyseDocumentsRuleBased(documents, prospect) {
  const findings = [];
  const isForeignEntity =
    (prospect.company_country || "").toLowerCase() !== "south africa";
  const isNotRegistered = prospect.ir_registered === false;
  const irVerified = prospect.ir_verification_method && prospect.ir_verification_method !== "assumed";

  for (const rule of POPIA_RULES) {
    const keywordMatches = [];
    const saMatches = [];

    // Search each document for keyword matches
    for (const doc of documents) {
      const content = cleanMarkdown(doc.markdown_content || "");
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

      for (const kw of rule.sa_keywords) {
        if (kw.test(content)) {
          saMatches.push(kw.source);
        }
      }
    }

    // Determine finding level: absent / partial / present
    let level;
    if (keywordMatches.length === 0) {
      level = "absent";
    } else if (saMatches.length === 0) {
      level = "partial";
    } else {
      level = "present";
    }

    // Context-aware overrides
    if (rule.category === "information_officer") {
      // If verified as registered with the IR, override to compliant regardless of doc content
      if (prospect.ir_registered === true && irVerified) {
        const entityNote = prospect.ir_entity_name ? ` as "${prospect.ir_entity_name.trim()}"` : "";
        const regNote = prospect.ir_registration_no ? ` (registration ${prospect.ir_registration_no})` : "";
        const ioNote = prospect.ir_io_name ? ` The appointed Information Officer is ${prospect.ir_io_name}${prospect.ir_io_designation ? ` (${prospect.ir_io_designation})` : ""}.` : "";
        const verifiedNote = prospect.ir_verified_date ? ` Verified via IR eServices portal on ${formatDate(prospect.ir_verified_date)}.` : "";
        findings.push({
          check_category: rule.category,
          finding: `The company is registered with the South African Information Regulator${entityNote}${regNote}.${ioNote}${verifiedNote} Registration requirement under POPIA s55-56 is satisfied.`,
          severity: "compliant",
          evidence_quote: null,
          evidence_location: "Information Regulator eServices portal (manual verification)",
          recommendation: "Ensure Information Officer registration remains current and covers all processing of South African personal information.",
        });
        continue; // skip the normal template-based finding
      }
      if (isNotRegistered) level = "absent";
      else if (isForeignEntity && level === "present") level = "partial";
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

/**
 * Generate a scored assessment from analysis findings.
 * Deterministic — no external API required.
 */
function generateAssessmentFromFindings(findings, prospect) {
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

  const domainScores = {};
  for (const [category, field] of Object.entries(SCORE_FIELD_MAP)) {
    const match = findings.find((f) => f.check_category === category);
    domainScores[field] = match ? (SEVERITY_SCORES[match.severity] ?? 5) : 5;
  }

  // Overall: weakest-link biased (40% worst, 60% average)
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
  const isForeignEntity = (prospect.company_country || "").toLowerCase() !== "south africa";

  // Executive summary
  let summary = "";
  summary += `${companyName}, domiciled in ${country}, has been assessed against the Protection of Personal Information Act (POPIA), Act 4 of 2013. `;
  summary += `The assessment identified ${findings.length} findings across 10 POPIA compliance domains: `;
  summary += `${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low severity, and ${compliantCount} compliant. `;
  summary += `The overall compliance score is ${domainScores.score_overall}/10, rated as ${overallSeverity} risk.\n\n`;

  if (criticalCount > 0) {
    const criticalCategories = findings
      .filter((f) => f.severity === "critical")
      .map((f) => f.check_category.replace(/_/g, " "));
    summary += `Critical areas of concern include: ${criticalCategories.join(", ")}. `;
    summary += `These represent direct non-compliance with POPIA requirements that could result in enforcement action by the Information Regulator. `;
  }

  if (prospect.ir_registered === false) {
    summary += `The company is not currently registered with the South African Information Regulator. `;
    const verifiedVia = prospect.ir_verification_method === "manual_portal"
      ? `This was verified against the Information Regulator's eServices portal on ${formatDate(prospect.ir_verified_date) || "an unrecorded date"}. `
      : prospect.ir_verification_method === "automated"
      ? `This was verified automatically against the IR register on ${formatDate(prospect.ir_verified_date) || "an unrecorded date"}. `
      : `Note: this status has not been independently verified against the Information Regulator's register. `;
    summary += verifiedVia;
    if (isForeignEntity) {
      summary += `As a foreign entity processing South African personal information, registration of an Information Officer per POPIA s55-56 and appointment of a representative per s58 is a legal requirement.\n\n`;
    }
  } else if (prospect.ir_registered === true && prospect.ir_entity_name) {
    summary += `The company is registered with the Information Regulator as "${prospect.ir_entity_name.trim()}"`;
    if (prospect.ir_registration_no) summary += ` (registration no. ${prospect.ir_registration_no})`;
    summary += `. `;
    if (prospect.ir_io_name) {
      summary += `The appointed Information Officer is ${prospect.ir_io_name}`;
      if (prospect.ir_io_designation) summary += ` (${prospect.ir_io_designation})`;
      summary += `. `;
    }
    if (prospect.ir_verified_date) {
      summary += `Verified via IR eServices portal on ${formatDate(prospect.ir_verified_date)}. `;
    }
  }

  // Build dynamic remediation priorities from non-compliant findings
  const nonCompliant = findings.filter((f) => f.severity !== "compliant" && f.severity !== "info" && f.severity !== "low");
  if (nonCompliant.length > 0) {
    const priorityLabels = {
      information_officer: "Information Officer registration (s55-56)",
      special_categories: "special personal information handling (s26-33)",
      cross_border_transfer: "cross-border transfer safeguards (s72)",
      consent_mechanism: "consent mechanisms (s11)",
      breach_notification: "breach notification procedures (s22)",
      data_subject_rights: "data subject rights (s23-25)",
      lawful_processing: "lawful basis for processing (s8-12)",
      retention_and_purpose: "retention and purpose limitation (s13-14)",
      security_safeguards: "security safeguards (s19)",
      direct_marketing: "direct marketing compliance (s69)",
    };
    const topPriorities = nonCompliant
      .slice(0, 3)
      .map((f) => priorityLabels[f.check_category] || f.check_category.replace(/_/g, " "))
      .filter(Boolean);
    if (topPriorities.length > 0) {
      summary += `Immediate remediation is recommended, prioritising ${topPriorities.join(", ")}.`;
    }
  } else {
    summary += `The company demonstrates a strong compliance posture. Ongoing monitoring and periodic review are recommended to maintain compliance.`;
  }

  // Risk factors
  const riskFactors = [];
  if (prospect.ir_registered === false) {
    const verNote = (!prospect.ir_verification_method || prospect.ir_verification_method === "assumed")
      ? " (not independently verified — status assumed from prior research)"
      : ` (verified via IR eServices portal on ${formatDate(prospect.ir_verified_date) || "unrecorded date"})`;
    riskFactors.push({
      level: "critical",
      factor: "No IO registration",
      note: `The company is not registered with the SA Information Regulator despite processing South African personal data${verNote}`,
    });
  }
  // Flag if IR status has not been verified regardless of the boolean value
  if (!prospect.ir_verification_method || prospect.ir_verification_method === "assumed") {
    riskFactors.push({
      level: "high",
      factor: "IR registration not verified",
      note: "The IR registration status has not been independently verified against the Information Regulator's eServices portal. Verification is required before this assessment can be finalised.",
    });
  }
  if (criticalCount > 0) {
    riskFactors.push({
      level: "critical",
      factor: "Critical compliance gaps",
      note: `${criticalCount} critical finding(s) identified representing direct POPIA violations`,
    });
  }
  if (isForeignEntity) {
    riskFactors.push({
      level: "high",
      factor: "Foreign entity extraterritoriality",
      note: "As a foreign entity, POPIA s3(1)(b)(ii) extraterritorial jurisdiction applies if using means in South Africa to process personal data",
    });
  }
  if (highCount > 0) {
    riskFactors.push({
      level: "high",
      factor: "Significant compliance gaps",
      note: `${highCount} high-severity finding(s) materially increase regulatory risk`,
    });
  }

  // Key findings — top 8 sorted by severity
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

  // Recommendations — top 6 non-compliant
  const recommendations = sortedFindings
    .filter((f) => f.recommendation && f.severity !== "compliant")
    .slice(0, 6)
    .map((f, i) => ({
      priority: i + 1,
      action: f.recommendation,
      rationale: `Addresses ${f.severity}-severity finding in ${f.check_category.replace(/_/g, " ")}`,
    }));

  // IR verification metadata (attached to assessment for document generation)
  const irVerification = {
    ir_registered: prospect.ir_registered,
    ir_verified: !!(prospect.ir_verification_method && prospect.ir_verification_method !== "assumed"),
    ir_verified_date: prospect.ir_verified_date || null,
    ir_verification_method: prospect.ir_verification_method || null,
    ir_entity_name: prospect.ir_entity_name || null,
    ir_registration_no: prospect.ir_registration_no || null,
    ir_io_name: prospect.ir_io_name || null,
    ir_io_designation: prospect.ir_io_designation || null,
  };

  return {
    ...domainScores,
    overall_severity: overallSeverity,
    executive_summary: summary,
    risk_factors: riskFactors,
    key_findings: keyFindings,
    recommendations,
    ir_verification: irVerification,
  };
}

// ─── Document Ingestion ─────────────────────────────────────────────────────

app.post("/api/compliance/prospects/:id/ingest", async (req, res) => {
  const prospectId = req.params.id;
  const startTime = Date.now();

  try {
    const { rows: prospectRows } = await pool.query(
      "SELECT * FROM compliance_prospects WHERE id = $1",
      [prospectId]
    );
    if (prospectRows.length === 0) {
      return res.status(404).json({ error: "Prospect not found" });
    }
    const prospect = prospectRows[0];

    await pool.query(
      `UPDATE compliance_prospects
       SET research_status = 'collecting', updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    const urlsToFetch = [];
    for (const [field, docType] of Object.entries(URL_FIELD_MAP)) {
      const url = prospect[field];
      if (url && url.trim()) {
        urlsToFetch.push({ url: url.trim(), document_type: docType, field });
      }
    }

    if (prospect.other_urls) {
      const others = prospect.other_urls
        .split("|")
        .map((u) => u.trim())
        .filter(Boolean);
      for (const url of others) {
        urlsToFetch.push({ url, document_type: "other", field: "other_urls" });
      }
    }

    if (prospect.company_website && !prospect.privacy_policy_url) {
      urlsToFetch.push({
        url: prospect.company_website,
        document_type: "other",
        field: "company_website",
      });
    }

    if (urlsToFetch.length === 0) {
      await pool.query(
        `UPDATE compliance_prospects
         SET research_status = 'not_started', updated_at = NOW()
         WHERE id = $1`,
        [prospectId]
      );
      return res.status(400).json({
        error: "No URLs configured on this prospect",
        fields_checked: Object.keys(URL_FIELD_MAP),
      });
    }

    const results = [];
    for (const { url, document_type, field } of urlsToFetch) {
      const { error, html, markdown } = await fetchAndConvert(url, nhm);

      if (error) {
        results.push({ url, document_type, status: "failed", error });
        continue;
      }

      const contentHash = crypto
        .createHash("sha256")
        .update(markdown || html || "")
        .digest("hex");

      const { rows: existing } = await pool.query(
        `SELECT id FROM prospect_documents
         WHERE prospect_id = $1 AND file_hash = $2`,
        [prospectId, contentHash]
      );

      if (existing.length > 0) {
        results.push({
          url, document_type, status: "skipped_duplicate",
          existing_id: existing[0].id,
        });
        continue;
      }

      const urlObj = new URL(url);
      const docTitle = `${urlObj.hostname} — ${document_type.replace(/_/g, " ")}`;

      const { rows: inserted } = await pool.query(
        `INSERT INTO prospect_documents
           (prospect_id, document_type, document_title, source_url,
            snapshot_date, html_snapshot, markdown_content,
            conversion_status, file_hash, metadata)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, 'converted', $7,
                 $8::jsonb)
         RETURNING id, document_type, document_title`,
        [
          prospectId, document_type, docTitle, url,
          html, markdown, contentHash,
          JSON.stringify({ source_field: field, ingested_by: "agent" }),
        ]
      );

      results.push({
        url, document_type, status: "stored",
        document_id: inserted[0].id,
        title: inserted[0].document_title,
        markdown_length: (markdown || "").length,
      });
    }

    const storedCount = results.filter((r) => r.status === "stored").length;
    const dupCount = results.filter((r) => r.status === "skipped_duplicate").length;
    const newStatus = (storedCount > 0 || dupCount > 0) ? "collected" : "not_started";

    await pool.query(
      `UPDATE compliance_prospects
       SET document_count = (
         SELECT count(*) FROM prospect_documents WHERE prospect_id = $1
       ),
       research_status = $2,
       last_research_date = NOW(),
       updated_at = NOW()
       WHERE id = $1`,
      [prospectId, newStatus]
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    res.json({
      prospect_id: prospectId,
      documents_processed: results.length,
      documents_stored: storedCount,
      documents_skipped: results.filter((r) => r.status === "skipped_duplicate").length,
      documents_failed: results.filter((r) => r.status === "failed").length,
      research_status: newStatus,
      elapsed_seconds: parseFloat(elapsed),
      results,
    });
  } catch (err) {
    console.error("POST /prospects/:id/ingest error:", err);
    await pool
      .query(
        `UPDATE compliance_prospects
       SET research_status = 'not_started', updated_at = NOW()
       WHERE id = $1`,
        [prospectId]
      )
      .catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ─── POPIA Compliance Analysis (rule-based) ────────────────────────────────

app.post("/api/compliance/prospects/:id/analyse", async (req, res) => {
  const prospectId = req.params.id;
  const startTime = Date.now();

  try {
    const { rows: prospectRows } = await pool.query(
      "SELECT * FROM compliance_prospects WHERE id = $1",
      [prospectId]
    );
    if (prospectRows.length === 0) {
      return res.status(404).json({ error: "Prospect not found" });
    }
    const prospect = prospectRows[0];

    const { rows: documents } = await pool.query(
      `SELECT id, document_type, document_title, source_url,
              markdown_content, conversion_status
       FROM prospect_documents
       WHERE prospect_id = $1 AND markdown_content IS NOT NULL
       ORDER BY document_type`,
      [prospectId]
    );

    if (documents.length === 0) {
      return res.status(400).json({
        error: "No documents available for analysis. Run /ingest first.",
        research_status: prospect.research_status,
      });
    }

    await pool.query(
      `UPDATE compliance_prospects
       SET research_status = 'analysing', updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    // Clear remediation items that reference findings (FK constraint) before clearing findings
    await pool.query(
      `DELETE FROM remediation_items WHERE prospect_id = $1`,
      [prospectId]
    );

    // Clear previous findings before re-analysis — prevents accumulation across re-runs
    await pool.query(
      `DELETE FROM prospect_analysis WHERE prospect_id = $1`,
      [prospectId]
    );

    // Rule-based analysis — no external API call
    const findings = analyseDocumentsRuleBased(documents, prospect);

    const storedFindings = [];
    for (const f of findings) {
      const { rows: inserted } = await pool.query(
        `INSERT INTO prospect_analysis
           (prospect_id, document_id, analysis_date, jurisdiction,
            check_category, finding, severity,
            evidence_quote, evidence_location, recommendation,
            agent_model, agent_version, human_reviewed)
         VALUES ($1, $2, CURRENT_DATE, 'South Africa',
                 $3, $4, $5, $6, $7, $8, $9, $10, false)
         RETURNING id, check_category, severity`,
        [
          prospectId,
          null,
          f.check_category || "uncategorised",
          f.finding || "No description",
          f.severity || "info",
          f.evidence_quote || null,
          f.evidence_location || null,
          f.recommendation || null,
          "rule-engine",
          ANALYSIS_ENGINE_VERSION,
        ]
      );
      storedFindings.push(inserted[0]);
    }

    await pool.query(
      `UPDATE compliance_prospects
       SET finding_count = (
         SELECT count(*) FROM prospect_analysis WHERE prospect_id = $1
       ),
       critical_finding_count = (
         SELECT count(*) FROM prospect_analysis
         WHERE prospect_id = $1 AND severity IN ('critical', 'high')
       ),
       research_status = 'analysed',
       last_research_date = NOW(),
       updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const severityCounts = {};
    storedFindings.forEach((f) => {
      severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
    });

    res.json({
      prospect_id: prospectId,
      company_name: prospect.company_name,
      documents_analysed: documents.length,
      findings_count: storedFindings.length,
      severity_breakdown: severityCounts,
      research_status: "analysed",
      analysis_engine: "rule-based",
      engine_version: ANALYSIS_ENGINE_VERSION,
      elapsed_seconds: parseFloat(elapsed),
    });
  } catch (err) {
    console.error("POST /prospects/:id/analyse error:", err);
    await pool
      .query(
        `UPDATE compliance_prospects
       SET research_status = 'collected', updated_at = NOW()
       WHERE id = $1`,
        [prospectId]
      )
      .catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ─── Assessment Generation (rule-based) ────────────────────────────────────

app.post("/api/compliance/prospects/:id/assess", async (req, res) => {
  const prospectId = req.params.id;
  const startTime = Date.now();

  try {
    const { rows: prospectRows } = await pool.query(
      "SELECT * FROM compliance_prospects WHERE id = $1",
      [prospectId]
    );
    if (prospectRows.length === 0) {
      return res.status(404).json({ error: "Prospect not found" });
    }
    const prospect = prospectRows[0];

    const { rows: findings } = await pool.query(
      `SELECT id, check_category, finding, severity,
              evidence_quote, evidence_location, recommendation
       FROM prospect_analysis
       WHERE prospect_id = $1
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           WHEN 'info' THEN 5
           WHEN 'compliant' THEN 6
         END`,
      [prospectId]
    );

    if (findings.length === 0) {
      return res.status(400).json({
        error: "No analysis findings available. Run /analyse first.",
        research_status: prospect.research_status,
      });
    }

    // Rule-based assessment — no external API call
    const assessment = generateAssessmentFromFindings(findings, prospect);

    // Supersede existing assessments
    await pool.query(
      `UPDATE prospect_assessments
       SET status = 'superseded', updated_at = NOW()
       WHERE prospect_id = $1 AND status != 'superseded'`,
      [prospectId]
    );

    const { rows: versionRows } = await pool.query(
      `SELECT COALESCE(MAX(assessment_version), 0) + 1 AS next_version
       FROM prospect_assessments WHERE prospect_id = $1`,
      [prospectId]
    );
    const nextVersion = versionRows[0].next_version;

    const { rows: inserted } = await pool.query(
      `INSERT INTO prospect_assessments
         (prospect_id, assessment_date, assessment_version, status,
          score_ir_registration, score_biometric_handling, score_cross_border,
          score_consent_mechanism, score_breach_notification,
          score_data_subject_rights, score_overall,
          overall_severity, executive_summary,
          risk_factors, key_findings, recommendations,
          generated_by, agent_model, agent_version, human_reviewed)
       VALUES ($1, CURRENT_DATE, $2, 'draft',
               $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12::jsonb, $13::jsonb, $14::jsonb,
               'rule-engine', $15, $16, false)
       RETURNING *`,
      [
        prospectId,
        nextVersion,
        assessment.score_ir_registration,
        assessment.score_biometric_handling,
        assessment.score_cross_border,
        assessment.score_consent_mechanism,
        assessment.score_breach_notification,
        assessment.score_data_subject_rights,
        assessment.score_overall,
        assessment.overall_severity,
        assessment.executive_summary,
        JSON.stringify(assessment.risk_factors || []),
        JSON.stringify(assessment.key_findings || []),
        JSON.stringify(assessment.recommendations || []),
        "rule-engine",
        ANALYSIS_ENGINE_VERSION,
      ]
    );

    await pool.query(
      `UPDATE compliance_prospects
       SET research_status = 'assessed',
           last_research_date = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    res.json({
      prospect_id: prospectId,
      company_name: prospect.company_name,
      assessment_id: inserted[0].id,
      assessment_version: nextVersion,
      score_overall: assessment.score_overall,
      overall_severity: assessment.overall_severity,
      domain_scores: {
        ir_registration: assessment.score_ir_registration,
        biometric_handling: assessment.score_biometric_handling,
        cross_border: assessment.score_cross_border,
        consent_mechanism: assessment.score_consent_mechanism,
        breach_notification: assessment.score_breach_notification,
        data_subject_rights: assessment.score_data_subject_rights,
      },
      findings_assessed: findings.length,
      risk_factors_count: (assessment.risk_factors || []).length,
      recommendations_count: (assessment.recommendations || []).length,
      research_status: "assessed",
      analysis_engine: "rule-based",
      engine_version: ANALYSIS_ENGINE_VERSION,
      elapsed_seconds: parseFloat(elapsed),
    });
  } catch (err) {
    console.error("POST /prospects/:id/assess error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Full Pipeline (convenience endpoint) ───────────────────────────────────

/**
 * POST /api/compliance/prospects/:id/run-pipeline
 *
 * Runs ingest → analyse → assess in sequence. Returns combined results.
 * Use { "skip_ingest": true } in body to skip document collection.
 */
app.post("/api/compliance/prospects/:id/run-pipeline", async (req, res) => {
  const prospectId = req.params.id;
  const { skip_ingest } = req.body || {};
  const startTime = Date.now();

  try {
    const results = { prospect_id: prospectId, stages: {} };

    const baseUrl = `http://localhost:${process.env.PORT || 8080}`;
    const apiKey = process.env.API_KEY;
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    };

    // Stage 1: Ingest
    if (!skip_ingest) {
      const ingestRes = await fetch(
        `${baseUrl}/api/compliance/prospects/${prospectId}/ingest`,
        { method: "POST", headers }
      );
      const ingestData = await ingestRes.json();
      results.stages.ingest = { status: ingestRes.status, ...ingestData };
      if (ingestRes.status >= 400) {
        results.pipeline_status = "failed_at_ingest";
        return res.status(ingestRes.status).json(results);
      }
    } else {
      results.stages.ingest = { status: "skipped" };
    }

    // Stage 2: Analyse
    const analyseRes = await fetch(
      `${baseUrl}/api/compliance/prospects/${prospectId}/analyse`,
      { method: "POST", headers }
    );
    const analyseData = await analyseRes.json();
    results.stages.analyse = { status: analyseRes.status, ...analyseData };
    if (analyseRes.status >= 400) {
      results.pipeline_status = "failed_at_analyse";
      return res.status(analyseRes.status).json(results);
    }

    // Stage 3: Assess
    const assessRes = await fetch(
      `${baseUrl}/api/compliance/prospects/${prospectId}/assess`,
      { method: "POST", headers }
    );
    const assessData = await assessRes.json();
    results.stages.assess = { status: assessRes.status, ...assessData };
    if (assessRes.status >= 400) {
      results.pipeline_status = "failed_at_assess";
      return res.status(assessRes.status).json(results);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    results.pipeline_status = "complete";
    results.elapsed_seconds = parseFloat(elapsed);

    res.json(results);
  } catch (err) {
    console.error("POST /prospects/:id/run-pipeline error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Compliance Analysis V2 Routes — DB-driven, jurisdiction-agnostic engine.
 *
 * Replaces the hardcoded POPIA_RULES array in server-agent-routes.js with
 * a database-driven engine that reads requirements, keywords, and finding
 * templates from the compliance knowledge base tables (migration 013).
 *
 * Adding a new jurisdiction means inserting database rows, not writing code.
 *
 * Routes:
 *   GET  /api/compliance/jurisdictions
 *   GET  /api/compliance/jurisdictions/:id
 *   GET  /api/compliance/jurisdictions/:id/requirements
 *   POST /api/compliance/clients/:clientId/documents/ingest
 *   POST /api/compliance/clients/:clientId/analyse
 *   POST /api/compliance/clients/:clientId/assess
 *
 * Prerequisites:
 *   Migration 013-compliance-analysis-foundation.sql applied
 *   Global: app, pool, nhm (set by deploy/server.js)
 */

const crypto = require("crypto");

const ENGINE_VERSION = "3.0.0";

// Severity → numeric score (same scale as v2 engine, industry standard)
const SEVERITY_SCORES = {
  compliant: 9,
  info: 8,
  low: 7,
  medium: 4,
  high: 2,
  critical: 0,
};

const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  compliant: 5,
};

// ─── Helpers (shared with server-agent-routes.js) ─────────────────────────

function cleanMarkdown(raw) {
  if (!raw) return "";
  let text = raw;
  text = text.replace(/^(\s*\*\s+\[.*?\]\(.*?\)\s*\n){5,}/gm, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/(\s*\*\s*){3,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\s{3,}/g, " ");
  return text.trim();
}

async function fetchAndConvertV2(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AfricanSTN-Compliance-Agent/2.0)",
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

// ─── Knowledge Base Loader ────────────────────────────────────────────────
//
// Loads the full knowledge base for a jurisdiction in parallel queries.
// Returns { jurisdiction, domains, requirements, keywords } where keywords
// are grouped by requirement_id for efficient lookup.

async function loadKnowledgeBase(jurisdictionId) {
  const [jRes, dRes, rRes, kRes] = await Promise.all([
    pool.query(
      "SELECT * FROM compliance_jurisdictions WHERE id = $1 AND is_active = true",
      [jurisdictionId]
    ),
    pool.query(
      `SELECT * FROM compliance_domains
       WHERE jurisdiction_id = $1 ORDER BY display_order`,
      [jurisdictionId]
    ),
    pool.query(
      `SELECT * FROM compliance_requirements
       WHERE jurisdiction_id = $1 ORDER BY display_order`,
      [jurisdictionId]
    ),
    pool.query(
      `SELECT ek.* FROM evidence_keywords ek
       JOIN compliance_requirements cr ON ek.requirement_id = cr.id
       WHERE cr.jurisdiction_id = $1
       ORDER BY ek.requirement_id, ek.keyword_class`,
      [jurisdictionId]
    ),
  ]);

  if (jRes.rows.length === 0) return null;

  // Group keywords by requirement_id for O(1) lookup
  const keywordsByRequirement = {};
  for (const kw of kRes.rows) {
    if (!keywordsByRequirement[kw.requirement_id]) {
      keywordsByRequirement[kw.requirement_id] = [];
    }
    keywordsByRequirement[kw.requirement_id].push(kw);
  }

  return {
    jurisdiction: jRes.rows[0],
    domains: dRes.rows,
    requirements: rRes.rows,
    keywordsByRequirement,
    keywordCount: kRes.rows.length,
  };
}

// ─── Evidence Extraction (Layer 3) ────────────────────────────────────────
//
// For each requirement, searches documents for keyword matches and creates
// compliance_evidence records. Returns summary statistics.
//
// Evidence is append-only — calling this again adds new evidence without
// deleting prior records (immutable audit trail per architecture spec).

async function extractEvidence(clientId, jurisdictionId, documentIds) {
  const kb = await loadKnowledgeBase(jurisdictionId);
  if (!kb) throw new Error(`Jurisdiction ${jurisdictionId} not found or inactive`);

  // Load documents
  const { rows: documents } = await pool.query(
    `SELECT id, title, document_type, raw_content, processed_content
     FROM compliance_documents
     WHERE id = ANY($1) AND client_id = $2`,
    [documentIds, clientId]
  );

  if (documents.length === 0) {
    throw new Error("No matching documents found for this client");
  }

  // Batch delete prior keyword evidence for these documents + jurisdiction
  // (re-extraction replaces keyword evidence; manual/external evidence is preserved)
  await pool.query(
    `DELETE FROM compliance_evidence
     WHERE client_id = $1
       AND document_id = ANY($2)
       AND extraction_method = 'keyword'
       AND requirement_id IN (
         SELECT id FROM compliance_requirements WHERE jurisdiction_id = $3
       )`,
    [clientId, documentIds, jurisdictionId]
  );

  const evidenceRecords = [];
  const errors = [];

  for (const req of kb.requirements) {
    const keywords = kb.keywordsByRequirement[req.id] || [];
    if (keywords.length === 0) continue;

    for (const doc of documents) {
      const content = cleanMarkdown(doc.processed_content || doc.raw_content || "");
      if (!content) continue;

      for (const kw of keywords) {
        let regex;
        try {
          regex = new RegExp(kw.pattern, kw.pattern_flags || "i");
        } catch (e) {
          errors.push({
            keyword_id: kw.id,
            pattern: kw.pattern,
            error: e.message,
          });
          continue;
        }

        const match = content.match(regex);
        if (!match) continue;

        // Extract context window around match
        const idx = match.index;
        const start = Math.max(0, idx - 100);
        const end = Math.min(content.length, idx + match[0].length + 100);
        const context = content
          .slice(start, end)
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // Determine confidence from keyword class and document type relevance
        let confidence = "low";
        if (kw.keyword_class === "jurisdiction_specific") {
          confidence = "medium";
        }
        // Boost confidence if document type matches expected evidence types
        if (
          req.evidence_types &&
          req.evidence_types.length > 0 &&
          req.evidence_types.includes(doc.document_type)
        ) {
          confidence =
            confidence === "medium" ? "high" : "medium";
        }

        try {
          const { rows: inserted } = await pool.query(
            `INSERT INTO compliance_evidence
               (client_id, requirement_id, document_id,
                extraction_method, matched_text, context_text,
                keyword_id, confidence,
                confidence_factors)
             VALUES ($1, $2, $3, 'keyword', $4, $5, $6, $7, $8::jsonb)
             RETURNING id`,
            [
              clientId,
              req.id,
              doc.id,
              match[0],
              context,
              kw.id,
              confidence,
              JSON.stringify({
                keyword_class: kw.keyword_class,
                keyword_weight: parseFloat(kw.weight) || 1.0,
                document_type: doc.document_type,
                document_type_relevant:
                  req.evidence_types.includes(doc.document_type),
              }),
            ]
          );

          evidenceRecords.push({
            id: inserted[0].id,
            requirement_id: req.id,
            requirement_code: req.code,
            document_id: doc.id,
            keyword_class: kw.keyword_class,
            matched_text: match[0],
            confidence,
          });
        } catch (dbErr) {
          errors.push({
            requirement_id: req.id,
            document_id: doc.id,
            error: dbErr.message,
          });
        }
      }
    }
  }

  return {
    jurisdiction: kb.jurisdiction.short_name,
    jurisdiction_id: jurisdictionId,
    documents_analysed: documents.length,
    requirements_checked: kb.requirements.length,
    evidence_extracted: evidenceRecords.length,
    errors: errors.length > 0 ? errors : undefined,
    evidence: evidenceRecords,
  };
}

// ─── Assessment Engine (Layer 4) ──────────────────────────────────────────
//
// Evaluates evidence against requirements, produces assessment_findings,
// calculates domain scores and overall score using configurable weights.
//
// Score algorithm (from architecture spec section 7.4):
//   domain_score = weighted average of requirement scores in domain
//   overall_score = (min_weight * min_domain) + (avg_weight * weighted_avg_domain)
//   mandatory_domain cap: if mandatory domain < 50, cap overall to that score

async function buildAssessment(clientId, jurisdictionId, options = {}) {
  const kb = await loadKnowledgeBase(jurisdictionId);
  if (!kb) throw new Error(`Jurisdiction ${jurisdictionId} not found or inactive`);

  const { engagementId = null, assessmentType = "full" } = options;

  // Load all evidence for this client + jurisdiction
  const { rows: allEvidence } = await pool.query(
    `SELECT ce.*, ek.keyword_class
     FROM compliance_evidence ce
     LEFT JOIN evidence_keywords ek ON ce.keyword_id = ek.id
     WHERE ce.client_id = $1
       AND ce.requirement_id IN (
         SELECT id FROM compliance_requirements WHERE jurisdiction_id = $2
       )
     ORDER BY ce.requirement_id`,
    [clientId, jurisdictionId]
  );

  // Load client for context-aware overrides
  const { rows: clientRows } = await pool.query(
    "SELECT * FROM compliance_clients WHERE id = $1",
    [clientId]
  );
  if (clientRows.length === 0) throw new Error("Client not found");
  const client = clientRows[0];

  // Supersede existing in-progress/completed assessments for same jurisdiction
  await pool.query(
    `UPDATE compliance_assessments
     SET status = 'superseded',
         updated_at = NOW(),
         retention_expires_at = NOW() + INTERVAL '5 years'
     WHERE client_id = $1
       AND jurisdiction_id = $2
       AND status IN ('in_progress', 'completed')`,
    [clientId, jurisdictionId]
  );

  // Create new assessment record
  const { rows: [assessment] } = await pool.query(
    `INSERT INTO compliance_assessments
       (client_id, jurisdiction_id, engagement_id, assessment_type,
        engine_version, status, retention_expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_progress', NOW() + INTERVAL '5 years')
     RETURNING id`,
    [clientId, jurisdictionId, engagementId, assessmentType, ENGINE_VERSION]
  );
  const assessmentId = assessment.id;

  // Group evidence by requirement
  const evidenceByRequirement = {};
  for (const ev of allEvidence) {
    if (!evidenceByRequirement[ev.requirement_id]) {
      evidenceByRequirement[ev.requirement_id] = [];
    }
    evidenceByRequirement[ev.requirement_id].push(ev);
  }

  // Build domain-level tracking
  const domainFindings = {}; // domain_id → { scores: [], weight }
  const allFindings = [];

  for (const req of kb.requirements) {
    const domain = kb.domains.find((d) => d.id === req.domain_id);
    const reqEvidence = evidenceByRequirement[req.id] || [];

    // Count by keyword class
    const generalCount = reqEvidence.filter(
      (e) => e.keyword_class === "general" || !e.keyword_class
    ).length;
    const specificCount = reqEvidence.filter(
      (e) => e.keyword_class === "jurisdiction_specific"
    ).length;
    const externalCount = reqEvidence.filter(
      (e) =>
        e.extraction_method === "external_verification" ||
        e.extraction_method === "manual_attestation"
    ).length;

    // Determine finding status
    let status;
    if (externalCount > 0) {
      // External verification or manual attestation overrides keyword analysis
      status = "present";
    } else if (reqEvidence.length === 0) {
      status = "absent";
    } else if (
      reqEvidence.length < req.min_evidence_for_present &&
      specificCount === 0
    ) {
      status = "partial";
    } else if (specificCount > 0 || reqEvidence.length >= req.min_evidence_for_present) {
      status = "present";
    } else {
      status = "partial";
    }

    // Get finding template
    const severity = req[`${status}_severity`];
    const findingText = req[`${status}_finding`];
    const recommendation = req[`${status}_recommendation`];
    const score = SEVERITY_SCORES[severity] ?? 5;

    // Determine confidence
    let confidence = "low";
    if (externalCount > 0) {
      confidence = "high";
    } else if (specificCount > 0 && generalCount > 0) {
      confidence = "medium";
    } else if (reqEvidence.length >= req.min_evidence_for_present) {
      confidence = "medium";
    }

    // Evidence chain — IDs of evidence records supporting this finding
    const evidenceIds = reqEvidence.map((e) => e.id);

    // Insert assessment finding
    const { rows: [finding] } = await pool.query(
      `INSERT INTO assessment_findings
         (assessment_id, requirement_id, domain_id,
          status, severity, finding_text, recommendation,
          evidence_ids, evidence_count, confidence,
          confidence_factors, score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       RETURNING id`,
      [
        assessmentId,
        req.id,
        domain.id,
        status,
        severity,
        findingText,
        recommendation,
        evidenceIds,
        reqEvidence.length,
        confidence,
        JSON.stringify({
          general_matches: generalCount,
          specific_matches: specificCount,
          external_verifications: externalCount,
          total_evidence: reqEvidence.length,
          min_for_present: req.min_evidence_for_present,
          min_for_partial: req.min_evidence_for_partial,
        }),
        score,
      ]
    );

    allFindings.push({
      id: finding.id,
      requirement_code: req.code,
      requirement_name: req.name,
      domain_code: domain.code,
      domain_name: domain.name,
      status,
      severity,
      finding_text: findingText,
      recommendation,
      evidence_count: reqEvidence.length,
      confidence,
      score,
    });

    // Accumulate domain scores
    if (!domainFindings[domain.id]) {
      domainFindings[domain.id] = {
        code: domain.code,
        name: domain.name,
        weight: parseFloat(domain.weight) || 1.0,
        scores: [],
      };
    }
    domainFindings[domain.id].scores.push(score);
  }

  // ─── Score Calculation ────────────────────────────────────────────────────

  const scoringConfig = kb.jurisdiction.scoring_config || {
    min_weight: 0.3,
    avg_weight: 0.7,
    mandatory_domains: [],
  };

  const minWeight = scoringConfig.min_weight || 0.3;
  const avgWeight = scoringConfig.avg_weight || 0.7;
  const mandatoryDomains = scoringConfig.mandatory_domains || [];
  const mandatoryThreshold = scoringConfig.mandatory_threshold || 50;

  // Calculate per-domain scores (average of requirement scores, scaled to 0-100)
  const domainScoreMap = {};
  const domainScoreValues = [];

  for (const [domainId, data] of Object.entries(domainFindings)) {
    const avg =
      data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
    // Scale from 0-9 to 0-100
    const scaled = Math.round((avg / 9) * 100);
    domainScoreMap[data.code] = {
      score: scaled,
      weight: data.weight,
      name: data.name,
      requirement_count: data.scores.length,
    };
    domainScoreValues.push({ score: scaled, weight: data.weight, code: data.code });
  }

  // Weighted average of domain scores
  const totalWeight = domainScoreValues.reduce((s, d) => s + d.weight, 0);
  const weightedAvg =
    totalWeight > 0
      ? domainScoreValues.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight
      : 0;

  const minDomainScore = domainScoreValues.length > 0
    ? Math.min(...domainScoreValues.map((d) => d.score))
    : 0;

  // Overall: weakest-link biased
  let overallScore = Math.round(
    minWeight * minDomainScore + avgWeight * weightedAvg
  );

  // Mandatory domain cap
  for (const mandCode of mandatoryDomains) {
    const mandDomain = domainScoreMap[mandCode];
    if (mandDomain && mandDomain.score < mandatoryThreshold) {
      overallScore = Math.min(overallScore, mandDomain.score);
    }
  }

  // Also produce a 0-10 score for backward compatibility with prospect_assessments
  const overallScore10 = Math.round(overallScore / 10);

  // Overall severity label
  let overallSeverity;
  if (overallScore <= 20) overallSeverity = "critical";
  else if (overallScore <= 40) overallSeverity = "high";
  else if (overallScore <= 60) overallSeverity = "medium";
  else overallSeverity = "low";

  // ─── Executive Summary ──────────────────────────────────────────────────

  const companyName = client.company_name;
  const country = client.company_country || "an undisclosed jurisdiction";
  const jName = kb.jurisdiction.short_name;

  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const highCount = allFindings.filter((f) => f.severity === "high").length;
  const mediumCount = allFindings.filter((f) => f.severity === "medium").length;
  const lowCount = allFindings.filter((f) => f.severity === "low").length;
  const compliantCount = allFindings.filter((f) => f.severity === "compliant").length;

  let summary = "";
  summary += `${companyName}, domiciled in ${country}, has been assessed against ${kb.jurisdiction.name} (${jName}). `;
  summary += `The assessment identified ${allFindings.length} findings across ${Object.keys(domainFindings).length} compliance domains: `;
  summary += `${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low severity, and ${compliantCount} compliant. `;
  summary += `The overall compliance score is ${overallScore}/100, rated as ${overallSeverity} risk.\n\n`;

  if (criticalCount > 0) {
    const criticalDomains = allFindings
      .filter((f) => f.severity === "critical")
      .map((f) => f.domain_name);
    const uniqueDomains = [...new Set(criticalDomains)];
    summary += `Critical areas of concern include: ${uniqueDomains.join(", ")}. `;
    summary += `These represent direct non-compliance that could result in enforcement action by the ${kb.jurisdiction.regulator_name || "relevant regulator"}.\n\n`;
  }

  // Top priorities
  const nonCompliant = allFindings
    .filter((f) => f.severity !== "compliant" && f.severity !== "low")
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5));
  if (nonCompliant.length > 0) {
    const topPriorities = nonCompliant
      .slice(0, 3)
      .map((f) => f.requirement_name);
    summary += `Immediate remediation is recommended, prioritising ${topPriorities.join(", ")}.`;
  } else {
    summary += `The company demonstrates a strong compliance posture. Ongoing monitoring and periodic review are recommended.`;
  }

  // ─── Risk Factors ───────────────────────────────────────────────────────

  const riskFactors = [];
  if (criticalCount > 0) {
    riskFactors.push({
      level: "critical",
      factor: "Critical compliance gaps",
      note: `${criticalCount} critical finding(s) representing direct non-compliance`,
    });
  }
  if (highCount > 0) {
    riskFactors.push({
      level: "high",
      factor: "Significant compliance gaps",
      note: `${highCount} high-severity finding(s) materially increase regulatory risk`,
    });
  }

  // ─── Recommendations ───────────────────────────────────────────────────

  const recommendations = nonCompliant
    .slice(0, 6)
    .map((f, i) => ({
      priority: i + 1,
      action: f.recommendation,
      rationale: `Addresses ${f.severity}-severity finding in ${f.domain_name}`,
    }));

  // ─── Key Findings (top 8 by severity) ─────────────────────────────────

  const keyFindings = [...allFindings]
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5)
    )
    .slice(0, 8)
    .map((f) => ({
      finding_id: f.id,
      domain: f.domain_name,
      requirement: f.requirement_name,
      severity: f.severity,
      finding: f.finding_text,
      evidence_count: f.evidence_count,
      confidence: f.confidence,
    }));

  // ─── Update Assessment Record ─────────────────────────────────────────

  const workingPapers = {
    engine_version: ENGINE_VERSION,
    jurisdiction_code: kb.jurisdiction.code,
    scoring_config: scoringConfig,
    evidence_summary: {
      total_evidence: allEvidence.length,
      keyword_evidence: allEvidence.filter((e) => e.extraction_method === "keyword").length,
      manual_evidence: allEvidence.filter((e) => e.extraction_method === "manual_attestation").length,
      external_evidence: allEvidence.filter((e) => e.extraction_method === "external_verification").length,
    },
    severity_counts: { critical: criticalCount, high: highCount, medium: mediumCount, low: lowCount, compliant: compliantCount },
    executive_summary: summary,
    risk_factors: riskFactors,
    key_findings: keyFindings,
    recommendations,
  };

  await pool.query(
    `UPDATE compliance_assessments
     SET overall_score = $1,
         domain_scores = $2::jsonb,
         confidence_level = $3,
         status = 'completed',
         completed_at = NOW(),
         working_papers = $4::jsonb,
         updated_at = NOW()
     WHERE id = $5`,
    [
      overallScore,
      JSON.stringify(domainScoreMap),
      allFindings.every((f) => f.confidence === "high")
        ? "high"
        : allFindings.some((f) => f.confidence === "low")
          ? "low"
          : "medium",
      JSON.stringify(workingPapers),
      assessmentId,
    ]
  );

  // Link documents to assessment via assessment_document_scope
  const documentIds = [
    ...new Set(allEvidence.map((e) => e.document_id).filter(Boolean)),
  ];
  for (const docId of documentIds) {
    await pool.query(
      `INSERT INTO assessment_document_scope (assessment_id, document_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [assessmentId, docId]
    ).catch(() => {}); // Ignore if document was deleted
  }

  return {
    assessment_id: assessmentId,
    jurisdiction: kb.jurisdiction.short_name,
    jurisdiction_id: jurisdictionId,
    overall_score: overallScore,
    overall_score_10: overallScore10,
    overall_severity: overallSeverity,
    domain_scores: domainScoreMap,
    findings_count: allFindings.length,
    severity_counts: { critical: criticalCount, high: highCount, medium: mediumCount, low: lowCount, compliant: compliantCount },
    risk_factors: riskFactors,
    key_findings: keyFindings,
    recommendations,
    executive_summary: summary,
    engine_version: ENGINE_VERSION,
    findings: allFindings,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════


// ─── Jurisdiction Listing ─────────────────────────────────────────────────

app.get("/api/compliance/jurisdictions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, short_name, country_iso,
              enacted_date, effective_date, regulator_name, regulator_url,
              version, is_active, scoring_config,
              (SELECT count(*) FROM compliance_domains WHERE jurisdiction_id = cj.id) AS domain_count,
              (SELECT count(*) FROM compliance_requirements WHERE jurisdiction_id = cj.id) AS requirement_count
       FROM compliance_jurisdictions cj
       WHERE is_active = true
       ORDER BY name`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /jurisdictions error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/compliance/jurisdictions/:id", async (req, res) => {
  try {
    const kb = await loadKnowledgeBase(parseInt(req.params.id, 10));
    if (!kb) {
      return res.status(404).json({ error: "Jurisdiction not found or inactive" });
    }
    res.json({
      jurisdiction: kb.jurisdiction,
      domains: kb.domains,
      requirement_count: kb.requirements.length,
      keyword_count: kb.keywordCount,
    });
  } catch (err) {
    console.error("GET /jurisdictions/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/compliance/jurisdictions/:id/requirements", async (req, res) => {
  try {
    const jurisdictionId = parseInt(req.params.id, 10);
    const kb = await loadKnowledgeBase(jurisdictionId);
    if (!kb) {
      return res.status(404).json({ error: "Jurisdiction not found or inactive" });
    }

    // Enrich requirements with their keywords and domain info
    const enriched = kb.requirements.map((req) => {
      const domain = kb.domains.find((d) => d.id === req.domain_id);
      const keywords = kb.keywordsByRequirement[req.id] || [];
      return {
        ...req,
        domain_code: domain?.code,
        domain_name: domain?.name,
        keyword_count: keywords.length,
        keywords: keywords.map((k) => ({
          id: k.id,
          pattern: k.pattern,
          keyword_class: k.keyword_class,
          weight: k.weight,
        })),
      };
    });

    res.json({
      jurisdiction: kb.jurisdiction.short_name,
      count: enriched.length,
      data: enriched,
    });
  } catch (err) {
    console.error("GET /jurisdictions/:id/requirements error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Document Ingestion ───────────────────────────────────────────────────
//
// Accepts URLs in the request body and stores fetched content in
// compliance_documents. Also accepts direct content upload.

app.post("/api/compliance/clients/:clientId/documents/ingest", async (req, res) => {
  const clientId = req.params.clientId;
  const startTime = Date.now();

  try {
    // Verify client exists
    const { rows: clientRows } = await pool.query(
      "SELECT id, company_name FROM compliance_clients WHERE id = $1",
      [clientId]
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const { urls, documents: directDocs } = req.body;

    if ((!urls || urls.length === 0) && (!directDocs || directDocs.length === 0)) {
      return res.status(400).json({
        error: "Provide 'urls' (array of {url, document_type, title}) or 'documents' (array of {content, document_type, title})",
      });
    }

    const results = [];

    // Process URL-based documents
    if (urls && urls.length > 0) {
      for (const item of urls) {
        const { url, document_type = "other", title } = item;
        if (!url) continue;

        const { error, html, markdown } = await fetchAndConvertV2(url);

        if (error) {
          results.push({ url, document_type, status: "failed", error });
          continue;
        }

        const content = markdown || html || "";
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");

        // Check for duplicate
        const { rows: existing } = await pool.query(
          `SELECT id FROM compliance_documents
           WHERE client_id = $1 AND content_hash = $2`,
          [clientId, contentHash]
        );

        if (existing.length > 0) {
          results.push({
            url,
            document_type,
            status: "skipped_duplicate",
            existing_id: existing[0].id,
          });
          continue;
        }

        const docTitle =
          title || `${new URL(url).hostname} — ${document_type.replace(/_/g, " ")}`;
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        const { rows: inserted } = await pool.query(
          `INSERT INTO compliance_documents
             (client_id, document_type, title, source_url,
              raw_content, processed_content, content_hash,
              word_count, status, processed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processed', NOW())
           RETURNING id, document_type, title`,
          [
            clientId,
            document_type,
            docTitle,
            url,
            html || content,
            markdown || content,
            contentHash,
            wordCount,
          ]
        );

        results.push({
          url,
          document_type,
          status: "stored",
          document_id: inserted[0].id,
          title: inserted[0].title,
          word_count: wordCount,
        });
      }
    }

    // Process directly-provided documents
    if (directDocs && directDocs.length > 0) {
      for (const item of directDocs) {
        const { content, document_type = "other", title = "Uploaded document" } = item;
        if (!content) continue;

        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");

        const { rows: existing } = await pool.query(
          `SELECT id FROM compliance_documents
           WHERE client_id = $1 AND content_hash = $2`,
          [clientId, contentHash]
        );

        if (existing.length > 0) {
          results.push({
            title,
            document_type,
            status: "skipped_duplicate",
            existing_id: existing[0].id,
          });
          continue;
        }

        const wordCount = content.split(/\s+/).filter(Boolean).length;

        const { rows: inserted } = await pool.query(
          `INSERT INTO compliance_documents
             (client_id, document_type, title,
              raw_content, processed_content, content_hash,
              word_count, status, processed_at)
           VALUES ($1, $2, $3, $4, $4, $5, $6, 'processed', NOW())
           RETURNING id, document_type, title`,
          [clientId, document_type, title, content, contentHash, wordCount]
        );

        results.push({
          title,
          document_type,
          status: "stored",
          document_id: inserted[0].id,
          word_count: wordCount,
        });
      }
    }

    const storedCount = results.filter((r) => r.status === "stored").length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      client_id: clientId,
      company_name: clientRows[0].company_name,
      documents_processed: results.length,
      documents_stored: storedCount,
      documents_skipped: results.filter((r) => r.status === "skipped_duplicate").length,
      documents_failed: results.filter((r) => r.status === "failed").length,
      elapsed_seconds: parseFloat(elapsed),
      results,
    });
  } catch (err) {
    console.error("POST /clients/:clientId/documents/ingest error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── List Client Documents ────────────────────────────────────────────────

app.get("/api/compliance/clients/:clientId/documents", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, document_type, title, source_url, word_count,
              status, version, created_at, updated_at
       FROM compliance_documents
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [req.params.clientId]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:clientId/documents error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Evidence Extraction ──────────────────────────────────────────────────
//
// POST /api/compliance/clients/:clientId/analyse
// Body: { jurisdiction_id, document_ids? }
//
// If document_ids is omitted, analyses all documents for the client.

app.post("/api/compliance/clients/:clientId/analyse", async (req, res) => {
  const clientId = req.params.clientId;
  const startTime = Date.now();

  try {
    const { jurisdiction_id } = req.body;
    if (!jurisdiction_id) {
      return res.status(400).json({ error: "jurisdiction_id is required" });
    }

    // Get document IDs
    let documentIds = req.body.document_ids;
    if (!documentIds || documentIds.length === 0) {
      const { rows } = await pool.query(
        `SELECT id FROM compliance_documents
         WHERE client_id = $1 AND status = 'processed'
         ORDER BY created_at DESC`,
        [clientId]
      );
      documentIds = rows.map((r) => r.id);
    }

    if (documentIds.length === 0) {
      return res.status(400).json({
        error: "No documents available for analysis. Run /documents/ingest first.",
      });
    }

    const result = await extractEvidence(
      clientId,
      jurisdiction_id,
      documentIds
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    res.json({
      ...result,
      client_id: clientId,
      analysis_engine: "db-driven-v2",
      engine_version: ENGINE_VERSION,
      elapsed_seconds: parseFloat(elapsed),
    });
  } catch (err) {
    console.error("POST /clients/:clientId/analyse error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Assessment Generation ────────────────────────────────────────────────
//
// POST /api/compliance/clients/:clientId/assess
// Body: { jurisdiction_id, engagement_id?, assessment_type? }

app.post("/api/compliance/clients/:clientId/assess", async (req, res) => {
  const clientId = req.params.clientId;
  const startTime = Date.now();

  try {
    const { jurisdiction_id, engagement_id, assessment_type } = req.body;
    if (!jurisdiction_id) {
      return res.status(400).json({ error: "jurisdiction_id is required" });
    }

    // Verify client
    const { rows: clientRows } = await pool.query(
      "SELECT id, company_name FROM compliance_clients WHERE id = $1",
      [clientId]
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Check that evidence exists
    const { rows: evidenceCheck } = await pool.query(
      `SELECT count(*) AS cnt FROM compliance_evidence ce
       JOIN compliance_requirements cr ON ce.requirement_id = cr.id
       WHERE ce.client_id = $1 AND cr.jurisdiction_id = $2`,
      [clientId, jurisdiction_id]
    );
    if (parseInt(evidenceCheck[0].cnt, 10) === 0) {
      return res.status(400).json({
        error: "No evidence available. Run /analyse first to extract evidence from documents.",
      });
    }

    const result = await buildAssessment(clientId, jurisdiction_id, {
      engagementId: engagement_id || null,
      assessmentType: assessment_type || "full",
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    res.json({
      client_id: clientId,
      company_name: clientRows[0].company_name,
      ...result,
      analysis_engine: "db-driven-v2",
      elapsed_seconds: parseFloat(elapsed),
    });
  } catch (err) {
    console.error("POST /clients/:clientId/assess error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Assessment History ───────────────────────────────────────────────────

app.get("/api/compliance/clients/:clientId/assessments", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ca.id, ca.jurisdiction_id, cj.short_name AS jurisdiction,
              cj.code AS jurisdiction_code, ca.client_id,
              ca.assessment_type, ca.engine_version,
              ca.overall_score, ca.domain_scores, ca.confidence_level,
              ca.working_papers,
              ca.status, ca.completed_at, ca.reviewed_by, ca.reviewed_at,
              ca.created_at,
              (SELECT count(*) FROM assessment_findings WHERE assessment_id = ca.id) AS finding_count
       FROM compliance_assessments ca
       JOIN compliance_jurisdictions cj ON ca.jurisdiction_id = cj.id
       WHERE ca.client_id = $1
       ORDER BY ca.created_at DESC`,
      [req.params.clientId]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:clientId/assessments error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/compliance/assessments/:id", async (req, res) => {
  try {
    const { rows: assessmentRows } = await pool.query(
      `SELECT ca.*, cj.short_name AS jurisdiction_name, cj.code AS jurisdiction_code,
              cc.company_name
       FROM compliance_assessments ca
       JOIN compliance_jurisdictions cj ON ca.jurisdiction_id = cj.id
       JOIN compliance_clients cc ON ca.client_id = cc.id
       WHERE ca.id = $1`,
      [req.params.id]
    );
    if (assessmentRows.length === 0) {
      return res.status(404).json({ error: "Assessment not found" });
    }

    const { rows: findings } = await pool.query(
      `SELECT af.*, cr.code AS requirement_code, cr.name AS requirement_name,
              cd.code AS domain_code, cd.name AS domain_name
       FROM assessment_findings af
       JOIN compliance_requirements cr ON af.requirement_id = cr.id
       JOIN compliance_domains cd ON af.domain_id = cd.id
       WHERE af.assessment_id = $1
       ORDER BY
         CASE af.severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           WHEN 'compliant' THEN 5
         END`,
      [req.params.id]
    );

    const { rows: scopeDocs } = await pool.query(
      `SELECT cd.id, cd.document_type, cd.title, cd.source_url, cd.word_count,
              cd.status, cd.version, cd.created_at, cd.updated_at
       FROM assessment_document_scope ads
       JOIN compliance_documents cd ON ads.document_id = cd.id
       WHERE ads.assessment_id = $1`,
      [req.params.id]
    );

    res.json({
      assessment: assessmentRows[0],
      findings,
      documents_in_scope: scopeDocs,
    });
  } catch (err) {
    console.error("GET /assessments/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Evidence Listing ─────────────────────────────────────────────────────

app.get("/api/compliance/clients/:clientId/evidence", async (req, res) => {
  try {
    const jurisdictionId = req.query.jurisdiction_id;

    let query = `
      SELECT ce.*, cr.code AS requirement_code, cr.name AS requirement_name,
             cd.title AS document_title, cd.document_type,
             ek.pattern AS keyword_pattern, ek.keyword_class
      FROM compliance_evidence ce
      JOIN compliance_requirements cr ON ce.requirement_id = cr.id
      LEFT JOIN compliance_documents cd ON ce.document_id = cd.id
      LEFT JOIN evidence_keywords ek ON ce.keyword_id = ek.id
      WHERE ce.client_id = $1
    `;
    const params = [req.params.clientId];

    if (jurisdictionId) {
      query += ` AND cr.jurisdiction_id = $2`;
      params.push(jurisdictionId);
    }

    query += ` ORDER BY ce.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:clientId/evidence error:", err);
    res.status(500).json({ error: err.message });
  }
});

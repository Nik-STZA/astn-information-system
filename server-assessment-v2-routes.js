/**
 * Dual-model ASSESSMENT runner (jurisdiction-agnostic) — the substance-reading engine.
 *
 * The keyword engine (server-compliance-v2-routes.js) counts keyword hits and so marks documents
 * "present" too readily (false-present). This runner instead has Gemini + Claude READ the client's
 * documents and judge each requirement present/partial/absent with a verified verbatim quote, then
 * adjudicates (see server-lib-assessment.js). It writes the SAME compliance_assessments /
 * assessment_findings shape as the keyword engine, so the board, domain_scores, radar and
 * remediation bridge all consume it unchanged. Nothing here names a framework.
 * See docs/compliance-engine-principles.md (Invariants 1, 4, 5).
 *
 * Endpoint:
 *  - POST /api/v2/clients/:clientId/assessments/dual-model
 *      body: { jurisdiction_id | jurisdiction_code, engagement_id?, assessment_type? }
 *
 * Requires GEMINI_API_KEY + ANTHROPIC_API_KEY (Cloud Run secrets). Long-running (2 models ×
 * N requirements) — runs requirements with bounded concurrency to stay inside the request timeout.
 */

const { SEVERITY_SCORES, judgeRequirement, GEMINI_MODEL, CLAUDE_MODEL } = require("./server-lib-assessment");

const MAX_CHARS = 40000;
const CONCURRENCY = 5;

function stripHtmlA(h) {
  return (h || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Run async fn over items with bounded concurrency, preserving order.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

app.post("/api/v2/clients/:clientId/assessments/dual-model", async (req, res) => {
  const { clientId } = req.params;
  let {
    jurisdiction_id,
    jurisdiction_code,
    engagement_id = null,
    assessment_type = "full",
  } = req.body || {};

  try {
    // ── Resolve jurisdiction ────────────────────────────────────────────────
    if (!jurisdiction_id && jurisdiction_code) {
      const { rows } = await pool.query(
        "SELECT id FROM compliance_jurisdictions WHERE code = $1 AND is_active = true",
        [jurisdiction_code],
      );
      if (!rows.length) return res.status(404).json({ error: `jurisdiction '${jurisdiction_code}' not found` });
      jurisdiction_id = rows[0].id;
    }
    if (!jurisdiction_id) return res.status(400).json({ error: "jurisdiction_id or jurisdiction_code required" });

    const { rows: jrows } = await pool.query(
      "SELECT id, code, short_name, scoring_config FROM compliance_jurisdictions WHERE id = $1",
      [jurisdiction_id],
    );
    if (!jrows.length) return res.status(404).json({ error: "jurisdiction not found" });
    const jur = jrows[0];

    // ── Client (for attested facts) ─────────────────────────────────────────
    const { rows: crows } = await pool.query(
      "SELECT company_name, io_appointed FROM compliance_clients WHERE id = $1",
      [clientId],
    );
    if (!crows.length) return res.status(404).json({ error: "client not found" });
    const client = crows[0];
    const { rows: regs } = await pool.query(
      "SELECT regulator, registration_number, status FROM client_regulator_registrations WHERE client_id = $1",
      [clientId],
    );

    // ── Knowledge base: domains + requirements ──────────────────────────────
    const { rows: domains } = await pool.query(
      "SELECT * FROM compliance_domains WHERE jurisdiction_id = $1 ORDER BY display_order",
      [jurisdiction_id],
    );
    const { rows: requirements } = await pool.query(
      "SELECT * FROM compliance_requirements WHERE jurisdiction_id = $1 ORDER BY display_order",
      [jurisdiction_id],
    );
    if (!requirements.length) return res.status(400).json({ error: "no requirements seeded for this jurisdiction" });
    const domainById = Object.fromEntries(domains.map((d) => [d.id, d]));

    // ── Corpus ──────────────────────────────────────────────────────────────
    const { rows: docs } = await pool.query(
      `SELECT document_type, title, COALESCE(raw_content, processed_content, '') AS content
       FROM compliance_documents WHERE client_id = $1`,
      [clientId],
    );
    if (!docs.length) return res.status(400).json({ error: "client has no documents to assess" });
    const attest =
      `\n\n## Client-attested facts (outside the documents)\n` +
      `Information Officer appointed: ${client.io_appointed || "not recorded"}\n` +
      `Regulator registrations: ${regs.map((r) => `${r.regulator} (${r.registration_number || "no number"}, ${r.status})`).join("; ") || "none recorded"}`;
    const baseCorpus = docs
      .map((d) => `## ${d.title} (${d.document_type})\n${stripHtmlA(d.content)}`)
      .join("\n\n")
      .slice(0, MAX_CHARS - attest.length);

    // ── Supersede prior assessments for this client+jurisdiction ────────────
    await pool.query(
      `UPDATE compliance_assessments
         SET status = 'superseded', updated_at = NOW(), retention_expires_at = NOW() + INTERVAL '5 years'
       WHERE client_id = $1 AND jurisdiction_id = $2 AND status IN ('in_progress', 'completed')`,
      [clientId, jurisdiction_id],
    );

    // ── Create in-progress assessment ───────────────────────────────────────
    const { rows: ins } = await pool.query(
      `INSERT INTO compliance_assessments
         (client_id, jurisdiction_id, engagement_id, assessment_type, engine_version, status, retention_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'in_progress', NOW() + INTERVAL '5 years')
       RETURNING id`,
      [clientId, jurisdiction_id, engagement_id, assessment_type, "dual-model-1.0.0"],
    );
    const assessmentId = ins[0].id;

    // ── Judge every requirement (bounded concurrency) ───────────────────────
    const judged = await mapLimit(requirements, CONCURRENCY, async (req_) => {
      const domain = domainById[req_.domain_id] || {};
      const isAccountability = /accountab|governance|information officer|records of processing|dpo/i.test(domain.name || "");
      const corpus = isAccountability ? baseCorpus + attest : baseCorpus;
      try {
        const verdict = await judgeRequirement(
          { name: req_.name, legislation_ref: req_.legislation_ref, domain: domain.name },
          corpus,
        );
        return { req: req_, domain, verdict };
      } catch (err) {
        // One flaky model call must not fail the whole run — flag it for review.
        return {
          req: req_,
          domain,
          verdict: {
            final_status: "partial",
            confidence: "low",
            agreement: "error",
            needs_review: true,
            review_reason: `Model call failed, defaulted to "partial" for review: ${err.message}`,
            gemini: null,
            claude: null,
          },
        };
      }
    });

    // ── Write findings ──────────────────────────────────────────────────────
    const domainFindings = {};
    let anyLow = false;
    let allHigh = true;
    let reviewCount = 0;
    let disagreeCount = 0;

    for (const { req: req_, domain, verdict } of judged) {
      const status = verdict.final_status;
      const severity = req_[`${status}_severity`] || (status === "present" ? "compliant" : status === "partial" ? "medium" : "high");
      const findingText = req_[`${status}_finding`] || verdict.review_reason || `Assessed as ${status}.`;
      const recommendation = req_[`${status}_recommendation`] || null;
      const score = SEVERITY_SCORES[severity] ?? 5;

      const winningQuote =
        (verdict.claude?.quote_verified && verdict.claude.status === status && verdict.claude.evidence_quote) ||
        (verdict.gemini?.quote_verified && verdict.gemini.status === status && verdict.gemini.evidence_quote) ||
        verdict.claude?.evidence_quote ||
        verdict.gemini?.evidence_quote ||
        null;
      const evidenceCount = status !== "absent" && winningQuote ? 1 : 0;

      const confidenceFactors = {
        engine: "dual-model",
        models: [GEMINI_MODEL, CLAUDE_MODEL],
        agreement: verdict.agreement,
        needs_review: verdict.needs_review,
        review_reason: verdict.review_reason,
        evidence_quote: winningQuote,
        evidence_doc: verdict.claude?.evidence_doc || verdict.gemini?.evidence_doc || null,
        gemini: verdict.gemini,
        claude: verdict.claude,
      };

      await pool.query(
        `INSERT INTO assessment_findings
           (assessment_id, requirement_id, domain_id, status, severity, finding_text, recommendation,
            evidence_ids, evidence_count, confidence, confidence_factors, score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
        [
          assessmentId, req_.id, req_.domain_id, status, severity, findingText, recommendation,
          [], evidenceCount, verdict.confidence, JSON.stringify(confidenceFactors), score,
        ],
      );

      if (verdict.confidence === "low") anyLow = true;
      if (verdict.confidence !== "high") allHigh = false;
      if (verdict.needs_review) reviewCount++;
      if (verdict.agreement === "disagree") disagreeCount++;

      const did = req_.domain_id;
      (domainFindings[did] ||= { code: domain.code, name: domain.name, weight: parseFloat(domain.weight) || 1.0, scores: [] }).scores.push(score);
    }

    // ── Scores (identical formula to the keyword engine) ────────────────────
    const sc = jur.scoring_config || {};
    const minWeight = sc.min_weight ?? 0.3;
    const avgWeight = sc.avg_weight ?? 0.7;
    const mandatoryDomains = sc.mandatory_domains || [];
    const mandatoryThreshold = sc.mandatory_threshold ?? 50;

    const domainScoreMap = {};
    const domainScoreValues = [];
    for (const data of Object.values(domainFindings)) {
      const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const scaled = Math.round((avg / 9) * 100);
      domainScoreMap[data.code] = { score: scaled, weight: data.weight, name: data.name, requirement_count: data.scores.length };
      domainScoreValues.push({ score: scaled, weight: data.weight, code: data.code });
    }
    const totalWeight = domainScoreValues.reduce((a, d) => a + d.weight, 0);
    const weightedAvg = totalWeight > 0 ? domainScoreValues.reduce((a, d) => a + d.score * d.weight, 0) / totalWeight : 0;
    const minDomainScore = domainScoreValues.length ? Math.min(...domainScoreValues.map((d) => d.score)) : 0;
    let overallScore = Math.round(minWeight * minDomainScore + avgWeight * weightedAvg);
    for (const mandCode of mandatoryDomains) {
      if (domainScoreMap[mandCode] && domainScoreMap[mandCode].score < mandatoryThreshold) {
        overallScore = Math.min(overallScore, domainScoreMap[mandCode].score);
      }
    }
    const confidenceLevel = allHigh ? "high" : anyLow ? "low" : "medium";

    const workingPapers = {
      engine: "dual-model",
      models: [GEMINI_MODEL, CLAUDE_MODEL],
      requirement_count: requirements.length,
      needs_review_count: reviewCount,
      disagreements: disagreeCount,
      generated_at: new Date().toISOString(),
    };

    // ── Complete ────────────────────────────────────────────────────────────
    await pool.query(
      `UPDATE compliance_assessments
         SET overall_score = $2, domain_scores = $3::jsonb, confidence_level = $4,
             status = 'completed', completed_at = NOW(), working_papers = $5::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [assessmentId, overallScore, JSON.stringify(domainScoreMap), confidenceLevel, JSON.stringify(workingPapers)],
    );

    try {
      await pool.query(
        `INSERT INTO audit_log (client_id, entity_type, entity_id, action, description, performed_by, metadata)
         VALUES ($1, 'compliance_assessment', $2, 'dual_model_assessment', $3, 'nik@stza.io', $4)`,
        [
          clientId, assessmentId,
          `Dual-model ${jur.short_name} assessment: ${overallScore}/100, ${reviewCount} findings need review, ${disagreeCount} model disagreements`,
          JSON.stringify({ jurisdiction: jur.code, overall_score: overallScore, needs_review: reviewCount, disagreements: disagreeCount }),
        ],
      );
    } catch (e) {
      console.error("audit_log write failed:", e.message);
    }

    res.status(201).json({
      assessment_id: assessmentId,
      jurisdiction: jur.code,
      overall_score: overallScore,
      confidence_level: confidenceLevel,
      requirements: requirements.length,
      needs_review: reviewCount,
      disagreements: disagreeCount,
      domain_scores: domainScoreMap,
    });
  } catch (err) {
    console.error("POST /v2/.../assessments/dual-model error:", err);
    res.status(500).json({ error: err.message });
  }
});

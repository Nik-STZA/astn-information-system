/**
 * Agent routes patch for Cloud Run server.js
 *
 * ADD these route blocks AFTER the pipeline routes (documents, analysis, assessments).
 *
 * Provides three agent endpoints:
 *  - POST /api/compliance/prospects/:id/ingest   — fetch & store prospect documents
 *  - POST /api/compliance/prospects/:id/analyse   — run POPIA compliance analysis via Claude
 *  - POST /api/compliance/prospects/:id/assess    — generate scored assessment via Claude
 *
 * PREREQUISITES:
 *  1. npm install @anthropic-ai/sdk node-html-markdown
 *  2. Set env var ANTHROPIC_API_KEY on Cloud Run
 *  3. The pipeline routes (server-pipeline-routes.js) must already be applied
 *
 * DEPENDENCIES (add at the top of server.js alongside existing requires):
 *
 *   const Anthropic = require("@anthropic-ai/sdk");
 *   const { NodeHtmlMarkdown } = require("node-html-markdown");
 *   const crypto = require("crypto");
 *
 *   const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
 *   const nhm = new NodeHtmlMarkdown();
 *
 *   const AGENT_MODEL = process.env.AGENT_MODEL || "claude-sonnet-4-20250514";
 *   const AGENT_VERSION = "1.0.0";
 */

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
      // For PDFs, plain text, etc. — store raw text if possible
      const text = await res.text();
      return { error: null, html: null, markdown: text.slice(0, 100000) };
    }

    const html = await res.text();
    const markdown = nhm.translate(html);

    return {
      error: null,
      html: html.slice(0, 500000), // cap storage at 500KB
      markdown: markdown.slice(0, 100000), // cap markdown at 100KB
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
  // other_urls can contain multiple pipe-separated URLs
};

// ─── Document Ingestion ─────────────────────────────────────────────────────

app.post("/api/compliance/prospects/:id/ingest", async (req, res) => {
  const prospectId = req.params.id;
  const startTime = Date.now();

  try {
    // 1. Fetch prospect record
    const { rows: prospectRows } = await pool.query(
      "SELECT * FROM compliance_prospects WHERE id = $1",
      [prospectId]
    );
    if (prospectRows.length === 0) {
      return res.status(404).json({ error: "Prospect not found" });
    }
    const prospect = prospectRows[0];

    // 2. Update research_status to 'collecting'
    await pool.query(
      `UPDATE compliance_prospects
       SET research_status = 'collecting', updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    // 3. Build list of URLs to fetch
    const urlsToFetch = [];
    for (const [field, docType] of Object.entries(URL_FIELD_MAP)) {
      const url = prospect[field];
      if (url && url.trim()) {
        urlsToFetch.push({ url: url.trim(), document_type: docType, field });
      }
    }

    // Handle other_urls (pipe-separated)
    if (prospect.other_urls) {
      const others = prospect.other_urls
        .split("|")
        .map((u) => u.trim())
        .filter(Boolean);
      for (const url of others) {
        urlsToFetch.push({ url, document_type: "other", field: "other_urls" });
      }
    }

    // Also check company_website for cookie policy if no dedicated URL
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

    // 4. Fetch and store each document
    const results = [];
    for (const { url, document_type, field } of urlsToFetch) {
      const { error, html, markdown } = await fetchAndConvert(
        url,
        // nhm is expected to be in scope from the top-level require
        nhm
      );

      if (error) {
        results.push({
          url,
          document_type,
          status: "failed",
          error,
        });
        continue;
      }

      // Compute content hash to detect duplicates
      const contentHash = crypto
        .createHash("sha256")
        .update(markdown || html || "")
        .digest("hex");

      // Check for existing document with same hash (skip if duplicate)
      const { rows: existing } = await pool.query(
        `SELECT id FROM prospect_documents
         WHERE prospect_id = $1 AND file_hash = $2`,
        [prospectId, contentHash]
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

      // Derive a title from the URL
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
          prospectId,
          document_type,
          docTitle,
          url,
          html,
          markdown,
          contentHash,
          JSON.stringify({ source_field: field, ingested_by: "agent" }),
        ]
      );

      results.push({
        url,
        document_type,
        status: "stored",
        document_id: inserted[0].id,
        title: inserted[0].document_title,
        markdown_length: (markdown || "").length,
      });
    }

    // 5. Update document_count and research_status
    const storedCount = results.filter((r) => r.status === "stored").length;
    const dupCount = results.filter((r) => r.status === "skipped_duplicate").length;
    // Keep "collected" if we stored new docs OR already have docs from a prior run
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
      documents_skipped: results.filter((r) => r.status === "skipped_duplicate")
        .length,
      documents_failed: results.filter((r) => r.status === "failed").length,
      research_status: newStatus,
      elapsed_seconds: parseFloat(elapsed),
      results,
    });
  } catch (err) {
    console.error("POST /prospects/:id/ingest error:", err);
    // Reset status on failure
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

// ─── POPIA Compliance Analysis ──────────────────────────────────────────────

const POPIA_ANALYSIS_PROMPT = `You are a POPIA compliance analyst for AfricanSTN, a South African Information Officer representative service. You are analysing documents from an international company to assess their compliance with South Africa's Protection of Personal Information Act (POPIA), Act 4 of 2013.

## Your task

Analyse the provided documents and produce structured compliance findings. For each finding, assess against these POPIA check categories:

1. **information_officer** — Has the company appointed and registered an Information Officer with the Information Regulator per s55-56? Is there evidence of a South African-domiciled IO for a foreign entity per s58?
2. **lawful_processing** — Does the privacy policy establish a lawful basis for processing SA personal data per s8-12? Are the conditions for lawful processing met?
3. **consent_mechanism** — If relying on consent, is it specific, informed, voluntary, and capable of withdrawal per s11? Are consent mechanisms clearly presented?
4. **cross_border_transfer** — Are cross-border transfer mechanisms disclosed per s72? Does the company transfer SA personal data outside SA, and if so, under what safeguards?
5. **data_subject_rights** — Are data subject rights clearly communicated per s23-25 (access, correction, deletion, objection)?
6. **breach_notification** — Is there a breach notification commitment consistent with s22 (notification to IR and data subjects)?
7. **special_categories** — Does the company process special personal information (s26-33) including biometric data, children's data, health data? Are additional safeguards in place?
8. **retention_and_purpose** — Is data retention limited to the purpose of collection per s13-14? Are retention periods specified?
9. **security_safeguards** — Are appropriate technical and organisational security measures described per s19?
10. **direct_marketing** — If the company engages in direct marketing, does it comply with s69 (prior consent, opt-out mechanism)?

## Output format

Return a JSON array of findings. Each finding must have exactly these fields:

{
  "check_category": "one of the 10 categories above",
  "finding": "clear description of the specific finding",
  "severity": "critical | high | medium | low | info | compliant",
  "evidence_quote": "exact quote from the document supporting this finding, or null if no relevant text found",
  "evidence_location": "which document and approximate section the evidence was found in",
  "recommendation": "specific actionable recommendation to address this finding"
}

## Severity guide

- **critical**: Clear violation of POPIA that could result in enforcement action (e.g. no IO registration for a foreign entity processing SA data, no lawful basis stated)
- **high**: Significant gap that materially increases regulatory risk (e.g. no cross-border transfer disclosure despite obvious international transfers)
- **medium**: Notable omission or weakness (e.g. consent withdrawal mechanism unclear, retention periods not specified)
- **low**: Minor improvement needed (e.g. privacy policy could be clearer on a specific right)
- **info**: Observation that is neutral or contextual (e.g. company uses a particular framework)
- **compliant**: The company meets this requirement satisfactorily

## Important rules

- Base every finding on evidence from the actual documents. Do not fabricate quotes.
- If a document does not address a category at all, that is itself a finding (likely medium or high severity).
- Produce at least one finding per check category (10 minimum findings).
- Be specific — "the privacy policy does not mention X" is better than "there may be gaps."
- Consider that this is an international company — the key POPIA question is whether they have obligations under s3(1)(b)(ii) (extraterritorial jurisdiction) and s58 (foreign IO appointment).`;

app.post("/api/compliance/prospects/:id/analyse", async (req, res) => {
  const prospectId = req.params.id;
  const startTime = Date.now();

  try {
    // 1. Fetch prospect
    const { rows: prospectRows } = await pool.query(
      "SELECT * FROM compliance_prospects WHERE id = $1",
      [prospectId]
    );
    if (prospectRows.length === 0) {
      return res.status(404).json({ error: "Prospect not found" });
    }
    const prospect = prospectRows[0];

    // 2. Fetch their documents
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

    // 3. Update status
    await pool.query(
      `UPDATE compliance_prospects
       SET research_status = 'analysing', updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    // 4. Build the document context for Claude
    const documentContext = documents
      .map(
        (d) =>
          `### Document: ${d.document_title || d.document_type}\n` +
          `Type: ${d.document_type}\n` +
          `Source: ${d.source_url || "unknown"}\n\n` +
          `${(d.markdown_content || "").slice(0, 30000)}\n\n---`
      )
      .join("\n\n");

    const userMessage = `## Company being assessed

Company: ${prospect.company_name}
Country of domicile: ${prospect.company_country || "Unknown"}
Sector: ${prospect.sector || "Unknown"}
SA presence evidence: ${prospect.sa_presence_evidence || "Not yet documented"}
IR registered: ${prospect.ir_registered === true ? "Yes" : prospect.ir_registered === false ? "No" : "Unknown"}

## Documents to analyse

${documentContext}

Produce your compliance findings as a JSON array. Return ONLY the JSON array, no markdown fencing or commentary.`;

    // 5. Call Claude API
    const response = await anthropic.messages.create({
      model: AGENT_MODEL,
      max_tokens: 8192,
      messages: [
        { role: "user", content: POPIA_ANALYSIS_PROMPT + "\n\n" + userMessage },
      ],
    });

    const responseText =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    // 6. Parse findings from response
    let findings;
    try {
      // Handle potential markdown code fencing
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();
      findings = JSON.parse(cleaned);
      if (!Array.isArray(findings)) {
        throw new Error("Response is not an array");
      }
    } catch (parseErr) {
      await pool.query(
        `UPDATE compliance_prospects
         SET research_status = 'collected', updated_at = NOW()
         WHERE id = $1`,
        [prospectId]
      );
      return res.status(500).json({
        error: "Failed to parse Claude response as JSON",
        parse_error: parseErr.message,
        raw_response: responseText.slice(0, 2000),
      });
    }

    // 7. Store each finding
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
          // Try to match document_id from evidence_location
          null, // We don't try to match — the finding spans multiple docs
          f.check_category || "uncategorised",
          f.finding || "No description",
          f.severity || "info",
          f.evidence_quote || null,
          f.evidence_location || null,
          f.recommendation || null,
          AGENT_MODEL,
          AGENT_VERSION,
        ]
      );
      storedFindings.push(inserted[0]);
    }

    // 8. Update prospect counts and status
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
      model_used: AGENT_MODEL,
      input_tokens: response.usage?.input_tokens || null,
      output_tokens: response.usage?.output_tokens || null,
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

// ─── Assessment Generation ──────────────────────────────────────────────────

const ASSESSMENT_PROMPT = `You are a senior POPIA compliance assessor for AfricanSTN. Based on the analysis findings provided, generate a comprehensive compliance assessment for this company.

## Output format

Return a single JSON object with exactly these fields:

{
  "score_ir_registration": <0-10>,
  "score_biometric_handling": <0-10>,
  "score_cross_border": <0-10>,
  "score_consent_mechanism": <0-10>,
  "score_breach_notification": <0-10>,
  "score_data_subject_rights": <0-10>,
  "score_overall": <0-10>,
  "overall_severity": "critical | high | medium | low",
  "executive_summary": "2-3 paragraph executive summary suitable for a C-suite audience. Reference specific POPIA sections. Written in third person about the company.",
  "risk_factors": [
    { "level": "critical|high|medium|low", "factor": "short factor name", "note": "explanation" }
  ],
  "key_findings": [
    { "finding_id": <id from input>, "category": "check_category", "severity": "severity", "finding": "summary", "evidence": "key evidence or null" }
  ],
  "recommendations": [
    { "priority": 1, "action": "specific recommended action", "rationale": "why this matters" }
  ]
}

## Scoring guide (0 = fully non-compliant, 10 = fully compliant)

- 0-2: No evidence of compliance; likely violation
- 3-4: Minimal compliance; significant gaps
- 5-6: Partial compliance; notable weaknesses
- 7-8: Substantially compliant; minor improvements needed
- 9-10: Fully compliant; best practice

## Rules

- The executive_summary must be professional, specific, and cite POPIA section numbers.
- Include the top 5-8 key findings ordered by severity.
- Include 4-6 prioritised recommendations.
- Include 3-5 risk factors.
- Scores must reflect the actual findings — do not inflate or deflate.
- The overall score should be a weighted average biased toward the lowest domain scores (weakest-link principle).
- Return ONLY the JSON object, no markdown fencing.`;

app.post("/api/compliance/prospects/:id/assess", async (req, res) => {
  const prospectId = req.params.id;
  const startTime = Date.now();

  try {
    // 1. Fetch prospect
    const { rows: prospectRows } = await pool.query(
      "SELECT * FROM compliance_prospects WHERE id = $1",
      [prospectId]
    );
    if (prospectRows.length === 0) {
      return res.status(404).json({ error: "Prospect not found" });
    }
    const prospect = prospectRows[0];

    // 2. Fetch analysis findings
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

    // 3. Build context for Claude
    const findingsContext = findings
      .map(
        (f) =>
          `[ID:${f.id}] Category: ${f.check_category} | Severity: ${f.severity}\n` +
          `Finding: ${f.finding}\n` +
          (f.evidence_quote
            ? `Evidence: "${f.evidence_quote}"\n`
            : "Evidence: none\n") +
          (f.recommendation
            ? `Recommendation: ${f.recommendation}\n`
            : "")
      )
      .join("\n---\n");

    const userMessage = `## Company

Company: ${prospect.company_name}
Country: ${prospect.company_country || "Unknown"}
Sector: ${prospect.sector || "Unknown"}
SA presence: ${prospect.sa_presence_evidence || "Not documented"}
IR registered: ${prospect.ir_registered === true ? "Yes" : prospect.ir_registered === false ? "No" : "Unknown"}

## Analysis findings (${findings.length} total)

${findingsContext}

Generate the assessment JSON object. Return ONLY the JSON object.`;

    // 4. Call Claude API
    const response = await anthropic.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4096,
      messages: [
        { role: "user", content: ASSESSMENT_PROMPT + "\n\n" + userMessage },
      ],
    });

    const responseText =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    // 5. Parse assessment
    let assessment;
    try {
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();
      assessment = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(500).json({
        error: "Failed to parse assessment response",
        parse_error: parseErr.message,
        raw_response: responseText.slice(0, 2000),
      });
    }

    // 6. Store assessment (auto-versioning and superseding handled by existing route logic)
    // But since we're in the same server, we replicate the logic inline:

    // Supersede any existing non-superseded assessments
    await pool.query(
      `UPDATE prospect_assessments
       SET status = 'superseded', updated_at = NOW()
       WHERE prospect_id = $1 AND status != 'superseded'`,
      [prospectId]
    );

    // Get next version number
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
               'agent', $15, $16, false)
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
        AGENT_MODEL,
        AGENT_VERSION,
      ]
    );

    // 7. Update prospect status
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
      model_used: AGENT_MODEL,
      input_tokens: response.usage?.input_tokens || null,
      output_tokens: response.usage?.output_tokens || null,
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
 * Use { "skip_ingest": true } in body to skip document collection
 * (e.g. if documents were already ingested).
 */
app.post("/api/compliance/prospects/:id/run-pipeline", async (req, res) => {
  const prospectId = req.params.id;
  const { skip_ingest } = req.body || {};
  const startTime = Date.now();

  try {
    const results = { prospect_id: prospectId, stages: {} };

    // Stage 1: Ingest (unless skipped)
    if (!skip_ingest) {
      const ingestRes = await new Promise((resolve, reject) => {
        const mockReq = {
          params: { id: prospectId },
          body: {},
          query: {},
        };
        const mockRes = {
          status(code) {
            this._status = code;
            return this;
          },
          json(data) {
            resolve({ status: this._status || 200, data });
          },
          _status: 200,
        };
        // Inline call — we reuse the route handler logic
        // This is a simplified approach; production would extract shared functions
      });
      // The inline approach is fragile. Instead, use fetch to localhost.
    }

    // For robustness, use internal HTTP calls
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
      results.stages.ingest = {
        status: ingestRes.status,
        ...ingestData,
      };
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
    results.stages.analyse = {
      status: analyseRes.status,
      ...analyseData,
    };
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
    results.stages.assess = {
      status: assessRes.status,
      ...assessData,
    };
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

/**
 * Pipeline routes patch for Cloud Run server.js
 *
 * ADD these route blocks AFTER the existing compliance routes
 * (prospects, clients, activities).
 *
 * Provides CRUD for:
 *  - /api/compliance/prospects/:id/documents
 *  - /api/compliance/prospects/:id/analysis
 *  - /api/compliance/prospects/:id/assessments
 *  - /api/compliance/documents/:id
 *  - /api/compliance/analysis/:id
 *  - /api/compliance/assessments/:id
 */

// ─── Prospect Documents ─────────────────────────────────────────────────────

// List documents for a prospect
app.get("/api/compliance/prospects/:id/documents", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM prospect_documents
       WHERE prospect_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /prospects/:id/documents error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Add a document to a prospect
app.post("/api/compliance/prospects/:id/documents", async (req, res) => {
  try {
    const prospectId = req.params.id;
    const {
      document_type, document_title, source_url, snapshot_date,
      pdf_storage_path, html_snapshot, markdown_content,
      conversion_status, file_hash, metadata
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO prospect_documents
         (prospect_id, document_type, document_title, source_url, snapshot_date,
          pdf_storage_path, html_snapshot, markdown_content,
          conversion_status, file_hash, metadata)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8,
               COALESCE($9, 'pending'), $10, COALESCE($11, '{}'))
       RETURNING *`,
      [prospectId, document_type, document_title, source_url, snapshot_date,
       pdf_storage_path, html_snapshot, markdown_content,
       conversion_status, file_hash, metadata ? JSON.stringify(metadata) : null]
    );

    // Update document_count on the prospect
    await pool.query(
      `UPDATE compliance_prospects
       SET document_count = (
         SELECT count(*) FROM prospect_documents WHERE prospect_id = $1
       ), updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /prospects/:id/documents error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single document (with markdown content)
app.get("/api/compliance/documents/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM prospect_documents WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /documents/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update a document
app.put("/api/compliance/documents/:id", async (req, res) => {
  try {
    const fields = req.body;
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at") continue;
      if (key === "metadata") {
        setClauses.push(`${key} = $${idx}`);
        values.push(JSON.stringify(value));
      } else {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
      }
      idx++;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE prospect_documents SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /documents/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a document
app.delete("/api/compliance/documents/:id", async (req, res) => {
  try {
    // Get prospect_id before deleting
    const { rows: docRows } = await pool.query(
      "SELECT prospect_id FROM prospect_documents WHERE id = $1",
      [req.params.id]
    );
    if (docRows.length === 0) return res.status(404).json({ error: "Not found" });

    const prospectId = docRows[0].prospect_id;

    await pool.query("DELETE FROM prospect_documents WHERE id = $1", [req.params.id]);

    // Update document_count
    await pool.query(
      `UPDATE compliance_prospects
       SET document_count = (
         SELECT count(*) FROM prospect_documents WHERE prospect_id = $1
       ), updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /documents/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Prospect Analysis ──────────────────────────────────────────────────────

// List analysis findings for a prospect
app.get("/api/compliance/prospects/:id/analysis", async (req, res) => {
  try {
    const { jurisdiction, severity, category } = req.query;
    let query = `SELECT pa.*, pd.document_title, pd.document_type
                 FROM prospect_analysis pa
                 LEFT JOIN prospect_documents pd ON pa.document_id = pd.id
                 WHERE pa.prospect_id = $1`;
    const params = [req.params.id];
    let idx = 2;

    if (jurisdiction) {
      query += ` AND pa.jurisdiction = $${idx}`;
      params.push(jurisdiction);
      idx++;
    }
    if (severity) {
      query += ` AND pa.severity = $${idx}`;
      params.push(severity);
      idx++;
    }
    if (category) {
      query += ` AND pa.check_category = $${idx}`;
      params.push(category);
      idx++;
    }

    query += " ORDER BY pa.created_at DESC";

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /prospects/:id/analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create an analysis finding
app.post("/api/compliance/prospects/:id/analysis", async (req, res) => {
  try {
    const prospectId = req.params.id;
    const {
      document_id, analysis_date, jurisdiction, check_category,
      finding, severity, evidence_quote, evidence_location,
      recommendation, agent_model, agent_version,
      human_reviewed, reviewer_notes
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO prospect_analysis
         (prospect_id, document_id, analysis_date, jurisdiction, check_category,
          finding, severity, evidence_quote, evidence_location,
          recommendation, agent_model, agent_version,
          human_reviewed, reviewer_notes)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), COALESCE($4, 'POPIA'), $5,
               $6, COALESCE($7, 'info'), $8, $9, $10, $11, $12,
               COALESCE($13, false), $14)
       RETURNING *`,
      [prospectId, document_id, analysis_date, jurisdiction, check_category,
       finding, severity, evidence_quote, evidence_location,
       recommendation, agent_model, agent_version,
       human_reviewed, reviewer_notes]
    );

    // Update counts on the prospect
    await pool.query(
      `UPDATE compliance_prospects
       SET finding_count = (
             SELECT count(*) FROM prospect_analysis WHERE prospect_id = $1
           ),
           critical_finding_count = (
             SELECT count(*) FROM prospect_analysis
             WHERE prospect_id = $1 AND severity = 'critical'
           ),
           updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /prospects/:id/analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update an analysis finding (human review)
app.put("/api/compliance/analysis/:id", async (req, res) => {
  try {
    const fields = req.body;
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at") continue;
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE prospect_analysis SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /analysis/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Prospect Assessments ───────────────────────────────────────────────────

// List assessments for a prospect
app.get("/api/compliance/prospects/:id/assessments", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM prospect_assessments
       WHERE prospect_id = $1
       ORDER BY assessment_version DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /prospects/:id/assessments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create an assessment
app.post("/api/compliance/prospects/:id/assessments", async (req, res) => {
  try {
    const prospectId = req.params.id;

    // Auto-increment version
    const { rows: versionRows } = await pool.query(
      `SELECT COALESCE(MAX(assessment_version), 0) + 1 AS next_version
       FROM prospect_assessments WHERE prospect_id = $1`,
      [prospectId]
    );
    const nextVersion = versionRows[0].next_version;

    // Mark previous assessments as superseded
    await pool.query(
      `UPDATE prospect_assessments
       SET status = 'superseded', updated_at = NOW()
       WHERE prospect_id = $1 AND status != 'superseded'`,
      [prospectId]
    );

    const {
      score_ir_registration, score_biometric_handling, score_cross_border,
      score_consent_mechanism, score_breach_notification, score_data_subject_rights,
      score_overall, overall_severity, executive_summary,
      risk_factors, key_findings, recommendations,
      generated_by, agent_model, agent_version
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO prospect_assessments
         (prospect_id, assessment_version, score_ir_registration,
          score_biometric_handling, score_cross_border, score_consent_mechanism,
          score_breach_notification, score_data_subject_rights, score_overall,
          overall_severity, executive_summary, risk_factors, key_findings,
          recommendations, generated_by, agent_model, agent_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               COALESCE($15, 'human'), $16, $17)
       RETURNING *`,
      [prospectId, nextVersion, score_ir_registration,
       score_biometric_handling, score_cross_border, score_consent_mechanism,
       score_breach_notification, score_data_subject_rights, score_overall,
       overall_severity, executive_summary,
       risk_factors ? JSON.stringify(risk_factors) : null,
       key_findings ? JSON.stringify(key_findings) : null,
       recommendations ? JSON.stringify(recommendations) : null,
       generated_by, agent_model, agent_version]
    );

    // Update prospect research_status
    await pool.query(
      `UPDATE compliance_prospects
       SET research_status = 'assessed', updated_at = NOW()
       WHERE id = $1`,
      [prospectId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /prospects/:id/assessments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single assessment
app.get("/api/compliance/assessments/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM prospect_assessments WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /assessments/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update an assessment (human review, status change)
app.put("/api/compliance/assessments/:id", async (req, res) => {
  try {
    const fields = req.body;
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at") continue;
      if (["risk_factors", "key_findings", "recommendations"].includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(JSON.stringify(value));
      } else {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
      }
      idx++;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE prospect_assessments SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /assessments/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

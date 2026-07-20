/**
 * Processing activities and special categories routes for Cloud Run server.js
 *
 * CRUD for two tables (migration 010):
 *  - client_processing_activities   (ROPA — Record of Processing Activities)
 *  - client_special_categories      (POPIA s26-33 special personal information)
 *
 * Endpoints:
 *  - /api/clients/:id/processing-activities     GET, POST
 *  - /api/processing-activities/:id             GET, PUT, DELETE
 *  - /api/clients/:id/special-categories        GET, POST
 *  - /api/special-categories/:id                PUT, DELETE
 *  - /api/clients/:id/special-categories/init   POST  (initialise all 9 categories)
 */

// ─── Processing Activities (ROPA) ───────────────────────────────────────────

// List all processing activities for a client
app.get("/api/clients/:id/processing-activities", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM client_processing_activities
       WHERE client_id = $1
       ORDER BY activity_name ASC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/processing-activities error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single processing activity
app.get("/api/processing-activities/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM client_processing_activities WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /processing-activities/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create a processing activity
app.post("/api/clients/:id/processing-activities", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      activity_name, description, personal_data_types, data_subject_categories,
      estimated_volume, legal_basis, legal_basis_detail, purpose,
      retention_period, retention_basis, recipients, cross_border,
      transfer_countries, transfer_mechanism, security_measures, status
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO client_processing_activities
         (client_id, activity_name, description, personal_data_types,
          data_subject_categories, estimated_volume, legal_basis, legal_basis_detail,
          purpose, retention_period, retention_basis, recipients,
          cross_border, transfer_countries, transfer_mechanism,
          security_measures, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               COALESCE($13, false), $14, $15, $16, COALESCE($17, 'active'))
       RETURNING *`,
      [clientId, activity_name, description, personal_data_types,
       data_subject_categories, estimated_volume, legal_basis, legal_basis_detail,
       purpose, retention_period, retention_basis, recipients,
       cross_border, transfer_countries, transfer_mechanism,
       security_measures, status]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/processing-activities error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update a processing activity
app.put("/api/processing-activities/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'activity_name', 'description', 'personal_data_types',
      'data_subject_categories', 'estimated_volume', 'legal_basis',
      'legal_basis_detail', 'purpose', 'retention_period', 'retention_basis',
      'recipients', 'cross_border', 'transfer_countries', 'transfer_mechanism',
      'security_measures', 'status', 'last_reviewed'
    ];
    const filtered = {};
    for (const k of ALLOWED_FIELDS) {
      if (req.body[k] !== undefined) filtered[k] = req.body[k];
    }

    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(filtered)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    setClauses.push("updated_at = NOW()");

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE client_processing_activities SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /processing-activities/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a processing activity
app.delete("/api/processing-activities/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM client_processing_activities WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /processing-activities/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Special Categories (POPIA s26-33) ──────────────────────────────────────

// List all special categories for a client
app.get("/api/clients/:id/special-categories", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM client_special_categories
       WHERE client_id = $1
       ORDER BY category ASC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/special-categories error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Initialise all 9 categories for a client (idempotent — skips existing)
app.post("/api/clients/:id/special-categories/init", async (req, res) => {
  try {
    const clientId = req.params.id;
    const CATEGORIES = [
      'religious_beliefs', 'race_ethnicity', 'trade_union',
      'political', 'health', 'sex_life', 'biometric',
      'criminal', 'children'
    ];

    const { rows } = await pool.query(
      `INSERT INTO client_special_categories (client_id, category)
       SELECT $1, unnest($2::text[])
       ON CONFLICT (client_id, category) DO NOTHING
       RETURNING *`,
      [clientId, CATEGORIES]
    );
    // Return all categories (including pre-existing ones)
    const { rows: all } = await pool.query(
      `SELECT * FROM client_special_categories
       WHERE client_id = $1
       ORDER BY category ASC`,
      [clientId]
    );
    res.status(201).json({ inserted: rows.length, data: all });
  } catch (err) {
    console.error("POST /clients/:id/special-categories/init error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create a single special category entry
app.post("/api/clients/:id/special-categories", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      category, is_processed, processing_description, volume_estimate,
      legal_basis, safeguards, prior_auth_required, prior_auth_status,
      prior_auth_reference, prior_auth_date, compliance_status, assessor_notes
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO client_special_categories
         (client_id, category, is_processed, processing_description,
          volume_estimate, legal_basis, safeguards, prior_auth_required,
          prior_auth_status, prior_auth_reference, prior_auth_date,
          compliance_status, assessor_notes)
       VALUES ($1, $2, COALESCE($3, false), $4, $5, $6, $7, $8,
               COALESCE($9, 'not_required'), $10, $11,
               COALESCE($12, 'not_assessed'), $13)
       RETURNING *`,
      [clientId, category, is_processed, processing_description,
       volume_estimate, legal_basis, safeguards, prior_auth_required,
       prior_auth_status, prior_auth_reference, prior_auth_date,
       compliance_status, assessor_notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/special-categories error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update a special category
app.put("/api/special-categories/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'is_processed', 'processing_description', 'volume_estimate',
      'legal_basis', 'safeguards', 'prior_auth_required', 'prior_auth_status',
      'prior_auth_reference', 'prior_auth_date', 'compliance_status',
      'last_assessed', 'assessor_notes'
    ];
    const filtered = {};
    for (const k of ALLOWED_FIELDS) {
      if (req.body[k] !== undefined) filtered[k] = req.body[k];
    }

    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(filtered)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    setClauses.push("updated_at = NOW()");

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE client_special_categories SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /special-categories/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a special category
app.delete("/api/special-categories/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM client_special_categories WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /special-categories/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

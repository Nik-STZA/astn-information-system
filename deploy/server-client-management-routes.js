/**
 * Client management routes patch for Cloud Run server.js
 *
 * ADD these route blocks AFTER the existing compliance routes
 * and the pipeline routes (server-pipeline-routes.js).
 *
 * Provides CRUD for 5 tables:
 *  - client_engagements
 *  - io_registrations
 *  - breach_incidents
 *  - compliance_tasks
 *  - regulatory_correspondence
 *
 * Endpoints consumed by src/lib/data/client-management.ts:
 *  - /api/clients/:id/engagements     GET, POST
 *  - /api/engagements/:id             PUT, DELETE
 *  - /api/clients/:id/registrations   GET, POST
 *  - /api/registrations/:id           PUT, DELETE
 *  - /api/clients/:id/breaches        GET, POST
 *  - /api/breaches/:id                PUT, DELETE
 *  - /api/clients/:id/tasks           GET, POST
 *  - /api/tasks                       GET (all, optional ?status=)
 *  - /api/tasks/:id                   PUT, DELETE
 *  - /api/clients/:id/correspondence  GET, POST
 *  - /api/correspondence              GET (all)
 *  - /api/correspondence/:id          PUT, DELETE
 *  - /api/client-management/summary   GET
 *
 * Prerequisites:
 *  - Run migration 006-client-management.sql against Cloud SQL
 */

// ─── Engagements ────────────────────────────────────────────────────────────

app.get("/api/clients/:id/engagements", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM client_engagements
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/engagements error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients/:id/engagements", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      service_tier, engagement_status, start_date, end_date,
      annual_fee_gbp, annual_fee_zar, payment_frequency,
      agreement_document_url, notes
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO client_engagements
         (client_id, service_tier, engagement_status, start_date, end_date,
          annual_fee_gbp, annual_fee_zar, payment_frequency,
          agreement_document_url, notes)
       VALUES ($1, $2, COALESCE($3, 'draft'), $4, $5, $6, $7,
               COALESCE($8, 'annual'), $9, $10)
       RETURNING *`,
      [clientId, service_tier, engagement_status, start_date, end_date,
       annual_fee_gbp, annual_fee_zar, payment_frequency,
       agreement_document_url, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/engagements error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/engagements/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'service_tier', 'engagement_status', 'start_date', 'end_date',
      'annual_fee_gbp', 'annual_fee_zar', 'payment_frequency',
      'agreement_document_url', 'notes'
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE client_engagements SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /engagements/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/engagements/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM client_engagements WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /engagements/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── IO Registrations ───────────────────────────────────────────────────────

app.get("/api/clients/:id/registrations", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM io_registrations
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/registrations error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients/:id/registrations", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      registration_type, registrant_name, registrant_email,
      registrant_phone, registrant_role, ir_reference_number,
      registration_status, submitted_date, confirmed_date,
      portal_used, portal_organisation_type, notes
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO io_registrations
         (client_id, registration_type, registrant_name, registrant_email,
          registrant_phone, registrant_role, ir_reference_number,
          registration_status, submitted_date, confirmed_date,
          portal_used, portal_organisation_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               COALESCE($8, 'pending'), $9, $10, $11,
               COALESCE($12, 'other_private'), $13)
       RETURNING *`,
      [clientId, registration_type, registrant_name, registrant_email,
       registrant_phone, registrant_role, ir_reference_number,
       registration_status, submitted_date, confirmed_date,
       portal_used, portal_organisation_type, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/registrations error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/registrations/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'registration_type', 'registrant_name', 'registrant_email',
      'registrant_phone', 'registrant_role', 'ir_reference_number',
      'registration_status', 'submitted_date', 'confirmed_date',
      'portal_used', 'portal_organisation_type', 'notes'
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE io_registrations SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /registrations/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/registrations/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM io_registrations WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /registrations/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Breach Incidents ───────────────────────────────────────────────────────

app.get("/api/clients/:id/breaches", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM breach_incidents
       WHERE client_id = $1
       ORDER BY incident_date DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/breaches error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients/:id/breaches", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      incident_date, reported_to_ir, ir_report_date, ir_reference_number,
      incident_type, description, data_subjects_affected,
      severity, status, remediation_notes,
      data_subjects_count
    } = req.body;

    // Compute POPIA s22 notification deadline: 72 hours from incident date
    const notificationDeadline = incident_date
      ? new Date(new Date(incident_date).getTime() + 72 * 60 * 60 * 1000).toISOString()
      : null;

    const { rows } = await pool.query(
      `INSERT INTO breach_incidents
         (client_id, incident_date, reported_to_ir, ir_report_date,
          ir_reference_number, incident_type, description,
          data_subjects_affected, severity, status, remediation_notes,
          notification_deadline, data_subjects_count)
       VALUES ($1, $2, COALESCE($3, false), $4, $5, $6, $7, $8, $9,
               COALESCE($10, 'reported'), $11, $12, $13)
       RETURNING *`,
      [clientId, incident_date, reported_to_ir, ir_report_date,
       ir_reference_number, incident_type, description,
       data_subjects_affected, severity, status, remediation_notes,
       notificationDeadline, data_subjects_count]
    );

    const breach = rows[0];

    // ─── Auto-create POPIA compliance tasks ─────────────────────────────
    // POPIA s22(1): notify the Information Regulator as soon as reasonably
    // possible (IR guidance: within 72 hours of discovery).
    // POPIA s22(4): notify affected data subjects as soon as reasonably
    // possible after notifying the IR.
    const autoTasks = [];
    const incidentLabel = incident_type || "Breach incident";

    if (incident_date) {
      // Task 1: Notify IR within 72 hours
      autoTasks.push(
        pool.query(
          `INSERT INTO compliance_tasks
             (client_id, task_type, title, description, due_date, status, assigned_to)
           VALUES ($1, 'breach_notification',
                   $2, $3, $4, 'pending', NULL)
           RETURNING *`,
          [
            clientId,
            `Notify Information Regulator — ${incidentLabel}`,
            `POPIA s22(1): notify the Information Regulator of the breach "${incidentLabel}" (${new Date(incident_date).toLocaleDateString("en-GB")}) within 72 hours. Include: nature of breach, estimated data subjects, personal data categories, recommended measures. Breach ID: ${breach.id}.`,
            notificationDeadline,
          ]
        )
      );

      // Task 2: Notify data subjects (7 days from incident as a practical deadline)
      const dsDeadline = new Date(
        new Date(incident_date).getTime() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();
      autoTasks.push(
        pool.query(
          `INSERT INTO compliance_tasks
             (client_id, task_type, title, description, due_date, status, assigned_to)
           VALUES ($1, 'breach_notification',
                   $2, $3, $4, 'pending', NULL)
           RETURNING *`,
          [
            clientId,
            `Notify affected data subjects — ${incidentLabel}`,
            `POPIA s22(4): notify affected data subjects of the breach "${incidentLabel}" as soon as reasonably possible after IR notification. Include: description of the compromise, measures taken, recommendations for mitigation. Breach ID: ${breach.id}.`,
            dsDeadline,
          ]
        )
      );
    }

    let createdTasks = [];
    if (autoTasks.length > 0) {
      try {
        const results = await Promise.all(autoTasks);
        createdTasks = results.map((r) => r.rows[0]);
      } catch (taskErr) {
        // Log but don't fail the breach creation — tasks are supplementary
        console.error("Auto-task creation warning:", taskErr.message);
      }
    }

    res.status(201).json({ ...breach, _auto_tasks: createdTasks });
  } catch (err) {
    console.error("POST /clients/:id/breaches error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/breaches/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'incident_date', 'incident_type', 'description', 'severity',
      'data_subjects_affected', 'reported_to_ir', 'ir_report_date',
      'ir_reference_number', 'status', 'remediation_notes',
      'notification_deadline', 'data_subjects_notified',
      'data_subjects_notification_date', 'data_subjects_count'
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE breach_incidents SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /breaches/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/breaches/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM breach_incidents WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /breaches/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance Tasks ───────────────────────────────────────────────────────

// All tasks (cross-client) with optional status filter
app.get("/api/tasks", async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT ct.*, cc.company_name AS client_name
                 FROM compliance_tasks ct
                 LEFT JOIN compliance_clients cc ON ct.client_id = cc.id`;
    const params = [];

    if (status) {
      query += ` WHERE ct.status = $1`;
      params.push(status);
    }
    query += ` ORDER BY ct.due_date ASC NULLS LAST, ct.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /tasks error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Tasks for a specific client
app.get("/api/clients/:id/tasks", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM compliance_tasks
       WHERE client_id = $1
       ORDER BY due_date ASC NULLS LAST, created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/tasks error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients/:id/tasks", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      task_type, title, description, due_date,
      status, assigned_to
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO compliance_tasks
         (client_id, task_type, title, description, due_date,
          status, assigned_to)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'pending'), $7)
       RETURNING *`,
      [clientId, task_type, title, description, due_date,
       status, assigned_to]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/tasks error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'title', 'description', 'due_date', 'priority',
      'status', 'assigned_to', 'completed_date', 'notes'
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE compliance_tasks SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /tasks/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM compliance_tasks WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /tasks/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Regulatory Correspondence ──────────────────────────────────────────────

// All correspondence (cross-client)
app.get("/api/correspondence", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rc.*, cc.company_name AS client_name
       FROM regulatory_correspondence rc
       LEFT JOIN compliance_clients cc ON rc.client_id = cc.id
       ORDER BY rc.received_date DESC NULLS LAST, rc.created_at DESC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /correspondence error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Correspondence for a specific client
app.get("/api/clients/:id/correspondence", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM regulatory_correspondence
       WHERE client_id = $1
       ORDER BY received_date DESC NULLS LAST, created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/correspondence error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients/:id/correspondence", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      direction, correspondent, subject, received_date,
      response_due_date, responded_date, urgency,
      document_url, status, notes
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO regulatory_correspondence
         (client_id, direction, correspondent, subject, received_date,
          response_due_date, responded_date, urgency,
          document_url, status, notes)
       VALUES ($1, $2, COALESCE($3, 'Information Regulator'), $4, $5,
               $6, $7, COALESCE($8, 'normal'), $9,
               COALESCE($10, 'received'), $11)
       RETURNING *`,
      [clientId, direction, correspondent, subject, received_date,
       response_due_date, responded_date, urgency,
       document_url, status, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/correspondence error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/correspondence/:id", async (req, res) => {
  try {
    // Whitelist mutable fields — reject anything else from the request body
    const ALLOWED_FIELDS = [
      'direction', 'correspondent', 'subject', 'received_date',
      'response_due_date', 'responded_date', 'urgency',
      'document_url', 'status', 'notes'
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE regulatory_correspondence SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /correspondence/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/correspondence/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM regulatory_correspondence WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /correspondence/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Client Management Summary ──────────────────────────────────────────────

app.get("/api/client-management/summary", async (req, res) => {
  try {
    const [engRes, taskRes, breachRes, corrRes] = await Promise.all([
      pool.query(
        `SELECT engagement_status, count(*)::text
         FROM client_engagements
         GROUP BY engagement_status
         ORDER BY engagement_status`
      ),
      pool.query(
        `SELECT count(*) AS count
         FROM compliance_tasks
         WHERE status IN ('pending', 'in_progress', 'overdue')
           AND (due_date IS NOT NULL AND due_date < CURRENT_DATE)`
      ),
      pool.query(
        `SELECT count(*) AS count
         FROM breach_incidents
         WHERE status NOT IN ('resolved', 'closed')`
      ),
      pool.query(
        `SELECT count(*) AS count
         FROM regulatory_correspondence
         WHERE status NOT IN ('responded', 'closed')`
      ),
    ]);

    res.json({
      engagements_by_status: engRes.rows,
      overdue_tasks: parseInt(taskRes.rows[0].count, 10),
      open_breaches: parseInt(breachRes.rows[0].count, 10),
      pending_correspondence: parseInt(corrRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error("GET /client-management/summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

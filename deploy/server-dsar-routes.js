/**
 * DSAR (Data Subject Access Request) routes for Cloud Run server.js
 *
 * Provides CRUD for the data_subject_requests table (migration 012).
 *
 * Endpoints:
 *  - /api/clients/:id/dsars        GET, POST
 *  - /api/dsars                    GET (all, optional ?status=)
 *  - /api/dsars/:id                GET, PUT, DELETE
 *
 * Prerequisites:
 *  - Run migration 012-data-subject-requests.sql against Cloud SQL
 */

// ─── List DSARs for a client ────────────────────────────────────────────────

app.get("/api/clients/:id/dsars", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM data_subject_requests
       WHERE client_id = $1
       ORDER BY received_date DESC, created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/dsars error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── List all DSARs (cross-client) ──────────────────────────────────────────

app.get("/api/dsars", async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let query = `SELECT d.*, c.company_name AS client_name
                 FROM data_subject_requests d
                 LEFT JOIN compliance_clients c ON c.id = d.client_id`;
    const params = [];

    if (statusFilter) {
      query += ` WHERE d.status = $1`;
      params.push(statusFilter);
    }

    query += ` ORDER BY d.received_date DESC, d.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /dsars error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get single DSAR ────────────────────────────────────────────────────────

app.get("/api/dsars/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, c.company_name AS client_name
       FROM data_subject_requests d
       LEFT JOIN compliance_clients c ON c.id = d.client_id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "DSAR not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /dsars/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Create DSAR ────────────────────────────────────────────────────────────

app.post("/api/clients/:id/dsars", async (req, res) => {
  try {
    const clientId = req.params.id;
    const {
      request_type, description,
      data_subject_name, data_subject_email, data_subject_phone,
      data_subject_id_type, data_subject_id_ref, data_subject_category,
      identity_verified,
      status, priority, assigned_to,
      received_date, acknowledged_date, deadline,
      notes
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO data_subject_requests (
        client_id, request_type, description,
        data_subject_name, data_subject_email, data_subject_phone,
        data_subject_id_type, data_subject_id_ref, data_subject_category,
        identity_verified,
        status, priority, assigned_to,
        received_date, acknowledged_date, deadline,
        notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        clientId, request_type, description || null,
        data_subject_name, data_subject_email || null, data_subject_phone || null,
        data_subject_id_type || null, data_subject_id_ref || null, data_subject_category || null,
        identity_verified || false,
        status || "received", priority || "normal", assigned_to || null,
        received_date || new Date().toISOString().slice(0, 10),
        acknowledged_date || null, deadline || null,
        notes || null
      ]
    );

    // Auto-create a compliance task for the DSAR deadline
    try {
      const dsar = rows[0];
      const deadlineDate = dsar.deadline;
      await pool.query(
        `INSERT INTO compliance_tasks (client_id, task_type, title, description, due_date, status, assigned_to)
         VALUES ($1, 'dsar_response', $2, $3, $4, 'pending', $5)`,
        [
          clientId,
          `DSAR: Respond to ${request_type} request from ${data_subject_name}`,
          `Data subject ${request_type} request received ${dsar.received_date}. Statutory deadline: ${deadlineDate}. POPIA s23-25 requires response within a reasonable time (30 days).`,
          deadlineDate,
          assigned_to || null
        ]
      );
    } catch (taskErr) {
      console.error("Auto-task creation for DSAR failed (non-fatal):", taskErr.message);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /clients/:id/dsars error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Update DSAR ────────────────────────────────────────────────────────────

const DSAR_ALLOWED_FIELDS = [
  "request_type", "description",
  "data_subject_name", "data_subject_email", "data_subject_phone",
  "data_subject_id_type", "data_subject_id_ref", "data_subject_category",
  "identity_verified",
  "status", "priority", "assigned_to",
  "received_date", "acknowledged_date", "deadline", "completed_date", "closed_date",
  "response_summary", "refusal_reason",
  "third_parties_notified", "third_party_details",
  "evidence_description", "evidence_urls",
  "notes"
];

app.put("/api/dsars/:id", async (req, res) => {
  try {
    const sets = [];
    const vals = [];
    let idx = 1;

    for (const [key, val] of Object.entries(req.body)) {
      if (DSAR_ALLOWED_FIELDS.includes(key)) {
        sets.push(`${key} = $${idx}`);
        vals.push(val);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: "No valid fields" });

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE data_subject_requests SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      vals
    );

    if (rows.length === 0) return res.status(404).json({ error: "DSAR not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /dsars/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete DSAR ────────────────────────────────────────────────────────────

app.delete("/api/dsars/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM data_subject_requests WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "DSAR not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /dsars/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

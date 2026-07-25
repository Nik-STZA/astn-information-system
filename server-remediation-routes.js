/**
 * Remediation and audit trail routes for Cloud Run server.js
 *
 * Provides CRUD for remediation_items and read-only access to audit_log.
 * Every mutation to remediation_items automatically writes an audit_log entry.
 *
 * Endpoints:
 *  - /api/clients/:id/remediation             GET (items for a client)
 *  - /api/clients/:id/remediation/generate     POST (auto-generate from assessment)
 *  - /api/remediation                          GET (all items, optional filters)
 *  - /api/remediation/:id                      GET, PUT
 *  - /api/remediation/:id/note                 POST (add a note, creates audit entry)
 *  - /api/clients/:id/audit                    GET (audit log for a client)
 *  - /api/audit                                GET (all audit entries)
 *  - /api/remediation/summary                  GET (cross-client summary stats)
 *
 * Prerequisites:
 *  - Run migration 009-remediation-audit.sql against Cloud SQL
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Write an immutable audit log entry.
 * Called internally by every mutation endpoint below.
 */
async function writeAuditLog({
  client_id = null,
  prospect_id = null,
  entity_type,
  entity_id = null,
  action,
  description,
  field_changed = null,
  old_value = null,
  new_value = null,
  performed_by = "system",
  metadata = {},
}) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (client_id, prospect_id, entity_type, entity_id, action,
          description, field_changed, old_value, new_value,
          performed_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        client_id, prospect_id, entity_type, entity_id, action,
        description, field_changed, old_value, new_value,
        performed_by, JSON.stringify(metadata),
      ]
    );
  } catch (err) {
    // Audit log failures should not break the primary operation
    console.error("audit_log write failed:", err.message);
  }
}

/** Map check_category to human-readable POPIA section references. */
const POPIA_REFS = {
  information_officer: "s55-56",
  lawful_processing: "s8-12",
  consent_mechanism: "s11",
  cross_border_transfer: "s72",
  data_subject_rights: "s23-25",
  breach_notification: "s22",
  special_categories: "s26-33",
  retention_and_purpose: "s13-14",
  security_safeguards: "s19",
  direct_marketing: "s69",
};

/** Map check_category to human-readable title. */
const CATEGORY_TITLES = {
  information_officer: "Information Officer registration",
  lawful_processing: "Lawful basis for processing",
  consent_mechanism: "Consent mechanisms",
  cross_border_transfer: "Cross-border data transfers",
  data_subject_rights: "Data subject rights",
  breach_notification: "Breach notification",
  special_categories: "Special personal information handling",
  retention_and_purpose: "Retention and purpose limitation",
  security_safeguards: "Security safeguards",
  direct_marketing: "Direct marketing compliance",
};

// ─── Remediation Items: Read ────────────────────────────────────────────────

// All remediation items (cross-client) with optional filters
app.get("/api/remediation", async (req, res) => {
  try {
    const { status, severity, client_id } = req.query;
    let query = `SELECT ri.*, cc.company_name AS client_name
                 FROM remediation_items ri
                 LEFT JOIN compliance_clients cc ON ri.client_id = cc.id`;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`ri.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (severity) {
      conditions.push(`ri.severity = $${idx}`);
      params.push(severity);
      idx++;
    }
    if (client_id) {
      conditions.push(`ri.client_id = $${idx}`);
      params.push(client_id);
      idx++;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    query += ` ORDER BY
      CASE ri.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      ri.due_date ASC NULLS LAST,
      ri.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /remediation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Remediation items for a specific client
app.get("/api/clients/:id/remediation", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM remediation_items
       WHERE client_id = $1
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         due_date ASC NULLS LAST,
         created_at DESC`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/remediation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Single remediation item
app.get("/api/remediation/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM remediation_items WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /remediation/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Remediation Items: Update ──────────────────────────────────────────────

app.put("/api/remediation/:id", async (req, res) => {
  try {
    // Fetch current state for audit trail
    const { rows: current } = await pool.query(
      "SELECT * FROM remediation_items WHERE id = $1",
      [req.params.id]
    );
    if (current.length === 0) return res.status(404).json({ error: "Not found" });
    const before = current[0];

    const fields = req.body;
    const performed_by = fields._performed_by || "nik@stza.io";
    delete fields._performed_by;

    const setClauses = [];
    const values = [];
    let idx = 1;
    const changes = [];

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at" || key === "created_by") continue;
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;

      // Track changes for audit
      if (before[key] !== undefined && String(before[key]) !== String(value)) {
        changes.push({ field: key, old: before[key], new: value });
      }
    }

    // Auto-set date fields based on status transitions
    if (fields.status === "in_progress" && before.status === "open" && !fields.started_date) {
      setClauses.push(`started_date = $${idx}`);
      values.push(new Date().toISOString().slice(0, 10));
      idx++;
    }
    if (fields.status === "resolved" && before.status !== "resolved" && !fields.resolved_date) {
      setClauses.push(`resolved_date = $${idx}`);
      values.push(new Date().toISOString().slice(0, 10));
      idx++;
    }
    if (fields.status === "verified" && before.status !== "verified" && !fields.verified_date) {
      setClauses.push(`verified_date = $${idx}`);
      values.push(new Date().toISOString().slice(0, 10));
      idx++;
      if (!fields.verified_by) {
        setClauses.push(`verified_by = $${idx}`);
        values.push(performed_by);
        idx++;
      }
    }

    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE remediation_items SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );

    // Write audit log entries for each change
    for (const change of changes) {
      const action = change.field === "status" ? "status_changed" : "updated";
      const desc =
        change.field === "status"
          ? `Remediation item "${before.title}" status changed from ${change.old} to ${change.new}`
          : `Remediation item "${before.title}" ${change.field} updated`;

      await writeAuditLog({
        client_id: before.client_id,
        prospect_id: before.prospect_id,
        entity_type: "remediation_item",
        entity_id: before.id,
        action,
        description: desc,
        field_changed: change.field,
        old_value: change.old != null ? String(change.old) : null,
        new_value: change.new != null ? String(change.new) : null,
        performed_by,
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /remediation/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Remediation Items: Add note ────────────────────────────────────────────

app.post("/api/remediation/:id/note", async (req, res) => {
  try {
    const { note, performed_by = "nik@stza.io" } = req.body;
    if (!note) return res.status(400).json({ error: "note is required" });

    const { rows } = await pool.query(
      "SELECT * FROM remediation_items WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const item = rows[0];

    await writeAuditLog({
      client_id: item.client_id,
      prospect_id: item.prospect_id,
      entity_type: "remediation_item",
      entity_id: item.id,
      action: "note_added",
      description: note,
      performed_by,
    });

    res.status(201).json({ logged: true });
  } catch (err) {
    console.error("POST /remediation/:id/note error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Remediation Items from Assessment ─────────────────────────────

app.post("/api/clients/:id/remediation/generate", async (req, res) => {
  try {
    const clientId = req.params.id;
    let { prospect_id, assessment_id, performed_by = "nik@stza.io" } = req.body;

    // GUARD (docs/compliance-engine-principles.md, Invariants 3 & 4): this legacy generator
    // resolves the client to a prospect BY COMPANY NAME, which cross-wires entities in a group
    // and produces framework-hardcoded (POPIA) items. Any client with a V2 assessment must use
    // the jurisdiction-native engine instead. Refuse here so the landmine can't be re-triggered.
    const { rows: v2 } = await pool.query(
      "SELECT 1 FROM compliance_assessments WHERE client_id = $1 LIMIT 1",
      [clientId]
    );
    if (v2.length) {
      return res.status(409).json({
        error:
          "This client uses the V2 assessment engine. Generate remediation from a specific " +
          "assessment: POST /api/v2/clients/:clientId/assessments/:assessmentId/remediation/generate",
      });
    }

    // If no prospect_id provided (or empty), look up the prospect linked to this client
    // by matching company_name
    if (!prospect_id) {
      const { rows: clientRows } = await pool.query(
        "SELECT company_name FROM compliance_clients WHERE id = $1",
        [clientId]
      );
      if (clientRows.length === 0) {
        return res.status(404).json({ error: "Client not found" });
      }
      const { rows: prospectRows } = await pool.query(
        "SELECT id FROM compliance_prospects WHERE company_name = $1 ORDER BY updated_at DESC LIMIT 1",
        [clientRows[0].company_name]
      );
      if (prospectRows.length === 0) {
        return res.status(400).json({
          error: "No prospect found matching this client. Run the prospect pipeline first.",
        });
      }
      prospect_id = prospectRows[0].id;
    }

    // Fetch findings for this prospect
    const { rows: findings } = await pool.query(
      `SELECT * FROM prospect_analysis
       WHERE prospect_id = $1
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END`,
      [prospect_id]
    );

    if (findings.length === 0) {
      return res.status(400).json({
        error: "No findings found for this prospect. Run the analysis pipeline first.",
      });
    }

    // Delete existing remediation items for this assessment (allow re-generation)
    if (assessment_id) {
      await pool.query(
        "DELETE FROM remediation_items WHERE assessment_id = $1",
        [assessment_id]
      );
    } else {
      // Delete by prospect_id if no assessment specified
      await pool.query(
        "DELETE FROM remediation_items WHERE prospect_id = $1 AND client_id = $2",
        [prospect_id, clientId]
      );
    }

    // Create one remediation item per non-compliant finding
    const created = [];
    for (const finding of findings) {
      // Skip compliant and info findings — no remediation needed
      if (finding.severity === "compliant" || finding.severity === "info") {
        continue;
      }

      const title = CATEGORY_TITLES[finding.check_category] || finding.check_category.replace(/_/g, " ");
      const popiaRef = POPIA_REFS[finding.check_category] || null;

      const { rows } = await pool.query(
        `INSERT INTO remediation_items
           (client_id, prospect_id, assessment_id, finding_id,
            category, title, description, severity, popia_reference,
            recommendation, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11)
         RETURNING *`,
        [
          clientId, prospect_id, assessment_id || null, finding.id,
          finding.check_category, title, finding.finding, finding.severity,
          popiaRef, finding.recommendation, performed_by,
        ]
      );
      created.push(rows[0]);
    }

    // Write audit log
    await writeAuditLog({
      client_id: clientId,
      prospect_id,
      entity_type: "remediation_item",
      entity_id: null,
      action: "batch_created",
      description: `Generated ${created.length} remediation items from ${findings.length} assessment findings`,
      performed_by,
      metadata: {
        assessment_id,
        total_findings: findings.length,
        items_created: created.length,
        skipped_compliant: findings.length - created.length,
      },
    });

    res.status(201).json({
      count: created.length,
      data: created,
      skipped_compliant: findings.length - created.length,
    });
  } catch (err) {
    console.error("POST /clients/:id/remediation/generate error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Audit Log: Read ────────────────────────────────────────────────────────

// All audit entries (cross-client) — newest first
app.get("/api/audit", async (req, res) => {
  try {
    const { client_id, entity_type, limit = 100 } = req.query;
    let query = `SELECT al.*, cc.company_name AS client_name
                 FROM audit_log al
                 LEFT JOIN compliance_clients cc ON al.client_id = cc.id`;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (client_id) {
      conditions.push(`al.client_id = $${idx}`);
      params.push(client_id);
      idx++;
    }
    if (entity_type) {
      conditions.push(`al.entity_type = $${idx}`);
      params.push(entity_type);
      idx++;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    query += ` ORDER BY al.performed_at DESC LIMIT $${idx}`;
    params.push(Math.min(parseInt(limit, 10) || 100, 500));

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /audit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Audit log for a specific client
app.get("/api/clients/:id/audit", async (req, res) => {
  try {
    const { limit = 200 } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM audit_log
       WHERE client_id = $1
       ORDER BY performed_at DESC
       LIMIT $2`,
      [req.params.id, Math.min(parseInt(limit, 10) || 200, 500)]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/audit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Remediation Summary ────────────────────────────────────────────────────

app.get("/api/remediation/summary", async (req, res) => {
  try {
    const [statusRes, severityRes, overdueRes, clientRes] = await Promise.all([
      pool.query(
        `SELECT status, count(*)::int AS count
         FROM remediation_items
         GROUP BY status
         ORDER BY
           CASE status
             WHEN 'open' THEN 1
             WHEN 'in_progress' THEN 2
             WHEN 'resolved' THEN 3
             WHEN 'verified' THEN 4
             WHEN 'not_applicable' THEN 5
             WHEN 'accepted_risk' THEN 6
           END`
      ),
      pool.query(
        `SELECT severity, count(*)::int AS count
         FROM remediation_items
         WHERE status IN ('open', 'in_progress')
         GROUP BY severity
         ORDER BY
           CASE severity
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             WHEN 'low' THEN 4
             ELSE 5
           END`
      ),
      pool.query(
        `SELECT count(*)::int AS count
         FROM remediation_items
         WHERE status IN ('open', 'in_progress')
           AND due_date IS NOT NULL
           AND due_date < CURRENT_DATE`
      ),
      pool.query(
        `SELECT cc.id, cc.company_name,
           count(ri.id)::int AS total_items,
           count(ri.id) FILTER (WHERE ri.status IN ('open', 'in_progress'))::int AS open_items,
           count(ri.id) FILTER (WHERE ri.status IN ('resolved', 'verified'))::int AS resolved_items
         FROM compliance_clients cc
         JOIN remediation_items ri ON ri.client_id = cc.id
         GROUP BY cc.id, cc.company_name
         ORDER BY open_items DESC`
      ),
    ]);

    res.json({
      by_status: statusRes.rows,
      open_by_severity: severityRes.rows,
      overdue_count: overdueRes.rows[0].count,
      by_client: clientRes.rows,
    });
  } catch (err) {
    console.error("GET /remediation/summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

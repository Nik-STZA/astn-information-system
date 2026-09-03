/**
 * V2 remediation board — jurisdiction-native, fed directly by the dual-model assessment engine.
 *
 * Replaces the legacy POPIA-hardcoded remediation generator for compliance clients.
 * Reads compliance_assessments / assessment_findings (the real engine) and writes the
 * app-owned compliance_remediation table (migration 023). NOTHING here names a specific
 * framework — jurisdiction_code + legal_reference carry whatever regime the assessment used,
 * so a new country appears on the board with no code change.
 * See docs/compliance-engine-principles.md (Invariants 1, 3, 4, 6).
 *
 * Endpoints:
 *  - POST /api/v2/clients/:clientId/assessments/:assessmentId/remediation/generate
 *  - GET  /api/v2/clients/:clientId/remediation                 (board, grouped-ready, w/ resolution status)
 *  - GET  /api/v2/remediation/:id
 *  - PUT  /api/v2/remediation/:id                               (status / assignment / dates)
 *  - POST /api/v2/remediation/:id/generate-resolution           (dual-model, shared lib)
 *  - GET  /api/v2/remediation/:id/resolution
 *  - PUT  /api/v2/remediation/:id/resolution                    (edit / approve)
 */

const { fetchCorpus, generateDualModelResolution } = require("./server-lib-resolution");

const SEV_ORDER = `CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`;

async function auditV2({ client_id, action, description, performed_by = "nik@stza.io", metadata = {} }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (client_id, entity_type, action, description, performed_by, metadata)
       VALUES ($1, 'compliance_remediation', $2, $3, $4, $5)`,
      [client_id, action, description, performed_by, JSON.stringify(metadata)],
    );
  } catch (err) {
    console.error("auditV2 write failed:", err.message);
  }
}

// ─── Generate remediation from a V2 assessment (jurisdiction-agnostic) ────────
app.post(
  "/api/v2/clients/:clientId/assessments/:assessmentId/remediation/generate",
  async (req, res) => {
    const { clientId, assessmentId } = req.params;
    const performed_by = req.body?.performed_by || "nik@stza.io";
    try {
      // Assessment MUST belong to this client (explicit ids only — no name matching).
      const { rows: a } = await pool.query(
        `SELECT ca.id, ca.client_id, cj.code AS jur_code, cj.short_name AS jur_name
           FROM compliance_assessments ca
           JOIN compliance_jurisdictions cj ON cj.id = ca.jurisdiction_id
          WHERE ca.id = $1 AND ca.client_id = $2`,
        [assessmentId, clientId],
      );
      if (!a.length) {
        return res.status(404).json({ error: "assessment not found for this client" });
      }
      const asmt = a[0];

      // Only 'absent' and 'partial' findings need remediation; 'present' is compliant.
      const { rows: findings } = await pool.query(
        `SELECT af.id, af.status, af.severity, af.finding_text, af.recommendation,
                req.code AS req_code, req.name AS req_name, req.legislation_ref,
                dom.code AS dom_code, dom.name AS dom_name
           FROM assessment_findings af
           LEFT JOIN compliance_requirements req ON req.id = af.requirement_id
           LEFT JOIN compliance_domains dom ON dom.id = af.domain_id
          WHERE af.assessment_id = $1 AND af.status IN ('absent', 'partial')
          ORDER BY ${SEV_ORDER}`,
        [assessmentId],
      );

      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const keptFindingIds = [];
        for (const f of findings) {
          // Upsert per (assessment, finding): regenerating refreshes the generated text but
          // PRESERVES any human status/assignment/dates already set on the item (Invariant 6).
          await conn.query(
            `INSERT INTO compliance_remediation
               (client_id, assessment_id, finding_id, jurisdiction_code, domain_code, requirement_code,
                legal_reference, category, title, description, severity, finding_status, recommendation, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (assessment_id, finding_id) WHERE finding_id IS NOT NULL
             DO UPDATE SET
               jurisdiction_code = EXCLUDED.jurisdiction_code,
               domain_code       = EXCLUDED.domain_code,
               requirement_code  = EXCLUDED.requirement_code,
               legal_reference   = EXCLUDED.legal_reference,
               category          = EXCLUDED.category,
               title             = EXCLUDED.title,
               description       = EXCLUDED.description,
               severity          = EXCLUDED.severity,
               finding_status    = EXCLUDED.finding_status,
               recommendation    = EXCLUDED.recommendation,
               updated_at        = now()`,
            [
              clientId, assessmentId, f.id, asmt.jur_code, f.dom_code, f.req_code,
              f.legislation_ref, f.dom_name, f.req_name || f.dom_name || "Remediation",
              f.finding_text, f.severity, f.status, f.recommendation, performed_by,
            ],
          );
          keptFindingIds.push(f.id);
        }
        // Drop items whose finding is no longer a gap (became compliant / removed), scoped to
        // THIS client + assessment only — never touches another entity's board.
        let removed;
        if (keptFindingIds.length) {
          const del = await conn.query(
            `DELETE FROM compliance_remediation
              WHERE client_id = $1 AND assessment_id = $2
                AND (finding_id IS NULL OR NOT (finding_id = ANY($3::int[])))`,
            [clientId, assessmentId, keptFindingIds],
          );
          removed = del.rowCount;
        } else {
          const del = await conn.query(
            `DELETE FROM compliance_remediation WHERE client_id = $1 AND assessment_id = $2`,
            [clientId, assessmentId],
          );
          removed = del.rowCount;
        }
        await conn.query("COMMIT");

        await auditV2({
          client_id: clientId,
          action: "generated_from_assessment",
          description: `Generated ${keptFindingIds.length} ${asmt.jur_name} remediation items from assessment #${assessmentId}`,
          performed_by,
          metadata: { assessment_id: +assessmentId, jurisdiction: asmt.jur_code, items: keptFindingIds.length, removed },
        });
        res.status(201).json({ count: keptFindingIds.length, removed, jurisdiction: asmt.jur_code });
      } catch (e) {
        await conn.query("ROLLBACK");
        throw e;
      } finally {
        conn.release();
      }
    } catch (err) {
      console.error("POST /v2/.../remediation/generate error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── Board for a client (all jurisdictions, resolution status attached) ───────
app.get("/api/v2/clients/:clientId/remediation", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.*, cj.short_name AS jurisdiction_name,
              rr.status AS resolution_status, rr.agreement AS resolution_agreement,
              (rr.remediation_id IS NOT NULL) AS has_resolution
         FROM compliance_remediation cr
         LEFT JOIN compliance_jurisdictions cj ON cj.code = cr.jurisdiction_code
         LEFT JOIN remediation_resolutions rr ON rr.remediation_id = cr.id
        WHERE cr.client_id = $1
        ORDER BY cj.short_name NULLS LAST, ${SEV_ORDER.replace(/severity/g, "cr.severity")}, cr.id`,
      [req.params.clientId],
    );
    // Convenience: jurisdiction summary for the board tabs.
    const byJur = {};
    for (const r of rows) {
      const k = r.jurisdiction_code || "other";
      (byJur[k] ||= { jurisdiction_code: k, jurisdiction_name: r.jurisdiction_name || k, total: 0, open: 0 });
      byJur[k].total += 1;
      if (r.status === "open" || r.status === "in_progress") byJur[k].open += 1;
    }
    res.json({ data: rows, jurisdictions: Object.values(byJur) });
  } catch (err) {
    console.error("GET /v2/clients/:id/remediation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Single item ──────────────────────────────────────────────────────────────
app.get("/api/v2/remediation/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.*, cj.short_name AS jurisdiction_name
         FROM compliance_remediation cr
         LEFT JOIN compliance_jurisdictions cj ON cj.code = cr.jurisdiction_code
        WHERE cr.id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "remediation item not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update item (status / assignment / dates / notes) ────────────────────────
app.put("/api/v2/remediation/:id", async (req, res) => {
  try {
    const { status, assigned_to, due_date, resolution_summary, verified_by, performed_by = "nik@stza.io" } = req.body || {};
    const { rows: before } = await pool.query("SELECT * FROM compliance_remediation WHERE id = $1", [req.params.id]);
    if (!before.length) return res.status(404).json({ error: "remediation item not found" });
    const { rows } = await pool.query(
      `UPDATE compliance_remediation SET
         status             = COALESCE($2, status),
         assigned_to        = COALESCE($3, assigned_to),
         due_date           = COALESCE($4, due_date),
         resolution_summary = COALESCE($5, resolution_summary),
         verified_by        = COALESCE($6, verified_by),
         started_date  = CASE WHEN $2 = 'in_progress' AND started_date  IS NULL THEN CURRENT_DATE ELSE started_date  END,
         resolved_date = CASE WHEN $2 = 'resolved'    AND resolved_date IS NULL THEN CURRENT_DATE ELSE resolved_date END,
         verified_date = CASE WHEN $2 = 'verified'    AND verified_date IS NULL THEN CURRENT_DATE ELSE verified_date END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, status, assigned_to, due_date, resolution_summary, verified_by],
    );
    if (status && status !== before[0].status) {
      await auditV2({
        client_id: before[0].client_id,
        action: "status_changed",
        description: `Remediation item "${before[0].title}" status changed from ${before[0].status} to ${status}`,
        performed_by,
        metadata: { remediation_id: +req.params.id, from: before[0].status, to: status },
      });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /v2/remediation/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Resolution: generate (dual-model, shared lib) ────────────────────────────
app.post("/api/v2/remediation/:id/generate-resolution", async (req, res) => {
  try {
    const { rows: items } = await pool.query(
      `SELECT cr.*, cj.short_name AS jurisdiction_name
         FROM compliance_remediation cr
         LEFT JOIN compliance_jurisdictions cj ON cj.code = cr.jurisdiction_code
        WHERE cr.id = $1`,
      [req.params.id],
    );
    if (!items.length) return res.status(404).json({ error: "remediation item not found" });
    const item = items[0];

    const corpus = await fetchCorpus(pool, item.client_id, item.domain_code || item.category);
    const reference = [item.jurisdiction_name, item.legal_reference].filter(Boolean).join(" ");
    const result = await generateDualModelResolution({
      title: item.title,
      reference: reference || item.jurisdiction_code,
      description: item.description,
      recommendation: item.recommendation,
      corpus,
    });

    const { rows: saved } = await pool.query(
      `INSERT INTO remediation_resolutions
         (remediation_id, resolution, status, agreement, models, generated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (remediation_id) WHERE remediation_id IS NOT NULL
       DO UPDATE SET resolution = EXCLUDED.resolution, status = EXCLUDED.status,
                     agreement = EXCLUDED.agreement, models = EXCLUDED.models,
                     generated_at = now(), updated_at = now()
       RETURNING *`,
      [item.id, result.resolutionText, result.status, result.agreement, JSON.stringify(result.models)],
    );
    res.json(saved[0]);
  } catch (err) {
    console.error("POST /v2/remediation/:id/generate-resolution error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Resolution: read ─────────────────────────────────────────────────────────
app.get("/api/v2/remediation/:id/resolution", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM remediation_resolutions WHERE remediation_id = $1",
      [req.params.id],
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Resolution: edit / approve ───────────────────────────────────────────────
app.put("/api/v2/remediation/:id/resolution", async (req, res) => {
  try {
    const { resolution, status, reviewed_by } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE remediation_resolutions
         SET resolution = COALESCE($2, resolution),
             status     = COALESCE($3, status),
             reviewed_by = COALESCE($4, reviewed_by),
             reviewed_at = CASE WHEN $3 IN ('confirmed','applied') THEN now() ELSE reviewed_at END,
             updated_at = now()
       WHERE remediation_id = $1 RETURNING *`,
      [req.params.id, resolution, status, reviewed_by],
    );
    if (!rows.length) return res.status(404).json({ error: "resolution not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /v2/remediation/:id/resolution error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Processor register + regulator registrations routes for Cloud Run server.js
 *
 * Tables (migrations 020, 021):
 *  - client_regulator_registrations  (ICO / IR / UAE Data Office / FDPIC per jurisdiction)
 *  - client_processors               (systems stock-take + DPA action tracker)
 *
 * Endpoints:
 *  - /api/clients/:id/processors                GET
 *  - /api/processors/:pid                        PUT
 *  - /api/clients/:id/regulator-registrations   GET
 *  - /api/regulator-registrations/:rid           PUT
 */

// ─── Processor register ─────────────────────────────────────────────────────

// List a client's systems/processors, most-urgent DPA state first.
app.get("/api/clients/:id/processors", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM client_processors
       WHERE client_id = $1
       ORDER BY CASE dpa_status
                  WHEN 'not_covered' THEN 0
                  WHEN 'available_unconfirmed' THEN 1
                  WHEN 'exiting' THEN 2
                  ELSE 3 END,
                category, system_name`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/processors error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update a processor's DPA status / action / notes (the review workflow).
app.put("/api/processors/:pid", async (req, res) => {
  try {
    const { dpa_status, status, action, notes, tier } = req.body;
    const { rows } = await pool.query(
      `UPDATE client_processors
       SET dpa_status = COALESCE($2, dpa_status),
           status     = COALESCE($3, status),
           action     = COALESCE($4, action),
           notes      = COALESCE($5, notes),
           tier       = COALESCE($6, tier),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.pid, dpa_status, status, action, notes, tier]
    );
    if (!rows.length) return res.status(404).json({ error: "processor not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /processors/:pid error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Regulator registrations ────────────────────────────────────────────────

app.get("/api/clients/:id/regulator-registrations", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM client_regulator_registrations
       WHERE client_id = $1
       ORDER BY jurisdiction_code, regulator`,
      [req.params.id]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /clients/:id/regulator-registrations error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/regulator-registrations/:rid", async (req, res) => {
  try {
    const { registration_number, registration_date, status, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE client_regulator_registrations
       SET registration_number = COALESCE($2, registration_number),
           registration_date   = COALESCE($3, registration_date),
           status              = COALESCE($4, status),
           notes               = COALESCE($5, notes),
           updated_at          = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.rid, registration_number, registration_date, status, notes]
    );
    if (!rows.length) return res.status(404).json({ error: "registration not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /regulator-registrations/:rid error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Listing / read routes for the Cloud Run API.
 *
 * Provides GET endpoints consumed by the Next.js dashboard:
 *
 *  Compliance module:
 *   - GET /api/compliance/prospects       — list all prospects
 *   - GET /api/compliance/clients         — list all clients
 *   - GET /api/compliance/activities      — list activities (optional ?client_id=)
 *
 *  Data-protection intelligence:
 *   - GET /api/countries                  — list all DP countries
 *   - GET /api/countries/:id              — single country with related data
 *   - GET /api/maturity                   — maturity scores (derived from dp_countries)
 *   - GET /api/enforcement                — list enforcement actions
 *
 *  BD pipeline:
 *   - GET /api/bd/pipeline                — list pipeline opportunities
 *   - GET /api/bd/interactions            — list interactions (optional ?pipeline_id=)
 *
 *  Dashboard:
 *   - GET /api/dashboard/stats            — aggregate statistics
 *   - GET /api/summary                    — summary counts for hero KPIs
 *
 * PREREQUISITES:
 *  - `pool` (pg Pool) must be defined before this file is required.
 *  - `app` (Express app) must be defined before this file is required.
 *
 * Usage in server.js:
 *   require("./server-listing-routes");
 */

// ─── Compliance: Prospects ─────────────────────────────────────────────────

app.get("/api/compliance/prospects", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM compliance_prospects ORDER BY updated_at DESC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/compliance/prospects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance: Clients ───────────────────────────────────────────────────

app.get("/api/compliance/clients", async (_req, res) => {
  try {
    // Prospect IR/pipeline data joined in via prospect_id (migration 016) so
    // the client workspace shows the same record as the compliance pipeline.
    const { rows } = await pool.query(
      `SELECT c.*,
              COALESCE(a.activity_count, 0) AS activity_count,
              p.ir_registered AS prospect_ir_registered,
              p.ir_entity_name AS prospect_ir_entity_name,
              p.ir_registration_no AS prospect_ir_registration_no,
              p.ir_registration_date AS prospect_ir_registration_date,
              p.ir_io_name AS prospect_ir_io_name,
              p.ir_io_designation AS prospect_ir_io_designation,
              p.ir_organisation_type AS prospect_ir_organisation_type,
              p.ir_verified_date AS prospect_ir_verified_date,
              p.research_status AS prospect_research_status
       FROM compliance_clients c
       LEFT JOIN compliance_prospects p ON p.id = c.prospect_id
       LEFT JOIN (
         SELECT client_id, COUNT(*) AS activity_count
         FROM compliance_activities
         GROUP BY client_id
       ) a ON a.client_id = c.id
       ORDER BY c.updated_at DESC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    // If compliance_activities doesn't exist, retry without the join
    if (err.message && err.message.includes("compliance_activities")) {
      try {
        const { rows } = await pool.query(
          `SELECT c.*, 0 AS activity_count
           FROM compliance_clients c
           ORDER BY c.updated_at DESC`
        );
        return res.json({ count: rows.length, data: rows });
      } catch (innerErr) {
        console.error("GET /api/compliance/clients fallback error:", innerErr.message);
        return res.status(500).json({ error: innerErr.message });
      }
    }
    console.error("GET /api/compliance/clients error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance: Activities ────────────────────────────────────────────────

app.get("/api/compliance/activities", async (req, res) => {
  try {
    const clientId = req.query.client_id;
    let query = `SELECT * FROM compliance_activities ORDER BY activity_date DESC`;
    const params = [];

    if (clientId) {
      query = `SELECT * FROM compliance_activities WHERE client_id = $1 ORDER BY activity_date DESC`;
      params.push(clientId);
    }

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    // Table might not exist yet
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/compliance/activities error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance: Prospect CRUD ─────────────────────────────────────────────

app.post("/api/compliance/prospects", async (req, res) => {
  try {
    const fields = req.body;
    const columns = [];
    const placeholders = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at" || key === "updated_at") continue;
      columns.push(key);
      placeholders.push(`$${idx}`);
      values.push(value);
      idx++;
    }

    if (columns.length === 0) {
      return res.status(400).json({ error: "No fields provided" });
    }

    const { rows } = await pool.query(
      `INSERT INTO compliance_prospects (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/compliance/prospects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/compliance/prospects/:id", async (req, res) => {
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE compliance_prospects SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /api/compliance/prospects/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/compliance/prospects/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM compliance_prospects WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/compliance/prospects/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance: Client CRUD ──────────────────────────────────────────────

app.post("/api/compliance/clients", async (req, res) => {
  try {
    const fields = req.body;
    const columns = [];
    const placeholders = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at" || key === "updated_at") continue;
      columns.push(key);
      placeholders.push(`$${idx}`);
      values.push(value);
      idx++;
    }

    if (columns.length === 0) {
      return res.status(400).json({ error: "No fields provided" });
    }

    const { rows } = await pool.query(
      `INSERT INTO compliance_clients (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/compliance/clients error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/compliance/clients/:id", async (req, res) => {
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
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length <= 1) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE compliance_clients SET ${setClauses.join(", ")}
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /api/compliance/clients/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance: Activity CRUD ────────────────────────────────────────────

app.post("/api/compliance/activities", async (req, res) => {
  try {
    const fields = req.body;
    const columns = [];
    const placeholders = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "created_at") continue;
      columns.push(key);
      placeholders.push(`$${idx}`);
      values.push(value);
      idx++;
    }

    if (columns.length === 0) {
      return res.status(400).json({ error: "No fields provided" });
    }

    const { rows } = await pool.query(
      `INSERT INTO compliance_activities (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    // Table might not exist yet
    if (err.message && err.message.includes("does not exist")) {
      return res.status(500).json({ error: "compliance_activities table does not exist. Run migration first." });
    }
    console.error("POST /api/compliance/activities error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Data Protection: Countries ────────────────────────────────────────────

app.get("/api/countries", async (_req, res) => {
  try {
    // Latest maturity score per country joined in — the frontend Country type
    // expects overall_score, tier, and methodology_version on each row.
    const { rows } = await pool.query(
      `SELECT c.*, m.overall_score, m.tier, m.methodology_version
       FROM dp_countries c
       LEFT JOIN LATERAL (
         SELECT overall_score, tier, methodology_version
         FROM dp_maturity_scores
         WHERE country_id = c.id
         ORDER BY score_date DESC
         LIMIT 1
       ) m ON true
       ORDER BY c.country_name`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    // Table might not exist yet
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/countries error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/countries/:id", async (req, res) => {
  try {
    const { rows: countryRows } = await pool.query(
      `SELECT * FROM dp_countries WHERE id = $1`,
      [req.params.id]
    );
    if (countryRows.length === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    const country = countryRows[0];

    // Enforcement actions for this country
    let enforcementActions = [];
    try {
      const { rows } = await pool.query(
        `SELECT e.*, c.country_name
         FROM dp_enforcement_actions e
         JOIN dp_countries c ON c.id = e.country_id
         WHERE e.country_id = $1
         ORDER BY e.action_date DESC`,
        [req.params.id]
      );
      enforcementActions = rows;
    } catch (_) { /* table may not exist */ }

    // Maturity score history for this country
    let maturityScores = [];
    try {
      const { rows } = await pool.query(
        `SELECT * FROM dp_maturity_scores WHERE country_id = $1 ORDER BY score_date DESC`,
        [req.params.id]
      );
      maturityScores = rows;
    } catch (_) { /* table may not exist */ }

    // Organisation count from Supabase would need a separate call;
    // return 0 as a placeholder — the dashboard uses Supabase directly for org counts.
    res.json({
      ...country,
      enforcement_actions: enforcementActions,
      organization_count: 0,
      maturity_scores: maturityScores,
    });
  } catch (err) {
    console.error("GET /api/countries/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Data Protection: Maturity ─────────────────────────────────────────────

app.get("/api/maturity", async (_req, res) => {
  try {
    // Maturity dimensions live on dp_maturity_scores (latest score per country),
    // country descriptors on dp_countries.
    const { rows } = await pool.query(
      `SELECT c.country_name, c.iso_code, c.has_dp_law, c.law_status,
              c.authority_name,
              m.overall_score, m.tier,
              m.regulatory_maturity, m.enforcement_activity,
              m.business_friendliness, m.cross_border_complexity,
              m.children_protections
       FROM dp_countries c
       LEFT JOIN LATERAL (
         SELECT * FROM dp_maturity_scores
         WHERE country_id = c.id
         ORDER BY score_date DESC
         LIMIT 1
       ) m ON true
       ORDER BY m.overall_score DESC NULLS LAST, c.country_name`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/maturity error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Data Protection: Enforcement ──────────────────────────────────────────

app.get("/api/enforcement", async (_req, res) => {
  try {
    // Table is dp_enforcement_actions; country_name joined in for display.
    const { rows } = await pool.query(
      `SELECT e.*, c.country_name
       FROM dp_enforcement_actions e
       JOIN dp_countries c ON c.id = e.country_id
       ORDER BY e.action_date DESC NULLS LAST`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/enforcement error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Engine ────────────────────────────────────────────────────────
// Consumed by /content pages via src/lib/data/content.ts.

app.get("/api/content/editions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, c.country_name
       FROM content_editions e
       LEFT JOIN dp_countries c ON c.id = e.country_id
       ORDER BY e.edition_number`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/content/editions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/content/weekly-reports", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM weekly_reports ORDER BY created_at DESC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/content/weekly-reports error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/content/editions", async (req, res) => {
  try {
    const allowed = [
      "series", "edition_number", "country_id", "title", "subtitle",
      "status", "target_publish_date", "actual_publish_date",
      "file_path", "word_count",
    ];
    const cols = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        cols.push(key);
        values.push(req.body[key]);
      }
    }
    if (cols.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await pool.query(
      `INSERT INTO content_editions (${cols.join(", ")})
       VALUES (${placeholders.join(", ")}) RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/content/editions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/content/editions/:id", async (req, res) => {
  try {
    const allowed = [
      "series", "edition_number", "country_id", "title", "subtitle",
      "status", "target_publish_date", "actual_publish_date",
      "file_path", "word_count",
    ];
    const setClauses = [];
    const values = [];
    let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        setClauses.push(`${key} = $${idx}`);
        values.push(req.body[key]);
        idx += 1;
      }
    }
    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE content_editions SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /api/content/editions/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BD Pipeline ───────────────────────────────────────────────────────────

app.get("/api/bd/pipeline", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              cp.company_name AS prospect_name,
              cc.company_name AS client_name
       FROM bd_pipeline p
       LEFT JOIN compliance_prospects cp ON cp.id::text = p.prospect_id::text
       LEFT JOIN compliance_clients cc ON cc.id = p.client_id
       ORDER BY p.updated_at DESC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/bd/pipeline error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/bd/interactions", async (req, res) => {
  try {
    const pipelineId = req.query.pipeline_id;
    let query = `SELECT * FROM bd_interactions ORDER BY interaction_date DESC`;
    const params = [];

    if (pipelineId) {
      query = `SELECT * FROM bd_interactions WHERE pipeline_id = $1 ORDER BY interaction_date DESC`;
      params.push(pipelineId);
    }

    const { rows } = await pool.query(query, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    if (err.message && err.message.includes("does not exist")) {
      return res.json({ count: 0, data: [] });
    }
    console.error("GET /api/bd/interactions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const BD_PIPELINE_FIELDS = [
  "prospect_id", "client_id", "opportunity_name", "service_type", "stage",
  "value_gbp", "value_recurring", "expected_close_date", "actual_close_date",
  "loss_reason", "owner", "notes",
];

app.post("/api/bd/pipeline", async (req, res) => {
  try {
    const cols = [];
    const values = [];
    for (const key of BD_PIPELINE_FIELDS) {
      if (req.body[key] !== undefined) {
        cols.push(key);
        values.push(req.body[key]);
      }
    }
    if (cols.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await pool.query(
      `INSERT INTO bd_pipeline (${cols.join(", ")})
       VALUES (${placeholders.join(", ")}) RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/bd/pipeline error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/bd/pipeline/:id", async (req, res) => {
  try {
    const setClauses = [];
    const values = [];
    let idx = 1;
    for (const key of BD_PIPELINE_FIELDS) {
      if (req.body[key] !== undefined) {
        setClauses.push(`${key} = $${idx}`);
        values.push(req.body[key]);
        idx += 1;
      }
    }
    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE bd_pipeline SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /api/bd/pipeline/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bd/interactions", async (req, res) => {
  try {
    const allowed = [
      "pipeline_id", "prospect_id", "interaction_date", "channel",
      "direction", "summary", "next_action", "next_action_date",
    ];
    const cols = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        cols.push(key);
        values.push(req.body[key]);
      }
    }
    if (cols.length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await pool.query(
      `INSERT INTO bd_interactions (${cols.join(", ")})
       VALUES (${placeholders.join(", ")}) RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/bd/interactions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard: Stats ──────────────────────────────────────────────────────

app.get("/api/dashboard/stats", async (_req, res) => {
  try {
    // Prospects
    const prospectStats = { total: 0, high_priority: 0, identified: 0, contacted: 0, responded: 0, converted: 0 };
    const prospectsBySector = [];
    const prospectsByStatus = [];

    try {
      const { rows: pRows } = await pool.query(`SELECT count(*) AS total FROM compliance_prospects`);
      prospectStats.total = Number(pRows[0].total);

      const { rows: hpRows } = await pool.query(
        `SELECT count(*) AS c FROM compliance_prospects WHERE priority = 'High'`
      );
      prospectStats.high_priority = Number(hpRows[0].c);

      const { rows: statusRows } = await pool.query(
        `SELECT outreach_status, count(*)::int AS count
         FROM compliance_prospects
         GROUP BY outreach_status`
      );
      for (const r of statusRows) {
        prospectsByStatus.push(r);
        const s = (r.outreach_status || "").toLowerCase();
        if (s === "identified") prospectStats.identified = r.count;
        else if (s === "contacted") prospectStats.contacted = r.count;
        else if (s === "responded") prospectStats.responded = r.count;
        else if (s === "converted") prospectStats.converted = r.count;
      }

      const { rows: sectorRows } = await pool.query(
        `SELECT sector, count(*)::int AS count
         FROM compliance_prospects
         WHERE sector IS NOT NULL
         GROUP BY sector
         ORDER BY count DESC`
      );
      prospectsBySector.push(...sectorRows);
    } catch (_) { /* table may not exist */ }

    // Clients
    const clientStats = { total: 0, active: 0, arr: 0 };
    try {
      const { rows } = await pool.query(`SELECT count(*) AS total FROM compliance_clients`);
      clientStats.total = Number(rows[0].total);

      const { rows: activeRows } = await pool.query(
        `SELECT count(*) AS c FROM compliance_clients WHERE status = 'active'`
      );
      clientStats.active = Number(activeRows[0].c);

      const { rows: arrRows } = await pool.query(
        `SELECT COALESCE(SUM(annual_fee_gbp), 0) AS arr
         FROM compliance_clients
         WHERE status = 'active'`
      );
      clientStats.arr = Number(arrRows[0].arr);
    } catch (_) { /* table may not exist */ }

    // Pipeline
    const pipelineStats = { total: 0, total_value: 0, active_value: 0, won: 0 };
    try {
      const { rows } = await pool.query(
        `SELECT count(*) AS total,
                COALESCE(SUM(value_gbp), 0) AS total_value
         FROM bd_pipeline`
      );
      pipelineStats.total = Number(rows[0].total);
      pipelineStats.total_value = Number(rows[0].total_value);

      const { rows: wonRows } = await pool.query(
        `SELECT count(*) AS c, COALESCE(SUM(value_gbp), 0) AS v
         FROM bd_pipeline WHERE stage = 'won'`
      );
      pipelineStats.won = Number(wonRows[0].c);

      const { rows: activeRows } = await pool.query(
        `SELECT COALESCE(SUM(value_gbp), 0) AS v
         FROM bd_pipeline WHERE stage NOT IN ('won', 'lost', 'abandoned')`
      );
      pipelineStats.active_value = Number(activeRows[0].v);
    } catch (_) { /* table may not exist */ }

    // Content
    const contentStats = { total: 0, published: 0, in_progress: 0 };
    try {
      const { rows } = await pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE status = 'published') AS published,
                count(*) FILTER (WHERE status = 'in_progress') AS in_progress
         FROM content_editions`
      );
      contentStats.total = Number(rows[0].total);
      contentStats.published = Number(rows[0].published);
      contentStats.in_progress = Number(rows[0].in_progress);
    } catch (_) { /* table may not exist */ }

    res.json({
      prospects: prospectStats,
      clients: clientStats,
      pipeline: pipelineStats,
      content: contentStats,
      prospectsByStatus,
      prospectsBySector,
    });
  } catch (err) {
    console.error("GET /api/dashboard/stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard: Summary ────────────────────────────────────────────────────

app.get("/api/summary", async (_req, res) => {
  try {
    const counts = {
      countries: 0,
      organizations: 0,
      partners: 0,
      classified_items: 0,
      enforcement_actions: 0,
      weekly_reports: 0,
      prospects: 0,
      clients: 0,
      pipeline_opportunities: 0,
      content_editions: 0,
    };

    // Each query is wrapped so a missing table doesn't kill the whole endpoint
    const queries = [
      { key: "countries", sql: `SELECT count(*) AS c FROM dp_countries` },
      { key: "enforcement_actions", sql: `SELECT count(*) AS c FROM dp_enforcement_actions` },
      { key: "prospects", sql: `SELECT count(*) AS c FROM compliance_prospects` },
      { key: "clients", sql: `SELECT count(*) AS c FROM compliance_clients` },
      { key: "pipeline_opportunities", sql: `SELECT count(*) AS c FROM bd_pipeline` },
      { key: "content_editions", sql: `SELECT count(*) AS c FROM content_editions` },
      { key: "classified_items", sql: `SELECT count(*) AS c FROM classified_items` },
    ];

    for (const q of queries) {
      try {
        const { rows } = await pool.query(q.sql);
        counts[q.key] = Number(rows[0].c);
      } catch (_) { /* table may not exist */ }
    }

    res.json({
      version: "1.0.0",
      stats: counts,
    });
  } catch (err) {
    console.error("GET /api/summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

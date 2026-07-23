/**
 * Registry, overview, news, and DP content routes — serves the tables migrated
 * from Supabase to Cloud SQL (organizations, organization_changes, partnerships,
 * classified_items, dp_jurisdictions, dp_editions).
 *
 * References the global `app` and `pool` set up by server.js.
 */

// Fields the registry edit form may write. Mirrors EDITABLE_FIELDS in
// src/lib/data/registry-shared.ts — keep in sync.
const ORG_EDITABLE_FIELDS = [
  "organization_type", "status", "organization_website", "contact_email",
  "contact_phone", "social_media", "notes", "tags", "partnership_type",
  "commercial_priority", "outreach_candidate", "next_action", "owner",
  "review_date", "astn_vertical", "source_confidence", "verification_source",
  "verification_source_primary", "verification_source_xref",
  "verification_source_label", "verification_date",
];

const ORG_SORT_FIELDS = [
  "organization_name", "country", "sport", "organization_type", "source_confidence",
];

// Build WHERE clauses for the registry filters. Mutates params; returns SQL fragments.
function orgFilterClauses(q, params) {
  const where = [];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`organization_name ILIKE $${params.length}`);
  }
  if (q.country) {
    params.push(q.country);
    where.push(`country = $${params.length}`);
  }
  if (q.sport) {
    params.push(q.sport);
    where.push(`sport = $${params.length}`);
  }
  if (q.type) {
    params.push(q.type);
    where.push(`organization_type = $${params.length}`);
  }
  if (q.confidence) {
    // source_confidence holds descriptive strings — band match is by prefix.
    // "Medium" must exclude "Medium-Low".
    if (q.confidence === "Medium") {
      where.push(`source_confidence ILIKE 'Medium%' AND source_confidence NOT ILIKE 'Medium-Low%'`);
    } else if (["High", "Medium-Low", "Low"].includes(q.confidence)) {
      where.push(`source_confidence ILIKE '${q.confidence}%'`);
    }
  }
  if (q.verify === "1" || q.verify === "true") {
    where.push(`(source_confidence IS NULL OR source_confidence NOT ILIKE 'High%')`);
  }
  return where;
}

// ─── Registry: organizations ───────────────────────────────────────────────

app.get("/api/organizations/facets", async (_req, res) => {
  try {
    const [countries, sports, types] = await Promise.all([
      pool.query(`SELECT DISTINCT country AS v FROM organizations WHERE country IS NOT NULL AND country <> '' ORDER BY country`),
      pool.query(`SELECT DISTINCT sport AS v FROM organizations WHERE sport IS NOT NULL AND sport <> '' ORDER BY sport`),
      pool.query(`SELECT DISTINCT organization_type AS v FROM organizations WHERE organization_type IS NOT NULL AND organization_type <> '' ORDER BY organization_type`),
    ]);
    res.json({
      countries: countries.rows.map((r) => r.v),
      sports: sports.rows.map((r) => r.v),
      types: types.rows.map((r) => r.v),
    });
  } catch (err) {
    console.error("GET /api/organizations/facets error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/organizations/verify-count", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM organizations
       WHERE source_confidence IS NULL OR source_confidence NOT ILIKE 'High%'`
    );
    res.json({ count: rows[0].n });
  } catch (err) {
    console.error("GET /api/organizations/verify-count error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bulk export — full rows matching the filters (used by /registry/export docx).
app.get("/api/organizations/export", async (req, res) => {
  try {
    const params = [];
    const where = orgFilterClauses(req.query, params);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT * FROM organizations ${whereSql}
       ORDER BY organization_name ASC, id ASC`,
      params
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/organizations/export error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/organizations", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size || "50", 10)));
    const sort = ORG_SORT_FIELDS.includes(req.query.sort) ? req.query.sort : "organization_name";
    const dir = req.query.dir === "desc" ? "DESC" : "ASC";

    const params = [];
    const where = orgFilterClauses(req.query, params);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT id, organization_name, country, country_iso, sport,
              organization_type, source_confidence,
              count(*) OVER()::int AS __total
       FROM organizations ${whereSql}
       ORDER BY ${sort} ${dir} NULLS LAST, id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = rows.length > 0 ? rows[0].__total : 0;
    res.json({
      count: total,
      data: rows.map(({ __total, ...r }) => r),
    });
  } catch (err) {
    console.error("GET /api/organizations error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/organizations/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM organizations WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/organizations/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update an organization. Only ORG_EDITABLE_FIELDS are written. The audit log
// row is produced by the organizations_audit trigger; the acting user's email
// is passed via the app.user_email session setting (set in-transaction).
app.put("/api/organizations/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const fields = req.body && typeof req.body.fields === "object" ? req.body.fields : {};
    const changedBy = typeof req.body.changed_by === "string" ? req.body.changed_by : "system";

    const setClauses = [];
    const values = [];
    for (const key of ORG_EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        values.push(fields[key]);
        setClauses.push(`"${key}" = $${values.length}`);
      }
    }
    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No editable fields provided" });
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_email', $1, true)`, [changedBy]);
    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE organizations SET ${setClauses.join(", ")}
       WHERE id = $${values.length} RETURNING id`,
      values
    );
    await client.query("COMMIT");

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ id: rows[0].id, updated: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /api/organizations/:id error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/organizations/:id/changes", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const { rows } = await pool.query(
      `SELECT id, changed_by, changed_at, diff
       FROM organization_changes
       WHERE org_id = $1
       ORDER BY changed_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/organizations/:id/changes error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Overview metrics ──────────────────────────────────────────────────────

app.get("/api/overview/metrics", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM organizations) AS total_organisations,
        (SELECT count(DISTINCT country_iso)::int FROM organizations WHERE country_iso IS NOT NULL) AS total_countries,
        (SELECT count(DISTINCT sport_code)::int FROM organizations WHERE sport_code IS NOT NULL) AS total_sports,
        (SELECT count(*)::int FROM organizations WHERE source_confidence ILIKE 'High%') AS high_count,
        (SELECT count(*)::int FROM partnerships) AS total_partnerships,
        (SELECT count(*)::int FROM classified_items WHERE created_at >= NOW() - INTERVAL '7 days') AS items_this_week
    `);
    const m = rows[0];
    const pct = m.total_organisations > 0
      ? Math.round((m.high_count / m.total_organisations) * 1000) / 10
      : 0;
    res.json({
      totalOrganisations: m.total_organisations,
      totalCountries: m.total_countries,
      totalSports: m.total_sports,
      highConfidencePercent: pct,
      totalPartnerships: m.total_partnerships,
      itemsThisWeek: m.items_this_week,
    });
  } catch (err) {
    console.error("GET /api/overview/metrics error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/overview/top-countries", async (req, res) => {
  try {
    const limit = Math.min(55, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const { rows } = await pool.query(
      `SELECT country, count(*)::int AS count FROM organizations
       WHERE country IS NOT NULL AND country <> ''
       GROUP BY country ORDER BY count DESC LIMIT $1`,
      [limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/overview/top-countries error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/overview/top-types", async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const { rows } = await pool.query(
      `SELECT organization_type AS type, count(*)::int AS count FROM organizations
       WHERE organization_type IS NOT NULL AND organization_type <> ''
       GROUP BY organization_type ORDER BY count DESC LIMIT $1`,
      [limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/overview/top-types error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── News feed (classified_items) ──────────────────────────────────────────

app.get("/api/news/recent", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "15", 10)));
    const { rows } = await pool.query(
      `SELECT id, title, source_name, created_at, verticals, source_url, original_language
       FROM classified_items
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/news/recent error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── News review queue (editorial gate — replaces the Notion review loop) ──

app.get("/api/news/review-queue", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "25", 10)));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
    const status = ["pending_review", "approved", "rejected"].includes(req.query.status)
      ? req.query.status
      : "pending_review";
    // Defaults mirror the old Notion candidate view: the brief generator's
    // relevance floor (0.4), a rolling window, and relevance-first ordering.
    // Pass min_score=0 / days=0 / sort=newest to see the raw table.
    const minScore = req.query.min_score !== undefined ? parseFloat(req.query.min_score) : 0;
    const days = req.query.days !== undefined ? Math.max(0, parseInt(req.query.days, 10) || 0) : 0;
    const orderBy = req.query.sort === "relevance"
      ? "relevance_score DESC NULLS LAST, created_at DESC"
      : "created_at DESC";
    const params = [status, minScore, days, limit, offset];
    const { rows } = await pool.query(
      `SELECT id, title, summary, source_name, source_url, url, category, region,
              relevance_score, confidence, verticals, original_language, created_at, status,
              count(*) OVER()::int AS __total
       FROM classified_items
       WHERE status = $1 AND (is_duplicate IS NOT TRUE)
         AND ($2::float = 0 OR relevance_score >= $2::float)
         AND ($3::int = 0 OR created_at >= NOW() - ($3::int || ' days')::interval)
       ORDER BY ${orderBy}
       LIMIT $4 OFFSET $5`,
      params
    );
    const total = rows.length > 0 ? rows[0].__total : 0;
    res.json({ count: total, data: rows.map(({ __total, ...r }) => r) });
  } catch (err) {
    console.error("GET /api/news/review-queue error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/news/review-stats", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        count(*) FILTER (WHERE status = 'pending_review' AND is_duplicate IS NOT TRUE)::int AS pending,
        count(*) FILTER (WHERE status = 'approved')::int AS approved,
        count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        count(*) FILTER (WHERE status = 'pending_review' AND is_duplicate IS NOT TRUE
                         AND created_at >= NOW() - INTERVAL '7 days')::int AS pending_this_week
      FROM classified_items
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/news/review-stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Full detail for one item: the stored article text (raw_items), the
// classifier's reasoning, and any translation — so review can happen without
// leaving the OS.
app.get("/api/news/items/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.summary, c.category, c.region, c.relevance_score,
              c.confidence, c.verticals, c.original_language, c.translated_text,
              c.gemini_reasoning, c.source_name, c.source_url, c.url, c.created_at,
              c.status, r.snippet, r.content, r.published_at
       FROM classified_items c
       LEFT JOIN raw_items r ON r.id = c.raw_item_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const row = rows[0];
    // Cap article text — review needs the substance, not 100KB of scraped page
    if (row.content && row.content.length > 12000) {
      row.content = row.content.slice(0, 12000) + "\n\n[… truncated for review]";
    }
    res.json(row);
  } catch (err) {
    console.error("GET /api/news/items/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approve or reject an item. Writes the approvals audit row and updates the
// item's status (and title/summary when edited) so the research agent's
// report generation can gate on database approvals instead of Notion.
app.post("/api/news/items/:id/review", async (req, res) => {
  const client = await pool.connect();
  try {
    const { action, edited_title, edited_summary, edited_category, decision_reason, reviewed_by } = req.body || {};
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }
    const status = action === "approve" ? "approved" : "rejected";

    await client.query("BEGIN");

    const sets = ["status = $1"];
    const vals = [status];
    if (edited_title) { vals.push(edited_title); sets.push(`title = $${vals.length}`); }
    if (edited_summary) { vals.push(edited_summary); sets.push(`summary = $${vals.length}`); }
    if (edited_category) { vals.push(edited_category); sets.push(`category = $${vals.length}`); }
    vals.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE classified_items SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING id`,
      vals
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item not found" });
    }

    await client.query(
      `INSERT INTO approvals (classified_item_id, status, decision_reason,
                              edited_title, edited_summary, edited_category, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.params.id, status, decision_reason ?? null, edited_title ?? null,
       edited_summary ?? null, edited_category ?? null, reviewed_by ?? "nik@stza.io"]
    );

    await client.query("COMMIT");
    res.json({ id: rows[0].id, status });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /api/news/items/:id/review error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Content pipeline triggers (research-agent workflows via GitHub API) ───
// The agent's generation steps run as GitHub Actions in
// Nik-STZA/africanstn-research-agent; these routes make them OS buttons.
// Requires GH_DISPATCH_TOKEN (fine-grained PAT, Actions read+write on that
// repo) in the environment via Secret Manager.

const AGENT_REPO = "Nik-STZA/africanstn-research-agent";
const AGENT_WORKFLOWS = {
  "generate-report": "generate-report.yml",
  "fetch-classify": "digest.yml",
  "generate-newsletter": "generate-newsletter.yml",
  "generate-linkedin": "generate-weekly-linkedin.yml",
};

function ghHeaders() {
  return {
    "Authorization": `Bearer ${(process.env.GH_DISPATCH_TOKEN || "").trim()}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "stza-os",
  };
}

app.post("/api/content/run-workflow", async (req, res) => {
  try {
    if (!process.env.GH_DISPATCH_TOKEN || process.env.GH_DISPATCH_TOKEN.trim() === "unset") {
      return res.status(503).json({ error: "GitHub dispatch token not configured (GH_DISPATCH_TOKEN)" });
    }
    const file = AGENT_WORKFLOWS[req.body && req.body.workflow];
    if (!file) {
      return res.status(400).json({ error: `workflow must be one of: ${Object.keys(AGENT_WORKFLOWS).join(", ")}` });
    }
    const r = await fetch(
      `https://api.github.com/repos/${AGENT_REPO}/actions/workflows/${file}/dispatches`,
      { method: "POST", headers: ghHeaders(), body: JSON.stringify({ ref: "main" }) }
    );
    if (r.status !== 204) {
      const body = await r.text();
      return res.status(502).json({ error: `GitHub dispatch failed (${r.status}): ${body.slice(0, 200)}` });
    }
    res.json({ dispatched: true, workflow: req.body.workflow });
  } catch (err) {
    console.error("POST /api/content/run-workflow error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/content/workflow-status", async (req, res) => {
  try {
    if (!process.env.GH_DISPATCH_TOKEN || process.env.GH_DISPATCH_TOKEN.trim() === "unset") {
      return res.status(503).json({ error: "GitHub dispatch token not configured (GH_DISPATCH_TOKEN)" });
    }
    const file = AGENT_WORKFLOWS[req.query.workflow];
    if (!file) {
      return res.status(400).json({ error: `workflow must be one of: ${Object.keys(AGENT_WORKFLOWS).join(", ")}` });
    }
    const r = await fetch(
      `https://api.github.com/repos/${AGENT_REPO}/actions/workflows/${file}/runs?per_page=1`,
      { headers: ghHeaders() }
    );
    const body = await r.json();
    const run = body.workflow_runs && body.workflow_runs[0];
    if (!run) return res.json({ status: "never_run" });
    res.json({
      status: run.status,               // queued | in_progress | completed
      conclusion: run.conclusion,       // success | failure | null
      started_at: run.run_started_at,
      html_url: run.html_url,
    });
  } catch (err) {
    console.error("GET /api/content/workflow-status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DP jurisdictions (migrated dp_jurisdictions table) ────────────────────

app.get("/api/dp/jurisdictions/metrics", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE has_comprehensive_law)::int AS with_law,
             count(*) FILTER (WHERE authority_operational)::int AS with_dpa
      FROM dp_jurisdictions
    `);
    res.json({
      total: rows[0].total,
      withComprehensiveLaw: rows[0].with_law,
      withOperationalDpa: rows[0].with_dpa,
    });
  } catch (err) {
    console.error("GET /api/dp/jurisdictions/metrics error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dp/jurisdictions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, jurisdiction_id, country_name, country_iso, region, law_name,
              law_year, has_comprehensive_law, authority_name, authority_acronym,
              authority_operational, malabo_status
       FROM dp_jurisdictions ORDER BY country_name ASC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/dp/jurisdictions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dp/jurisdictions/:jurisdictionId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM dp_jurisdictions WHERE jurisdiction_id = $1`,
      [req.params.jurisdictionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/dp/jurisdictions/:jurisdictionId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DP editions (migrated dp_editions table) ──────────────────────────────

app.get("/api/dp/editions/metrics", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'published')::int AS published
      FROM dp_editions
    `);
    res.json({ total: rows[0].total, published: rows[0].published });
  } catch (err) {
    console.error("GET /api/dp/editions/metrics error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dp/editions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, edition_number, country_name, country_iso, jurisdiction_id,
              phase, week_number, status, title, hook_text, word_count,
              published_at, created_at
       FROM dp_editions ORDER BY edition_number ASC`
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/dp/editions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dp/editions/:editionNumber", async (req, res) => {
  try {
    const n = parseInt(req.params.editionNumber, 10);
    if (Number.isNaN(n)) return res.status(400).json({ error: "Invalid edition number" });
    const { rows } = await pool.query(
      `SELECT * FROM dp_editions WHERE edition_number = $1`,
      [n]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/dp/editions/:editionNumber error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Content Pipeline Routes
 *
 * Handles:
 *   GET  /api/content/sources          — list content sources (with filters)
 *   GET  /api/content/items            — list classified items (with filters)
 *   GET  /api/content/items/stats      — counts by status
 *   PATCH /api/content/items/:id       — approve/reject an item
 *   POST /api/content/items/bulk       — bulk approve/reject
 *   POST /api/content/ingest           — trigger an ingestion run
 *   GET  /api/content/runs             — list recent ingestion runs
 *
 * Globals: app, pool (set by server.js)
 */

const crypto = require("crypto");

// ─── Helpers ──────────────────────────────────────────────────────────────

function contentHash(url, title) {
  return crypto
    .createHash("sha256")
    .update(`${url || ""}::${title || ""}`)
    .digest("hex");
}

/**
 * Parse an RSS feed XML string and return an array of items.
 * Deliberately simple — no external XML parser dependency.
 */
function parseRSS(xml) {
  const items = [];
  // Match both <item> (RSS 2.0) and <entry> (Atom)
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      // Handle both <tag>value</tag> and <tag attr="val">value</tag>
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : null;
    };

    const getAttr = (tag, attr) => {
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
      return m ? m[1].trim() : null;
    };

    const title = getTag("title");
    // Atom uses <link href="..."/>, RSS uses <link>url</link>
    const link = getTag("link") || getAttr("link", "href");
    const description = getTag("description") || getTag("summary") || getTag("content");
    const pubDate = getTag("pubDate") || getTag("published") || getTag("updated");

    if (title) {
      items.push({
        title: title.replace(/<[^>]+>/g, "").trim(),
        url: link ? link.replace(/<[^>]+>/g, "").trim() : null,
        summary: description
          ? description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
          : null,
        publishedAt: pubDate || null,
      });
    }
  }

  return items;
}

// ─── GET /api/content/sources ─────────────────────────────────────────────

app.get("/api/content/sources", async (req, res) => {
  try {
    const { active, category, source_type, priority } = req.query;
    let sql = `SELECT * FROM content_sources WHERE 1=1`;
    const params = [];

    if (active !== undefined) {
      params.push(active === "true");
      sql += ` AND active = $${params.length}`;
    }
    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }
    if (source_type) {
      params.push(source_type);
      sql += ` AND source_type = $${params.length}`;
    }
    if (priority) {
      params.push(priority);
      sql += ` AND priority = $${params.length}`;
    }

    sql += ` ORDER BY priority ASC, source_name ASC`;

    const { rows } = await pool.query(sql, params);
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/content/sources error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/content/items ───────────────────────────────────────────────

app.get("/api/content/items", async (req, res) => {
  try {
    const { status, category, source_id, days, limit, offset, sort } = req.query;
    let sql = `SELECT ci.*, cs.source_name AS source_display_name
               FROM classified_items ci
               LEFT JOIN content_sources cs ON ci.source_id = cs.id
               WHERE 1=1`;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` AND ci.status = $${params.length}`;
    }
    if (category) {
      params.push(category);
      sql += ` AND ci.category = $${params.length}`;
    }
    if (source_id) {
      params.push(parseInt(source_id));
      sql += ` AND ci.source_id = $${params.length}`;
    }
    if (days) {
      params.push(parseInt(days));
      sql += ` AND ci.created_at > now() - ($${params.length} || ' days')::interval`;
    }

    const sortCol = sort === "relevance" ? "ci.relevance_score DESC" : "ci.created_at DESC";
    sql += ` ORDER BY ${sortCol}`;

    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;
    params.push(lim);
    sql += ` LIMIT $${params.length}`;
    params.push(off);
    sql += ` OFFSET $${params.length}`;

    const { rows } = await pool.query(sql, params);

    // Also get total count for pagination
    let countSql = `SELECT count(*) AS total FROM classified_items ci WHERE 1=1`;
    const countParams = [];
    if (status) {
      countParams.push(status);
      countSql += ` AND ci.status = $${countParams.length}`;
    }
    if (category) {
      countParams.push(category);
      countSql += ` AND ci.category = $${countParams.length}`;
    }
    if (days) {
      countParams.push(parseInt(days));
      countSql += ` AND ci.created_at > now() - ($${countParams.length} || ' days')::interval`;
    }

    const { rows: countRows } = await pool.query(countSql, countParams);

    res.json({
      total: parseInt(countRows[0].total),
      count: rows.length,
      offset: off,
      data: rows,
    });
  } catch (err) {
    console.error("GET /api/content/items error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/content/items/stats ─────────────────────────────────────────

app.get("/api/content/items/stats", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        count(*) FILTER (WHERE status = 'pending') AS pending,
        count(*) FILTER (WHERE status = 'approved') AS approved,
        count(*) FILTER (WHERE status = 'rejected') AS rejected,
        count(*) FILTER (WHERE status = 'published') AS published,
        count(*) AS total,
        count(*) FILTER (WHERE created_at > now() - interval '7 days') AS this_week
      FROM classified_items
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/content/items/stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH|PUT /api/content/items/:id ────────────────────────────────────

// Accept both PATCH and PUT (cloudRunMutate only supports PUT; proxy uses PATCH)
const updateItemHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewed_by } = req.body;

    if (!["approved", "rejected", "pending", "published"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { rows } = await pool.query(
      `UPDATE classified_items
       SET status = $1, reviewed_at = now(), reviewed_by = $2, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [status, reviewed_by || "nik@stza.io", parseInt(id)]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("PATCH|PUT /api/content/items/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

app.patch("/api/content/items/:id", updateItemHandler);
app.put("/api/content/items/:id", updateItemHandler);

// ─── POST /api/content/items/bulk ─────────────────────────────────────────

app.post("/api/content/items/bulk", async (req, res) => {
  try {
    const { ids, status, reviewed_by } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }
    if (!["approved", "rejected", "pending", "published"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { rowCount } = await pool.query(
      `UPDATE classified_items
       SET status = $1, reviewed_at = now(), reviewed_by = $2, updated_at = now()
       WHERE id = ANY($3::int[])`,
      [status, reviewed_by || "nik@stza.io", ids]
    );

    res.json({ updated: rowCount });
  } catch (err) {
    console.error("POST /api/content/items/bulk error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/content/ingest ─────────────────────────────────────────────
// Trigger an ingestion run. Fetches all active RSS sources, parses items,
// deduplicates by content_hash, and inserts new items.

app.post("/api/content/ingest", async (req, res) => {
  const { trigger_type } = req.body || {};

  // Create run record
  const { rows: runRows } = await pool.query(
    `INSERT INTO ingestion_runs (trigger_type) VALUES ($1) RETURNING id`,
    [trigger_type || "api"]
  );
  const runId = runRows[0].id;

  // Don't block the HTTP response — run ingestion async
  res.json({ run_id: runId, status: "started" });

  // ── Async ingestion ──
  try {
    // Only fetch RSS sources for now (website scraping is Phase 2)
    const { rows: sources } = await pool.query(
      `SELECT * FROM content_sources WHERE active = true AND source_type = 'rss' ORDER BY priority ASC`
    );

    let sourcesChecked = 0;
    let totalFetched = 0;
    let totalNew = 0;
    let totalSkipped = 0;
    const errors = [];

    for (const source of sources) {
      sourcesChecked++;
      try {
        // Fetch the RSS feed with a timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(source.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "AfricanSTN-Bot/1.0 (+https://africanstn.com)",
            Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
          },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const xml = await response.text();
        const items = parseRSS(xml);
        totalFetched += items.length;

        // Insert new items, skip duplicates
        for (const item of items) {
          const hash = contentHash(item.url, item.title);

          try {
            const { rowCount } = await pool.query(
              `INSERT INTO classified_items
                 (source_id, source_name, source_url, title, summary, content_hash,
                  category, relevance_score, original_language, region, published_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (content_hash) DO NOTHING`,
              [
                source.id,
                source.source_name,
                item.url,
                item.title,
                item.summary,
                hash,
                source.category,
                0.5, // default relevance — can be refined by AI classifier later
                source.languages ? source.languages.split(",")[0].trim() : "en",
                source.region_focus,
                item.publishedAt ? new Date(item.publishedAt) : null,
              ]
            );

            if (rowCount > 0) {
              totalNew++;
            } else {
              totalSkipped++;
            }
          } catch (insertErr) {
            // Skip individual item errors (bad dates, etc.)
            totalSkipped++;
          }
        }

        // Update source metadata
        await pool.query(
          `UPDATE content_sources
           SET last_fetched_at = now(), last_item_count = $1, fetch_errors = 0, updated_at = now()
           WHERE id = $2`,
          [items.length, source.id]
        );
      } catch (sourceErr) {
        errors.push({ source_id: source.id, source_name: source.source_name, error: sourceErr.message });
        await pool.query(
          `UPDATE content_sources
           SET fetch_errors = fetch_errors + 1, updated_at = now()
           WHERE id = $1`,
          [source.id]
        );
      }
    }

    // Complete the run
    await pool.query(
      `UPDATE ingestion_runs
       SET completed_at = now(), status = 'completed',
           sources_checked = $1, items_fetched = $2, items_new = $3, items_skipped = $4,
           errors = $5
       WHERE id = $6`,
      [sourcesChecked, totalFetched, totalNew, totalSkipped, JSON.stringify(errors), runId]
    );

    console.log(
      `Ingestion run ${runId} complete: ${sourcesChecked} sources, ${totalFetched} fetched, ${totalNew} new, ${totalSkipped} skipped, ${errors.length} errors`
    );
  } catch (err) {
    console.error(`Ingestion run ${runId} failed:`, err.message);
    await pool.query(
      `UPDATE ingestion_runs SET completed_at = now(), status = 'failed', errors = $1 WHERE id = $2`,
      [JSON.stringify([{ error: err.message }]), runId]
    );
  }
});

// ─── GET /api/content/runs ────────────────────────────────────────────────

app.get("/api/content/runs", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const { rows } = await pool.query(
      `SELECT * FROM ingestion_runs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/content/runs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

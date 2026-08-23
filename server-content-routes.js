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
        count(*) FILTER (WHERE status IN ('pending', 'pending_review')) AS pending,
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

    if (!["approved", "rejected", "pending", "pending_review", "published"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { rows } = await pool.query(
      `UPDATE classified_items
       SET status = $1, reviewed_at = now(), reviewed_by = $2, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [status, reviewed_by || "nik@stza.io", id]
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
    if (!["approved", "rejected", "pending", "pending_review", "published"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { rowCount } = await pool.query(
      `UPDATE classified_items
       SET status = $1, reviewed_at = now(), reviewed_by = $2, updated_at = now()
       WHERE id = ANY($3::text[])`,
      [status, reviewed_by || "nik@stza.io", ids.map(String)]
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

  // Run ingestion synchronously — Cloud Run kills background work after
  // the response is sent (even with --no-cpu-throttling, DB connections
  // time out). Keeping the request open ensures CPU + DB stay active.
  try {
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

        for (const item of items) {
          const hash = contentHash(item.url, item.title);

          try {
            const { rowCount } = await pool.query(
              `INSERT INTO classified_items
                 (source_id, source_name, source_url, url, title, summary, content_hash,
                  category, relevance_score, original_language, region, published_at, status)
               VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
               ON CONFLICT (content_hash) DO NOTHING`,
              [
                source.id,
                source.source_name,
                item.url,
                item.title,
                item.summary,
                hash,
                source.category,
                // This ingester does no classification — it cannot judge relevance,
                // so it must not assert one. 0.0 keeps unscored items below the
                // review queue's 0.4 candidate threshold (and the weekly report's
                // same threshold in africanstn-research-agent) until something that
                // actually reads the article scores it. The previous 0.5 was above
                // both thresholds, so every fetched item passed as "relevant".
                0.0,
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
            totalSkipped++;
          }
        }

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

    res.json({
      run_id: runId,
      status: "completed",
      sources_checked: sourcesChecked,
      items_fetched: totalFetched,
      items_new: totalNew,
      items_skipped: totalSkipped,
      errors_count: errors.length,
    });
  } catch (err) {
    console.error(`Ingestion run ${runId} failed:`, err.message);
    await pool.query(
      `UPDATE ingestion_runs SET completed_at = now(), status = 'failed', errors = $1 WHERE id = $2`,
      [JSON.stringify([{ error: err.message }]), runId]
    );
    res.status(500).json({ run_id: runId, status: "failed", error: err.message });
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

// ─── POST /api/admin/migrate-015 ──────────────────────────────────────────
// One-shot idempotent migration: add missing columns to classified_items.
// Safe to call multiple times (checks IF NOT EXISTS for each column).

app.post("/api/admin/migrate-015", async (req, res) => {
  const results = [];
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");

    const addCol = async (col, def) => {
      const { rows } = await conn.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'classified_items' AND column_name = $1`, [col]);
      if (rows.length === 0) {
        await conn.query(`ALTER TABLE classified_items ADD COLUMN ${col} ${def}`);
        results.push(`added ${col}`);
      } else {
        results.push(`${col} already exists`);
      }
    };

    await addCol("content_hash", "TEXT");
    await addCol("source_id", "INTEGER REFERENCES content_sources(id) ON DELETE SET NULL");
    await addCol("published_at", "TIMESTAMPTZ");
    await addCol("url", "TEXT");
    await addCol("reviewed_at", "TIMESTAMPTZ");
    await addCol("reviewed_by", "TEXT");
    await addCol("updated_at", "TIMESTAMPTZ DEFAULT now()");

    // Create unique index on content_hash if it doesn't exist
    try {
      await conn.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_classified_items_content_hash
         ON classified_items (content_hash)`);
      results.push("content_hash unique index OK");
    } catch (idxErr) {
      results.push(`content_hash index: ${idxErr.message}`);
    }

    // Create source_id index if it doesn't exist
    try {
      await conn.query(
        `CREATE INDEX IF NOT EXISTS idx_classified_items_source_id
         ON classified_items (source_id)`);
      results.push("source_id index OK");
    } catch (idxErr) {
      results.push(`source_id index: ${idxErr.message}`);
    }

    await conn.query("COMMIT");
    res.json({ status: "ok", results });
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("POST /api/admin/migrate-015 error:", err);
    res.status(500).json({ error: err.message, results });
  } finally {
    conn.release();
  }
});

// ─── GET /api/admin/schema-check ──────────────────────────────────────────
// Quick check of classified_items columns for debugging

app.get("/api/admin/schema-check", async (req, res) => {
  try {
    const { rows: cols } = await pool.query(
      `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'classified_items'
       ORDER BY ordinal_position`);
    const { rows: count } = await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE content_hash IS NOT NULL) AS with_hash,
              count(*) FILTER (WHERE source_id IS NOT NULL) AS with_source_id
       FROM classified_items`);
    res.json({ columns: cols, counts: count[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

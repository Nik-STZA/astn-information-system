/**
 * stza-finance-api
 *
 * The Finance module's own backend. Deliberately a separate Cloud Run service
 * from africastn-api: the Finance module must be liftable, and extraction
 * should be "take this service plus a dump of shared.* and finance.*" rather
 * than untangling it from AfricanSTN's API.
 *
 * It reads only shared.* and finance.*. It never touches public.*, which is
 * where AfricanSTN and the research agent live.
 *
 * Auth: X-API-Key against FINANCE_API_KEY, same shape as the sibling service.
 * The caller is the Next.js server, never the browser.
 */

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── Database ────────────────────────────────────────────────────────────────

const poolConfig = {
  user: process.env.DB_USER || "africastn_app",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "africastn_os",
  max: 5,
};

if (process.env.INSTANCE_CONNECTION_NAME) {
  poolConfig.host = `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`;
} else {
  poolConfig.host = process.env.DB_HOST || "127.0.0.1";
  poolConfig.port = parseInt(process.env.DB_PORT || "5432", 10);
}

const pool = new Pool(poolConfig);

// ── Auth ────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (req.path === "/health") return next();

  const expected = process.env.FINANCE_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: "FINANCE_API_KEY is not configured" });
  }
  // Trim the header: a trailing newline in a secret payload has broken this
  // pattern before on the sibling service.
  const given = (req.get("X-API-Key") || "").trim();
  if (given !== expected.trim()) {
    return res.status(401).json({ error: "unauthorised" });
  }
  next();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function clientIdFromSlug(slug) {
  const { rows } = await pool.query(
    "SELECT id, name, slug FROM shared.clients WHERE slug = $1",
    [slug]
  );
  return rows[0] || null;
}

// Wraps a handler so a thrown error becomes a 500 with a logged message
// rather than an unhandled rejection.
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`${req.method} ${req.path} failed:`, err.message);
    res.status(500).json({ error: err.message });
  });

// ── Routes ──────────────────────────────────────────────────────────────────

app.get("/health", route(async (_req, res) => {
  const { rows } = await pool.query("SELECT now() AS now");
  res.json({ status: "ok", now: rows[0].now });
}));

// Finance clients are those with a row in finance.client_finance_config.
app.get("/api/finance/clients", route(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.slug, c.name, c.jurisdiction, c.framework, c.year_end, c.status,
           f.accounting_system, f.close_cadence, f.reporting_currency,
           (SELECT COUNT(*)::int FROM finance.open_items o
             WHERE o.client_id = c.id AND o.is_closed = false) AS open_item_count,
           (SELECT COUNT(*)::int FROM finance.open_items o
             WHERE o.client_id = c.id AND o.is_closed = false AND o.priority = 'P1') AS p1_count
    FROM shared.clients c
    JOIN finance.client_finance_config f ON f.client_id = c.id
    ORDER BY c.name
  `);
  res.json({ count: rows.length, data: rows });
}));

app.get("/api/finance/clients/:slug", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const [config, entities] = await Promise.all([
    pool.query(
      `SELECT accounting_system, close_cadence, reporting_currency,
              materiality_thresholds, cash_floor_gbp
       FROM finance.client_finance_config WHERE client_id = $1`,
      [client.id]
    ),
    pool.query(
      `SELECT slug, name, legal_name, role, year_end
       FROM finance.entities WHERE client_id = $1 ORDER BY name`,
      [client.id]
    ),
  ]);

  res.json({ ...client, config: config.rows[0] || null, entities: entities.rows });
}));

app.get("/api/finance/clients/:slug/diary", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);
  const { rows } = await pool.query(
    `SELECT id, occurred_at, occurred_precision, role, agent_name, action,
            where_path, status, notes, heading, source_file, source_line
     FROM finance.diary_entries
     WHERE client_id = $1
     ORDER BY occurred_at DESC NULLS LAST, source_file DESC, source_line DESC
     LIMIT $2`,
    [client.id, limit]
  );
  res.json({ count: rows.length, data: rows });
}));

app.get("/api/finance/clients/:slug/open-items", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT id, ref, title, category, owner_label, priority, status,
            raised_at, last_update_at, closed_at, resolution, is_closed,
            source_file, source_line
     FROM finance.open_items
     WHERE client_id = $1
     ORDER BY is_closed,
              CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
              raised_at NULLS LAST`,
    [client.id]
  );
  res.json({ count: rows.length, data: rows });
}));

// ── Xero connections ────────────────────────────────────────────────────────
//
// Secret layout, chosen so onboarding a new client needs no new Xero app:
//
//   xero-app-client-id       practice level, one STZA app, all clients
//   xero-app-client-secret   practice level
//   xero-refresh-<client>-<entity>   one per authorised connection
//
// One Xero app can hold many independent authorisations, including several of
// the same tenant. That is what lets the portal hold its own connection
// without disturbing the refresh token the close pipeline owns: Xero refresh
// tokens are single use and rotate on every call, so two holders of the same
// token would invalidate each other.
//
// Status is derived from secret EXISTENCE, never by reading the value.

const SECRET_PROJECT = process.env.SECRET_PROJECT || "africanstn-research";
let secretClientPromise = null;

async function secretManager() {
  if (!secretClientPromise) {
    secretClientPromise = import("@google-cloud/secret-manager").then(
      (m) => new m.SecretManagerServiceClient()
    );
  }
  return secretClientPromise;
}

const secretPath = (name) => `projects/${SECRET_PROJECT}/secrets/${name}`;
const refreshSecretName = (clientSlug, entitySlug) =>
  `xero-refresh-${clientSlug}-${entitySlug}`;

async function secretExists(name) {
  try {
    const sm = await secretManager();
    await sm.getSecret({ name: secretPath(name) });
    return true;
  } catch (e) {
    if (e.code === 5 || /NOT_FOUND/i.test(e.message || "")) return false;
    throw e;
  }
}

async function readSecret(name) {
  const sm = await secretManager();
  const [v] = await sm.accessSecretVersion({ name: `${secretPath(name)}/versions/latest` });
  return v.payload.data.toString("utf8");
}

// Writes an audit row. Never receives or stores an unmasked value.
async function audit(conn, { actorEmail, action, targetType, targetId, clientId, payload, ip }) {
  await conn.query(
    `INSERT INTO finance.audit_log
       (actor_email, action, target_type, target_id, client_id, payload, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actorEmail, action, targetType, targetId, clientId, payload || {}, ip || null]
  );
}

app.get("/api/finance/clients/:slug/xero", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows: entities } = await pool.query(
    `SELECT slug, name, legal_name, role, accounting_system, accounting_system_config
     FROM finance.entities WHERE client_id = $1 ORDER BY name`,
    [client.id]
  );

  let appConfigured = false;
  try {
    appConfigured =
      (await secretExists("xero-app-client-id")) &&
      (await secretExists("xero-app-client-secret"));
  } catch (e) {
    console.error("secret manager unavailable:", e.message);
    return res.status(503).json({ error: `Secret Manager unavailable: ${e.message}` });
  }

  const data = [];
  for (const e of entities) {
    const secretName = refreshSecretName(req.params.slug, e.slug);
    const connected = appConfigured && (await secretExists(secretName));
    const cfg = e.accounting_system_config || {};
    data.push({
      slug: e.slug,
      name: e.name,
      legalName: e.legal_name,
      role: e.role,
      accountingSystem: e.accounting_system,
      tenantId: cfg.tenant_id || null,
      configName: cfg.config_name || null,
      connectedAt: cfg.connected_at || null,
      lastRefreshedAt: cfg.last_refreshed_at || null,
      secretName,
      connected,
    });
  }

  res.json({ appConfigured, count: data.length, data });
}));

// Reveal or copy a sensitive field. Both return the value, and both are
// audited. The distinction is what the operator did with it, which matters
// when reconstructing who saw what.
app.post("/api/finance/clients/:slug/xero/:entity/secret", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { action, field } = req.body || {};
  if (!["reveal", "copy"].includes(action)) {
    return res.status(400).json({ error: "action must be reveal or copy" });
  }

  const names = {
    client_id: "xero-app-client-id",
    client_secret: "xero-app-client-secret",
    refresh_token: refreshSecretName(req.params.slug, req.params.entity),
  };
  const secretName = names[field];
  if (!secretName) return res.status(400).json({ error: "unknown field" });

  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });

  const conn = await pool.connect();
  try {
    if (!(await secretExists(secretName))) {
      await audit(conn, {
        actorEmail, action: `${action}_secret_missing`, targetType: "xero_secret",
        targetId: `${req.params.entity}:${field}`, clientId: client.id,
        payload: { field, entity: req.params.entity },
        ip: req.get("X-Forwarded-For") || req.ip,
      });
      return res.status(404).json({ error: "not connected" });
    }

    const value = await readSecret(secretName);

    // The payload records that it happened and to what, never the value.
    await audit(conn, {
      actorEmail, action: `${action}_secret`, targetType: "xero_secret",
      targetId: `${req.params.entity}:${field}`, clientId: client.id,
      payload: { field, entity: req.params.entity, secretName },
      ip: req.get("X-Forwarded-For") || req.ip,
    });

    res.json({ value });
  } finally {
    conn.release();
  }
}));

app.get("/api/finance/clients/:slug/audit", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT actor_email, action, target_type, target_id, payload, occurred_at
     FROM finance.audit_log WHERE client_id = $1
     ORDER BY occurred_at DESC LIMIT 50`,
    [client.id]
  );
  res.json({ count: rows.length, data: rows });
}));

// ── Sync ────────────────────────────────────────────────────────────────────
//
// The file watcher parses locally and posts the result here, so the write
// semantics live in one place and a future Cloud Run watcher job can reuse
// them unchanged.
//
//   diary      replaced wholesale for each source file present in the payload.
//              Files absent from the payload are left alone, so the watcher can
//              push a single changed file without wiping the rest.
//   openItems  upserted on ref, then refs missing from the payload are deleted.
//              Only sent when open-items.md itself changed.

app.post("/api/finance/clients/:slug/sync", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const diary = Array.isArray(req.body.diary) ? req.body.diary : [];
  const openItems = Array.isArray(req.body.openItems) ? req.body.openItems : null;

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    let diaryRows = 0;

    for (const file of diary) {
      // Serialise syncs of the same file. Replace-per-file is delete then
      // insert, and under READ COMMITTED a second transaction cannot see the
      // first's uncommitted inserts: it would delete only the pre-existing
      // rows, insert its own, and both would commit, doubling the file's
      // entries. A save that emits two filesystem events is enough to trigger
      // it. The lock is transaction scoped and released on commit or rollback.
      await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `finance.diary:${client.id}:${file.sourceFile}`,
      ]);

      await conn.query(
        "DELETE FROM finance.diary_entries WHERE client_id = $1 AND source_file = $2",
        [client.id, file.sourceFile]
      );
      for (const e of file.entries) {
        await conn.query(
          `INSERT INTO finance.diary_entries
             (client_id, occurred_at, occurred_precision, role, agent_name, action,
              where_path, status, notes, heading, source_file, source_line)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [client.id, e.occurredAt, e.occurredPrecision, e.role, e.agentName, e.action,
           e.wherePath, e.status, e.notes, e.heading, e.sourceFile, e.sourceLine]
        );
        diaryRows++;
      }
    }

    let removed = 0;
    if (openItems) {
      // Same reasoning as the diary lock. Upsert-on-ref is safe on its own,
      // but the delete-missing sweep at the end is not.
      await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `finance.open_items:${client.id}`,
      ]);

      for (const i of openItems) {
        await conn.query(
          `INSERT INTO finance.open_items
             (client_id, ref, title, category, owner_label, priority, status,
              raised_at, last_update_at, closed_at, resolution, is_closed,
              source_file, source_line)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (client_id, source_file, ref) DO UPDATE SET
             title = EXCLUDED.title, category = EXCLUDED.category,
             owner_label = EXCLUDED.owner_label, priority = EXCLUDED.priority,
             status = EXCLUDED.status, raised_at = EXCLUDED.raised_at,
             last_update_at = EXCLUDED.last_update_at, closed_at = EXCLUDED.closed_at,
             resolution = EXCLUDED.resolution, is_closed = EXCLUDED.is_closed,
             source_line = EXCLUDED.source_line`,
          [client.id, i.ref, i.title, i.category, i.ownerLabel, i.priority, i.status,
           i.raisedAt, i.lastUpdateAt, i.closedAt, i.resolution, i.isClosed,
           i.sourceFile, i.sourceLine]
        );
      }
      const del = await conn.query(
        `DELETE FROM finance.open_items
         WHERE client_id = $1 AND source_file = 'open-items.md'
           AND NOT (ref = ANY($2::text[]))`,
        [client.id, openItems.map((i) => i.ref)]
      );
      removed = del.rowCount;
    }

    await conn.query("COMMIT");
    res.json({ ok: true, diaryEntries: diaryRows, openItems: openItems ? openItems.length : null, removed });
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}));

// ── Start ───────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => {
  console.log(`stza-finance-api listening on ${port}`);
});

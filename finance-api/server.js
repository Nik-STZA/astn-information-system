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
const { Pool, types } = require("pg");

// A DATE column is a calendar date with no time and no zone. node-postgres
// parses it into a JS Date at LOCAL midnight, which serialises back a day early
// whenever the server is ahead of UTC: a 31 March year end leaves here as
// "2027-03-30T23:00:00.000Z" through British Summer Time.
//
// Returning the string Postgres actually stored removes the whole class of
// error. A year end, a period end or a due date that is silently one day out is
// exactly the kind of wrong number this system exists to prevent.
types.setTypeParser(1082, (v) => v);
const {
  selectTenant,
  readAuthEventId,
  normaliseIp,
} = require("./lib/xero");

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
           -- Completed items linger in the active table until tidied, so
           -- an is_closed test alone overstates the workload. A status
           -- beginning DONE is done; "Partially DONE" is not.
           (SELECT COUNT(*)::int FROM finance.open_items o
             WHERE o.client_id = c.id AND o.is_closed = false
               AND COALESCE(o.status,'') !~* '^[[:space:]]*done([^[:alnum:]]|$)') AS open_item_count,
           (SELECT COUNT(*)::int FROM finance.open_items o
             WHERE o.client_id = c.id AND o.is_closed = false AND o.priority = 'P1'
               AND COALESCE(o.status,'') !~* '^[[:space:]]*done([^[:alnum:]]|$)') AS p1_count
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
    `SELECT o.id, o.ref, o.title, o.category, o.owner_label, o.priority, o.status,
            o.raised_at, o.last_update_at, o.closed_at, o.resolution, o.is_closed,
            o.source_file, o.source_line,
            (SELECT COUNT(*)::int FROM finance.notes n
              WHERE n.target_type = 'open_item' AND n.target_id = o.id) AS note_count
     FROM finance.open_items o
     WHERE o.client_id = $1
     ORDER BY o.is_closed,
              CASE o.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
              o.raised_at NULLS LAST`,
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
async function audit(conn, { actorEmail, actorRole, action, targetType, targetId, clientId, payload, ip }) {
  await conn.query(
    `INSERT INTO finance.audit_log
       (actor_email, actor_role, action, target_type, target_id, client_id, payload, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actorEmail, actorRole || null, action, targetType, targetId, clientId, payload || {}, normaliseIp(ip)]
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
    const cfg = e.accounting_system_config || {};

    // Both halves must be present. The refresh token is written to Secret
    // Manager before the database transaction, which is not atomic with it, so
    // a failure in between leaves a token with no tenant id. Requiring both
    // means such a state reports as not connected and re-running Connect
    // repairs it, rather than looking healthy while being unusable.
    const connected =
      appConfigured && Boolean(cfg.tenant_id) && (await secretExists(secretName));
    data.push({
      slug: e.slug,
      name: e.name,
      legalName: e.legal_name,
      role: e.role,
      accountingSystem: e.accounting_system,
      tenantId: cfg.tenant_id || null,
      tenantName: cfg.tenant_name || null,
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

// ── Xero OAuth ──────────────────────────────────────────────────────────────
//
// The token exchange happens here, not in the Next.js app, so the client
// secret never leaves this service. The app only ever handles the code and the
// CSRF state.
//
// Scopes are the new granular set, because apps created after 2 March 2026 do
// not get the broad ones. accounting.manualjournals is a write scope and is
// requested from the start: journals are created as drafts and flipped to
// posted on approval, so write access is needed before the first approval, not
// at a later phase.

const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

const XERO_SCOPES = [
  "openid",
  "offline_access",
  "accounting.settings.read",
  "accounting.contacts.read",
  "accounting.invoices.read",
  "accounting.banktransactions.read",
  "accounting.manualjournals",
  "accounting.reports.trialbalance.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.aged.read",
].join(" ");

app.get("/api/finance/xero/authorize-url", route(async (req, res) => {
  const { state, redirect_uri: redirectUri } = req.query;
  if (!state || !redirectUri) {
    return res.status(400).json({ error: "state and redirect_uri are required" });
  }

  const clientId = await readSecret("xero-app-client-id");
  const url =
    `${XERO_AUTHORIZE_URL}?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(XERO_SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;

  res.json({ url });
}));

// Exchanges a stored refresh token for an access token, and persists the
// rotated refresh token immediately.
//
// Xero refresh tokens are single use: every refresh returns a new one and
// invalidates the one just used. If the new token is not stored before
// anything else can fail, the connection is dead and only re-authorising
// recovers it. So the write happens first, before the access token is
// returned to the caller.
async function refreshAccessToken(secretName) {
  const refreshToken = await readSecret(secretName);
  const [clientId, clientSecret] = await Promise.all([
    readSecret("xero-app-client-id"),
    readSecret("xero-app-client-secret"),
  ]);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!r.ok) {
    console.error(`Xero refresh failed for ${secretName}:`, r.status, (await r.text()).slice(0, 200));
    throw new ErpUnavailable(
      r.status === 400
        ? "The Xero connection has expired. Reconnect this entity."
        : `Xero refused the token refresh (${r.status})`
    );
  }

  const tokens = await r.json();
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    await storeSecret(secretName, tokens.refresh_token);
  }
  return tokens.access_token;
}

class ErpUnavailable extends Error {}

// Lists the Xero organisations the stored token can reach.
async function listXeroOrganisations(secretName) {
  const accessToken = await refreshAccessToken(secretName);
  const r = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!r.ok) throw new ErpUnavailable(`Could not read Xero connections (${r.status})`);
  return (await r.json()).map((c) => ({
    tenantId: c.tenantId,
    tenantName: c.tenantName,
    tenantType: c.tenantType,
  }));
}

// Ensures a secret exists, then adds the value as a new version. Rotating a
// token is therefore just another version, and the old one stays auditable
// until explicitly destroyed.
async function storeSecret(name, value) {
  const sm = await secretManager();
  if (!(await secretExists(name))) {
    await sm.createSecret({
      parent: `projects/${SECRET_PROJECT}`,
      secretId: name,
      secret: { replication: { automatic: {} } },
    });
  }
  await sm.addSecretVersion({
    parent: secretPath(name),
    payload: { data: Buffer.from(value, "utf8") },
  });
}

app.post("/api/finance/clients/:slug/xero/:entity/callback", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { code, redirectUri } = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!code || !redirectUri) return res.status(400).json({ error: "code and redirectUri are required" });
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });

  const { rows: entityRows } = await pool.query(
    "SELECT id, slug, name, accounting_system_config FROM finance.entities WHERE client_id = $1 AND slug = $2",
    [client.id, req.params.entity]
  );
  if (!entityRows.length) return res.status(404).json({ error: "entity not found" });
  const entity = entityRows[0];

  const [clientIdSecret, clientSecret] = await Promise.all([
    readSecret("xero-app-client-id"),
    readSecret("xero-app-client-secret"),
  ]);

  const basic = Buffer.from(`${clientIdSecret}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    // Xero's error body can echo request detail, so it is not returned to the
    // browser verbatim.
    console.error("Xero token exchange failed:", tokenRes.status, (await tokenRes.text()).slice(0, 300));
    return res.status(502).json({ error: `Xero rejected the authorisation (${tokenRes.status})` });
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return res.status(502).json({ error: "Xero returned no refresh token. Was offline_access granted?" });
  }

  // Which organisation did they actually pick?
  //
  // /connections returns every tenant the token can reach, which after the
  // first connection includes organisations authorised earlier. Taking the
  // first entry is therefore a guess, and it guessed wrong in practice:
  // Feldspar Group Holdings was mapped to Ultraspeed Digital Limited because
  // Ultraspeed happened to be listed first. A journal approved for one company
  // would have posted to another's ledger.
  //
  // Each connection records the authorisation event that created it, and the
  // id token from this exchange identifies the event that just happened. The
  // intersection is exactly the organisation the operator chose, with no
  // guessing. The id token is read, not verified, because it arrived over TLS
  // in the direct response to our own authenticated token request; it is used
  // only to select among tenants Xero has already vouched for.
  const authEventId = readAuthEventId(tokens.id_token);

  const connRes = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });
  if (!connRes.ok) {
    return res.status(502).json({ error: `Could not read Xero connections (${connRes.status})` });
  }
  const connections = await connRes.json();
  if (!connections.length) {
    return res.status(400).json({ error: "No Xero organisation was authorised" });
  }

  const matched = authEventId
    ? connections.filter((c) => c.authEventId === authEventId)
    : connections;

  // Refuse to GUESS the organisation, but do not refuse to STORE the
  // authorisation. Those are different things and conflating them broke the
  // flow entirely.
  //
  // A wrong tenant here is a journal in the wrong company's books, so guessing
  // stays forbidden. But an unmapped authorisation is harmless: `connected`
  // requires BOTH a tenant id and a stored secret, so the entity reports as not
  // connected and nothing can reach a ledger until a person chooses the
  // organisation.
  //
  // Discarding the token instead made the organisation picker unreachable. The
  // picker needs a stored token to list organisations, and the callback would
  // not store one until the tenant was unambiguous. Every new client hits that,
  // because the app is already connected to several organisations and Xero
  // returns no authentication_event_id for organisations it has seen before.
  const tenant = matched.length === 1 ? matched[0] : null;
  if (!tenant) {
    console.warn(
      `Xero organisation not identified: ${matched.length} of ${connections.length} matched auth event ${authEventId}. ` +
        `Storing the authorisation unmapped for selection.`
    );
  }

  const secretName = refreshSecretName(req.params.slug, entity.slug);
  await storeSecret(secretName, tokens.refresh_token);

  const now = new Date().toISOString();
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query(
      `UPDATE finance.entities
       SET accounting_system_config = COALESCE(accounting_system_config, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [
        entity.id,
        // Only write the tenant when it was actually identified. Writing a
        // guess, or writing null over a previously correct mapping, are both
        // worse than leaving it unset for a person to choose.
        JSON.stringify({
          ...(tenant ? { tenant_id: tenant.tenantId, tenant_name: tenant.tenantName } : {}),
          connected_at: now,
          last_refreshed_at: now,
          scopes: XERO_SCOPES.split(" "),
          secret_name: secretName,
        }),
      ]
    );

    const role = await conn.query(
      "SELECT finance.role_at($1, $2, CURRENT_DATE) AS role",
      [client.id, actorEmail]
    );

    await conn.query(
      `INSERT INTO finance.audit_log
         (actor_email, actor_role, action, target_type, target_id, client_id, payload, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        actorEmail,
        role.rows[0].role,
        "connect_xero",
        "xero_connection",
        entity.slug,
        client.id,
        // Records what was connected and with what access. Never the tokens.
        // An unmapped authorisation is recorded as such rather than left out of
        // the log, because "authorised but pointing at nothing" is a state
        // someone may later need to explain.
        JSON.stringify({
          entity: entity.slug,
          tenantId: tenant ? tenant.tenantId : null,
          tenantName: tenant ? tenant.tenantName : null,
          organisationSelected: Boolean(tenant),
          candidateOrganisations: connections.length,
          scopes: XERO_SCOPES.split(" "),
          secretName,
        }),
        normaliseIp(req.get("X-Forwarded-For") || req.ip),
      ]
    );
    await conn.query("COMMIT");
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }

  res.json({
    ok: true,
    entity: entity.slug,
    tenantId: tenant ? tenant.tenantId : null,
    tenantName: tenant ? tenant.tenantName : null,
    // The entity is authorised but not yet pointed at an organisation. It will
    // report as not connected until one is chosen, which is the honest state.
    needsSelection: !tenant,
    candidateOrganisations: connections.length,
  });
}));

// Organisations reachable with this client's existing authorisation.
//
// Xero does not offer a picker for organisations an app is already connected
// to, so per-entity authorisation cannot be used to disambiguate them. One
// authorisation reaches every connected organisation, and the mapping of
// entity to organisation is made here instead, where it can be seen and
// corrected.
app.get("/api/finance/clients/:slug/xero/organisations", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT slug, accounting_system_config->>'secret_name' AS secret_name
     FROM finance.entities WHERE client_id = $1`,
    [client.id]
  );

  // Any stored token for this client reaches all of its organisations.
  const candidates = rows
    .map((r) => r.secret_name || refreshSecretName(req.params.slug, r.slug))
    .filter(Boolean);

  for (const secretName of candidates) {
    if (!(await secretExists(secretName))) continue;
    try {
      const orgs = await listXeroOrganisations(secretName);
      return res.json({ count: orgs.length, data: orgs, via: secretName });
    } catch (e) {
      console.error(`could not list organisations via ${secretName}: ${e.message}`);
    }
  }

  res.status(409).json({
    error: "No working Xero connection for this client yet. Connect one entity first.",
  });
}));

// Maps an entity to one of those organisations.
app.post("/api/finance/clients/:slug/xero/:entity/organisation", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { tenantId } = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });

  const { rows: entityRows } = await pool.query(
    "SELECT id, slug, accounting_system_config FROM finance.entities WHERE client_id = $1 AND slug = $2",
    [client.id, req.params.entity]
  );
  if (!entityRows.length) return res.status(404).json({ error: "entity not found" });
  const entity = entityRows[0];

  const secretName = refreshSecretName(req.params.slug, entity.slug);
  if (!(await secretExists(secretName))) {
    return res.status(409).json({ error: "This entity has no Xero authorisation yet." });
  }

  // The tenant must be one Xero actually grants, not merely well formed.
  // Otherwise a typo or a stale page could point an entity at any id at all.
  let orgs;
  try {
    orgs = await listXeroOrganisations(secretName);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  const chosen = orgs.find((o) => o.tenantId === tenantId);
  if (!chosen) {
    return res.status(400).json({ error: "That organisation is not available on this connection." });
  }

  // One organisation cannot serve two entities: that is the fault this whole
  // change exists to prevent.
  const { rows: clash } = await pool.query(
    `SELECT slug FROM finance.entities
     WHERE client_id = $1 AND slug <> $2 AND accounting_system_config->>'tenant_id' = $3`,
    [client.id, entity.slug, tenantId]
  );
  if (clash.length) {
    return res.status(409).json({
      error: `${chosen.tenantName} is already mapped to ${clash[0].slug}. Clear that first.`,
    });
  }

  const now = new Date().toISOString();
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query(
      `UPDATE finance.entities
       SET accounting_system_config = COALESCE(accounting_system_config,'{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [entity.id, JSON.stringify({
        tenant_id: chosen.tenantId,
        tenant_name: chosen.tenantName,
        connected_at: entity.accounting_system_config?.connected_at || now,
        last_refreshed_at: now,
        secret_name: secretName,
      })]
    );
    const role = await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail]);
    await audit(conn, {
      actorEmail,
      actorRole: role.rows[0].role,
      action: "map_xero_organisation",
      targetType: "xero_connection",
      targetId: entity.slug,
      clientId: client.id,
      payload: { entity: entity.slug, tenantId: chosen.tenantId, tenantName: chosen.tenantName },
      ip: req.get("X-Forwarded-For") || req.ip,
    });
    await conn.query("COMMIT");
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }

  res.json({ ok: true, entity: entity.slug, tenantName: chosen.tenantName });
}));

// ── Work in progress ────────────────────────────────────────────────────────

app.get("/api/finance/clients/:slug/wip", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT w.id, w.ref, w.type, w.status, w.panel, w.priority, w.title,
            w.amount_total, w.folder_path, w.drafter_role, w.tier,
            w.entity_scope, w.due_at, w.blocked_on, w.drafted_at, w.updated_at,
            w.drafter_email, w.drafter_agent,
            w.routing_class, w.routing_reason,
            e.slug AS entity_slug, e.name AS entity_name,
            -- Three states, not two. "Cannot tell" must not read as "yes".
            CASE
              WHEN w.drafter_email IS NULL THEN 'not-recorded'
              WHEN EXISTS (SELECT 1 FROM finance.wip_review_log r
                            WHERE r.wip_id = w.id AND r.reviewer_email IS NOT NULL
                              AND r.reviewer_email <> w.drafter_email) THEN 'independent'
              WHEN EXISTS (SELECT 1 FROM finance.wip_review_log r
                            WHERE r.wip_id = w.id AND r.reviewer_email = w.drafter_email)
                   THEN 'same-person'
              ELSE 'not-recorded'
            END AS review_independence
     FROM finance.wip_items w
     LEFT JOIN finance.entities e ON e.id = w.entity_id
     WHERE w.client_id = $1
     ORDER BY
       CASE w.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
       w.drafted_at DESC NULLS LAST`,
    [client.id]
  );

  const { rows: reviews } = await pool.query(
    `SELECT r.wip_id, r.reviewer_role, r.outcome, r.findings, r.notes,
            r.next_step, r.reviewed_at
     FROM finance.wip_review_log r
     JOIN finance.wip_items w ON w.id = r.wip_id
     WHERE w.client_id = $1
     ORDER BY r.reviewed_at`,
    [client.id]
  );

  const byWip = new Map();
  for (const r of reviews) {
    if (!byWip.has(r.wip_id)) byWip.set(r.wip_id, []);
    byWip.get(r.wip_id).push({
      reviewerRole: r.reviewer_role,
      outcome: r.outcome,
      findings: r.findings ?? [],
      notes: r.notes,
      nextStep: r.next_step,
      reviewedAt: r.reviewed_at,
    });
  }

  res.json({
    count: rows.length,
    data: rows.map((w) => ({
      id: w.id,
      ref: w.ref,
      type: w.type,
      status: w.status,
      panel: w.panel,
      priority: w.priority,
      title: w.title,
      amountTotal: w.amount_total,
      folderPath: w.folder_path,
      drafterRole: w.drafter_role,
      tier: w.tier,
      routingClass: w.routing_class,
      routingReason: w.routing_reason,
      entityScope: w.entity_scope,
      entitySlug: w.entity_slug,
      // Group-scoped work has no entity, and the queue shows "Group" rather
      // than attributing it to a company it does not belong to.
      entityLabel: w.entity_name || "Group",
      dueAt: w.due_at,
      blockedOn: w.blocked_on,
      draftedAt: w.drafted_at,
      drafterEmail: w.drafter_email,
      drafterAgent: w.drafter_agent,
      reviewIndependence: w.review_independence,
      updatedAt: w.updated_at,
      reviews: byWip.get(w.id) ?? [],
    })),
  });
}));

// ── Notes ───────────────────────────────────────────────────────────────────
//
// Append only. There is no update and no delete endpoint, because the table
// refuses both: a record that can be edited afterwards is not evidence.

app.get("/api/finance/clients/:slug/notes", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { targetType, targetId } = req.query;
  const params = [client.id];
  let where = "n.client_id = $1";
  if (targetType) { params.push(targetType); where += ` AND n.target_type = $${params.length}`; }
  if (targetId)   { params.push(targetId);   where += ` AND n.target_id = $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT n.id, n.target_type, n.target_id, n.body, n.kind,
            n.actor_email, n.actor_role, n.created_at
     FROM finance.notes n
     WHERE ${where}
     ORDER BY n.created_at DESC
     LIMIT 500`,
    params
  );
  res.json({ count: rows.length, data: rows });
}));

app.post("/api/finance/clients/:slug/notes", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { targetType, targetId, body, kind } = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();

  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  if (!["wip_item", "open_item"].includes(targetType)) {
    return res.status(400).json({ error: "targetType must be wip_item or open_item" });
  }
  if (!targetId) return res.status(400).json({ error: "targetId is required" });
  if (!body || !String(body).trim()) return res.status(400).json({ error: "body is required" });
  if (kind && !["note", "decision", "hold", "query"].includes(kind)) {
    return res.status(400).json({ error: "unknown kind" });
  }

  // The target must belong to this client, or a note could be attached to
  // another client's work by guessing an id.
  const table = targetType === "wip_item" ? "finance.wip_items" : "finance.open_items";
  const owns = await pool.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND client_id = $2`,
    [targetId, client.id]
  );
  if (!owns.rowCount) return res.status(404).json({ error: "target not found for this client" });

  const role = await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [
    client.id,
    actorEmail,
  ]);

  const { rows } = await pool.query(
    `INSERT INTO finance.notes
       (client_id, target_type, target_id, body, kind, actor_email, actor_role, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, body, kind, actor_email, actor_role, created_at`,
    [
      client.id, targetType, targetId, String(body).trim(), kind || "note",
      actorEmail, role.rows[0].role, normaliseIp(req.get("X-Forwarded-For") || req.ip),
    ]
  );

  res.status(201).json(rows[0]);
}));

// ── Agent runs ──────────────────────────────────────────────────────────────
//
// The portal queues work; a runner on the operator's machine executes it. The
// portal never executes anything itself, because the agents need the client
// folder and the accounting MCP, both of which are local.
//
// Every run is recorded whether or not it produces work to approve: a run that
// only answered a question still read client data.

app.post("/api/finance/clients/:slug/agent-runs", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { agent, instruction } = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();

  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ error: "instruction is required" });
  }

  const role = await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [
    client.id, actorEmail,
  ]);

  const { rows } = await pool.query(
    `INSERT INTO finance.agent_runs
       (client_id, requested_by_email, requested_by_role, agent, instruction, status)
     VALUES ($1,$2,$3,$4,$5,'queued')
     RETURNING id, agent, instruction, status, queued_at`,
    [client.id, actorEmail, role.rows[0].role, agent || null, String(instruction).trim()]
  );
  res.status(201).json(rows[0]);
}));

app.get("/api/finance/clients/:slug/agent-runs", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT id, agent, instruction, status, session_id, output, error,
            tools_used, files_touched, duration_ms, cost_usd, wip_ref,
            requested_by_email, requested_by_role,
            queued_at, started_at, finished_at
     FROM finance.agent_runs
     WHERE client_id = $1
     ORDER BY queued_at DESC
     LIMIT 100`,
    [client.id]
  );
  res.json({ count: rows.length, data: rows });
}));

// The runner claims one job at a time. SKIP LOCKED means a second runner takes
// the next job rather than blocking or, worse, running the same one twice.
app.post("/api/finance/agent-runs/claim", route(async (_req, res) => {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const { rows } = await conn.query(
      `WITH next AS (
         SELECT id FROM finance.agent_runs
         WHERE status = 'queued'
         ORDER BY queued_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE finance.agent_runs r
       SET status = 'running', started_at = now()
       FROM next WHERE r.id = next.id
       RETURNING r.id, r.agent, r.instruction, r.client_id`
    );
    if (!rows.length) {
      await conn.query("COMMIT");
      return res.status(204).end();
    }
    const job = rows[0];
    // operatorIsController travels with the job because the runner decides
    // whether an ungoverned processing path is permissible, and that turns on
    // whose data it is rather than on anything the runner can see locally.
    const c = await conn.query(
      `SELECT c.slug, c.name, c.folder_path,
              COALESCE(cfc.operator_is_controller, false) AS operator_is_controller
         FROM shared.clients c
         LEFT JOIN finance.client_finance_config cfc ON cfc.client_id = c.id
        WHERE c.id = $1`,
      [job.client_id]
    );
    await conn.query("COMMIT");
    res.json({
      id: job.id,
      agent: job.agent,
      instruction: job.instruction,
      client: c.rows[0],
    });
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}));

app.post("/api/finance/agent-runs/:id/complete", route(async (req, res) => {
  const {
    status, sessionId, output, error, toolsUsed, filesTouched, durationMs, costUsd, wipRef,
  } = req.body || {};

  if (!["succeeded", "failed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be succeeded, failed or cancelled" });
  }

  // finished_at is set here, which is what makes the row immutable afterwards.
  const { rows } = await pool.query(
    `UPDATE finance.agent_runs
     SET status = $2, session_id = $3, output = $4, error = $5,
         tools_used = COALESCE($6::jsonb, '[]'::jsonb),
         files_touched = COALESCE($7::jsonb, '[]'::jsonb),
         duration_ms = $8, cost_usd = $9, wip_ref = $10, finished_at = now()
     WHERE id = $1 AND finished_at IS NULL
     RETURNING id, status, finished_at`,
    [
      req.params.id, status, sessionId || null, output || null, error || null,
      toolsUsed ? JSON.stringify(toolsUsed) : null,
      filesTouched ? JSON.stringify(filesTouched) : null,
      durationMs || null, costUsd || null, wipRef || null,
    ]
  );

  if (!rows.length) {
    return res.status(409).json({ error: "run not found, or already finished and therefore immutable" });
  }
  res.json(rows[0]);
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

// ── Xero data ──────────────────────────────────────────────────────────────
//
// Live financial data endpoints. Each resolves the entity's Xero tenant
// and refresh-token secret, gets a fresh access token (rotating the
// refresh token in Secret Manager), then proxies a single Xero API call.
//
// Used by the agent runner and (eventually) by the Reports/CoA pages.

const XERO_API = "https://api.xero.com/api.xro/2.0";

async function xeroEntityContext(slug, entitySlug) {
  const client = await clientIdFromSlug(slug);
  if (!client) return null;

  const { rows } = await pool.query(
    `SELECT e.id, e.slug, e.name, e.accounting_system_config
     FROM finance.entities e
     WHERE e.client_id = $1 AND e.slug = $2`,
    [client.id, entitySlug]
  );
  if (!rows.length) return null;

  const entity = rows[0];
  const tenantId = entity.accounting_system_config?.tenant_id;
  if (!tenantId) return null;

  const secretName = refreshSecretName(slug, entitySlug);
  let accessToken;
  try {
    accessToken = await refreshAccessToken(secretName);
  } catch (e) {
    if (e instanceof ErpUnavailable) return { error: e.message };
    throw e;
  }

  return { client, entity, tenantId, accessToken };
}

async function xeroGet(accessToken, tenantId, path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${XERO_API}${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Xero ${path} returned ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

// GET /api/finance/clients/:slug/xero/:entity/trial-balance
app.get("/api/finance/clients/:slug/xero/:entity/trial-balance", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const params = {};
  if (req.query.date) params.date = req.query.date;
  if (req.query.paymentsOnly) params.paymentsOnly = req.query.paymentsOnly;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", params);
  res.json({ entity: ctx.entity.name, report: data.Reports?.[0] ?? data });
}));

// GET /api/finance/clients/:slug/xero/:entity/profit-and-loss
app.get("/api/finance/clients/:slug/xero/:entity/profit-and-loss", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const params = {};
  if (req.query.fromDate) params.fromDate = req.query.fromDate;
  if (req.query.toDate) params.toDate = req.query.toDate;
  if (req.query.periods) params.periods = req.query.periods;
  if (req.query.timeframe) params.timeframe = req.query.timeframe;
  if (req.query.trackingCategoryID) params.trackingCategoryID = req.query.trackingCategoryID;
  if (req.query.trackingOptionID) params.trackingOptionID = req.query.trackingOptionID;
  if (req.query.standardLayout) params.standardLayout = req.query.standardLayout;
  if (req.query.paymentsOnly) params.paymentsOnly = req.query.paymentsOnly;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/ProfitAndLoss", params);
  res.json({ entity: ctx.entity.name, report: data.Reports?.[0] ?? data });
}));

// GET /api/finance/clients/:slug/xero/:entity/balance-sheet
app.get("/api/finance/clients/:slug/xero/:entity/balance-sheet", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const params = {};
  if (req.query.date) params.date = req.query.date;
  if (req.query.periods) params.periods = req.query.periods;
  if (req.query.timeframe) params.timeframe = req.query.timeframe;
  if (req.query.trackingOptionID) params.trackingOptionID = req.query.trackingOptionID;
  if (req.query.standardLayout) params.standardLayout = req.query.standardLayout;
  if (req.query.paymentsOnly) params.paymentsOnly = req.query.paymentsOnly;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/BalanceSheet", params);
  res.json({ entity: ctx.entity.name, report: data.Reports?.[0] ?? data });
}));

// GET /api/finance/clients/:slug/xero/:entity/bank-summary
app.get("/api/finance/clients/:slug/xero/:entity/bank-summary", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const params = {};
  if (req.query.fromDate) params.fromDate = req.query.fromDate;
  if (req.query.toDate) params.toDate = req.query.toDate;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/BankSummary", params);
  res.json({ entity: ctx.entity.name, report: data.Reports?.[0] ?? data });
}));

// GET /api/finance/clients/:slug/xero/:entity/aged-receivables
// Uses the Invoices API (Type==ACCREC with outstanding amounts) instead of the
// AgedReceivablesByContact report, which requires a contactId.
app.get("/api/finance/clients/:slug/xero/:entity/aged-receivables", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const params = {
    where: 'Type=="ACCREC" AND AmountDue>0',
    order: "DueDate",
  };
  if (req.query.page) params.page = req.query.page;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Invoices", params);
  const asAtDate = req.query.date || new Date().toISOString().slice(0, 10);
  const asAt = new Date(asAtDate);

  // Bucket into ageing periods
  const buckets = { current: 0, "30": 0, "60": 0, "90": 0, "90+": 0, total: 0 };
  const lines = (data.Invoices || []).map((inv) => {
    const due = new Date(inv.DueDateString || inv.DueDate);
    const daysOverdue = Math.floor((asAt - due) / 86400000);
    let bucket = "current";
    if (daysOverdue > 90) bucket = "90+";
    else if (daysOverdue > 60) bucket = "90";
    else if (daysOverdue > 30) bucket = "60";
    else if (daysOverdue > 0) bucket = "30";
    buckets[bucket] += inv.AmountDue;
    buckets.total += inv.AmountDue;
    return {
      invoiceNumber: inv.InvoiceNumber,
      contact: inv.Contact?.Name,
      dueDate: inv.DueDateString,
      amountDue: inv.AmountDue,
      currency: inv.CurrencyCode,
      daysOverdue: Math.max(0, daysOverdue),
      bucket,
    };
  });

  res.json({ entity: ctx.entity.name, asAtDate, buckets, invoiceCount: lines.length, invoices: lines });
}));

// GET /api/finance/clients/:slug/xero/:entity/aged-payables
// Uses the Invoices API (Type==ACCPAY with outstanding amounts) instead of the
// AgedPayablesByContact report, which requires a contactId.
app.get("/api/finance/clients/:slug/xero/:entity/aged-payables", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const params = {
    where: 'Type=="ACCPAY" AND AmountDue>0',
    order: "DueDate",
  };
  if (req.query.page) params.page = req.query.page;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Invoices", params);
  const asAtDate = req.query.date || new Date().toISOString().slice(0, 10);
  const asAt = new Date(asAtDate);

  const buckets = { current: 0, "30": 0, "60": 0, "90": 0, "90+": 0, total: 0 };
  const lines = (data.Invoices || []).map((inv) => {
    const due = new Date(inv.DueDateString || inv.DueDate);
    const daysOverdue = Math.floor((asAt - due) / 86400000);
    let bucket = "current";
    if (daysOverdue > 90) bucket = "90+";
    else if (daysOverdue > 60) bucket = "90";
    else if (daysOverdue > 30) bucket = "60";
    else if (daysOverdue > 0) bucket = "30";
    buckets[bucket] += inv.AmountDue;
    buckets.total += inv.AmountDue;
    return {
      invoiceNumber: inv.InvoiceNumber,
      contact: inv.Contact?.Name,
      dueDate: inv.DueDateString,
      amountDue: inv.AmountDue,
      currency: inv.CurrencyCode,
      daysOverdue: Math.max(0, daysOverdue),
      bucket,
    };
  });

  res.json({ entity: ctx.entity.name, asAtDate, buckets, invoiceCount: lines.length, invoices: lines });
}));

// GET /api/finance/clients/:slug/xero/:entity/accounts  (chart of accounts)
app.get("/api/finance/clients/:slug/xero/:entity/accounts", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return res.status(502).json({ error: ctx.error });

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts");
  res.json({ entity: ctx.entity.name, count: data.Accounts?.length ?? 0, data: data.Accounts ?? [] });
}));

// GET /api/finance/clients/:slug/entities  — list connected entities for a client
app.get("/api/finance/clients/:slug/entities", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT slug, name, legal_name, accounting_system, accounting_system_config,
            role, year_end
     FROM finance.entities WHERE client_id = $1 ORDER BY name`,
    [client.id]
  );

  res.json({
    count: rows.length,
    data: rows.map((e) => ({
      slug: e.slug,
      name: e.name,
      legalName: e.legal_name,
      accountingSystem: e.accounting_system,
      connected: Boolean(e.accounting_system_config?.tenant_id),
      role: e.role,
      yearEnd: e.year_end,
    })),
  });
}));

// ── Start ───────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => {
  console.log(`stza-finance-api listening on ${port}`);
});

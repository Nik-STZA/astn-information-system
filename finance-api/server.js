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

// X-Forwarded-For is a comma separated chain and the ip_address column is a
// Postgres inet, which takes exactly one address. Passing the raw header threw
// "invalid input syntax for type inet" and rolled back the transaction it was
// part of, which is how a bad audit value took a whole Xero connection with it.
//
// The caller already normalises this; doing it again here means a malformed
// header can never cost anything more than a null in the audit row.
function normaliseIp(value) {
  if (!value) return null;
  const first = String(value).split(",")[0].trim();
  if (!first) return null;
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(first);
  const candidate = bracketed ? bracketed[1] : first;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255) ? candidate : null;
  if (candidate.includes(":") && /^[0-9a-fA-F:.]+$/.test(candidate)) return candidate;
  return null;
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

// Reads the authorisation event id from the id token. Payload only: this
// selects among tenants Xero has already authorised, it is not an access
// decision, and the token came straight from Xero over TLS.
function readAuthEventId(idToken) {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return json.authentication_event_id || null;
  } catch {
    return null;
  }
}

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

  // Refuse rather than guess. A wrong tenant here is a journal in the wrong
  // company's books, which is worse than making the operator try again.
  if (matched.length !== 1) {
    console.error(
      `Ambiguous Xero connection: ${matched.length} of ${connections.length} matched auth event ${authEventId}`
    );
    return res.status(409).json({
      error:
        matched.length === 0
          ? "Could not identify which Xero organisation was authorised. Please try connecting again."
          : `${matched.length} organisations were authorised at once. Connect one organisation at a time.`,
    });
  }
  const tenant = matched[0];

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
        JSON.stringify({
          tenant_id: tenant.tenantId,
          tenant_name: tenant.tenantName,
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
        JSON.stringify({
          entity: entity.slug,
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
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
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
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

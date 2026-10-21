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
  isTokenRejection,
} = require("./lib/xero");
const {
  XERO_APIS,
  XERO_READ_REPORTS,
  resolveRead,
  stripPersonal,
  maskBankDetails,
  allowed: readAllowed,
} = require("./lib/xero-read");
const {
  balancesForCodes,
  buildXeroPayload,
  fromPence,
  requestFingerprint,
  trialBalanceByAccountId,
  validateJournal,
} = require("./lib/journal");
const writeRules = require("./lib/xero-write");
const confirmedRules = require("./lib/xero-confirmed");
const billChecks = require("./lib/bill-checks");
const payrollChecks = require("./lib/payroll-checks");
const supplierProposal = require("./lib/supplier-proposal");
const supplierPass = require("./lib/supplier-pass");
const supplierDecision = require("./lib/supplier-decision");
const vertex = require("./lib/vertex");
const {
  ageInvoices,
  fetchAllInvoices,
  legacyShape,
  outstandingWhere,
  summarise,
} = require("./lib/ageing");

const {
  ACCOUNT_CASH_FLOWS,
  BS_CASH_FLOWS,
  BS_SECTIONS,
  PNL_SECTIONS,
  accountRows,
  effectiveCategories,
  planMappingChanges,
  validateCategory,
} = require("./lib/coa-mapping");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── Database ────────────────────────────────────────────────────────────────

const poolConfig = {
  user: process.env.DB_USER || "africastn_app",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "africastn_os",
  max: 5,
  // Cloud Run runs this at concurrency 80 against a pool of 5, and the token
  // refresh holds a connection across a call to Xero. Without a bound,
  // pool.connect() queues forever and a slow upstream becomes a hung service
  // rather than a failed request. Fail fast enough to stay inside the 60s
  // Cloud Run request timeout.
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
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
    // err.detail carries the upstream reason (e.g. Xero's error body). The
    // caller is the Next.js server behind an API key, never a browser, so the
    // real cause is safe to return and is the difference between a one-minute
    // diagnosis and an afternoon.
    const body = { error: err.message };
    if (err.detail) body.detail = err.detail;
    // An upstream refusal is a bad gateway, not a fault in this service.
    // Reporting a Xero scope failure as 500 sends the reader looking for a bug
    // here, which is the same disguising-the-real-cause problem as swallowing
    // the error body.
    res.status(err.httpStatus || 500).json(body);
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

// The secret an entity actually uses. A reconnect stores one grant and points
// every entity of that client it reaches at it (see the callback), so this is
// read from the entity's config. Older rows without secret_name fall back to
// the per-entity name they were connected under.
const entitySecretName = (clientSlug, entity) =>
  entity.accounting_system_config?.secret_name || refreshSecretName(clientSlug, entity.slug);

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
// Returns the row id, which the journal endpoint reports back to the caller so
// a posted journal can be traced to its record without a second lookup.
async function audit(conn, { actorEmail, actorRole, action, targetType, targetId, clientId, payload, ip }) {
  const { rows } = await conn.query(
    `INSERT INTO finance.audit_log
       (actor_email, actor_role, action, target_type, target_id, client_id, payload, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [actorEmail, actorRole || null, action, targetType, targetId, clientId, payload || {}, normaliseIp(ip)]
  );
  return rows[0].id;
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
    const secretName = entitySecretName(req.params.slug, e);
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

  const { rows: secretEntity } = await pool.query(
    "SELECT slug, accounting_system_config FROM finance.entities WHERE client_id = $1 AND slug = $2",
    [client.id, req.params.entity]
  );
  const names = {
    client_id: "xero-app-client-id",
    client_secret: "xero-app-client-secret",
    refresh_token: secretEntity.length
      ? entitySecretName(req.params.slug, secretEntity[0])
      : refreshSecretName(req.params.slug, req.params.entity),
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
        ip: normaliseIp(req.get("X-Forwarded-For") || req.ip),
      });
      return res.status(404).json({ error: "not connected" });
    }

    const value = await readSecret(secretName);

    // The payload records that it happened and to what, never the value.
    await audit(conn, {
      actorEmail, action: `${action}_secret`, targetType: "xero_secret",
      targetId: `${req.params.entity}:${field}`, clientId: client.id,
      payload: { field, entity: req.params.entity, secretName },
      ip: normaliseIp(req.get("X-Forwarded-For") || req.ip),
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
  "profile",
  "email",
  "offline_access",
  // Widened 16 Oct 2026 to the laptop MCP's 23 scopes on the same STZA Finance
  // app, so the portal and the laptop hold the same grant (one engine; see
  // docs/ap-lane/xero-capability-register.md). Each scope was probed against
  // the authorize URL on 16 Oct and accepted. A scope only permits a call: no
  // write happens without a finance-api endpoint, and every write endpoint keeps
  // the draft-then-approve rule. Existing connections keep their old grant until
  // each entity reconnects.
  "accounting.settings",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.attachments",
  "accounting.budgets.read",
  "files",
  "assets",
  "payroll.settings.read",
  "payroll.payruns.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.aged.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.budgetsummary.read",
  // accounting.journals.read is deliberately absent: Xero answers invalid_scope
  // for it on this app (granular scopes), and one invalid scope makes Xero reject
  // the whole authorisation, so adding it would break every connection. Test any
  // change here against the authorize URL before deploying.
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

// Access tokens live 30 minutes. Cache them per instance so a burst of report
// pulls does not refresh each time: every refresh rotates the Xero refresh
// token, so refreshing needlessly is what made the rotation race likely.
const accessTokenCache = new Map(); // secretName -> { token, expiresAt }
const ACCESS_TOKEN_SKEW_MS = 120_000;

function cachedAccessToken(secretName) {
  const hit = accessTokenCache.get(secretName);
  if (hit && hit.expiresAt - ACCESS_TOKEN_SKEW_MS > Date.now()) return hit.token;
  return null;
}

// Caching introduces a failure the uncached code could not have: if an entity
// is reconnected, Xero invalidates the access token we are still holding and
// every read 401s until the cache expires. Drop the entry on 401 so the next
// call refreshes instead of failing for up to half an hour.
function invalidateAccessToken(token) {
  for (const [name, hit] of accessTokenCache) {
    if (hit.token === token) accessTokenCache.delete(name);
  }
}

// Structured, alertable. Create a log-based alert in Cloud Logging on
// jsonPayload.alert = "xero_connection_dead". A dead Xero connection went
// unnoticed from 12 July to 14 August 2026 because nothing did this.
function alertOps(event, detail) {
  console.error(JSON.stringify({ severity: "ERROR", alert: event, ...detail }));
}

// Exchanges a stored refresh token for an access token, and persists the
// rotated refresh token immediately.
//
// Xero refresh tokens are single use: every refresh returns a new one and
// invalidates the one just used. If the new token is not stored before
// anything else can fail, the connection is dead and only re-authorising
// recovers it. So the write happens first, before the access token is
// returned to the caller.
//
// The whole read-refresh-store sequence is serialised per entity. Without
// that, two concurrent callers both read version N, both call Xero, and the
// loser is left holding a token Xero has already consumed. That is exactly
// how all three Feldspar connections died within three minutes of each other
// on 12 July 2026.
async function refreshAccessToken(secretName) {
  const cached = cachedAccessToken(secretName);
  if (cached) return cached;

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");

    // Bound the wait. pg_advisory_xact_lock blocks indefinitely by default, so
    // a holder stuck on a slow Xero call would park every other caller for this
    // entity behind it with no upper limit — and each waiter burns one of the
    // five pool connections while it waits. On timeout Postgres raises 55P03
    // (lock_not_available), which we turn into a retryable error below.
    await conn.query("SET LOCAL lock_timeout = '15s'");

    // Transaction scoped: released on commit or rollback.
    await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `finance.xero_refresh:${secretName}`,
    ]);

    let accessToken = cachedAccessToken(secretName);

    if (!accessToken) {
      // Read inside the lock. A value read before waiting would be the token
      // the previous holder has already rotated away.
      const refreshToken = await readSecret(secretName);
      const [clientId, clientSecret] = await Promise.all([
        readSecret("xero-app-client-id"),
        readSecret("xero-app-client-secret"),
      ]);

      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      let r;
      try {
        r = await fetch(XERO_TOKEN_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
          // Node's fetch has no default timeout. Without this a hung connection
          // to Xero holds the advisory lock and a pool connection for as long as
          // the socket stays open — Cloud Run's 60s request timeout returns 504
          // to the caller but does not stop this handler.
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        const err = new ErpUnavailable("Xero did not respond to the token refresh in time.");
        err.detail = { stage: "token_refresh", reason: e.name === "TimeoutError" ? "timeout" : e.message };
        throw err;
      }

      if (!r.ok) {
        const body = await r.text();
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 500) }; }

        // Only a genuinely dead grant gets the alert that pages someone.
        // invalid_grant means the refresh token is gone and no retry will fix
        // it. A 429 or a 503 is Xero having a moment and resolves itself —
        // alerting on those would train everyone to ignore the one alert that
        // matters, which is how the 12 July outage stayed invisible for five
        // weeks in the first place.
        const dead = parsed.error === "invalid_grant";
        alertOps(dead ? "xero_connection_dead" : "xero_refresh_failed", {
          secretName,
          status: r.status,
          xeroError: parsed.error || null,
          xeroErrorDescription: parsed.error_description || null,
        });

        // Pass the reason through. Discarding it is what turned
        // "invalid_grant: refresh token has been consumed" into an opaque
        // "400 Bad Request" and cost an afternoon of diagnosis.
        const err = new ErpUnavailable(
          dead
            ? "The Xero connection has expired. Reconnect this entity."
            : `Xero refused the token refresh (${r.status})`
        );
        err.detail = { stage: "token_refresh", status: r.status, xero: parsed };
        throw err;
      }

      const tokens = await r.json();
      if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
        await storeSecret(secretName, tokens.refresh_token);
      }
      accessToken = tokens.access_token;
      accessTokenCache.set(secretName, {
        token: accessToken,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 1800) * 1000,
        mintedAt: Date.now(),
      });
    }

    await conn.query("COMMIT");
    return accessToken;
  } catch (err) {
    try { await conn.query("ROLLBACK"); } catch { /* connection already gone */ }

    // 55P03: we waited 15s for the lock and someone else still holds it. If
    // that holder finished a refresh on this instance the cache is now warm,
    // so check before failing — the answer we were queuing for may have
    // arrived while we were giving up.
    if (err.code === "55P03") {
      const warmed = cachedAccessToken(secretName);
      if (warmed) return warmed;
      const busy = new ErpUnavailable("Xero token refresh is busy for this entity. Retry shortly.");
      busy.detail = { stage: "token_refresh", reason: "lock_timeout", secretName };
      throw busy;
    }
    throw err;
  } finally {
    conn.release();
  }
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
  // A new refresh token means any access token cached from the old one is from
  // a different grant: after a reconnect it lacks the scopes the reconnect
  // added. On 11 Sep 2026 that kept /Payments refused for half an hour after all
  // four entities had reconnected. Refresh itself stores then re-caches, so this
  // never discards a fresh token.
  accessTokenCache.delete(name);
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
  let alsoUpdated = [];
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

    // One authorisation reaches every organisation on the grant, so point the
    // client's other connected entities at this one too: one reconnect then
    // carries new scopes to all of them. They share the secret rather than get
    // a copy, because Xero rotates the refresh token on every use and a copy
    // would die on the first refresh; sharing it also shares the refresh lock,
    // which is keyed by secret name. Only entities already mapped to a tenant
    // this token reaches move, and only within this client, so one client's
    // reconnect never touches another client's connection.
    const reachable = connections.map((c) => c.tenantId);
    const { rows: siblingRows } = await conn.query(
      `UPDATE finance.entities
       SET accounting_system_config = accounting_system_config || $3::jsonb
       WHERE client_id = $1 AND id <> $2
         AND accounting_system_config->>'tenant_id' = ANY($4::text[])
       RETURNING slug`,
      [
        client.id,
        entity.id,
        JSON.stringify({
          connected_at: now,
          last_refreshed_at: now,
          scopes: XERO_SCOPES.split(" "),
          secret_name: secretName,
        }),
        reachable,
      ]
    );
    alsoUpdated = siblingRows.map((r) => r.slug);

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
          alsoUpdated,
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
    alsoUpdated,
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

  const secretName = entitySecretName(req.params.slug, entity);
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
      ip: normaliseIp(req.get("X-Forwarded-For") || req.ip),
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

  const { agent, instruction, parentRunId } = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();

  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ error: "instruction is required" });
  }

  // A follow-up is a new run naming the one it replies to (migration 014). The
  // parent must be this client's, or a reply could pull another client's
  // answers into this conversation, and it must be finished, because an answer
  // still being written is not something to reply to.
  let parent = null;
  if (parentRunId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(parentRunId))) {
      return res.status(400).json({ error: "parentRunId is not a run id" });
    }
    const p = await pool.query(
      "SELECT id, agent, finished_at FROM finance.agent_runs WHERE id = $1 AND client_id = $2",
      [parentRunId, client.id]
    );
    parent = p.rows[0];
    if (!parent) return res.status(404).json({ error: "the run being followed up was not found for this client" });
    if (!parent.finished_at) return res.status(409).json({ error: "that run has not finished yet" });
  }

  const role = await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [
    client.id, actorEmail,
  ]);

  const { rows } = await pool.query(
    `INSERT INTO finance.agent_runs
       (client_id, requested_by_email, requested_by_role, agent, instruction, status, parent_run_id)
     VALUES ($1,$2,$3,$4,$5,'queued',$6)
     RETURNING id, agent, instruction, status, queued_at, parent_run_id`,
    [
      client.id, actorEmail, role.rows[0].role,
      agent || parent?.agent || null, String(instruction).trim(), parent?.id ?? null,
    ]
  );
  res.status(201).json(rows[0]);
}));

app.get("/api/finance/clients/:slug/agent-runs", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT id, parent_run_id, agent, instruction, status, session_id, output, error,
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
       RETURNING r.id, r.agent, r.instruction, r.client_id, r.parent_run_id`
    );
    if (!rows.length) {
      await conn.query("COMMIT");
      return res.status(204).end();
    }
    const job = rows[0];

    // A follow-up travels with the conversation so far, oldest turn first and
    // at most the 20 most recent turns. Question and answer only (migration
    // 014). The direct parent's session id lets a Claude Code runner resume
    // that session where it holds the transcript locally.
    let thread = [];
    let parentSessionId = null;
    if (job.parent_run_id) {
      const t = await conn.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_run_id, instruction, output, error, session_id, 1 AS depth
             FROM finance.agent_runs WHERE id = $1
           UNION ALL
           SELECT r.id, r.parent_run_id, r.instruction, r.output, r.error, r.session_id, chain.depth + 1
             FROM finance.agent_runs r JOIN chain ON r.id = chain.parent_run_id
            WHERE chain.depth < 20
         )
         SELECT instruction, output, error, session_id, depth FROM chain ORDER BY depth DESC`,
        [job.parent_run_id]
      );
      thread = t.rows.map(({ instruction, output, error }) => ({ instruction, output, error }));
      parentSessionId = t.rows.find((r) => r.depth === 1)?.session_id ?? null;
    }

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
      parentRunId: job.parent_run_id,
      thread,
      parentSessionId,
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
    processingPath, processingPathLabel,
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
         duration_ms = $8, cost_usd = $9, wip_ref = $10,
         processing_path = COALESCE($11, processing_path),
         processing_path_label = COALESCE($12, processing_path_label),
         finished_at = now()
     WHERE id = $1 AND finished_at IS NULL
     RETURNING id, status, finished_at`,
    [
      req.params.id, status, sessionId || null, output || null, error || null,
      toolsUsed ? JSON.stringify(toolsUsed) : null,
      filesTouched ? JSON.stringify(filesTouched) : null,
      durationMs || null, costUsd || null, wipRef || null,
      processingPath || null, processingPathLabel || null,
    ]
  );

  if (!rows.length) {
    return res.status(409).json({ error: "run not found, or already finished and therefore immutable" });
  }
  res.json(rows[0]);
}));

// ── Report runs ─────────────────────────────────────────────────────────────
//
// Generated reports, starting with the management pack (migration 015). Same
// shape as agent runs: the portal queues, a runner on the operator's machine
// builds (scripts/report-runner.mjs), and the row records what was asked for
// and where the output went. Paths only, never contents.

const {
  packRouting,
  initialRun,
  startPackJob,
  STALE_RUNNING_MINUTES,
  STALE_QUEUED_HOURS,
  NO_PIPELINE_MESSAGE,
} = require("./lib/pack-job");

const REPORTS = new Set(["management_pack"]);

app.post("/api/finance/clients/:slug/report-runs", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { report, period } = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();

  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  if (!REPORTS.has(report)) return res.status(400).json({ error: "unknown report" });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ""))) {
    return res.status(400).json({ error: "period must be YYYY-MM" });
  }
  // A month that has not started has nothing to report.
  if (String(period) > new Date().toISOString().slice(0, 7)) {
    return res.status(400).json({ error: "that month has not started yet" });
  }

  const role = await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [
    client.id, actorEmail,
  ]);

  // A client with nowhere to build is refused, not queued: a row nothing can run
  // would sit there for ever and block every later build of the month.
  const routing = packRouting(req.params.slug);
  const { executor } = routing;
  if (executor === "none") return res.status(409).json({ error: NO_PIPELINE_MESSAGE, executor });

  // A build that never reported back, or was never picked up, still holds the
  // month's only slot (migration 015 allows one queued or running build per
  // period). Past those limits it is treated as failed, so the month can be built again.
  await pool.query(
    `UPDATE finance.report_runs
        SET status = 'failed', finished_at = now(),
            error = COALESCE(error, CASE status
              WHEN 'running' THEN 'the build never reported back; treated as failed'
              ELSE 'nothing picked this build up; treated as failed' END)
      WHERE client_id = $1 AND report = $2 AND period = $3
        AND ((status = 'running' AND started_at < now() - make_interval(mins => $4))
          OR (status = 'queued'  AND queued_at  < now() - make_interval(hours => $5)))`,
    [client.id, report, period, STALE_RUNNING_MINUTES, STALE_QUEUED_HOURS]
  );

  // A cloud client's run is never offered to the laptop runner: it is created
  // already running, because /report-runs/claim only takes queued rows and the
  // Cloud Run Job is handed its run id directly rather than claiming one.
  const opening = initialRun(executor);

  try {
    const { rows } = await pool.query(
      `INSERT INTO finance.report_runs
         (client_id, report, period, requested_by_email, requested_by_role, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, report, period, status, queued_at`,
      [client.id, report, period, actorEmail, role.rows[0].role, opening.status, opening.startedAt]
    );
    const run = rows[0];

    if (executor === "cloud") {
      try {
        const started = await startPackJob({
          project: process.env.GCP_PROJECT,
          region: process.env.PACK_JOB_REGION,
          job: routing.job,
          runId: run.id,
          clientSlug: req.params.slug,
          period,
        });
        await pool.query(
          "UPDATE finance.report_runs SET log_tail = $2 WHERE id = $1",
          [run.id, `Cloud build started: ${started.execution || started.operation || "job accepted"}`]
        );
      } catch (e) {
        // The run exists and is running, so nothing else can build this month
        // until it is closed. Record why it never started.
        await pool.query(
          `UPDATE finance.report_runs
              SET status = 'failed', finished_at = now(), error = $2
            WHERE id = $1`,
          [run.id, String(e.message).slice(0, 500)]
        );
        return res.status(502).json({ error: "the cloud build could not be started", detail: e.message });
      }
    }

    res.status(201).json({ ...run, executor });
  } catch (e) {
    // The partial unique index allows one queued or running build per period.
    if (e.code === "23505") {
      return res.status(409).json({ error: "a build for that month is already queued or running" });
    }
    throw e;
  }
}));

app.get("/api/finance/clients/:slug/report-runs", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows } = await pool.query(
    `SELECT id, report, period, status, output_files, log_tail, error, duration_ms,
            requested_by_email, requested_by_role, queued_at, started_at, finished_at,
            watermarks
       FROM finance.report_runs
      WHERE client_id = $1 AND ($2::text IS NULL OR report = $2)
      ORDER BY queued_at DESC
      LIMIT 50`,
    [client.id, req.query.report ? String(req.query.report) : null]
  );
  // Where this client's packs build, so the page can say what a person has to
  // do: start the laptop runner, or nothing at all.
  const routing = packRouting(req.params.slug);
  res.json({ count: rows.length, data: rows, executor: routing.executor, pipeline: routing.pipeline });
}));

// One build at a time per runner; SKIP LOCKED keeps a second runner off it.
app.post("/api/finance/report-runs/claim", route(async (_req, res) => {
  const { rows } = await pool.query(
    `WITH next AS (
       SELECT id FROM finance.report_runs
        WHERE status = 'queued'
        ORDER BY queued_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE finance.report_runs r
        SET status = 'running', started_at = now()
       FROM next WHERE r.id = next.id
     RETURNING r.id, r.report, r.period, r.client_id`
  );
  if (!rows.length) return res.status(204).end();

  const job = rows[0];
  const c = await pool.query("SELECT slug, name FROM shared.clients WHERE id = $1", [job.client_id]);
  res.json({ id: job.id, report: job.report, period: job.period, client: c.rows[0] });
}));

app.post("/api/finance/report-runs/:id/complete", route(async (req, res) => {
  const { status, outputFiles, logTail, error, durationMs, watermarks } = req.body || {};
  if (!["succeeded", "failed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be succeeded, failed or cancelled" });
  }

  // Where the build's change check started from (migration 016): entity slug to
  // an ISO timestamp, nothing else, because the next build asks Xero for
  // everything modified since then to decide which years it can skip.
  const marks =
    watermarks && typeof watermarks === "object" && !Array.isArray(watermarks) &&
    Object.values(watermarks).every((v) => typeof v === "string" && !Number.isNaN(Date.parse(v)))
      ? watermarks
      : null;

  // finished_at is set here, which is what makes the row immutable afterwards.
  const { rows } = await pool.query(
    `UPDATE finance.report_runs
        SET status = $2,
            output_files = COALESCE($3::jsonb, '[]'::jsonb),
            log_tail = $4, error = $5, duration_ms = $6,
            watermarks = $7::jsonb,
            finished_at = now()
      WHERE id = $1 AND finished_at IS NULL
      RETURNING id, status, finished_at`,
    [
      req.params.id, status,
      outputFiles ? JSON.stringify(outputFiles) : null,
      logTail ? String(logTail).slice(-8000) : null,
      error ? String(error).slice(0, 2000) : null,
      durationMs || null,
      marks ? JSON.stringify(marks) : null,
    ]
  );

  if (!rows.length) {
    return res.status(409).json({ error: "run not found, or already finished and therefore immutable" });
  }
  res.json(rows[0]);
}));

// ── Pack changes ────────────────────────────────────────────────────────────
//
// What moved in each entity's ledger since the last successful pack build, so
// a build re-pulls only the years that changed and a person sees back-dated
// entries before the pack goes out. The reasoning, and the blind spot, are in
// lib/ledger-changes.js.

const fiscal = require("./lib/fiscal");
const {
  LEDGER_DOCUMENTS,
  documentsFrom,
  neverPosted,
  needsHistoryCheck,
  historyShowsLedgerChange,
  summariseChanges,
} = require("./lib/ledger-changes");

// 2,000 changed documents of one type since the last build is not a month's
// activity for these clients; past that, re-pull everything rather than trust a
// partial scan.
const CHANGE_SCAN_PAGES = 20;

// History is read one document at a time, against Xero's 60 calls a minute per
// organisation. Past this many candidates, count them all rather than spend the
// limit: over-counting only costs a longer build.
const HISTORY_CHECK_LIMIT = 40;

async function entityChanges(slug, entity, since, reportingYear, yearEndMonth) {
  const ctx = await xeroEntityContext(slug, entity.slug);
  if (!ctx) return { entity: entity.slug, status: "not_connected" };
  if (ctx.error) return { entity: entity.slug, status: "error", error: ctx.error };

  if (!since) {
    return {
      entity: entity.slug,
      status: "baseline",
      note: "No earlier build to compare with: this build pulls every year and records when it started.",
    };
  }

  try {
    const lockDates = await xeroLockDates(ctx);
    // Xero documents If-Modified-Since as a UTC timestamp without a zone.
    const headers = { "If-Modified-Since": new Date(since).toISOString().slice(0, 19) };
    const docs = [];
    for (const [resource, spec] of Object.entries(LEDGER_DOCUMENTS)) {
      for (let page = 1; ; page++) {
        if (page > CHANGE_SCAN_PAGES) {
          return {
            entity: entity.slug,
            status: "too_many",
            note: `More than ${CHANGE_SCAN_PAGES * 100} ${spec.label} changed since the last build: pulling every year.`,
          };
        }
        const params = spec.paged ? { page: String(page) } : {};
        const batch = documentsFrom(resource, await xeroGet(ctx.accessToken, ctx.tenantId, resource, params, headers));
        docs.push(...batch);
        if (!spec.paged || batch.length < 100) break;
      }
    }

    // Drafts never posted. A document that could move an old or locked period
    // has its history read, and counts only if something other than a payment
    // or an attachment happened since the watermark. lib/ledger-changes.js has
    // the 11 Sep 2026 case that made this necessary.
    const posted = docs.filter((d) => !neverPosted(d));
    const candidates = posted.filter((d) => needsHistoryCheck(d, { reportingYear, lockDates, yearEndMonth }));
    const setAside = new Set();
    let historyNote = null;
    if (candidates.length > HISTORY_CHECK_LIMIT) {
      historyNote =
        `${candidates.length} documents in old or locked periods changed: too many to check one by one, so all are counted.`;
    } else {
      for (const d of candidates) {
        const h = await xeroGet(ctx.accessToken, ctx.tenantId, `${d.resource}/${d.id}/History`);
        if (!historyShowsLedgerChange(h?.HistoryRecords, since)) setAside.add(d);
      }
    }

    const summary = summariseChanges(
      posted.filter((d) => !setAside.has(d)),
      { since, reportingYear, lockDates, yearEndMonth }
    );
    summary.ignored = {
      neverPosted: docs.length - posted.length,
      paymentOrAttachmentOnly: setAside.size,
    };
    if (historyNote) summary.flags.push(historyNote);
    return { entity: entity.slug, status: "ok", ...summary };
  } catch (e) {
    // A 401 or 403 here almost always means the connection predates a scope the
    // check needs (accounting.payments.read was added on 11 Sep 2026).
    const refused = e.detail?.status === 401 || e.detail?.status === 403;
    return {
      entity: entity.slug,
      status: "error",
      error: refused
        ? `Xero refused ${e.detail?.path ?? "a read"}. Reconnect this entity on the Xero tab so the connection includes the newer permissions.`
        : e.message,
    };
  }
}

// GET /api/finance/clients/:slug/pack-changes?report=management_pack&period=YYYY-MM
app.get("/api/finance/clients/:slug/pack-changes", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const report = String(req.query.report || "management_pack");
  const period = String(req.query.period || "");
  if (!REPORTS.has(report)) return res.status(400).json({ error: "unknown report" });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: "period must be YYYY-MM" });
  // Years are financial years, named by the calendar year they end in: STZA's
  // August 2026 is in 2027 (April 2026 to March 2027). A December year end, like
  // Feldspar's, gives the calendar year, as before.
  const ye = await pool.query("SELECT year_end FROM shared.clients WHERE id = $1", [client.id]);
  const yearEndMonth = fiscal.yearEndMonth(ye.rows[0]?.year_end);
  const reportingYear = fiscal.fiscalYearOfPeriod(period, yearEndMonth);

  const last = await pool.query(
    `SELECT id, period, finished_at, watermarks
       FROM finance.report_runs
      WHERE client_id = $1 AND report = $2 AND status = 'succeeded' AND watermarks IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1`,
    [client.id, report]
  );
  const previous = last.rows[0] ?? null;

  const ents = await pool.query(
    `SELECT slug, name FROM finance.entities
      WHERE client_id = $1 AND accounting_system_config->>'tenant_id' IS NOT NULL
      ORDER BY slug`,
    [client.id]
  );

  // ?since= asks "what has changed since then" regardless of the last build:
  // useful on its own, and the only way to see the check work before a build
  // has recorded a watermark.
  const since = String(req.query.since || "");
  const override = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null;

  // Taken before the scans, so a change made while they run is caught next time
  // rather than missed.
  const checkedAt = new Date().toISOString();

  // Separate organisations, so separate Xero rate limits: safe to run together.
  const entities = await Promise.all(
    ents.rows.map(async (e) => ({
      name: e.name,
      ...(await entityChanges(req.params.slug, e, override ?? previous?.watermarks?.[e.slug] ?? null, reportingYear, yearEndMonth)),
    }))
  );

  // Anything short of a clean answer for every entity means pulling every
  // year: a year wrongly skipped gives a pack with stale comparatives and no error.
  const clean = entities.length > 0 && entities.every((x) => x.status === "ok");
  const yearsToRepull = clean
    ? [...new Set(entities.flatMap((x) => x.yearsToRepull))].sort((a, b) => a - b)
    : null;
  // A build that starts now and succeeds leaves every entity fresh as of now:
  // a clean check re-pulls what changed, anything else re-pulls every year.
  const watermarks = Object.fromEntries(entities.map((x) => [x.entity, checkedAt]));

  res.json({
    client: req.params.slug,
    report,
    period,
    previousBuild: previous ? { id: previous.id, period: previous.period, finishedAt: previous.finished_at } : null,
    entities,
    // yearsToRepull and reportingYear are financial years named by the calendar
    // year they end in; yearEndMonth says which month that is.
    reportingYear,
    yearEndMonth,
    pullAllYears: !clean,
    yearsToRepull,
    watermarks,
  });
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
    `SELECT e.id, e.slug, e.name, e.legal_name, e.accounting_system_config
     FROM finance.entities e
     WHERE e.client_id = $1 AND e.slug = $2`,
    [client.id, entitySlug]
  );
  if (!rows.length) return null;

  const entity = rows[0];
  const tenantId = entity.accounting_system_config?.tenant_id;
  if (!tenantId) return null;

  const secretName = entitySecretName(slug, entity);

  // storeSecret clears the cache only on the instance that handled the
  // reconnect; others would keep a token from the old grant for up to 30
  // minutes. connected_at is written on every reconnect and this row is read on
  // every call, so a cached token minted before it is dropped everywhere.
  const reconnectedAt = Date.parse(entity.accounting_system_config?.connected_at ?? "");
  const cached = accessTokenCache.get(secretName);
  if (cached && Number.isFinite(reconnectedAt) && (cached.mintedAt ?? 0) < reconnectedAt) {
    accessTokenCache.delete(secretName);
  }

  let accessToken;
  try {
    accessToken = await refreshAccessToken(secretName);
  } catch (e) {
    // Carry the detail out with the message. Returning only e.message here is
    // what made attaching err.detail pointless on every read route: the
    // friendly string reached the caller and Xero's actual reason
    // ("invalid_grant: refresh token has been consumed") was dropped one frame
    // below the place it was needed.
    if (e instanceof ErpUnavailable) return { error: e.message, detail: e.detail };
    throw e;
  }

  return { client, entity, tenantId, accessToken };
}

// Every read route ends with the same three lines. Keeping the shape identical
// means the detail cannot be dropped from one of them by accident.
function erpUnavailable(res, ctx) {
  const body = { error: ctx.error };
  if (ctx.detail) body.detail = ctx.detail;
  return res.status(502).json(body);
}

// extraHeaders is for internal callers only (the pack change check sends
// If-Modified-Since). The read passthrough never forwards a caller's headers.
// One Xero GET. `url` is either an accounting path ("/Invoices") or a full URL
// on another Xero API (Files, Assets, Payroll). Returns the fetch Response;
// non-2xx responses throw with Xero's body attached.
async function xeroFetch(accessToken, tenantId, url, params = {}, { accept = "application/json", extraHeaders = {} } = {}) {
  const full = url.startsWith("https://") ? url : `${XERO_API}${url}`;
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${full}${qs ? `?${qs}` : ""}`, {
    headers: {
      ...extraHeaders,
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: accept,
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const path = full.replace(/^https:\/\/api\.xero\.com/, "");
    // Only drop the cached token when Xero is rejecting the token itself. A 401
    // for a scope that was never granted is permanent, so invalidating on it
    // would refresh — and rotate — on every call of a loop that can never
    // succeed. See isTokenRejection.
    if (r.status === 401 && isTokenRejection(r.headers.get("www-authenticate"), body)) {
      invalidateAccessToken(accessToken);
    }
    const err = new Error(`Xero ${path} returned ${r.status}: ${body.slice(0, 300)}`);
    // Same reasoning as the token refresh: the caller is a server holding an
    // API key, and Xero's body is the difference between "it broke" and
    // knowing which account code it objected to.
    err.detail = { stage: "xero_read", status: r.status, path, body: body.slice(0, 2000) };
    err.httpStatus = 502;
    throw err;
  }
  return r;
}

async function xeroGet(accessToken, tenantId, path, params = {}, extraHeaders = {}) {
  const r = await xeroFetch(accessToken, tenantId, path, params, { extraHeaders });
  return r.json();
}

// Read passthrough.
//
// The typed endpoints below shape the reports the portal renders. The reporting
// scripts need a wider surface than that — Invoices, Contacts, Payments,
// BankTransactions, ExecutiveSummary, AccountTransactions — and until they have
// it they each hold their own copy of the Xero credentials and refresh their own
// tokens. Twenty-two separate holders is what killed all three Feldspar
// connections on 12 July 2026.
//
// So: one allowlisted, read-only door. GET only, and never a mutating verb.
// Writes stay on explicit, validated, audited endpoints — a blanket proxy would
// hand every script the ability to post to a client ledger, which is the thing
// this whole exercise exists to prevent.
// Every entry is backed by an actual caller in the migrating scripts. Three
// speculative entries were removed on 14 August 2026 after checking them
// against the inventory: /CreditNotes and /Reports/BudgetSummary had no caller
// anywhere, and /Reports/AccountTransactions is not a Xero endpoint at all —
// xero-server.py:590 records that account-level transactions come from
// /Journals, which kept that one until 16 Oct 2026 (removed below: the scope
// cannot be granted).
//
// An allowlist that promises more than the grant can deliver is worse than a
// short one: the caller gets a 401 from Xero instead of an honest 404 listing
// what is actually available.
//
// Widened 16 Oct 2026 to every read tool in the laptop MCP, so the portal and
// the laptop reach the same data through one token holder. The allowlist and
// the payroll redaction live in lib/xero-read.js, where they are tested.
async function xeroReadPassthrough(req, res, target) {
  if (!target.ok) {
    const { ok, status, ...body } = target;
    return res.status(status).json(body);
  }
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

  // Forward the caller's query string untouched: Xero's own filters (where,
  // order, page, date, fromDate, toDate, periods, timeframe) differ per
  // resource and re-implementing them here would just be a second place to be
  // wrong.
  const r = await xeroFetch(ctx.accessToken, ctx.tenantId, target.url, { ...(target.defaults || {}), ...req.query }, { accept: target.accept });

  if (target.binary) {
    // PDFs, attachments and Files content: passed through as bytes, never
    // parsed. Content-Disposition names the file when Xero supplies one.
    const buf = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", r.headers.get("content-type") || target.accept);
    const disposition = r.headers.get("content-disposition");
    if (disposition) res.set("Content-Disposition", disposition);
    res.set("X-Xero-Entity", ctx.entity.name);
    return res.send(buf);
  }

  let data = maskBankDetails(await r.json());
  if (target.personal) data = stripPersonal(data);
  res.json({
    entity: ctx.entity.name,
    resource: target.path,
    ...(target.personal ? { note: "Per-person payroll data removed by the server." } : {}),
    data,
  });
}

const reportTarget = (report) => {
  const path = XERO_READ_REPORTS[report];
  return path
    ? { ok: true, url: path, path, accept: "application/json", binary: false, personal: false }
    : { ok: false, status: 404, error: "unknown report", allowed: readAllowed() };
};

// GET /api/finance/clients/:slug/xero/:entity/read/reports/:report
// Registered before the :resource routes so "reports" is never read as one.
app.get("/api/finance/clients/:slug/xero/:entity/read/reports/:report", route(async (req, res) =>
  xeroReadPassthrough(req, res, reportTarget(req.params.report))
));

// GET .../read/:resource/:id/attachments/:name   one attached file (bytes)
app.get("/api/finance/clients/:slug/xero/:entity/read/:resource/:id/attachments/:name", route(async (req, res) =>
  xeroReadPassthrough(req, res, resolveRead(req.params))
));

// GET .../read/:resource/:id/:sub   history, attachments, pdf, online, cis,
// associations, content. History callers include the pack-changes check, which
// must tell a bill that was merely paid from one whose lines were edited.
app.get("/api/finance/clients/:slug/xero/:entity/read/:resource/:id/:sub", route(async (req, res) =>
  xeroReadPassthrough(req, res, resolveRead(req.params))
));

// GET .../read/:resource/:id   one record
app.get("/api/finance/clients/:slug/xero/:entity/read/:resource/:id", route(async (req, res) =>
  xeroReadPassthrough(req, res, resolveRead(req.params))
));

// GET .../read/:resource   a list (Xero's own filters pass through)
app.get("/api/finance/clients/:slug/xero/:entity/read/:resource", route(async (req, res) =>
  xeroReadPassthrough(req, res, resolveRead(req.params))
));

// GET /api/finance/clients/:slug/xero/:entity/trial-balance
app.get("/api/finance/clients/:slug/xero/:entity/trial-balance", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

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
  if (ctx.error) return erpUnavailable(res, ctx);

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
  if (ctx.error) return erpUnavailable(res, ctx);

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
  if (ctx.error) return erpUnavailable(res, ctx);

  const params = {};
  if (req.query.fromDate) params.fromDate = req.query.fromDate;
  if (req.query.toDate) params.toDate = req.query.toDate;

  const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/BankSummary", params);
  res.json({ entity: ctx.entity.name, report: data.Reports?.[0] ?? data });
}));

// ── Ageing (AP and AR) ──────────────────────────────────────────────────────
//
// Both use the Invoices API (outstanding AUTHORISED invoices of one type)
// rather than the Aged…ByContact reports, which require a contactId. The
// deciding happens in lib/ageing.js; this is only fetching.

// Every page of one entity's outstanding invoices of `type`.
async function fetchOutstandingInvoices(ctx, type) {
  return fetchAllInvoices(async (page) => {
    const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Invoices", {
      where: outstandingWhere(type),
      order: "DueDate",
      page: String(page),
    });
    return data.Invoices || [];
  });
}

// All entities of a client, connected or not. Used both to choose what to
// fetch and as the name list for spotting intercompany balances.
async function clientEntities(clientId) {
  const { rows } = await pool.query(
    `SELECT slug, name, legal_name, accounting_system_config
     FROM finance.entities WHERE client_id = $1 ORDER BY name`,
    [clientId]
  );
  return rows;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The per-entity endpoints the agent runner calls. Response shape and bucket
// keys are unchanged; what changed is that drafts and bills awaiting approval
// no longer count, and every page is read rather than the first 100. A caller
// that sends `page` still gets exactly that page.
//
// `date` is kept for compatibility, but note what it means: today's AmountDue
// aged against that date. It is not a historical ageing.
async function perEntityAgeing(req, res, type) {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

  const asAtDate = req.query.date || new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(asAtDate)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  let invoices;
  let truncated = false;
  if (req.query.page) {
    const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Invoices", {
      where: outstandingWhere(type),
      order: "DueDate",
      page: String(req.query.page),
    });
    invoices = data.Invoices || [];
  } else {
    ({ invoices, truncated } = await fetchOutstandingInvoices(ctx, type));
  }

  const rows = ageInvoices(invoices, {
    asAt: asAtDate,
    entity: ctx.entity,
    groupEntities: await clientEntities(ctx.client.id),
  });
  res.json({ entity: ctx.entity.name, asAtDate, ...legacyShape(rows), truncated });
}

// GET /api/finance/clients/:slug/xero/:entity/aged-receivables
app.get("/api/finance/clients/:slug/xero/:entity/aged-receivables", route(async (req, res) =>
  perEntityAgeing(req, res, "ACCREC")
));

// GET /api/finance/clients/:slug/xero/:entity/aged-payables
app.get("/api/finance/clients/:slug/xero/:entity/aged-payables", route(async (req, res) =>
  perEntityAgeing(req, res, "ACCPAY")
));

// GET /api/finance/clients/:slug/xero/:entity/accounts  (chart of accounts)
app.get("/api/finance/clients/:slug/xero/:entity/accounts", route(async (req, res) => {
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

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

// ── Chart of accounts mapping ───────────────────────────────────────────────
//
// Which reporting category each Xero account belongs to, per entity, approved
// by a person in the portal (migration 017, lib/coa-mapping.js). The pack
// engine reads the result from /entities/:entity/account-mapping.

async function loadCategories(db, clientId) {
  const { rows } = await db.query(
    `SELECT client_id, key, label, statement, section, sort_order, cash_flow, active
     FROM finance.reporting_categories
     WHERE client_id IS NULL OR client_id = $1`,
    [clientId]
  );
  return effectiveCategories(rows);
}

async function loadStoredMappings(db, entityId) {
  const { rows } = await db.query(
    `SELECT xero_account_id, account_code, account_name, account_class, category_key, cash_flow,
            status, source, reason, proposed_by_email, proposed_at, approved_by_email,
            approved_role, approved_at, updated_at
     FROM finance.account_mappings WHERE entity_id = $1`,
    [entityId]
  );
  return new Map(rows.map((r) => [r.xero_account_id, r]));
}

const categoryList = (cats) => [...cats.values()];

app.get("/api/finance/clients/:slug/reporting-categories", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });
  const cats = await loadCategories(pool, client.id);
  const { rows: used } = await pool.query(
    "SELECT category_key, COUNT(*)::int AS n FROM finance.account_mappings WHERE client_id = $1 GROUP BY 1",
    [client.id]
  );
  const inUse = Object.fromEntries(used.map((u) => [u.category_key, u.n]));
  res.json({
    data: categoryList(cats).map((c) => ({ ...c, accounts: inUse[c.key] ?? 0 })),
    sections: { pnl: PNL_SECTIONS, bs: BS_SECTIONS },
    cashFlows: { category: BS_CASH_FLOWS, account: ACCOUNT_CASH_FLOWS },
  });
}));

// Create a client-only category, or override a standard one for this client.
app.put("/api/finance/clients/:slug/reporting-categories/:key", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });

  const { key } = req.params;
  const { rows: std } = await pool.query(
    `SELECT client_id, key, label, statement, section, sort_order, cash_flow, active
     FROM finance.reporting_categories WHERE client_id IS NULL AND key = $1`,
    [key]
  );
  const standard = std.length ? effectiveCategories(std).get(key) : null;
  const current = (await loadCategories(pool, client.id)).get(key) || null;
  const { rows: used } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM finance.account_mappings WHERE client_id = $1 AND category_key = $2",
    [client.id, key]
  );
  const { errors, value } = validateCategory(key, req.body || {}, { current, standard, inUse: used[0].n });
  if (errors.length) return res.status(422).json({ error: errors.join("; "), errors });

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const { rows } = await conn.query(
      `INSERT INTO finance.reporting_categories
         (client_id, key, label, statement, section, sort_order, cash_flow, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id, key) WHERE client_id IS NOT NULL DO UPDATE SET
         label = EXCLUDED.label, statement = EXCLUDED.statement, section = EXCLUDED.section,
         sort_order = EXCLUDED.sort_order, cash_flow = EXCLUDED.cash_flow, active = EXCLUDED.active
       RETURNING client_id, key, label, statement, section, sort_order, cash_flow, active`,
      [client.id, key, value.label, value.statement, value.section, value.sortOrder, value.cashFlow, value.active]
    );
    const role = await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail]);
    await audit(conn, {
      actorEmail,
      actorRole: role.rows[0].role,
      action: "set_reporting_category",
      targetType: "reporting_category",
      targetId: key,
      clientId: client.id,
      payload: { key, before: current, after: value, standard: Boolean(standard) },
      ip: normaliseIp(req.get("X-Forwarded-For") || req.ip),
    });
    await conn.query("COMMIT");
    res.json(effectiveCategories([...std, rows[0]]).get(key));
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}));

// Back to the standard line (an override), or remove a client-only category
// no account uses.
app.delete("/api/finance/clients/:slug/reporting-categories/:key", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });

  const { key } = req.params;
  const { rows: own } = await pool.query(
    "SELECT * FROM finance.reporting_categories WHERE client_id = $1 AND key = $2",
    [client.id, key]
  );
  if (!own.length) return res.status(404).json({ error: "this client has no category of its own with that key" });
  const { rows: std } = await pool.query(
    "SELECT key, active FROM finance.reporting_categories WHERE client_id IS NULL AND key = $1",
    [key]
  );
  const { rows: used } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM finance.account_mappings WHERE client_id = $1 AND category_key = $2",
    [client.id, key]
  );
  if (!std.length && used[0].n) {
    return res.status(409).json({ error: `${used[0].n} account(s) are mapped to ${key}; remap them first` });
  }

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("DELETE FROM finance.reporting_categories WHERE client_id = $1 AND key = $2", [client.id, key]);
    const role = await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail]);
    await audit(conn, {
      actorEmail,
      actorRole: role.rows[0].role,
      action: std.length ? "reset_reporting_category" : "remove_reporting_category",
      targetType: "reporting_category",
      targetId: key,
      clientId: client.id,
      payload: { key, before: own[0] },
      ip: normaliseIp(req.get("X-Forwarded-For") || req.ip),
    });
    await conn.query("COMMIT");
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  res.json({ ok: true, key, reset: Boolean(std.length) });
}));

// The Chart of accounts tab: every Xero account for one entity, what is saved,
// and a rule proposal for the rest.
app.get("/api/finance/clients/:slug/coa-mapping", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const { rows: entities } = await pool.query(
    `SELECT id, slug, name, accounting_system_config->>'tenant_id' AS tenant_id
     FROM finance.entities WHERE client_id = $1 ORDER BY name`,
    [client.id]
  );
  const list = entities.map((e) => ({ slug: e.slug, name: e.name, connected: Boolean(e.tenant_id) }));
  const wanted = String(req.query.entity || "");
  const entity = entities.find((e) => e.slug === wanted) || entities.find((e) => e.tenant_id) || entities[0];
  const categories = await loadCategories(pool, client.id);
  const base = { entities: list, categories: categoryList(categories), cashFlows: { account: ACCOUNT_CASH_FLOWS } };
  if (!entity) return res.json({ ...base, entity: null, rows: [], orphans: [] });

  const stored = await loadStoredMappings(pool, entity.id);
  const ctx = await xeroEntityContext(req.params.slug, entity.slug);
  let accounts = null;
  let xeroError = null;
  if (!ctx) xeroError = "This entity is not connected to Xero.";
  else if (ctx.error) xeroError = ctx.error;
  else {
    try {
      accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts")).Accounts ?? [];
    } catch (e) {
      xeroError = e.message;
    }
  }
  if (!accounts) {
    // Without Xero, still show what is saved, so the page is never blank.
    accounts = [...stored.values()].map((s) => ({
      AccountID: s.xero_account_id, Code: s.account_code, Name: s.account_name, Class: s.account_class,
    }));
  }
  const { rows, orphans } = accountRows({ accounts, stored, categories });
  res.json({ ...base, entity: { slug: entity.slug, name: entity.name }, xeroError, rows, orphans: xeroError ? [] : orphans });
}));

// Save, change or approve mappings for one entity. All or nothing.
//   body: { changes: [{ accountId, category?, cashFlow?, approve? }], source?: manual|upload|rule, note? }
app.post("/api/finance/clients/:slug/coa-mapping/:entity", route(async (req, res) => {
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  const { changes, source = "manual", note = null } = req.body || {};
  if (source === "agent") return res.status(400).json({ error: "agents propose through their own route, not this one" });

  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);
  const { client, entity } = ctx;
  // Validated against Xero as it is now, so a mapping can only name a real account.
  const accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts")).Accounts ?? [];

  const categories = await loadCategories(pool, client.id);
  const stored = await loadStoredMappings(pool, entity.id);
  const noteText = note ? String(note).slice(0, 200) : null;
  const { errors, writes } = planMappingChanges({ changes, accounts, categories, stored, source, note: noteText });
  if (errors.length) {
    return res.status(422).json({ error: `Nothing was saved: ${errors.length} problem(s)`, errors });
  }

  const changed = writes.filter((w) => {
    const s = stored.get(w.accountId);
    return !s || s.category_key !== w.category || s.status !== w.status || (s.cash_flow ?? null) !== w.cashFlow
      || (s.account_code ?? null) !== w.code || s.account_name !== w.name;
  });

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const role = (await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail])).rows[0].role;
    for (const w of changed) {
      const approved = w.status === "approved";
      await conn.query(
        `INSERT INTO finance.account_mappings AS m
           (client_id, entity_id, xero_account_id, account_code, account_name, account_class,
            category_key, cash_flow, status, source, reason, proposed_by_email,
            approved_by_email, approved_role, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $9 = 'approved' THEN now() END)
         ON CONFLICT (entity_id, xero_account_id) DO UPDATE SET
           account_code = EXCLUDED.account_code,
           account_name = EXCLUDED.account_name,
           account_class = EXCLUDED.account_class,
           proposed_by_email = CASE WHEN m.category_key IS DISTINCT FROM EXCLUDED.category_key
                                      OR m.cash_flow IS DISTINCT FROM EXCLUDED.cash_flow
                                    THEN EXCLUDED.proposed_by_email ELSE m.proposed_by_email END,
           proposed_at = CASE WHEN m.category_key IS DISTINCT FROM EXCLUDED.category_key
                                OR m.cash_flow IS DISTINCT FROM EXCLUDED.cash_flow
                              THEN now() ELSE m.proposed_at END,
           category_key = EXCLUDED.category_key,
           cash_flow = EXCLUDED.cash_flow,
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           reason = EXCLUDED.reason,
           approved_by_email = EXCLUDED.approved_by_email,
           approved_role = EXCLUDED.approved_role,
           approved_at = EXCLUDED.approved_at`,
        [
          client.id, entity.id, w.accountId, w.code, w.name, w.klass,
          w.category, w.cashFlow, w.status, w.source, w.reason, actorEmail,
          approved ? actorEmail : null, approved ? role : null,
        ]
      );
    }
    if (changed.length) {
      await audit(conn, {
        actorEmail,
        actorRole: role,
        action: "map_accounts",
        targetType: "account_mapping",
        targetId: entity.slug,
        clientId: client.id,
        payload: {
          entity: entity.slug,
          source,
          note: noteText,
          changes: changed.map((w) => ({
            accountId: w.accountId, code: w.code, name: w.name, before: w.before,
            after: { category: w.category, status: w.status, cashFlow: w.cashFlow },
          })),
        },
        ip: normaliseIp(req.get("X-Forwarded-For") || req.ip),
      });
    }
    await conn.query("COMMIT");
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }

  res.json({
    ok: true,
    saved: changed.length,
    unchanged: writes.length - changed.length,
    approved: changed.filter((w) => w.status === "approved").length,
  });
}));

// For the pack engine: the categories and every saved mapping for one entity.
// No Xero call; the engine already has the chart of accounts.
app.get("/api/finance/clients/:slug/entities/:entity/account-mapping", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });
  const { rows: ent } = await pool.query(
    "SELECT id, slug FROM finance.entities WHERE client_id = $1 AND slug = $2",
    [client.id, req.params.entity]
  );
  if (!ent.length) return res.status(404).json({ error: "entity not found" });
  const categories = await loadCategories(pool, client.id);
  const stored = await loadStoredMappings(pool, ent[0].id);
  res.json({
    categories: categoryList(categories),
    mappings: [...stored.values()].map((s) => ({
      accountId: s.xero_account_id,
      code: s.account_code,
      name: s.account_name,
      class: s.account_class,
      category: s.category_key,
      cashFlow: s.cash_flow,
      status: s.status,
      source: s.source,
      reason: s.reason,
      approvedBy: s.approved_by_email,
      approvedAt: s.approved_at,
    })),
  });
}));

// GET /api/finance/clients/:slug/reports/aged-payables?entity=<entity-slug>|all
//
// The portal's AP ageing report, for one entity or the whole group.
//
// As at today only. AmountDue is what is owed now; ageing it against a past
// date would show today's balances under an old date, so there is no date
// parameter to invite that.
//
// One entity failing (a dead Xero connection, say) does not fail the report.
// It comes back marked, and `complete` is false, so a partial group total is
// never mistaken for the whole.
app.get("/api/finance/clients/:slug/reports/aged-payables", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });

  const all = await clientEntities(client.id);
  const scope = String(req.query.entity || "all");
  const targets = scope === "all" ? all : all.filter((e) => e.slug === scope);
  if (!targets.length) {
    return res.status(404).json({ error: `entity ${scope} not found for ${req.params.slug}` });
  }

  const asAt = new Date().toISOString().slice(0, 10);

  // Different tenants, different refresh-token secrets: safe to run together.
  const results = await Promise.all(targets.map(async (e) => {
    const base = { slug: e.slug, name: e.name, legalName: e.legal_name };
    if (!e.accounting_system_config?.tenant_id) return { ...base, status: "not_connected", rows: [] };
    try {
      const ctx = await xeroEntityContext(req.params.slug, e.slug);
      if (!ctx) return { ...base, status: "not_connected", rows: [] };
      if (ctx.error) return { ...base, status: "error", error: ctx.error, rows: [] };
      const { invoices, truncated } = await fetchOutstandingInvoices(ctx, "ACCPAY");
      const rows = ageInvoices(invoices, {
        asAt,
        entity: { slug: e.slug, name: e.name },
        groupEntities: all,
      });
      return { ...base, status: "ok", invoiceCount: rows.length, truncated, rows };
    } catch (err) {
      console.error(`aged-payables ${req.params.slug}/${e.slug} failed:`, err.message);
      return { ...base, status: "error", error: err.message, rows: [] };
    }
  }));

  const invoices = results.flatMap((r) => r.rows);
  const { currencies, suppliers } = summarise(invoices);

  res.json({
    client: { slug: client.slug, name: client.name },
    asAt,
    scope,
    // Not connected is a known state, not a failure; only an error makes the
    // report incomplete.
    complete: results.every((r) => r.status !== "error"),
    truncated: results.some((r) => r.truncated),
    entities: results.map(({ rows, ...e }) => e),
    currencies,
    suppliers,
    invoices,
  });
}));

// ── Journal posting (the write path) ────────────────────────────────────────
//
// POST /api/finance/clients/:slug/xero/:entity/journals
//
// The only way to write to a client ledger through this platform. Everything
// else here is read-only by design, and the three other ways this practice
// could post a journal (the stza-xero plugin, xero_push_journal.py,
// post_approved_accruals.py) are being removed rather than joined.
//
// Built to docs/xero-write-path/xero-write-path-spec.md. The parts that are
// easy to get wrong, and why they are the way they are:
//
//   * The access token is acquired BEFORE any pooled connection is checked out.
//     refreshAccessToken() takes its own connection for the advisory lock, so
//     opening the audit transaction first would hold one connection while
//     waiting for a second. At pool.max = 5 and Cloud Run concurrency 80, five
//     simultaneous posts would deadlock until connectionTimeoutMillis fired.
//     See spec section 5, "Ordering constraint".
//
//   * The audit trail is two SHORT transactions, not one long one spanning the
//     Xero call. Holding a transaction open across the network would reintroduce
//     the same pool exhaustion by a different route.
//
//   * The idempotency key is claimed BEFORE the Xero call, as 'pending'. A key
//     claimed only afterwards leaves a window where two concurrent requests
//     both post and only one is recorded.
//
//   * Validation runs entirely before anything is sent to Xero, and reports
//     every failure at once.

const JOURNAL_TARGET_TYPE = "xero_journal";

// Reads the organisation's lock dates. A journal dated into a locked period is
// rejected here rather than by Xero, so the caller gets a reason rather than a
// 400.
async function xeroLockDates(ctx) {
  try {
    const org = await xeroGet(ctx.accessToken, ctx.tenantId, "/Organisation", {});
    const o = org?.Organisations?.[0] ?? {};
    return { periodLockDate: o.PeriodLockDate ?? null, endOfYearLockDate: o.EndOfYearLockDate ?? null };
  } catch (e) {
    // Not fatal on its own: Xero enforces the lock regardless, and refusing to
    // post because we could not read the lock date would make an unrelated
    // outage look like a period problem. The warning records that the check
    // did not run.
    console.warn(`could not read lock dates for ${ctx.entity.slug}: ${e.message}`);
    return { unavailable: true };
  }
}

app.post("/api/finance/clients/:slug/xero/:entity/journals", route(async (req, res) => {
  const body = req.body || {};
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  const ip = req.get("X-Forwarded-For") || req.ip;
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });

  // The path is authoritative for client and entity. The spec's example body
  // also carries them; if both are present and disagree, that is a caller bug
  // worth surfacing rather than silently resolving in favour of either.
  if (body.client && body.client !== req.params.slug) {
    return res.status(400).json({
      ok: false, stage: "validation",
      issues: [{ code: "CLIENT_MISMATCH", detail: `body.client ${body.client} does not match the path ${req.params.slug}` }],
    });
  }
  if (body.entity && body.entity !== req.params.entity) {
    return res.status(400).json({
      ok: false, stage: "validation",
      issues: [{ code: "ENTITY_MISMATCH", detail: `body.entity ${body.entity} does not match the path ${req.params.entity}` }],
    });
  }

  // ── token first, before any pooled connection ─────────────────────────────
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

  const { rows: cfgRows } = await pool.query(
    `SELECT COALESCE((cfc.materiality_thresholds->>'journal_materiality_gbp')::numeric, 1) AS journal_materiality_gbp
     FROM finance.client_finance_config cfc WHERE cfc.client_id = $1`,
    [ctx.client.id]
  );
  const materialityGbp = Number(cfgRows[0]?.journal_materiality_gbp ?? 1);

  const key = body.idempotency_key ? String(body.idempotency_key).trim() : null;
  const fingerprint = requestFingerprint(body);
  const isDryRun = body.dry_run === true;

  // ── idempotency: has this key already been used? ──────────────────────────
  if (key && !isDryRun) {
    const { rows } = await pool.query(
      `SELECT outcome, request_fingerprint, response_body, journal_id, created_at
       FROM finance.journal_posts
       WHERE client_id = $1 AND entity_id = $2 AND idempotency_key = $3`,
      [ctx.client.id, ctx.entity.id, key]
    );
    const prior = rows[0];
    if (prior) {
      if (prior.outcome === "pending") {
        return res.status(409).json({
          ok: false, stage: "idempotency",
          error: "A journal with this idempotency key is already in flight. If this persists, check Xero before retrying - the earlier attempt may have posted.",
          idempotency_key: key,
        });
      }
      if (prior.request_fingerprint !== fingerprint) {
        return res.status(409).json({
          ok: false, stage: "idempotency",
          error: "This idempotency key was already used for a different journal.",
          idempotency_key: key,
          original: prior.response_body,
          submitted_fingerprint: fingerprint,
          original_fingerprint: prior.request_fingerprint,
        });
      }
      // Same key, same journal: replay the original answer verbatim.
      return res.json({ ...prior.response_body, idempotent_replay: true });
    }
  }

  // ── validation, entirely before Xero is asked to do anything ──────────────
  const [accountsRes, lockDates] = await Promise.all([
    xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts", {}),
    xeroLockDates(ctx),
  ]);
  const accounts = accountsRes?.Accounts ?? [];

  const now = Date.now();
  // Every name this entity legitimately answers to. The approval text is
  // written for a human, so it may use any of them.
  const entityNames = [
    ctx.entity.slug,
    ctx.entity.name,
    ctx.entity.legal_name,
    ctx.entity.accounting_system_config?.tenant_name,
  ].filter(Boolean);

  const { issues, warnings, net } = validateJournal(body, {
    accounts,
    lockDates,
    now,
    entitySlug: ctx.entity.slug,
    entityName: ctx.entity.name,
    entityNames,
    materialityGbp,
  });
  if (lockDates.unavailable) {
    warnings.push("PERIOD_LOCK_UNCHECKED: the organisation's lock dates could not be read; Xero will still enforce them");
  }
  // A POSTED journal moves what the ledger reports: the post tier, switched on
  // per entity, the same permission the laptop MCP checks. DRAFT needs none.
  if ((body.status ?? "DRAFT") === "POSTED") {
    for (const detail of writeRules.tierIssues(ctx.entity.accounting_system_config, "post")) {
      issues.push({ code: "TIER_OFF", detail });
    }
  }

  const auditBase = {
    actorEmail,
    action: "",
    targetType: JOURNAL_TARGET_TYPE,
    targetId: key || `nokey:${fingerprint}`,
    clientId: ctx.client.id,
    ip,
  };
  const requestForAudit = { ...body, client: req.params.slug, entity: req.params.entity };

  if (issues.length) {
    // An attempt to write to a client ledger that was refused is worth keeping.
    const conn = await pool.connect();
    try {
      await audit(conn, {
        ...auditBase,
        action: "journal_rejected",
        payload: {
          stage: "validation", issues, warnings,
          request_payload: requestForAudit,
          entity: ctx.entity.slug,
        },
      });
    } finally {
      conn.release();
    }
    return res.status(422).json({ ok: false, stage: "validation", issues, warnings });
  }

  const xeroPayload = buildXeroPayload(body);
  const codes = (body.lines || []).map((l) => String(l.account_code));

  // ── dry run: everything above, nothing below ──────────────────────────────
  //
  // Deliberately does NOT claim the idempotency key. A dry run that consumed
  // the key would make the real post that follows it look like a replay and
  // return the dry run's result instead of posting.
  if (isDryRun) {
    const conn = await pool.connect();
    let auditId;
    try {
      auditId = await audit(conn, {
        ...auditBase,
        action: "journal_dry_run",
        payload: {
          outcome: "dry_run", validation: { passed: true, warnings },
          approval_payload: body.approval ?? null,
          request_payload: requestForAudit, xero_request: xeroPayload,
          entity: ctx.entity.slug,
        },
      });
    } finally {
      conn.release();
    }
    return res.json({
      ok: true, action: "DRY RUN — validated, not posted",
      status: xeroPayload.Status, net: Number(fromPence(net)),
      warnings, audit_id: auditId, xero_request: xeroPayload,
      idempotent_replay: false,
    });
  }

  // ── claim the key before going anywhere near Xero ─────────────────────────
  if (key) {
    const claim = await pool.query(
      `INSERT INTO finance.journal_posts
         (client_id, entity_id, idempotency_key, request_fingerprint, outcome, response_body, actor_email)
       VALUES ($1,$2,$3,$4,'pending','{}'::jsonb,$5)
       ON CONFLICT (client_id, entity_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [ctx.client.id, ctx.entity.id, key, fingerprint, actorEmail]
    );
    if (!claim.rows.length) {
      // Someone claimed it between our lookup and here.
      return res.status(409).json({
        ok: false, stage: "idempotency",
        error: "A journal with this idempotency key was claimed concurrently. Check Xero before retrying.",
        idempotency_key: key,
      });
    }
  }

  // Balances before, for the audit record. Best effort: failing to read a
  // trial balance is not a reason to refuse a validated, approved journal.
  let balancesBefore = null;
  try {
    const tb = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date: body.date });
    balancesBefore = balancesForCodes(trialBalanceByAccountId(tb?.Reports?.[0] ?? tb), accounts, codes);
  } catch (e) {
    console.warn(`could not read balances before posting for ${ctx.entity.slug}: ${e.message}`);
  }

  // ── audit row opened before the call, committed so a crash leaves evidence ─
  const conn = await pool.connect();
  let auditId;
  try {
    auditId = await audit(conn, {
      ...auditBase,
      action: "journal_post_started",
      payload: {
        outcome: "started",
        entity: ctx.entity.slug, tenant_id: ctx.tenantId,
        approval_payload: body.approval,
        idempotency_key: key, reference: body.reference ?? null,
        validation: { passed: true, warnings },
        request_payload: requestForAudit,
        xero_request: xeroPayload,
        balances_before: balancesBefore,
      },
    });
  } finally {
    conn.release();
  }

  // ── the write ─────────────────────────────────────────────────────────────
  let xeroStatus = 0;
  let xeroBody = null;
  try {
    const r = await fetch(`${XERO_API}/ManualJournals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        "Xero-Tenant-Id": ctx.tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ManualJournals: [xeroPayload] }),
      signal: AbortSignal.timeout(30_000),
    });
    xeroStatus = r.status;
    const text = await r.text();
    try { xeroBody = JSON.parse(text); } catch { xeroBody = { raw: text.slice(0, 2000) }; }
  } catch (e) {
    xeroStatus = 0;
    xeroBody = { error: e.name === "TimeoutError" ? "timeout" : e.message };
  }

  const ok = xeroStatus === 200 || xeroStatus === 201;
  const mj = ok ? xeroBody?.ManualJournals?.[0] ?? {} : {};
  const outcome = ok ? (mj.Status === "POSTED" ? "posted" : "draft") : "failed";

  // Balances after, only when the ledger actually moved. A DRAFT journal does
  // not affect balances, so re-reading them would spend a Xero call to return
  // the same numbers and imply a change that did not happen.
  let balancesAfter = null;
  let balancesAfterNote = null;
  if (ok && mj.Status === "POSTED") {
    try {
      const tb = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date: body.date });
      balancesAfter = balancesForCodes(trialBalanceByAccountId(tb?.Reports?.[0] ?? tb), accounts, codes);
    } catch (e) {
      balancesAfterNote = `could not be read: ${e.message}`;
    }
  } else if (ok) {
    balancesAfterNote = "unchanged - a DRAFT journal does not affect ledger balances until it is posted";
  }

  const responseBody = ok
    ? {
        ok: true,
        journal_id: mj.ManualJournalID ?? null,
        journal_number: mj.JournalNumber ?? null,
        status: mj.Status ?? xeroPayload.Status,
        audit_id: auditId,
        net: Number(fromPence(net)),
        warnings,
        idempotent_replay: false,
      }
    : {
        ok: false,
        stage: "xero",
        http_status: xeroStatus,
        xero_error: xeroBody,
        audit_id: auditId,
      };

  // ── close the audit record, and resolve the idempotency claim ─────────────
  const conn2 = await pool.connect();
  try {
    await conn2.query("BEGIN");
    await audit(conn2, {
      ...auditBase,
      action: ok ? "journal_posted" : "journal_failed",
      payload: {
        outcome,
        entity: ctx.entity.slug,
        audit_opened_id: auditId,
        approval_payload: body.approval,
        idempotency_key: key, reference: body.reference ?? null,
        xero_request: xeroPayload,
        xero_response: xeroBody,
        http_status: xeroStatus,
        journal_id: mj.ManualJournalID ?? null,
        balances_before: balancesBefore,
        balances_after: balancesAfter,
        balances_after_note: balancesAfterNote,
      },
    });
    if (key) {
      await conn2.query(
        `UPDATE finance.journal_posts
            SET outcome = $4, journal_id = $5, journal_number = $6, xero_status = $7,
                response_body = $8, audit_id = $9
          WHERE client_id = $1 AND entity_id = $2 AND idempotency_key = $3`,
        [
          ctx.client.id, ctx.entity.id, key, outcome,
          mj.ManualJournalID ?? null, mj.JournalNumber ?? null, mj.Status ?? null,
          JSON.stringify(responseBody), auditId,
        ]
      );
    }
    await conn2.query("COMMIT");
  } catch (e) {
    try { await conn2.query("ROLLBACK"); } catch { /* already gone */ }
    throw e;
  } finally {
    conn2.release();
  }

  if (!ok) {
    alertOps("xero_journal_failed", {
      client: req.params.slug, entity: ctx.entity.slug,
      status: xeroStatus, idempotencyKey: key, auditId,
    });
    // Xero's body, verbatim. The whole point.
    return res.status(502).json(responseBody);
  }
  res.status(201).json(responseBody);
}));

// ── Draft-tier writes (parity with the laptop MCP) ──────────────────────────
//
// POST /api/finance/clients/:slug/xero/:entity/write/<operation>
//
// The note and draft tiers of the laptop MCP's write tools, served from the
// one token holder (docs/ap-lane/xero-capability-register.md). Rules live in
// lib/xero-write.js, where they are tested. Every route:
//
//   * needs X-Actor-Email, and the tier switched on for the entity
//     (accounting_system_config.write_policy; note and draft default on);
//   * is a DRY RUN unless the body says dry_run: false. A dry run validates
//     against Xero's live data and returns the exact payload, writing nothing;
//   * refuses anything past SUBMITTED. A person approves in Xero;
//   * sends an Idempotency-Key, so a retried call cannot create a second
//     document, and retries only 429 and 5xx, which the key makes safe;
//   * writes a history note to the Xero record, and an audit row here for
//     every attempt, refused, dry or real.
//
// Uploads (attachments, Files) take the file as the raw request body, with
// the other fields in the query string, so a 25 MB PDF is not base64'd into
// JSON.

const crypto = require("crypto");
const XERO_FILES_API = "https://api.xero.com/files.xro/1.0";

async function xeroSend(ctx, method, url, { json, raw, contentType, key }) {
  const full = url.startsWith("https://") ? url : `${XERO_API}${url}`;
  let last;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const headers = {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Xero-Tenant-Id": ctx.tenantId,
      Accept: "application/json",
      "Idempotency-Key": key,
    };
    let body;
    if (raw) {
      headers["Content-Type"] = contentType || "application/octet-stream";
      body = raw;
    } else if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    }
    const r = await fetch(full, { method, headers, body });
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    last = { status: r.status, ok: r.ok, body: parsed, text };
    const retry = r.status === 429 || r.status >= 500;
    if (!retry || attempt === 3) return last;
    const wait = Math.max(1, Math.min(Number(r.headers.get("retry-after")) || 5, 60));
    await new Promise((done) => setTimeout(done, (wait + 1) * 1000));
  }
  return last;
}

async function addXeroHistory(ctx, resource, id, details) {
  const text = writeRules.historyText(details).slice(0, writeRules.HISTORY_MAX_CHARS);
  const json = { HistoryRecords: [{ Details: text }] };
  const key = writeRules.idempotencyKey(ctx.entity.slug, `history:${resource}:${id}`, json);
  const r = await xeroSend(ctx, "PUT", `/${resource}/${id}/History`, { json, key });
  return r.ok
    ? { written: true, details: text }
    : { written: false, http_status: r.status, xero_errors: writeRules.xeroErrors(r.body) };
}

// One audit row per attempt. Payloads are kept (they are what was asked of the
// ledger); file bytes never are, only their size and hash.
async function auditWrite(ctx, req, { tool, tier, result, payload }) {
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  const action = result.validation !== "PASS"
    ? `${tool}_refused`
    : result.dry_run ? `${tool}_dry_run` : `${tool}_${String(result.action || "").toLowerCase()}`;
  let conn;
  try {
    conn = await pool.connect();
    const role = await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [ctx.client.id, actorEmail]);
    return await audit(conn, {
      actorEmail,
      actorRole: role.rows[0]?.role,
      action,
      targetType: "xero_write",
      targetId: result.idempotency_key || tool,
      clientId: ctx.client.id,
      payload: { tool, tier, entity: ctx.entity.slug, ...result, payload },
      ip: req.get("X-Forwarded-For") || req.ip,
    });
  } catch (e) {
    // An audit failure is reported in the response rather than hiding the
    // write's own outcome.
    console.error(`audit of ${tool} failed: ${e.message}`);
    return `NOT WRITTEN: ${e.message}`;
  } finally {
    if (conn) conn.release();
  }
}

// Confirmation codes for the confirmed tiers, held in the database so a code
// issued by one Cloud Run instance redeems on another. Each query takes and
// releases its own pooled connection, after the access token is in hand.
async function issueConfirmation(ctx, tool, digest, actorEmail) {
  const code = confirmedRules.newConfirmationCode();
  const { rows } = await pool.query(
    `INSERT INTO finance.write_confirmations
       (code, client_id, entity_id, tool, payload_digest, issued_to, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(mins => $7))
     RETURNING expires_at`,
    [code, ctx.client.id, ctx.entity.id, tool, digest, actorEmail, confirmedRules.CONFIRMATION_TTL_MINUTES]
  );
  return { code, expires_at: rows[0].expires_at };
}

// Redeems a code: null when it is good, otherwise the reason it is not. One
// conditional UPDATE, so two concurrent writes cannot both spend it.
async function redeemConfirmation(ctx, tool, digest, presented, actorEmail) {
  const code = String(presented || "").trim();
  if (!code) return "A confirmation_code from a dry run of this exact write is required (codes last 15 minutes and are used once)";
  const { rows } = await pool.query(
    `UPDATE finance.write_confirmations
        SET consumed_at = now(), consumed_by = $6
      WHERE code = $1 AND client_id = $2 AND entity_id = $3 AND tool = $4
        AND payload_digest = $5 AND consumed_at IS NULL AND expires_at > now()
      RETURNING code`,
    [code, ctx.client.id, ctx.entity.id, tool, digest, actorEmail]
  );
  if (rows.length) return null;
  const seen = await pool.query(
    `SELECT consumed_at, expires_at > now() AS live
       FROM finance.write_confirmations WHERE code = $1 AND client_id = $2`,
    [code, ctx.client.id]
  );
  return confirmedRules.confirmationRefusal(seen.rows[0]);
}

// The shared shape of every write route: context, tier, validation, dry run
// or write, history note, audit. `plan(ctx, input, req)` checks the request
// against Xero and returns { issues, operation, payload, send(key), saved?,
// describe?, history?, extra?, amount? }. `tierOf` is a tier name, or a
// function of the input where the request decides it (a DRAFT journal against
// a POSTED one).
//
// The confirmed tiers (post, send, settle, setup, conversion) add two steps
// once everything else passes: a dry run issues a confirmation code bound to
// the tool, the entity and the exact payload; a real write must present it.
// Settle writes are also held to the entity's max_amount. A code is never
// issued for a write that could not go ahead.
//
// The access token is acquired (xeroEntityContext) before any pooled
// connection is taken, for the reason given above the journal endpoint.
function gatedWrite(tool, tierOf, plan) {
  return route(async (req, res) => {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
    const input = Buffer.isBuffer(req.body) ? { ...req.query } : { ...(req.body || {}) };
    const dryRun = !(input.dry_run === false || input.dry_run === "false");
    const tier = typeof tierOf === "function" ? tierOf(input) : tierOf;

    const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
    if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
    if (ctx.error) return erpUnavailable(res, ctx);

    const result = { entity: ctx.entity.name, tool, tier, dry_run: dryRun };
    const tierBlock = writeRules.tierIssues(ctx.entity.accounting_system_config, tier);
    const p = tierBlock.length ? { issues: [] } : await plan(ctx, input, req);
    const issues = [...tierBlock, ...(p.issues || [])];
    if (!issues.length) {
      try {
        issues.push(...confirmedRules.capIssues(ctx.entity.accounting_system_config, tier, p.amount));
      } catch (e) {
        issues.push(e.message);
      }
    }

    let key = null;
    if (p.payload) {
      try {
        key = writeRules.idempotencyKey(ctx.entity.slug, tool, p.payload, input.idempotency_key);
      } catch (e) {
        issues.push(e.message);
      }
    }
    Object.assign(result, { operation: p.operation, idempotency_key: key, payload: p.payload, ...(p.extra || {}) });
    if (p.amount !== undefined) result.amount = p.amount;

    const confirmed = confirmedRules.isConfirmedTier(tier);
    const digest = confirmed && p.payload ? confirmedRules.payloadDigest(tool, ctx.entity.id, p.payload) : null;
    if (!issues.length && confirmed && !dryRun) {
      const refusal = await redeemConfirmation(ctx, tool, digest, input.confirmation_code, actorEmail);
      if (refusal) issues.push(refusal);
    }

    if (issues.length) {
      result.validation = "FAIL";
      result.issues = issues;
      result.audit_id = await auditWrite(ctx, req, { tool, tier, result, payload: p.payload });
      return res.status(422).json(result);
    }
    result.validation = "PASS";
    if (dryRun) {
      result.action = "DRY RUN - validated against Xero, nothing written";
      if (confirmed) {
        const c = await issueConfirmation(ctx, tool, digest, actorEmail);
        Object.assign(result, {
          confirmation_code: c.code,
          confirmation_expires_at: c.expires_at,
          next: "Show this to the approver. To write, repeat the identical call with dry_run false and this confirmation_code.",
        });
      }
      // The code itself stays out of the audit row: until redeemed it is a
      // bearer token for the write.
      const logged = { ...result };
      if (logged.confirmation_code) logged.confirmation_code = "issued";
      result.audit_id = await auditWrite(ctx, req, { tool, tier, result: logged, payload: p.payload });
      return res.json(result);
    }

    const r = await p.send(key);
    const saved = p.saved ? p.saved(r.body) : null;
    const rowErrors = saved && (saved.HasValidationErrors || (saved.ValidationErrors || []).length)
      ? (saved.ValidationErrors || []).map((e) => e.Message) : [];
    if (!r.ok || rowErrors.length) {
      Object.assign(result, {
        action: "FAILED",
        http_status: r.status,
        xero_errors: rowErrors.length ? rowErrors : (r.errors || writeRules.xeroErrors(r.body)),
        xero_response: (r.text || "").slice(0, 2000),
      });
      if (r.partial) result.partial = r.partial;
      result.audit_id = await auditWrite(ctx, req, { tool, tier, result, payload: p.payload });
      return res.status(502).json(result);
    }

    result.action = p.operation === "update" ? "UPDATED" : "WRITTEN";
    if (p.describe) Object.assign(result, p.describe(saved, r.body));
    const notes = [].concat((p.history ? p.history(saved, r.body) : null) || []).filter(Boolean);
    if (notes.length) {
      const written = [];
      for (const h of notes) written.push(await addXeroHistory(ctx, h.resource, h.id, h.text));
      result.history_note = written.length === 1 ? written[0] : written;
    }
    result.audit_id = await auditWrite(ctx, req, { tool, tier, result, payload: p.payload });
    res.status(201).json(result);
  });
}

async function xeroRef(ctx, what) {
  const data = await xeroGet(ctx.accessToken, ctx.tenantId, `/${what}`, {});
  return data?.[what] ?? [];
}

// A read that may legitimately find nothing: Xero's 404 becomes null.
async function xeroGetOrNull(ctx, path, params = {}) {
  try {
    return await xeroGet(ctx.accessToken, ctx.tenantId, path, params);
  } catch (e) {
    if (e.detail?.status === 404 || e.detail?.status === 400) return null;
    throw e;
  }
}

// Bills, sales invoices and credit notes, created or changed while DRAFT or
// SUBMITTED. Body: type, contact_id, lines[{description, account_code,
// unit_amount, quantity, tax_type, tracking}], date, due_date, id, number,
// reference, line_amount_types, currency_code, status, audit_note,
// idempotency_key, allow_duplicate, dry_run.
function documentPlan(kind) {
  const d = writeRules.DOCUMENTS[kind];
  return async (ctx, b) => {
    const pre = writeRules.documentRequestIssues(kind, b);
    const operation = b.id ? "update" : "create";
    const issues = [...pre.issues];
    if (issues.length) return { issues, operation };

    let current = null;
    if (b.id) {
      const found = (await xeroGetOrNull(ctx, `/${d.endpoint}/${b.id}`))?.[d.endpoint] ?? [];
      if (!found.length) issues.push(`No ${kind.replace("_", " ")} ${b.id} in this entity`);
      else {
        current = found[0];
        issues.push(...writeRules.laneIssues(pre.status, current.Status));
        if (current.Type !== pre.type) issues.push(`The existing document is ${current.Type}; its type cannot change`);
      }
    }
    if (b.contact_id) {
      const contacts = (await xeroGetOrNull(ctx, `/Contacts/${b.contact_id}`))?.Contacts ?? [];
      if (!contacts.length) issues.push(`No contact ${b.contact_id} in this entity`);
      else if (contacts[0].ContactStatus !== "ACTIVE") issues.push(`Contact ${contacts[0].Name} is ${contacts[0].ContactStatus}`);
    }

    let items = null;
    let net = null;
    if (Array.isArray(b.lines) && b.lines.length) {
      const [accounts, taxRates] = await Promise.all([xeroRef(ctx, "Accounts"), xeroRef(ctx, "TaxRates")]);
      const v = writeRules.validateLines(b.lines, accounts, taxRates);
      issues.push(...v.issues);
      items = v.items;
      net = v.net;
    }

    // A supplier's document number entered twice is the commonest AP error.
    const contactId = b.contact_id || current?.Contact?.ContactID;
    if (b.number && pre.type === d.payableType && contactId && !b.allow_duplicate) {
      const where = writeRules.duplicateWhere(kind, pre.type, b.number, contactId);
      const clash = ((await xeroGet(ctx.accessToken, ctx.tenantId, `/${d.endpoint}`, { where }))?.[d.endpoint] ?? [])
        .filter((x) => x[d.idField] !== b.id && !["DELETED", "VOIDED"].includes(x.Status));
      if (clash.length) {
        issues.push(`${d.numberField} ${b.number} already exists for this supplier (${clash[0][d.idField]}, ${clash[0].Status}). Pass allow_duplicate only if it is genuinely a second document`);
      }
    }

    const payload = writeRules.buildDocumentPayload(kind, b, { ...pre, items });
    return {
      issues,
      operation,
      payload,
      extra: { previous_status: current?.Status ?? null, net_before_tax: net },
      send: (key) => xeroSend(ctx, "POST", `/${d.endpoint}?summarizeErrors=false`, { json: payload, key }),
      saved: (body) => (body?.[d.endpoint] || [])[0] || null,
      describe: (s) => ({
        [d.idField]: s?.[d.idField], [d.numberField]: s?.[d.numberField] ?? "",
        xero_status: s?.Status, sub_total: s?.SubTotal, total_tax: s?.TotalTax, total: s?.Total,
      }),
      history: (s) => s?.[d.idField] && {
        resource: d.endpoint, id: s[d.idField],
        text: `${operation === "update" ? "Updated" : "Created"} as ${s.Status || pre.status}. ${String(b.audit_note).trim()}`,
      },
    };
  };
}

const WRITE = "/api/finance/clients/:slug/xero/:entity/write";

app.post(`${WRITE}/invoices`, gatedWrite("upsert_invoice", "draft", documentPlan("invoice")));
app.post(`${WRITE}/credit-notes`, gatedWrite("upsert_credit_note", "draft", documentPlan("credit_note")));

// Suppliers and customers. Only fields passed are sent. Bank details and
// archiving are refused. Body: id, name, email, first_name, last_name,
// contact_number, account_number, tax_number, company_number,
// default_currency, purchases_default_account_code, sales_default_account_code,
// accounts_payable_tax_type, accounts_receivable_tax_type, address{line1,
// line2, city, region, postal_code, country}, phone, audit_note.
app.post(`${WRITE}/contacts`, gatedWrite("upsert_contact", "draft", async (ctx, b) => {
  const issues = writeRules.contactRequestIssues(b);
  const operation = b.id ? "update" : "create";
  if (issues.length) return { issues, operation };

  if (b.id && !((await xeroGetOrNull(ctx, `/Contacts/${b.id}`))?.Contacts ?? []).length) {
    issues.push(`No contact ${b.id} in this entity`);
  }
  const name = String(b.name || "").trim();
  if (name) {
    const where = `Name=="${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const clash = ((await xeroGet(ctx.accessToken, ctx.tenantId, "/Contacts", { where, includeArchived: "true" }))?.Contacts ?? [])
      .filter((c) => c.ContactID !== b.id);
    if (clash.length) issues.push(`A contact named "${name}" already exists (${clash[0].ContactID}, ${clash[0].ContactStatus})`);
  }
  const codes = [b.purchases_default_account_code, b.sales_default_account_code].filter(Boolean);
  const taxes = [b.accounts_payable_tax_type, b.accounts_receivable_tax_type].filter(Boolean);
  if (codes.length) {
    const active = new Set((await xeroRef(ctx, "Accounts")).filter((a) => a.Status === "ACTIVE").map((a) => a.Code));
    for (const c of codes) if (!active.has(c)) issues.push(`account code ${c} is not an active account in this entity`);
  }
  if (taxes.length) {
    const active = new Set((await xeroRef(ctx, "TaxRates")).filter((t) => t.Status === "ACTIVE").map((t) => t.TaxType));
    for (const t of taxes) if (!active.has(t)) issues.push(`tax type ${t} is not an active tax rate in this entity`);
  }

  const payload = writeRules.buildContactPayload(b);
  return {
    issues, operation, payload,
    send: (key) => xeroSend(ctx, "POST", "/Contacts?summarizeErrors=false", { json: payload, key }),
    saved: (body) => (body?.Contacts || [])[0] || null,
    describe: (s) => ({ ContactID: s?.ContactID, name: s?.Name }),
    history: (s) => s?.ContactID && {
      resource: "Contacts", id: s.ContactID,
      text: `${operation === "update" ? "Updated" : "Created"} contact. ${String(b.audit_note).trim()}`,
    },
  };
}));

// A permanent note on a record's History and Notes. Notes cannot be edited
// or deleted, hence the dry run by default. Body: resource_type, resource_id,
// details.
app.post(`${WRITE}/history-notes`, gatedWrite("add_history_note", "note", async (ctx, b) => {
  const issues = [];
  if (!writeRules.HISTORY_RESOURCES.includes(b.resource_type)) {
    issues.push(`resource_type must be one of ${writeRules.HISTORY_RESOURCES.join(", ")}`);
  }
  if (!writeRules.isGuid(b.resource_id)) issues.push("resource_id must be a Xero GUID");
  if (!String(b.details || "").trim()) issues.push("details is required");
  const text = writeRules.historyText(b.details);
  if (text.length > writeRules.HISTORY_MAX_CHARS) {
    issues.push(`the note is ${text.length} characters with its prefix; the limit is ${writeRules.HISTORY_MAX_CHARS}`);
  }
  const payload = { HistoryRecords: [{ Details: text }] };
  // Confirm the record exists before a permanent note is aimed at it.
  if (!issues.length && !(await xeroGetOrNull(ctx, `/${b.resource_type}/${b.resource_id}`))) {
    issues.push(`No ${b.resource_type} record ${b.resource_id} in this entity`);
  }
  return {
    issues, operation: "create", payload,
    send: (key) => xeroSend(ctx, "PUT", `/${b.resource_type}/${b.resource_id}/History`, { json: payload, key }),
    describe: () => ({ details: text }),
  };
}));

// Mark a bill line as a billable expense to recharge to a customer. Changes no
// balance until someone invoices it. Body: source_transaction_id,
// source_line_item_id, contact_id, linked_transaction_id, audit_note.
app.post(`${WRITE}/linked-transactions`, gatedWrite("upsert_linked_transaction", "draft", async (ctx, b) => {
  const issues = [];
  for (const f of ["source_transaction_id", "source_line_item_id"]) {
    if (!writeRules.isGuid(b[f])) issues.push(`${f} must be a Xero GUID`);
  }
  for (const f of ["contact_id", "linked_transaction_id"]) {
    if (b[f] && !writeRules.isGuid(b[f])) issues.push(`${f} must be a Xero GUID`);
  }
  if (!String(b.audit_note || "").trim()) issues.push("audit_note is required");
  const payload = { SourceTransactionID: b.source_transaction_id, SourceLineItemID: b.source_line_item_id };
  if (b.contact_id) payload.ContactID = b.contact_id;
  if (b.linked_transaction_id) payload.LinkedTransactionID = b.linked_transaction_id;
  return {
    issues, operation: b.linked_transaction_id ? "update" : "create", payload,
    send: (key) => xeroSend(ctx, "POST", "/LinkedTransactions", { json: payload, key }),
    saved: (body) => (body?.LinkedTransactions || [])[0] || null,
    describe: (s) => ({ LinkedTransactionID: s?.LinkedTransactionID, xero_status: s?.Status }),
  };
}));

const uploadBody = express.raw({ type: () => true, limit: writeRules.MAX_UPLOAD_BYTES });
const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Attach a file to a Xero record. Attachments cannot be deleted through the
// API, hence the dry run by default. Raw body = the file; query: resource_type,
// resource_id, file_name, audit_note, include_online, dry_run.
app.post(`${WRITE}/attachments`, uploadBody, gatedWrite("upload_attachment", "draft", async (ctx, q, req) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const issues = [...writeRules.fileNameIssues(q.file_name)];
  if (!writeRules.ATTACHABLE.includes(q.resource_type)) issues.push(`resource_type must be one of ${writeRules.ATTACHABLE.join(", ")}`);
  if (!writeRules.isGuid(q.resource_id)) issues.push("resource_id must be a Xero GUID");
  if (!raw.length) issues.push("the request body (the file) is empty");
  if (!String(q.audit_note || "").trim()) issues.push("audit_note is required");
  if (!issues.length && !(await xeroGetOrNull(ctx, `/${q.resource_type}/${q.resource_id}`))) {
    issues.push(`No ${q.resource_type} record ${q.resource_id} in this entity`);
  }
  const online = q.include_online === "true";
  const payload = { file_name: q.file_name, bytes: raw.length, sha256: raw.length ? sha256Hex(raw) : null, include_online: online };
  const url = `/${q.resource_type}/${q.resource_id}/Attachments/${encodeURIComponent(q.file_name || "")}${online ? "?IncludeOnline=true" : ""}`;
  return {
    issues, operation: "create", payload,
    send: (key) => xeroSend(ctx, "PUT", url, { raw, contentType: req.get("Content-Type"), key }),
    saved: (body) => (body?.Attachments || [])[0] || null,
    describe: (s) => ({ AttachmentID: s?.AttachmentID, file_name: s?.FileName }),
    history: () => writeRules.HISTORY_RESOURCES.includes(q.resource_type) && {
      resource: q.resource_type, id: q.resource_id, text: `Attached ${q.file_name}. ${String(q.audit_note).trim()}`,
    },
  };
}));

// Put a file into the Xero Files library (inbox or a folder), optionally
// associating it with a record. Raw body = the file; query: file_name,
// folder_id, associate_with_id, associate_object_group, audit_note, dry_run.
app.post(`${WRITE}/files`, uploadBody, gatedWrite("upload_file", "draft", async (ctx, q, req) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const issues = [...writeRules.fileNameIssues(q.file_name)];
  if (!raw.length) issues.push("the request body (the file) is empty");
  if (q.folder_id && !writeRules.isGuid(q.folder_id)) issues.push("folder_id must be a Xero GUID");
  if (q.associate_with_id && !writeRules.isGuid(q.associate_with_id)) issues.push("associate_with_id must be a Xero GUID");
  if (q.associate_with_id && !writeRules.ASSOCIABLE.includes(q.associate_object_group)) {
    issues.push(`associate_object_group must be one of ${writeRules.ASSOCIABLE.join(", ")}`);
  }
  if (!String(q.audit_note || "").trim()) issues.push("audit_note is required");
  const payload = {
    file_name: q.file_name, bytes: raw.length, sha256: raw.length ? sha256Hex(raw) : null,
    folder_id: q.folder_id || "", associate_with_id: q.associate_with_id || "",
    associate_object_group: q.associate_object_group || "",
  };
  const mime = req.get("Content-Type") || "application/octet-stream";
  return {
    issues, operation: "create", payload,
    send: async (key) => {
      // Built once, with a boundary derived from the key, so every retry is
      // byte-identical. A fresh FormData per attempt draws a new random
      // boundary, and Xero then refuses the key as "used with a different
      // request" (seen on the first live check, 16 Oct 2026).
      const boundary = `stza-${key.replace(/[^a-z0-9]/gi, "").slice(-40)}`;
      const name = q.file_name.replace(/["\r\n]/g, "_");
      const CRLF = "\r\n";
      const part = (headers, content) => [Buffer.from(`--${boundary}${CRLF}${headers}${CRLF}${CRLF}`), content, Buffer.from(CRLF)];
      const multipart = Buffer.concat([
        ...part(`Content-Disposition: form-data; name="name"`, Buffer.from(name)),
        ...part(`Content-Disposition: form-data; name="filename"`, Buffer.from(name)),
        ...part(`Content-Disposition: form-data; name="file"; filename="${name}"${CRLF}Content-Type: ${mime}`, raw),
        Buffer.from(`--${boundary}--${CRLF}`),
      ]);
      const r = await xeroSend(ctx, "POST", `${XERO_FILES_API}/Files${q.folder_id ? `/${q.folder_id}` : ""}`, {
        key, raw: multipart, contentType: `multipart/form-data; boundary=${boundary}`,
      });
      if (r.ok && q.associate_with_id && r.body?.Id) {
        const assoc = { ObjectId: q.associate_with_id, ObjectGroup: q.associate_object_group };
        const a = await xeroSend(ctx, "POST", `${XERO_FILES_API}/Files/${r.body.Id}/Associations`, {
          json: assoc, key: writeRules.idempotencyKey(ctx.entity.slug, "files-assoc", { file: r.body.Id, ...assoc }),
        });
        r.body = { ...r.body, _association: a.ok ? "WRITTEN" : `FAILED ${a.status}: ${(a.text || "").slice(0, 300)}` };
      }
      return r;
    },
    describe: (_s, body) => ({ FileID: body?.Id, file_name: body?.Name, ...(body?._association ? { association: body._association } : {}) }),
  };
}));

// Link a file already in Xero Files (a Documents inbox item) to a record: the
// API equivalent of the Documents "Match" button. The association IS the
// attachment, so a second copy of a document the record already holds is
// refused unless allow_duplicate. Body: file_id, object_id, object_group,
// audit_note, allow_duplicate.
app.post(`${WRITE}/file-associations`, gatedWrite("associate_file", "draft", async (ctx, b) => {
  const issues = [];
  if (!writeRules.ASSOCIABLE.includes(b.object_group)) issues.push(`object_group must be one of ${writeRules.ASSOCIABLE.join(", ")}`);
  if (!writeRules.isGuid(b.file_id) || !writeRules.isGuid(b.object_id)) issues.push("file_id and object_id must be Xero GUIDs");
  if (!String(b.audit_note || "").trim()) issues.push("audit_note is required");
  const payload = { ObjectId: b.object_id, ObjectGroup: b.object_group };
  let fileName = "";
  const holder = writeRules.ASSOC_ATTACHMENTS[b.object_group];
  if (!issues.length) {
    const file = await xeroGetOrNull(ctx, `${XERO_FILES_API}/Files/${b.file_id}`);
    if (!file) issues.push(`No file ${b.file_id} in Xero Files`);
    fileName = file?.Name || "";
    const assoc = (await xeroGetOrNull(ctx, `${XERO_FILES_API}/Files/${b.file_id}/Associations`)) || [];
    if (assoc.some((x) => x?.ObjectId === b.object_id)) issues.push(`file ${b.file_id} is already associated with ${b.object_id}: nothing to do`);
    if (holder && fileName && !b.allow_duplicate) {
      const held = ((await xeroGetOrNull(ctx, `/${holder}/${b.object_id}/Attachments`))?.Attachments ?? []).map((x) => x.FileName);
      if (held.includes(fileName)) {
        issues.push(`${b.object_id} already has an attachment named ${fileName}; associating would duplicate it. Pass allow_duplicate to do it anyway`);
      }
    }
  }
  return {
    issues, operation: "create", payload, extra: { file_name: fileName },
    send: (key) => xeroSend(ctx, "POST", `${XERO_FILES_API}/Files/${b.file_id}/Associations`, { json: payload, key }),
    describe: () => ({ FileID: b.file_id, associated_with: b.object_id }),
    history: () => holder && writeRules.HISTORY_RESOURCES.includes(holder) && {
      resource: holder, id: b.object_id, text: `Linked Files document ${fileName || b.file_id}. ${String(b.audit_note).trim()}`,
    },
  };
}));

// ── Confirmed-tier writes (parity with the laptop MCP) ──────────────────────
//
// post, send, settle, setup and conversion. Same route shape as the draft
// tier above, plus the confirmation code and the settle cap (gatedWrite).
// Rules live in lib/xero-confirmed.js, where they are tested.
//
// Where a write targets a record named in the URL rather than the body (a
// payment to delete, a credit to allocate), that record's id is part of the
// payload the confirmation code is bound to, so a code shown for one record
// cannot be spent on another. `send` carries the body Xero actually receives.

const XERO_ASSETS_API = "https://api.xero.com/assets.xro/1.0";

async function xeroDoc(ctx, endpoint, id) {
  return ((await xeroGetOrNull(ctx, `/${endpoint}/${id}`))?.[endpoint] ?? [])[0] || null;
}

const noteOf = (b) => String(b.audit_note || "").trim();

// Manual journals under the confirmed-tier model: DRAFT is the draft tier;
// POSTED is the post tier and needs a dry run's confirmation code. Two ways
// in, one set of rules:
//   journals-from-file  Xero's manual journal import CSV (the Feldspar payroll
//                       template) as the request body; status, audit_note,
//                       allow_duplicate, dry_run and confirmation_code in the
//                       query string. The code covers the whole file.
//   journals            one journal as JSON: the laptop's post_journal.
// The journals endpoint above stays, for callers using its approval-text
// model. Every journal is validated before any is sent.
//
// `source(input, req)` returns { journals: [{ narration, date, rows, lines }],
// issues }, with each line's tax rate as written (a Xero rate name or code).
function journalsPlan(source, origin) {
  return async (ctx, q, req) => {
    const status = String(q.status || "DRAFT").toUpperCase();
    const issues = [...confirmedRules.auditNoteIssues(q)];
    if (!["DRAFT", "POSTED"].includes(status)) issues.push("status must be DRAFT or POSTED");
    const parsed = source(q, req);
    issues.push(...parsed.issues);
    if (issues.length) return { issues, operation: "create" };

    const [accounts, taxRates, lockDates] = await Promise.all([
      xeroRef(ctx, "Accounts"), xeroRef(ctx, "TaxRates"), xeroLockDates(ctx),
    ]);
    const needsTracking = parsed.journals.some((j) => j.lines.some((l) => l.tracking.length));
    const tracking = needsTracking ? await xeroRef(ctx, "TrackingCategories") : [];
    const warnings = lockDates.unavailable ? ["PERIOD_LOCK_UNCHECKED: the lock dates could not be read; Xero will still enforce them"] : [];
    const journals = parsed.journals.map((j) => {
      const label = `Journal "${j.narration}" ${j.date} (rows ${j.rows[0]}-${j.rows[j.rows.length - 1]})`;
      const lines = j.lines.map((l) => {
        const t = confirmedRules.resolveTaxRate(l.tax_rate, taxRates);
        if (t.error) issues.push(`${label}: ${t.error}`);
        for (const tr of l.tracking) {
          const cat = tracking.find((c) => c.Name === tr.name && c.Status === "ACTIVE");
          if (!cat) issues.push(`${label}: tracking category ${tr.name} is not active in this entity`);
          else if (!(cat.Options || []).some((o) => o.Name === tr.option && o.Status === "ACTIVE")) {
            issues.push(`${label}: ${tr.option} is not an active option of ${tr.name}`);
          }
        }
        return { ...l, tax_type: t.taxType || "NONE" };
      });
      const v = validateJournal({ narration: j.narration, date: j.date, status, lines }, {
        accounts, lockDates, now: Date.now(), entitySlug: ctx.entity.slug, entityName: ctx.entity.name,
      });
      // The approver here is whoever redeems the confirmation code, so the
      // journals endpoint's approval-text checks do not apply. Every other
      // rule does: balance, accounts, bank accounts, lock dates, precision.
      for (const i of v.issues) if (!i.code.includes("APPROVAL")) issues.push(`${label}: ${i.detail}`);
      warnings.push(...v.warnings.map((x) => `${label}: ${x}`));
      const payload = buildXeroPayload({ narration: j.narration, date: j.date, status, lines });
      payload.JournalLines.forEach((jl, i) => {
        if (lines[i].tracking.length) jl.Tracking = lines[i].tracking.map((t) => ({ Name: t.name, Option: t.option }));
      });
      return { label, payload, lines: lines.length, gross: confirmedRules.grossOf(lines.map((l) => l.amount)) };
    });

    // Re-uploading last month's file must not post it twice.
    if (!issues.length && !(q.allow_duplicate === "true" || q.allow_duplicate === true)) {
      for (const date of new Set(journals.map((j) => j.payload.Date))) {
        const [y, m, d] = date.split("-");
        const existing = (await xeroGet(ctx.accessToken, ctx.tenantId, "/ManualJournals", { where: `Date==DateTime(${y},${m},${d})` }))?.ManualJournals ?? [];
        for (const j of journals.filter((x) => x.payload.Date === date)) {
          const clash = existing.find((e) => String(e.Narration || "").trim() === j.payload.Narration && !["VOIDED", "DELETED"].includes(e.Status));
          if (clash) issues.push(`${j.label}: a ${clash.Status} journal with this narration and date already exists (${clash.ManualJournalID}). Pass allow_duplicate=true only if it is genuinely a second journal`);
        }
      }
    }

    const payload = { ManualJournals: journals.map((j) => j.payload) };
    return {
      issues, operation: "create", payload,
      extra: { journal_count: journals.length, journals: journals.map(({ payload: _p, ...j }) => j), warnings },
      // One call per journal, each with its own key, so a retry after a
      // failure part-way re-sends only what had not landed.
      send: async (key) => {
        const saved = [];
        for (const [i, j] of journals.entries()) {
          const r = await xeroSend(ctx, "POST", "/ManualJournals?summarizeErrors=false", {
            json: { ManualJournals: [j.payload] }, key: `${key.slice(0, 120)}-${i + 1}`,
          });
          const row = r.body?.ManualJournals?.[0];
          const errs = (row?.ValidationErrors || []).map((e) => e.Message);
          if (!r.ok || errs.length) {
            return {
              ...r, ok: false, errors: errs.length ? errs : writeRules.xeroErrors(r.body),
              partial: {
                written: saved.map((s) => ({ ManualJournalID: s.ManualJournalID, Narration: s.Narration, Status: s.Status })),
                failed: j.label, not_attempted: journals.length - i - 1,
              },
            };
          }
          saved.push(row);
        }
        return { ok: true, status: 200, body: { ManualJournals: saved } };
      },
      describe: (_s, body) => ({
        journals_written: (body?.ManualJournals || []).map((m) => ({
          ManualJournalID: m.ManualJournalID, Narration: m.Narration, xero_status: m.Status,
        })),
      }),
      history: (_s, body) => (body?.ManualJournals || []).map((m) => ({
        resource: "ManualJournals", id: m.ManualJournalID,
        text: `${origin} as ${m.Status}. ${noteOf(q)}`,
      })),
    };
  };
}

const journalFile = (_q, req) => {
  const text = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  return text.trim() ? confirmedRules.parseJournalFile(text) : { journals: [], issues: ["The CSV goes in the request body"] };
};

app.post(`${WRITE}/journals-from-file`, uploadBody, gatedWrite("post_journal_from_csv",
  (q) => confirmedRules.journalTier(q.status), journalsPlan(journalFile, "Imported from a journal file")));

app.post(`${WRITE}/journals`, gatedWrite("post_journal",
  (b) => confirmedRules.journalTier(b.status), journalsPlan((b) => confirmedRules.journalEntries(b), "Created")));

// DRAFT -> POSTED, DRAFT -> VOIDED, POSTED -> VOIDED. Reads the journal back
// first, so the dry run shows what is being approved rather than a guid.
app.post(`${WRITE}/journal-status`, gatedWrite("update_journal_status",
  (b) => confirmedRules.journalTier(b.new_status), async (ctx, b) => {
    const target = String(b.new_status || "").toUpperCase();
    const issues = [...confirmedRules.auditNoteIssues(b), ...confirmedRules.guidIssues(b.manual_journal_id, "manual_journal_id")];
    if (issues.length) return { issues, operation: "update" };
    const mj = await xeroDoc(ctx, "ManualJournals", b.manual_journal_id);
    if (!mj) return { issues: [`No manual journal ${b.manual_journal_id} in this entity`], operation: "update" };
    issues.push(...confirmedRules.journalTransitionIssues(mj.Status, target));
    const payload = { ManualJournals: [{ ManualJournalID: b.manual_journal_id, Status: target }] };
    return {
      issues, operation: "update", payload,
      extra: {
        narration: mj.Narration, date: mj.Date, current_status: mj.Status,
        gross: confirmedRules.grossOf((mj.JournalLines || []).map((l) => Number(l.LineAmount || 0).toFixed(2))),
      },
      send: (key) => xeroSend(ctx, "POST", "/ManualJournals?summarizeErrors=false", { json: payload, key }),
      saved: (body) => body?.ManualJournals?.[0] || null,
      describe: (s) => ({ ManualJournalID: s?.ManualJournalID, xero_status: s?.Status }),
      history: () => ({ resource: "ManualJournals", id: b.manual_journal_id, text: `Status ${mj.Status} to ${target}. ${noteOf(b)}` }),
    };
  }));

// Email an approved sales invoice from Xero. External and cannot be recalled.
app.post(`${WRITE}/invoice-emails`, gatedWrite("email_invoice", "send", async (ctx, b) => {
  const issues = [...confirmedRules.auditNoteIssues(b), ...confirmedRules.guidIssues(b.invoice_id, "invoice_id")];
  if (issues.length) return { issues, operation: "create" };
  const inv = await xeroDoc(ctx, "Invoices", b.invoice_id);
  if (!inv) return { issues: [`No invoice ${b.invoice_id} in this entity`], operation: "create" };
  if (inv.Type !== "ACCREC") issues.push("only sales invoices (ACCREC) can be emailed");
  if (!["SUBMITTED", "AUTHORISED", "PAID"].includes(inv.Status)) issues.push(`the invoice is ${inv.Status}; Xero emails only SUBMITTED, AUTHORISED or PAID`);
  const payload = { InvoiceID: b.invoice_id };
  return {
    issues, operation: "create", payload,
    extra: {
      invoice_number: inv.InvoiceNumber, contact: inv.Contact?.Name, contact_email: inv.Contact?.EmailAddress || null,
      total: inv.Total, currency: inv.CurrencyCode, invoice_status: inv.Status,
    },
    send: (key) => xeroSend(ctx, "POST", `/Invoices/${b.invoice_id}/Email`, { json: {}, key }),
    describe: () => ({ InvoiceID: b.invoice_id, emailed_to: inv.Contact?.Name }),
    history: () => ({ resource: "Invoices", id: b.invoice_id, text: `Emailed to the customer from Xero. ${noteOf(b)}` }),
  };
}));

// Record a payment that has happened, against an AUTHORISED document. Moves no
// money and makes no bank payment.
app.post(`${WRITE}/payments`, gatedWrite("record_payment", "settle", async (ctx, b) => {
  const pr = confirmedRules.paymentRequest(b);
  const issues = [...pr.issues];
  let extra = {};
  if (!issues.length) {
    const doc = await xeroDoc(ctx, b.document_type, b.document_id);
    if (!doc) issues.push(`No ${b.document_type === "CreditNotes" ? "credit note" : "invoice"} ${b.document_id} in this entity`);
    else {
      extra = {
        number: doc.InvoiceNumber || doc.CreditNoteNumber, contact: doc.Contact?.Name, document_status: doc.Status,
        amount_due: doc.AmountDue ?? doc.RemainingCredit, currency: doc.CurrencyCode,
      };
      issues.push(...confirmedRules.paymentDocumentIssues(doc, pr.amount));
    }
    issues.push(...confirmedRules.bankAccountIssues(await xeroRef(ctx, "Accounts"), b.bank_account_code));
  }
  return {
    issues, operation: "create", payload: pr.payload, amount: pr.amount, extra,
    send: (key) => xeroSend(ctx, "PUT", "/Payments?summarizeErrors=false", { json: pr.payload, key }),
    saved: (body) => body?.Payments?.[0] || null,
    describe: (s) => ({ PaymentID: s?.PaymentID, xero_status: s?.Status }),
    history: (s) => s?.PaymentID && { resource: "Payments", id: s.PaymentID, text: `Payment recorded. ${noteOf(b)}` },
  };
}));

// Delete a payment recorded in error. Xero refuses reconciled payments, and so
// does this, before asking.
app.post(`${WRITE}/payment-deletions`, gatedWrite("delete_payment", "settle", async (ctx, b) => {
  const issues = [...confirmedRules.auditNoteIssues(b), ...confirmedRules.guidIssues(b.payment_id, "payment_id")];
  if (issues.length) return { issues, operation: "update" };
  const p = await xeroDoc(ctx, "Payments", b.payment_id);
  if (!p) return { issues: [`No payment ${b.payment_id} in this entity`], operation: "update" };
  if (p.IsReconciled) issues.push("the payment is reconciled; unreconcile it in Xero first");
  if (p.Status === "DELETED") issues.push("the payment is already deleted");
  const payload = { Payments: [{ PaymentID: b.payment_id, Status: "DELETED" }] };
  return {
    issues, operation: "update", payload, amount: Number(p.Amount || 0).toFixed(2),
    extra: { payment_date: p.Date, payment_status: p.Status, is_reconciled: Boolean(p.IsReconciled), invoice: p.Invoice?.InvoiceNumber },
    send: (key) => xeroSend(ctx, "POST", `/Payments/${b.payment_id}`, { json: { Status: "DELETED" }, key }),
    saved: (body) => body?.Payments?.[0] || null,
    describe: (s) => ({ PaymentID: b.payment_id, xero_status: s?.Status }),
    history: () => ({ resource: "Payments", id: b.payment_id, text: `Payment deleted. ${noteOf(b)}` }),
  };
}));

// Apply a credit note, prepayment or overpayment against an invoice.
app.post(`${WRITE}/allocations`, gatedWrite("allocate_credit", "settle", async (ctx, b) => {
  const ar = confirmedRules.allocationRequest(b);
  const issues = [...ar.issues];
  let extra = {};
  if (!issues.length) {
    const [src, inv] = await Promise.all([xeroDoc(ctx, b.source_type, b.source_id), xeroDoc(ctx, "Invoices", b.invoice_id)]);
    if (!src) issues.push(`No ${b.source_type} ${b.source_id} in this entity`);
    if (!inv) issues.push(`No invoice ${b.invoice_id} in this entity`);
    if (src && inv) {
      extra = { remaining_credit: src.RemainingCredit, invoice_amount_due: inv.AmountDue, contact: inv.Contact?.Name };
      issues.push(...confirmedRules.allocationDocumentIssues(src, inv, ar.amount));
    }
  }
  const payload = { Source: { Type: b.source_type, ID: b.source_id }, ...ar.payload };
  return {
    issues, operation: "create", payload, amount: ar.amount, extra,
    send: (key) => xeroSend(ctx, "PUT", `/${b.source_type}/${b.source_id}/Allocations`, { json: ar.payload, key }),
    history: () => ({ resource: b.source_type, id: b.source_id, text: `Allocated ${ar.amount} to invoice ${b.invoice_id}. ${noteOf(b)}` }),
  };
}));

// Undo an allocation. Reads the source first, so the allocation is shown.
app.post(`${WRITE}/allocation-removals`, gatedWrite("remove_allocation", "settle", async (ctx, b) => {
  const issues = [...confirmedRules.auditNoteIssues(b)];
  if (!confirmedRules.ALLOCATABLE[b.source_type]) issues.push(`source_type must be one of ${Object.keys(confirmedRules.ALLOCATABLE).join(", ")}`);
  issues.push(...confirmedRules.guidIssues(b.source_id, "source_id"), ...confirmedRules.guidIssues(b.allocation_id, "allocation_id"));
  if (issues.length) return { issues, operation: "update" };
  const src = await xeroDoc(ctx, b.source_type, b.source_id);
  const alloc = (src?.Allocations || []).find((a) => a.AllocationID === b.allocation_id);
  if (!src) issues.push(`No ${b.source_type} ${b.source_id} in this entity`);
  else if (!alloc) issues.push(`${b.source_type} ${b.source_id} has no allocation ${b.allocation_id}`);
  const payload = { Source: { Type: b.source_type, ID: b.source_id }, AllocationID: b.allocation_id };
  return {
    issues, operation: "update", payload,
    extra: alloc ? { allocated_amount: alloc.Amount, invoice: alloc.Invoice?.InvoiceNumber, allocation_date: alloc.Date } : {},
    send: (key) => xeroSend(ctx, "DELETE", `/${b.source_type}/${b.source_id}/Allocations/${b.allocation_id}`, { key }),
    history: () => ({ resource: b.source_type, id: b.source_id, text: `Allocation ${b.allocation_id} removed. ${noteOf(b)}` }),
  };
}));

// Spend or receive money directly against a bank account.
app.post(`${WRITE}/bank-transactions`, gatedWrite("upsert_bank_transaction", "settle", async (ctx, b) => {
  const bt = confirmedRules.bankTransactionRequest(b);
  const issues = [...bt.issues];
  const [accounts, taxRates] = await Promise.all([xeroRef(ctx, "Accounts"), xeroRef(ctx, "TaxRates")]);
  const v = writeRules.validateLines(b.lines, accounts, taxRates);
  issues.push(...v.issues);
  if (b.bank_account_code) issues.push(...confirmedRules.bankAccountIssues(accounts, b.bank_account_code));
  if (b.id && writeRules.isGuid(b.id)) {
    const existing = await xeroDoc(ctx, "BankTransactions", b.id);
    if (!existing) issues.push(`No bank transaction ${b.id} in this entity`);
    else if (existing.IsReconciled) issues.push("the bank transaction is reconciled; Xero will not change it");
  }
  const payload = confirmedRules.buildBankTransaction(b, { ...bt, items: v.items });
  return {
    issues, operation: b.id ? "update" : "create", payload, amount: v.net, extra: { net_before_tax: v.net },
    send: (key) => xeroSend(ctx, "POST", "/BankTransactions?summarizeErrors=false", { json: payload, key }),
    saved: (body) => body?.BankTransactions?.[0] || null,
    describe: (s) => ({ BankTransactionID: s?.BankTransactionID, xero_status: s?.Status, total: s?.Total }),
    history: (s) => s?.BankTransactionID && { resource: "BankTransactions", id: s.BankTransactionID, text: `${b.id ? "Updated" : "Created"}. ${noteOf(b)}` },
  };
}));

// Record a transfer between two of the organisation's bank accounts.
app.post(`${WRITE}/bank-transfers`, gatedWrite("create_bank_transfer", "settle", async (ctx, b) => {
  const tr = confirmedRules.bankTransferRequest(b);
  const issues = [...tr.issues];
  if (!issues.length) {
    const accounts = await xeroRef(ctx, "Accounts");
    issues.push(
      ...confirmedRules.bankAccountIssues(accounts, b.from_bank_account_code, "from_bank_account_code"),
      ...confirmedRules.bankAccountIssues(accounts, b.to_bank_account_code, "to_bank_account_code"),
    );
  }
  return {
    issues, operation: "create", payload: tr.payload, amount: tr.amount,
    send: (key) => xeroSend(ctx, "PUT", "/BankTransfers", { json: tr.payload, key }),
    saved: (body) => body?.BankTransfers?.[0] || null,
    describe: (s) => ({ BankTransferID: s?.BankTransferID }),
    history: (s) => s?.BankTransferID && { resource: "BankTransfers", id: s.BankTransferID, text: `Transfer recorded. ${noteOf(b)}` },
  };
}));

// Master data a new client needs: accounts, tax rates, tracking, currencies,
// items, contact groups. Archiving and deleting are left to a person.
app.post(`${WRITE}/settings`, gatedWrite("upsert_setting", "setup", async (ctx, b) => {
  const sr = confirmedRules.settingRequest(b.kind, b.record, b);
  const issues = [...sr.issues];
  if (!issues.length && ["account_create", "account_update", "item"].includes(b.kind)) {
    const accounts = await xeroRef(ctx, "Accounts");
    issues.push(...confirmedRules.settingChartIssues(b.kind, b.record || {}, accounts));
    if (b.kind === "account_update" && !accounts.some((a) => a.AccountID === b.record.AccountID)) {
      issues.push(`No account ${b.record.AccountID} in this entity`);
    }
  }
  const payload = sr.path ? { kind: b.kind, path: sr.path, body: sr.payload } : null;
  return {
    issues, operation: /update/.test(b.kind || "") ? "update" : "create", payload,
    send: (key) => xeroSend(ctx, sr.method, `/${sr.path}`, { json: sr.payload, key }),
    saved: (body) => {
      const list = body && Object.values(body).find(Array.isArray);
      return list ? list[0] || null : null;
    },
    describe: (s) => ({ saved: s }),
  };
}));

// A repeating sales invoice template, saved as DRAFT.
app.post(`${WRITE}/repeating-invoices`, gatedWrite("upsert_repeating_invoice", "setup", async (ctx, b) => {
  const ri = confirmedRules.repeatingInvoiceRequest(b);
  const issues = [...ri.issues];
  const [accounts, taxRates] = await Promise.all([xeroRef(ctx, "Accounts"), xeroRef(ctx, "TaxRates")]);
  const v = writeRules.validateLines(b.lines, accounts, taxRates);
  issues.push(...v.issues);
  if (b.id && writeRules.isGuid(b.id)) {
    const existing = await xeroDoc(ctx, "RepeatingInvoices", b.id);
    if (!existing) issues.push(`No repeating invoice ${b.id} in this entity`);
    else if (existing.Status !== "DRAFT") issues.push(`the template is ${existing.Status}; only DRAFT templates are changed here`);
  }
  const payload = confirmedRules.buildRepeatingInvoice(b, { ...ri, items: v.items });
  return {
    issues, operation: b.id ? "update" : "create", payload, extra: { net_before_tax_each: v.net },
    send: (key) => xeroSend(ctx, "POST", "/RepeatingInvoices?summarizeErrors=false", { json: payload, key }),
    saved: (body) => body?.RepeatingInvoices?.[0] || null,
    describe: (s) => ({ RepeatingInvoiceID: s?.RepeatingInvoiceID, xero_status: s?.Status }),
    history: (s) => s?.RepeatingInvoiceID && { resource: "RepeatingInvoices", id: s.RepeatingInvoiceID, text: `${b.id ? "Updated" : "Created"} as DRAFT. ${noteOf(b)}` },
  };
}));

// Register a fixed asset or create an asset type (Assets API).
app.post(`${WRITE}/fixed-assets`, gatedWrite("create_fixed_asset", "setup", async (ctx, b) => {
  const fa = confirmedRules.fixedAssetRequest(b.what, b.record, b);
  const issues = [...fa.issues];
  if (!issues.length && b.what === "asset_type") {
    const ids = new Set((await xeroRef(ctx, "Accounts")).filter((a) => a.Status === "ACTIVE").map((a) => a.AccountID));
    for (const f of ["fixedAssetAccountId", "depreciationExpenseAccountId", "accumulatedDepreciationAccountId"]) {
      if (!ids.has(fa.payload[f])) issues.push(`${f} ${fa.payload[f]} is not an active account in this entity`);
    }
  }
  const payload = fa.path ? { path: fa.path, body: fa.payload } : null;
  return {
    issues, operation: "create", payload,
    send: (key) => xeroSend(ctx, "POST", `${XERO_ASSETS_API}/${fa.path}`, { json: fa.payload, key }),
    describe: (_s, body) => ({ assetId: body?.assetId, assetTypeId: body?.assetTypeId }),
  };
}));

// Conversion date and opening balances for a client moving onto Xero. No undo
// and no read-back, so off by default everywhere.
app.post(`${WRITE}/conversion-setup`, gatedWrite("post_conversion_setup", "conversion", async (ctx, b) => {
  const cr = confirmedRules.conversionRequest(b);
  const issues = [...cr.issues];
  if (!issues.length) {
    const codes = new Set((await xeroRef(ctx, "Accounts")).map((a) => a.Code));
    for (const row of cr.payload.ConversionBalances) {
      if (!codes.has(row.AccountCode)) issues.push(`account code ${row.AccountCode} is not in this entity's chart of accounts`);
    }
  }
  return {
    issues, operation: "create", payload: cr.payload, extra: { net: cr.net },
    send: (key) => xeroSend(ctx, "POST", "/Setup", { json: cr.payload, key }),
  };
}));

// ── Checking a bill ─────────────────────────────────────────────────────────
//
// GET /api/finance/clients/:slug/xero/:entity/checks/bill/:id?since=<ISO>
//
// The laptop MCP's check_bill: the deterministic flags over one supplier bill
// (lib/bill-checks.js). Reads only, so no tier and no audit row. Run by the
// drafter before submitting and independently by the reviewer, because a check
// performed only by the party being reviewed is not a control.
app.get("/api/finance/clients/:slug/xero/:entity/checks/bill/:id", route(async (req, res) => {
  if (!writeRules.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a Xero GUID" });
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

  const bill = await xeroDoc(ctx, "Invoices", req.params.id);
  if (!bill) return res.status(404).json({ error: `no bill ${req.params.id} in ${ctx.entity.slug}` });

  const [org, accounts, history, attachments] = await Promise.all([
    xeroGet(ctx.accessToken, ctx.tenantId, "/Organisation", {}),
    xeroRef(ctx, "Accounts"),
    xeroGetOrNull(ctx, `/Invoices/${req.params.id}/History`),
    xeroGetOrNull(ctx, `/Invoices/${req.params.id}/Attachments`),
  ]);

  let siblings = [];
  let priorLines = [];
  const contactId = bill.Contact?.ContactID;
  if (contactId && writeRules.isGuid(contactId)) {
    siblings = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Invoices", {
      page: 1, where: `Type=="ACCPAY" AND Contact.ContactID==Guid("${contactId}")`,
    }))?.Invoices ?? [];
    const recent = siblings
      .filter((b) => b.InvoiceID !== bill.InvoiceID && !["DELETED", "VOIDED"].includes(b.Status))
      .sort((a, b) => billChecks.billDate(b).localeCompare(billChecks.billDate(a)))
      .slice(0, 3);
    for (const b of recent) priorLines.push(...((await xeroDoc(ctx, "Invoices", b.InvoiceID))?.LineItems ?? []));
  }

  res.json({
    entity: ctx.entity.name,
    ...billChecks.checkBill({
      bill,
      paysTax: org?.Organisations?.[0]?.PaysTax,
      accounts, siblings, priorLines,
      history: history?.HistoryRecords ?? [],
      attachments: attachments?.Attachments ?? [],
      since: req.query.since || "",
    }),
  });
}));

// ── Checking payroll against the ledger ─────────────────────────────────────
//
// GET /api/finance/clients/:slug/xero/:entity/checks/payroll?from=YYYY-MM&to=YYYY-MM
//
// For an entity that runs payroll in Xero (STZA): each month's pay runs against
// the wage cost, wages payable and HMRC liabilities in the trial balance
// (lib/payroll-checks.js). Reads only, so no tier and no audit row. Defaults to
// the first pay run's month through the last complete month; at most 24 months,
// one trial balance each. An entity whose payroll is run elsewhere (Feldspar)
// gets a 422 saying so rather than a page of "pay run missing".
app.get("/api/finance/clients/:slug/xero/:entity/checks/payroll", route(async (req, res) => {
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/;
  for (const k of ["from", "to"]) {
    if (req.query[k] && !ym.test(req.query[k])) return res.status(400).json({ error: `${k} must be YYYY-MM` });
  }
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);

  const payroll = (path, params) => xeroGet(ctx.accessToken, ctx.tenantId, `${XERO_APIS.payroll}${path}`, params);
  let settings;
  const payRuns = [];
  try {
    settings = stripPersonal(await payroll("/Settings"));
    for (let page = 1; page <= 20; page++) {
      const batch = stripPersonal(await payroll("/PayRuns", { page }))?.payRuns ?? [];
      payRuns.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (e) {
    if ([401, 403, 404].includes(e.detail?.status)) {
      return res.status(422).json({ error: `${ctx.entity.name} does not run payroll in Xero (Xero returned ${e.detail.status})` });
    }
    throw e;
  }
  const accounts = payrollChecks.payrollAccounts(settings?.settings?.accounts);
  if (!accounts.wages) return res.status(422).json({ error: "Xero payroll settings name no wages expense account" });

  const today = new Date().toISOString().slice(0, 10);
  const lastComplete = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  const firstRun = payRuns.map((r) => String(r.paymentDate || "").slice(0, 7)).filter(Boolean).sort()[0];
  const to = req.query.to || lastComplete;
  const from = req.query.from || firstRun || to;
  if (from > to) return res.status(400).json({ error: "from is after to" });
  const months = payrollChecks.monthsBetween(from, to);
  if (months.length > 24) return res.status(400).json({ error: "at most 24 months per call" });

  const ledger = [];
  for (const m of months) {
    const report = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date: m.end });
    ledger.push({ ...m, tb: payrollChecks.parseTrialBalance(report) });
  }

  res.json({
    entity: ctx.entity.name, from, to, pay_runs: payRuns.length,
    ...payrollChecks.checkPayroll({ payRuns, accounts, ledger, today }),
  });
}));

// ── Supplier master: the proposal pass ───────────────────────────────────────
//
// POST /api/finance/clients/:slug/xero/:entity/suppliers/proposals
//   body: { contact_ids: [ContactID, ...] }   (1 to 20)
//
// For each supplier: its latest bill with a document attached is read by the
// model (lib/vertex.js, London) against the determination tree, and the
// proposal is stored in finance.supplier_proposals as 'pending' for the CFO
// (docs/ap-lane/ap-lane-spec.md 2.4 step 3). Code, not the model, masks bank
// details, computes the differences from the Xero contact and applies the
// supplier master (lib/supplier-proposal.js). Nothing is written to Xero.
// Sequential on purpose: Xero allows about 60 calls a minute per organisation.
app.post("/api/finance/clients/:slug/xero/:entity/suppliers/proposals", route(async (req, res) => {
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set((req.body?.contact_ids || []).map(String))];
  if (!ids.length || ids.length > 20 || !ids.every((id) => GUID.test(id))) {
    return res.status(400).json({ error: "contact_ids must be 1 to 20 Xero ContactIDs" });
  }
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);
  const { client, entity } = ctx;
  const get = (path, params) => xeroGet(ctx.accessToken, ctx.tenantId, path, params);

  const org = (await get("/Organisation")).Organisations?.[0] || {};
  const facts = supplierProposal.entityFacts(org, entity.accounting_system_config?.supplier_master || {});
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const runId = crypto.randomUUID();
  const results = [];

  for (const contactId of ids) {
    try {
      const master = (await pool.query(
        `SELECT s.*, se.id AS supplier_entity_id FROM finance.supplier_entities se
           JOIN finance.suppliers s ON s.id = se.supplier_id
          WHERE se.entity_id = $1 AND se.xero_contact_id = $2`, [entity.id, contactId])).rows[0] || null;
      const skip = supplierProposal.skipReason(master);
      if (skip) { results.push({ contact_id: contactId, skipped: skip }); continue; }

      const contact = (await get(`/Contacts/${contactId}`)).Contacts?.[0];
      if (!contact) { results.push({ contact_id: contactId, error: "contact not found" }); continue; }
      const view = supplierProposal.contactView(contact);

      // Newest first; the first bill with a PDF or image attached is the one read.
      const bills = (await get("/Invoices", {
        page: 1, order: "Date DESC",
        where: `Type=="ACCPAY" AND Contact.ContactID==guid("${contactId}")`,
      })).Invoices ?? [];
      let doc = null;
      for (const b of bills.filter((x) => x.HasAttachments && !["DELETED", "VOIDED"].includes(x.Status)).slice(0, 3)) {
        const atts = (await get(`/Invoices/${b.InvoiceID}/Attachments`)).Attachments ?? [];
        const a = atts.find((x) => /pdf|image\//.test(x.MimeType || "") && Number(x.ContentLength || 0) <= 15e6);
        if (!a) continue;
        const r = await xeroFetch(ctx.accessToken, ctx.tenantId, `/Invoices/${b.InvoiceID}/Attachments/${encodeURIComponent(a.FileName)}`, {}, { accept: a.MimeType });
        doc = { bill: b, file: a, bytes: Buffer.from(await r.arrayBuffer()) };
        break;
      }
      if (!doc) { results.push({ contact_id: contactId, name: contact.Name, error: "no bill with a document attached" }); continue; }

      const ledger = supplierPass.entityPass({
        entity: entity.slug, organisation: org, contacts: [contact],
        bills: bills.filter((b) => supplierPass.docDate(b) >= since), from: since,
      }).live[0] || null;
      const invoiceUsed = {
        id: doc.bill.InvoiceID, number: doc.bill.InvoiceNumber, date: supplierPass.docDate(doc.bill),
        total: doc.bill.Total, currency: doc.bill.CurrencyCode, file: doc.file.FileName,
      };
      const { IsPerson, ...contactForModel } = view;
      const context = {
        buying_entity: facts, xero_contact: contactForModel, invoice_used: invoiceUsed,
        ledger_last_12_months: ledger
          ? { net: ledger.net, documents: ledger.documents, accounts: ledger.accounts, tax_types: ledger.tax_types, currencies: ledger.currencies }
          : "none in window",
      };

      const out = await vertex.generate(supplierProposal.buildRequest({ document: doc.bytes, mimeType: doc.file.MimeType, context }));
      const { proposal, differences } = supplierProposal.finishProposal(out.text, { view, master });
      const sha = crypto.createHash("sha256").update(doc.bytes).digest("hex");
      const row = (await pool.query(
        `INSERT INTO finance.supplier_proposals
           (client_id, entity_id, xero_contact_id, supplier_entity_id, run_id, model, model_location,
            xero_invoice_id, document_sha256, proposal, differences, usage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [client.id, entity.id, contactId, master?.supplier_entity_id || null, runId, out.model, out.location,
          invoiceUsed.id, sha, { ...proposal, invoice_used: invoiceUsed, requested_by: actorEmail }, JSON.stringify(differences), out.usage],
      )).rows[0];
      results.push({
        contact_id: contactId, name: contact.Name, proposal_id: row.id,
        proposed_tax_type: proposal.proposed_tax_type, vat_branch: proposal.vat_branch, confidence: proposal.confidence,
        always_discuss: proposal.always_discuss, rules_applied: proposal.rules_applied, differences: differences.length,
      });
    } catch (e) {
      // One supplier's failure is reported against it; the run continues.
      results.push({ contact_id: contactId, error: e.message.slice(0, 300) });
    }
  }
  res.json({ entity: entity.name, run_id: runId, results });
}));

// GET /api/finance/clients/:slug/suppliers/proposals?decision=pending|all|...
// The review queue, newest first, across the client's entities.
app.get("/api/finance/clients/:slug/suppliers/proposals", route(async (req, res) => {
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });
  const decision = String(req.query.decision || "pending");
  const { rows } = await pool.query(
    `SELECT p.id, e.slug AS entity, p.xero_contact_id, p.run_id, p.model, p.model_location,
            p.xero_invoice_id, p.proposal, p.differences, p.decision, p.decision_note,
            p.decided_by_email, p.decided_at, p.created_at
       FROM finance.supplier_proposals p JOIN finance.entities e ON e.id = p.entity_id
      WHERE p.client_id = $1 AND ($2 = 'all' OR p.decision = $2)
      ORDER BY p.created_at DESC LIMIT 200`, [client.id, decision]);
  res.json({ count: rows.length, proposals: rows });
}));

// ── Supplier master: the CFO's decisions ─────────────────────────────────────
//
// Spec 2.4 step 4. A decision writes the supplier master in Cloud SQL and
// nothing else: writing an approved determination to the Xero contact is step 5,
// with its own dry run. lib/supplier-decision.js plans the rows; this applies
// them in one transaction with the audit row. Every decision is the CFO's act,
// so the actor must hold an engagement role for the client.

// The master rows a contact resolves to: its own link for this entity, else a
// supplier of the same client with the same VAT number (one identity across
// the group, spec 2.2).
async function supplierMasterFor(conn, clientId, entityId, contactId, vatNumber) {
  const link = (await conn.query(
    "SELECT * FROM finance.supplier_entities WHERE entity_id = $1 AND xero_contact_id = $2 FOR UPDATE",
    [entityId, contactId])).rows[0] || null;
  let supplier = null;
  if (link) {
    supplier = (await conn.query("SELECT * FROM finance.suppliers WHERE id = $1 FOR UPDATE", [link.supplier_id])).rows[0];
  } else if (vatNumber) {
    supplier = (await conn.query(
      `SELECT * FROM finance.suppliers WHERE client_id = $1
          AND upper(regexp_replace(vat_number, '\\s', '', 'g')) = upper(regexp_replace($2, '\\s', '', 'g')) FOR UPDATE`,
      [clientId, vatNumber])).rows[0] || null;
  }
  return { link, supplier };
}

const SUPPLIER_COLUMNS = ["legal_name", "trading_name", "country_of_establishment", "vat_number", "company_number",
  "supplier_type", "related_party", "always_discuss", "mixed_treatment", "status", "status_reason"];

// Writes a planned decision. Returns the supplier and supplier_entity ids, or
// nulls when the decision leaves the master alone.
async function writeSupplierDecision(conn, { clientId, entityId, contactId, contactName, plan, before, actorEmail, role }) {
  if (!plan.supplier) return { supplier_id: null, supplier_entity_id: null };
  const values = SUPPLIER_COLUMNS.map((c) => plan.supplier[c]);
  let supplierId = before.supplier?.id;
  if (supplierId) {
    await conn.query(
      `UPDATE finance.suppliers SET ${SUPPLIER_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`,
      [supplierId, ...values]);
  } else {
    supplierId = (await conn.query(
      `INSERT INTO finance.suppliers (client_id, ${SUPPLIER_COLUMNS.join(", ")})
       VALUES ($1, ${SUPPLIER_COLUMNS.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
      [clientId, ...values])).rows[0].id;
  }
  const l = plan.link;
  const approved = l.status === "approved";
  const linkId = (await conn.query(
    `INSERT INTO finance.supplier_entities AS se
       (supplier_id, entity_id, xero_contact_id, xero_contact_name, default_account_code, default_tax_type,
        vat_basis, vat_basis_note, default_currency, payment_terms_days, status,
        approved_by_email, approved_role, approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $11 = 'approved' THEN now() END)
     ON CONFLICT (entity_id, xero_contact_id) DO UPDATE SET
       supplier_id = EXCLUDED.supplier_id, xero_contact_name = EXCLUDED.xero_contact_name,
       default_account_code = EXCLUDED.default_account_code, default_tax_type = EXCLUDED.default_tax_type,
       vat_basis = EXCLUDED.vat_basis, vat_basis_note = EXCLUDED.vat_basis_note,
       default_currency = EXCLUDED.default_currency, payment_terms_days = EXCLUDED.payment_terms_days,
       status = EXCLUDED.status, approved_by_email = EXCLUDED.approved_by_email,
       approved_role = EXCLUDED.approved_role, approved_at = EXCLUDED.approved_at,
       -- A changed determination has not been written to Xero yet.
       written_to_xero_at = CASE WHEN se.default_tax_type IS DISTINCT FROM EXCLUDED.default_tax_type
                                   OR se.default_account_code IS DISTINCT FROM EXCLUDED.default_account_code
                                 THEN NULL ELSE se.written_to_xero_at END
     RETURNING id`,
    [supplierId, entityId, contactId, contactName, l.default_account_code, l.default_tax_type,
      l.vat_basis, l.vat_basis_note, l.default_currency, l.payment_terms_days, l.status,
      approved ? actorEmail : null, approved ? role : null])).rows[0].id;
  return { supplier_id: supplierId, supplier_entity_id: linkId };
}

// One decision, start to finish, in one transaction. proposalId names the
// pending proposal being decided, or is null for a decision made without one.
async function decideSupplier(res, { client, ctx, contactId, proposalId, body, actorEmail }) {
  // The contact name as it is now, so a later rename in Xero shows.
  const contact = (await xeroGet(ctx.accessToken, ctx.tenantId, `/Contacts/${contactId}`)).Contacts?.[0];
  if (!contact) return res.status(404).json({ error: "Xero contact not found in this entity" });
  const conn = await pool.connect();
  const refuse = async (status, payload) => { await conn.query("ROLLBACK"); return res.status(status).json(payload); };
  try {
    await conn.query("BEGIN");
    const role = (await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail])).rows[0].role;
    if (!role) return refuse(403, { error: `${actorEmail} holds no engagement role for this client; supplier decisions are the CFO's` });

    let proposal = null;
    if (proposalId) {
      const row = (await conn.query("SELECT decision, proposal FROM finance.supplier_proposals WHERE id = $1 FOR UPDATE", [proposalId])).rows[0];
      if (row.decision !== "pending") return refuse(409, { error: `proposal already decided: ${row.decision}` });
      proposal = row.proposal;
    } else {
      const pending = (await conn.query(
        `SELECT id FROM finance.supplier_proposals
          WHERE entity_id = $1 AND xero_contact_id = $2 AND decision = 'pending' LIMIT 1`,
        [ctx.entity.id, contactId])).rows[0];
      if (pending) return refuse(409, { error: "this supplier has a pending proposal; decide that instead", proposal_id: pending.id });
    }

    const vat = typeof body.edits?.vat_number === "string" ? body.edits.vat_number : proposal?.vat_number?.value || null;
    const before = await supplierMasterFor(conn, client.id, ctx.entity.id, contactId, vat);
    const plan = supplierDecision.planDecision({
      decision: body.decision, note: body.note, edits: body.edits, proposal,
      supplier: before.supplier, link: before.link, contactName: contact.Name,
    });
    if (plan.errors.length) return refuse(422, { error: `Nothing was saved: ${plan.errors.length} problem(s)`, errors: plan.errors });

    const ids = await writeSupplierDecision(conn, {
      clientId: client.id, entityId: ctx.entity.id, contactId, contactName: contact.Name, plan, before, actorEmail, role,
    });
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
    if (proposalId) {
      await conn.query(
        `UPDATE finance.supplier_proposals
            SET decision = $2, decision_note = $3, decided_by_email = $4, decided_at = now(),
                supplier_entity_id = COALESCE($5, supplier_entity_id)
          WHERE id = $1`,
        [proposalId, body.decision, note, actorEmail, ids.supplier_entity_id]);
    }
    const auditId = await audit(conn, {
      actorEmail, actorRole: role, action: "decide_supplier", targetType: "supplier_entity",
      targetId: ids.supplier_entity_id || contactId, clientId: client.id,
      payload: {
        entity: ctx.entity.slug, xero_contact_id: contactId, contact_name: contact.Name,
        proposal_id: proposalId, decision: body.decision, note,
        supplier: supplierDecision.changes(before.supplier, plan.supplier),
        supplier_entity: supplierDecision.changes(before.link, plan.link),
      },
    });
    await conn.query("COMMIT");
    res.json({
      decision: body.decision, proposal_id: proposalId, ...ids, audit_id: auditId,
      supplier: plan.supplier, supplier_entity: plan.link, written_to_xero: false,
    });
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    if (e.code === "23505") return res.status(409).json({ error: "another supplier of this client already holds that VAT number" });
    throw e;
  } finally {
    conn.release();
  }
}

// POST /api/finance/clients/:slug/suppliers/proposals/:id/decision
//   body: { decision, note?, edits? }   (lib/supplier-decision.js)
app.post("/api/finance/clients/:slug/suppliers/proposals/:id/decision", route(async (req, res) => {
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "proposal id must be a uuid" });
  }
  const client = await clientIdFromSlug(req.params.slug);
  if (!client) return res.status(404).json({ error: "client not found" });
  const row = (await pool.query(
    `SELECT p.id, p.xero_contact_id, p.decision, e.slug AS entity_slug FROM finance.supplier_proposals p
       JOIN finance.entities e ON e.id = p.entity_id
      WHERE p.id = $1 AND p.client_id = $2`, [req.params.id, client.id])).rows[0];
  if (!row) return res.status(404).json({ error: "proposal not found" });
  if (row.decision !== "pending") return res.status(409).json({ error: `proposal already decided: ${row.decision}` });
  const ctx = await xeroEntityContext(req.params.slug, row.entity_slug);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);
  await decideSupplier(res, { client, ctx, contactId: row.xero_contact_id, proposalId: row.id, body: req.body || {}, actorEmail });
}));

// POST /api/finance/clients/:slug/xero/:entity/suppliers/:contactId/decision
//   body: { decision: edited|always_discuss|excluded, note?, edits? }
// A decision with no proposal behind it: a supplier the CFO has already judged
// (dormant, an expense-claim payee). Refused while a proposal is pending.
app.post("/api/finance/clients/:slug/xero/:entity/suppliers/:contactId/decision", route(async (req, res) => {
  const actorEmail = (req.get("X-Actor-Email") || "").trim();
  if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.contactId)) {
    return res.status(400).json({ error: "contactId must be a Xero ContactID" });
  }
  const ctx = await xeroEntityContext(req.params.slug, req.params.entity);
  if (!ctx) return res.status(404).json({ error: "entity not found or not connected" });
  if (ctx.error) return erpUnavailable(res, ctx);
  await decideSupplier(res, { client: ctx.client, ctx, contactId: req.params.contactId, proposalId: null, body: req.body || {}, actorEmail });
}));

// ── Start ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  const port = parseInt(process.env.PORT || "8080", 10);
  app.listen(port, () => {
    console.log(`stza-finance-api listening on ${port}`);
  });
}

// The supplier decision writes are exported for the local-database check.
module.exports = { app, pool, supplierMasterFor, writeSupplierDecision };

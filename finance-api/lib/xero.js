// Pure decision logic for the Xero adapter.
//
// Separated from server.js so it can be tested without a network, a database
// or a Xero account. Everything here is a function of its arguments: the parts
// that can silently do the wrong thing, rather than fail loudly.

/**
 * Chooses which Xero organisation an authorisation actually granted.
 *
 * /connections returns every tenant the token can reach, which after the first
 * connection includes organisations authorised earlier. Taking the first entry
 * is a guess, and in production it guessed wrong: Feldspar Group Holdings was
 * mapped to Ultraspeed Digital Limited because Ultraspeed happened to be
 * listed first. A journal approved for one company would have posted to
 * another's ledger.
 *
 * Each connection records the authorisation event that created it, and the id
 * token from the exchange identifies the event that just happened. The
 * intersection is exactly what the operator chose.
 *
 * Returns { ok: true, tenant } or { ok: false, reason, matched }. Ambiguity is
 * an error, never a guess: a wrong tenant is worse than asking someone to
 * retry.
 */
function selectTenant(connections, authEventId) {
  if (!Array.isArray(connections) || connections.length === 0) {
    return { ok: false, reason: "none", matched: 0 };
  }

  // Without an auth event id we cannot tell which was just authorised. That is
  // only safe when there is exactly one possibility.
  if (!authEventId) {
    return connections.length === 1
      ? { ok: true, tenant: connections[0] }
      : { ok: false, reason: "no-auth-event", matched: connections.length };
  }

  const matched = connections.filter((c) => c.authEventId === authEventId);
  if (matched.length === 1) return { ok: true, tenant: matched[0] };
  return {
    ok: false,
    reason: matched.length === 0 ? "no-match" : "ambiguous",
    matched: matched.length,
  };
}

/** Reads the authorisation event id from an id token payload. */
function readAuthEventId(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return json.authentication_event_id || null;
  } catch {
    return null;
  }
}

/**
 * Reduces a forwarded header to one address, or null.
 *
 * X-Forwarded-For is a comma separated chain and ip_address is a Postgres
 * inet, which takes exactly one. Passing the raw header threw and rolled back
 * the transaction it was part of, so a bad audit value destroyed the Xero
 * connection it was recording.
 */
function normaliseIp(value) {
  if (!value) return null;
  const first = String(value).split(",")[0].trim();
  if (!first) return null;

  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(first);
  let candidate = bracketed ? bracketed[1] : first;

  // Strip a port from IPv4 only. A bare IPv6 address is full of colons.
  if (!bracketed && (candidate.match(/:/g) || []).length === 1) {
    candidate = candidate.replace(/:\d+$/, "");
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255) ? candidate : null;
  if (candidate.includes(":") && /^[0-9a-fA-F:.]+$/.test(candidate)) return candidate;
  return null;
}

/**
 * Decides whether a refresh response means the stored token must be replaced.
 *
 * Xero refresh tokens are single use. If a rotated token is not persisted the
 * connection is dead and only re-authorising recovers it, so this errs towards
 * writing: an unnecessary write costs a secret version, a missed one costs the
 * connection.
 */
function shouldPersistRefreshToken(previous, response) {
  if (!response || typeof response.refresh_token !== "string") return false;
  if (!response.refresh_token) return false;
  return response.refresh_token !== previous;
}

/**
 * Decides whether a Xero 401 means the access token is bad, or merely that it
 * was never granted the scope for this endpoint.
 *
 * These need different handling and look identical at the status code. A bad
 * token should drop the cached one so the next call refreshes. A scope failure
 * must not: the token is fine and will fail again for the same reason, so
 * dropping the cache turns a script looping over an unauthorised resource into
 * a token refresh on every iteration — and every refresh rotates the Xero
 * refresh token. That is the exact failure this service exists to prevent, and
 * six entries in the read passthrough allowlist (/Journals, /Payments,
 * /CreditNotes, ExecutiveSummary, BudgetSummary, AccountTransactions) are
 * unauthorised on every current connection, so the loop is reachable today.
 *
 * RFC 6750 distinguishes them in WWW-Authenticate: invalid_token against
 * insufficient_scope. Xero also says AuthenticationUnsuccessful for a bad token
 * and AuthorizationUnsuccessful for a missing scope, which is the fallback when
 * the header is absent.
 *
 * Defaults to false. Failing to invalidate costs one stale cache window of at
 * most thirty minutes; invalidating wrongly costs a rotation per request.
 */
function isTokenRejection(wwwAuthenticate, body) {
  const header = String(wwwAuthenticate || "");
  if (/insufficient_scope/i.test(header)) return false;
  if (/invalid_token|expired/i.test(header)) return true;

  const text = String(body || "");
  if (/AuthorizationUnsuccessful/i.test(text)) return false;
  return /AuthenticationUnsuccessful|TokenExpired/i.test(text);
}

module.exports = {
  selectTenant,
  readAuthEventId,
  normaliseIp,
  shouldPersistRefreshToken,
  isTokenRejection,
};

// Server-side helpers for the Xero authorisation round trip.
//
// The module owns the behaviour; the app shell supplies identity and handles
// cookies. No Xero credential is ever handled here: the API builds the
// authorise URL and performs the token exchange, so this layer only ever sees
// a code and a state value.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export const XERO_STATE_COOKIE = "stza_xero_state";

function apiKey(): string {
  const key = process.env.FINANCE_API_KEY;
  if (!key) throw new Error("FINANCE_API_KEY is not configured");
  return key;
}

// The state carries where to return to as well as guarding against CSRF, so
// the callback knows which entity was being connected without trusting a
// query parameter.
export interface ConnectState {
  nonce: string;
  slug: string;
  entity: string;
}

export function encodeState(state: ConnectState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeState(raw: string): ConnectState | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed?.nonce === "string" &&
      typeof parsed?.slug === "string" &&
      typeof parsed?.entity === "string"
    ) {
      return parsed as ConnectState;
    }
    return null;
  } catch {
    return null;
  }
}

export async function buildAuthorizeUrl(state: string, redirectUri: string): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/api/finance/xero/authorize-url?state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`,
    { headers: { "X-API-Key": apiKey() }, cache: "no-store" }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `authorize-url returned ${res.status}`);
  }
  return (await res.json()).url as string;
}

export interface ConnectResult {
  ok: boolean;
  entity?: string;
  tenantName?: string;
  error?: string;
}

export async function completeConnection(opts: {
  slug: string;
  entity: string;
  code: string;
  redirectUri: string;
  actorEmail: string;
  ip?: string;
}): Promise<ConnectResult> {
  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/xero/${encodeURIComponent(opts.entity)}/callback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey(),
        "X-Actor-Email": opts.actorEmail,
        ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
      },
      body: JSON.stringify({ code: opts.code, redirectUri: opts.redirectUri }),
      cache: "no-store",
    }
  );

  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}` };
  return { ok: true, entity: body.entity, tenantName: body.tenantName };
}

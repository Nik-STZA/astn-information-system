// Server-side secret access for the Finance module.
//
// The actor's identity is passed in rather than read here, because identity
// comes from IAP headers via the app shell and the module must not depend on
// app-level auth code. The module states what it needs; the shell supplies it.
//
// The returned value is passed straight to the caller and never logged.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export type SecretField = "client_id" | "client_secret" | "refresh_token";
export type SecretAction = "reveal" | "copy";

export interface SecretResult {
  ok: boolean;
  value?: string;
  error?: string;
  status: number;
}

export async function accessXeroSecret(opts: {
  slug: string;
  entity: string;
  field: SecretField;
  action: SecretAction;
  actorEmail: string;
  ip?: string;
}): Promise<SecretResult> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/xero/${encodeURIComponent(opts.entity)}/secret`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
        "X-Actor-Email": opts.actorEmail,
        ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
      },
      body: JSON.stringify({ action: opts.action, field: opts.field }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  }

  const body = await res.json();
  return { ok: true, value: body.value as string, status: 200 };
}

export interface XeroConnection {
  slug: string;
  name: string;
  legalName: string | null;
  role: string | null;
  accountingSystem: string;
  tenantId: string | null;
  tenantName: string | null;
  configName: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  secretName: string;
  connected: boolean;
}

export interface XeroStatus {
  appConfigured: boolean;
  connections: XeroConnection[];
  error?: string;
}

export async function fetchXeroStatus(slug: string): Promise<XeroStatus> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { appConfigured: false, connections: [], error: "FINANCE_API_KEY is not configured" };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/xero`,
    { headers: { "X-API-Key": key }, cache: "no-store" }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { appConfigured: false, connections: [], error: body.error ?? `upstream ${res.status}` };
  }

  const body = await res.json();
  return { appConfigured: body.appConfigured, connections: body.data };
}

export interface XeroOrganisation {
  tenantId: string;
  tenantName: string;
  tenantType: string;
}

// Listing organisations costs a token refresh, and Xero rotates the refresh
// token on every one. So this is called on demand when the operator opens the
// picker, never on page load.
export async function fetchXeroOrganisations(
  slug: string
): Promise<{ ok: boolean; data?: XeroOrganisation[]; error?: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/xero/organisations`,
    { headers: { "X-API-Key": key }, cache: "no-store" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body.data as XeroOrganisation[], status: 200 };
}

export async function mapXeroOrganisation(opts: {
  slug: string;
  entity: string;
  tenantId: string;
  actorEmail: string;
  ip?: string;
}): Promise<{ ok: boolean; tenantName?: string; error?: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/xero/${encodeURIComponent(opts.entity)}/organisation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
        "X-Actor-Email": opts.actorEmail,
        ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
      },
      body: JSON.stringify({ tenantId: opts.tenantId }),
      cache: "no-store",
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, tenantName: body.tenantName, status: 200 };
}

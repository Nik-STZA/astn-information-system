// Registry candidates: reads and writes through finance-api, which holds the
// candidate queue and the registry reviewer's agent runs (migration 044,
// finance-api/lib/registry-candidates-routes.js). Server side only.

import type { Candidate, RegistryReference } from "@/lib/data/registry-candidates-shared";

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export type FinanceApiResult<T> = { ok: boolean; status: number; data?: T; error?: string; body?: Record<string, unknown> };

export async function financeApi<T>(
  path: string,
  init: { method?: string; body?: unknown; actorEmail?: string } = {},
): Promise<FinanceApiResult<T>> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, status: 500, error: "FINANCE_API_KEY is not configured" };
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        ...(init.actorEmail ? { "X-Actor-Email": init.actorEmail } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(body.error ?? `finance-api answered ${res.status}`), body };
    return { ok: true, status: res.status, data: body as T, body };
  } catch (e) {
    return { ok: false, status: 502, error: `finance-api could not be reached: ${(e as Error).message}` };
  }
}

export async function fetchCandidates(view: "open" | "done"): Promise<{ data: Candidate[]; error?: string; migrationMissing?: boolean }> {
  const r = await financeApi<{ data: Candidate[]; migration_missing?: boolean }>(`/api/registry/candidates?view=${view}`);
  if (!r.ok) return { data: [], error: r.error };
  return { data: r.data?.data ?? [], migrationMissing: r.data?.migration_missing === true };
}

export async function fetchRegistryReference(): Promise<RegistryReference | null> {
  const r = await financeApi<RegistryReference>("/api/registry/reference");
  return r.ok ? r.data ?? null : null;
}

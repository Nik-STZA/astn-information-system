// Queueing agent work. Server side only.
//
// The portal only ever queues and reads. Execution happens on the operator's
// machine, because the agents need the client folder and the accounting MCP.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function queueAgentRun(opts: {
  slug: string;
  actorEmail: string;
  agent?: string | null;
  instruction: string;
  ip?: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/agent-runs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
        "X-Actor-Email": opts.actorEmail,
        ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
      },
      body: JSON.stringify({ agent: opts.agent || null, instruction: opts.instruction }),
      cache: "no-store",
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body, status: 201 };
}

export async function listAgentRuns(
  slug: string
): Promise<{ ok: boolean; data?: unknown[]; error?: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/agent-runs`,
    { headers: { "X-API-Key": key }, cache: "no-store" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body.data as unknown[], status: 200 };
}

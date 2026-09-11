// Queueing report builds. Server side only.
//
// Same shape as agent-runs.ts: the portal queues and reads, and a runner on the
// operator's machine (scripts/report-runner.mjs) builds the report.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function queueReportRun(opts: {
  slug: string;
  actorEmail: string;
  report: string;
  period: string;
  ip?: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/report-runs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
        "X-Actor-Email": opts.actorEmail,
        ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
      },
      body: JSON.stringify({ report: opts.report, period: opts.period }),
      cache: "no-store",
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body, status: 201 };
}

export async function listReportRuns(
  slug: string,
  report?: string
): Promise<{ ok: boolean; data?: unknown[]; error?: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const qs = report ? `?report=${encodeURIComponent(report)}` : "";
  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/report-runs${qs}`,
    { headers: { "X-API-Key": key }, cache: "no-store" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body.data as unknown[], status: 200 };
}

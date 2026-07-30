// Client for the notes endpoints. Server side only.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export interface NoteRow {
  id: string;
  target_type: "wip_item" | "open_item";
  target_id: string;
  body: string;
  kind: "note" | "decision" | "hold" | "query";
  actor_email: string;
  actor_role: string | null;
  created_at: string;
}

function key(): string | null {
  return process.env.FINANCE_API_KEY ?? null;
}

export async function fetchNotes(opts: {
  slug: string;
  targetType?: string;
  targetId?: string;
}): Promise<{ ok: boolean; data?: NoteRow[]; error?: string; status: number }> {
  const k = key();
  if (!k) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const q = new URLSearchParams();
  if (opts.targetType) q.set("targetType", opts.targetType);
  if (opts.targetId) q.set("targetId", opts.targetId);

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/notes?${q.toString()}`,
    { headers: { "X-API-Key": k }, cache: "no-store" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body.data as NoteRow[], status: 200 };
}

export async function createNote(opts: {
  slug: string;
  actorEmail: string;
  targetType?: string;
  targetId?: string;
  body?: string;
  kind?: string;
  ip?: string;
}): Promise<{ ok: boolean; data?: NoteRow; error?: string; status: number }> {
  const k = key();
  if (!k) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };

  const res = await fetch(
    `${BASE_URL}/api/finance/clients/${encodeURIComponent(opts.slug)}/notes`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": k,
        "X-Actor-Email": opts.actorEmail,
        ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
      },
      body: JSON.stringify({
        targetType: opts.targetType,
        targetId: opts.targetId,
        body: opts.body,
        kind: opts.kind,
      }),
      cache: "no-store",
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as NoteRow, status: 201 };
}

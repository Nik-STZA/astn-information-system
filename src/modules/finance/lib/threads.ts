// Threads, read for any page (migration 050). A thread belongs to a subject:
// an account in a month (<company id>:<code>), an asset, a cost line, a
// reconciliation or a register's month. The same thread shows wherever its
// subject appears. Pure helpers first, the server-only calls at the bottom.

import type { ThreadEntry } from "./asset-schedule";

export type { ThreadEntry };

export interface Me { initials: string; name: string }
export interface ThreadSubject { subject_kind: string; subject_key: string; period: string | null }

// Initials from an email when the person has not set a profile yet.
export const emailInitials = (email: string) =>
  email.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "?";

// Who is signed in, as a thread shows them.
export function meFrom(email: string | null, people: Array<{ email: string; initials: string; display_name: string }> | null): Me {
  const e = (email ?? "").toLowerCase();
  const p = people?.find((x) => x.email === e);
  return { initials: p?.initials ?? (e ? emailInitials(e) : "?"), name: p?.display_name ?? (e || "You") };
}

// An account's thread key: the company and the account code.
export const accountKey = (entityId: string | null | undefined, code: string | null | undefined) => (entityId && code ? `${entityId}:${code}` : null);

// The subjects a reconciliation's page shows: its own thread and each of its
// accounts' threads for the month (the same threads the Fixed assets page and
// agents see).
export function recSubjects(recId: string, rows: Array<{ entity_id: string; code: string | null }>): string[] {
  const keys = new Set<string>([`reconciliation|${recId}`]);
  for (const r of rows) { const k = accountKey(r.entity_id, r.code); if (k) keys.add(`account|${k}`); }
  return [...keys];
}

// Where an entry's subject is worked on, for a link from the Close page.
// An account opens the Fixed assets page (its asset accounts' threads live
// there) unless a reconciliation of the month covers it.
export function subjectHref(slug: string, e: Pick<ThreadEntry, "subject_kind" | "subject_key" | "period">, recByAccount?: Map<string, string>): string | null {
  const base = `/finance/clients/${encodeURIComponent(slug)}`;
  const month = e.period ? `?period=${encodeURIComponent(e.period)}` : "";
  if (e.subject_kind === "reconciliation") return `${base}/reconciliations/${encodeURIComponent(e.subject_key)}`;
  if (e.subject_kind === "account") {
    const rec = recByAccount?.get(e.subject_key);
    return rec ? `${base}/reconciliations/${encodeURIComponent(rec)}` : `${base}/fixed-assets${month}`;
  }
  if (e.subject_kind === "asset" || e.subject_kind === "cost_line" || e.subject_kind === "register_month") return `${base}/fixed-assets${month}`;
  return null;
}

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

// Entries for the given subjects ("kind|key"), the month (plus subjects with
// no month, such as an asset), or only those waiting on a decision.
export async function fetchThreads(slug: string, opts: { subjects?: string[]; period?: string | null; open?: boolean } = {}):
  Promise<{ ok: true; data: { threads: ThreadEntry[]; open: number } } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const q = new URLSearchParams();
  for (const s of opts.subjects ?? []) q.append("s", s);
  if (opts.period) q.set("period", opts.period);
  if (opts.open) q.set("open", "true");
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/threads?${q}`, { headers: { "X-API-Key": key }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body };
}

// A person's own profile: how they appear on threads and sign-offs. They
// set it themselves; finance-api refuses an agent or someone else.
export async function saveProfile(actorEmail: string, body: unknown) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/finance/people/me`, {
    method: "PUT", headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Pack commentary: the portal side of finance-api's commentary routes
// (lib/pack-commentary.js, migration 063). Server-only fetches are at the
// bottom; the rest is pure. The rules live in finance-api: only text fields
// are edited, and only the CFO approves.

export type CommentaryStatus = "draft" | "approved";

export interface CommentaryField { path: string; heading: string; text: string; status?: string | null; figure?: unknown }
export interface CommentarySection { key: string; title: string; fields: CommentaryField[] }
export interface CommentaryPart {
  status: CommentaryStatus;
  version: number;
  updated_by: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  content: Record<string, unknown>;
}
export interface CommentaryVersion {
  commentary_id: string;
  kind: "highlights" | "dashboard";
  version: number;
  status: CommentaryStatus;
  action: "imported" | "edited" | "approved";
  changed_paths: string[];
  note: string | null;
  saved_by: string;
  saved_at: string;
}
export interface CommentaryMonth {
  period: string;
  label: string;
  highlights: (CommentaryPart & { sections: CommentarySection[]; notes: Array<{ path: string; heading: string; words: string[] }> }) | null;
  dashboard: CommentaryPart | null;
  pack: { ready: boolean; why: string | null };
  versions: CommentaryVersion[];
  migration_missing?: boolean;
}

// The edits a save sends: only the fields that differ from what was loaded.
export function changedEdits(sections: CommentarySection[], drafts: Record<string, string>): Array<{ path: string; text: string }> {
  return sections.flatMap((s) => s.fields)
    .filter((f) => drafts[f.path] !== undefined && drafts[f.path] !== f.text)
    .map((f) => ({ path: f.path, text: drafts[f.path] }));
}

// Who saved, as the page says it.
export function whoSaved(actor: string): string {
  const m = /^agent:(.+)$/.exec(actor);
  if (!m) return actor;
  return { fpa: "FP&A", fc: "FC", fm1: "FM1" }[m[1]] ?? m[1].toUpperCase();
}

// Which file a dropped file is, from its name: highlights_2026-10.json, dashboard_2026-10.json.
export function kindOfFile(name: string): "highlights" | "dashboard" | null {
  if (/highlights/i.test(name)) return "highlights";
  if (/dashboard/i.test(name)) return "dashboard";
  return null;
}

// Figures shown beside the words, for reading only. Each table is a heading,
// its column names, and rows of text.
export function figureTables(h: Record<string, unknown> | null): Array<{ title: string; columns: string[]; rows: string[][] }> {
  if (!h) return [];
  const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : String(v));
  const arr = (k: string) => (Array.isArray(h[k]) ? (h[k] as Array<Record<string, unknown>>) : []);
  const out: Array<{ title: string; columns: string[]; rows: string[][] }> = [];
  if (arr("kpis").length) out.push({ title: "Key figures", columns: ["KPI", "Value", "Period"], rows: arr("kpis").map((k) => [text(k.label), text(k.value), text(k.period)]) });
  if (arr("entities").length) out.push({ title: "By company", columns: ["Company", "Loss in month", "Loss prior month", "Cash"], rows: arr("entities").map((e) => [text(e.name), text(e.loss_month), text(e.loss_prior), text(e.cash)]) });
  if (arr("scorecard").length) out.push({ title: "Scorecard", columns: ["Line", "Month", "Prior", "Year to date", "Budget"], rows: arr("scorecard").map((s) => [text(s.label), text(s.current), text(s.prior), text(s.ytd), text(s.budget)]) });
  return out;
}

const PATH = /^commentary\/(import|edit|approve)$/;
export const isCommentaryPath = (path: string) => PATH.test(path);

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchCommentary(slug: string, period: string): Promise<{ ok: true; data: CommentaryMonth } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/commentary?period=${encodeURIComponent(period)}`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 503 && body.migration_missing) return { ok: true, data: { migration_missing: true } as CommentaryMonth };
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as CommentaryMonth };
}

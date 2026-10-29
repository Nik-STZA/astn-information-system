// The agents' procedures for one client (finance-api lib/procedure-rules.js,
// migration 025): STZA's standard set, and the client's own rules on top.
// Types, fetchers and the pure helpers the Procedures page uses.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export type RuleKind = "addition" | "replacement" | "own";
export type RuleStatus = "draft" | "approved" | "retired";

export interface StandardProcedure {
  name: string;
  title: string;
  summary: string;
  version: string;
  roles: string[];
  always_loaded: boolean;
}

export interface ClientRule {
  id: string;
  procedure: string;
  kind: RuleKind;
  title: string | null;
  summary: string | null;
  body: string;
  roles: string[] | null;
  version: number;
  status: RuleStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export interface ProcedureList {
  standard: StandardProcedure[];
  roles: Array<{ name: string; title: string }>;
  rules: ClientRule[];
}

export interface ProcedureDetail {
  name: string;
  standard: (Omit<StandardProcedure, "name"> & { body: string }) | null;
  rules: ClientRule[];
  agents_read: string | null;
}

export const KIND_LABEL: Record<RuleKind, string> = {
  addition: "Added rules",
  replacement: "Replacement",
  own: "Client's own procedure",
};

export const STATUS_LABEL: Record<RuleStatus, string> = { draft: "Draft", approved: "Approved", retired: "Retired" };
export const STATUS_PILL: Record<RuleStatus, string> = { draft: "s-amber", approved: "s-green", retired: "s-neutral" };

// ── Fetchers (server side) ────────────────────────────────────────────────────

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function get<T>(path: string): Promise<Result<T>> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "X-API-Key": key }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `finance-api ${res.status}`, status: res.status };
  return { ok: true, data: body as T };
}

export const fetchProcedures = (slug: string) => get<ProcedureList>(`/api/clients/${encodeURIComponent(slug)}/procedures`);
export const fetchProcedure = (slug: string, name: string) =>
  get<ProcedureDetail>(`/api/clients/${encodeURIComponent(slug)}/procedures/${encodeURIComponent(name)}`);

// ── Pure helpers ──────────────────────────────────────────────────────────────

// The rules that are still live (draft or approved), newest first.
export const liveRules = (rules: ClientRule[]) => rules.filter((r) => r.status !== "retired");

// What a procedure's row says about this client's rules for it.
export function ruleNote(rules: ClientRule[]): { text: string; pill: string } | null {
  const live = liveRules(rules);
  if (!live.length) return null;
  const drafts = live.filter((r) => r.status === "draft").length;
  const replaced = live.some((r) => r.kind === "replacement" && r.status === "approved");
  const text = replaced ? "Replaced for this client" : live.some((r) => r.status === "approved") ? "Client rules" : "Client rules in draft";
  return { text: drafts && text !== "Client rules in draft" ? `${text} · ${drafts} draft` : text, pill: drafts ? "s-amber" : "s-green" };
}

// The client's own procedures, one row each, from their rules.
export function ownProcedures(rules: ClientRule[]): Array<{ name: string; title: string; summary: string | null; rules: ClientRule[] }> {
  const byName = new Map<string, ClientRule[]>();
  for (const r of rules.filter((x) => x.kind === "own")) byName.set(r.procedure, [...(byName.get(r.procedure) ?? []), r]);
  return [...byName.entries()]
    .map(([name, rs]) => {
      const lead = liveRules(rs)[0] ?? rs[0];
      return { name, title: lead.title || name, summary: lead.summary, rules: rs };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// A procedure name from a title: "Stock count" -> "stock-count".
export const procedureName = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

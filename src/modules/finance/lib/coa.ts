// Chart of accounts mapping: types, and the server-side calls to finance-api.
//
// Which reporting category each Xero account belongs to, per entity, approved
// here and read by the pack engine. Server side only for the calls: the API key
// must never reach the browser. The types are shared with the client panel.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export type Statement = "pnl" | "bs";

export interface ReportingCategory {
  key: string;
  label: string;
  statement: Statement;
  section: string;
  sortOrder: number;
  cashFlow: string | null;
  active: boolean;
  scope: "standard" | "override" | "client";
  accounts?: number;
}

export interface CoaAccountRow {
  accountId: string;
  code: string | null;
  name: string;
  class: string;
  type: string;
  reportingCode: string | null;
  xeroStatus: string;
  statement: Statement;
  mapping: {
    category: string;
    cashFlow: string | null;
    status: "proposed" | "approved";
    source: string;
    reason: string | null;
    proposedBy: string;
    proposedAt: string;
    approvedBy: string | null;
    approvedAt: string | null;
    savedCode: string | null;
    savedName: string;
  } | null;
  proposal: { category: string | null; reason: string } | null;
  flags: string[];
}

export interface CoaMappingView {
  entities: { slug: string; name: string; connected: boolean }[];
  entity: { slug: string; name: string } | null;
  categories: ReportingCategory[];
  cashFlows: { account: string[] };
  xeroError?: string | null;
  rows: CoaAccountRow[];
  orphans: { accountId: string; code: string | null; name: string; category: string; status: string }[];
}

export interface CategoryMeta {
  data: ReportingCategory[];
  sections: { pnl: string[]; bs: string[] };
  cashFlows: { category: string[]; account: string[] };
}

export interface MappingChange {
  accountId: string;
  category?: string;
  cashFlow?: string | null;
  approve?: boolean;
}

type Result<T> = { ok: true; data: T; status: number } | { ok: false; error: string; errors?: string[]; status: number };

async function call<T>(
  method: string,
  path: string,
  opts: { actorEmail?: string; ip?: string; body?: unknown } = {}
): Promise<Result<T>> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "X-API-Key": key,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.actorEmail ? { "X-Actor-Email": opts.actorEmail } : {}),
      ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body.error ?? `upstream ${res.status}`, errors: body.errors, status: res.status };
  }
  return { ok: true, data: body as T, status: res.status };
}

const clientPath = (slug: string) => `/api/finance/clients/${encodeURIComponent(slug)}`;

export function fetchCoaMapping(slug: string, entity?: string) {
  const qs = entity ? `?entity=${encodeURIComponent(entity)}` : "";
  return call<CoaMappingView>("GET", `${clientPath(slug)}/coa-mapping${qs}`);
}

export function fetchReportingCategories(slug: string) {
  return call<CategoryMeta>("GET", `${clientPath(slug)}/reporting-categories`);
}

export function saveMappings(opts: {
  slug: string;
  entity: string;
  actorEmail: string;
  ip?: string;
  changes: MappingChange[];
  source?: "manual" | "upload" | "rule";
  note?: string;
}) {
  return call<{ ok: true; saved: number; unchanged: number; approved: number }>(
    "POST",
    `${clientPath(opts.slug)}/coa-mapping/${encodeURIComponent(opts.entity)}`,
    { actorEmail: opts.actorEmail, ip: opts.ip, body: { changes: opts.changes, source: opts.source, note: opts.note } }
  );
}

export function saveCategory(opts: {
  slug: string;
  key: string;
  actorEmail: string;
  ip?: string;
  body: Partial<Pick<ReportingCategory, "label" | "statement" | "section" | "sortOrder" | "cashFlow" | "active">>;
}) {
  return call<ReportingCategory>(
    "PUT",
    `${clientPath(opts.slug)}/reporting-categories/${encodeURIComponent(opts.key)}`,
    { actorEmail: opts.actorEmail, ip: opts.ip, body: opts.body }
  );
}

export function removeCategory(opts: { slug: string; key: string; actorEmail: string; ip?: string }) {
  return call<{ ok: true; key: string; reset: boolean }>(
    "DELETE",
    `${clientPath(opts.slug)}/reporting-categories/${encodeURIComponent(opts.key)}`,
    { actorEmail: opts.actorEmail, ip: opts.ip }
  );
}

// Client for stza-finance-api.
//
// The Finance module has its own client rather than reusing src/lib/cloud-run,
// because a module may not import legacy AfricanSTN code. That is enforced by
// the boundaries lint rule, and it is also what keeps the module liftable.
//
// Server-side only. The API key must never reach the browser.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export interface FinanceClientSummary {
  id: string;
  slug: string;
  name: string;
  jurisdiction: string | null;
  framework: string | null;
  year_end: string | null;
  status: string;
  accounting_system: string;
  close_cadence: string;
  reporting_currency: string;
  open_item_count: number;
  p1_count: number;
}

export interface DiaryEntryRow {
  id: string;
  occurred_at: string | null;
  occurred_precision: "minute" | "day" | "month";
  role: string | null;
  agent_name: string | null;
  action: string;
  where_path: string | null;
  status: string | null;
  notes: string | null;
  heading: string | null;
  source_file: string;
  source_line: number | null;
}

export interface OpenItemRow {
  id: string;
  ref: string;
  title: string;
  category: string | null;
  owner_label: string | null;
  priority: string | null;
  status: string | null;
  raised_at: string | null;
  last_update_at: string | null;
  closed_at: string | null;
  resolution: string | null;
  is_closed: boolean;
  source_file: string;
  source_line: number | null;
  note_count?: number;
}

export class FinanceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FinanceApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) throw new FinanceApiError("FINANCE_API_KEY is not configured", 500);

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-API-Key": key },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FinanceApiError(
      `GET ${path} returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

export async function fetchFinanceClients(): Promise<FinanceClientSummary[]> {
  const r = await get<{ data: FinanceClientSummary[] }>("/api/finance/clients");
  return r.data;
}

export async function fetchDiary(slug: string): Promise<DiaryEntryRow[]> {
  const r = await get<{ data: DiaryEntryRow[] }>(
    `/api/finance/clients/${encodeURIComponent(slug)}/diary`
  );
  return r.data;
}

export async function fetchOpenItems(slug: string): Promise<OpenItemRow[]> {
  const r = await get<{ data: OpenItemRow[] }>(
    `/api/finance/clients/${encodeURIComponent(slug)}/open-items`
  );
  return r.data;
}

export interface WipReviewRow {
  reviewerRole: string;
  outcome: string | null;
  findings: string[];
  notes: string | null;
  nextStep: string | null;
  reviewedAt: string | null;
}

export interface WipItemRow {
  id: string;
  ref: string;
  type: string;
  status: string;
  panel:
    | "awaiting-decision"
    | "blocked-external"
    | "in-progress-upstream"
    | "upcoming"
    | "activity";
  priority: string | null;
  title: string;
  amountTotal: string | null;
  folderPath: string;
  drafterRole: string | null;
  tier: string | null;
  entityScope: "entity" | "group";
  entitySlug: string | null;
  entityLabel: string;
  dueAt: string | null;
  blockedOn: string | null;
  draftedAt: string | null;
  updatedAt: string | null;
  drafterEmail: string | null;
  drafterAgent: string | null;
  reviewIndependence: "independent" | "same-person" | "not-recorded";
  reviews: WipReviewRow[];
}

export async function fetchWipItems(slug: string): Promise<WipItemRow[]> {
  const r = await get<{ data: WipItemRow[] }>(
    `/api/finance/clients/${encodeURIComponent(slug)}/wip`
  );
  return r.data;
}

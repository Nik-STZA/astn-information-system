/**
 * Data fetching for Content Pipeline — review queue, sources, ingestion runs.
 * Consumes: /api/content/items, /api/content/sources, /api/content/runs.
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContentSource = {
  id: number;
  url: string;
  source_name: string;
  category: string;
  source_type: string;
  languages: string;
  active: boolean;
  priority: string;
  region_focus: string;
  agents: string | null;
  outputs: string | null;
  notes: string | null;
  registries: string | null;
  last_fetched_at: string | null;
  last_item_count: number;
  fetch_errors: number;
  created_at: string;
  updated_at: string;
};

export type ClassifiedItem = {
  id: number;
  source_id: number | null;
  source_name: string;
  source_url: string | null;
  title: string;
  summary: string | null;
  category: string | null;
  verticals: string[];
  relevance_score: number;
  status: string;
  original_language: string;
  region: string | null;
  published_at: string | null;
  classified_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
};

export type ItemStats = {
  pending: number;
  approved: number;
  rejected: number;
  published: number;
  total: number;
  this_week: number;
};

export type IngestionRun = {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  sources_checked: number;
  items_fetched: number;
  items_new: number;
  items_skipped: number;
  errors: Array<{ source_id: number; source_name: string; error: string }>;
  trigger_type: string;
  created_at: string;
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchContentSources(filters?: {
  active?: boolean;
  category?: string;
  source_type?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.active !== undefined) params.set("active", String(filters.active));
  if (filters?.category) params.set("category", filters.category);
  if (filters?.source_type) params.set("source_type", filters.source_type);

  const qs = params.toString();
  return cloudRunFetch<{ count: number; data: ContentSource[] }>(
    `/api/content/sources${qs ? `?${qs}` : ""}`
  );
}

export async function fetchClassifiedItems(filters?: {
  status?: string;
  category?: string;
  days?: number;
  limit?: number;
  offset?: number;
  sort?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.days) params.set("days", String(filters.days));
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  if (filters?.sort) params.set("sort", filters.sort);

  const qs = params.toString();
  return cloudRunFetch<{
    total: number;
    count: number;
    offset: number;
    data: ClassifiedItem[];
  }>(`/api/content/items${qs ? `?${qs}` : ""}`);
}

export async function fetchItemStats() {
  return cloudRunFetch<ItemStats>("/api/content/items/stats");
}

export async function fetchIngestionRuns(limit = 10) {
  return cloudRunFetch<{ count: number; data: IngestionRun[] }>(
    `/api/content/runs?limit=${limit}`
  );
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function updateItemStatus(
  id: number,
  status: string,
  reviewedBy = "nik@stza.io"
) {
  // The API route uses app.patch but cloudRunMutate only supports POST/PUT/DELETE.
  // Client-side callers go through the /api/proxy route instead.
  // This server-side version uses PUT; the Cloud Run route also accepts PUT.
  return cloudRunMutate<ClassifiedItem>(
    `/api/content/items/${id}`,
    "PUT",
    { status, reviewed_by: reviewedBy }
  );
}

export async function bulkUpdateItems(
  ids: number[],
  status: string,
  reviewedBy = "nik@stza.io"
) {
  return cloudRunMutate<{ updated: number }>("/api/content/items/bulk", "POST", {
    ids,
    status,
    reviewed_by: reviewedBy,
  });
}

export async function triggerIngestion(triggerType = "manual") {
  return cloudRunMutate<{ run_id: number; status: string }>(
    "/api/content/ingest",
    "POST",
    { trigger_type: triggerType }
  );
}

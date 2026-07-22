import { cloudRunFetch } from "@/lib/cloud-run";
import {
  REGISTRY_PAGE_SIZE,
  type FilterOptions,
  type OrganizationChange,
  type OrganizationDetail,
  type RegistryFilters,
  type RegistryRow,
} from "@/lib/data/registry-shared";

export * from "@/lib/data/registry-shared";

/**
 * Server-only registry data fetchers, backed by the Cloud Run API
 * (organizations live in Cloud SQL since the Supabase migration).
 * Import shared types from registry-shared.ts in any client component.
 */

export type RegistryPage = {
  rows: RegistryRow[];
  totalCount: number;
};

// Sortable column keys — validated server-side too.
export type RegistrySortField =
  | "organization_name"
  | "country"
  | "sport"
  | "organization_type"
  | "source_confidence";

export type SortDir = "asc" | "desc";

const VALID_SORT_FIELDS: readonly string[] = [
  "organization_name",
  "country",
  "sport",
  "organization_type",
  "source_confidence",
];

export function isRegistrySortField(v: string | null): v is RegistrySortField {
  return !!v && VALID_SORT_FIELDS.includes(v);
}

type FetchOrganizationsOpts = {
  // When true, the result is restricted to rows that don't already match the
  // High confidence band - powers the verification queue.
  verifyMode?: boolean;
  sort?: RegistrySortField;
  sortDir?: SortDir;
};

function filterParams(filters: RegistryFilters, opts: FetchOrganizationsOpts = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.country) params.set("country", filters.country);
  if (filters.sport) params.set("sport", filters.sport);
  if (filters.type) params.set("type", filters.type);
  if (filters.confidence) params.set("confidence", filters.confidence);
  if (opts.verifyMode) params.set("verify", "1");
  return params;
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const res = await cloudRunFetch<FilterOptions>("/api/organizations/facets");
  return res.data ?? { countries: [], sports: [], types: [] };
}

export async function fetchOrganizations(
  filters: RegistryFilters,
  page: number,
  pageSize: number = REGISTRY_PAGE_SIZE,
  opts: FetchOrganizationsOpts = {},
): Promise<RegistryPage> {
  const params = filterParams(filters, opts);
  params.set("page", String(Math.max(1, page)));
  params.set("page_size", String(pageSize));
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.sortDir) params.set("dir", opts.sortDir);

  const res = await cloudRunFetch<{ count: number; data: RegistryRow[] }>(
    `/api/organizations?${params.toString()}`,
  );
  return {
    rows: res.data?.data ?? [],
    totalCount: res.data?.count ?? 0,
  };
}

// Headline count of organisations awaiting verification - anything not at the
// High band, including rows with a null source_confidence.
export async function fetchVerificationQueueCount(): Promise<number> {
  const res = await cloudRunFetch<{ count: number }>("/api/organizations/verify-count");
  return res.data?.count ?? 0;
}

// Bulk fetch every row matching the filters - used by /registry/export.
export async function fetchAllOrganizationsMatching(
  filters: RegistryFilters,
  opts: FetchOrganizationsOpts = {},
): Promise<OrganizationDetail[]> {
  const params = filterParams(filters, opts);
  const res = await cloudRunFetch<{ count: number; data: OrganizationDetail[] }>(
    `/api/organizations/export?${params.toString()}`,
  );
  return res.data?.data ?? [];
}

export async function fetchOrganization(id: string): Promise<OrganizationDetail | null> {
  const res = await cloudRunFetch<OrganizationDetail>(`/api/organizations/${id}`);
  return res.data ?? null;
}

// Stringify a JSON-encoded audit value for display. The diff column stores
// jsonb so values come back as JS primitives - we render them tightly.
function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export async function fetchOrganizationChanges(
  orgId: string,
  limit = 20,
): Promise<OrganizationChange[]> {
  const res = await cloudRunFetch<{
    count: number;
    data: Array<{
      id: string;
      changed_by: string;
      changed_at: string;
      diff: Record<string, { old: unknown; new: unknown }> | null;
    }>;
  }>(`/api/organizations/${orgId}/changes?limit=${limit}`);

  if (!res.data) return [];

  return res.data.data.map((row) => {
    const diff = row.diff ?? {};
    const fields = Object.entries(diff).map(([field, pair]) => ({
      field,
      oldValue: formatAuditValue(pair?.old),
      newValue: formatAuditValue(pair?.new),
    }));
    return {
      id: row.id,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
      fields,
    };
  });
}

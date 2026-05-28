import { createSupabaseServerClient } from "@/lib/supabase-server";
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
 * Server-only registry data fetchers. Lists, filters, and paginates the
 * organizations table. Import shared types from registry-shared.ts in any
 * client component (importing this file pulls in next/headers).
 */

export type RegistryPage = {
  rows: RegistryRow[];
  totalCount: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// PostgREST caps a single response at 1,000 rows. Page through with .range()
// so distinct-value lookups see the whole table.
async function fetchAllColumnValues(
  supabase: SupabaseServerClient,
  table: string,
  column: string,
): Promise<string[]> {
  const pageSize = 1000;
  const all: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const v = (row as unknown as Record<string, unknown>)[column];
      if (typeof v === "string" && v.length > 0) all.push(v);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const supabase = await createSupabaseServerClient();
  const [countries, sports, types] = await Promise.all([
    fetchAllColumnValues(supabase, "organizations", "country"),
    fetchAllColumnValues(supabase, "organizations", "sport"),
    fetchAllColumnValues(supabase, "organizations", "organization_type"),
  ]);
  return {
    countries: Array.from(new Set(countries)).sort((a, b) => a.localeCompare(b)),
    sports: Array.from(new Set(sports)).sort((a, b) => a.localeCompare(b)),
    types: Array.from(new Set(types)).sort((a, b) => a.localeCompare(b)),
  };
}

type FetchOrganizationsOpts = {
  // When true, the result is restricted to rows that don't already match the
  // High confidence band - powers the verification queue.
  verifyMode?: boolean;
};

export async function fetchOrganizations(
  filters: RegistryFilters,
  page: number,
  pageSize: number = REGISTRY_PAGE_SIZE,
  opts: FetchOrganizationsOpts = {},
): Promise<RegistryPage> {
  const supabase = await createSupabaseServerClient();

  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;

  let query = supabase
    .from("organizations")
    .select(
      "id, organization_name, country, sport, organization_type, source_confidence",
      { count: "exact" },
    )
    .order("organization_name", { ascending: true })
    .range(from, to);

  if (filters.country) query = query.eq("country", filters.country);
  if (filters.sport) query = query.eq("sport", filters.sport);
  if (filters.type) query = query.eq("organization_type", filters.type);

  if (filters.confidence) {
    if (filters.confidence === "Medium") {
      // Medium band excludes Medium-Low.
      query = query
        .ilike("source_confidence", "Medium%")
        .not("source_confidence", "ilike", "Medium-Low%");
    } else {
      query = query.ilike("source_confidence", `${filters.confidence}%`);
    }
  }

  if (opts.verifyMode) {
    // Anything not at High band - includes Medium / Medium-Low / Low and null.
    query = query.or("source_confidence.is.null,source_confidence.not.ilike.High%");
  }

  const { data, count } = await query;

  return {
    rows: (data ?? []) as RegistryRow[],
    totalCount: count ?? 0,
  };
}

// Headline count of organisations awaiting verification - anything not at the
// High band, including rows with a null source_confidence.
export async function fetchVerificationQueueCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .or("source_confidence.is.null,source_confidence.not.ilike.High%");
  return count ?? 0;
}

export async function fetchOrganization(id: string): Promise<OrganizationDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as OrganizationDetail | null) ?? null;
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
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organization_changes")
    .select("id, changed_by, changed_at, diff")
    .eq("org_id", orgId)
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row) => {
    const diff = (row.diff ?? {}) as Record<string, { old: unknown; new: unknown }>;
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

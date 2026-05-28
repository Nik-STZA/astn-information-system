import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  REGISTRY_PAGE_SIZE,
  type FilterOptions,
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

export async function fetchOrganizations(
  filters: RegistryFilters,
  page: number,
  pageSize: number = REGISTRY_PAGE_SIZE,
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

  const { data, count } = await query;

  return {
    rows: (data ?? []) as RegistryRow[],
    totalCount: count ?? 0,
  };
}

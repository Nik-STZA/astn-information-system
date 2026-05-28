import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Overview metrics for the home page.
 * Returns the headline counters and the top breakdowns.
 */

export type OverviewMetrics = {
  totalOrganisations: number;
  totalCountries: number;
  totalSports: number;
  highConfidencePercent: number;
  totalPartnerships: number;
  itemsThisWeek: number;
};

export type CountryBreakdown = {
  country: string;
  count: number;
};

export type OrgTypeBreakdown = {
  type: string;
  count: number;
};

export type RecentItem = {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  verticals: string[];
  url: string | null;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// PostgREST caps a single response at 1,000 rows. For full-table aggregations
// (distinct counts, top-N groupings) we must page through with .range().
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

export async function fetchOverviewMetrics(): Promise<OverviewMetrics> {
  const supabase = await createSupabaseServerClient();

  // Total organisations
  const { count: orgCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true });

  // Distinct countries and sports - paginate past the 1,000-row cap.
  const countryIsoValues = await fetchAllColumnValues(supabase, "organizations", "country_iso");
  const totalCountries = new Set(countryIsoValues).size;

  const sportCodeValues = await fetchAllColumnValues(supabase, "organizations", "sport_code");
  const totalSports = new Set(sportCodeValues).size;

  // High-confidence percentage. `source_confidence` is a descriptive string
  // ("High (via governing body listing)" etc.), so prefix-match, not equals.
  const { count: highCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .ilike("source_confidence", "High%");

  const highConfidencePercent =
    orgCount && orgCount > 0 ? Math.round(((highCount ?? 0) / orgCount) * 1000) / 10 : 0;

  // Partnerships
  const { count: partnershipCount } = await supabase
    .from("partnerships")
    .select("*", { count: "exact", head: true });

  // Items classified this week (no published_at column - use created_at).
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const { count: itemsThisWeek } = await supabase
    .from("classified_items")
    .select("*", { count: "exact", head: true })
    .gte("created_at", oneWeekAgo.toISOString());

  return {
    totalOrganisations: orgCount ?? 0,
    totalCountries,
    totalSports,
    highConfidencePercent,
    totalPartnerships: partnershipCount ?? 0,
    itemsThisWeek: itemsThisWeek ?? 0,
  };
}

export async function fetchTopCountries(limit = 10): Promise<CountryBreakdown[]> {
  const supabase = await createSupabaseServerClient();

  // The denormalised `country` column on organizations holds the human-readable
  // name, so we can aggregate directly without joining lookup_countries.
  const values = await fetchAllColumnValues(supabase, "organizations", "country");

  const counts = new Map<string, number>();
  for (const country of values) {
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function fetchTopOrgTypes(limit = 10): Promise<OrgTypeBreakdown[]> {
  const supabase = await createSupabaseServerClient();
  const values = await fetchAllColumnValues(supabase, "organizations", "organization_type");

  const counts = new Map<string, number>();
  for (const type of values) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function fetchRecentItems(limit = 15): Promise<RecentItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("classified_items")
    .select("id, title, source_name, created_at, verticals, source_url")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    title: row.title ?? "Untitled",
    source: row.source_name ?? "Unknown source",
    createdAt: row.created_at ?? "",
    verticals: Array.isArray(row.verticals) ? row.verticals : [],
    url: row.source_url ?? null,
  }));
}

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
  publishedAt: string;
  verticals: string[];
  url: string | null;
};

export async function fetchOverviewMetrics(): Promise<OverviewMetrics> {
  const supabase = await createSupabaseServerClient();

  // Total organisations
  const { count: orgCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true });

  // Distinct countries (we know it is 54 + pan-African per the audit corrections,
  // but we calculate from the data to keep it live)
  const { data: countryRows } = await supabase
    .from("organizations")
    .select("country_iso")
    .not("country_iso", "is", null);

  const uniqueCountries = new Set(countryRows?.map((r) => r.country_iso) ?? []);
  const totalCountries = uniqueCountries.size;

  // Distinct sports
  const { data: sportRows } = await supabase
    .from("organizations")
    .select("sport_code")
    .not("sport_code", "is", null);

  const uniqueSports = new Set(sportRows?.map((r) => r.sport_code) ?? []);
  const totalSports = uniqueSports.size;

  // High confidence percentage
  const { count: highCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("source_confidence", "High");

  const highConfidencePercent =
    orgCount && orgCount > 0 ? Math.round(((highCount ?? 0) / orgCount) * 1000) / 10 : 0;

  // Partnerships
  const { count: partnershipCount } = await supabase
    .from("partnerships")
    .select("*", { count: "exact", head: true });

  // Items classified this week
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

  // Get all organisations and aggregate by country in JS.
  // For v1 this is fine; v1.2 might switch to a database view if performance suffers.
  const { data } = await supabase.from("organizations").select("country_iso");
  if (!data) return [];

  // Get country name lookup
  const { data: countries } = await supabase.from("lookup_countries").select("iso, name");
  const countryNameByIso = new Map(countries?.map((c) => [c.iso, c.name]) ?? []);

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.country_iso) continue;
    counts.set(row.country_iso, (counts.get(row.country_iso) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([iso, count]) => ({
      country: countryNameByIso.get(iso) ?? iso,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function fetchTopOrgTypes(limit = 10): Promise<OrgTypeBreakdown[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("organizations").select("organization_type");
  if (!data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.organization_type) continue;
    counts.set(row.organization_type, (counts.get(row.organization_type) ?? 0) + 1);
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
    .select("id, title, source_name, published_at, verticals, source_url")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    title: row.title ?? "Untitled",
    source: row.source_name ?? "Unknown source",
    publishedAt: row.published_at ?? "",
    verticals: Array.isArray(row.verticals) ? row.verticals : [],
    url: row.source_url ?? null,
  }));
}

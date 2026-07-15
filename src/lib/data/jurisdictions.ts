import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Data fetchers for dp_jurisdictions table.
 * Uses direct Supabase access (same pattern as overview.ts / registry.ts).
 */

export type JurisdictionSummary = {
  id: string;
  jurisdictionId: string;
  countryName: string;
  countryIso: string;
  region: string | null;
  lawName: string | null;
  lawYear: number | null;
  hasComprehensiveLaw: boolean;
  authorityName: string | null;
  authorityAcronym: string | null;
  authorityOperational: boolean;
  malaboStatus: string | null;
};

export type JurisdictionDetail = JurisdictionSummary & {
  authorityFullName: string | null;
  recordData: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export async function fetchAllJurisdictions(): Promise<JurisdictionSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dp_jurisdictions")
    .select(
      "id, jurisdiction_id, country_name, country_iso, region, law_name, law_year, has_comprehensive_law, authority_name, authority_acronym, authority_operational, malabo_status",
    )
    .order("country_name", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    jurisdictionId: row.jurisdiction_id,
    countryName: row.country_name,
    countryIso: row.country_iso,
    region: row.region ?? null,
    lawName: row.law_name ?? null,
    lawYear: row.law_year ?? null,
    hasComprehensiveLaw: row.has_comprehensive_law ?? false,
    authorityName: row.authority_name ?? null,
    authorityAcronym: row.authority_acronym ?? null,
    authorityOperational: row.authority_operational ?? false,
    malaboStatus: row.malabo_status ?? null,
  }));
}

export async function fetchJurisdictionById(
  jurisdictionId: string,
): Promise<JurisdictionDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dp_jurisdictions")
    .select("*")
    .eq("jurisdiction_id", jurisdictionId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    jurisdictionId: data.jurisdiction_id,
    countryName: data.country_name,
    countryIso: data.country_iso,
    region: data.region ?? null,
    lawName: data.law_name ?? null,
    lawYear: data.law_year ?? null,
    hasComprehensiveLaw: data.has_comprehensive_law ?? false,
    authorityName: data.authority_name ?? null,
    authorityFullName: data.authority_full_name ?? null,
    authorityAcronym: data.authority_acronym ?? null,
    authorityOperational: data.authority_operational ?? false,
    malaboStatus: data.malabo_status ?? null,
    recordData: (data.record_data as Record<string, unknown>) ?? {},
    createdAt: data.created_at ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

export async function fetchJurisdictionMetrics() {
  const supabase = await createSupabaseServerClient();

  const { count: total } = await supabase
    .from("dp_jurisdictions")
    .select("*", { count: "exact", head: true });

  const { count: withLaw } = await supabase
    .from("dp_jurisdictions")
    .select("*", { count: "exact", head: true })
    .eq("has_comprehensive_law", true);

  const { count: withDpa } = await supabase
    .from("dp_jurisdictions")
    .select("*", { count: "exact", head: true })
    .eq("authority_operational", true);

  return {
    total: total ?? 0,
    withComprehensiveLaw: withLaw ?? 0,
    withOperationalDpa: withDpa ?? 0,
  };
}

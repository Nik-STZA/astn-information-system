import { cloudRunFetch } from "@/lib/cloud-run";

/**
 * Data fetchers for the dp_jurisdictions table, backed by the Cloud Run API
 * (migrated from Supabase to Cloud SQL).
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

type JurisdictionApiRow = {
  id: string;
  jurisdiction_id: string;
  country_name: string;
  country_iso: string;
  region: string | null;
  law_name: string | null;
  law_year: number | null;
  has_comprehensive_law: boolean | null;
  authority_name: string | null;
  authority_full_name?: string | null;
  authority_acronym: string | null;
  authority_operational: boolean | null;
  malabo_status: string | null;
  record_data?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function toSummary(row: JurisdictionApiRow): JurisdictionSummary {
  return {
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
  };
}

export async function fetchAllJurisdictions(): Promise<JurisdictionSummary[]> {
  const res = await cloudRunFetch<{ count: number; data: JurisdictionApiRow[] }>(
    "/api/dp/jurisdictions",
  );
  return (res.data?.data ?? []).map(toSummary);
}

export async function fetchJurisdictionById(
  jurisdictionId: string,
): Promise<JurisdictionDetail | null> {
  const res = await cloudRunFetch<JurisdictionApiRow>(
    `/api/dp/jurisdictions/${encodeURIComponent(jurisdictionId)}`,
  );
  if (!res.data) return null;
  const row = res.data;
  return {
    ...toSummary(row),
    authorityFullName: row.authority_full_name ?? null,
    recordData: (row.record_data as Record<string, unknown>) ?? {},
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function fetchJurisdictionMetrics() {
  const res = await cloudRunFetch<{
    total: number;
    withComprehensiveLaw: number;
    withOperationalDpa: number;
  }>("/api/dp/jurisdictions/metrics");
  return (
    res.data ?? { total: 0, withComprehensiveLaw: 0, withOperationalDpa: 0 }
  );
}

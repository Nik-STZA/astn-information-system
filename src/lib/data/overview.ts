import { cloudRunFetch } from "@/lib/cloud-run";

/**
 * Overview metrics for the home page, backed by the Cloud Run API
 * (registry and news tables live in Cloud SQL since the Supabase migration).
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
  // Display code for the item's language. May come from the original_language
  // tag, OR be overridden via script detection on the title (the upstream
  // classifier mis-tags Arabic-script content as 'en').
  languageCode: string | null;
};

// classified_items.original_language is unreliable for non-Latin scripts -
// Arabic-script titles are tagged 'en' in production. Inspect the title's
// Unicode ranges first; fall back to the stored tag.
function detectScriptCode(text: string): string | null {
  if (/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text)) return "AR";
  if (/[Ѐ-ӿ]/.test(text)) return "RU";
  if (/[֐-׿]/.test(text)) return "HE";
  if (/[ሀ-፿]/.test(text)) return "AM";
  if (/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(text)) return "CJK";
  if (/[ऀ-ॿ]/.test(text)) return "HI";
  if (/[฀-๿]/.test(text)) return "TH";
  if (/[Ͱ-Ͽ]/.test(text)) return "EL";
  return null;
}

function effectiveLanguage(title: string, tagged: string | null): string | null {
  const detected = detectScriptCode(title);
  if (detected) return detected;
  if (!tagged) return null;
  return tagged.toUpperCase();
}

export async function fetchOverviewMetrics(): Promise<OverviewMetrics> {
  const res = await cloudRunFetch<OverviewMetrics>("/api/overview/metrics");
  return (
    res.data ?? {
      totalOrganisations: 0,
      totalCountries: 0,
      totalSports: 0,
      highConfidencePercent: 0,
      totalPartnerships: 0,
      itemsThisWeek: 0,
    }
  );
}

export async function fetchTopCountries(limit = 10): Promise<CountryBreakdown[]> {
  const res = await cloudRunFetch<{ count: number; data: CountryBreakdown[] }>(
    `/api/overview/top-countries?limit=${limit}`,
  );
  return res.data?.data ?? [];
}

export async function fetchTopOrgTypes(limit = 10): Promise<OrgTypeBreakdown[]> {
  const res = await cloudRunFetch<{ count: number; data: OrgTypeBreakdown[] }>(
    `/api/overview/top-types?limit=${limit}`,
  );
  return res.data?.data ?? [];
}

export async function fetchRecentItems(limit = 15): Promise<RecentItem[]> {
  const res = await cloudRunFetch<{
    count: number;
    data: Array<{
      id: string;
      title: string | null;
      source_name: string | null;
      created_at: string | null;
      verticals: string[] | null;
      source_url: string | null;
      original_language: string | null;
    }>;
  }>(`/api/news/recent?limit=${limit}`);

  if (!res.data) return [];

  return res.data.data.map((row) => {
    const title = row.title ?? "Untitled";
    return {
      id: row.id,
      title,
      source: row.source_name ?? "Unknown source",
      createdAt: row.created_at ?? "",
      verticals: Array.isArray(row.verticals) ? row.verticals : [],
      url: row.source_url ?? null,
      languageCode: effectiveLanguage(title, row.original_language ?? null),
    };
  });
}

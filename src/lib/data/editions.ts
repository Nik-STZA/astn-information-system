import { cloudRunFetch } from "@/lib/cloud-run";

/**
 * Data fetchers for the dp_editions table, backed by the Cloud Run API
 * (migrated from Supabase to Cloud SQL).
 */

export type EditionSummary = {
  id: string;
  editionNumber: number;
  countryName: string | null;
  countryIso: string | null;
  jurisdictionId: string | null;
  phase: number;
  weekNumber: number;
  status: string;
  title: string | null;
  hookText: string | null;
  wordCount: number | null;
  publishedAt: string | null;
  createdAt: string | null;
};

export type EditionDetail = EditionSummary & {
  contentMarkdown: string | null;
  filePath: string | null;
  beehiivPostId: string | null;
  updatedAt: string | null;
};

type EditionApiRow = {
  id: string;
  edition_number: number;
  country_name: string | null;
  country_iso: string | null;
  jurisdiction_id: string | null;
  phase: number;
  week_number: number;
  status: string;
  title: string | null;
  hook_text: string | null;
  word_count: number | null;
  published_at: string | null;
  created_at: string | null;
  content_markdown?: string | null;
  file_path?: string | null;
  beehiiv_post_id?: string | null;
  updated_at?: string | null;
};

function toSummary(row: EditionApiRow): EditionSummary {
  return {
    id: row.id,
    editionNumber: row.edition_number,
    countryName: row.country_name ?? null,
    countryIso: row.country_iso ?? null,
    jurisdictionId: row.jurisdiction_id ?? null,
    phase: row.phase,
    weekNumber: row.week_number,
    status: row.status,
    title: row.title ?? null,
    hookText: row.hook_text ?? null,
    wordCount: row.word_count ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

export async function fetchAllEditions(): Promise<EditionSummary[]> {
  const res = await cloudRunFetch<{ count: number; data: EditionApiRow[] }>(
    "/api/dp/editions",
  );
  return (res.data?.data ?? []).map(toSummary);
}

export async function fetchEditionByNumber(
  editionNumber: number,
): Promise<EditionDetail | null> {
  const res = await cloudRunFetch<EditionApiRow>(
    `/api/dp/editions/${editionNumber}`,
  );
  if (!res.data) return null;
  const row = res.data;
  return {
    ...toSummary(row),
    contentMarkdown: row.content_markdown ?? null,
    filePath: row.file_path ?? null,
    beehiivPostId: row.beehiiv_post_id ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function fetchEditionMetrics() {
  const res = await cloudRunFetch<{ total: number; published: number }>(
    "/api/dp/editions/metrics",
  );
  return res.data ?? { total: 0, published: 0 };
}

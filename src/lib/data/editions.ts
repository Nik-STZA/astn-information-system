import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Data fetchers for dp_editions table.
 * Uses direct Supabase access (same pattern as overview.ts / registry.ts).
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

export async function fetchAllEditions(): Promise<EditionSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dp_editions")
    .select(
      "id, edition_number, country_name, country_iso, jurisdiction_id, phase, week_number, status, title, hook_text, word_count, published_at, created_at",
    )
    .order("edition_number", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
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
  }));
}

export async function fetchEditionByNumber(
  editionNumber: number,
): Promise<EditionDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dp_editions")
    .select("*")
    .eq("edition_number", editionNumber)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    editionNumber: data.edition_number,
    countryName: data.country_name ?? null,
    countryIso: data.country_iso ?? null,
    jurisdictionId: data.jurisdiction_id ?? null,
    phase: data.phase,
    weekNumber: data.week_number,
    status: data.status,
    title: data.title ?? null,
    hookText: data.hook_text ?? null,
    wordCount: data.word_count ?? null,
    contentMarkdown: data.content_markdown ?? null,
    filePath: data.file_path ?? null,
    beehiivPostId: data.beehiiv_post_id ?? null,
    publishedAt: data.published_at ?? null,
    createdAt: data.created_at ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

export async function fetchEditionMetrics() {
  const supabase = await createSupabaseServerClient();

  const { count: total } = await supabase
    .from("dp_editions")
    .select("*", { count: "exact", head: true });

  const { count: published } = await supabase
    .from("dp_editions")
    .select("*", { count: "exact", head: true })
    .eq("status", "published");

  return {
    total: total ?? 0,
    published: published ?? 0,
  };
}

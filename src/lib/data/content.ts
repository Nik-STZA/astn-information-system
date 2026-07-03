/**
 * Data fetching for Content Engine module.
 * Consumes: /api/content/editions, /api/content/weekly-reports.
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Edition = {
  id: number;
  series: string;
  edition_number: number;
  country_id: number | null;
  country_name: string | null;
  title: string;
  subtitle: string | null;
  status: string;
  target_publish_date: string | null;
  actual_publish_date: string | null;
  file_path: string | null;
  word_count: number | null;
  created_at: string;
  updated_at: string;
};

export type WeeklyReport = {
  id: number;
  report_date: string;
  summary: string | null;
  created_at: string;
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchEditions() {
  return cloudRunFetch<{ count: number; data: Edition[] }>(
    "/api/content/editions"
  );
}

export async function fetchWeeklyReports() {
  return cloudRunFetch<{ count: number; data: WeeklyReport[] }>(
    "/api/content/weekly-reports"
  );
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createEdition(data: Partial<Edition>) {
  return cloudRunMutate<Edition>("/api/content/editions", "POST", data);
}

export async function updateEdition(id: number, data: Partial<Edition>) {
  return cloudRunMutate<Edition>(`/api/content/editions/${id}`, "PUT", data);
}

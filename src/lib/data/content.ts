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

// ─── Review queue (editorial gate over classified_items) ────────────────────

export type ReviewItem = {
  id: string;
  title: string | null;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  url: string;
  category: string | null;
  region: string | null;
  relevance_score: number | null;
  confidence: string | null;
  verticals: string[] | null;
  original_language: string | null;
  created_at: string;
  status: string;
};

export type ReviewStats = {
  pending: number;
  approved: number;
  rejected: number;
  pending_this_week: number;
};

export async function fetchReviewQueue(
  status: "pending_review" | "approved" | "rejected" = "pending_review",
  limit = 25,
  offset = 0,
  minScore = 0,
  days = 0,
  sort: "relevance" | "newest" = "newest",
) {
  return cloudRunFetch<{ count: number; data: ReviewItem[] }>(
    `/api/news/review-queue?status=${status}&limit=${limit}&offset=${offset}&min_score=${minScore}&days=${days}&sort=${sort}`,
  );
}

export async function fetchReviewStats() {
  return cloudRunFetch<ReviewStats>("/api/news/review-stats");
}

export type ReviewItemDetail = ReviewItem & {
  translated_text: string | null;
  gemini_reasoning: string | null;
  snippet: string | null;
  content: string | null;
  published_at: string | null;
};

export async function fetchNewsItemDetail(id: string) {
  return cloudRunFetch<ReviewItemDetail>(`/api/news/items/${id}`);
}

export async function reviewItem(
  id: string,
  payload: {
    action: "approve" | "reject";
    edited_title?: string;
    edited_summary?: string;
    edited_category?: string;
    decision_reason?: string;
    reviewed_by?: string;
  },
) {
  return cloudRunMutate<{ id: string; status: string }>(
    `/api/news/items/${id}/review`,
    "POST",
    payload,
  );
}

// ─── Weekly briefs ──────────────────────────────────────────────────────────

export type BriefSummary = {
  id: string;
  item_count: number;
  created_at: string;
  preview: string;
};

export type BriefDetail = {
  id: string;
  item_count: number;
  created_at: string;
  report_markdown: string;
};

export async function fetchBriefs() {
  return cloudRunFetch<{ count: number; data: BriefSummary[] }>(
    "/api/content/briefs",
  );
}

export async function fetchBrief(id: string) {
  return cloudRunFetch<BriefDetail>(`/api/content/briefs/${id}`);
}

// ─── Agent workflow triggers (brief generation etc.) ────────────────────────

export type AgentWorkflow =
  | "generate-report"
  | "fetch-classify"
  | "generate-newsletter"
  | "generate-linkedin";

export type WorkflowStatus = {
  status: "queued" | "in_progress" | "completed" | "never_run";
  conclusion?: "success" | "failure" | null;
  started_at?: string;
  html_url?: string;
};

export async function runAgentWorkflow(workflow: AgentWorkflow) {
  return cloudRunMutate<{ dispatched: boolean; workflow: string }>(
    "/api/content/run-workflow",
    "POST",
    { workflow },
  );
}

export async function fetchWorkflowStatus(workflow: AgentWorkflow) {
  return cloudRunFetch<WorkflowStatus>(
    `/api/content/workflow-status?workflow=${workflow}`,
  );
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createEdition(data: Partial<Edition>) {
  return cloudRunMutate<Edition>("/api/content/editions", "POST", data);
}

export async function updateEdition(id: number, data: Partial<Edition>) {
  return cloudRunMutate<Edition>(`/api/content/editions/${id}`, "PUT", data);
}

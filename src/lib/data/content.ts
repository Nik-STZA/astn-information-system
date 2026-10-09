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

// ─── Ingestion ──────────────────────────────────────────────────────────────

export type IngestResult = {
  run_id: number;
  status: string;
  sources_checked: number;
  items_fetched: number;
  items_new: number;
  items_skipped: number;
  errors_count: number;
};

export async function triggerIngest() {
  return cloudRunMutate<IngestResult>("/api/content/ingest", "POST", {});
}

// ─── Weekly briefs ──────────────────────────────────────────────────────────

export type BriefStatus = "draft" | "published";

export type BriefSummary = {
  id: string;
  item_count: number;
  created_at: string;
  week_ending: string | null;
  status: BriefStatus;
  published_at: string | null;
  preview: string;
};

export type BriefDetail = {
  id: string;
  item_count: number;
  created_at: string;
  week_ending: string | null;
  status: BriefStatus;
  published_at: string | null;
  report_markdown: string;
};

export async function fetchBriefs() {
  return cloudRunFetch<{ count: number; data: BriefSummary[] }>(
    "/api/content/briefs",
    { cache: "no-store" },
  );
}

export async function fetchBrief(id: string) {
  return cloudRunFetch<BriefDetail>(`/api/content/briefs/${id}`, { cache: "no-store" });
}

// Draft editions only; the API returns 409 for a published (locked) brief.
export async function updateBriefMarkdown(id: string, reportMarkdown: string) {
  return cloudRunMutate<BriefDetail>(`/api/content/briefs/${id}`, "PUT", {
    report_markdown: reportMarkdown,
  });
}

// ─── LinkedIn drafts ────────────────────────────────────────────────────────

export type LinkedInDraft = {
  id: string;
  brief_id: string | null;
  week_ending: string | null;
  post_text: string;
  edited_text: string | null;
  char_count: number | null;
  word_count: number | null;
  status: "draft" | "approved" | "posted";
  created_at: string;
  updated_at: string;
  brief_status: BriefStatus | null;
  brief_item_count: number | null;
};

export async function fetchLinkedInDrafts() {
  // Live editorial queue — never serve a stale cache (a freshly generated
  // draft must appear immediately).
  return cloudRunFetch<{ count: number; data: LinkedInDraft[] }>(
    "/api/content/linkedin-drafts",
    { cache: "no-store" },
  );
}

export async function updateLinkedInDraft(
  id: string,
  payload: { edited_text?: string; status?: "draft" | "posted" },
) {
  return cloudRunMutate<LinkedInDraft>(
    `/api/content/linkedin-drafts/${id}`,
    "PUT",
    payload,
  );
}

export type PublishResult = {
  draft: LinkedInDraft;
  published: boolean;
  items_reported: number;
  week_ending: string | null;
  site_rebuild: "triggered" | "not_needed" | "not_configured" | string;
};

// Approve & publish: approves this post and, if the week's brief is still a
// draft, publishes it to africanstn.com in the same step.
export async function publishLinkedInDraft(id: string, editedText: string) {
  return cloudRunMutate<PublishResult>(
    `/api/content/linkedin-drafts/${id}/publish`,
    "POST",
    { edited_text: editedText },
  );
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

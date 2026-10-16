"use server";

import { revalidatePath } from "next/cache";
import { updateBriefMarkdown, runAgentWorkflow, fetchWorkflowStatus, fetchApprovedPool, rewriteStory, rewriteContext, fetchBriefVersions, fetchBriefVersion } from "@/lib/data/content";

export async function saveBrief(id: string, markdown: string) {
  const res = await updateBriefMarkdown(id, markdown);
  revalidatePath(`/content/briefs/${id}`);
  revalidatePath("/content/briefs");
  return res;
}

// Redrafts the LinkedIn post from the brief as it now stands (after edits).
// The agent supersedes the previous open draft for this brief.
export async function regeneratePost() {
  return runAgentWorkflow("generate-linkedin");
}

export async function regeneratePostStatus() {
  return fetchWorkflowStatus("generate-linkedin");
}

/**
 * Fetch approved items from the review queue for the "Available" pool.
 * Returns items approved within the last `days` days that the editor
 * can drag into the brief.
 */
export async function loadApprovedPool(days = 21) {
  return fetchApprovedPool(days, 100);
}

/**
 * Rewrite a single story body in the AfricanSTN editorial voice.
 * Calls Gemini via the Cloud Run API.
 */
export async function rewriteStoryAction(payload: {
  headline: string;
  summary: string;
  source_name?: string;
  source_url?: string;
  tone?: string | null;
}) {
  return rewriteStory(payload);
}

/**
 * Regenerate the "Week in Context" summary from the currently included stories.
 */
export async function rewriteContextAction(stories: { headline: string; body: string }[]) {
  return rewriteContext(stories);
}

/**
 * Fetch version history for a brief.
 */
export async function loadBriefVersions(briefId: string) {
  return fetchBriefVersions(briefId);
}

/**
 * Fetch a specific version's full markdown.
 */
export async function loadBriefVersion(briefId: string, versionId: string) {
  return fetchBriefVersion(briefId, versionId);
}

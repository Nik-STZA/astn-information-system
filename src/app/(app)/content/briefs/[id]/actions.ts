"use server";

import { revalidatePath } from "next/cache";
import { updateBriefMarkdown, runAgentWorkflow, fetchWorkflowStatus, fetchApprovedPool } from "@/lib/data/content";

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

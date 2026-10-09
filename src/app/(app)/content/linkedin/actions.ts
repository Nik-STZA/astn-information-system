"use server";

import { revalidatePath } from "next/cache";
import {
  fetchLinkedInDrafts,
  updateLinkedInDraft,
  publishLinkedInDraft,
  runAgentWorkflow,
  fetchWorkflowStatus,
} from "@/lib/data/content";

export async function loadDrafts() {
  return fetchLinkedInDrafts();
}

export async function saveDraft(
  id: string,
  payload: { edited_text?: string; status?: "draft" | "posted" },
) {
  const res = await updateLinkedInDraft(id, payload);
  revalidatePath("/content/linkedin");
  return res;
}

export async function publishDraft(id: string, editedText: string) {
  const res = await publishLinkedInDraft(id, editedText);
  revalidatePath("/content/linkedin");
  revalidatePath("/content/briefs");
  return res;
}

// "Generate" runs the report workflow, which writes (or, re-run in the same
// week, regenerates) the draft edition and then drafts its LinkedIn post.
export async function generateEdition() {
  return runAgentWorkflow("generate-report");
}

export async function editionStatus() {
  return fetchWorkflowStatus("generate-report");
}

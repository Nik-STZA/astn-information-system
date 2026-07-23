"use server";

import { revalidatePath } from "next/cache";
import {
  fetchLinkedInDrafts,
  updateLinkedInDraft,
  runAgentWorkflow,
  fetchWorkflowStatus,
} from "@/lib/data/content";

export async function loadDrafts() {
  return fetchLinkedInDrafts();
}

export async function saveDraft(
  id: string,
  payload: { edited_text?: string; status?: "draft" | "approved" | "posted" },
) {
  const res = await updateLinkedInDraft(id, payload);
  revalidatePath("/content/linkedin");
  return res;
}

export async function generateLinkedIn() {
  return runAgentWorkflow("generate-linkedin");
}

export async function linkedinStatus() {
  return fetchWorkflowStatus("generate-linkedin");
}

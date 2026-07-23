"use server";

import { revalidatePath } from "next/cache";
import { fetchReviewQueue, reviewItem } from "@/lib/data/content";
import { getAuthEmail } from "@/lib/auth";

// Server actions for the review queue — cloudRun calls must run server-side
// (CLOUD_RUN_API_KEY is a server-only env var).

export async function loadReviewQueue(
  status: "pending_review" | "approved" | "rejected",
  limit: number,
  offset: number,
) {
  return fetchReviewQueue(status, limit, offset);
}

export async function submitReview(
  id: string,
  payload: {
    action: "approve" | "reject";
    edited_title?: string;
    edited_summary?: string;
    decision_reason?: string;
  },
) {
  const reviewed_by = (await getAuthEmail()) ?? "nik@stza.io";
  const res = await reviewItem(id, { ...payload, reviewed_by });
  revalidatePath("/content/review");
  return res;
}

"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cloudRunMutate } from "@/lib/cloud-run";
import {
  CONFIDENCE_BANDS,
  EDITABLE_FIELDS,
  composeSourceConfidence,
  type ConfidenceBand,
  type UpdateResult,
} from "@/lib/data/registry-shared";

/**
 * Save edits to an organization row via the Cloud Run API (organizations live
 * in Cloud SQL since the Supabase migration). Only the EDITABLE_FIELDS subset
 * is written; the API enforces the same whitelist server-side.
 *
 * Empty strings become NULL so the operator can clear a field.
 *
 * source_confidence is composed from two form fields:
 *   - source_confidence_band: dropdown (High / Medium / Medium-Low / Low / "")
 *   - source_confidence_descriptor: optional free-text, parenthesised on save
 *
 * The acting user's email (from the Supabase auth session, which remains the
 * login layer until the IAP cutover) is passed as changed_by so the
 * organizations_audit trigger records who made the change.
 */
export async function updateOrganization(
  id: string,
  _prev: UpdateResult,
  formData: FormData,
): Promise<UpdateResult> {
  const patch: Record<string, string | null> = {};
  for (const field of EDITABLE_FIELDS) {
    // source_confidence is composed from band + descriptor below.
    if (field === "source_confidence") continue;
    const raw = formData.get(field);
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    patch[field] = trimmed.length > 0 ? trimmed : null;
  }

  const bandRaw = formData.get("source_confidence_band");
  const descriptorRaw = formData.get("source_confidence_descriptor");
  const band: ConfidenceBand | "" =
    typeof bandRaw === "string" && (CONFIDENCE_BANDS as readonly string[]).includes(bandRaw)
      ? (bandRaw as ConfidenceBand)
      : "";
  const descriptor = typeof descriptorRaw === "string" ? descriptorRaw : "";
  patch.source_confidence = composeSourceConfidence(band, descriptor);

  // Auth session still lives in Supabase until the IAP cutover — used here
  // only to attribute the change in the audit log.
  let changedBy = "system";
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) changedBy = data.user.email;
  } catch {
    // fall through with "system"
  }

  const res = await cloudRunMutate<{ id: string; updated: boolean }>(
    `/api/organizations/${id}`,
    "PUT",
    { fields: patch, changed_by: changedBy },
  );

  if (res.error) {
    return { status: "error", message: res.error };
  }
  if (!res.data?.updated) {
    return { status: "error", message: "Update was not applied." };
  }

  revalidatePath(`/registry/${id}`);
  revalidatePath("/registry");
  revalidatePath("/registry/verify");
  return { status: "ok", savedAt: Date.now() };
}

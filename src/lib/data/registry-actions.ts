"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  CONFIDENCE_BANDS,
  EDITABLE_FIELDS,
  composeSourceConfidence,
  type ConfidenceBand,
  type UpdateResult,
} from "@/lib/data/registry-shared";

/**
 * Save edits to an organization row. Only the EDITABLE_FIELDS subset is
 * written; structural fields (country/sport/level) and identity fields
 * (organization_name, astn_id) are excluded server-side - the form omits
 * them but defence in depth.
 *
 * Empty strings become NULL so the operator can clear a field.
 *
 * source_confidence is composed from two form fields:
 *   - source_confidence_band: dropdown (High / Medium / Medium-Low / Low / "")
 *   - source_confidence_descriptor: optional free-text, parenthesised on save
 *
 * Writes are gated by the "Nik can do anything" RLS policy
 * (auth.email() = 'nik@stza.io'); other allowlisted users see a permission
 * error surfaced via UpdateResult.
 */
export async function updateOrganization(
  id: string,
  _prev: UpdateResult,
  formData: FormData,
): Promise<UpdateResult> {
  const supabase = await createSupabaseServerClient();

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

  const { error } = await supabase.from("organizations").update(patch).eq("id", id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/registry/${id}`);
  revalidatePath("/registry");
  revalidatePath("/registry/verify");
  return { status: "ok", savedAt: Date.now() };
}

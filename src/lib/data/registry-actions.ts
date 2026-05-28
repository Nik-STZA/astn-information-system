"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EDITABLE_FIELDS, type UpdateResult } from "@/lib/data/registry-shared";

/**
 * Save edits to an organization row. Only the EDITABLE_FIELDS subset is
 * written; structural fields (country/sport/level) are protected because
 * they're denormalised against country_iso/sport_code pairs.
 *
 * Empty strings become NULL so the operator can clear a field.
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
    const raw = formData.get(field);
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    patch[field] = trimmed.length > 0 ? trimmed : null;
  }

  const { error } = await supabase.from("organizations").update(patch).eq("id", id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/registry/${id}`);
  revalidatePath("/registry");
  return { status: "ok", savedAt: Date.now() };
}

"use server";

import {
  updateRemediationItem,
  addRemediationNote,
  generateRemediation,
} from "@/lib/data/remediation";
import { fetchClientRemediation } from "@/lib/data/remediation";
import { revalidatePath } from "next/cache";

export async function updateRemediationStatus(itemId: number, status: string) {
  const result = await updateRemediationItem(itemId, {
    status,
    _performed_by: "nik@stza.io",
  });
  revalidatePath("/compliance");
  return result;
}

export async function addNote(itemId: number, note: string) {
  const result = await addRemediationNote(itemId, note, "nik@stza.io");
  revalidatePath("/compliance");
  return result;
}

export async function generateRemediationItems(clientId: string) {
  // The generate endpoint auto-looks-up the prospect by matching company_name
  // when prospect_id is not provided
  const result = await generateRemediation(clientId, "");
  revalidatePath("/compliance");
  return result;
}

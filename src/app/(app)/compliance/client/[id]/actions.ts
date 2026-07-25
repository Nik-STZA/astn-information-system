"use server";

import {
  updateRemediationItem,
  addRemediationNote,
  generateRemediation,
} from "@/lib/data/remediation";
import { fetchClientRemediation } from "@/lib/data/remediation";
import {
  fetchResolution,
  generateResolution as genResolution,
  updateResolution,
  type RemediationResolution,
} from "@/lib/data/remediation";
import {
  fetchClientProcessors,
  updateProcessor,
  fetchClientRegulatorRegistrations,
  updateRegulatorRegistration,
  type Processor,
  type RegulatorRegistration,
} from "@/lib/data/processor-register";
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

/* ── Systems & DPAs (processor register + regulator registrations) ────────── */

export async function loadSystems(clientId: string): Promise<{
  processors: Processor[];
  registrations: RegulatorRegistration[];
}> {
  const [p, r] = await Promise.all([
    fetchClientProcessors(clientId),
    fetchClientRegulatorRegistrations(clientId),
  ]);
  return {
    processors: p.data?.data ?? [],
    registrations: r.data?.data ?? [],
  };
}

export async function saveProcessor(
  pid: number,
  patch: { dpa_status?: string; status?: string; action?: string; notes?: string },
) {
  const result = await updateProcessor(pid, patch as Partial<Processor>);
  revalidatePath("/compliance");
  return result;
}

export async function saveRegistration(
  id: number,
  patch: { registration_number?: string; status?: string; notes?: string },
) {
  const result = await updateRegulatorRegistration(id, patch);
  revalidatePath("/compliance");
  return result;
}

/* ── AI-generated remediation resolutions (dual-model, cross-checked) ──────── */

export async function loadResolution(
  itemId: number,
): Promise<RemediationResolution | null> {
  const r = await fetchResolution(itemId);
  return r.data ?? null;
}

export async function generateResolution(
  itemId: number,
): Promise<RemediationResolution | null> {
  const r = await genResolution(itemId);
  revalidatePath("/compliance");
  return r.data ?? null;
}

export async function saveResolution(
  itemId: number,
  patch: { resolution?: string; status?: string },
): Promise<RemediationResolution | null> {
  const r = await updateResolution(itemId, { ...patch, reviewed_by: "nik@stza.io" });
  revalidatePath("/compliance");
  return r.data ?? null;
}

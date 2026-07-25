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
  fetchClientRemediationV2,
  generateRemediationFromAssessment,
  updateRemediationV2Item,
  fetchResolutionV2,
  generateResolutionV2 as genResolutionV2,
  updateResolutionV2,
  type RemediationV2Item,
} from "@/lib/data/remediation";
import { fetchClientAssessmentsV2 } from "@/lib/data/compliance";

export type RemediationBoardV2Loaded = {
  data: RemediationV2Item[];
  jurisdictions: {
    jurisdiction_code: string;
    jurisdiction_name: string;
    total: number;
    open: number;
  }[];
  assessments: { id: number; jurisdiction: string; overall_score: string | number | null }[];
};
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

/* ── V2 remediation board (jurisdiction-native, fed by the real assessment) ── */

export async function loadRemediationBoardV2(
  clientId: string,
): Promise<RemediationBoardV2Loaded> {
  const [board, asmts] = await Promise.all([
    fetchClientRemediationV2(clientId),
    fetchClientAssessmentsV2(clientId),
  ]);
  // Attach the client's completed/reviewed assessments so the panel can offer
  // "generate from <jurisdiction> assessment" per regime.
  const assessments = (asmts.data?.data ?? [])
    .filter((a) => a.status === "completed" || a.status === "reviewed")
    .map((a) => ({
      id: a.id,
      jurisdiction: a.jurisdiction || a.jurisdiction_name || a.jurisdiction_code || "Assessment",
      overall_score: a.overall_score,
    }));
  return {
    data: board.data?.data ?? [],
    jurisdictions: board.data?.jurisdictions ?? [],
    assessments,
  };
}

export async function generateBoardFromAssessment(
  clientId: string,
  assessmentId: number,
): Promise<{ count: number; removed: number; jurisdiction: string } | null> {
  const r = await generateRemediationFromAssessment(clientId, assessmentId);
  revalidatePath("/compliance");
  return r.data ?? null;
}

export async function updateRemediationStatusV2(id: number, status: string) {
  const r = await updateRemediationV2Item(id, { status, performed_by: "nik@stza.io" });
  revalidatePath("/compliance");
  return r.data ?? null;
}

export async function loadResolutionV2(
  id: number,
): Promise<RemediationResolution | null> {
  const r = await fetchResolutionV2(id);
  return r.data ?? null;
}

export async function generateResolutionV2(
  id: number,
): Promise<RemediationResolution | null> {
  const r = await genResolutionV2(id);
  revalidatePath("/compliance");
  return r.data ?? null;
}

export async function saveResolutionV2(
  id: number,
  patch: { resolution?: string; status?: string },
): Promise<RemediationResolution | null> {
  const r = await updateResolutionV2(id, { ...patch, reviewed_by: "nik@stza.io" });
  revalidatePath("/compliance");
  return r.data ?? null;
}

"use server";

import type {
  Engagement, IORegistration, BreachIncident,
  ComplianceTask, Correspondence,
} from "@/lib/data/client-management";
import * as cm from "@/lib/data/client-management";
import { createClient, updateClient, type Client } from "@/lib/data/compliance";
import { revalidatePath } from "next/cache";

// ─── Engagement actions ─────────────────────────────────────────────────────

export async function addEngagement(clientId: string, formData: FormData) {
  const data = {
    service_tier: formData.get("service_tier") as Engagement["service_tier"],
    engagement_status: ((formData.get("engagement_status") as string) || "draft") as Engagement["engagement_status"],
    start_date: (formData.get("start_date") as string) || null,
    end_date: (formData.get("end_date") as string) || null,
    annual_fee_gbp: formData.get("annual_fee_gbp")
      ? Number(formData.get("annual_fee_gbp"))
      : null,
    annual_fee_zar: formData.get("annual_fee_zar")
      ? Number(formData.get("annual_fee_zar"))
      : null,
    payment_frequency: ((formData.get("payment_frequency") as string) || "annual") as Engagement["payment_frequency"],
    agreement_document_url: (formData.get("agreement_document_url") as string) || null,
    notes: (formData.get("notes") as string) || null,
  };
  const res = await cm.createEngagement(clientId, data);
  revalidatePath("/clients");
  return res;
}

export async function editEngagement(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  for (const f of [
    "service_tier", "engagement_status", "start_date", "end_date",
    "payment_frequency", "agreement_document_url", "notes",
  ]) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("annual_fee_gbp")) {
    const v = formData.get("annual_fee_gbp") as string;
    data.annual_fee_gbp = v ? Number(v) : null;
  }
  if (formData.has("annual_fee_zar")) {
    const v = formData.get("annual_fee_zar") as string;
    data.annual_fee_zar = v ? Number(v) : null;
  }
  const res = await cm.updateEngagement(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeEngagement(id: string) {
  const res = await cm.deleteEngagement(id);
  revalidatePath("/clients");
  return res;
}

// ─── IO Registration actions ────────────────────────────────────────────────

export async function addRegistration(clientId: string, formData: FormData) {
  const data = {
    registration_type: formData.get("registration_type") as IORegistration["registration_type"],
    registrant_name: formData.get("registrant_name") as string,
    registrant_email: (formData.get("registrant_email") as string) || null,
    registrant_phone: (formData.get("registrant_phone") as string) || null,
    registrant_role: (formData.get("registrant_role") as string) || null,
    ir_reference_number: (formData.get("ir_reference_number") as string) || null,
    registration_status: ((formData.get("registration_status") as string) || "pending") as IORegistration["registration_status"],
    submitted_date: (formData.get("submitted_date") as string) || null,
    confirmed_date: (formData.get("confirmed_date") as string) || null,
    portal_used: ((formData.get("portal_used") as string) || null) as IORegistration["portal_used"],
    portal_organisation_type: (formData.get("portal_organisation_type") as string) || "other_private",
    notes: (formData.get("notes") as string) || null,
  };
  const res = await cm.createRegistration(clientId, data);
  revalidatePath("/clients");
  return res;
}

export async function editRegistration(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  for (const f of [
    "registration_type", "registrant_name", "registrant_email",
    "registrant_phone", "registrant_role", "ir_reference_number",
    "registration_status", "submitted_date", "confirmed_date",
    "portal_used", "portal_organisation_type", "notes",
  ]) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  const res = await cm.updateRegistration(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeRegistration(id: string) {
  const res = await cm.deleteRegistration(id);
  revalidatePath("/clients");
  return res;
}

// ─── Breach actions ─────────────────────────────────────────────────────────

export async function addBreach(clientId: string, formData: FormData) {
  const data = {
    incident_date: formData.get("incident_date") as string,
    reported_to_ir: formData.get("reported_to_ir") === "true",
    ir_report_date: (formData.get("ir_report_date") as string) || null,
    ir_reference_number: (formData.get("ir_reference_number") as string) || null,
    incident_type: (formData.get("incident_type") as string) || null,
    description: (formData.get("description") as string) || null,
    data_subjects_affected: formData.get("data_subjects_affected")
      ? Number(formData.get("data_subjects_affected"))
      : null,
    severity: ((formData.get("severity") as string) || null) as BreachIncident["severity"],
    status: ((formData.get("status") as string) || "reported") as BreachIncident["status"],
    remediation_notes: (formData.get("remediation_notes") as string) || null,
  };
  const res = await cm.createBreach(clientId, data);
  revalidatePath("/clients");
  return res;
}

export async function editBreach(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  for (const f of [
    "incident_date", "ir_report_date", "ir_reference_number",
    "incident_type", "description", "severity", "status",
    "remediation_notes",
  ]) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("reported_to_ir")) {
    data.reported_to_ir = formData.get("reported_to_ir") === "true";
  }
  if (formData.has("data_subjects_affected")) {
    const v = formData.get("data_subjects_affected") as string;
    data.data_subjects_affected = v ? Number(v) : null;
  }
  const res = await cm.updateBreach(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeBreach(id: string) {
  const res = await cm.deleteBreach(id);
  revalidatePath("/clients");
  return res;
}

// ─── Task actions ───────────────────────────────────────────────────────────

export async function addTask(clientId: string, formData: FormData) {
  const data = {
    task_type: formData.get("task_type") as string,
    title: formData.get("title") as string,
    description: (formData.get("description") as string) || null,
    due_date: (formData.get("due_date") as string) || null,
    status: ((formData.get("status") as string) || "pending") as ComplianceTask["status"],
    assigned_to: (formData.get("assigned_to") as string) || null,
  };
  const res = await cm.createTask(clientId, data);
  revalidatePath("/clients");
  return res;
}

export async function editTask(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  for (const f of [
    "task_type", "title", "description", "due_date",
    "completed_date", "status", "assigned_to",
  ]) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  const res = await cm.updateTask(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeTask(id: string) {
  const res = await cm.deleteTask(id);
  revalidatePath("/clients");
  return res;
}

// ─── Correspondence actions ─────────────────────────────────────────────────

export async function addCorrespondence(clientId: string, formData: FormData) {
  const data = {
    direction: formData.get("direction") as Correspondence["direction"],
    correspondent: (formData.get("correspondent") as string) || "Information Regulator",
    subject: formData.get("subject") as string,
    received_date: (formData.get("received_date") as string) || null,
    response_due_date: (formData.get("response_due_date") as string) || null,
    responded_date: (formData.get("responded_date") as string) || null,
    urgency: ((formData.get("urgency") as string) || "normal") as Correspondence["urgency"],
    document_url: (formData.get("document_url") as string) || null,
    status: ((formData.get("status") as string) || "received") as Correspondence["status"],
    notes: (formData.get("notes") as string) || null,
  };
  const res = await cm.createCorrespondence(clientId, data);
  revalidatePath("/clients");
  return res;
}

export async function editCorrespondence(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  for (const f of [
    "direction", "correspondent", "subject", "received_date",
    "response_due_date", "responded_date", "urgency",
    "document_url", "status", "notes",
  ]) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  const res = await cm.updateCorrespondence(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeCorrespondence(id: string) {
  const res = await cm.deleteCorrespondence(id);
  revalidatePath("/clients");
  return res;
}

// ─── Client actions ─────────────────────────────────────────────────────────
// These must stay server actions: cloudRunMutate reads CLOUD_RUN_API_KEY,
// which only exists server-side. Calling the data-lib functions directly from
// a client component sends the request from the browser without the API key
// and gets a 401.

export async function createClientAction(payload: Partial<Client>) {
  const res = await createClient(payload);
  revalidatePath("/clients");
  return res;
}

export async function updateClientAction(id: string, payload: Partial<Client>) {
  const res = await updateClient(id, payload);
  revalidatePath("/clients");
  return res;
}

// ─── Workspace passthrough actions ─────────────────────────────────────────
// ClientsClient (a client component) previously imported these straight from
// lib/data/client-management, which made every call run in the browser where
// CLOUD_RUN_API_KEY doesn't exist → 401 on every tab. Same names, same
// signatures, but executed server-side. Reads are plain passthroughs;
// mutations also revalidate /clients.

export async function fetchEngagements(...a: Parameters<typeof cm.fetchEngagements>) { return cm.fetchEngagements(...a); }
export async function fetchRegistrations(...a: Parameters<typeof cm.fetchRegistrations>) { return cm.fetchRegistrations(...a); }
export async function fetchBreaches(...a: Parameters<typeof cm.fetchBreaches>) { return cm.fetchBreaches(...a); }
export async function fetchClientTasks(...a: Parameters<typeof cm.fetchClientTasks>) { return cm.fetchClientTasks(...a); }
export async function fetchClientCorrespondence(...a: Parameters<typeof cm.fetchClientCorrespondence>) { return cm.fetchClientCorrespondence(...a); }
export async function fetchProcessingActivities(...a: Parameters<typeof cm.fetchProcessingActivities>) { return cm.fetchProcessingActivities(...a); }
export async function fetchSpecialCategories(...a: Parameters<typeof cm.fetchSpecialCategories>) { return cm.fetchSpecialCategories(...a); }
export async function fetchRemediationItems(...a: Parameters<typeof cm.fetchRemediationItems>) { return cm.fetchRemediationItems(...a); }
export async function fetchDSARs(...a: Parameters<typeof cm.fetchDSARs>) { return cm.fetchDSARs(...a); }

async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const res = await fn();
  revalidatePath("/clients");
  return res;
}

export async function createEngagement(...a: Parameters<typeof cm.createEngagement>) { return mutate(() => cm.createEngagement(...a)); }
export async function updateEngagement(...a: Parameters<typeof cm.updateEngagement>) { return mutate(() => cm.updateEngagement(...a)); }
export async function deleteEngagement(...a: Parameters<typeof cm.deleteEngagement>) { return mutate(() => cm.deleteEngagement(...a)); }
export async function createRegistration(...a: Parameters<typeof cm.createRegistration>) { return mutate(() => cm.createRegistration(...a)); }
export async function updateRegistration(...a: Parameters<typeof cm.updateRegistration>) { return mutate(() => cm.updateRegistration(...a)); }
export async function deleteRegistration(...a: Parameters<typeof cm.deleteRegistration>) { return mutate(() => cm.deleteRegistration(...a)); }
export async function createBreach(...a: Parameters<typeof cm.createBreach>) { return mutate(() => cm.createBreach(...a)); }
export async function updateBreach(...a: Parameters<typeof cm.updateBreach>) { return mutate(() => cm.updateBreach(...a)); }
export async function deleteBreach(...a: Parameters<typeof cm.deleteBreach>) { return mutate(() => cm.deleteBreach(...a)); }
export async function createTask(...a: Parameters<typeof cm.createTask>) { return mutate(() => cm.createTask(...a)); }
export async function updateTask(...a: Parameters<typeof cm.updateTask>) { return mutate(() => cm.updateTask(...a)); }
export async function deleteTask(...a: Parameters<typeof cm.deleteTask>) { return mutate(() => cm.deleteTask(...a)); }
export async function createCorrespondence(...a: Parameters<typeof cm.createCorrespondence>) { return mutate(() => cm.createCorrespondence(...a)); }
export async function updateCorrespondence(...a: Parameters<typeof cm.updateCorrespondence>) { return mutate(() => cm.updateCorrespondence(...a)); }
export async function deleteCorrespondence(...a: Parameters<typeof cm.deleteCorrespondence>) { return mutate(() => cm.deleteCorrespondence(...a)); }
export async function createProcessingActivity(...a: Parameters<typeof cm.createProcessingActivity>) { return mutate(() => cm.createProcessingActivity(...a)); }
export async function updateProcessingActivity(...a: Parameters<typeof cm.updateProcessingActivity>) { return mutate(() => cm.updateProcessingActivity(...a)); }
export async function deleteProcessingActivity(...a: Parameters<typeof cm.deleteProcessingActivity>) { return mutate(() => cm.deleteProcessingActivity(...a)); }
export async function initSpecialCategories(...a: Parameters<typeof cm.initSpecialCategories>) { return mutate(() => cm.initSpecialCategories(...a)); }
export async function updateSpecialCategory(...a: Parameters<typeof cm.updateSpecialCategory>) { return mutate(() => cm.updateSpecialCategory(...a)); }
export async function updateRemediationItem(...a: Parameters<typeof cm.updateRemediationItem>) { return mutate(() => cm.updateRemediationItem(...a)); }
export async function generateRemediationItems(...a: Parameters<typeof cm.generateRemediationItems>) { return mutate(() => cm.generateRemediationItems(...a)); }
export async function createDSAR(...a: Parameters<typeof cm.createDSAR>) { return mutate(() => cm.createDSAR(...a)); }
export async function updateDSAR(...a: Parameters<typeof cm.updateDSAR>) { return mutate(() => cm.updateDSAR(...a)); }
export async function deleteDSAR(...a: Parameters<typeof cm.deleteDSAR>) { return mutate(() => cm.deleteDSAR(...a)); }

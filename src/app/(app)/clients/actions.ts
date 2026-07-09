"use server";

import type {
  Engagement, IORegistration, BreachIncident,
  ComplianceTask, Correspondence,
} from "@/lib/data/client-management";
import {
  createEngagement,
  updateEngagement,
  deleteEngagement,
  createRegistration,
  updateRegistration,
  deleteRegistration,
  createBreach,
  updateBreach,
  deleteBreach,
  createTask,
  updateTask,
  deleteTask,
  createCorrespondence,
  updateCorrespondence,
  deleteCorrespondence,
} from "@/lib/data/client-management";
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
  const res = await createEngagement(clientId, data);
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
  const res = await updateEngagement(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeEngagement(id: string) {
  const res = await deleteEngagement(id);
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
  const res = await createRegistration(clientId, data);
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
  const res = await updateRegistration(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeRegistration(id: string) {
  const res = await deleteRegistration(id);
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
  const res = await createBreach(clientId, data);
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
  const res = await updateBreach(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeBreach(id: string) {
  const res = await deleteBreach(id);
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
  const res = await createTask(clientId, data);
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
  const res = await updateTask(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeTask(id: string) {
  const res = await deleteTask(id);
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
  const res = await createCorrespondence(clientId, data);
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
  const res = await updateCorrespondence(id, data);
  revalidatePath("/clients");
  return res;
}

export async function removeCorrespondence(id: string) {
  const res = await deleteCorrespondence(id);
  revalidatePath("/clients");
  return res;
}

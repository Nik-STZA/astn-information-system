/**
 * Data fetching functions for Client Management module.
 * Consumes the Cloud Run API for POPIA representative service tables:
 *   client_engagements, io_registrations, breach_incidents,
 *   compliance_tasks, regulatory_correspondence.
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Engagement = {
  id: number; // SERIAL PK
  client_id: number; // INTEGER FK → compliance_clients
  service_tier: "representative" | "authorised_io";
  engagement_status: "draft" | "sent" | "signed" | "active" | "suspended" | "terminated";
  start_date: string | null;
  end_date: string | null;
  annual_fee_gbp: number | null;
  annual_fee_zar: number | null;
  payment_frequency: "monthly" | "quarterly" | "annual";
  agreement_document_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type IORegistration = {
  id: number; // SERIAL PK
  client_id: number; // INTEGER FK
  registration_type: "information_officer" | "deputy_information_officer";
  registrant_name: string;
  registrant_email: string | null;
  registrant_phone: string | null;
  registrant_role: string | null;
  ir_reference_number: string | null;
  registration_status: "pending" | "submitted" | "confirmed" | "rejected" | "deregistered";
  submitted_date: string | null;
  confirmed_date: string | null;
  portal_used: "eservices" | "bizportal" | "manual_email" | null;
  portal_organisation_type: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BreachIncident = {
  id: number; // SERIAL PK
  client_id: number; // INTEGER FK
  incident_date: string;
  reported_to_ir: boolean;
  ir_report_date: string | null;
  ir_reference_number: string | null;
  incident_type: string | null;
  description: string | null;
  data_subjects_affected: number | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  status: "reported" | "investigating" | "contained" | "resolved" | "closed";
  remediation_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ComplianceTask = {
  id: number; // SERIAL PK
  client_id: number; // INTEGER FK
  client_name?: string; // joined from compliance_clients on /api/tasks
  task_type: string;
  title: string;
  description: string | null;
  due_date: string | null;
  completed_date: string | null;
  status: "pending" | "in_progress" | "completed" | "overdue" | "cancelled";
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type Correspondence = {
  id: number; // SERIAL PK
  client_id: number | null; // INTEGER FK (nullable — some may be general)
  client_name?: string; // joined
  direction: "inbound" | "outbound";
  correspondent: string;
  subject: string;
  received_date: string | null;
  response_due_date: string | null;
  responded_date: string | null;
  urgency: "normal" | "urgent" | "critical";
  document_url: string | null;
  status: "received" | "acknowledged" | "in_progress" | "responded" | "closed";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientManagementSummary = {
  engagements_by_status: { engagement_status: string; count: string }[];
  overdue_tasks: number;
  open_breaches: number;
  pending_correspondence: number;
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

// Engagements
export async function fetchEngagements(clientId: number | string) {
  return cloudRunFetch<{ count: number; data: Engagement[] }>(
    `/api/clients/${clientId}/engagements`
  );
}
export async function createEngagement(clientId: number | string, data: Partial<Engagement>) {
  return cloudRunMutate<Engagement>(`/api/clients/${clientId}/engagements`, "POST", data);
}
export async function updateEngagement(id: number | string, data: Partial<Engagement>) {
  return cloudRunMutate<Engagement>(`/api/engagements/${id}`, "PUT", data);
}
export async function deleteEngagement(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/engagements/${id}`, "DELETE");
}

// IO Registrations
export async function fetchRegistrations(clientId: number | string) {
  return cloudRunFetch<{ count: number; data: IORegistration[] }>(
    `/api/clients/${clientId}/registrations`
  );
}
export async function createRegistration(clientId: number | string, data: Partial<IORegistration>) {
  return cloudRunMutate<IORegistration>(`/api/clients/${clientId}/registrations`, "POST", data);
}
export async function updateRegistration(id: number | string, data: Partial<IORegistration>) {
  return cloudRunMutate<IORegistration>(`/api/registrations/${id}`, "PUT", data);
}
export async function deleteRegistration(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/registrations/${id}`, "DELETE");
}

// Breach Incidents
export async function fetchBreaches(clientId: number | string) {
  return cloudRunFetch<{ count: number; data: BreachIncident[] }>(
    `/api/clients/${clientId}/breaches`
  );
}
export async function createBreach(clientId: number | string, data: Partial<BreachIncident>) {
  return cloudRunMutate<BreachIncident>(`/api/clients/${clientId}/breaches`, "POST", data);
}
export async function updateBreach(id: number | string, data: Partial<BreachIncident>) {
  return cloudRunMutate<BreachIncident>(`/api/breaches/${id}`, "PUT", data);
}
export async function deleteBreach(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/breaches/${id}`, "DELETE");
}

// Compliance Tasks
export async function fetchClientTasks(clientId: number | string) {
  return cloudRunFetch<{ count: number; data: ComplianceTask[] }>(
    `/api/clients/${clientId}/tasks`
  );
}
export async function fetchAllTasks(status?: string) {
  const path = status ? `/api/tasks?status=${status}` : "/api/tasks";
  return cloudRunFetch<{ count: number; data: ComplianceTask[] }>(path);
}
export async function createTask(clientId: number | string, data: Partial<ComplianceTask>) {
  return cloudRunMutate<ComplianceTask>(`/api/clients/${clientId}/tasks`, "POST", data);
}
export async function updateTask(id: number | string, data: Partial<ComplianceTask>) {
  return cloudRunMutate<ComplianceTask>(`/api/tasks/${id}`, "PUT", data);
}
export async function deleteTask(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/tasks/${id}`, "DELETE");
}

// Regulatory Correspondence
export async function fetchClientCorrespondence(clientId: number | string) {
  return cloudRunFetch<{ count: number; data: Correspondence[] }>(
    `/api/clients/${clientId}/correspondence`
  );
}
export async function fetchAllCorrespondence() {
  return cloudRunFetch<{ count: number; data: Correspondence[] }>("/api/correspondence");
}
export async function createCorrespondence(clientId: number | string, data: Partial<Correspondence>) {
  return cloudRunMutate<Correspondence>(`/api/clients/${clientId}/correspondence`, "POST", data);
}
export async function updateCorrespondence(id: number | string, data: Partial<Correspondence>) {
  return cloudRunMutate<Correspondence>(`/api/correspondence/${id}`, "PUT", data);
}
export async function deleteCorrespondence(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/correspondence/${id}`, "DELETE");
}

// Dashboard summary
export async function fetchClientManagementSummary() {
  return cloudRunFetch<ClientManagementSummary>("/api/client-management/summary");
}

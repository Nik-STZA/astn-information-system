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
  client_id: string; // UUID FK → compliance_clients
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
  client_id: string; // UUID FK
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
  client_id: string; // UUID FK
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
  notification_deadline: string | null;
  data_subjects_notified: boolean;
  data_subjects_notification_date: string | null;
  data_subjects_count: number | null;
  created_at: string;
  updated_at: string;
};

export type ComplianceTask = {
  id: number; // SERIAL PK
  client_id: string; // UUID FK
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
  client_id: string | null; // UUID FK (nullable — some may be general)
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

// ─── Data Subject Requests (DSAR) Type ──────────────────────────────────────

export type DataSubjectRequest = {
  id: number; // SERIAL PK
  client_id: string; // UUID FK
  client_name?: string; // joined

  // Request details
  request_type: "access" | "correction" | "deletion" | "objection" | "portability" | "other";
  description: string | null;

  // Data subject
  data_subject_name: string;
  data_subject_email: string | null;
  data_subject_phone: string | null;
  data_subject_id_type: string | null;
  data_subject_id_ref: string | null;
  data_subject_category: string | null;
  identity_verified: boolean;

  // Workflow
  status: "received" | "identity_verification" | "in_progress" | "awaiting_info" | "completed" | "refused" | "escalated" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_to: string | null;

  // Dates
  received_date: string;
  acknowledged_date: string | null;
  deadline: string | null;
  completed_date: string | null;
  closed_date: string | null;

  // Response
  response_summary: string | null;
  refusal_reason: string | null;
  third_parties_notified: boolean;
  third_party_details: string | null;

  // Evidence
  evidence_description: string | null;
  evidence_urls: string[] | null;

  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

// ─── Remediation Items Type ─────────────────────────────────────────────────

export type RemediationItem = {
  id: number; // SERIAL PK
  client_id: string; // UUID FK
  prospect_id: string | null;
  assessment_id: number | null;
  finding_id: number | null;
  category: string;
  title: string;
  description: string | null;
  severity: "critical" | "high" | "medium" | "low" | "info" | "compliant";
  popia_reference: string | null;
  recommendation: string | null;
  status: "open" | "in_progress" | "resolved" | "verified" | "not_applicable" | "accepted_risk";
  assigned_to: string | null;
  due_date: string | null;
  started_date: string | null;
  resolved_date: string | null;
  verified_date: string | null;
  verified_by: string | null;
  resolution_summary: string | null;
  evidence_description: string | null;
  evidence_urls: string[] | null;
  created_by: string;
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

// ─── Processing Activities (ROPA) Types ──────────────────────────────────────

export type ProcessingActivity = {
  id: number; // SERIAL PK
  client_id: string; // UUID FK
  activity_name: string;
  description: string | null;
  personal_data_types: string[] | null;
  data_subject_categories: string[] | null;
  estimated_volume: string | null;
  legal_basis: string;
  legal_basis_detail: string | null;
  purpose: string;
  retention_period: string | null;
  retention_basis: string | null;
  recipients: string[] | null;
  cross_border: boolean;
  transfer_countries: string[] | null;
  transfer_mechanism: string | null;
  security_measures: string | null;
  status: "active" | "inactive" | "under_review";
  last_reviewed: string | null;
  created_at: string;
  updated_at: string;
};

export type SpecialCategory = {
  id: number; // SERIAL PK
  client_id: string; // UUID FK
  category: "religious_beliefs" | "race_ethnicity" | "trade_union" | "political" | "health" | "sex_life" | "biometric" | "criminal" | "children";
  is_processed: boolean | null;
  processing_description: string | null;
  volume_estimate: string | null;
  legal_basis: string | null;
  safeguards: string | null;
  prior_auth_required: boolean | null;
  prior_auth_status: "not_required" | "pending" | "submitted" | "approved" | "refused" | null;
  prior_auth_reference: string | null;
  prior_auth_date: string | null;
  compliance_status: "not_assessed" | "compliant" | "partial" | "non_compliant";
  last_assessed: string | null;
  assessor_notes: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Processing Activities Fetchers ──────────────────────────────────────────

export async function fetchProcessingActivities(clientId: string) {
  return cloudRunFetch<{ count: number; data: ProcessingActivity[] }>(
    `/api/clients/${clientId}/processing-activities`
  );
}
export async function createProcessingActivity(clientId: string, data: Partial<ProcessingActivity>) {
  return cloudRunMutate<ProcessingActivity>(`/api/clients/${clientId}/processing-activities`, "POST", data);
}
export async function updateProcessingActivity(id: number | string, data: Partial<ProcessingActivity>) {
  return cloudRunMutate<ProcessingActivity>(`/api/processing-activities/${id}`, "PUT", data);
}
export async function deleteProcessingActivity(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/processing-activities/${id}`, "DELETE");
}

// ─── Special Categories Fetchers ─────────────────────────────────────────────

export async function fetchSpecialCategories(clientId: string) {
  return cloudRunFetch<{ count: number; data: SpecialCategory[] }>(
    `/api/clients/${clientId}/special-categories`
  );
}
export async function initSpecialCategories(clientId: string) {
  return cloudRunMutate<{ inserted: number; data: SpecialCategory[] }>(
    `/api/clients/${clientId}/special-categories/init`, "POST", {}
  );
}
export async function createSpecialCategory(clientId: string, data: Partial<SpecialCategory>) {
  return cloudRunMutate<SpecialCategory>(`/api/clients/${clientId}/special-categories`, "POST", data);
}
export async function updateSpecialCategory(id: number | string, data: Partial<SpecialCategory>) {
  return cloudRunMutate<SpecialCategory>(`/api/special-categories/${id}`, "PUT", data);
}
export async function deleteSpecialCategory(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/special-categories/${id}`, "DELETE");
}

// ─── Remediation Items Fetchers ─────────────────────────────────────────────

export async function fetchRemediationItems(clientId: string) {
  return cloudRunFetch<{ count: number; data: RemediationItem[] }>(
    `/api/clients/${clientId}/remediation`
  );
}
export async function updateRemediationItem(id: number | string, data: Partial<RemediationItem>) {
  return cloudRunMutate<RemediationItem>(`/api/remediation/${id}`, "PUT", data);
}
export async function generateRemediationItems(clientId: string) {
  return cloudRunMutate<{ count: number; data: RemediationItem[]; skipped_compliant: number }>(
    `/api/clients/${clientId}/remediation/generate`, "POST", {}
  );
}

// ─── Data Subject Requests (DSAR) Fetchers ────────────────────────────────────

export async function fetchDSARs(clientId: string) {
  return cloudRunFetch<{ count: number; data: DataSubjectRequest[] }>(
    `/api/clients/${clientId}/dsars`
  );
}
export async function fetchAllDSARs(status?: string) {
  const path = status ? `/api/dsars?status=${status}` : "/api/dsars";
  return cloudRunFetch<{ count: number; data: DataSubjectRequest[] }>(path);
}
export async function createDSAR(clientId: string, data: Partial<DataSubjectRequest>) {
  return cloudRunMutate<DataSubjectRequest>(`/api/clients/${clientId}/dsars`, "POST", data);
}
export async function updateDSAR(id: number | string, data: Partial<DataSubjectRequest>) {
  return cloudRunMutate<DataSubjectRequest>(`/api/dsars/${id}`, "PUT", data);
}
export async function deleteDSAR(id: number | string) {
  return cloudRunMutate<{ deleted: boolean }>(`/api/dsars/${id}`, "DELETE");
}

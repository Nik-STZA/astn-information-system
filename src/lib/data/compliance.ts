/**
 * Data fetching functions for Compliance module.
 * Consumes: /api/compliance/prospects, /api/compliance/clients, /api/compliance/activities.
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Prospect = {
  id: string;  // UUID
  company_name: string;
  company_website: string | null;
  company_country: string | null;
  sector: string | null;
  sa_presence_evidence: string | null;
  ir_registered: boolean | null;
  // IR verification fields (migration 007)
  ir_verified_date: string | null;
  ir_verification_method: string | null; // 'manual_portal' | 'automated' | 'assumed'
  ir_verification_notes: string | null;
  ir_entity_name: string | null;
  ir_registration_no: string | null;
  ir_io_name: string | null;
  ir_io_designation: string | null;
  // IR registration details (migration 008)
  ir_registration_date: string | null;
  ir_organisation_type: string | null; // 'Private Body' | 'Public Body'
  outreach_status: string;
  priority: string;
  estimated_tier: string | null;
  notes: string | null;
  outreach_date: string | null;
  outreach_channel: string | null;
  response_date: string | null;
  // Pipeline columns (migration 003)
  research_status: string;
  last_research_date: string | null;
  document_count: number;
  finding_count: number;
  critical_finding_count: number;
  // Document/URL fields for agent review (migration 005)
  privacy_policy_url: string | null;
  terms_url: string | null;
  linkedin_url: string | null;
  app_store_url: string | null;
  other_urls: string | null;
  created_at: string;
  updated_at: string;
};

export type Client = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_country: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_role: string | null;
  status: string;
  service_tier: string | null;
  annual_fee_gbp: number | null;
  engagement_start: string | null;
  processes_biometric: boolean | null;
  processes_minors: boolean | null;
  notes: string | null;
  activity_count: number;
  created_at: string;
  updated_at: string;
};

export type Activity = {
  id: number;
  client_id: string;
  activity_date: string;
  activity_type: string;
  description: string | null;
  hours_spent: number | null;
  performed_by: string | null;
  next_due: string | null;
  created_at: string;
};

// ─── Pipeline result types ──────────────────────────────────────────────────

export type ProspectDocument = {
  id: number;
  prospect_id: string;
  document_type: string;
  document_title: string | null;
  source_url: string | null;
  snapshot_date: string | null;
  markdown_content: string | null;
  conversion_status: string | null;
  file_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AnalysisFinding = {
  id: number;
  prospect_id: string;
  document_id: number | null;
  analysis_date: string;
  jurisdiction: string;
  check_category: string;
  finding: string;
  severity: string;
  evidence_quote: string | null;
  evidence_location: string | null;
  recommendation: string | null;
  agent_model: string | null;
  agent_version: string | null;
  human_reviewed: boolean;
  reviewer_notes: string | null;
  created_at: string;
};

export type ProspectAssessment = {
  id: number;
  prospect_id: string;
  score_ir_registration: number;
  score_biometric_handling: number;
  score_cross_border: number;
  score_consent_mechanism: number;
  score_breach_notification: number;
  score_data_subject_rights: number;
  score_overall: number;
  overall_severity: string;
  executive_summary: string | null;
  risk_factors: unknown;
  key_findings: unknown;
  recommendations: unknown;
  generated_by: string;
  agent_model: string | null;
  agent_version: string | null;
  superseded_at: string | null;
  created_at: string;
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchProspects() {
  return cloudRunFetch<{ count: number; data: Prospect[] }>(
    "/api/compliance/prospects"
  );
}

export async function fetchClients() {
  return cloudRunFetch<{ count: number; data: Client[] }>(
    "/api/compliance/clients"
  );
}

export async function fetchActivities(clientId?: number) {
  const path = clientId
    ? `/api/compliance/activities?client_id=${clientId}`
    : "/api/compliance/activities";
  return cloudRunFetch<{ count: number; data: Activity[] }>(path);
}

// ─── Pipeline result fetchers ───────────────────────────────────────────────

export async function fetchProspectDocuments(prospectId: string) {
  return cloudRunFetch<{ count: number; data: ProspectDocument[] }>(
    `/api/compliance/prospects/${prospectId}/documents`
  );
}

export async function fetchProspectAnalysis(prospectId: string) {
  return cloudRunFetch<{ count: number; data: AnalysisFinding[] }>(
    `/api/compliance/prospects/${prospectId}/analysis`
  );
}

export async function fetchProspectAssessments(prospectId: string) {
  return cloudRunFetch<{ count: number; data: ProspectAssessment[] }>(
    `/api/compliance/prospects/${prospectId}/assessments`
  );
}

// ─── Mutations (called from route handlers / server actions) ─────────────────

export async function createProspect(data: Partial<Prospect>) {
  return cloudRunMutate<Prospect>("/api/compliance/prospects", "POST", data);
}

export async function updateProspect(id: string, data: Partial<Prospect>) {
  return cloudRunMutate<Prospect>(
    `/api/compliance/prospects/${id}`,
    "PUT",
    data
  );
}

export async function deleteProspect(id: string) {
  return cloudRunMutate<{ deleted: boolean }>(
    `/api/compliance/prospects/${id}`,
    "DELETE"
  );
}

export async function createClient(data: Partial<Client>) {
  return cloudRunMutate<Client>("/api/compliance/clients", "POST", data);
}

export async function updateClient(id: number, data: Partial<Client>) {
  return cloudRunMutate<Client>(
    `/api/compliance/clients/${id}`,
    "PUT",
    data
  );
}


export async function createActivity(data: Partial<Activity>) {
  return cloudRunMutate<Activity>(
    "/api/compliance/activities",
    "POST",
    data
  );
}

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

// ─── V2 Types (multi-jurisdiction, DB-driven engine) ────────────────────────

export type Jurisdiction = {
  id: number;
  code: string;
  name: string;
  short_name: string;
  country_iso: string;
  enacted_date: string | null;
  effective_date: string | null;
  regulator_name: string | null;
  regulator_url: string | null;
  version: string;
  is_active: boolean;
  scoring_config: {
    min_weight: number;
    avg_weight: number;
    mandatory_domains: string[];
    mandatory_threshold?: number;
  } | null;
  domain_count: number;
  requirement_count: number;
};

export type DomainScore = {
  score: number;
  weight: number;
  name: string;
  requirement_count: number;
};

export type ComplianceAssessmentV2 = {
  id: number;
  client_id: string;
  jurisdiction_id: number;
  jurisdiction?: string; // short_name from join
  jurisdiction_name?: string;
  jurisdiction_code?: string;
  company_name?: string;
  engagement_id: number | null;
  assessment_type: string;
  engine_version: string;
  overall_score: number; // 0-100
  domain_scores: Record<string, DomainScore>;
  confidence_level: string;
  status: string;
  completed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  working_papers: {
    engine_version: string;
    jurisdiction_code: string;
    scoring_config: Record<string, unknown>;
    evidence_summary: {
      total_evidence: number;
      keyword_evidence: number;
      manual_evidence: number;
      external_evidence: number;
    };
    severity_counts: Record<string, number>;
    executive_summary: string;
    risk_factors: Array<{ level: string; factor: string; note: string }>;
    key_findings: Array<{
      finding_id: number;
      domain: string;
      requirement: string;
      severity: string;
      finding: string;
      evidence_count: number;
      confidence: string;
    }>;
    recommendations: Array<{
      priority: number;
      action: string;
      rationale: string;
    }>;
  } | null;
  finding_count?: number;
  created_at: string;
  updated_at?: string;
};

export type AssessmentFindingV2 = {
  id: number;
  assessment_id: number;
  requirement_id: number;
  domain_id: number;
  requirement_code: string;
  requirement_name: string;
  domain_code: string;
  domain_name: string;
  status: string; // absent | partial | present
  severity: string;
  finding_text: string;
  recommendation: string | null;
  evidence_ids: number[];
  evidence_count: number;
  confidence: string;
  confidence_factors: Record<string, unknown>;
  score: number;
};

export type ComplianceDocumentV2 = {
  id: number;
  document_type: string;
  title: string;
  source_url: string | null;
  word_count: number;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ComplianceEvidenceV2 = {
  id: number;
  requirement_code: string;
  requirement_name: string;
  document_title: string | null;
  document_type: string | null;
  matched_text: string;
  context_text: string | null;
  keyword_pattern: string | null;
  keyword_class: string | null;
  confidence: string;
  extraction_method: string;
  created_at: string;
};

export type AssessmentDetailV2 = {
  assessment: ComplianceAssessmentV2;
  findings: AssessmentFindingV2[];
  documents_in_scope: ComplianceDocumentV2[];
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

export async function updateClient(id: string, data: Partial<Client>) {
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

// ─── V2 Fetchers (multi-jurisdiction engine) ────────────────────────────────

export async function fetchJurisdictions() {
  return cloudRunFetch<{ count: number; data: Jurisdiction[] }>(
    "/api/compliance/jurisdictions"
  );
}

export async function fetchJurisdictionDetail(id: number) {
  return cloudRunFetch<{
    jurisdiction: Jurisdiction;
    domains: Array<{ id: number; code: string; name: string; weight: number }>;
    requirement_count: number;
    keyword_count: number;
  }>(`/api/compliance/jurisdictions/${id}`);
}

export type JurisdictionRequirement = {
  id: number;
  code: string;
  name: string;
  description: string;
  domain_id: number;
  domain_code: string;
  domain_name: string;
  is_mandatory: boolean;
  weight: number;
  keyword_count: number;
  keywords: Array<{ id: number; pattern: string; keyword_class: string; weight: number }>;
};

export async function fetchJurisdictionRequirements(id: number) {
  return cloudRunFetch<{
    jurisdiction: string;
    count: number;
    data: JurisdictionRequirement[];
  }>(`/api/compliance/jurisdictions/${id}/requirements`);
}

export async function fetchClientDocumentsV2(clientId: string) {
  return cloudRunFetch<{ count: number; data: ComplianceDocumentV2[] }>(
    `/api/compliance/clients/${clientId}/documents`
  );
}

export async function fetchClientAssessmentsV2(clientId: string) {
  return cloudRunFetch<{ count: number; data: ComplianceAssessmentV2[] }>(
    `/api/compliance/clients/${clientId}/assessments`
  );
}

export async function fetchAssessmentDetailV2(assessmentId: number) {
  return cloudRunFetch<AssessmentDetailV2>(
    `/api/compliance/assessments/${assessmentId}`
  );
}

export async function fetchClientEvidenceV2(clientId: string, jurisdictionId?: number) {
  const path = jurisdictionId
    ? `/api/compliance/clients/${clientId}/evidence?jurisdiction_id=${jurisdictionId}`
    : `/api/compliance/clients/${clientId}/evidence`;
  return cloudRunFetch<{ count: number; data: ComplianceEvidenceV2[] }>(path);
}

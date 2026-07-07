/**
 * Data fetching functions for the Prospect Research & Assessment Pipeline.
 *
 * Consumes:
 *  - /api/compliance/prospects/:id/documents
 *  - /api/compliance/prospects/:id/analysis
 *  - /api/compliance/prospects/:id/assessments
 *  - /api/compliance/documents/:id
 *  - /api/compliance/analysis/:id
 *  - /api/compliance/assessments/:id
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DocumentType =
  | "privacy_policy"
  | "dpa"
  | "terms_of_service"
  | "eula"
  | "cookie_policy"
  | "sub_processor_list"
  | "annual_report"
  | "press_release"
  | "other";

export type ConversionStatus =
  | "pending"
  | "converting"
  | "converted"
  | "failed"
  | "not_needed";

export type Severity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info"
  | "compliant";

export type AssessmentStatus =
  | "draft"
  | "reviewed"
  | "approved"
  | "sent"
  | "superseded";

export type ResearchStatus =
  | "not_started"
  | "collecting"
  | "collected"
  | "analysing"
  | "analysed"
  | "assessed"
  | "complete";

export type ProspectDocument = {
  id: number;
  prospect_id: string;  // UUID
  document_type: DocumentType;
  document_title: string | null;
  source_url: string | null;
  snapshot_date: string;
  pdf_storage_path: string | null;
  html_snapshot: string | null;
  markdown_content: string | null;
  conversion_status: ConversionStatus;
  conversion_error: string | null;
  file_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AnalysisFinding = {
  id: number;
  prospect_id: string;  // UUID
  document_id: number | null;
  analysis_date: string;
  jurisdiction: string;
  check_category: string;
  finding: string;
  severity: Severity;
  evidence_quote: string | null;
  evidence_location: string | null;
  recommendation: string | null;
  agent_model: string | null;
  agent_version: string | null;
  human_reviewed: boolean;
  reviewer_notes: string | null;
  created_at: string;
  // Joined from prospect_documents when fetched via prospect endpoint
  document_title?: string | null;
  document_type?: string | null;
};

export type RiskFactor = {
  level: Severity;
  factor: string;
  note: string;
};

export type KeyFinding = {
  finding_id: number;
  category: string;
  severity: Severity;
  finding: string;
  evidence: string | null;
};

export type Recommendation = {
  priority: number;
  action: string;
  rationale: string;
};

export type ProspectAssessment = {
  id: number;
  prospect_id: string;  // UUID
  assessment_date: string;
  assessment_version: number;
  status: AssessmentStatus;
  score_ir_registration: number | null;
  score_biometric_handling: number | null;
  score_cross_border: number | null;
  score_consent_mechanism: number | null;
  score_breach_notification: number | null;
  score_data_subject_rights: number | null;
  score_overall: number | null;
  overall_severity: string | null;
  executive_summary: string | null;
  risk_factors: RiskFactor[] | null;
  key_findings: KeyFinding[] | null;
  recommendations: Recommendation[] | null;
  generated_by: "agent" | "human";
  agent_model: string | null;
  agent_version: string | null;
  human_reviewed: boolean;
  reviewer_notes: string | null;
  report_docx_path: string | null;
  report_pdf_path: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Document Fetchers ───────────────────────────────────────────────────────

export async function fetchProspectDocuments(prospectId: string) {
  return cloudRunFetch<{ count: number; data: ProspectDocument[] }>(
    `/api/compliance/prospects/${prospectId}/documents`
  );
}

export async function fetchDocument(documentId: number) {
  return cloudRunFetch<ProspectDocument>(
    `/api/compliance/documents/${documentId}`
  );
}

export async function createDocument(
  prospectId: string,
  data: Partial<ProspectDocument>
) {
  return cloudRunMutate<ProspectDocument>(
    `/api/compliance/prospects/${prospectId}/documents`,
    "POST",
    data
  );
}

export async function updateDocument(
  documentId: number,
  data: Partial<ProspectDocument>
) {
  return cloudRunMutate<ProspectDocument>(
    `/api/compliance/documents/${documentId}`,
    "PUT",
    data
  );
}

export async function deleteDocument(documentId: number) {
  return cloudRunMutate<{ deleted: boolean }>(
    `/api/compliance/documents/${documentId}`,
    "DELETE"
  );
}

// ─── Analysis Fetchers ───────────────────────────────────────────────────────

export async function fetchProspectAnalysis(
  prospectId: string,
  filters?: { jurisdiction?: string; severity?: string; category?: string }
) {
  const params = new URLSearchParams();
  if (filters?.jurisdiction) params.set("jurisdiction", filters.jurisdiction);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.category) params.set("category", filters.category);
  const qs = params.toString();

  return cloudRunFetch<{ count: number; data: AnalysisFinding[] }>(
    `/api/compliance/prospects/${prospectId}/analysis${qs ? `?${qs}` : ""}`
  );
}

export async function createAnalysisFinding(
  prospectId: string,
  data: Partial<AnalysisFinding>
) {
  return cloudRunMutate<AnalysisFinding>(
    `/api/compliance/prospects/${prospectId}/analysis`,
    "POST",
    data
  );
}

export async function updateAnalysisFinding(
  findingId: number,
  data: Partial<AnalysisFinding>
) {
  return cloudRunMutate<AnalysisFinding>(
    `/api/compliance/analysis/${findingId}`,
    "PUT",
    data
  );
}

// ─── Assessment Fetchers ─────────────────────────────────────────────────────

export async function fetchProspectAssessments(prospectId: string) {
  return cloudRunFetch<{ count: number; data: ProspectAssessment[] }>(
    `/api/compliance/prospects/${prospectId}/assessments`
  );
}

export async function fetchAssessment(assessmentId: number) {
  return cloudRunFetch<ProspectAssessment>(
    `/api/compliance/assessments/${assessmentId}`
  );
}

export async function createAssessment(
  prospectId: string,
  data: Partial<ProspectAssessment>
) {
  return cloudRunMutate<ProspectAssessment>(
    `/api/compliance/prospects/${prospectId}/assessments`,
    "POST",
    data
  );
}

export async function updateAssessment(
  assessmentId: number,
  data: Partial<ProspectAssessment>
) {
  return cloudRunMutate<ProspectAssessment>(
    `/api/compliance/assessments/${assessmentId}`,
    "PUT",
    data
  );
}

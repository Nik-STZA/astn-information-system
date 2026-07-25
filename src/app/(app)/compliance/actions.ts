"use server";

import {
  createProspect,
  updateProspect,
  deleteProspect,
  createClient,
  updateClient,
  createActivity,
  fetchProspects,
  fetchClients,
  fetchProspectDocuments,
  fetchProspectAnalysis,
  fetchProspectAssessments,
} from "@/lib/data/compliance";
import type {
  ProspectDocument,
  AnalysisFinding,
  ProspectAssessment,
} from "@/lib/data/compliance";
import { cloudRunMutate } from "@/lib/cloud-run";
import { revalidatePath } from "next/cache";

// ─── Prospect actions ───────────────────────────────────────────────────────

export async function addProspect(formData: FormData) {
  const data = {
    company_name: formData.get("company_name") as string,
    company_website: (formData.get("company_website") as string) || null,
    company_country: (formData.get("company_country") as string) || null,
    sector: (formData.get("sector") as string) || null,
    sa_presence_evidence:
      (formData.get("sa_presence_evidence") as string) || null,
    ir_registered: formData.get("ir_registered") === "true" ? true : formData.get("ir_registered") === "false" ? false : null,
    outreach_status: (formData.get("outreach_status") as string) || "identified",
    priority: (formData.get("priority") as string) || "medium",
    estimated_tier: (formData.get("estimated_tier") as string) || null,
    notes: (formData.get("notes") as string) || null,
    privacy_policy_url: (formData.get("privacy_policy_url") as string) || null,
    terms_url: (formData.get("terms_url") as string) || null,
    linkedin_url: (formData.get("linkedin_url") as string) || null,
    app_store_url: (formData.get("app_store_url") as string) || null,
    other_urls: (formData.get("other_urls") as string) || null,
  };

  const res = await createProspect(data);
  revalidatePath("/compliance");
  return res;
}

export async function editProspect(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  const fields = [
    "company_name", "company_website", "company_country", "sector",
    "sa_presence_evidence", "outreach_status", "priority", "estimated_tier",
    "notes", "outreach_date", "outreach_channel", "response_date",
    "privacy_policy_url", "terms_url", "linkedin_url", "app_store_url", "other_urls",
  ];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("ir_registered")) {
    const v = formData.get("ir_registered") as string;
    data.ir_registered = v === "true" ? true : v === "false" ? false : null;
  }

  const res = await updateProspect(id, data);
  revalidatePath("/compliance");
  return res;
}

export async function removeProspect(id: string) {
  const res = await deleteProspect(id);
  revalidatePath("/compliance");
  return res;
}


/** Save IR verification results for a prospect. */
export async function verifyIRStatus(id: string, formData: FormData) {
  const irRegistered = formData.get("ir_registered") as string;
  const data: Record<string, unknown> = {
    ir_registered: irRegistered === "true" ? true : irRegistered === "false" ? false : null,
    ir_verified_date: (formData.get("ir_verified_date") as string) || new Date().toISOString().slice(0, 10),
    ir_verification_method: "manual_portal",
    ir_verification_notes: (formData.get("ir_verification_notes") as string) || null,
    ir_entity_name: (formData.get("ir_entity_name") as string) || null,
    ir_registration_no: (formData.get("ir_registration_no") as string) || null,
    ir_io_name: (formData.get("ir_io_name") as string) || null,
    ir_io_designation: (formData.get("ir_io_designation") as string) || null,
    ir_registration_date: (formData.get("ir_registration_date") as string) || null,
    ir_organisation_type: (formData.get("ir_organisation_type") as string) || null,
  };

  const res = await updateProspect(id, data);
  revalidatePath("/compliance");
  return res;
}
// ─── Client actions ─────────────────────────────────────────────────────────

/**
 * One-click prospect → client conversion. Creates the client row LINKED to
 * the prospect (prospect_id, migration 016) with company details and IR
 * verification carried over, marks the prospect converted, and returns the
 * new client. Guards against double-conversion.
 */
export async function convertProspectToClient(prospectId: string) {
  const [prospectsRes, clientsRes] = await Promise.all([fetchProspects(), fetchClients()]);
  const prospect = prospectsRes.data?.data?.find((p) => String(p.id) === String(prospectId));
  if (!prospect) {
    return { data: null, error: "Prospect not found" };
  }
  const existing = clientsRes.data?.data?.find(
    (c) => String(c.prospect_id ?? "") === String(prospectId)
  );
  if (existing) {
    return { data: existing, error: null, alreadyConverted: true as const };
  }

  const res = await createClient({
    prospect_id: prospect.id,
    company_name: prospect.company_name,
    company_website: prospect.company_website ?? null,
    company_country: prospect.company_country ?? null,
    status: "engaged",
    service_tier: prospect.estimated_tier ?? null,
    ir_registration_number: prospect.ir_registration_no ?? null,
    ir_registration_date: prospect.ir_registration_date ?? null,
    io_appointed: prospect.ir_io_name ?? null,
    notes: prospect.notes ?? null,
  });

  if (!res.error) {
    await updateProspect(String(prospect.id), { outreach_status: "converted" });
    revalidatePath("/clients");
    revalidatePath("/compliance");
  }
  return res;
}

export async function addClient(formData: FormData) {
  const data = {
    company_name: formData.get("company_name") as string,
    company_website: (formData.get("company_website") as string) || null,
    company_country: (formData.get("company_country") as string) || null,
    contact_name: (formData.get("contact_name") as string) || null,
    contact_email: (formData.get("contact_email") as string) || null,
    contact_role: (formData.get("contact_role") as string) || null,
    status: (formData.get("status") as string) || "prospect",
    service_tier: (formData.get("service_tier") as string) || null,
    annual_fee_gbp: formData.get("annual_fee_gbp")
      ? Number(formData.get("annual_fee_gbp"))
      : null,
    engagement_start: (formData.get("engagement_start") as string) || null,
    processes_biometric: formData.get("processes_biometric") === "true",
    processes_minors: formData.get("processes_minors") === "true",
    notes: (formData.get("notes") as string) || null,
  };

  const res = await createClient(data);
  revalidatePath("/compliance");
  return res;
}

export async function editClient(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  const fields = [
    "company_name", "company_website", "company_country",
    "contact_name", "contact_email", "contact_role",
    "status", "service_tier", "notes", "engagement_start",
  ];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("annual_fee_gbp")) {
    const v = formData.get("annual_fee_gbp") as string;
    data.annual_fee_gbp = v ? Number(v) : null;
  }
  if (formData.has("processes_biometric")) {
    data.processes_biometric = formData.get("processes_biometric") === "true";
  }
  if (formData.has("processes_minors")) {
    data.processes_minors = formData.get("processes_minors") === "true";
  }

  const res = await updateClient(id, data);
  revalidatePath("/compliance");
  return res;
}

// ─── Activity actions ───────────────────────────────────────────────────────

export async function addActivity(formData: FormData) {
  const data = {
    client_id: formData.get("client_id") as string,
    activity_date: (formData.get("activity_date") as string) || undefined,
    activity_type: formData.get("activity_type") as string,
    description: (formData.get("description") as string) || null,
    hours_spent: formData.get("hours_spent")
      ? Number(formData.get("hours_spent"))
      : null,
    performed_by: (formData.get("performed_by") as string) || null,
    next_due: (formData.get("next_due") as string) || null,
  };

  const res = await createActivity(data);
  revalidatePath("/compliance");
  return res;
}

// ─── Agent pipeline actions ─────────────────────────────────────────────────

export type PipelineStageResult = {
  status: number;
  [key: string]: unknown;
};

export type PipelineResult = {
  prospect_id: string;
  pipeline_status: string;
  stages: {
    ingest?: PipelineStageResult;
    analyse?: PipelineStageResult;
    assess?: PipelineStageResult;
  };
  elapsed_seconds?: number;
};

/** Ingest documents for a prospect (fetch URLs, convert to markdown, store). */
export async function ingestProspectDocuments(prospectId: string) {
  const res = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/prospects/${prospectId}/ingest`,
    "POST"
  );
  revalidatePath("/compliance");
  return res;
}

/** Run POPIA compliance analysis on stored documents. */
export async function analyseProspect(prospectId: string) {
  const res = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/prospects/${prospectId}/analyse`,
    "POST"
  );
  revalidatePath("/compliance");
  return res;
}

/** Generate scored assessment from analysis findings. */
export async function assessProspect(prospectId: string) {
  const res = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/prospects/${prospectId}/assess`,
    "POST"
  );
  revalidatePath("/compliance");
  return res;
}

/** Run the full pipeline: ingest -> analyse -> assess. */
export async function runProspectPipeline(
  prospectId: string,
  options?: { skip_ingest?: boolean },
) {
  const res = await cloudRunMutate<PipelineResult>(
    `/api/compliance/prospects/${prospectId}/run-pipeline`,
    "POST",
    options,
  );
  revalidatePath("/compliance");
  return res;
}

// ─── Pipeline result fetchers (server actions for client components) ────────

export async function getProspectDocuments(prospectId: string) {
  return fetchProspectDocuments(prospectId);
}

export async function getProspectAnalysis(prospectId: string) {
  return fetchProspectAnalysis(prospectId);
}

export async function getProspectAssessments(prospectId: string) {
  return fetchProspectAssessments(prospectId);
}

/** Fetch all pipeline results for a prospect in one call. */
export async function getProspectPipelineResults(prospectId: string) {
  const [docs, findings, assessments] = await Promise.all([
    fetchProspectDocuments(prospectId),
    fetchProspectAnalysis(prospectId),
    fetchProspectAssessments(prospectId),
  ]);
  return {
    documents: docs.data?.data ?? [] as ProspectDocument[],
    findings: findings.data?.data ?? [] as AnalysisFinding[],
    assessment: (assessments.data?.data ?? [] as ProspectAssessment[])
      .filter((a) => !a.superseded_at)[0] ?? null,
    errors: [docs.error, findings.error, assessments.error].filter(Boolean),
  };
}

// ─── V2 Multi-jurisdiction pipeline actions ─────────────────────────────────

import {
  fetchJurisdictions,
  fetchJurisdictionDetail,
  fetchJurisdictionRequirements,
  fetchClientDocumentsV2,
  fetchClientAssessmentsV2,
  fetchClientEvidenceV2,
} from "@/lib/data/compliance";
import type {
  ComplianceDocumentV2,
  ComplianceAssessmentV2,
  ComplianceEvidenceV2,
} from "@/lib/data/compliance";

/** List active jurisdictions with domain/requirement counts. */
export async function getJurisdictions() {
  return fetchJurisdictions();
}

/** Get jurisdiction detail — domains, requirement/keyword counts. */
export async function getJurisdictionDetail(id: number) {
  return fetchJurisdictionDetail(id);
}

/** Get all requirements for a jurisdiction with keywords. */
export async function getJurisdictionRequirements(id: number) {
  return fetchJurisdictionRequirements(id);
}

/** Ingest documents for a compliance client (V2 engine). */
export async function ingestClientDocuments(
  clientId: string,
  urls: Array<{ url: string; document_type: string; title?: string }>
) {
  const res = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/clients/${clientId}/documents/ingest`,
    "POST",
    { urls }
  );
  revalidatePath("/compliance");
  return res;
}

/** Extract evidence from documents against a jurisdiction (V2 engine). */
export async function analyseClientV2(
  clientId: string,
  jurisdictionId: number,
  documentIds?: number[]
) {
  const body: Record<string, unknown> = { jurisdiction_id: jurisdictionId };
  if (documentIds && documentIds.length > 0) {
    body.document_ids = documentIds;
  }
  const res = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/clients/${clientId}/analyse`,
    "POST",
    body
  );
  revalidatePath("/compliance");
  return res;
}

/** Generate scored assessment from evidence (V2 engine). */
export async function assessClientV2(
  clientId: string,
  jurisdictionId: number,
  options?: { engagement_id?: number; assessment_type?: string }
) {
  const res = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/clients/${clientId}/assess`,
    "POST",
    { jurisdiction_id: jurisdictionId, ...options }
  );
  revalidatePath("/compliance");
  return res;
}

/**
 * Run the substance-reading dual-model assessment: Gemini + Claude READ the client's ingested
 * documents and judge each requirement present/partial/absent with a verified verbatim quote,
 * then adjudicate (disagreement → conservative status, flagged for review). Deeper and
 * token-costing vs the keyword pipeline; reads documents already ingested for the client.
 */
export async function assessClientDualModel(clientId: string, jurisdictionId: number) {
  const res = await cloudRunMutate<{
    assessment_id: number;
    jurisdiction: string;
    overall_score: number;
    confidence_level: string;
    requirements: number;
    needs_review: number;
    disagreements: number;
  }>(`/api/v2/clients/${clientId}/assessments/dual-model`, "POST", {
    jurisdiction_id: jurisdictionId,
  });
  revalidatePath("/compliance");
  return res;
}

/** Run the full V2 pipeline: ingest → analyse → assess. */
export async function runClientPipelineV2(
  clientId: string,
  jurisdictionId: number,
  urls: Array<{ url: string; document_type: string; title?: string }>
) {
  const results: {
    ingest?: PipelineStageResult;
    analyse?: PipelineStageResult;
    assess?: PipelineStageResult;
    error?: string;
  } = {};

  // Step 1: Ingest documents
  if (urls.length > 0) {
    const ingestRes = await cloudRunMutate<PipelineStageResult>(
      `/api/compliance/clients/${clientId}/documents/ingest`,
      "POST",
      { urls }
    );
    if (ingestRes.error) {
      revalidatePath("/compliance");
      return { ...results, ingest: ingestRes.data, error: ingestRes.error };
    }
    results.ingest = ingestRes.data ?? undefined;
  }

  // Step 2: Extract evidence
  const analyseRes = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/clients/${clientId}/analyse`,
    "POST",
    { jurisdiction_id: jurisdictionId }
  );
  if (analyseRes.error) {
    revalidatePath("/compliance");
    return { ...results, analyse: analyseRes.data, error: analyseRes.error };
  }
  results.analyse = analyseRes.data ?? undefined;

  // Step 3: Build assessment
  const assessRes = await cloudRunMutate<PipelineStageResult>(
    `/api/compliance/clients/${clientId}/assess`,
    "POST",
    { jurisdiction_id: jurisdictionId }
  );
  results.assess = assessRes.data ?? undefined;
  if (assessRes.error) {
    revalidatePath("/compliance");
    return { ...results, error: assessRes.error };
  }

  revalidatePath("/compliance");
  return results;
}

/** Fetch V2 pipeline results for a client. */
export async function getClientPipelineResultsV2(clientId: string) {
  const [docs, assessments, evidence] = await Promise.all([
    fetchClientDocumentsV2(clientId),
    fetchClientAssessmentsV2(clientId),
    fetchClientEvidenceV2(clientId),
  ]);
  return {
    documents: (docs.data?.data ?? []) as ComplianceDocumentV2[],
    assessments: (assessments.data?.data ?? []) as ComplianceAssessmentV2[],
    latestAssessment: ((assessments.data?.data ?? []) as ComplianceAssessmentV2[])
      .filter((a) => a.status === "completed")[0] ?? null,
    evidence: (evidence.data?.data ?? []) as ComplianceEvidenceV2[],
    errors: [docs.error, assessments.error, evidence.error].filter(Boolean),
  };
}

/**
 * Data fetching functions for Remediation and Audit Trail module.
 * Consumes: /api/remediation, /api/clients/:id/remediation, /api/audit, /api/clients/:id/audit
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RemediationItem = {
  id: number;
  client_id: string;
  prospect_id: string | null;
  assessment_id: number | null;
  finding_id: number | null;
  category: string;
  title: string;
  description: string | null;
  severity: string;
  popia_reference: string | null;
  recommendation: string | null;
  status: string;
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
  // Joined fields
  client_name?: string;
};

export type AuditEntry = {
  id: number;
  client_id: string | null;
  prospect_id: string | null;
  entity_type: string;
  entity_id: number | null;
  action: string;
  description: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  performed_by: string;
  performed_at: string;
  metadata: Record<string, unknown>;
  // Joined fields
  client_name?: string;
};

export type RemediationSummary = {
  by_status: { status: string; count: number }[];
  open_by_severity: { severity: string; count: number }[];
  overdue_count: number;
  by_client: {
    id: string;
    company_name: string;
    total_items: number;
    open_items: number;
    resolved_items: number;
  }[];
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchRemediationItems(filters?: {
  status?: string;
  severity?: string;
  client_id?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.client_id) params.set("client_id", filters.client_id);
  const qs = params.toString();
  return cloudRunFetch<{ count: number; data: RemediationItem[] }>(
    `/api/remediation${qs ? `?${qs}` : ""}`
  );
}

export async function fetchClientRemediation(clientId: string) {
  return cloudRunFetch<{ count: number; data: RemediationItem[] }>(
    `/api/clients/${clientId}/remediation`
  );
}

export async function fetchRemediationItem(id: number) {
  return cloudRunFetch<RemediationItem>(`/api/remediation/${id}`);
}

export async function fetchClientAudit(clientId: string, limit = 200) {
  return cloudRunFetch<{ count: number; data: AuditEntry[] }>(
    `/api/clients/${clientId}/audit?limit=${limit}`
  );
}

export async function fetchAuditLog(filters?: {
  client_id?: string;
  entity_type?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.client_id) params.set("client_id", filters.client_id);
  if (filters?.entity_type) params.set("entity_type", filters.entity_type);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return cloudRunFetch<{ count: number; data: AuditEntry[] }>(
    `/api/audit${qs ? `?${qs}` : ""}`
  );
}

export async function fetchRemediationSummary() {
  return cloudRunFetch<RemediationSummary>("/api/remediation/summary");
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function updateRemediationItem(
  id: number,
  data: Partial<RemediationItem> & { _performed_by?: string }
) {
  return cloudRunMutate<RemediationItem>(
    `/api/remediation/${id}`,
    "PUT",
    data
  );
}

export async function addRemediationNote(
  id: number,
  note: string,
  performed_by = "nik@stza.io"
) {
  return cloudRunMutate<{ logged: boolean }>(
    `/api/remediation/${id}/note`,
    "POST",
    { note, performed_by }
  );
}

export async function generateRemediation(
  clientId: string,
  prospectId: string,
  assessmentId?: number,
  performed_by = "nik@stza.io"
) {
  return cloudRunMutate<{
    count: number;
    data: RemediationItem[];
    skipped_compliant: number;
  }>(`/api/clients/${clientId}/remediation/generate`, "POST", {
    prospect_id: prospectId,
    assessment_id: assessmentId,
    performed_by,
  });
}

/**
 * Data fetching functions for Compliance module.
 * Consumes: /api/compliance/prospects, /api/compliance/clients, /api/compliance/activities.
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Prospect = {
  id: number;
  company_name: string;
  company_website: string | null;
  company_country: string | null;
  sector: string | null;
  sa_presence_evidence: string | null;
  ir_registered: boolean | null;
  outreach_status: string;
  priority: string;
  estimated_tier: string | null;
  notes: string | null;
  outreach_date: string | null;
  outreach_channel: string | null;
  response_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Client = {
  id: number;
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
  client_id: number;
  activity_date: string;
  activity_type: string;
  description: string | null;
  hours_spent: number | null;
  performed_by: string | null;
  next_due: string | null;
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

// ─── Mutations (called from route handlers / server actions) ─────────────────

export async function createProspect(data: Partial<Prospect>) {
  return cloudRunMutate<Prospect>("/api/compliance/prospects", "POST", data);
}

export async function updateProspect(id: number, data: Partial<Prospect>) {
  return cloudRunMutate<Prospect>(
    `/api/compliance/prospects/${id}`,
    "PUT",
    data
  );
}

export async function deleteProspect(id: number) {
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

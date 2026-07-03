/**
 * Data fetching for BD Pipeline module.
 * Consumes: /api/bd/pipeline, /api/bd/interactions, /api/dashboard/stats.
 */

import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PipelineOpportunity = {
  id: number;
  prospect_id: number | null;
  client_id: number | null;
  prospect_name: string | null;
  client_name: string | null;
  opportunity_name: string;
  service_type: string | null;
  stage: string;
  value_gbp: number | null;
  value_recurring: boolean | null;
  expected_close_date: string | null;
  owner: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Interaction = {
  id: number;
  pipeline_id: number | null;
  prospect_id: number | null;
  interaction_date: string;
  channel: string | null;
  direction: string;
  summary: string | null;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
};

export type DashboardStats = {
  prospects: {
    total: number;
    high_priority: number;
    identified: number;
    contacted: number;
    responded: number;
    converted: number;
  };
  clients: {
    total: number;
    active: number;
    arr: number;
  };
  pipeline: {
    total: number;
    total_value: number;
    active_value: number;
    won: number;
  };
  content: {
    total: number;
    published: number;
    in_progress: number;
  };
  prospectsByStatus: Array<{ outreach_status: string; count: number }>;
  prospectsBySector: Array<{ sector: string; count: number }>;
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchPipeline() {
  return cloudRunFetch<{ count: number; data: PipelineOpportunity[] }>(
    "/api/bd/pipeline"
  );
}

export async function fetchInteractions(pipelineId?: number) {
  const path = pipelineId
    ? `/api/bd/interactions?pipeline_id=${pipelineId}`
    : "/api/bd/interactions";
  return cloudRunFetch<{ count: number; data: Interaction[] }>(path);
}

export async function fetchDashboardStats() {
  return cloudRunFetch<DashboardStats>("/api/dashboard/stats");
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createOpportunity(data: Partial<PipelineOpportunity>) {
  return cloudRunMutate<PipelineOpportunity>(
    "/api/bd/pipeline",
    "POST",
    data
  );
}

export async function updateOpportunity(
  id: number,
  data: Partial<PipelineOpportunity>
) {
  return cloudRunMutate<PipelineOpportunity>(
    `/api/bd/pipeline/${id}`,
    "PUT",
    data
  );
}

export async function createInteraction(data: Partial<Interaction>) {
  return cloudRunMutate<Interaction>("/api/bd/interactions", "POST", data);
}

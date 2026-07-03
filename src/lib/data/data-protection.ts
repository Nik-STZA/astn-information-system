/**
 * Data fetching functions for Data Protection module.
 * Consumes the Cloud Run API endpoints: /api/countries, /api/maturity, /api/enforcement.
 */

import { cloudRunFetch } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Country = {
  id: number;
  country_name: string;
  country_code: string;
  region: string;
  has_dp_law: boolean;
  law_name: string | null;
  law_status: string | null;
  law_year: number | null;
  authority_name: string | null;
  authority_website: string | null;
  data_transfer_mechanism: string | null;
  breach_notification_required: boolean | null;
  breach_notification_hours: number | null;
  penalties_description: string | null;
  max_penalty_description: string | null;
  notes: string | null;
  overall_score: number | null;
  tier: string | null;
  methodology_version: string | null;
};

export type MaturityRow = {
  country_name: string;
  has_dp_law: boolean;
  law_status: string | null;
  authority_name: string | null;
  overall_score: number | null;
  tier: string | null;
  regulatory_maturity: number | null;
  enforcement_activity: number | null;
  business_friendliness: number | null;
  cross_border_complexity: number | null;
  children_protections: number | null;
};

export type EnforcementAction = {
  id: number;
  country_id: number;
  country_name: string;
  action_date: string | null;
  action_type: string;
  description: string;
  penalty_amount: number | null;
  penalty_currency: string | null;
  entity_involved: string | null;
  source_url: string | null;
};

// ─── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchCountries() {
  return cloudRunFetch<{ count: number; data: Country[] }>("/api/countries");
}

export async function fetchCountryDetail(id: number) {
  return cloudRunFetch<
    Country & {
      maturity_scores: Array<Record<string, unknown>>;
      enforcement_actions: EnforcementAction[];
      organization_count: number;
    }
  >(`/api/countries/${id}`);
}

export async function fetchMaturity() {
  return cloudRunFetch<{ count: number; data: MaturityRow[] }>("/api/maturity");
}

export async function fetchEnforcement() {
  return cloudRunFetch<{ count: number; data: EnforcementAction[] }>(
    "/api/enforcement"
  );
}

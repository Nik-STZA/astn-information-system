/**
 * Data fetching functions for Data Protection module.
 * Consumes the Cloud Run API endpoints: /api/countries, /api/maturity, /api/enforcement.
 */

import { cloudRunFetch } from "../cloud-run";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Country = {
  id: string;
  country_name: string;
  iso_code: string;
  has_dp_law: boolean;
  law_name: string | null;
  law_status: string | null;
  law_year: number | null;
  law_reference: string | null;
  authority_name: string | null;
  authority_operational: boolean | null;
  authority_website: string | null;
  breach_notification_hours: number | null;
  breach_notification_detail: string | null;
  max_fine_description: string | null;
  max_fine_local_amount: string | null;
  max_fine_local_currency: string | null;
  max_fine_turnover_pct: number | null;
  imprisonment_max_years: number | null;
  gdpr_alignment: string | null;
  data_localisation: string | null;
  children_provisions: string | null;
  children_age_threshold: number | null;
  transfer_mechanisms: string | null;
  dpo_requirement: string | null;
  registration_required: boolean | null;
  source_primary: string | null;
  notes: string | null;
  overall_score: number | null;
  tier: string | null;
  methodology_version: string | null;
};

export type MaturityRow = {
  country_name: string;
  iso_code: string;
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
  id: string;
  country_id: string;
  country_name: string;
  action_date: string | null;
  action_type: string;
  description: string;
  fine_amount: string | null;
  fine_currency: string | null;
  target_entity: string | null;
  target_sector: string | null;
  outcome: string | null;
  source_url: string | null;
  source_name: string | null;
  sports_tech_relevant: boolean;
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

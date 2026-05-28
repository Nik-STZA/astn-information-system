/**
 * Registry types and constants safe to import from client components.
 * No server-only imports (next/headers) — keep it pure.
 */

export type ConfidenceBand = "High" | "Medium" | "Medium-Low" | "Low";

export const CONFIDENCE_BANDS: ConfidenceBand[] = ["High", "Medium", "Medium-Low", "Low"];

export const REGISTRY_PAGE_SIZE = 50;

export type RegistryFilters = {
  country: string | null;
  sport: string | null;
  type: string | null;
  confidence: ConfidenceBand | null;
};

export type RegistryRow = {
  id: string;
  organization_name: string | null;
  country: string | null;
  sport: string | null;
  organization_type: string | null;
  source_confidence: string | null;
};

export type FilterOptions = {
  countries: string[];
  sports: string[];
  types: string[];
};

// Full organization row used by the detail page.
export type OrganizationDetail = {
  id: string;
  astn_id: string | null;
  organization_name: string | null;
  country: string | null;
  country_iso: string | null;
  sport: string | null;
  sport_code: string | null;
  region_province: string | null;
  level: string | null;
  organization_type: string | null;
  parent_national_body: string | null;
  continental_body: string | null;
  organization_website: string | null;
  national_body_website: string | null;
  status: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_media: string | null;
  notes: string | null;
  tags: string | null;
  data_source: string | null;
  last_updated: string | null;
  verification_source: string | null;
  verification_source_primary: string | null;
  verification_source_xref: string | null;
  verification_source_label: string | null;
  verification_date: string | null;
  source_confidence: string | null;
  partnership_type: string | null;
  commercial_priority: string | null;
  outreach_candidate: string | null;
  next_action: string | null;
  owner: string | null;
  review_date: string | null;
  astn_vertical: string | null;
  created_at: string | null;
  updated_at: string | null;
};

// Fields the edit form is allowed to write. Structural/denormalised fields
// (country, sport, country_iso, sport_code, level) are excluded - changing
// them without touching the matching ISO/code pair would create drift.
export const EDITABLE_FIELDS = [
  "organization_name",
  "organization_type",
  "status",
  "organization_website",
  "contact_email",
  "contact_phone",
  "social_media",
  "notes",
  "tags",
  "partnership_type",
  "commercial_priority",
  "outreach_candidate",
  "next_action",
  "owner",
  "review_date",
  "astn_vertical",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type UpdateResult =
  | { status: "idle" }
  | { status: "ok"; savedAt: number }
  | { status: "error"; message: string };

// source_confidence is a descriptive string ("High (via governing body listing)",
// "Medium-Low (Wikipedia)", etc.). Map to a band by prefix. Order matters:
// check "Medium-Low" before "Medium".
export function confidenceBand(value: string | null | undefined): ConfidenceBand | null {
  if (!value) return null;
  if (value.startsWith("High")) return "High";
  if (value.startsWith("Medium-Low")) return "Medium-Low";
  if (value.startsWith("Medium")) return "Medium";
  if (value.startsWith("Low")) return "Low";
  return null;
}

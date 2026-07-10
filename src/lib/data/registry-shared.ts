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
  q?: string | null;
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
// Identity fields (organization_name, astn_id) are also excluded - they come
// from the trusted upstream source and shouldn't be operator-editable in the
// standard flow.
export const EDITABLE_FIELDS = [
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
  "source_confidence",
  "verification_source",
  "verification_source_primary",
  "verification_source_xref",
  "verification_source_label",
  "verification_date",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

// Canonical controlled vocabularies for enumerated edit-form fields. Sourced
// from the distinct values in production with one-off junk pruned (see
// `project-registry-edit-form-known-gaps`). The form preserves any existing
// non-canonical row value by adding it as an extra option for that row.
export const CANONICAL_STATUS = [
  "Active",
  "Inactive",
  "Dormant",
  "Held for review",
  "Unverified",
] as const;

export const CANONICAL_VERTICALS = [
  "Performance",
  "Grassroots Participation",
  "Fan Engagement",
  "Broadcast",
] as const;

export const CANONICAL_PARTNERSHIP_TYPES = [
  "Federation/Governance",
  "Club",
  "National Team",
  "Academy/Development",
  "Facility",
  "League",
  "Media",
  "Startup/Tech",
  "Sponsor/Commercial",
  "Event",
  "Investor",
] as const;

export const CANONICAL_COMMERCIAL_PRIORITY = ["High", "Medium", "Low"] as const;

export const CANONICAL_OUTREACH_CANDIDATE = ["Yes", "Maybe", "No"] as const;

// Split a stored source_confidence string into its band and optional
// descriptor in parentheses. Returns nulls for an unrecognised band so the
// caller can fall back to free text or leave empty.
//
// "High (via governing body listing)" -> { band: "High", descriptor: "via governing body listing" }
// "Medium-Low"                        -> { band: "Medium-Low", descriptor: "" }
// "high (typo)"                       -> { band: null, descriptor: "" } - case-sensitive on purpose
export function parseSourceConfidence(value: string | null | undefined): {
  band: ConfidenceBand | null;
  descriptor: string;
} {
  if (!value) return { band: null, descriptor: "" };
  const match = value.match(/^(High|Medium-Low|Medium|Low)\s*(?:\(([^)]*)\))?\s*$/);
  if (!match) return { band: null, descriptor: "" };
  return {
    band: match[1] as ConfidenceBand,
    descriptor: (match[2] ?? "").trim(),
  };
}

// Compose the band + descriptor back into a single source_confidence string.
// Empty band -> null so the field gets cleared.
export function composeSourceConfidence(
  band: ConfidenceBand | null | "",
  descriptor: string,
): string | null {
  if (!band) return null;
  const trimmed = descriptor.trim();
  return trimmed ? `${band} (${trimmed})` : band;
}

export type UpdateResult =
  | { status: "idle" }
  | { status: "ok"; savedAt: number }
  | { status: "error"; message: string };

// One row from the organization_changes audit log, shaped for the UI.
export type OrganizationChange = {
  id: string;
  changedBy: string;
  changedAt: string;
  // Per-field diff: field name -> { old, new } values stringified for display.
  fields: Array<{ field: string; oldValue: string; newValue: string }>;
};

// Human-readable labels for editable / verification fields. Used by both the
// confirm modal and the change-history view so they stay consistent.
export const FIELD_LABELS: Record<string, string> = {
  organization_type: "Organisation type",
  status: "Status",
  astn_vertical: "AfricanSTN vertical",
  organization_website: "Organisation website",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  social_media: "Social media",
  partnership_type: "Partnership type",
  commercial_priority: "Commercial priority",
  outreach_candidate: "Outreach candidate",
  owner: "Owner",
  review_date: "Review date",
  tags: "Tags",
  notes: "Notes",
  next_action: "Next action",
  source_confidence: "Source confidence",
  verification_source: "Verification source",
  verification_source_primary: "Primary source",
  verification_source_xref: "Cross-reference",
  verification_source_label: "Source label",
  verification_date: "Verification date",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

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

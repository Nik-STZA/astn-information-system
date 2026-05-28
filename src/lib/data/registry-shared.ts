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

// Registry candidates: types and the paste parser, safe on client and server.
// finance-api checks everything again (finance-api/lib/registry-candidates.js).

export type CandidateStatus = "queued" | "reviewing" | "proposed" | "failed" | "approved" | "rejected" | "duplicate";

export const DECIDED: CandidateStatus[] = ["approved", "rejected", "duplicate"];
export type Verdict = "add" | "duplicate" | "reject";

export type CandidateSubmission = {
  name: string;
  website?: string | null;
  country?: string | null;
  sport?: string | null;
  note?: string | null;
};

export type Proposal = {
  organization_name?: string;
  country_iso?: string;
  country?: string;
  sport_code?: string;
  sport?: string;
  region_province?: string | null;
  level?: string;
  organization_type?: string;
  astn_vertical?: string;
  astn_sub_vertical?: string | null;
  organization_website?: string | null;
  founded_year?: number | null;
  operational_status?: string;
  business_model?: string | null;
  source_confidence?: string;
  verification_source?: string;
  tags?: string | null;
  notes?: string;
};

export type Candidate = {
  id: string;
  submitted_name: string;
  submitted_website: string | null;
  submitted_country: string | null;
  submitted_sport: string | null;
  submitted_note: string | null;
  submitted_by: string;
  submitted_at: string;
  status: CandidateStatus;
  agent_run_id: string | null;
  verdict: Verdict | null;
  verdict_reason: string | null;
  proposal: Proposal | null;
  evidence: Array<{ url: string; finding: string }>;
  duplicates: Array<{ organization_id?: string; astn_id: string; organization_name: string; why?: string; score?: number }>;
  reviewed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  organization_id: string | null;
  astn_id: string | null;
};

export type RegistryReference = {
  countries: Array<{ iso_code: string; name: string }>;
  sports: Array<{ code: string; name: string }>;
  levels: string[];
  organization_types: string[];
  verticals: string[];
  operational_statuses: string[];
  confidence_bands: string[];
};

export type ActionResult =
  | { status: "idle" }
  | { status: "ok"; message: string; at: number }
  | { status: "error"; message: string; errors?: string[]; canOverride?: boolean; at: number };

export const MAX_BATCH = 25;

const LOOKS_LIKE_SITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

// One organisation per line. Either "Name | website | country | sport | note"
// (tabs work too, so a spreadsheet column pastes in), or just a name with an
// optional website at the end: "Acme Sports acme.co.za".
export function parseCandidateLines(text: string): { values: CandidateSubmission[]; error?: string } {
  const values: CandidateSubmission[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/[|\t]/.test(line)) {
      // Split on each separator, then trim: a pattern that swallowed spaces
      // around a separator would also swallow an empty tab-separated cell.
      const [name, website, country, sport, ...rest] = line.split(/[|\t]/).map((s) => s.trim());
      if (!name?.trim()) return { values, error: `"${line}" has no name before the first |` };
      values.push({
        name: name.trim(),
        website: website?.trim() || null,
        country: country?.trim() || null,
        sport: sport?.trim() || null,
        note: rest.join(" | ").trim() || null,
      });
      continue;
    }
    const words = line.split(/\s+/);
    const last = words[words.length - 1];
    if (words.length > 1 && LOOKS_LIKE_SITE.test(last)) {
      values.push({ name: words.slice(0, -1).join(" "), website: last });
    } else {
      values.push({ name: line });
    }
  }
  if (values.length > MAX_BATCH) return { values: [], error: `At most ${MAX_BATCH} at a time; that was ${values.length}.` };
  return { values };
}

// Only ordinary web links are rendered as links.
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const STATUS_LABEL: Record<CandidateStatus, string> = {
  queued: "Waiting for reviewer",
  reviewing: "Reviewer working",
  proposed: "Ready for you",
  failed: "Review failed",
  approved: "Added",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  add: "Recommends adding",
  duplicate: "Already in registry",
  reject: "Recommends rejecting",
};

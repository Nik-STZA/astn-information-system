// Reconciliations: the portal side of finance-api's rec routes. Server-only
// fetches are at the bottom; the rest is pure, so it is tested and safe on
// either side. All the rules live in finance-api (lib/recs.js).

export type RecStatus = "not_started" | "in_progress" | "with_fc" | "with_cfo" | "signed_off" | "sent_back";
export type Proof = "schedule" | "outside_evidence" | "ledger_review";

export interface RecRow {
  id: string;
  account_name: string;
  codes: string[];
  line: string | null;
  line_key: string | null;
  placed: boolean;
  proof: Proof;
  status: RecStatus;
  owner: string | null;
  challenge: string | null;
  class: "M" | "J" | null;
  with: string | null;
  ledger: string | null;
  support: string | null;
  difference: string | null;
  ties: boolean;
  mixed_currency: boolean;
  sole_reviewer: boolean;
  recheck_reason: string | null;
  workable: boolean;
  companies: number;
  prior_status: RecStatus | null;
}

export interface EntityError { entity_id: string; entity: string; error: string }

export interface RecList {
  period: string;
  label: string;
  prior: { period: string; label: string; open: boolean };
  tolerance?: string;
  composed_at?: string | null;
  entity_errors: EntityError[];
  notes: string[];
  complete?: boolean;
  migration_missing?: boolean;
  entities: Array<{ id: string; slug: string; name: string }>;
  counts: { total: number; signed_off: number; recheck: number };
  lines: Array<{ key: string; line: string }>;
  recs: RecRow[];
}

export interface CoverRow {
  entity_id: string;
  entity: string;
  code: string | null;
  gl_name: string;
  comment: string | null;
  opening: string;
  gl: string;
  schedule: string | null;
  variance: string | null;
  ties: boolean | null;
  currency: string | null;
  no_ledger: boolean;
}

export interface ScheduleItem {
  id: string;
  entity_id: string;
  entity_name: string;
  item_no: number;
  supplier: string;
  description: string | null;
  pl_account_code: string;
  invoice_ref: string | null;
  invoice_date: string | null;
  total_cost: string;
  service_start: string | null;
  service_end: string | null;
  amort_commenced: string | null;
  treatment: "amortise" | "held";
  ended_period: string | null;
  document_ref: string | null;
  note: string | null;
  months: number;
  monthly: string;
  released: string;
  balance: string;
  this_month: string;
  first: string | null;
  last: string | null;
  by_month: Record<string, string>;
}

export interface RecJournal {
  id: string;
  /** JNL-7: the number a person and an agent both use. */
  jnl?: string | null;
  entity_id: string;
  entity_name: string;
  state: "proposed" | "approved" | "draft_created" | "posted" | "rejected" | "superseded";
  xero_status?: string | null;
  journal_date: string;
  narration: string;
  lines: Array<{ account_code: string; description?: string; amount: number }>;
  reason: string | null;
  proposed_by: string;
  approved_by: string | null;
  xero_journal_no: string | null;
  created_at: string;
  retry_state: "go" | "live" | "drafted" | "retry" | "unknown" | null;
  can_retry: boolean;
}

export interface EntityChecks {
  entity_id: string;
  entity: string;
  error?: string;
  missing?: number;
  in_draft?: number;
  items?: Array<{ item_id: string; supplier: string; expected: number; journal: "posted" | "draft" | "missing" | "none_due"; combined: boolean; months_left: number | null }>;
  warnings?: Array<{ item_id: string; kind: "ending" | "overrun"; text: string }>;
}

// What the last checks did about the monthly release, per company.
export interface ReleaseOutcome {
  entity_id: string;
  entity: string;
  state: "proposed" | "kept" | "none" | "skipped" | "withdrawn";
  why: string;
  id?: string;
  total?: string;
  item_id?: string;
  supplier?: string | null;
}

// Evidence on a rec proved by outside evidence or a ledger review (10 Nov 2026).
export interface RecEvidenceRow {
  id: string | null; entity_id: string; entity: string; kind: string | null; amount: string | null; source: string;
  document_ref: string | null; note: string | null; method: string | null; added_by: string | null; added_at: string | null;
}
export interface RecEvidence {
  method: "ageing_ar" | "ageing_ap" | "counterpart" | "carry_forward" | null;
  method_label: string | null;
  missing: string[];
  rows: RecEvidenceRow[];
  counterpart: { rec_account_id: string; account_name?: string; entity?: string; closing?: string | null; missing?: boolean } | null;
  candidates: Array<{ rec_account_id: string; account_name: string; entity_id: string; entity: string; difference: string }>;
}

export interface RecDetail {
  rec: {
    id: string; account_name: string; period: string; period_end: string; label: string; status: RecStatus;
    owner: string | null; challenge: string | null; class: "M" | "J" | null; artefact: string | null; proof: Proof;
    line: string | null; line_key: string | null; with: string | null; preparer_note: string | null; review_note: string | null;
    prepared_by: string | null; prepared_at: string | null; reviewed_by: string | null; reviewed_at: string | null;
    signed_off_by: string | null; signed_off_at: string | null; recheck_reason: string | null; recheck_at: string | null;
    checks_at: string | null; workable: boolean; sole_reviewer: boolean; shown_as_signed: boolean; signed_before: number;
    /** A difference the CFO signed off without a journal, with the reason. */
    accepted_variance?: { reason: string; by: string; group: string | null; by_company: Array<{ entity_id: string; entity: string; variance: string | null; currency: string | null }> } | null;
  };
  releases?: {
    on: boolean; by: string | null; at: string | null;
    journals: Array<{ id: string; jnl?: string | null; entity_id: string; entity_name: string; item_id: string | null; supplier: string | null; item_no: number | null; state: "proposed" | "approved" | "draft_created" | "posted" | "rejected"; journal_date: string; total: string; xero_journal_no: string | null; last_error: string | null }>;
  };
  agent_run: {
    id: string; status: string; queued_at: string; started_at: string | null; finished_at: string | null;
    error: string | null; output: string | null; live: boolean;
  } | null;
  tolerance: string;
  evidence?: RecEvidence | null;
  cover: { rows: CoverRow[]; group: { gl: string | null; schedule: string | null; variance: string | null }; ties: boolean; mixed_currency: boolean };
  schedule: { months: string[]; items: ScheduleItem[] };
  checks: { at: string; note: string; entities: EntityChecks[]; releases?: ReleaseOutcome[] } | null;
  journals: RecJournal[];
  events: Array<{ at: string; actor: string; action: string; detail: Record<string, unknown> }>;
  prior: { status: RecStatus | null; label: string; recheck: boolean; opening_agrees: boolean | null };
  entities: Array<{ id: string; slug: string; name: string }>;
  lines: Array<{ key: string; line: string }>;
}

export const STATUS_LABEL: Record<RecStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  with_fc: "Needs review",
  with_cfo: "Needs sign-off",
  signed_off: "Signed off",
  sent_back: "Sent back",
};

export const PROOF_LABEL: Record<Proof, string> = {
  schedule: "Schedule",
  outside_evidence: "Outside evidence",
  ledger_review: "Ledger review",
};

// A signed figure as an accountant reads it: credits in brackets.
export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const s = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthLabel(period: string): string {
  const d = new Date(`${period}-01T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function periodLong(period: string): string {
  const d = new Date(`${period}-01T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// The month a close is usually on: the last complete month.
export function defaultPeriod(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

// The last few months, newest first, for the month picker.
export function periodChoices(current: string, count = 6, today = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  if (!out.includes(current)) out.unshift(current);
  return out;
}

export const isPeriod = (p: string | undefined | null) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p ?? ""));

// The list reads the trial balance again on opening when it is this old, so a
// moved figure is noticed without anyone having to ask.
export const STALE_MINUTES = 60;

export function isStale(composedAt: string | null | undefined, now = Date.now()): boolean {
  if (!composedAt) return true;
  return now - Date.parse(composedAt) > STALE_MINUTES * 60_000;
}

export const EVENT_LABEL: Record<string, string> = {
  composed: "Added from the trial balance",
  recheck: "Marked to re-check",
  placed: "Placed on the matrix",
  comment: "Comment added",
  item_added: "Schedule item added",
  item_changed: "Schedule item changed",
  item_removed: "Schedule item removed",
  checks: "Checks run",
  prepared: "Prepared",
  review_passed: "Passed review",
  sent_back: "Sent back",
  signed_off: "Signed off",
  reopened: "Reopened",
  agent_started: "Agent started",
  journal_proposed: "Journal proposed",
  journal_approved: "Journal approved for a Xero draft",
  journal_rejected: "Journal rejected",
  journal_drafted: "Draft created in Xero",
  journal_superseded: "Journal replaced by a new proposal",
  releases_on: "Monthly releases switched on",
  releases_off: "Monthly releases switched off",
  release_proposed: "Monthly release proposed on Journals",
  release_withdrawn: "Monthly release withdrawn: Xero has it",
  journal_posted: "Journal posted in Xero",
  variance_accepted: "Difference accepted at sign-off",
  agent_restarted: "FM1 started again after a send back",
  restart_held: "FM1 not restarted: waiting for a person",
  restart_skipped: "FM1 already working, not restarted",
};

// agent:fm1 to FM1; a person stays as their address.
export function actorLabel(actor: string): string {
  const m = /^agent:(.+)$/.exec(actor);
  return m ? m[1].toUpperCase() : actor;
}

// The rec paths the portal may reach on finance-api. An agent's routes (a
// proposal, the note of a draft) are left out on purpose.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REC_PATH = new RegExp(
  `^recs/(compose|settings|${UUID}/(place|comment|checks|prepare|review|sign-off|send-back|reopen|agent|releases|counterpart|evidence(/fetch|/${UUID})?|items(/${UUID})?|journals/${UUID}/(approve|reject)))$`, "i");
export const isRecPath = (path: string) => REC_PATH.test(path);

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

async function read<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number; migrationMissing: boolean }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500, migrationMissing: false };
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "X-API-Key": key }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status, migrationMissing: Boolean(body.migration_missing) };
  return { ok: true, data: body as T };
}

export const fetchRecs = (slug: string, period: string) =>
  read<RecList>(`/api/finance/clients/${encodeURIComponent(slug)}/recs?period=${encodeURIComponent(period)}`);

export const fetchRec = (slug: string, id: string) =>
  read<RecDetail>(`/api/finance/clients/${encodeURIComponent(slug)}/recs/${encodeURIComponent(id)}`);

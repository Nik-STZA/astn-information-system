// The Fixed assets page: each company's register as Xero holds it, read from
// finance-api (finance-api/lib/fixed-assets.js). Read only. Pure helpers
// first, the server-only fetch at the bottom.

export interface AssetRow {
  id: string;
  number: string | null;
  name: string;
  type: string | null;
  purchase_date: string | null;
  cost: number;
  accumulated: number | null;
  book_value: number | null;
  method: string | null;
  life_years: number | null;
  rate: number | null;
  disposal_date: string | null;
}

export interface TypeTotal {
  type: string | null;
  cost_account: string | null;
  accumulated_account: string | null;
  expense_account: string | null;
  count: number;
  cost: number;
  accumulated: number;
  book_value: number;
}

// One account in the tie to the ledger: the register against the trial
// balance. difference is ledger less register.
export interface TieRow {
  kind: "cost" | "accumulated";
  account: string;
  types: string[];
  register: number;
  ledger: number;
  difference: number;
  ties: boolean;
  drafts_matching?: Array<{ number: string | null; name: string; cost: number }>;
}

export interface LedgerTie {
  as_at: string;
  rows: TieRow[];
  differences: number;
  outside_register: Array<{ account: string; balance: number }>;
  untyped_count: number;
}

export type DepreciationState = "behind" | "never_run" | "up_to_date" | "nothing_registered";

export interface CompanyRegister {
  slug: string;
  name: string;
  error?: string;
  last_depreciation_date?: string | null;
  months_not_run?: string[];
  depreciation?: { state: DepreciationState; text: string };
  totals?: { count: number; cost: number; accumulated: number; book_value: number };
  by_type?: TypeTotal[];
  registered?: AssetRow[];
  drafts?: AssetRow[];
  disposed_count?: number;
  tie?: LedgerTie;
  tie_error?: string;
  proposals?: Array<{ id: string; summary: string; state: string; proposed_by: string; created_at: string }>;
}

export interface FixedAssetsData { as_of: string; companies: CompanyRegister[] }

export const money = (n: number | null | undefined): string =>
  n === null || n === undefined ? "-" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function dateText(d: string | null | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "-";
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// The pill colour for where depreciation stands.
export const DEPRECIATION_TONE: Record<DepreciationState, "s-green" | "s-amber" | "s-red" | "s-neutral"> = {
  up_to_date: "s-green", behind: "s-amber", never_run: "s-red", nothing_registered: "s-neutral",
};
export const DEPRECIATION_LABEL: Record<DepreciationState, string> = {
  up_to_date: "Depreciation up to date", behind: "Depreciation behind", never_run: "Depreciation never run", nothing_registered: "Nothing registered",
};

const METHOD: Record<string, string> = {
  StraightLine: "Straight line", DiminishingValue100: "Diminishing 100%", DiminishingValue150: "Diminishing 150%",
  DiminishingValue200: "Diminishing 200%", FullDepreciation: "Full", NoDepreciation: "None",
};

// "Straight line, 3 years", or null when Xero has no method set.
export function methodText(a: Pick<AssetRow, "method" | "life_years" | "rate">): string | null {
  if (!a.method) return null;
  const span = a.life_years ? `${a.life_years} year${a.life_years === 1 ? "" : "s"}` : a.rate ? `${a.rate}% a year` : null;
  return [METHOD[a.method] ?? a.method, span].filter(Boolean).join(", ");
}

// What the tie says at a glance.
export function tieSummary(t: LedgerTie): { tone: "s-green" | "s-amber"; label: string } {
  if (!t.differences) return { tone: "s-green", label: "Ties to the ledger" };
  return { tone: "s-amber", label: `${t.differences} difference${t.differences === 1 ? "" : "s"} to explain` };
}

// The company the page shows: the one asked for, else the first.
export function pickCompany(companies: CompanyRegister[], slug: string | undefined): CompanyRegister | null {
  return companies.find((c) => c.slug === slug) ?? companies[0] ?? null;
}

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchFixedAssets(slug: string): Promise<{ ok: true; data: FixedAssetsData } | { ok: false; error: string }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured" };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/fixed-assets`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}` };
  return { ok: true, data: body as FixedAssetsData };
}

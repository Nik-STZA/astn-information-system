// The asset register page: each grouping's months, the tie to the ledger and
// each asset as the month was prepared, read from finance-api
// (finance-api/lib/asset-register-routes.js, GET .../asset-register/view), and
// the lines waiting on the CFO. Pure helpers first, the server-only calls at
// the bottom.

export type PeriodStatus = "open" | "prepared" | "signed";

export interface RegisterPeriod {
  period: string;
  status: PeriodStatus;
  opening: boolean;
  prepared_by: string | null;
  prepared_at: string | null;
  signed_by: string | null;
  signed_at: string | null;
}

export interface Grouping {
  grouping: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  assets: number;
  waiting: number;
  periods: RegisterPeriod[];
}

export interface NamedItem { label: string; amount: number }

export interface AccountTie {
  company: string;
  account: string;
  opening: number | null;
  additions: number;
  amortisation: number;
  impairment: number;
  by_xero: number | null;
  register: number;
  ledger: number;
  difference: number;
  named_items: NamedItem[];
  unexplained: number;
  ties: boolean;
}

export interface MonthAsset {
  asset_no: string;
  name?: string;
  status?: string;
  company?: string;
  jurisdiction?: string | null;
  parent_asset_no?: string | null;
  cost: number;
  accumulated: number;
  additions: number;
}

export interface RegisterAsset {
  asset_no: string;
  name: string;
  status: string;
  company: string;
  jurisdiction: string | null;
  parent_asset_no: string | null;
}

export interface RegisterMonth extends RegisterPeriod {
  accounts: AccountTie[];
  assets: MonthAsset[];
  findings: unknown[];
}

export interface RegisterView {
  groupings: Grouping[];
  grouping: string | null;
  month: RegisterMonth | null;
  assets: RegisterAsset[];
}

export interface WaitingLine {
  id: string;
  grouping: string;
  invoice_no: string | null;
  supplier: string | null;
  line_date: string;
  amount: number;
  posted_account_code: string | null;
  treatment: string | null;
  reason_text: string | null;
  question: string | null;
  asset_no: string | null;
  company: string;
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-10" -> "October 2026"
export function monthText(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : period;
}

// "2026-10" -> "31 October 2026", the month end the register is read at.
export function monthEndText(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${last} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function dateTimeText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const STATUS_LABEL: Record<PeriodStatus, string> = { open: "Open", prepared: "Prepared", signed: "Signed" };
export const STATUS_TONE: Record<PeriodStatus, "s-neutral" | "s-amber" | "s-green"> = { open: "s-neutral", prepared: "s-amber", signed: "s-green" };

// Months are signed in order: the earliest prepared month after the last
// signed one is the only one that can be signed. Reopening goes latest first:
// only the latest signed month can be reopened.
export function signable(periods: RegisterPeriod[]): string | null {
  const next = periods.find((p) => p.status !== "signed");
  return next && next.status === "prepared" ? next.period : null;
}

export function reopenable(periods: RegisterPeriod[]): string | null {
  const signed = periods.filter((p) => p.status === "signed");
  const last = signed[signed.length - 1];
  if (!last) return null;
  return periods.some((p) => p.period > last.period && p.status === "signed") ? null : last.period;
}

// Totals across the month's assets.
export function assetTotals(assets: MonthAsset[]) {
  const cost = assets.reduce((s, a) => s + (a.cost ?? 0), 0);
  const accumulated = assets.reduce((s, a) => s + (a.accumulated ?? 0), 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { count: assets.length, cost: r(cost), accumulated: r(accumulated), nbv: r(cost + accumulated) };
}

export function tieState(accounts: AccountTie[]): { label: string; tone: "s-green" | "s-red" } {
  const bad = accounts.filter((a) => !a.ties).length;
  return bad ? { label: `${bad} account${bad === 1 ? "" : "s"} do not tie`, tone: "s-red" } : { label: "Ties to Xero", tone: "s-green" };
}

// Assets a line can be approved onto: not written off, disposed or lapsed.
export const decidable = (assets: RegisterAsset[]) => assets.filter((a) => !["impaired", "disposed", "lapsed"].includes(a.status));

// The decisions the page sends; finance-api checks the CFO, the reason and
// the period lock.
export const TREATMENT_LABEL: Record<string, string> = {
  capitalise: "Capitalise",
  expense_research: "Expense: research",
  expense_admin: "Expense: admin or maintenance",
};

// The paths the portal may call through to finance-api.
const PATH = /^asset-register\/(?:cost-lines\/decide|periods\/sign|periods\/reopen)$/;
export const isAssetRegisterPath = (path: string) => PATH.test(path);

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

async function read<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "X-API-Key": key }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as T };
}

export function fetchRegisterView(slug: string, grouping?: string, period?: string) {
  const q = new URLSearchParams();
  if (grouping) q.set("grouping", grouping);
  if (period) q.set("period", period);
  return read<RegisterView>(`/api/finance/clients/${encodeURIComponent(slug)}/asset-register/view${q.size ? `?${q}` : ""}`);
}

export function fetchWaitingLines(slug: string) {
  return read<{ lines: WaitingLine[] }>(`/api/finance/clients/${encodeURIComponent(slug)}/asset-register/cost-lines?state=proposed`);
}

export async function assetRegisterCall(slug: string, path: string, actorEmail: string, body: unknown) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/${path}`, {
    method: "POST", headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

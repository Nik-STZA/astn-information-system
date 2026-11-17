// The Fixed assets page (CFO design, 18 Nov 2026; mock-up "Asset register
// redesign" v5): one page for every register a client keeps, a month at a
// time. Roll-forward, tie to Xero, assets and activity, with every figure
// opening what makes it up and a thread on every account and asset.
// Read from finance-api GET asset-register/schedule and GET threads. Pure
// helpers first, the server-only calls at the bottom.

export interface Person { email: string; initials: string | null; name: string }

export interface ScheduleAccount {
  company: string;
  entity_id: string | null;
  account_id: string | null;
  code: string | null;
  name: string;
  register: number;
  ledger: number;
  difference: number;
  named_items: Array<{ label: string; amount: number }>;
  unexplained: number;
  ties: boolean;
  // Accounts Xero amortises itself: its charge since the opening to last
  // month end, and in the month. Null on accounts the register amortises.
  xero_charge_bf: number | null;
  xero_charge_in_month: number | null;
  amortised_by: "register" | "xero" | null;
}

export interface ScheduleAsset {
  id: string;
  asset_no: string;
  name: string;
  status: string;
  company: string;
  jurisdiction: string | null;
  parent_asset_no: string | null;
  account: string | null;
  accumulated_account: string | null;
  cost_bf: number;
  additions: number;
  transfers: number;
  cost_cf: number;
  accumulated_bf: number;
  charge: number;
  impairment: number;
  other: number;
  accumulated_cf: number;
  nbv_bf: number;
  nbv_cf: number;
}

export interface ScheduleLine {
  id: string;
  asset_id: string;
  date: string;
  period: string;
  company: string;
  account: string | null;
  supplier: string | null;
  invoice_no: string | null;
  amount: number;
  description: string | null;
  reason: string | null;
  source_type: string;
  xero_source_id: string | null;
}

export interface ScheduleGrouping {
  grouping: string;
  // The client's own name for the register (Settings), else the standard one.
  name: string;
  catalogue_name?: string;
  paused: boolean;
  month: { period: string; status: "open" | "prepared" | "signed"; opening: boolean; prepared_by: Person | null; prepared_at: string | null; signed_by: Person | null; signed_at: string | null } | null;
  months: Array<{ period: string; status: string }>;
  accounts: ScheduleAccount[];
  assets: ScheduleAsset[];
  lines: ScheduleLine[];
  expensed: { count: number; total: number };
}

export interface Schedule { period: string | null; months: string[]; groupings: ScheduleGrouping[] }

export interface ThreadEntry {
  id: string;
  subject_kind: "account" | "asset" | "cost_line" | "reconciliation" | "register_month";
  subject_key: string;
  period: string | null;
  kind: "note" | "question" | "hold" | "decision" | "finding";
  body: string;
  needs_decision: boolean;
  open: boolean;
  created_at: string;
  by: { initials: string; name: string; on_behalf_of: string | null; role: string | null };
  via_agent: string | null;
  replies?: ThreadEntry[];
}

// Figures as an accountant writes them: negatives in brackets, nil as a dash.
export function fig(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v) < 0.005) return "-";
  const s = Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthName(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : period;
}
export function monthEndName(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return `${new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
export function dayName(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

export interface Roll { cost_bf: number; additions: number; cost_cf: number; accumulated_bf: number; charge: number; accumulated_cf: number; nbv_bf: number; nbv_cf: number }

// Adds up assets' schedule rows. Impairment and other movements sit in
// "charge" here, so the columns always cast.
export function roll(xs: ScheduleAsset[]): Roll {
  const s = (f: (a: ScheduleAsset) => number) => Math.round(xs.reduce((t, a) => t + (f(a) || 0), 0) * 100) / 100;
  const cost_bf = s((a) => a.cost_bf), additions = s((a) => a.additions + a.transfers), accumulated_bf = s((a) => a.accumulated_bf);
  const charge = s((a) => a.charge + a.impairment + a.other);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { cost_bf, additions, cost_cf: r(cost_bf + additions), accumulated_bf, charge, accumulated_cf: r(accumulated_bf + charge),
    nbv_bf: r(cost_bf + accumulated_bf), nbv_cf: r(cost_bf + additions + accumulated_bf + charge) };
}

// Xero's own amortisation on the accounts it keeps, as roll-forward figures:
// no cost, accumulated brought forward, the month's charge, carried forward.
// Added to the assets' roll so the roll-forward ties to the ledger.
export function xeroRoll(xs: Array<Pick<ScheduleAccount, "xero_charge_bf" | "xero_charge_in_month">>): Roll {
  const r = (n: number) => Math.round(n * 100) / 100;
  const accumulated_bf = r(xs.reduce((t, a) => t + (a.xero_charge_bf ?? 0), 0));
  const charge = r(xs.reduce((t, a) => t + (a.xero_charge_in_month ?? 0), 0));
  const accumulated_cf = r(accumulated_bf + charge);
  return { cost_bf: 0, additions: 0, cost_cf: 0, accumulated_bf, charge, accumulated_cf, nbv_bf: accumulated_bf, nbv_cf: accumulated_cf };
}

export function addRolls(a: Roll, b: Roll): Roll {
  const r = (n: number) => Math.round(n * 100) / 100;
  const out = { ...a };
  for (const k of Object.keys(a) as Array<keyof Roll>) out[k] = r(a[k] + b[k]);
  return out;
}

// Accounts whose charge Xero runs (they carry a Xero charge figure).
export const chargedInXero = (a: Pick<ScheduleAccount, "xero_charge_in_month">) => a.xero_charge_in_month !== null && a.xero_charge_in_month !== undefined;

// What a line is for: Xero's description, else the workbook phase, else the
// reason it was capitalised.
export function lineWhat(l: Pick<ScheduleLine, "description" | "reason">): string {
  const phase = /phase:\s*(.+)$/.exec(l.reason ?? "")?.[1];
  return (l.description ?? "").trim() || (phase ?? "").trim() || (l.reason ?? "").replace(/^Workbook treatment: [^;]*;?\s*/, "").trim() || "-";
}

// The thread a subject keeps: an account by company and code, an asset by id.
export const accountSubject = (a: Pick<ScheduleAccount, "entity_id" | "code">) => (a.entity_id && a.code ? `${a.entity_id}:${a.code}` : null);

// Entries open and needing a decision, and the filters on the Activity tab.
export type ActivityFilter = "all" | "open" | "decisions" | "questions" | "holds" | "agents";
export function passes(e: ThreadEntry, f: ActivityFilter): boolean {
  if (f === "all") return true;
  if (f === "open") return e.open;
  if (f === "decisions") return e.kind === "decision" || (e.needs_decision && !e.open);
  if (f === "questions") return e.kind === "question";
  if (f === "holds") return e.kind === "hold";
  return !!e.via_agent;
}

export const STATUS_TONE: Record<string, string> = { registered: "s-green", granted: "s-green", in_use: "s-green", pending: "s-neutral", wip: "s-neutral", impaired: "s-amber", lapsed: "s-amber", disposed: "s-neutral" };

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

export function fetchSchedule(slug: string, period?: string) {
  return read<Schedule>(`/api/finance/clients/${encodeURIComponent(slug)}/asset-register/schedule${period ? `?period=${encodeURIComponent(period)}` : ""}`);
}

export function fetchMonthThreads(slug: string, period: string) {
  return read<{ threads: ThreadEntry[]; open: number }>(`/api/finance/clients/${encodeURIComponent(slug)}/threads?period=${encodeURIComponent(period)}`);
}

export function fetchPeople() {
  return read<{ people: Array<{ email: string; kind: string; display_name: string; initials: string; title: string | null }> }>("/api/finance/people");
}

// A new thread entry, as the signed-in person.
export async function postThreadEntry(slug: string, actorEmail: string, body: unknown) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/threads`, {
    method: "POST", headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

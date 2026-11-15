// Contracts (Nik, 15 Nov 2026): what each company of a client has agreed to
// sell and to buy, ring-fenced per client. finance-api holds the register and
// decides everything (finance-api/lib/contracts.js); this reads it and passes
// a person's changes through. Finance terms only: never a legal review.

export type Side = "customer" | "supplier";
export type Renewal = "no" | "auto" | "option";

export interface Pattern { key: string; side: Side; label: string; rule: string; evidence: string }

export interface Contract {
  id: string;
  entity_slug: string;
  entity_name: string;
  side: Side;
  counterparty: string;
  title: string | null;
  reference: string | null;
  pattern: string;
  pattern_label: string;
  pattern_confirmed_by: string | null;
  pattern_confirmed_at: string | null;
  status: "active" | "ended" | "cancelled";
  currency: string;
  total_value: number | null;
  start_date: string | null;
  end_date: string | null;
  renewal: Renewal;
  notice_days: number | null;
  notice_by: string | null;
  payment_terms: string | null;
  account_code: string | null;
  notes: string | null;
  source: "person" | "upload";
  created_by: string;
  created_at: string;
  end_reason: string | null;
  held?: number;
  next?: ComingUp | null;
}

export interface ComingUp {
  contract_id: string;
  counterparty: string;
  kind: "payment" | "milestone" | "notice";
  label: string;
  amount: number | null;
  currency: string;
  due_on: string | null;
  expected: string | null;
  trigger_text: string | null;
  overdue: boolean;
}

export interface ScheduleItem {
  id: string;
  kind: "payment" | "milestone";
  seq: number;
  label: string;
  trigger_text: string | null;
  amount: number | null;
  due_on: string | null;
  expected: string | null;
  status: "pending" | "met" | "cancelled";
  received_amount: number | null;
  received_on: string | null;
  evidence: string | null;
  note: string | null;
}

export interface Movement {
  id: string;
  kind: "billed" | "released";
  on_date: string;
  amount: number;
  ref: string | null;
  note: string | null;
  added_by: string;
  withdrawn_at: string | null;
}

export interface Proposed {
  is_contract: boolean;
  side: Side | null;
  entity: string | null;
  counterparty: string | null;
  title: string | null;
  reference: string | null;
  pattern: string | null;
  pattern_reason: string | null;
  currency: string | null;
  total_value: number | null;
  start_date: string | null;
  end_date: string | null;
  renewal: Renewal | null;
  notice_days: number | null;
  payment_terms: string | null;
  schedule: Array<{ kind: "payment" | "milestone"; seq: number; label: string; trigger_text: string | null; amount: number | null; due_on: string | null }>;
  pages: Record<string, string>;
  not_found: string[];
  summary: string | null;
}

export interface Upload {
  id: string;
  file_name: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  read_state: "waiting" | "reading" | "read" | "failed" | "added" | "dismissed";
  read_error: string | null;
  proposed: Proposed | null;
  contract_id: string | null;
}

export interface Tie {
  entity_name: string;
  account_code: string;
  as_at: string;
  register: number;
  ledger: number | null;
  agrees: boolean | null;
}

export interface Company { slug: string; name: string }

export interface ContractList {
  migration_missing?: boolean;
  contracts: Contract[];
  coming_up: ComingUp[];
  uploads: Upload[];
  ties: Tie[];
  companies: Company[];
  patterns: Pattern[];
}

export interface ClientRule { kind: string; title: string; summary: string | null; status: "approved" | "draft"; version: string | null }

export interface ContractDetail {
  contract: Contract;
  pattern: Pattern | null;
  client_rules: ClientRule[];
  schedule: ScheduleItem[];
  movements: Movement[];
  held: number;
  ledger: { period: string; period_end: string; closing: number; register: number } | null;
  upload: Upload | null;
  companies: Company[];
  patterns: Pattern[];
}

export const MAX_FILE_BYTES = 12 * 1024 * 1024;

export function money(n: number | null | undefined, currency = "GBP"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const s = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "-" : "";
  return currency === "GBP" ? `${sign}£${s}` : `${sign}${currency} ${s}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateLabel(d: string | null | undefined): string {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

export const RENEWAL_LABEL: Record<Renewal, string> = { no: "Ends", auto: "Renews itself", option: "May be renewed" };

// What a coming-up item says about when, in a person's words.
export function whenLabel(x: Pick<ComingUp, "due_on" | "expected" | "trigger_text">): string {
  if (x.due_on) return dateLabel(x.due_on);
  if (x.expected) return `Expected ${x.expected}`;
  return x.trigger_text ? `Date not set: ${x.trigger_text}` : "Date not set";
}

// The paths the browser may reach through the portal's route. Ids are uuids.
const ID = "[0-9a-f-]{36}";
const CONTRACT_PATH = new RegExp(
  `^contracts(?:/(?:uploads|uploads/${ID}/(?:read|dismiss)|${ID}(?:/(?:confirm-pattern|end|schedule|movements|schedule/${ID}|movements/${ID}/withdraw))?))?$`, "i");
export const isContractsPath = (path: string) => CONTRACT_PATH.test(path);

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

export function fetchContracts(slug: string, all = false) {
  return read<ContractList>(`/api/finance/clients/${encodeURIComponent(slug)}/contracts${all ? "?status=all" : ""}`);
}

export function fetchContract(slug: string, id: string) {
  return read<ContractDetail>(`/api/finance/clients/${encodeURIComponent(slug)}/contracts/${encodeURIComponent(id)}`);
}

export async function contractsCall(slug: string, path: string, method: string, actorEmail: string, body?: unknown, raw?: { bytes: ArrayBuffer; fileName: string }) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const headers: Record<string, string> = { "X-API-Key": key, "X-Actor-Email": actorEmail };
  let payload: BodyInit | undefined;
  if (raw) {
    headers["Content-Type"] = "application/pdf";
    headers["X-File-Name"] = encodeURIComponent(raw.fileName);
    payload = raw.bytes;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/${path}`, { method, headers, body: payload, cache: "no-store" });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

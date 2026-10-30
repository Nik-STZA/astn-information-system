// The AP queue (docs/ap-lane/phase3-design.md). Server side only: the API key
// must never reach the browser. Intake and the document go through the routes
// under /api/finance/[slug]/ap, which call these.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export type ApState = "skipped" | "clean" | "exception" | "approved" | "written" | "rejected" | "superseded";

export interface ApReason {
  check: string;
  detail: string;
}

export interface ApItemRow {
  id: string;
  file_name: string;
  file_received_at: string | null;
  document_index: number;
  state: ApState;
  state_reason: string | null;
  matched_by: string | null;
  supplier: string | null;
  number: string | null;
  date: string | null;
  total: string | null;
  currency: string | null;
  reasons: ApReason[] | null;
  decided_by_email: string | null;
  decided_at: string | null;
  xero_invoice_id: string | null;
  source: ApSource;
  recommended: boolean;
  review_verdict: "agree" | "disagree" | null;
  review_repetitive: "repetitive" | "changed" | "one_off" | null;
  created_at: string;
}

// An agent's suggested coding (the AP Clerk), for the CFO to accept or change.
export interface ApRecommendation {
  lines: Array<{ index: number; account_code: string; tax_type: string; reason: string | null }>;
  due_date: string | null;
  note: string;
  // Who the document is really from, when that is not the bill's supplier. No
  // contact_id means a new supplier, created in Xero when the CFO uses it.
  supplier?: { contact_id: string | null; name: string; vat_number: string | null; country: string | null; reason: string };
  // A reviewer's view of this recommendation; a new recommendation has none.
  review?: { verdict: "agree" | "disagree"; repetitive: "repetitive" | "changed" | "one_off"; pattern: string | null; note: string; agent: string | null; at: string };
  agent: string | null;
  by_email: string;
  at: string;
}

// Where the document came from: the Documents inbox, or a draft bill Xero keyed
// from its bills email (sending updates that draft).
export type ApSource = "files_inbox" | "ledger_draft";

export interface ApDraftDifference {
  field: string;
  keyed: string | number | null;
  proposed: string | number | null;
}

export interface ApBillLine {
  Description: string;
  LineAmount: number;
  AccountCode: string | null;
  TaxType: string | null;
}

export interface ApProposedBill {
  Type: string;
  Contact: { ContactID?: string; Name: string | null };
  InvoiceNumber: string;
  DateString: string | null;
  DueDateString: string | null;
  CurrencyCode: string | null;
  LineAmountTypes: string;
  LineItems: ApBillLine[];
  Total: number | null;
  TotalTax: number;
}

export interface ApItemDetail {
  id: string;
  file_name: string;
  mime_type: string | null;
  state: ApState;
  state_reason: string | null;
  matched_by: string | null;
  proposed_bill: ApProposedBill | null;
  review: { reasons?: ApReason[]; draft_differences?: { blocking: ApDraftDifference[]; coding: ApDraftDifference[] } } | null;
  source: ApSource;
  recommendation: ApRecommendation | null;
  extraction: { document_type?: string; supplier_name?: string | null } | null;
  created_at: string;
}

export interface IntakeResult {
  inbox_files: number;
  xero_drafts: number;
  read_now: number;
  remaining: number;
  results: Array<{ file: string; state?: ApState; skipped?: string; error?: string }>;
}

type Result<T> = { ok: true; data: T; status: number } | { ok: false; error: string; status: number };

async function call<T>(path: string, init: RequestInit & { actorEmail?: string } = {}): Promise<Result<T>> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const { actorEmail, ...rest } = init;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      "X-API-Key": key,
      ...(actorEmail ? { "X-Actor-Email": actorEmail } : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as T, status: res.status };
}

const base = (slug: string, entity: string) =>
  `/api/finance/clients/${encodeURIComponent(slug)}/xero/${encodeURIComponent(entity)}/ap`;

export async function fetchApItems(slug: string, entity: string, states: ApState[]): Promise<ApItemRow[]> {
  const r = await call<{ items: ApItemRow[] }>(`${base(slug, entity)}/items?state=${states.join(",")}`);
  if (!r.ok) throw new Error(r.error);
  return r.data.items;
}

export async function fetchApItem(slug: string, entity: string, id: string): Promise<ApItemDetail | null> {
  const r = await call<ApItemDetail>(`${base(slug, entity)}/items/${encodeURIComponent(id)}`);
  if (!r.ok) {
    if (r.status === 404 || r.status === 400) return null;
    throw new Error(r.error);
  }
  return r.data;
}

export async function runIntake(slug: string, entity: string, actorEmail: string, maxFiles = 3): Promise<Result<IntakeResult>> {
  return call<IntakeResult>(`${base(slug, entity)}/intake`, {
    method: "POST",
    actorEmail,
    body: JSON.stringify({ max_files: maxFiles }),
  });
}

// The document itself, streamed through to the viewer.
export async function fetchApFile(slug: string, entity: string, id: string): Promise<Response> {
  const key = process.env.FINANCE_API_KEY ?? "";
  return fetch(`${BASE_URL}${base(slug, entity)}/items/${encodeURIComponent(id)}/file`, {
    headers: { "X-API-Key": key },
    cache: "no-store",
  });
}

// ── Step 3: decide and send ─────────────────────────────────────────────────

export interface ApOptions {
  accounts: Array<{ code: string; name: string; type: string }>;
  tax_types: Array<{ type: string; name: string }>;
  suppliers: Array<{ contact_id: string; name: string }>;
}

export interface ApDecisionBody {
  action: "approve" | "reject";
  note?: string;
  edits?: {
    contact?: { ContactID: string; Name: string | null };
    lines?: Array<{ index: number; account_code?: string; tax_type?: string }>;
  };
}

export interface ApSendResult {
  validation?: "PASS" | "FAIL";
  issues?: string[];
  action?: string;
  InvoiceID?: string;
  InvoiceNumber?: string;
  xero_status?: string;
  total?: number;
  done?: string[];
  attached?: boolean;
  file?: string;
  // Xero's own words when it refused the bill (HTTP 502 from finance-api).
  xero_errors?: string[];
  error?: string;
}

export async function fetchApOptions(slug: string, entity: string): Promise<Result<ApOptions>> {
  return call<ApOptions>(`${base(slug, entity)}/options`);
}

export async function decideApItem(slug: string, entity: string, id: string, actorEmail: string, body: ApDecisionBody): Promise<Result<unknown>> {
  return call(`${base(slug, entity)}/items/${encodeURIComponent(id)}/decision`, { method: "POST", actorEmail, body: JSON.stringify(body) });
}

// Dry run unless dryRun is false. A refused send (422) comes back as data, with
// its issues, so the screen can say why.
// A new supplier in Xero, from a recommendation the CFO has accepted. The write
// checks and audit are finance-api's; bank details are never part of it.
export async function createApSupplier(slug: string, entity: string, actorEmail: string, b: { name: string; vat_number?: string | null; country?: string | null; item_id: string }): Promise<{ status: number; data: { ContactID?: string; name?: string; issues?: string[]; error?: string } }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, data: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/xero/${encodeURIComponent(entity)}/write/contacts`, {
    method: "POST",
    headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, "Content-Type": "application/json" },
    body: JSON.stringify({
      dry_run: false, name: b.name, ...(b.vat_number ? { tax_number: b.vat_number } : {}),
      ...(b.country ? { address: { country: b.country } } : {}),
      audit_note: `New supplier from Bills item ${b.item_id}, created by the CFO from the AP Clerk's recommendation`,
    }),
    cache: "no-store",
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export async function sendApItem(slug: string, entity: string, id: string, actorEmail: string, dryRun: boolean): Promise<{ status: number; data: ApSendResult }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, data: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}${base(slug, entity)}/items/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: dryRun }),
    cache: "no-store",
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as ApSendResult };
}

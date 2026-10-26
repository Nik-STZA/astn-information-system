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
  created_at: string;
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
  review: { reasons?: ApReason[] } | null;
  extraction: { document_type?: string; supplier_name?: string | null } | null;
  created_at: string;
}

export interface IntakeResult {
  inbox_files: number;
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

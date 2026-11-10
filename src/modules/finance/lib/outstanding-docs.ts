// Outstanding documents (Nik, 10 Nov 2026): transactions a client has not
// supported with a document, carried as open items in the close and listed in
// the management pack. finance-api decides (finance-api/lib/outstanding-docs.js);
// these are the page's types and pure helpers, the server-only fetch at the bottom.

export type DocState = "candidate" | "open" | "received" | "accepted" | "dismissed";
export type Concern = "no_vat_invoice" | "audit_evidence" | "business_purpose" | "overseas_reverse_charge" | "unknown_payee" | "other";

export interface VatFlag { flagged: boolean; at_risk_max: number | null; reason: string | null }

export interface DocItem {
  id: string;
  state: DocState;
  entity_slug: string | null;
  entity_name: string | null;
  bank_account: string | null;
  txn_date: string;
  payee: string;
  reference: string | null;
  direction: "spent" | "received";
  amount: number;
  currency: string;
  amount_gbp: number | null;
  concern: Concern;
  note: string | null;
  source: "upload" | "person" | "agent";
  upload_id: string | null;
  upload_name: string | null;
  source_line: string | null;
  duplicate_of: string | null;
  created_by: string;
  created_at: string;
  opened_at: string | null;
  last_chased_at: string | null;
  chase_count: number;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  vat: VatFlag;
}

export interface DocUpload {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  read_state: "waiting" | "reading" | "read" | "failed";
  read_error: string | null;
  read_at: string | null;
  read_with: string | null;
  line_count: number | null;
  file_deleted_at: string | null;
}

export interface Bucket { count: number; value: number; unknown_gbp: number }

export interface DocSummary {
  open: Bucket;
  candidates: number;
  by_concern: Record<string, Bucket>;
  by_company: Record<string, Bucket>;
  by_month: Record<string, Bucket>;
  vat: { flagged: number; at_risk_max: number; threshold: number };
  oldest: string | null;
}

export interface DocList {
  migration_missing?: boolean;
  items: DocItem[];
  uploads: DocUpload[];
  companies: Array<{ slug: string; name: string }>;
  threshold: number;
  concerns: Record<Concern, { label: string; hint: string }>;
  summary: DocSummary;
}

export const CONCERN_ORDER: Concern[] = ["no_vat_invoice", "audit_evidence", "business_purpose", "overseas_reverse_charge", "unknown_payee", "other"];

// What the page accepts. The server checks the bytes again.
export const ACCEPT = ".pdf,.xlsx,.xlsm,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

// A file the page will send, or why not, before anything leaves the browser.
export function fileProblem(f: { name: string; size: number }): string | null {
  const n = f.name.toLowerCase();
  if (n.endsWith(".xls")) return "an old Excel (.xls) file: save it as .xlsx first";
  if (!/\.(pdf|xlsx|xlsm|csv)$/.test(n)) return "not a PDF, Excel (.xlsx) or CSV file";
  if (f.size === 0) return "empty";
  if (f.size > MAX_FILE_BYTES) return `over ${MAX_FILE_BYTES / 1048576} MB`;
  return null;
}

// Runs fn over items with at most `limit` at once, in order of starting.
export async function inBatches<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function amountText(item: Pick<DocItem, "amount" | "currency" | "amount_gbp" | "direction">): string {
  const n = item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const head = item.currency === "GBP" ? `£${n}` : `${item.currency} ${n}`;
  const gbp = item.currency !== "GBP" && item.amount_gbp != null ? ` (£${item.amount_gbp.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : "";
  return `${item.direction === "received" ? "In " : ""}${head}${gbp}`;
}

export const pounds = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : ym;
}
export function dateText(iso: string | null): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return m ? `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` : iso;
}

// Open items grouped by the month of the transaction, newest month first.
export function byMonth(items: DocItem[]): Array<{ month: string; items: DocItem[] }> {
  const m = new Map<string, DocItem[]>();
  for (const it of items) {
    const k = it.txn_date.slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return [...m.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, list]) => ({
    month, items: list.sort((a, b) => b.txn_date.localeCompare(a.txn_date) || a.payee.localeCompare(b.payee)),
  }));
}

// Candidates grouped by the file they were read from, in upload order.
export function byUpload(items: DocItem[], uploads: DocUpload[]): Array<{ upload: DocUpload | null; items: DocItem[] }> {
  const groups = new Map<string, DocItem[]>();
  for (const it of items) {
    const k = it.upload_id ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const order = new Map(uploads.map((u, i) => [u.id, i]));
  return [...groups.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9))
    .map(([id, list]) => ({
      upload: uploads.find((u) => u.id === id) ?? null,
      items: list.sort((a, b) => (a.source_line ?? "").localeCompare(b.source_line ?? "", undefined, { numeric: true }) || a.txn_date.localeCompare(b.txn_date)),
    }));
}

export interface Filters { company: string; concern: string; q: string }
export function filtered(items: DocItem[], f: Filters): DocItem[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((it) => (!f.company || it.entity_slug === f.company)
    && (!f.concern || it.concern === f.concern)
    && (!q || [it.payee, it.reference, it.bank_account, it.note].some((s) => s?.toLowerCase().includes(q))));
}

// What the close carries for a month: open items dated on or before its last
// day, with their sterling value and VAT flags. Nothing here blocks sign-off.
export function carriedAt(items: DocItem[], period: string): { count: number; value: number; unknown_gbp: number; vat_flagged: number; vat_at_risk_max: number; oldest: string | null } {
  const [y, m] = period.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const open = items.filter((i) => i.state === "open" && i.txn_date <= end);
  let value = 0, unknown = 0, flagged = 0, risk = 0;
  for (const i of open) {
    const g = i.currency === "GBP" ? i.amount : i.amount_gbp;
    if (g == null) unknown += 1; else if (i.direction === "spent") value += Math.round(g * 100);
    if (i.vat.flagged) { flagged += 1; if (i.vat.at_risk_max != null) risk += Math.round(i.vat.at_risk_max * 100); }
  }
  return {
    count: open.length, value: value / 100, unknown_gbp: unknown, vat_flagged: flagged, vat_at_risk_max: risk / 100,
    oldest: open.reduce<string | null>((o, i) => (!o || i.txn_date < o ? i.txn_date : o), null),
  };
}

// The paths the browser may reach through the portal's route.
const DOC_PATH = /^outstanding-documents(?:\/(?:settings|bulk|uploads|uploads\/[0-9a-f-]{36}\/read|[0-9a-f-]{36}(?:\/(?:accept|dismiss|received|accept-without|reopen|chased))?))?$/i;
export const isDocsPath = (path: string) => DOC_PATH.test(path);

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchOutstandingDocs(slug: string, all = false): Promise<{ ok: true; data: DocList } | { ok: false; error: string }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured" };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/outstanding-documents${all ? "?state=all" : ""}`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}` };
  return { ok: true, data: body as DocList };
}

// A call from the portal's route to finance-api, as the signed-in person.
export async function docsCall(slug: string, path: string, method: string, actorEmail: string, body?: unknown, raw?: { bytes: ArrayBuffer; fileName: string; contentType: string }) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const headers: Record<string, string> = { "X-API-Key": key, "X-Actor-Email": actorEmail };
  let payload: BodyInit | undefined;
  if (raw) {
    headers["Content-Type"] = raw.contentType || "application/octet-stream";
    headers["X-File-Name"] = encodeURIComponent(raw.fileName);
    payload = raw.bytes;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/${path}`, { method, headers, body: payload, cache: "no-store" });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}


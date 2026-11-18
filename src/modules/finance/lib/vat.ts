// VAT returns (VAT build spec 17 Nov 2026), read from finance-api
// (finance-api/lib/vat-routes.js). Pure helpers first, the server-only calls
// at the bottom.

export type VatStatus = "building" | "import_ready" | "import_confirmed" | "submitted" | "paid" | "part_paid" | "outstanding";
export type UploadKind = "member_export" | "representative_pre_import" | "representative_post_import";
export type Boxes = Record<string, number>;

export interface VatMember { entity_id: string; entity_name: string; slug: string }

export interface VatRegistration {
  id: string;
  vat_number: string;
  kind: "single" | "group";
  representative_id: string | null;
  representative_name: string | null;
  members: VatMember[];
}

export interface VatReturnRow {
  id: string;
  registration_id: string;
  period_start: string;
  period_end: string;
  status: VatStatus;
  submitted_on: string | null;
  uploads: number;
}

export interface VatOverview { registrations: VatRegistration[]; returns: VatReturnRow[] }

export interface VatUpload {
  id: string;
  entity_id: string;
  entity_name: string;
  kind: UploadKind;
  file_name: string;
  uploaded_by: string;
  uploaded_at: string;
  has_sheets?: boolean;
  boxes?: Boxes;
  period_start?: string;
  period_end?: string;
}

export interface VatCheck {
  key: string;
  ok: boolean;
  blocking: boolean;
  said: string;
  items: Array<Record<string, unknown>>;
}

export interface VatGroupColumn { entity_id: string; entity_name: string; representative: boolean; own: Boxes }

export interface VatGroup {
  columns: VatGroupColumn[];
  target: Boxes;
  already: Boxes;
  import: Boxes;
  nothing_to_import: boolean;
  expected_after_import: Boxes;
  template_rows: Array<Array<string | number>>;
}

export interface VatLedgerTie {
  entity: string;
  error?: string;
  account?: string;
  movement?: number;
  excluded?: number;
  trading?: number;
  from_return?: number;
  difference?: number;
  excluded_items?: string[];
}

export interface VatImport { id: string; kind: "group" | "correction" | "reset"; boxes: Boxes; generated_by: string; generated_at: string; confirmed_at: string | null }

export interface VatWorkbook {
  requested_at: string | null;
  requested_by: string | null;
  name: string | null;
  link: string | null;
  saved_at: string | null;
  error: string | null;
  drive_set: boolean;
}

export interface VatReturnView {
  workbook: VatWorkbook;
  return: { id: string; period_start: string; period_end: string; status: VatStatus; vat_number: string; kind: "single" | "group"; representative_id: string | null };
  members: VatMember[];
  uploads: VatUpload[];
  checks: { checks: VatCheck[]; blocking: string[]; ok: boolean };
  group: VatGroup | null;
  confirmation: Array<{ box: number; want: number; got: number }> | null;
  imports: VatImport[];
  ledger: VatLedgerTie[] | null;
}

export const STATUS_LABEL: Record<VatStatus, string> = {
  building: "Building",
  import_ready: "Import file ready",
  import_confirmed: "Import confirmed",
  submitted: "Submitted",
  paid: "Paid",
  part_paid: "Part paid",
  outstanding: "Outstanding",
};

export const BOX_LABEL: Record<number, string> = {
  1: "VAT due on sales",
  2: "VAT due on acquisitions",
  3: "Total VAT due",
  4: "VAT reclaimed",
  5: "Net VAT",
  6: "Total sales",
  7: "Total purchases",
  8: "Supplies to EU",
  9: "Acquisitions from EU",
};

export const KIND_LABEL: Record<UploadKind, string> = {
  member_export: "Own return",
  representative_pre_import: "Before the import",
  representative_post_import: "After the import",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function longDate(iso: string | null | undefined): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

// "1 Oct 2026 to 31 Oct 2026", or "Oct 2026" for a calendar month.
export function periodLabel(start: string, end: string): string {
  const s = start.split("-").map(Number);
  const e = end.split("-").map(Number);
  const lastDay = new Date(Date.UTC(e[0], e[1], 0)).getUTCDate();
  if (s[0] === e[0] && s[1] === e[1] && s[2] === 1 && e[2] === lastDay) return `${MONTHS[s[1] - 1]} ${s[0]}`;
  return `${longDate(start)} to ${longDate(end)}`;
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The file name for Xero's import: the period end, so a second file is told apart.
export const importFileName = (periodEnd: string, n: number) => `VAT Return Import ${periodEnd}${n > 1 ? ` (${n})` : ""}.xlsx`;

// The paths the portal may call through to finance-api.
const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^vat/returns(?:/${GUID}/(?:uploads|adjustments|imports|workbook))?$`, "i");
export const isVatPath = (path: string) => PATH.test(path);

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

export function fetchVat(slug: string) {
  return read<VatOverview>(`/api/finance/clients/${encodeURIComponent(slug)}/vat`);
}

export function fetchVatReturn(slug: string, id: string, ledger = false) {
  return read<VatReturnView>(`/api/finance/clients/${encodeURIComponent(slug)}/vat/returns/${encodeURIComponent(id)}${ledger ? "?ledger=1" : ""}`);
}

export async function vatCall(slug: string, path: string, actorEmail: string, body: unknown) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/${path}`, {
    method: "POST", headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

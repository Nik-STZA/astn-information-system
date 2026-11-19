// Payroll: the portal side of finance-api's payroll routes (lib/payroll.js,
// migration 065). Server-only fetches are at the bottom; the rest is pure.
//
// The provider's salary report holds names, addresses, NI numbers and tax
// codes. stripReport runs in the browser and keeps only the employee code and
// the payroll figures, so nothing personal leaves the computer. finance-api
// refuses anything else.

export const ROLES = ["director", "direct", "intercompany"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { director: "Director", direct: "Direct staff", intercompany: "Intercompany" };

// The same allow-list as finance-api (lib/payroll.js FIGURES and CODE).
export const KEPT_HEADINGS = ["EmpCode", "Basic", "Bonus Pensionable", "EePension(BeforeTax)", "EeeNIC", "Tax", "NetPay", "EerNIC", "ErPension", "PayBill"];
const norm = (h: unknown) => String(h ?? "").replace(/\s+/g, "").toLowerCase();
const KEPT = new Set(KEPT_HEADINGS.map(norm));

export interface PayrollEmployee {
  emp_code: string; basic: number; bonus: number; ee_pension: number; ee_nic: number; tax: number;
  net_pay: number; er_nic: number; er_pension: number; pay_bill: number;
}
export interface PayrollLine { account_code: string; description: string; amount: number; tax_type: string }
export interface PayrollJournalPreview { kind: "payroll" | "contracted" | "capdev" | "capdev_other"; entity: string; date: string; narration: string; lines: PayrollLine[]; issues: string[] }
export interface PayrollMonth {
  period: string;
  entities: Array<{ slug: string; name: string }>;
  last_period: string | null;
  settings: null | {
    payroll_entity: string; payroll_entity_name: string; contracted_entity: string | null; contracted_entity_name: string | null;
    accounts: Record<string, Record<string, string>>; projects: string[]; drive_set: boolean; folder: string;
  };
  roles: Record<string, Role>;
  run: null | {
    id: string; pay_date: string; source_name: string; uploaded_by: string; uploaded_at: string; missing: string[];
    employees: PayrollEmployee[]; alloc: Record<string, Record<string, number>>;
    alloc_confirmed_by: string | null; alloc_confirmed_at: string | null; alloc_note: string | null; no_role: string[];
    preview: { journals: PayrollJournalPreview[]; by_project: Record<string, number>; issues: string[] };
    journals: Array<{ id: string; jnl: string; kind: string; state: string; narration: string; entity: string; entity_name: string }>;
    workbook: { requested_at: string | null; requested_by: string | null; name: string | null; link: string | null; saved_at: string | null; error: string | null };
  };
  migration_missing?: boolean;
}

// The heading row (the one with EmpCode) and every row under it, cut to the
// kept columns. Numbers go as numbers; empty rows are dropped. Returns null
// when the sheet has no EmpCode heading.
export function stripReport(rows: string[][]): { rows: Array<Array<string | number>>; dropped: number } | null {
  const at = rows.findIndex((r) => r.some((c) => norm(c) === "empcode"));
  if (at < 0) return null;
  const head = rows[at];
  const keep = head.map((h, i) => (KEPT.has(norm(h)) ? i : -1)).filter((i) => i >= 0);
  const cell = (v: string | undefined): string | number => {
    const t = String(v ?? "").trim();
    return t !== "" && /^-?\d+(\.\d+)?(E-?\d+)?$/i.test(t) ? Number(t) : t;
  };
  const body = rows.slice(at + 1)
    // The code stays text: "011" is not 11.
    .map((r) => keep.map((i) => (norm(head[i]) === "empcode" ? String(r[i] ?? "").trim() : cell(r[i]))))
    .filter((r) => r.some((c) => c !== ""));
  return { rows: [keep.map((i) => String(head[i]).trim()), ...body], dropped: head.filter((h) => String(h ?? "").trim() !== "").length - keep.length };
}

// The pay date, YYYY-MM-DD, must fall in the month.
export const payDateIssue = (period: string, date: string) =>
  !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "Enter the pay date." : date.slice(0, 7) !== period ? "The pay date must fall in the month." : null;

export const gbp = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const KIND_LABEL: Record<PayrollJournalPreview["kind"], string> = {
  payroll: "Payroll", contracted: "Contracted staff", capdev: "Capitalised development", capdev_other: "Recharge, other company",
};

const PATH = /^payroll\/(settings|roles|runs|runs\/[0-9a-f-]{36}\/(alloc|propose|workbook))$/;
export const isPayrollPath = (path: string) => PATH.test(path);

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchPayroll(slug: string, period: string): Promise<{ ok: true; data: PayrollMonth } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/payroll?period=${encodeURIComponent(period)}`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 503 && body.migration_missing) return { ok: true, data: { migration_missing: true } as PayrollMonth };
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as PayrollMonth };
}

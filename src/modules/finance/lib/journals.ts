// Journals: the portal side of finance-api's journal routes (lib/journals.js,
// migration 033). Server-only fetches are at the bottom; the rest is pure, so it
// is tested and safe on either side. All the rules live in finance-api.

export type JournalState = "proposed" | "approved" | "draft_created" | "posted" | "rejected" | "superseded";
export type RetryState = "go" | "live" | "drafted" | "retry" | "unknown";

export interface JournalLine { account_code: string; description?: string; amount: number; tax_type?: string }

export interface JournalRow {
  kind: "register" | "rec";
  id: string;
  /** JNL-7: the number a person and an agent both use. Null before migration 036. */
  jnl?: string | null;
  entity_id: string;
  entity_name: string;
  period: string;
  journal_date: string;
  narration: string;
  lines: JournalLine[];
  total: string;
  reason: string | null;
  // person, fm1, fc, or rec for one proposed on a reconciliation.
  source: string;
  proposed_by: string;
  state: JournalState;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  xero_journal_no: string | null;
  xero_status: string | null;
  xero_checked_at: string | null;
  drafted_at: string | null;
  last_error: string | null;
  retry_state: RetryState | null;
  can_retry: boolean;
  rec: { id: string; account_name: string } | null;
  created_at: string;
  /** An accrual and its reversal (migration 062): one row, one approval, two Xero drafts. */
  pair?: JournalPair | null;
}

export interface JournalPair {
  reversal_date: string;
  reversal_narration: string;
  accrual_xero_journal_no: string | null;
  reversal_xero_journal_no: string | null;
  reversal_xero_status: string | null;
  accrual_item_id: string;
  backfill: boolean;
}

export interface JournalList {
  period: string;
  label: string;
  entities: Array<{ id: string; slug: string; name: string }>;
  journals: JournalRow[];
  counts?: { waiting: number; total: number };
  migration_missing?: boolean;
}

// The page's groups, in the order a CFO works through them.
export type Group = "waiting" | "approved" | "draft" | "posted" | "rejected";

export const GROUPS: Array<{ key: Group; title: string }> = [
  { key: "waiting", title: "Waiting for you" },
  { key: "approved", title: "Approved, going to Xero" },
  { key: "draft", title: "Draft in Xero" },
  { key: "posted", title: "Posted" },
  { key: "rejected", title: "Rejected" },
];

export function groupOf(j: Pick<JournalRow, "state">): Group | null {
  switch (j.state) {
    case "proposed": return "waiting";
    case "approved": return "approved";
    case "draft_created": return "draft";
    case "posted": return "posted";
    case "rejected": return "rejected";
    default: return null;
  }
}

export function grouped(rows: JournalRow[]): Array<{ key: Group; title: string; rows: JournalRow[] }> {
  return GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => groupOf(r) === g.key) }));
}

// Who proposed it, as the list says it.
export function sourceLabel(j: Pick<JournalRow, "source">): string {
  if (j.source === "person") return "Person";
  if (j.source === "rec") return "From a reconciliation";
  if (j.source === "schedule") return "Monthly release";
  if (j.source === "vat") return "VAT clearing";
  if (j.source === "accrual") return "Accrual pair";
  if (j.source === "payroll") return "Payroll";
  return j.source.toUpperCase();
}

// The reason's first sentence, for the list: why this journal exists, without
// opening it (19 Nov 2026: the reasons were there but folded away). Plain text;
// markdown marks are dropped.
export function whyLine(reason: string | null | undefined, max = 160): string | null {
  const text = String(reason ?? "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

// ── Filters ──────────────────────────────────────────────────────────────────

// Where a journal came from, as the page filters it. FM1 and the FC, and any
// other agent, are one choice: an agent's.
export type SourceFilter = "all" | "person" | "agent" | "rec" | "schedule" | "accrual" | "vat" | "payroll";
export const SOURCE_FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "Every source" },
  { key: "person", label: "A person" },
  { key: "agent", label: "An agent" },
  { key: "rec", label: "Reconciliations" },
  { key: "schedule", label: "Monthly releases" },
  { key: "accrual", label: "Accruals" },
  { key: "vat", label: "VAT clearing" },
  { key: "payroll", label: "Payroll" },
];

const KNOWN = new Set(["person", "rec", "schedule", "accrual", "vat", "payroll"]);
export const sourceKey = (j: Pick<JournalRow, "source">): Exclude<SourceFilter, "all"> => (KNOWN.has(j.source) ? j.source as Exclude<SourceFilter, "all"> : "agent");

export function filtered(rows: JournalRow[], { source = "all", entity = "" }: { source?: SourceFilter; entity?: string }): JournalRow[] {
  return rows.filter((r) => (source === "all" || sourceKey(r) === source) && (!entity || r.entity_id === entity));
}

// ── Approving several at once ────────────────────────────────────────────────

// Only a register journal still waiting can be ticked; a reconciliation's is
// decided on its reconciliation.
export const batchable = (j: Pick<JournalRow, "kind" | "state">) => j.kind === "register" && j.state === "proposed";

// The one confirmation: each journal as it will reach Xero, a pair as both legs.
export function batchLines(rows: JournalRow[]): string[] {
  return rows.map((j) => {
    const head = `${j.jnl ? `${j.jnl} ` : ""}${j.entity_name}, ${j.journal_date}: ${j.narration}, ${j.total}`;
    return j.pair ? `${head}, reversed ${j.pair.reversal_date} (two drafts)` : head;
  });
}

export function draftsIn(rows: JournalRow[]): number {
  return rows.reduce((n, j) => n + (j.pair ? 2 : 1), 0);
}

// ── The new-journal form ─────────────────────────────────────────────────────

export interface DraftLine { account_code: string; description: string; debit: string; credit: string }

export const blankLine = (): DraftLine => ({ account_code: "", description: "", debit: "", credit: "" });

// Pence from what was typed: commas allowed, at most two decimals. Null for
// anything else, so a typo is caught rather than read as nil.
export function pence(typed: string): number | null {
  const s = typed.replace(/,/g, "").trim();
  if (!s) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// The live balance check under the lines table, and what would stop it.
export function balanceOf(lines: DraftLine[]): { debits: number; credits: number; difference: number; issues: string[] } {
  let debits = 0;
  let credits = 0;
  const issues: string[] = [];
  lines.forEach((l, i) => {
    const d = pence(l.debit);
    const c = pence(l.credit);
    const blank = !l.account_code.trim() && !l.debit.trim() && !l.credit.trim() && !l.description.trim();
    if (blank) return;
    if (d === null || c === null) { issues.push(`Line ${i + 1}: an amount is not money`); return; }
    if (d && c) issues.push(`Line ${i + 1}: a debit or a credit, not both`);
    if (!d && !c) issues.push(`Line ${i + 1}: needs an amount`);
    if (!l.account_code.trim()) issues.push(`Line ${i + 1}: needs an account code`);
    debits += d;
    credits += c;
  });
  return { debits, credits, difference: debits - credits, issues };
}

// The lines as finance-api takes them: debits positive, credits negative. Blank
// rows are dropped.
export function toLines(lines: DraftLine[]): JournalLine[] {
  return lines
    .filter((l) => l.account_code.trim() || l.debit.trim() || l.credit.trim())
    .map((l) => {
      const d = pence(l.debit) ?? 0;
      const c = pence(l.credit) ?? 0;
      return { account_code: l.account_code.trim(), description: l.description.trim(), amount: (d - c) / 100 };
    });
}

// The journal paths the portal may reach on finance-api. Proposing as a person,
// the refresh from Xero, and the CFO's decision. The agents' way in (X-Work-Via)
// is never set by the portal, so through here everything is a person.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JOURNAL_PATH = new RegExp(`^journals(/refresh|/approve-batch|/${UUID}/(approve|reject))?$`, "i");
export const isJournalPath = (path: string) => JOURNAL_PATH.test(path);

// The list checks Xero for posted drafts on opening when it last looked this
// long ago, so posting in Xero shows here without anyone asking.
export const XERO_CHECK_MINUTES = 10;

export function needsXeroCheck(rows: JournalRow[], now = Date.now()): boolean {
  return rows.some((r) => r.state === "draft_created"
    && (!r.xero_checked_at || now - Date.parse(r.xero_checked_at) > XERO_CHECK_MINUTES * 60_000));
}

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchJournals(slug: string, period: string): Promise<{ ok: true; data: JournalList } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/journals?period=${encodeURIComponent(period)}`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as JournalList };
}

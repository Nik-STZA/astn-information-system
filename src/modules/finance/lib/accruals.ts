// Accruals: the portal side of finance-api's accruals routes (lib/accruals.js,
// migration 062, docs/accruals-spec.md). Server-only fetches are at the bottom;
// the rest is pure, so it is tested and safe on either side. The rules live in
// finance-api: an agent proposes and comments, only the CFO decides.

export type Decision = "pending" | "accept" | "accept_edited" | "no_accrual" | "question" | "standing" | "superseded";
export type Test = "continuity" | "backward" | "gap" | "forward" | "reverse_cutoff";

export interface AccrualLine { account_code: string; amount: number; description?: string }

export interface AccrualComment { id: string; author: string; challenge: boolean; body: string; created_at: string }

export interface AccrualProposal {
  id: string;
  entity_id: string;
  entity_name: string | null;
  period: string;
  supplier: string;
  test: Test;
  lines: AccrualLine[];
  total: string | null;
  service_from: string | null;
  service_to: string | null;
  basis_kind: "contract" | "purchase_order" | "last_bill" | "estimate";
  basis: string;
  evidence: Array<Record<string, unknown>>;
  confidence: "high" | "medium" | "open";
  departs_reason: string | null;
  proposed_by: string;
  decision: Decision;
  decision_reason: string | null;
  applies_to: "this_month" | "until_changed" | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  comments: AccrualComment[];
  cited: Array<{ id: string; decision: string; reason: string | null; period: string }>;
}

export interface AccrualItem {
  id: string;
  entity_id: string;
  entity_name: string | null;
  supplier: string;
  amount: string;
  lines: AccrualLine[];
  standing: boolean;
  period_from: string;
  end_period: string | null;
  stopped_period: string | null;
  bill_lag_months: number;
  basis: string | null;
  accrues: boolean;
  pair: { id: string; jnl: string | null; state: string; backfill: boolean } | null;
  cleared: { bill_number: string | null; bill_date: string; bill_net: string; difference: string } | null;
}

export interface AccrualPrecedent {
  id: string;
  entity_id: string;
  entity_name: string | null;
  supplier: string;
  test: string | null;
  decision: string;
  reason: string | null;
  applies_to: "this_month" | "until_changed";
  period: string;
  decided_by: string;
  decided_at: string;
  promoted_rule_id: string | null;
}

export interface AccrualFinding { kind: string; item_id?: string; period?: string; text: string; entity?: string }

export interface AccrualTie {
  rows: Array<{ entity_id: string; entity_name: string | null; account_code: string | null; ledger: number; schedule: number; variance: number; ties: boolean; note: string | null }>;
  ties: boolean;
  unread: string[];
}

export interface AccrualMonth {
  period: string;
  label: string;
  entities: Array<{ id: string; slug: string; name: string; accrual_account: string | null; account_set: boolean }>;
  proposals: AccrualProposal[];
  items: AccrualItem[];
  precedents: AccrualPrecedent[];
  findings: AccrualFinding[];
  due: Array<{ item_id: string; period: string; backfill: boolean; supplier: string | null }>;
  tie: AccrualTie | null;
  counts: { open: number; pairs_waiting: number };
  migration_missing?: boolean;
}

export const TEST_LABEL: Record<Test, string> = {
  continuity: "Continuity", backward: "Bill after month end", gap: "Missing month", forward: "Earned, not billed", reverse_cutoff: "Billed early",
};

export const BASIS_LABEL: Record<AccrualProposal["basis_kind"], string> = {
  contract: "Contract or fixed fee", purchase_order: "Purchase order or quote", last_bill: "Last bill for the same supply", estimate: "Estimate",
};

export const DECISION_LABEL: Record<Decision, string> = {
  pending: "Waiting for you", accept: "Accrued", accept_edited: "Accrued, edited", no_accrual: "No accrual", question: "Asked back", standing: "Standing", superseded: "Replaced",
};

// Who wrote a comment or raised a proposal, as the page says it.
export function whoSaid(actor: string | null | undefined): string {
  const a = String(actor ?? "");
  const m = /^agent:(.+)$/.exec(a);
  if (m) return m[1].toUpperCase();
  if (a === "claude") return "Claude";
  if (a.startsWith("platform:")) return "os.stza.io";
  return a;
}

export const isOpen = (p: Pick<AccrualProposal, "decision">) => p.decision === "pending" || p.decision === "question";

// Pence from what the CFO typed: commas allowed, at most two decimals, more than nil.
export function amountOf(typed: string): number | null {
  const s = typed.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const p = Math.round(Number(s) * 100);
  return p > 0 ? p : null;
}

// What the CFO's decision sends, and what stops it. Null body while it cannot go.
export function decisionBody(d: {
  decision: Exclude<Decision, "pending" | "superseded">;
  reason: string;
  appliesTo: "this_month" | "until_changed";
  lines?: Array<{ account_code: string; amount: string }>;
  endPeriod?: string;
  lag?: number;
}): { body: Record<string, unknown> | null; issue: string | null } {
  const reason = d.reason.trim();
  if (d.decision === "no_accrual" && !reason) return { body: null, issue: "Say why there is no accrual: the agents follow it next month." };
  if (d.decision === "question" && !reason) return { body: null, issue: "Write the question." };
  const body: Record<string, unknown> = { decision: d.decision, applies_to: d.appliesTo };
  if (reason) body.reason = reason;
  if (d.decision === "accept_edited") {
    const lines = (d.lines ?? []).filter((l) => l.account_code.trim() || l.amount.trim());
    const bad = lines.find((l) => !l.account_code.trim() || amountOf(l.amount) === null);
    if (!lines.length || bad) return { body: null, issue: "Each line needs an account and an amount above nil." };
    body.lines = lines.map((l) => ({ account_code: l.account_code.trim(), amount: (amountOf(l.amount) as number) / 100 }));
  }
  if (d.decision === "standing") {
    if (d.endPeriod) body.end_period = d.endPeriod;
    if (d.lag !== undefined) body.bill_lag_months = d.lag;
  }
  return { body, issue: null };
}

// The paths the portal may reach. No agent header is ever sent from here, so
// finance-api treats every call as a person's.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const POST_PATH = new RegExp(`^accruals/(run|proposals|proposals/${UUID}/(comments|decide)|precedents/${UUID}/(end|promote)|items/${UUID}/stop)$`, "i");
export const isAccrualPath = (path: string, method: string) => (method === "PUT" ? path === "accruals/settings" : POST_PATH.test(path));

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchAccruals(slug: string, period: string, tie = false): Promise<{ ok: true; data: AccrualMonth } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/accruals?period=${encodeURIComponent(period)}${tie ? "&tie=1" : ""}`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 503 && body.migration_missing) return { ok: true, data: { migration_missing: true } as AccrualMonth };
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as AccrualMonth };
}

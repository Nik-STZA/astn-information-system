// Review: the portal side of finance-api's inbox (lib/review.js). One list per
// client of everything waiting on a person, from Bills, Reconciliations,
// Journals, Xero changes and the Approvals folders. Read-only: each row links to the screen
// where it is acted on, and that screen keeps its own rules. Server-only
// fetches are at the bottom; the rest is pure, so it is tested and safe on
// either side.

export type ReviewKind = "bill" | "rec" | "rec_journal" | "journal" | "xero_change" | "approval";
export type WaitingOn = "CFO" | "FC" | "FM" | "Preparer" | "Outside";

export interface ReviewItem {
  kind: ReviewKind;
  id: string;
  title: string;
  company: string | null;
  amount: string | null;
  currency: string | null;
  waiting_on: WaitingOn;
  since: string | null;
  produced_by: string | null;
  status: string;
  href: string;
  for_you: boolean;
}

export interface ReviewInbox {
  viewer: { email: string | null; role: string | null; waits_as: "CFO" | "FC" | null };
  items: ReviewItem[];
  counts: { total: number; for_you: number; by_kind: Partial<Record<ReviewKind, number>> };
  missing: Array<{ source: string; note: string }>;
}

export const KIND_LABEL: Record<ReviewKind, string> = {
  bill: "Bill",
  rec: "Reconciliation",
  rec_journal: "Journal on a rec",
  journal: "Journal",
  xero_change: "Xero change",
  approval: "Approvals folder",
};

export const WAITING_LABEL: Record<WaitingOn, string> = {
  CFO: "CFO",
  FC: "FC",
  FM: "FM",
  Preparer: "Preparer",
  Outside: "Someone outside",
};

// The filter chips. A journal proposed on a reconciliation is a journal, so it
// sits under Journals; it is still acted on at its reconciliation.
export type Filter = "all" | "bills" | "recs" | "journals" | "xero" | "approvals";

export const FILTERS: Array<{ key: Filter; label: string; kinds: ReviewKind[] }> = [
  { key: "all", label: "All", kinds: ["bill", "rec", "rec_journal", "journal", "xero_change", "approval"] },
  { key: "bills", label: "Bills", kinds: ["bill"] },
  { key: "recs", label: "Reconciliations", kinds: ["rec"] },
  { key: "journals", label: "Journals", kinds: ["journal", "rec_journal"] },
  { key: "xero", label: "Xero changes", kinds: ["xero_change"] },
  { key: "approvals", label: "Approvals", kinds: ["approval"] },
];

export const isFilter = (v: string | null | undefined): v is Filter => FILTERS.some((f) => f.key === v);

export function filterCount(items: ReviewItem[], filter: Filter): number {
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? [];
  return items.filter((i) => kinds.includes(i.kind)).length;
}

// The page's two groups, oldest first within each. An item with no time goes
// last, so it is never read as the oldest.
export function grouped(items: ReviewItem[], filter: Filter = "all"): { forYou: ReviewItem[]; others: ReviewItem[] } {
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? [];
  const time = (i: ReviewItem) => (i.since ? Date.parse(i.since) : Number.POSITIVE_INFINITY);
  const shown = items.filter((i) => kinds.includes(i.kind)).sort((a, b) => time(a) - time(b));
  return { forYou: shown.filter((i) => i.for_you), others: shown.filter((i) => !i.for_you) };
}

// How long it has waited, as a person says it: "under an hour", "5 hours",
// "1 day", "3 days".
export function ageText(since: string | null | undefined, now = Date.now()): string {
  if (!since) return "-";
  const t = Date.parse(since);
  if (Number.isNaN(t)) return "-";
  const hours = Math.floor(Math.max(0, now - t) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

// "GBP 1,234.50", or the figure alone when the source has no currency. Blank
// when there is no amount: a reconciliation or a folder may have none.
export function amountText(amount: string | null, currency: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

// ── Server only ─────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

async function read<T>(slug: string, path: string, actorEmail: string | null): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/${path}`, {
    headers: { "X-API-Key": key, ...(actorEmail ? { "X-Actor-Email": actorEmail } : {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as T };
}

export const fetchReview = (slug: string, actorEmail: string | null) => read<ReviewInbox>(slug, "review", actorEmail);

export const fetchReviewCount = (slug: string, actorEmail: string | null) =>
  read<{ total: number; for_you: number; missing: string[] }>(slug, "review/count", actorEmail);

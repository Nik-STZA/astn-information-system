// Xero changes: the portal side of finance-api's proposed changes to Xero other
// than journals (finance-api/lib/xero-changes.js). Fixed assets first. An agent
// or a person proposes; the CFO approves here; finance-api makes the change in
// Xero through the same write route Cowork uses. Pure helpers first, the
// server-only fetch at the bottom.

export type ChangeState = "proposed" | "approved" | "written" | "rejected";

export interface AssetRecord {
  assetName: string;
  assetNumber: string;
  assetTypeId: string;
  purchaseDate: string;
  purchasePrice: number;
  assetStatus: string;
  description?: string;
  serialNumber?: string;
  warrantyExpiryDate?: string;
  bookDepreciationSetting?: { depreciationMethod?: string; averagingMethod?: string; effectiveLifeYears?: number; depreciationRate?: number };
  bookDepreciationDetail?: { depreciationStartDate?: string };
}

export interface XeroChange {
  id: string;
  kind: string;
  label: string;
  entity_name: string;
  summary: string;
  reason: string | null;
  source_doc: string | null;
  input: { what?: string; record?: AssetRecord } & Record<string, unknown>;
  source: "person" | "agent";
  proposed_by: string;
  state: ChangeState;
  approved_by: string | null;
  rejected_by: string | null;
  attempt_outcome: "refused" | "unknown" | null;
  in_flight: boolean;
  last_error: string | null;
  xero_id: string | null;
  written_at: string | null;
  after: string | null;
  created_at: string;
}

export interface XeroChangeList {
  migration_missing?: boolean;
  changes: XeroChange[];
  counts: { waiting: number };
}

// Where each change is, for the page's groups, in the order they show.
export type Group = "waiting" | "check" | "written" | "rejected";

export function groupOf(c: XeroChange): Group | null {
  if (c.state === "proposed") return "waiting";
  if (c.state === "approved") return c.in_flight ? null : "check";
  if (c.state === "written") return "written";
  return "rejected";
}

export const GROUPS: Array<{ key: Group; title: string }> = [
  { key: "waiting", title: "Waiting for you" },
  { key: "check", title: "Check Xero" },
  { key: "written", title: "Made in Xero" },
  { key: "rejected", title: "Rejected" },
];

export function grouped(list: XeroChange[]): Array<{ key: Group; title: string; rows: XeroChange[] }> {
  return GROUPS.map((g) => ({ ...g, rows: list.filter((c) => groupOf(c) === g.key) }));
}

// agent:fm1 -> FM1; a person stays as their address.
export const proposerLabel = (by: string) => {
  const m = /^agent:(.+)$/.exec(by);
  return m ? m[1].toUpperCase() : by;
};

const METHOD_WORDS: Record<string, string> = {
  StraightLine: "Straight line", DiminishingValue100: "Diminishing value 100%", DiminishingValue150: "Diminishing value 150%",
  DiminishingValue200: "Diminishing value 200%", FullDepreciation: "Full depreciation", NoDepreciation: "No depreciation",
};

// The asset as the CFO should read it before approving: label and value pairs.
export function assetFacts(r: AssetRecord | undefined): Array<[string, string]> {
  if (!r) return [];
  const d = r.bookDepreciationSetting ?? {};
  const life = d.effectiveLifeYears ? `${d.effectiveLifeYears} year${d.effectiveLifeYears === 1 ? "" : "s"}` : d.depreciationRate ? `${d.depreciationRate}% a year` : null;
  const facts: Array<[string, string | null | undefined]> = [
    ["Number", r.assetNumber],
    ["Name", r.assetName],
    ["Bought", dateText(r.purchaseDate)],
    ["Cost", Number(r.purchasePrice).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
    ["Depreciation", d.depreciationMethod ? [METHOD_WORDS[d.depreciationMethod] ?? d.depreciationMethod, life].filter(Boolean).join(", ") : "Not set: needed before it is registered"],
    ["Depreciates from", dateText(r.bookDepreciationDetail?.depreciationStartDate)],
    ["Description", r.description],
    ["Serial number", r.serialNumber],
    ["Warranty to", dateText(r.warrantyExpiryDate)],
    ["Goes to Xero as", r.assetStatus === "Draft" ? "A draft asset. You register it in Xero" : r.assetStatus],
  ];
  return facts.filter((f): f is [string, string] => Boolean(f[1]));
}

function dateText(d: string | undefined): string | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CHANGE_PATH = new RegExp(`^xero-changes/${UUID}/(approve|reject)$`, "i");
export const isChangePath = (path: string) => CHANGE_PATH.test(path);

// ── Server only ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export async function fetchXeroChanges(slug: string, all = false): Promise<{ ok: true; data: XeroChangeList } | { ok: false; error: string; status: number }> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { ok: false, error: "FINANCE_API_KEY is not configured", status: 500 };
  const res = await fetch(`${BASE_URL}/api/finance/clients/${encodeURIComponent(slug)}/xero-changes${all ? "?state=all" : ""}`, {
    headers: { "X-API-Key": key }, cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `upstream ${res.status}`, status: res.status };
  return { ok: true, data: body as XeroChangeList };
}

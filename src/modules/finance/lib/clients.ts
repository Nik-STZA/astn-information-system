// The client master (finance-api lib/clients.js, migration 029): one record per
// client, shared by every service. Types, labels, fetchers and the pure helpers
// the Clients pages use.

const BASE_URL = process.env.FINANCE_API_URL ?? "http://127.0.0.1:8080";

export type ClientStatus = "prospect" | "engaged" | "former" | "internal";
export type PipelineStage = "lead" | "discussion" | "proposal" | "agreed";
export type ServiceKey = "finance" | "data_protection" | "consulting";
export type ServiceState = "active" | "completed" | null;

export interface ClientService {
  service: ServiceKey;
  state: ServiceState;
  started_on: string | null;
  ended_on: string | null;
  closing_note: string | null;
}

export interface MasterClient {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  jurisdiction: string | null;
  status: ClientStatus;
  pipeline_stage: PipelineStage | null;
  contact: string | null;
  lead_email: string | null;
  ended_reason: string | null;
  created_at: string;
  updated_at: string;
  services: ClientService[];
  compliance_client_id: string | null;
  companies: number;
}

export interface ClientEvent {
  action: string;
  detail: Record<string, unknown>;
  actor_email: string;
  at: string;
}

export const STATUS_LABEL: Record<ClientStatus, string> = {
  prospect: "Prospect",
  engaged: "Client",
  former: "Former",
  internal: "Internal",
};

export const STATUS_TONE: Record<ClientStatus, string> = {
  prospect: "s-blue",
  engaged: "s-green",
  former: "s-neutral",
  internal: "s-amber",
};

export const STAGES: Array<{ key: PipelineStage; label: string }> = [
  { key: "lead", label: "First contact" },
  { key: "discussion", label: "In discussion" },
  { key: "proposal", label: "Proposal sent" },
  { key: "agreed", label: "Agreed" },
];

export const SERVICES: Array<{ key: ServiceKey; label: string; blurb: string }> = [
  { key: "finance", label: "Finance", blurb: "Bookkeeping, month-end, management packs and agents, on Xero." },
  { key: "data_protection", label: "Data protection", blurb: "POPIA, GDPR and UAE PDPL: assessments, findings, breaches and requests." },
  { key: "consulting", label: "Consulting", blurb: "Advisory projects: scope, work and deliverables." },
];

export const serviceLabel = (k: string) => SERVICES.find((s) => s.key === k)?.label ?? k;

// ── Fetchers (server side) ────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const key = process.env.FINANCE_API_KEY;
  if (!key) throw new Error("FINANCE_API_KEY is not configured");
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "X-API-Key": key }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `finance-api ${res.status}`);
  return body as T;
}

export async function fetchMasterClients(): Promise<MasterClient[]> {
  return (await get<{ data: MasterClient[] }>("/api/clients")).data;
}

export async function fetchMasterClient(slug: string): Promise<(MasterClient & { events: ClientEvent[] }) | null> {
  try {
    return await get<MasterClient & { events: ClientEvent[] }>(`/api/clients/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e instanceof Error && /client not found/.test(e.message)) return null;
    throw e;
  }
}

// The paths the portal's proxy passes through: "" (create), "<slug>" (change)
// and "<slug>/services/<service>" (set a service).
export function isMasterPath(path: string): boolean {
  return path === "" || /^[a-z0-9-]+$/.test(path) || /^[a-z0-9-]+\/services\/(finance|data_protection|consulting)$/.test(path);
}

export async function masterCall(path: string, method: string, actorEmail: string, body?: unknown) {
  const key = process.env.FINANCE_API_KEY;
  if (!key) return { status: 500, body: { error: "FINANCE_API_KEY is not configured" } };
  const res = await fetch(`${BASE_URL}/api/clients${path ? `/${path}` : ""}`, {
    method,
    headers: { "X-API-Key": key, "X-Actor-Email": actorEmail, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export type ClientFilter = "clients" | "prospects" | "former" | "all";

// Clients means the ones we work with: engaged and internal.
export function filterClients(list: MasterClient[], filter: ClientFilter): MasterClient[] {
  if (filter === "clients") return list.filter((c) => c.status === "engaged" || c.status === "internal");
  if (filter === "prospects") return list.filter((c) => c.status === "prospect");
  if (filter === "former") return list.filter((c) => c.status === "former");
  return list;
}

export const activeServices = (c: Pick<MasterClient, "services">) => c.services.filter((s) => s.state === "active");
export const pastServices = (c: Pick<MasterClient, "services">) => c.services.filter((s) => s.state === "completed");

// An engaged client with nothing active may have ended: set-up asks, never decides.
export const mayHaveEnded = (c: Pick<MasterClient, "status" | "services">) =>
  c.status === "engaged" && activeServices(c).length === 0;

const stateWord = (s: unknown) => (s === "active" ? "active" : s === "completed" ? "completed" : "not taken");

// One line of history, in words.
export function eventText(e: ClientEvent): string {
  const d = e.detail as Record<string, { from?: unknown; to?: unknown } | unknown>;
  if (e.action === "created") return (e.detail as { from?: string }).from ? `Added from the ${(e.detail as { from: string }).from}` : "Added";
  if (e.action === "linked") return "Linked to its data protection record";
  if (e.action === "service") {
    const x = e.detail as { service?: string; from?: unknown; to?: unknown };
    return `${serviceLabel(String(x.service))}: ${stateWord(x.from)} to ${stateWord(x.to)}`;
  }
  if (e.action === "status") {
    const s = d.status as { from?: ClientStatus; to?: ClientStatus } | undefined;
    if (s?.to) return `Status: ${STATUS_LABEL[s.from as ClientStatus] ?? "none"} to ${STATUS_LABEL[s.to]}`;
  }
  if ("pipeline_stage" in d) {
    const s = d.pipeline_stage as { to?: PipelineStage };
    if (s?.to) return `Stage: ${STAGES.find((x) => x.key === s.to)?.label ?? s.to}`;
  }
  const fields = Object.keys(d).map((k) => k.replace(/_/g, " "));
  return fields.length ? `Changed ${fields.join(", ")}` : "Changed";
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export interface PipelineColumn {
  stage: PipelineStage;
  label: string;
  clients: MasterClient[];
}

// Prospects by stage, oldest first in each column; a prospect with no stage
// counts as First contact.
export function pipelineColumns(list: MasterClient[]): PipelineColumn[] {
  const prospects = list.filter((c) => c.status === "prospect").sort((a, b) => a.created_at.localeCompare(b.created_at));
  return STAGES.map((s) => ({ stage: s.key, label: s.label, clients: prospects.filter((c) => (c.pipeline_stage ?? "lead") === s.key) }));
}

// The stage one step back or on, or null at either end.
export function stageStep(stage: PipelineStage | null, dir: -1 | 1): PipelineStage | null {
  const i = STAGES.findIndex((s) => s.key === (stage ?? "lead"));
  return STAGES[i + dir]?.key ?? null;
}

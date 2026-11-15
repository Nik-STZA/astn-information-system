"use server";

// Registry candidate actions from os.stza.io: submit, approve, send back,
// reject. Each passes the signed-in person (IAP) as X-Actor-Email; finance-api
// records them on the candidate and in finance.audit_log.

import { revalidatePath } from "next/cache";
import { getAuthEmail } from "@/lib/auth";
import { financeApi } from "@/lib/data/registry-candidates";
import {
  MAX_BATCH,
  parseCandidateLines,
  type ActionResult,
  type CandidateSubmission,
  type Proposal,
} from "@/lib/data/registry-candidates-shared";

const PATH = "/registry/candidates";

function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function signedIn(): Promise<string | null> {
  return await getAuthEmail();
}

const fail = (message: string, extra: Partial<Extract<ActionResult, { status: "error" }>> = {}): ActionResult =>
  ({ status: "error", message, at: Date.now(), ...extra });
const done = (message: string): ActionResult => ({ status: "ok", message, at: Date.now() });

export async function submitCandidates(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");

  const candidates: CandidateSubmission[] = [];
  const name = text(formData, "name");
  if (name) {
    candidates.push({
      name,
      website: text(formData, "website"),
      country: text(formData, "country"),
      sport: text(formData, "sport"),
      note: text(formData, "note"),
    });
  }
  const pasted = text(formData, "batch");
  if (pasted) {
    const parsed = parseCandidateLines(pasted);
    if (parsed.error) return fail(parsed.error);
    candidates.push(...parsed.values);
  }
  if (!candidates.length) return fail("Enter a name, or paste a list.");

  const r = await financeApi<{ count: number }>("/api/registry/candidates", {
    method: "POST", body: { candidates }, actorEmail: email,
  });
  if (!r.ok) return fail(r.error ?? "The candidates were not saved.");
  revalidatePath(PATH);
  const n = r.data?.count ?? candidates.length;
  return done(`${n} candidate${n === 1 ? "" : "s"} sent to the reviewer. Each takes a minute or two.`);
}

const PROPOSAL_FIELDS: Array<keyof Proposal> = [
  "organization_name", "country_iso", "sport_code", "region_province", "level", "organization_type",
  "astn_vertical", "astn_sub_vertical", "organization_website", "founded_year", "operational_status",
  "business_model", "source_confidence", "verification_source", "tags", "notes",
];

export async function approveCandidate(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");

  const fields: Record<string, string | number | null> = {};
  for (const f of PROPOSAL_FIELDS) {
    if (!formData.has(f)) continue;
    const v = text(formData, f);
    fields[f] = f === "founded_year" ? (v ? Number(v) : null) : v;
  }
  const r = await financeApi<{ astn_id: string }>(`/api/registry/candidates/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: { fields, allowDuplicate: formData.get("allowDuplicate") === "1" },
    actorEmail: email,
  });
  if (!r.ok) {
    const errors = Array.isArray(r.body?.errors) ? (r.body?.errors as string[]) : undefined;
    return fail(r.error ?? "Not added.", { errors, canOverride: r.body?.can_override === true });
  }
  revalidatePath(PATH);
  revalidatePath("/registry");
  return done(`Added to the registry as ${r.data?.astn_id}.`);
}

export async function rerunCandidate(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");
  const r = await financeApi(`/api/registry/candidates/${encodeURIComponent(id)}/rerun`, {
    method: "POST", body: { note: text(formData, "note") }, actorEmail: email,
  });
  if (!r.ok) return fail(r.error ?? "Not sent back.");
  revalidatePath(PATH);
  return done("Sent back to the reviewer.");
}

// Sends existing records to the researcher, in batches of MAX_BATCH. Records
// already with the researcher, or re-checked in the last 90 days, are skipped
// unless again is set for a single record sent back on purpose.
export async function queueReverify(ids: string[], again: boolean, _prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");
  if (!ids.length) return fail("Nothing to send.");
  let queued = 0;
  let open = 0;
  let recent = 0;
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const r = await financeApi<{ count: number; skipped_open?: number; skipped_recent?: number }>("/api/registry/reverify", {
      method: "POST", body: { organizationIds: ids.slice(i, i + MAX_BATCH), again: again && ids.length === 1 }, actorEmail: email,
    });
    if (!r.ok) return fail(queued ? `${queued} sent, then: ${r.error}` : (r.error ?? "Not sent."));
    queued += r.data?.count ?? 0;
    open += r.data?.skipped_open ?? 0;
    recent += r.data?.skipped_recent ?? 0;
  }
  revalidatePath(PATH);
  revalidatePath("/registry/verify");
  const skippedNote = [open ? `${open} already with the researcher` : null, recent ? `${recent} checked in the last 90 days` : null]
    .filter(Boolean).join(", ");
  if (!queued) return done(skippedNote ? `Nothing sent: ${skippedNote}.` : "Nothing sent.");
  return done(`${queued} sent to the researcher${skippedNote ? ` (skipped ${skippedNote})` : ""}. Results appear under Candidates.`);
}

// Applies the ticked changes of a re-verification.
export async function applyReverify(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");
  const apply = formData.getAll("apply").filter((v): v is string => typeof v === "string");
  const fields: Record<string, string | number | null> = {};
  for (const f of apply) {
    const v = text(formData, `value_${f}`);
    if (v !== null) fields[f] = /_year$/.test(f) ? Number(v) : v;
  }
  const note = text(formData, "notes_append");
  if (note) fields.notes_append = note;
  const r = await financeApi<{ astn_id: string; applied: string[] }>(`/api/registry/candidates/${encodeURIComponent(id)}/approve`, {
    method: "POST", body: { apply, fields }, actorEmail: email,
  });
  if (!r.ok) {
    const errors = Array.isArray(r.body?.errors) ? (r.body?.errors as string[]) : undefined;
    return fail(r.error ?? "Not applied.", { errors });
  }
  revalidatePath(PATH);
  revalidatePath("/registry/verify");
  const n = r.data?.applied?.length ?? 0;
  return done(n ? `${r.data?.astn_id}: ${n} change${n === 1 ? "" : "s"} applied.` : `${r.data?.astn_id}: marked as checked.`);
}

export async function confirmDuplicate(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");
  const r = await financeApi<{ astn_id: string }>(`/api/registry/candidates/${encodeURIComponent(id)}/confirm-duplicate`, {
    method: "POST",
    body: { organizationId: text(formData, "organizationId"), note: text(formData, "note") },
    actorEmail: email,
  });
  if (!r.ok) return fail(r.error ?? "Not closed.");
  revalidatePath(PATH);
  return done(`Closed as a duplicate of ${r.data?.astn_id}.`);
}

export async function rejectCandidate(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = await signedIn();
  if (!email) return fail("You are not signed in.");
  const r = await financeApi(`/api/registry/candidates/${encodeURIComponent(id)}/reject`, {
    method: "POST", body: { note: text(formData, "note") }, actorEmail: email,
  });
  if (!r.ok) return fail(r.error ?? "Not rejected.");
  revalidatePath(PATH);
  return done("Rejected.");
}

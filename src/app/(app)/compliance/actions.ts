"use server";

import {
  createProspect,
  updateProspect,
  deleteProspect,
  createClient,
  updateClient,
  createActivity,
} from "@/lib/data/compliance";
import { revalidatePath } from "next/cache";

// ─── Prospect actions ───────────────────────────────────────────────────────

export async function addProspect(formData: FormData) {
  const data = {
    company_name: formData.get("company_name") as string,
    company_website: (formData.get("company_website") as string) || null,
    company_country: (formData.get("company_country") as string) || null,
    sector: (formData.get("sector") as string) || null,
    sa_presence_evidence:
      (formData.get("sa_presence_evidence") as string) || null,
    ir_registered: formData.get("ir_registered") === "true" ? true : formData.get("ir_registered") === "false" ? false : null,
    outreach_status: (formData.get("outreach_status") as string) || "identified",
    priority: (formData.get("priority") as string) || "medium",
    estimated_tier: (formData.get("estimated_tier") as string) || null,
    notes: (formData.get("notes") as string) || null,
    privacy_policy_url: (formData.get("privacy_policy_url") as string) || null,
    terms_url: (formData.get("terms_url") as string) || null,
    linkedin_url: (formData.get("linkedin_url") as string) || null,
    app_store_url: (formData.get("app_store_url") as string) || null,
    other_urls: (formData.get("other_urls") as string) || null,
  };

  const res = await createProspect(data);
  revalidatePath("/compliance");
  return res;
}

export async function editProspect(id: string, formData: FormData) {
  const data: Record<string, unknown> = {};
  const fields = [
    "company_name", "company_website", "company_country", "sector",
    "sa_presence_evidence", "outreach_status", "priority", "estimated_tier",
    "notes", "outreach_date", "outreach_channel", "response_date",
    "privacy_policy_url", "terms_url", "linkedin_url", "app_store_url", "other_urls",
  ];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("ir_registered")) {
    const v = formData.get("ir_registered") as string;
    data.ir_registered = v === "true" ? true : v === "false" ? false : null;
  }

  const res = await updateProspect(id, data);
  revalidatePath("/compliance");
  return res;
}

export async function removeProspect(id: string) {
  const res = await deleteProspect(id);
  revalidatePath("/compliance");
  return res;
}

// ─── Client actions ─────────────────────────────────────────────────────────

export async function addClient(formData: FormData) {
  const data = {
    company_name: formData.get("company_name") as string,
    company_website: (formData.get("company_website") as string) || null,
    company_country: (formData.get("company_country") as string) || null,
    contact_name: (formData.get("contact_name") as string) || null,
    contact_email: (formData.get("contact_email") as string) || null,
    contact_role: (formData.get("contact_role") as string) || null,
    status: (formData.get("status") as string) || "prospect",
    service_tier: (formData.get("service_tier") as string) || null,
    annual_fee_gbp: formData.get("annual_fee_gbp")
      ? Number(formData.get("annual_fee_gbp"))
      : null,
    engagement_start: (formData.get("engagement_start") as string) || null,
    processes_biometric: formData.get("processes_biometric") === "true",
    processes_minors: formData.get("processes_minors") === "true",
    notes: (formData.get("notes") as string) || null,
  };

  const res = await createClient(data);
  revalidatePath("/compliance");
  return res;
}

export async function editClient(id: number, formData: FormData) {
  const data: Record<string, unknown> = {};
  const fields = [
    "company_name", "company_website", "company_country",
    "contact_name", "contact_email", "contact_role",
    "status", "service_tier", "notes", "engagement_start",
  ];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("annual_fee_gbp")) {
    const v = formData.get("annual_fee_gbp") as string;
    data.annual_fee_gbp = v ? Number(v) : null;
  }
  if (formData.has("processes_biometric")) {
    data.processes_biometric = formData.get("processes_biometric") === "true";
  }
  if (formData.has("processes_minors")) {
    data.processes_minors = formData.get("processes_minors") === "true";
  }

  const res = await updateClient(id, data);
  revalidatePath("/compliance");
  return res;
}

// ─── Activity actions ───────────────────────────────────────────────────────

export async function addActivity(formData: FormData) {
  const data = {
    client_id: Number(formData.get("client_id")),
    activity_date: (formData.get("activity_date") as string) || undefined,
    activity_type: formData.get("activity_type") as string,
    description: (formData.get("description") as string) || null,
    hours_spent: formData.get("hours_spent")
      ? Number(formData.get("hours_spent"))
      : null,
    performed_by: (formData.get("performed_by") as string) || null,
    next_due: (formData.get("next_due") as string) || null,
  };

  const res = await createActivity(data);
  revalidatePath("/compliance");
  return res;
}

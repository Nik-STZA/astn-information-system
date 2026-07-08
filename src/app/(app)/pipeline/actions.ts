"use server";

import {
  createOpportunity,
  updateOpportunity,
  createInteraction,
} from "@/lib/data/pipeline";
import { revalidatePath } from "next/cache";

export async function addOpportunity(formData: FormData) {
  const data = {
    opportunity_name: formData.get("opportunity_name") as string,
    prospect_name: (formData.get("prospect_name") as string) || null,
    client_name: (formData.get("client_name") as string) || null,
    service_type: (formData.get("service_type") as string) || null,
    stage: (formData.get("stage") as string) || "identified",
    value_gbp: formData.get("value_gbp")
      ? Number(formData.get("value_gbp"))
      : null,
    value_recurring: formData.get("value_recurring") === "true",
    expected_close_date:
      (formData.get("expected_close_date") as string) || null,
    owner: (formData.get("owner") as string) || null,
    notes: (formData.get("notes") as string) || null,
  };

  const res = await createOpportunity(data);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  return res;
}

export async function editOpportunity(id: number, formData: FormData) {
  const data: Record<string, unknown> = {};
  const fields = [
    "opportunity_name", "prospect_name", "client_name",
    "service_type", "stage", "owner", "notes", "expected_close_date",
  ];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null && v !== "") data[f] = v;
  }
  if (formData.has("value_gbp")) {
    const v = formData.get("value_gbp") as string;
    data.value_gbp = v ? Number(v) : null;
  }
  if (formData.has("value_recurring")) {
    data.value_recurring = formData.get("value_recurring") === "true";
  }

  const res = await updateOpportunity(id, data);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  return res;
}

export async function addInteraction(formData: FormData) {
  const data = {
    pipeline_id: formData.get("pipeline_id")
      ? Number(formData.get("pipeline_id"))
      : null,
    prospect_id: formData.get("prospect_id")
      ? Number(formData.get("prospect_id"))
      : null,
    interaction_date:
      (formData.get("interaction_date") as string) ||
      new Date().toISOString().split("T")[0],
    channel: (formData.get("channel") as string) || null,
    direction: (formData.get("direction") as string) || "outbound",
    summary: (formData.get("summary") as string) || null,
    next_action: (formData.get("next_action") as string) || null,
    next_action_date:
      (formData.get("next_action_date") as string) || null,
  };

  const res = await createInteraction(data);
  revalidatePath("/pipeline");
  return res;
}

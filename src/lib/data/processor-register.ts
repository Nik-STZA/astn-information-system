/**
 * Processor register + regulator registrations (migrations 020, 021).
 * The systems stock-take / DPA action tracker and per-jurisdiction regulator
 * registrations, surfaced in the compliance client workspace.
 */
import { cloudRunFetch, cloudRunMutate } from "../cloud-run";

export type Processor = {
  id: number;
  client_id: string;
  system_name: string;
  category: string | null; // ai_llm | infrastructure | business_saas
  purpose: string | null;
  data_categories: string | null;
  tier: string | null;
  dpa_status:
    | "in_place"
    | "available_unconfirmed"
    | "not_covered"
    | "exiting"
    | "not_required"
    | "decommissioned"
    | "unknown";
  action: string | null;
  status: "active" | "exiting" | "decommissioned";
  notes: string | null;
};

export type RegulatorRegistration = {
  id: number;
  client_id: string;
  jurisdiction_code: string;
  regulator: string;
  registration_number: string | null;
  registration_date: string | null;
  status: string;
  notes: string | null;
};

export async function fetchClientProcessors(clientId: string) {
  return cloudRunFetch<{ count: number; data: Processor[] }>(
    `/api/clients/${clientId}/processors`,
    { cache: "no-store" },
  );
}

export async function updateProcessor(pid: number, patch: Partial<Processor>) {
  return cloudRunMutate<Processor>(`/api/processors/${pid}`, "PUT", patch);
}

export async function fetchClientRegulatorRegistrations(clientId: string) {
  return cloudRunFetch<{ count: number; data: RegulatorRegistration[] }>(
    `/api/clients/${clientId}/regulator-registrations`,
    { cache: "no-store" },
  );
}

export async function updateRegulatorRegistration(
  id: number,
  patch: Partial<RegulatorRegistration>,
) {
  return cloudRunMutate<RegulatorRegistration>(
    `/api/regulator-registrations/${id}`,
    "PUT",
    patch,
  );
}

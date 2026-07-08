/**
 * Reports page — server component.
 * Fetches all data, passes to ReportsClient for CSV export and summary.
 */

import { fetchProspects, fetchClients } from "@/lib/data/compliance";
import { fetchPipeline, fetchDashboardStats } from "@/lib/data/pipeline";
import { fetchCountries } from "@/lib/data/data-protection";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  const [prospectsRes, clientsRes, pipelineRes, statsRes, countriesRes] =
    await Promise.all([
      fetchProspects(),
      fetchClients(),
      fetchPipeline(),
      fetchDashboardStats(),
      fetchCountries(),
    ]);

  return (
    <ReportsClient
      prospects={prospectsRes.data?.data ?? []}
      clients={clientsRes.data?.data ?? []}
      opportunities={pipelineRes.data?.data ?? []}
      stats={statsRes.data ?? null}
      countries={countriesRes.data?.data ?? []}
      errors={[prospectsRes.error, clientsRes.error, pipelineRes.error, statsRes.error, countriesRes.error].filter(Boolean) as string[]}
    />
  );
}

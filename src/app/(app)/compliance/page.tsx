/**
 * Compliance Services page — server component wrapper.
 * Fetches data server-side, passes to interactive client component.
 */

import { fetchProspects, fetchClients } from "@/lib/data/compliance";
import ComplianceClient from "./ComplianceClient";

export default async function CompliancePage() {
  const [prospectsRes, clientsRes] = await Promise.all([
    fetchProspects(),
    fetchClients(),
  ]);

  const prospects = prospectsRes.data?.data ?? [];
  const clients = clientsRes.data?.data ?? [];

  if (prospectsRes.error || clientsRes.error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong> {prospectsRes.error || clientsRes.error}
        </div>
      </div>
    );
  }

  return (
    <ComplianceClient
      initialProspects={prospects}
      initialClients={clients}
    />
  );
}

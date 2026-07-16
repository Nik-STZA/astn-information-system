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

  const apiError = prospectsRes.error || clientsRes.error;

  return (
    <>
      {apiError && (
        <div className="px-8 pt-4">
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg p-4">
            <strong>Note:</strong> Some data could not be loaded from the API.
            The page may show incomplete information.
            <details className="mt-1 text-xs">
              <summary>Details</summary>
              {apiError}
            </details>
          </div>
        </div>
      )}
      <ComplianceClient
        initialProspects={prospects}
        initialClients={clients}
      />
    </>
  );
}

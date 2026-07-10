/**
 * Clients page — server component wrapper.
 * Fetches clients from the compliance API, plus summary data for the management tabs.
 */

import { fetchClients } from "@/lib/data/compliance";
import { fetchClientManagementSummary } from "@/lib/data/client-management";
import ClientsClient from "./ClientsClient";

export default async function ClientsPage() {
  const [clientsRes, summaryRes] = await Promise.all([
    fetchClients(),
    fetchClientManagementSummary(),
  ]);

  const clients = clientsRes.data?.data ?? [];
  const summary = summaryRes.data ?? null;

  if (clientsRes.error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong> {clientsRes.error}
        </div>
      </div>
    );
  }

  return <ClientsClient initialClients={clients} summary={summary} />;
}

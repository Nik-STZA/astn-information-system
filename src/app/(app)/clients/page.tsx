/**
 * Client Management page — server component wrapper.
 * Fetches clients + cross-client task/correspondence data,
 * passes to interactive client component.
 */

import { fetchClients } from "@/lib/data/compliance";
import { fetchAllTasks, fetchAllCorrespondence, fetchClientManagementSummary } from "@/lib/data/client-management";
import ClientManagementClient from "./ClientManagementClient";

export default async function ClientManagementPage() {
  const [clientsRes, tasksRes, correspondenceRes, summaryRes] = await Promise.all([
    fetchClients(),
    fetchAllTasks(),
    fetchAllCorrespondence(),
    fetchClientManagementSummary(),
  ]);

  const clients = clientsRes.data?.data ?? [];
  const tasks = tasksRes.data?.data ?? [];
  const correspondence = correspondenceRes.data?.data ?? [];
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

  return (
    <ClientManagementClient
      initialClients={clients}
      initialTasks={tasks}
      initialCorrespondence={correspondence}
      summary={summary}
    />
  );
}

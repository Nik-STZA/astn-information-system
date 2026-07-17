import { redirect } from "next/navigation";
import { fetchClients } from "@/lib/data/compliance";
import { fetchClientRemediation, fetchClientAudit } from "@/lib/data/remediation";
import RemediationClient from "./RemediationClient";

export default async function ClientRemediationPage({
  params,
}: {
  params: { id: string };
}) {
  const clientId = params.id;
  if (!clientId) redirect("/compliance");

  const [clientsRes, remediationRes, auditRes] = await Promise.all([
    fetchClients(),
    fetchClientRemediation(clientId),
    fetchClientAudit(clientId, 200),
  ]);

  const clients = clientsRes.data?.data ?? [];
  const client = clients.find((c) => c.id === clientId);
  if (!client) redirect("/compliance");

  const items = remediationRes.data?.data ?? [];
  const auditLog = auditRes.data?.data ?? [];

  return (
    <RemediationClient
      client={client}
      initialItems={items}
      initialAudit={auditLog}
    />
  );
}

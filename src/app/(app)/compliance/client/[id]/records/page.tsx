import { redirect } from "next/navigation";
import { fetchClients } from "@/lib/data/compliance";
import ClientRecords from "./ClientRecords";

// One client's data protection records: engagements, IO registrations, data
// mapping, tasks, DSARs, correspondence and breaches. The sidebar opens it
// from the client's Data protection section.
export default async function ClientRecordsPage({ params }: { params: { id: string } }) {
  const res = await fetchClients();
  const client = (res.data?.data ?? []).find((c) => c.id === params.id);
  if (!client) redirect("/clients/all");
  return <ClientRecords client={client} />;
}

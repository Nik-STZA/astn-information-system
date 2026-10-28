// One client's set-up in the client master: status, details, services, history.

import { notFound } from "next/navigation";
import ClientSetup from "@/modules/finance/components/ClientSetup";
import { fetchMasterClient } from "@/modules/finance/lib/clients";

export const dynamic = "force-dynamic";

export default async function ClientSetupPage({ params }: { params: { slug: string } }) {
  const client = await fetchMasterClient(params.slug);
  if (!client) notFound();
  const { events, ...rest } = client;
  return <ClientSetup client={rest} events={events} />;
}

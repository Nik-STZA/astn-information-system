// One client's set-up in the client master: status, details, services, the
// group and its companies, history.

import { notFound } from "next/navigation";
import ClientSetup from "@/modules/finance/components/ClientSetup";
import { fetchClientProfile, fetchMasterClient } from "@/modules/finance/lib/clients";

export const dynamic = "force-dynamic";

export default async function ClientSetupPage({ params }: { params: { slug: string } }) {
  const [client, profile] = await Promise.all([fetchMasterClient(params.slug), fetchClientProfile(params.slug)]);
  if (!client) notFound();
  const { events, ...rest } = client;
  return <ClientSetup client={rest} events={events} profile={profile} />;
}

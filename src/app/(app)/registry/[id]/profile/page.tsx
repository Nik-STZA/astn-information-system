/**
 * Organisation profile report — server component.
 * Fetches the organisation and passes to ProfileReportClient for doc-page rendering.
 */

import { notFound } from "next/navigation";
import { fetchOrganization } from "@/lib/data/registry";
import ProfileReportClient from "./ProfileReportClient";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProfileReportPage({ params }: Props) {
  const { id } = await params;
  const org = await fetchOrganization(id);
  if (!org) notFound();
  return <ProfileReportClient org={org} />;
}

/**
 * POPIA Assessment page — server component.
 * Fetches prospect + country data, passes to AssessmentClient for document rendering.
 */

import { fetchProspects } from "@/lib/data/compliance";
import { fetchCountries, fetchEnforcement } from "@/lib/data/data-protection";
import AssessmentClient from "./AssessmentClient";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AssessmentPage({ params }: Props) {
  const { id } = await params;

  const [prospectsRes, countriesRes, enforcementRes] = await Promise.all([
    fetchProspects(),
    fetchCountries(),
    fetchEnforcement(),
  ]);

  const prospect = (prospectsRes.data?.data ?? []).find((p) => p.id === id) ?? null;
  const saCountry =
    (countriesRes.data?.data ?? []).find(
      (c) => c.iso_code === "ZA" || c.country_name === "South Africa"
    ) ?? null;
  const enforcement = (enforcementRes.data?.data ?? []).filter(
    (e) => e.country_name === "South Africa"
  );

  return (
    <AssessmentClient
      prospect={prospect}
      saCountry={saCountry}
      enforcement={enforcement}
      error={prospectsRes.error || countriesRes.error || enforcementRes.error}
    />
  );
}

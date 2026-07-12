/**
 * POPIA Assessment page — server component.
 * Fetches prospect + country data, passes to AssessmentClient for document rendering.
 */

import { fetchProspects, fetchProspectDocuments, fetchProspectAnalysis, fetchProspectAssessments } from "@/lib/data/compliance";
import type { ProspectDocument, AnalysisFinding, ProspectAssessment } from "@/lib/data/compliance";
import { fetchCountries, fetchEnforcement } from "@/lib/data/data-protection";
import AssessmentClient from "./AssessmentClient";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AssessmentPage({ params }: Props) {
  const { id } = await params;

  const [prospectsRes, countriesRes, enforcementRes, docsRes, findingsRes, assessmentsRes] = await Promise.all([
    fetchProspects(),
    fetchCountries(),
    fetchEnforcement(),
    fetchProspectDocuments(id),
    fetchProspectAnalysis(id),
    fetchProspectAssessments(id),
  ]);

  const prospect = (prospectsRes.data?.data ?? []).find((p) => p.id === id) ?? null;
  const saCountry =
    (countriesRes.data?.data ?? []).find(
      (c) => c.iso_code === "ZA" || c.country_name === "South Africa"
    ) ?? null;
  const enforcement = (enforcementRes.data?.data ?? []).filter(
    (e) => e.country_name === "South Africa"
  );

  /* Pipeline results — pass the most recent non-superseded assessment */
  const pipelineData = {
    documents: (docsRes.data?.data ?? []) as ProspectDocument[],
    findings: (findingsRes.data?.data ?? []) as AnalysisFinding[],
    assessment: ((assessmentsRes.data?.data ?? []) as ProspectAssessment[])
      .filter((a) => !a.superseded_at)[0] ?? null,
  };

  return (
    <AssessmentClient
      prospect={prospect}
      saCountry={saCountry}
      enforcement={enforcement}
      pipelineData={pipelineData}
      error={prospectsRes.error || countriesRes.error || enforcementRes.error}
    />
  );
}

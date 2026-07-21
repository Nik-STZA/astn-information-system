/**
 * V2 Assessment detail page — server component.
 * Fetches assessment + findings + documents from the DB-driven compliance engine.
 */

import { fetchAssessmentDetailV2 } from "@/lib/data/compliance";
import AssessmentV2Client from "./AssessmentV2Client";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AssessmentV2Page({ params }: Props) {
  const { id } = await params;
  const assessmentId = Number(id);

  if (isNaN(assessmentId)) {
    return (
      <div style={{ fontFamily: "'Manrope', sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px" }}>Invalid assessment ID</h1>
        <p style={{ color: "#A29C8E" }}>Return to the compliance tracker.</p>
      </div>
    );
  }

  const res = await fetchAssessmentDetailV2(assessmentId);

  if (res.error || !res.data) {
    return (
      <div style={{ fontFamily: "'Manrope', sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px" }}>Assessment unavailable</h1>
        <p style={{ color: "#CC0000" }}>{res.error ?? "Assessment not found."}</p>
      </div>
    );
  }

  return <AssessmentV2Client detail={res.data} />;
}

/**
 * Compliance knowledge base browser — server component.
 * Lists jurisdictions and lets the user drill into domain/requirement detail.
 */

import { fetchJurisdictions } from "@/lib/data/compliance";
import JurisdictionsClient from "./JurisdictionsClient";

export default async function JurisdictionsPage() {
  const res = await fetchJurisdictions();

  if (res.error || !res.data) {
    return (
      <div style={{ fontFamily: "'Manrope', sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px" }}>Knowledge base unavailable</h1>
        <p style={{ color: "#CC0000" }}>{res.error ?? "Could not load jurisdictions."}</p>
      </div>
    );
  }

  return <JurisdictionsClient jurisdictions={res.data.data} />;
}

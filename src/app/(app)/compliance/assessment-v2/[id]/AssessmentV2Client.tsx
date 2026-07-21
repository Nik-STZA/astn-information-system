"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import Link from "next/link";
import type { AssessmentDetailV2 } from "@/lib/data/compliance";

/* ── Props ──────────────────────────────────────────────────────────────── */
type Props = {
  detail: AssessmentDetailV2;
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatDate(d: Date): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function makeRef(company: string, jurisdiction: string): string {
  const abbr = company.replace(/[^A-Z]/g, "").slice(0, 3) || company.slice(0, 3).toUpperCase();
  const jCode = jurisdiction.toUpperCase().slice(0, 5);
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `AFR-${jCode}-${abbr}-${mm}${yy}`;
}

function scoreColor(score: number): string {
  if (score >= 70) return "#2E7D32";
  if (score >= 40) return "#A67514";
  return "#B4432C";
}

function scoreLabel(score: number): { text: string; color: string; bg: string } {
  if (score >= 70) return { text: "Good", color: "#2E7D53", bg: "#E7F1EA" };
  if (score >= 40) return { text: "Fair", color: "#A67514", bg: "#FBF1DE" };
  return { text: "At risk", color: "#B4432C", bg: "#F7E7E1" };
}

function exposureFromScore(score: number): { label: string; color: string; bg: string; border: string; dot: string } {
  if (score >= 70) return { label: "Low", color: "#6BAF7B", bg: "rgba(46,125,50,.12)", border: "rgba(46,125,50,.5)", dot: "#2E7D32" };
  if (score >= 40) return { label: "Medium", color: "#D4A853", bg: "rgba(197,160,89,.14)", border: "rgba(197,160,89,.5)", dot: "#C5A059" };
  return { label: "High", color: "#EBA694", bg: "rgba(180,67,44,.16)", border: "rgba(180,67,44,.5)", dot: "#E06A4E" };
}

/* ── Severity pill colours ─────────────────────────────────────────────── */
const SEV: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#B4432C", bg: "#F7E7E1", border: "#E6C9BE" },
  high:     { color: "#B4432C", bg: "#F7E7E1", border: "#E6C9BE" },
  medium:   { color: "#A67514", bg: "#FBF1DE", border: "#E6D5A3" },
  low:      { color: "#2E7D53", bg: "#E7F1EA", border: "#C7E1D1" },
  absent:   { color: "#B4432C", bg: "#F7E7E1", border: "#E6C9BE" },
  partial:  { color: "#A67514", bg: "#FBF1DE", border: "#E6D5A3" },
  present:  { color: "#2E7D53", bg: "#E7F1EA", border: "#C7E1D1" },
};

/* ── Inline style objects ────── */
const S = {
  sectionHead: { fontFamily: "'Manrope', sans-serif", fontWeight: 700 as const, fontSize: 13, lineHeight: "1.2", letterSpacing: ".16em", textTransform: "uppercase" as const, color: "#1A1A1A", margin: 0 },
  sectionRule: { flex: 1, height: 1, background: "#E7DFCE" },
  bodySerif: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 13, lineHeight: "1.7", color: "#33322E" },
  bodySerifSm: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 12, lineHeight: "1.55", color: "#4A4842" },
  bodySerifXs: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 11.5, lineHeight: "1.55", color: "#4A4842" },
  labelSm: { fontFamily: "'Manrope', sans-serif", fontWeight: 600 as const, fontSize: 9.5, lineHeight: "1", letterSpacing: ".1em", textTransform: "uppercase" as const, color: "#9A968B" },
};

/* ═══════════════════════════════════════════════════════════════════════ */
export default function AssessmentV2Client({ detail }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { assessment, findings, documents_in_scope } = detail;

  /* Ensure doc-page web component upgrades after hydration */
  useEffect(() => {
    if (typeof window !== "undefined" && customElements.get("doc-page")) {
      containerRef.current?.querySelectorAll("doc-page").forEach((el) => {
        if (el.isConnected) el.dispatchEvent(new Event("connected"));
      });
    }
  }, []);

  const wp = assessment.working_papers;
  const domainEntries = assessment.domain_scores ? Object.entries(assessment.domain_scores) : [];
  const exp = exposureFromScore(assessment.overall_score);
  const refCode = makeRef(assessment.company_name ?? "CLIENT", assessment.jurisdiction_code ?? assessment.jurisdiction ?? "COMP");
  const today = formatDate(new Date());

  const riskFactors = wp?.risk_factors ?? [];
  const recommendations = wp?.recommendations ?? [];
  const keyFindings = wp?.key_findings ?? [];

  /* Sort findings by severity */
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedFindings = [...findings].sort((a, b) =>
    (severityOrder[a.severity?.toLowerCase()] ?? 4) - (severityOrder[b.severity?.toLowerCase()] ?? 4)
  );

  /* Columns for domain score grid */
  const domainCols = Math.min(domainEntries.length, 5);

  return (
    <>
      <Script src="https://cdn.jsdelivr.net/npm/@nicholasgriffintn/doc-page@0.2.0/dist/doc-page.min.js" strategy="afterInteractive" />
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Newsreader:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap" rel="stylesheet" />

      <div ref={containerRef} style={{ background: "#E8E2D6", minHeight: "100vh", padding: "24px 0" }}>
        {/* Back link */}
        <div style={{ maxWidth: 820, margin: "0 auto 12px", padding: "0 24px" }}>
          <Link href="/compliance" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: "#B08D3F", textDecoration: "none" }}>
            &larr; Back to compliance tracker
          </Link>
        </div>

        {/* ═══ PAGE 1: Cover + Executive summary ═══ */}
        {/* @ts-expect-error doc-page is a web component */}
        <doc-page size="A4" style={{ display: "block", maxWidth: 820, margin: "0 auto 24px", background: "#FFFDF8", boxShadow: "0 2px 16px rgba(0,0,0,.12)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "56px 64px 48px" }}>
            {/* Header band */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 36 }}>
              <div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: "#C5A059", marginBottom: 4 }}>
                  African Sports Technology Network
                </div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 300, fontSize: 10.5, letterSpacing: ".08em", color: "#A29C8E" }}>
                  Data protection compliance assessment
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10, color: "#A29C8E", letterSpacing: ".06em" }}>
                  {refCode}
                </div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 400, fontSize: 10, color: "#BFBAB0", marginTop: 2 }}>
                  {today}
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: "linear-gradient(90deg, #C5A059 0%, #E7DFCE 40%, transparent 100%)", marginBottom: 32 }} />

            {/* Title block */}
            <h1 style={{ fontFamily: "'Newsreader', serif", fontWeight: 600, fontSize: 32, lineHeight: "1.2", color: "#1A1A1A", margin: "0 0 6px" }}>
              {assessment.jurisdiction_name ?? assessment.jurisdiction ?? "Compliance"} Assessment
            </h1>
            <h2 style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 20, color: "#6A665C", margin: "0 0 28px", fontStyle: "italic" }}>
              {assessment.company_name ?? "Client"}
            </h2>

            {/* Exposure level + overall score */}
            <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
              <div style={{ background: exp.bg, border: `1px solid ${exp.border}`, borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: exp.dot }} />
                <div>
                  <div style={{ ...S.labelSm, marginBottom: 3 }}>Exposure level</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, color: exp.color }}>{exp.label}</div>
                </div>
              </div>
              <div style={{ background: "#FFFDF8", border: "1px solid #E7DFCE", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 28, color: scoreColor(assessment.overall_score) }}>
                  {Math.round(assessment.overall_score)}
                </div>
                <div>
                  <div style={{ ...S.labelSm, marginBottom: 3 }}>Overall score</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: scoreColor(assessment.overall_score) }}>
                    {scoreLabel(assessment.overall_score).text} / 100
                  </div>
                </div>
              </div>
            </div>

            {/* Domain scores grid */}
            {domainEntries.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${domainCols}, 1fr)`, gap: 8, marginBottom: 28 }}>
                {domainEntries.map(([code, ds]) => {
                  const sl = scoreLabel(ds.score);
                  return (
                    <div key={code} style={{ textAlign: "center", padding: "10px 6px", borderRadius: 8, border: "1px solid #E7DFCE", background: "#FFFDF8" }}>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 18, color: scoreColor(ds.score) }}>
                        {Math.round(ds.score)}
                      </div>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 8.5, color: sl.color, background: sl.bg, borderRadius: 3, padding: "2px 6px", display: "inline-block", marginTop: 3 }}>
                        {sl.text}
                      </div>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 8.5, color: "#9A968B", marginTop: 5, lineHeight: "1.3" }}>
                        {ds.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Executive summary */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <h3 style={S.sectionHead}>Executive summary</h3>
              <div style={S.sectionRule} />
            </div>
            <p style={{ ...S.bodySerif, margin: 0 }}>
              {wp?.executive_summary ?? "No executive summary available for this assessment."}
            </p>

            {/* Assessment metadata */}
            <div style={{ marginTop: 24, display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={S.labelSm}>Engine version</div>
                <div style={{ ...S.bodySerifSm, marginTop: 2 }}>v{assessment.engine_version}</div>
              </div>
              <div>
                <div style={S.labelSm}>Confidence</div>
                <div style={{ ...S.bodySerifSm, marginTop: 2 }}>{assessment.confidence_level}</div>
              </div>
              <div>
                <div style={S.labelSm}>Assessment type</div>
                <div style={{ ...S.bodySerifSm, marginTop: 2 }}>{assessment.assessment_type}</div>
              </div>
              {wp?.evidence_summary && (
                <div>
                  <div style={S.labelSm}>Evidence items</div>
                  <div style={{ ...S.bodySerifSm, marginTop: 2 }}>{wp.evidence_summary.total_evidence}</div>
                </div>
              )}
              <div>
                <div style={S.labelSm}>Completed</div>
                <div style={{ ...S.bodySerifSm, marginTop: 2 }}>
                  {assessment.completed_at ? formatDate(new Date(assessment.completed_at)) : "In progress"}
                </div>
              </div>
            </div>
          </div>
        {/* @ts-expect-error doc-page is a web component */}
        </doc-page>

        {/* ═══ PAGE 2: Risk factors + Key findings ═══ */}
        {/* @ts-expect-error doc-page is a web component */}
        <doc-page size="A4" style={{ display: "block", maxWidth: 820, margin: "0 auto 24px", background: "#FFFDF8", boxShadow: "0 2px 16px rgba(0,0,0,.12)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "48px 64px" }}>
            {/* Risk factors */}
            {riskFactors.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <h3 style={S.sectionHead}>Risk factors</h3>
                  <div style={S.sectionRule} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                  {riskFactors.map((rf, i) => {
                    const sev = SEV[rf.level?.toLowerCase()] ?? SEV.medium;
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{
                          fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 9, padding: "3px 8px",
                          borderRadius: 4, color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`,
                          textTransform: "uppercase", letterSpacing: ".08em", whiteSpace: "nowrap", marginTop: 2,
                        }}>
                          {rf.level}
                        </span>
                        <div>
                          <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: "#1A1A1A" }}>
                            {rf.factor}
                          </div>
                          <div style={S.bodySerifXs}>{rf.note}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Key findings (from working papers) */}
            {keyFindings.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <h3 style={S.sectionHead}>Key findings</h3>
                  <div style={S.sectionRule} />
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 28 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #E7DFCE" }}>
                      {["Domain", "Requirement", "Severity", "Finding", "Evidence", "Confidence"].map((h) => (
                        <th key={h} style={{ ...S.labelSm, textAlign: "left", padding: "6px 6px 8px", borderBottom: "2px solid #E7DFCE" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {keyFindings.map((kf, i) => {
                      const sev = SEV[kf.severity?.toLowerCase()] ?? SEV.medium;
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #F0EBE0" }}>
                          <td style={{ ...S.bodySerifXs, padding: "6px", verticalAlign: "top" }}>{kf.domain}</td>
                          <td style={{ ...S.bodySerifXs, padding: "6px", verticalAlign: "top" }}>{kf.requirement}</td>
                          <td style={{ padding: "6px", verticalAlign: "top" }}>
                            <span style={{
                              fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 8.5, padding: "2px 6px",
                              borderRadius: 3, color: sev.color, background: sev.bg, textTransform: "uppercase",
                            }}>
                              {kf.severity}
                            </span>
                          </td>
                          <td style={{ ...S.bodySerifXs, padding: "6px", verticalAlign: "top", maxWidth: 200 }}>{kf.finding}</td>
                          <td style={{ ...S.bodySerifXs, padding: "6px", verticalAlign: "top", textAlign: "center" }}>{kf.evidence_count}</td>
                          <td style={{ ...S.bodySerifXs, padding: "6px", verticalAlign: "top" }}>{kf.confidence}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {/* Recommendations */}
            {recommendations.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <h3 style={S.sectionHead}>Recommendations</h3>
                  <div style={S.sectionRule} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
                  {recommendations.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{
                        fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 11, color: "#C5A059",
                        minWidth: 20, textAlign: "center", marginTop: 2,
                      }}>
                        {r.priority ?? i + 1}
                      </span>
                      <div>
                        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12, color: "#1A1A1A" }}>
                          {r.action}
                        </div>
                        {r.rationale && <div style={S.bodySerifXs}>{r.rationale}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        {/* @ts-expect-error doc-page is a web component */}
        </doc-page>

        {/* ═══ PAGE 3: Detailed findings ═══ */}
        {sortedFindings.length > 0 && (
          <>
            {/* @ts-expect-error doc-page is a web component */}
            <doc-page size="A4" style={{ display: "block", maxWidth: 820, margin: "0 auto 24px", background: "#FFFDF8", boxShadow: "0 2px 16px rgba(0,0,0,.12)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ padding: "48px 64px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <h3 style={S.sectionHead}>Detailed findings ({sortedFindings.length})</h3>
                  <div style={S.sectionRule} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {sortedFindings.map((f) => {
                    const sev = SEV[f.severity?.toLowerCase()] ?? SEV.medium;
                    const statusSev = SEV[f.status?.toLowerCase()] ?? SEV.medium;
                    return (
                      <div key={f.id} style={{ border: "1px solid #E7DFCE", borderRadius: 8, padding: "12px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: "#1A1A1A" }}>
                              {f.requirement_code}
                            </span>
                            <span style={{
                              fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 8.5, padding: "2px 6px",
                              borderRadius: 3, color: sev.color, background: sev.bg, textTransform: "uppercase",
                            }}>
                              {f.severity}
                            </span>
                            <span style={{
                              fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 8.5, padding: "2px 6px",
                              borderRadius: 3, color: statusSev.color, background: statusSev.bg, textTransform: "uppercase",
                            }}>
                              {f.status}
                            </span>
                          </div>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 9, color: "#9A968B" }}>
                            Score: {Math.round(f.score)}/100 · {f.evidence_count} evidence
                          </span>
                        </div>
                        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 11.5, color: "#33322E", marginBottom: 4 }}>
                          {f.domain_name} &rsaquo; {f.requirement_name}
                        </div>
                        <p style={{ ...S.bodySerifXs, margin: "0 0 4px" }}>{f.finding_text}</p>
                        {f.recommendation && (
                          <p style={{ ...S.bodySerifXs, margin: 0, color: "#6A665C", fontStyle: "italic" }}>
                            Recommendation: {f.recommendation}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            {/* @ts-expect-error doc-page is a web component */}
            </doc-page>
          </>
        )}

        {/* ═══ PAGE 4: Documents in scope + Disclaimer ═══ */}
        {/* @ts-expect-error doc-page is a web component */}
        <doc-page size="A4" style={{ display: "block", maxWidth: 820, margin: "0 auto 24px", background: "#FFFDF8", boxShadow: "0 2px 16px rgba(0,0,0,.12)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "48px 64px" }}>
            {/* Documents in scope */}
            {documents_in_scope.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <h3 style={S.sectionHead}>Documents in scope ({documents_in_scope.length})</h3>
                  <div style={S.sectionRule} />
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 28 }}>
                  <thead>
                    <tr>
                      {["Title", "Type", "Words", "Status", "Source"].map((h) => (
                        <th key={h} style={{ ...S.labelSm, textAlign: "left", padding: "6px", borderBottom: "2px solid #E7DFCE" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {documents_in_scope.map((doc) => (
                      <tr key={doc.id} style={{ borderBottom: "1px solid #F0EBE0" }}>
                        <td style={{ ...S.bodySerifXs, padding: "6px" }}>{doc.title || "—"}</td>
                        <td style={{ ...S.bodySerifXs, padding: "6px" }}>{doc.document_type}</td>
                        <td style={{ ...S.bodySerifXs, padding: "6px", textAlign: "right" }}>{doc.word_count?.toLocaleString("en-GB") ?? "—"}</td>
                        <td style={{ ...S.bodySerifXs, padding: "6px" }}>{doc.status}</td>
                        <td style={{ ...S.bodySerifXs, padding: "6px" }}>
                          {doc.source_url ? (
                            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "#B08D3F", textDecoration: "none", fontSize: 11 }}>link</a>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Evidence summary */}
            {wp?.evidence_summary && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <h3 style={S.sectionHead}>Evidence summary</h3>
                  <div style={S.sectionRule} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 28 }}>
                  {[
                    { label: "Total evidence", value: wp.evidence_summary.total_evidence },
                    { label: "Keyword matches", value: wp.evidence_summary.keyword_evidence },
                    { label: "Manual attestation", value: wp.evidence_summary.manual_evidence },
                    { label: "External verification", value: wp.evidence_summary.external_evidence },
                  ].map((item) => (
                    <div key={item.label} style={{ textAlign: "center", padding: 10, borderRadius: 8, border: "1px solid #E7DFCE" }}>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20, color: "#1A1A1A" }}>
                        {item.value}
                      </div>
                      <div style={{ ...S.labelSm, marginTop: 4 }}>{item.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Severity breakdown */}
            {wp?.severity_counts && Object.keys(wp.severity_counts).length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <h3 style={S.sectionHead}>Severity breakdown</h3>
                  <div style={S.sectionRule} />
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
                  {Object.entries(wp.severity_counts).map(([sev, count]) => {
                    const sc = SEV[sev.toLowerCase()] ?? SEV.medium;
                    return (
                      <div key={sev} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, background: sc.bg, border: `1px solid ${sc.border}` }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16, color: sc.color }}>{count}</span>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10, color: sc.color, textTransform: "uppercase" }}>{sev}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Disclaimer */}
            <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #E7DFCE" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <h3 style={S.sectionHead}>Disclaimer</h3>
                <div style={S.sectionRule} />
              </div>
              <p style={{ ...S.bodySerifXs, color: "#9A968B", margin: 0 }}>
                This assessment is produced by the AfricanSTN compliance analysis engine (v{assessment.engine_version}) using
                automated evidence extraction and scoring. It is intended as a preliminary compliance indicator and does not
                constitute legal advice. The assessment is based on publicly available documents at the time of analysis
                and may not reflect the full scope of the assessed entity&apos;s data protection practices. Professional legal
                review is recommended before making compliance decisions based on this report.
              </p>
            </div>

            {/* Footer */}
            <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 16, borderTop: "1px solid #E7DFCE" }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase", color: "#C5A059" }}>
                African Sports Technology Network
              </div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 400, fontSize: 9, color: "#BFBAB0" }}>
                {refCode} · {today} · Confidential
              </div>
            </div>
          </div>
        {/* @ts-expect-error doc-page is a web component */}
        </doc-page>
      </div>

      <style>{`
        @media print {
          body { background: white !important; margin: 0; }
          doc-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; break-after: page; }
        }
      `}</style>
    </>
  );
}

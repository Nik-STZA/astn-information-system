"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import type { Prospect, ProspectDocument, AnalysisFinding, ProspectAssessment } from "@/lib/data/compliance";
import type { Country, EnforcementAction } from "@/lib/data/data-protection";

/* ── Props ──────────────────────────────────────────────────────────────── */
type PipelineData = {
  documents: ProspectDocument[];
  findings: AnalysisFinding[];
  assessment: ProspectAssessment | null;
};

type Props = {
  prospect: Prospect | null;
  saCountry: Country | null;
  enforcement: EnforcementAction[];
  pipelineData?: PipelineData;
  error: string | null;
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatDate(d: Date): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function makeRef(company: string): string {
  const abbr = company.replace(/[^A-Z]/g, "").slice(0, 3) || company.slice(0, 3).toUpperCase();
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `AFR-POPIA-${abbr}-${mm}${yy}`;
}

function exposureLevel(p: Prospect): { label: string; color: string; bg: string; border: string; dot: string } {
  const criticals = p.critical_finding_count ?? 0;
  const notRegistered = p.ir_registered === false;
  if (criticals >= 2 || (notRegistered && criticals >= 1)) {
    return { label: "High", color: "#EBA694", bg: "rgba(180,67,44,.16)", border: "rgba(180,67,44,.5)", dot: "#E06A4E" };
  }
  if (criticals >= 1 || notRegistered) {
    return { label: "Medium", color: "#D4A853", bg: "rgba(197,160,89,.14)", border: "rgba(197,160,89,.5)", dot: "#C5A059" };
  }
  return { label: "Low", color: "#6BAF7B", bg: "rgba(46,125,50,.12)", border: "rgba(46,125,50,.5)", dot: "#2E7D32" };
}

/* ── Pipeline-aware exposure level (uses real assessment when available) ── */
function pipelineExposureLevel(assessment: ProspectAssessment | null, p: Prospect): { label: string; color: string; bg: string; border: string; dot: string } {
  if (assessment) {
    const sev = (assessment.overall_severity ?? "").toLowerCase();
    if (sev.startsWith("high") || sev.startsWith("critical")) {
      return { label: "High", color: "#EBA694", bg: "rgba(180,67,44,.16)", border: "rgba(180,67,44,.5)", dot: "#E06A4E" };
    }
    if (sev.startsWith("medium")) {
      return { label: "Medium", color: "#D4A853", bg: "rgba(197,160,89,.14)", border: "rgba(197,160,89,.5)", dot: "#C5A059" };
    }
    return { label: "Low", color: "#6BAF7B", bg: "rgba(46,125,50,.12)", border: "rgba(46,125,50,.5)", dot: "#2E7D32" };
  }
  return exposureLevel(p);
}

/* ── Score label ──────────────────────────────────────────────────────── */
function scoreLabel(score: number): { text: string; color: string; bg: string } {
  if (score <= 3) return { text: "Good", color: "#2E7D53", bg: "#E7F1EA" };
  if (score <= 5) return { text: "Fair", color: "#A67514", bg: "#FBF1DE" };
  if (score <= 7) return { text: "At risk", color: "#B4432C", bg: "#F7E7E1" };
  return { text: "Critical", color: "#B4432C", bg: "#F7E7E1" };
}

/* ── Severity pill colours ─────────────────────────────────────────────── */
const SEV: Record<string, { color: string; bg: string; border: string }> = {
  High:   { color: "#B4432C", bg: "#F7E7E1", border: "#E6C9BE" },
  Medium: { color: "#A67514", bg: "#FBF1DE", border: "#E6D5A3" },
  Low:    { color: "#2E7D53", bg: "#E7F1EA", border: "#C7E1D1" },
};

/* ── Enforcement type pill ─────────────────────────────────────────────── */
const TYPE_PILL: Record<string, { color: string; bg: string }> = {
  Fine:   { color: "#9C7C2E", bg: "#F4ECD9" },
  Notice: { color: "#B4432C", bg: "#F7E7E1" },
};
function typePill(t: string) {
  return TYPE_PILL[t] ?? { color: "#9A968B", bg: "#F0ECE3" };
}

/* ── Risk rows for a prospect ──────────────────────────────────────────── */
function verificationLabel(method: string | null): string {
  if (method === "manual_portal") return "verified via IR eServices portal";
  if (method === "automated") return "verified via automated check";
  return "not independently verified";
}

function buildRisks(p: Prospect): Array<{ severity: string; title: string; description: string }> {
  const risks: Array<{ severity: string; title: string; description: string }> = [];
  const isVerified = p.ir_verification_method && p.ir_verification_method !== "assumed";
  if (p.ir_registered === false) {
    let desc = "Not registered with the Information Regulator — non-compliance with s55 and the IR Guidance Note on registration of Information Officers.";
    if (isVerified && p.ir_verified_date) {
      desc += ` Status ${verificationLabel(p.ir_verification_method)} on ${p.ir_verified_date}.`;
    }
    risks.push({ severity: "High", title: "IR registration", description: desc });
  }
  if (!isVerified) {
    risks.push({ severity: "Medium", title: "Verification pending", description: "IR registration status has not been independently verified against the Information Regulator’s eServices portal. Manual verification is recommended before issuing a final assessment." });
  }
  if (p.sa_presence_evidence) {
    risks.push({ severity: "High", title: "SA presence", description: `Evidence of South African data processing: ${p.sa_presence_evidence}` });
  }
  const isSportsTech = (p.sector ?? "").toLowerCase().includes("sport") || (p.sector ?? "").toLowerCase().includes("tech");
  if (isSportsTech) {
    risks.push({ severity: "High", title: "Sector sensitivity", description: `Sports technology — likely processes biometric, performance and potentially minors’ data, all of which are special personal information under POPIA requiring elevated safeguards.` });
  }
  if (risks.length === 0) {
    risks.push({ severity: "Medium", title: "General compliance", description: "Standard POPIA obligations apply to all international entities processing South African personal information." });
  }
  return risks;
}

/* ── Inline style objects (TS doesn’t support CSS shorthand `font`) ────── */
const S = {
  /* Section heading */
  sectionHead: { fontFamily: "'Manrope', sans-serif", fontWeight: 700 as const, fontSize: 13, lineHeight: "1.2", letterSpacing: ".16em", textTransform: "uppercase" as const, color: "#1A1A1A", margin: 0 },
  sectionRule: { flex: 1, height: 1, background: "#E7DFCE" },
  /* Body serif */
  bodySerif: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 13, lineHeight: "1.7", color: "#33322E" },
  bodySerifSm: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 12, lineHeight: "1.55", color: "#4A4842" },
  bodySerifXs: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 11.5, lineHeight: "1.55", color: "#4A4842" },
  /* Labels */
  labelSm: { fontFamily: "'Manrope', sans-serif", fontWeight: 600 as const, fontSize: 9.5, lineHeight: "1", letterSpacing: ".1em", textTransform: "uppercase" as const, color: "#9A968B" },
};

/* ═══════════════════════════════════════════════════════════════════════ */
export default function AssessmentClient({ prospect, saCountry, enforcement, pipelineData, error }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  /* Ensure doc-page web component upgrades after hydration */
  useEffect(() => {
    if (typeof window !== "undefined" && customElements.get("doc-page")) {
      containerRef.current?.querySelectorAll("doc-page").forEach((el) => {
        if (el.isConnected) el.dispatchEvent(new Event("connected"));
      });
    }
  }, []);

  if (error && !prospect) {
    return (
      <div style={{ fontFamily: "'Manrope', sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px" }}>Assessment unavailable</h1>
        <p style={{ color: "#CC0000" }}>{error}</p>
      </div>
    );
  }

  if (!prospect) {
    return (
      <div style={{ fontFamily: "'Manrope', sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px" }}>Prospect not found</h1>
        <p style={{ color: "#A29C8E" }}>No prospect matched this ID. Return to the compliance tracker.</p>
      </div>
    );
  }

  const assessment = pipelineData?.assessment ?? null;
  const findings = pipelineData?.findings ?? [];
  const documents = pipelineData?.documents ?? [];
  const hasPipeline = !!assessment;

  const exp = pipelineExposureLevel(assessment, prospect);
  const risks = hasPipeline ? [] : buildRisks(prospect); // pipeline data replaces heuristic risks
  const refCode = makeRef(prospect.company_name);
  const today = formatDate(new Date());

  /* Parse risk_factors / recommendations from pipeline assessment (stored as JSON) */
  const riskFactors: string[] = hasPipeline
    ? (Array.isArray(assessment.risk_factors) ? assessment.risk_factors as string[] : [])
    : [];
  const recommendations: string[] = hasPipeline
    ? (Array.isArray(assessment.recommendations) ? assessment.recommendations as string[] : [])
    : [];

  /* Domain scores for display */
  const domainScores = hasPipeline ? [
    { label: "IR registration", score: assessment.score_ir_registration },
    { label: "Biometric handling", score: assessment.score_biometric_handling },
    { label: "Cross-border transfers", score: assessment.score_cross_border },
    { label: "Consent mechanism", score: assessment.score_consent_mechanism },
    { label: "Breach notification", score: assessment.score_breach_notification },
    { label: "Data subject rights", score: assessment.score_data_subject_rights },
  ] : [];

  /* Group findings by severity for the table */
  const criticalFindings = findings.filter((f) => f.severity?.toLowerCase() === "critical");
  const highFindings = findings.filter((f) => f.severity?.toLowerCase() === "high");
  const mediumFindings = findings.filter((f) => f.severity?.toLowerCase() === "medium");
  const lowFindings = findings.filter((f) => f.severity?.toLowerCase() === "low");
  const sortedFindings = [...criticalFindings, ...highFindings, ...mediumFindings, ...lowFindings];

  /* SA country data — fallback to static if API didn’t return */
  const sa = saCountry ?? {
    tier: "Leader",
    overall_score: 8.8,
    law_name: "Protection of Personal Information Act",
    law_year: 2013,
    authority_name: "Information Regulator (South Africa)",
    breach_notification_detail: "Required — as soon as reasonably possible after discovery, to the IR and affected data subjects.",
    transfer_mechanisms: "Adequate protection, binding corporate rules, consent, or a Section 72 exception.",
    max_fine_description: "ZAR 10 million and/or imprisonment up to 10 years.",
  };

  /* Use up to 5 most recent enforcement actions */
  const enfSlice = enforcement.slice(0, 5);

  /* Verification context for executive summary */
  const irVerifiedText = prospect.ir_verification_method === "manual_portal" && prospect.ir_verified_date
    ? ` (verified via the IR eServices portal on ${prospect.ir_verified_date})`
    : prospect.ir_verification_method === "assumed"
    ? " (not yet independently verified)"
    : "";
  const irRegisteredText = prospect.ir_registered === true && prospect.ir_entity_name
    ? ` The company is registered with the Information Regulator as "${prospect.ir_entity_name}"${prospect.ir_registration_no ? ` (registration ${prospect.ir_registration_no})` : ""}${prospect.ir_io_name ? `, with ${prospect.ir_io_name} designated as Information Officer` : ""}.`
    : "";

  return (
    <>
      {/* doc-page web component — Newsreader now loaded globally in layout.tsx */}
      <Script src="/doc-page.js" strategy="beforeInteractive" />

      <style>{`
        doc-page:not(:defined){visibility:hidden}
        .popia-doc a{color:#9C7C2E;text-decoration:none}
        .popia-doc a:hover{color:#C6A24E}
        @media print { .popia-nav-bar { display:none !important; } }
      `}</style>

      {/* Back nav bar — hidden when printing */}
      <div className="popia-nav-bar" style={{ fontFamily: "'Manrope', sans-serif", padding: "16px 0 8px", display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <a href="/compliance" style={{ fontSize: 12.5, fontWeight: 500, color: "#A29C8E", textDecoration: "none" }}>
          &larr; Back to compliance
        </a>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "#D4C5A9" }}>|</span>
        <button
          onClick={() => window.print()}
          style={{ fontSize: 12.5, fontWeight: 600, color: "#C5A059", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          Print / Save PDF
        </button>
      </div>

      {/* ── Document ───────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="popia-doc">
        {/* @ts-expect-error doc-page is a web component */}
        <doc-page size="a4" margin="0.72in">

          {/* Running header */}
          <div slot="header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0 12px", margin: "0 0 6px", borderBottom: "1px solid #E7DFCE" }}>
            <img src="/logos/stza-logo-dark-crop.png" alt="STZA" style={{ height: 16, width: "auto", display: "block" }} />
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, lineHeight: "1", letterSpacing: ".16em", textTransform: "uppercase", color: "#9C7C2E" }}>POPIA Compliance Assessment</span>
          </div>

          {/* Running footer */}
          <div slot="footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 3px", margin: "6px 0 0", borderTop: "1px solid #E7DFCE", fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 8.5, lineHeight: "1.3", color: "#9A968B" }}>
            <span>STZA&reg; &middot; Sports Tech Africa Ltd &nbsp;|&nbsp; Information Officer service by African Sports Technology Network</span>
            <span style={{ color: "#B4432C" }}>Confidential &mdash; {prospect.company_name}</span>
          </div>

          {/* ===== TITLE BLOCK ===== */}
          <div style={{ background: "#141414", borderRadius: 8, padding: "26px 28px 24px", margin: "0 0 26px", breakInside: "avoid" as const }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 20px" }}>
              <img src="/logos/stza-logo-white-crop.png" alt="STZA" style={{ height: 26, width: "auto", display: "block" }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, lineHeight: "1", letterSpacing: ".01em", color: "#EDE7DA" }}>
                African<span style={{ color: "#C6A24E" }}>STN</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
              <div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, lineHeight: "1", letterSpacing: ".22em", textTransform: "uppercase", color: "#C6A24E", margin: "0 0 10px" }}>POPIA Compliance Assessment</div>
                <h1 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 30, lineHeight: "1.05", color: "#FFFFFF", margin: "0 0 7px", letterSpacing: "-.01em" }}>{prospect.company_name}</h1>
                <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12.5, lineHeight: "1", color: "#B7B2A6" }}>
                  {prospect.sector ?? "Technology"} &middot; {prospect.company_country ?? "International"}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: exp.bg, border: `1px solid ${exp.border}`, borderRadius: 5, padding: "6px 11px", margin: "0 0 12px" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: exp.dot, display: "block" }} />
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, lineHeight: "1", letterSpacing: ".1em", textTransform: "uppercase", color: exp.color }}>Overall exposure &middot; {exp.label}</span>
                </div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 10, lineHeight: "1.5", color: "#8C877B" }}>
                  Prepared {today}<br />Reference {refCode}
                </div>
              </div>
            </div>
          </div>

          {/* ===== EXECUTIVE SUMMARY ===== */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px" }}>
            <h2 style={S.sectionHead}>Executive summary</h2>
            <div style={S.sectionRule} />
          </div>
          {hasPipeline && assessment.executive_summary ? (
            <p style={{ ...S.bodySerif, margin: "0 0 24px" }}>{assessment.executive_summary}</p>
          ) : (
            <p style={{ ...S.bodySerif, margin: "0 0 24px" }}>
              This assessment evaluates <strong style={{ fontWeight: 600 }}>{prospect.company_name}</strong>&rsquo;s compliance position under South Africa&rsquo;s Protection of Personal Information Act (POPIA).
              {prospect.sa_presence_evidence && (
                <> As an international {(prospect.sector ?? "technology").toLowerCase()} company with evidence of South African data processing &mdash; {prospect.sa_presence_evidence} &mdash; the company falls within POPIA&rsquo;s extra-territorial provisions under Section 3(1)(b)(ii).</>
              )}
              {!prospect.sa_presence_evidence && (
                <> As an international company {prospect.company_country ? `based in ${prospect.company_country}` : ""} with potential South African data processing, the company may fall within POPIA&rsquo;s extra-territorial provisions under Section 3(1)(b)(ii).</>
              )}
              {prospect.ir_registered === false && ` The company is confirmed not registered with the Information Regulator${irVerifiedText}.`}
              {irRegisteredText}
              {" "}The Information Regulator requires non-South African responsible parties to appoint a local Information Officer.
            </p>
          )}

          {/* ===== PROPOSED ENGAGEMENT ===== */}
          <div style={{ display: "flex", gap: 0, border: "1px solid #E7DFCE", borderRadius: 8, overflow: "hidden", margin: "0 0 26px", breakInside: "avoid" as const }}>
            <div style={{ width: 6, background: "#C6A24E", flexShrink: 0 }} />
            <div style={{ padding: "16px 20px", background: "#F9F5EC", flex: 1 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, lineHeight: "1", letterSpacing: ".16em", textTransform: "uppercase", color: "#9C7C2E", margin: "0 0 8px" }}>Proposed engagement</div>
              <p style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12.5, lineHeight: "1.65", color: "#33322E", margin: 0 }}>
                <strong style={{ fontWeight: 600 }}>STZA</strong> contracts with {prospect.company_name} for POPIA representation and advisory. <strong style={{ fontWeight: 600 }}>African Sports Technology Network</strong> is appointed as your registered <strong style={{ fontWeight: 600 }}>Information Officer and local representative</strong> in South Africa, recharged to STZA under the engagement &mdash; satisfying the Section 55&ndash;56 obligation with a single accountable point of contact.
              </p>
            </div>
          </div>

          {/* ===== IR VERIFICATION STATUS ===== */}
          {(prospect.ir_verification_method || prospect.ir_registered !== null) && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px" }}>
                <h2 style={S.sectionHead}>IR registration verification</h2>
                <div style={S.sectionRule} />
              </div>
              <div style={{ border: "1px solid #E7DFCE", borderRadius: 8, overflow: "hidden", margin: "0 0 26px", breakInside: "avoid" as const }}>
                {/* Status banner */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: prospect.ir_registered === true ? "rgba(46,125,50,.08)" : prospect.ir_registered === false ? "rgba(180,67,44,.08)" : "#FAF7F0" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: prospect.ir_registered === true ? "#2E7D32" : prospect.ir_registered === false ? "#E06A4E" : "#9A968B", display: "block", flexShrink: 0 }} />
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, lineHeight: "1.3", color: "#1A1A1A" }}>
                    {prospect.ir_registered === true ? "Registered with the Information Regulator" : prospect.ir_registered === false ? "Not registered with the Information Regulator" : "Registration status unknown"}
                  </span>
                  {prospect.ir_verification_method && prospect.ir_verification_method !== "assumed" && (
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#2E7D53", background: "#E7F1EA", border: "1px solid #C7E1D1", borderRadius: 3, padding: "4px 7px" }}>Verified</span>
                  )}
                  {(!prospect.ir_verification_method || prospect.ir_verification_method === "assumed") && (
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#A67514", background: "#FBF1DE", border: "1px solid #E6D5A3", borderRadius: 3, padding: "4px 7px" }}>Unverified</span>
                  )}
                </div>
                {/* Detail grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                  {prospect.ir_entity_name && (
                    <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE", borderRight: "1px solid #E7DFCE" }}>
                      <div style={{ ...S.labelSm, margin: "0 0 4px" }}>Registered entity name</div>
                      <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{prospect.ir_entity_name}</div>
                    </div>
                  )}
                  {prospect.ir_registration_no && (
                    <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE" }}>
                      <div style={{ ...S.labelSm, margin: "0 0 4px" }}>Registration number</div>
                      <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E", fontVariantNumeric: "tabular-nums" }}>{prospect.ir_registration_no}</div>
                    </div>
                  )}
                  {prospect.ir_io_name && (
                    <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE", borderRight: prospect.ir_io_designation ? "1px solid #E7DFCE" : "none" }}>
                      <div style={{ ...S.labelSm, margin: "0 0 4px" }}>Information Officer</div>
                      <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{prospect.ir_io_name}</div>
                    </div>
                  )}
                  {prospect.ir_io_designation && (
                    <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE" }}>
                      <div style={{ ...S.labelSm, margin: "0 0 4px" }}>IO designation</div>
                      <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{prospect.ir_io_designation}</div>
                    </div>
                  )}
                  <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE", borderRight: "1px solid #E7DFCE" }}>
                    <div style={{ ...S.labelSm, margin: "0 0 4px" }}>Verification method</div>
                    <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>
                      {prospect.ir_verification_method === "manual_portal" ? "IR eServices portal (manual)" : prospect.ir_verification_method === "automated" ? "Automated check" : prospect.ir_verification_method === "assumed" ? "Assumed (not verified)" : "Not yet checked"}
                    </div>
                  </div>
                  <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE" }}>
                    <div style={{ ...S.labelSm, margin: "0 0 4px" }}>Verification date</div>
                    <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E", fontVariantNumeric: "tabular-nums" }}>
                      {prospect.ir_verified_date ?? "—"}
                    </div>
                  </div>
                </div>
                {prospect.ir_verification_notes && (
                  <div style={{ padding: "11px 16px", borderTop: "1px solid #E7DFCE" }}>
                    <div style={{ ...S.labelSm, margin: "0 0 4px" }}>Verification notes</div>
                    <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#4A4842" }}>{prospect.ir_verification_notes}</div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===== COMPLIANCE SCORING (pipeline only) ===== */}
          {hasPipeline && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }}>
                <h2 style={S.sectionHead}>Compliance scoring</h2>
                <div style={S.sectionRule} />
              </div>
              {/* Overall score banner */}
              <div style={{ display: "flex", gap: 14, alignItems: "center", background: "#141414", borderRadius: 8, padding: "18px 22px", margin: "0 0 14px", breakInside: "avoid" as const }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 42, lineHeight: "1", color: "#C6A24E", fontVariantNumeric: "tabular-nums" }}>
                  {Number(assessment.score_overall ?? 0).toFixed(1)}
                </div>
                <div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, lineHeight: "1.2", letterSpacing: ".1em", textTransform: "uppercase", color: exp.color, margin: "0 0 4px" }}>
                    Overall exposure &middot; {exp.label}
                  </div>
                  <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#8C877B" }}>
                    0 = fully compliant &middot; 9 = critical non-compliance
                  </div>
                </div>
              </div>
              {/* Domain score cards — 3×2 grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "0 0 26px" }}>
                {domainScores.map((d) => {
                  const numScore = Number(d.score ?? 0);
                  const sl = scoreLabel(numScore);
                  return (
                    <div key={d.label} style={{ border: "1px solid #E7DFCE", borderRadius: 6, padding: "14px 16px", textAlign: "center", breakInside: "avoid" as const }}>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 28, lineHeight: "1", color: "#1A1A1A", fontVariantNumeric: "tabular-nums", margin: "0 0 6px" }}>
                        {numScore}
                      </div>
                      <span style={{ display: "inline-block", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 9, lineHeight: "1", letterSpacing: ".06em", textTransform: "uppercase", color: sl.color, background: sl.bg, borderRadius: 3, padding: "4px 8px", margin: "0 0 8px" }}>
                        {sl.text}
                      </span>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10, lineHeight: "1.3", letterSpacing: ".06em", textTransform: "uppercase", color: "#9A968B" }}>{d.label}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ===== ANALYSIS FINDINGS (pipeline only) ===== */}
          {sortedFindings.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px", breakInside: "avoid" as const }}>
                <h2 style={S.sectionHead}>Analysis findings</h2>
                <div style={S.sectionRule} />
              </div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 11, lineHeight: "1.4", color: "#9A968B", margin: "0 0 10px" }}>
                {sortedFindings.length} finding{sortedFindings.length !== 1 ? "s" : ""} across {documents.length} document{documents.length !== 1 ? "s" : ""} analysed
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", margin: "0 0 26px", fontFamily: "'Manrope', sans-serif" }}>
                <thead style={{ display: "table-header-group" }}>
                  <tr>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 10px 8px 0", borderBottom: "1.5px solid #C6A24E", whiteSpace: "nowrap" }}>Severity</th>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 10px 8px", borderBottom: "1.5px solid #C6A24E" }}>Category</th>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 0 8px 10px", borderBottom: "1.5px solid #C6A24E" }}>Finding</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFindings.map((f) => {
                    const sevKey = (f.severity ?? "Medium").charAt(0).toUpperCase() + (f.severity ?? "medium").slice(1).toLowerCase();
                    const sev = SEV[sevKey] ?? SEV.Medium;
                    return (
                      <tr key={f.id} style={{ breakInside: "avoid" as const }}>
                        <td style={{ padding: "10px 10px 10px 0", borderBottom: "1px solid #EDE7D8", verticalAlign: "top" }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 9, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 3, padding: "4px 7px", whiteSpace: "nowrap" }}>{f.severity}</span>
                        </td>
                        <td style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 11, lineHeight: "1.4", color: "#1A1A1A", padding: "10px 10px", borderBottom: "1px solid #EDE7D8", verticalAlign: "top", whiteSpace: "nowrap" }}>{f.check_category}</td>
                        <td style={{ ...S.bodySerifXs, padding: "10px 0 10px 10px", borderBottom: "1px solid #EDE7D8", verticalAlign: "top" }}>
                          {f.finding}
                          {f.evidence_quote && (
                            <div style={{ fontStyle: "italic", color: "#9A968B", fontSize: 10.5, marginTop: 3 }}>&ldquo;{f.evidence_quote}&rdquo;</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* ===== RISK ASSESSMENT ===== */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }}>
            <h2 style={S.sectionHead}>{hasPipeline ? "Risk factors" : "Risk assessment"}</h2>
            <div style={S.sectionRule} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "0 0 26px" }}>
            {hasPipeline && riskFactors.length > 0 ? (
              riskFactors.map((rf, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "#FAF7F0", border: "1px solid #EFE7D6", borderRadius: 6, padding: "13px 15px", breakInside: "avoid" as const }}>
                  <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "#E06A4E", color: "#FFFFFF", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, lineHeight: "22px", textAlign: "center" }}>{i + 1}</span>
                  <div style={S.bodySerifSm}>{rf}</div>
                </div>
              ))
            ) : (
              risks.map((r, i) => {
                const sev = SEV[r.severity] ?? SEV.Medium;
                return (
                  <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "#FAF7F0", border: "1px solid #EFE7D6", borderRadius: 6, padding: "13px 15px", breakInside: "avoid" as const }}>
                    <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 9, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 4, padding: "6px 9px" }}>{r.severity}</span>
                    <div>
                      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13, lineHeight: "1.3", color: "#1A1A1A", margin: "0 0 3px" }}>{r.title}</div>
                      <div style={S.bodySerifSm}>{r.description}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ===== REGULATORY LANDSCAPE ===== */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px", breakInside: "avoid" as const }}>
            <h2 style={S.sectionHead}>South Africa &mdash; regulatory landscape</h2>
            <div style={S.sectionRule} />
          </div>
          <div style={{ display: "flex", gap: 12, margin: "0 0 14px", breakInside: "avoid" as const }}>
            {/* DPMI tier */}
            <div style={{ flex: 1, border: "1px solid #E7DFCE", borderRadius: 8, padding: 16, textAlign: "center" }}>
              <span style={{ display: "inline-block", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, lineHeight: "1", letterSpacing: ".06em", textTransform: "uppercase", color: "#2E7D53", background: "#E7F1EA", border: "1px solid #C7E1D1", borderRadius: 20, padding: "6px 14px", margin: "0 0 10px" }}>
                {sa.tier ?? "Leader"}
              </span>
              <div style={S.labelSm}>DPMI tier</div>
            </div>
            {/* Score */}
            <div style={{ flex: 1, border: "1px solid #E7DFCE", borderRadius: 8, padding: 16, textAlign: "center" }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 30, lineHeight: "1", color: "#1A1A1A", fontVariantNumeric: "tabular-nums", margin: "0 0 6px" }}>
                {sa.overall_score != null ? Number(sa.overall_score).toFixed(1) : "8.8"}
              </div>
              <div style={S.labelSm}>DPMI score / 10</div>
            </div>
            {/* Law */}
            <div style={{ flex: 1.4, border: "1px solid #E7DFCE", borderRadius: 8, padding: 16, textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, lineHeight: "1.35", color: "#1A1A1A", margin: "0 0 5px" }}>
                {sa.law_name ?? "Protection of Personal Information Act"}
              </div>
              <div style={S.labelSm}>POPIA &middot; {sa.law_year ?? 2013}</div>
            </div>
          </div>
          {/* 2×2 detail grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid #E7DFCE", borderRadius: 8, overflow: "hidden", margin: "0 0 26px", breakInside: "avoid" as const }}>
            <div style={{ padding: "13px 16px", borderRight: "1px solid #E7DFCE", borderBottom: "1px solid #E7DFCE" }}>
              <div style={{ ...S.labelSm, margin: "0 0 5px" }}>Regulator</div>
              <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{sa.authority_name ?? "Information Regulator (South Africa)"}</div>
            </div>
            <div style={{ padding: "13px 16px", borderBottom: "1px solid #E7DFCE" }}>
              <div style={{ ...S.labelSm, margin: "0 0 5px" }}>Breach notification</div>
              <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{sa.breach_notification_detail ?? "Required — as soon as reasonably possible after discovery."}</div>
            </div>
            <div style={{ padding: "13px 16px", borderRight: "1px solid #E7DFCE" }}>
              <div style={{ ...S.labelSm, margin: "0 0 5px" }}>Transfer mechanism</div>
              <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{sa.transfer_mechanisms ?? "Adequate protection, binding corporate rules, consent, or a Section 72 exception."}</div>
            </div>
            <div style={{ padding: "13px 16px" }}>
              <div style={{ ...S.labelSm, margin: "0 0 5px" }}>Maximum penalty</div>
              <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>{sa.max_fine_description ?? "ZAR 10 million and/or imprisonment up to 10 years."}</div>
            </div>
          </div>

          {/* ===== ENFORCEMENT ACTIONS ===== */}
          {enfSlice.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px", breakInside: "avoid" as const }}>
                <h2 style={S.sectionHead}>Recent enforcement actions &mdash; South Africa</h2>
                <div style={S.sectionRule} />
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", margin: "0 0 26px", fontFamily: "'Manrope', sans-serif" }}>
                <thead style={{ display: "table-header-group" }}>
                  <tr>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 10px 8px 0", borderBottom: "1.5px solid #C6A24E", whiteSpace: "nowrap" }}>Date</th>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 10px 8px", borderBottom: "1.5px solid #C6A24E" }}>Entity</th>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 10px 8px", borderBottom: "1.5px solid #C6A24E", whiteSpace: "nowrap" }}>Type</th>
                    <th style={{ textAlign: "left", fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9.5, lineHeight: "1", letterSpacing: ".08em", textTransform: "uppercase", color: "#9A968B", padding: "0 0 8px 10px", borderBottom: "1.5px solid #C6A24E" }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {enfSlice.map((e) => {
                    const tp = typePill(e.action_type);
                    return (
                      <tr key={e.id} style={{ breakInside: "avoid" as const }}>
                        <td style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 11, lineHeight: "1.4", color: "#4A4842", padding: "11px 10px 11px 0", borderBottom: "1px solid #EDE7D8", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", verticalAlign: "top" }}>{e.action_date?.slice(0, 10) ?? "—"}</td>
                        <td style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 11.5, lineHeight: "1.4", color: "#1A1A1A", padding: "11px 10px", borderBottom: "1px solid #EDE7D8", verticalAlign: "top" }}>{e.target_entity ?? "—"}</td>
                        <td style={{ padding: "11px 10px", borderBottom: "1px solid #EDE7D8", verticalAlign: "top" }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, lineHeight: "1", textTransform: "uppercase", letterSpacing: ".06em", color: tp.color, background: tp.bg, borderRadius: 3, padding: "4px 7px", whiteSpace: "nowrap" }}>{e.action_type}</span>
                        </td>
                        <td style={{ ...S.bodySerifXs, padding: "11px 0 11px 10px", borderBottom: "1px solid #EDE7D8", verticalAlign: "top" }}>{e.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* ===== KEY OBLIGATIONS ===== */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px", breakInside: "avoid" as const }}>
            <h2 style={S.sectionHead}>Key POPIA obligations for international companies</h2>
            <div style={S.sectionRule} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "0 0 26px" }}>
            {[
              { title: "Information Officer", body: "Appoint and register with the IR (s55–56). International entities must designate a local representative." },
              { title: "Lawful processing", body: "Personal information must be processed lawfully for a defined purpose, with data-subject consent or another s11 ground." },
              { title: "Cross-border transfers", body: "Section 72 requires adequate protection in the recipient country, binding corporate rules, or data-subject consent." },
              { title: "Data-subject rights", body: "Right to access, correction and deletion of personal information. Respond within 30 days of a request." },
              { title: "Breach notification", body: "Notify the IR and affected data subjects as soon as reasonably possible after becoming aware of a breach." },
              { title: "Special categories", body: "Biometric, children’s and health data require explicit consent and additional safeguards." },
            ].map((o) => (
              <div key={o.title} style={{ background: "#F9F5EC", border: "1px solid #EFE7D6", borderRadius: 6, padding: "14px 16px", breakInside: "avoid" as const }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, lineHeight: "1.3", color: "#1A1A1A", margin: "0 0 5px" }}>{o.title}</div>
                <div style={S.bodySerifXs}>{o.body}</div>
              </div>
            ))}
            {/* Juristic persons — full width with gold border */}
            <div style={{ gridColumn: "1 / -1", background: "#F9F5EC", border: "1px solid #EFE7D6", borderLeft: "4px solid #C6A24E", borderRadius: 6, padding: "14px 16px", breakInside: "avoid" as const }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, lineHeight: "1.3", color: "#1A1A1A", margin: "0 0 5px" }}>Juristic persons</div>
              <div style={S.bodySerifXs}>Unusually, POPIA protects the personal information of <strong style={{ fontWeight: 600 }}>juristic persons</strong> (companies and other legal entities) as well as natural persons &mdash; so business-to-business data, not only individuals&rsquo; data, falls within scope.</div>
            </div>
          </div>

          {/* ===== NEXT STEPS / RECOMMENDATIONS ===== */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px", breakInside: "avoid" as const }}>
            <h2 style={S.sectionHead}>{hasPipeline ? "Recommendations" : "Recommended next steps"}</h2>
            <div style={S.sectionRule} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13, margin: "0 0 26px" }}>
            {hasPipeline && recommendations.length > 0 ? (
              recommendations.map((rec, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", breakInside: "avoid" as const }}>
                  <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#C6A24E", color: "#141414", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, lineHeight: "24px", textAlign: "center" }}>{i + 1}</span>
                  <div style={{ paddingTop: 2 }}>
                    <span style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12.5, lineHeight: "1.5", color: "#4A4842" }}>{rec}</span>
                  </div>
                </div>
              ))
            ) : (
              [
                { n: 1, title: "Gap assessment.", body: "Full review of current data-processing activities involving South African personal information." },
                { n: 2, title: "IR registration.", body: "Appoint a POPIA representative (AfricanSTN) and register the Information Officer with the Information Regulator." },
                { n: 3, title: "Policy alignment.", body: "Update privacy policies, data-processing agreements and cross-border transfer mechanisms." },
                { n: 4, title: "Ongoing compliance.", body: "Establish breach-notification procedures and data-subject request handling processes." },
              ].map((s) => (
                <div key={s.n} style={{ display: "flex", gap: 14, alignItems: "flex-start", breakInside: "avoid" as const }}>
                  <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#C6A24E", color: "#141414", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, lineHeight: "24px", textAlign: "center" }}>{s.n}</span>
                  <div style={{ paddingTop: 2 }}>
                    <strong style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12.5, lineHeight: "1.4", color: "#1A1A1A" }}>{s.title} </strong>
                    <span style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12.5, lineHeight: "1.5", color: "#4A4842" }}>{s.body}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ===== DOCUMENTS REVIEWED (pipeline only) ===== */}
          {documents.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px", breakInside: "avoid" as const }}>
                <h2 style={S.sectionHead}>Documents reviewed</h2>
                <div style={S.sectionRule} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "0 0 26px" }}>
                {documents.map((doc) => (
                  <div key={doc.id} style={{ display: "flex", gap: 10, alignItems: "baseline", breakInside: "avoid" as const }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, lineHeight: "1", letterSpacing: ".06em", textTransform: "uppercase", color: "#9C7C2E", background: "#F4ECD9", borderRadius: 3, padding: "4px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>{doc.document_type}</span>
                    <span style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12, lineHeight: "1.4", color: "#33322E" }}>
                      {doc.document_title ?? doc.source_url ?? "Untitled document"}
                    </span>
                    {doc.snapshot_date && (
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 10, color: "#9A968B", whiteSpace: "nowrap" }}>
                        {doc.snapshot_date.slice(0, 10)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ===== CLOSING / DISCLAIMER ===== */}
          <div style={{ borderTop: "2px solid #141414", padding: "14px 0 0", breakInside: "avoid" as const }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "0 0 10px" }}>
              <img src="/logos/stza-logo-dark-crop.png" alt="STZA" style={{ height: 18, width: "auto", display: "block" }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10, lineHeight: "1.4", color: "#9A968B", textAlign: "right" }}>POPIA Representative Services &middot; delivered with African Sports Technology Network</span>
            </div>
            <p style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 9.5, lineHeight: "1.5", fontStyle: "italic", color: "#9A968B", margin: 0 }}>
              This document is for informational purposes only and does not constitute legal advice. STZA recommends engaging qualified legal counsel for jurisdiction-specific compliance guidance.
              {hasPipeline && assessment.agent_version && (
                <> Assessment generated by rule-based POPIA analysis engine v{assessment.agent_version}.</>
              )}
              {" "}The DPMI (Data Protection Maturity Index) is a proprietary scoring framework rating African jurisdictions across regulatory maturity, enforcement activity and cross-border complexity. Data sourced from public regulatory records. STZA&reg; is a trading name of Sports Tech Africa Limited (Companies House No. 16850337 &middot; ICO No. C1880558), United Kingdom.
            </p>
          </div>

        {/* @ts-expect-error doc-page is a web component */}
        </doc-page>
      </div>
    </>
  );
}

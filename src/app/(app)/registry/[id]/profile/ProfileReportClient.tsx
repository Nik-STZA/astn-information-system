"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { confidenceBand, type OrganizationDetail } from "@/lib/data/registry-shared";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatDate(d: Date): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatIsoDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return formatDate(d);
}

/* ── Confidence pill colours ─────────────────────────────────────────────── */
const CONF: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  High:         { color: "#6BAF7B", bg: "rgba(46,125,50,.12)", border: "rgba(46,125,50,.5)", dot: "#2E7D32" },
  Medium:       { color: "#D4A853", bg: "rgba(197,160,89,.14)", border: "rgba(197,160,89,.5)", dot: "#C5A059" },
  "Medium-Low": { color: "#EBA694", bg: "rgba(180,67,44,.16)", border: "rgba(180,67,44,.5)", dot: "#E06A4E" },
  Low:          { color: "#EBA694", bg: "rgba(180,67,44,.16)", border: "rgba(180,67,44,.5)", dot: "#E06A4E" },
};

/* ── Inline style objects ────────────────────────────────────────────────── */
const S = {
  sectionHead: { fontFamily: "'Manrope', sans-serif", fontWeight: 700 as const, fontSize: 13, lineHeight: "1.2", letterSpacing: ".16em", textTransform: "uppercase" as const, color: "#1A1A1A", margin: 0 },
  sectionRule: { flex: 1, height: 1, background: "#E7DFCE" },
  bodySerif: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 13, lineHeight: "1.7", color: "#33322E" },
  labelSm: { fontFamily: "'Manrope', sans-serif", fontWeight: 600 as const, fontSize: 9.5, lineHeight: "1", letterSpacing: ".1em", textTransform: "uppercase" as const, color: "#9A968B" },
  valueMd: { fontFamily: "'Newsreader', serif", fontWeight: 400 as const, fontSize: 12.5, lineHeight: "1.45", color: "#33322E" },
};

/* ── Field row component ─────────────────────────────────────────────────── */
function FieldRow({ label, value, fullWidth }: { label: string; value: string | null; fullWidth?: boolean }) {
  const display = value && value.trim().length > 0 ? value.trim() : null;
  if (!display) return null;
  return (
    <div style={{
      gridColumn: fullWidth ? "1 / -1" : undefined,
      padding: "11px 14px",
      borderBottom: "1px solid #EDE7D8",
      display: "flex",
      flexDirection: "column",
      gap: 3,
    }}>
      <div style={S.labelSm}>{label}</div>
      <div style={S.valueMd}>{display}</div>
    </div>
  );
}

/* ── Section component ───────────────────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ breakInside: "avoid" as const, margin: "0 0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px" }}>
        <h2 style={S.sectionHead}>{title}</h2>
        <div style={S.sectionRule} />
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        border: "1px solid #E7DFCE",
        borderRadius: 8,
        overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
export default function ProfileReportClient({ org }: { org: OrganizationDetail }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && customElements.get("doc-page")) {
      containerRef.current?.querySelectorAll("doc-page").forEach((el) => {
        if (el.isConnected) el.dispatchEvent(new Event("connected"));
      });
    }
  }, []);

  const band = confidenceBand(org.source_confidence);
  const conf = band ? CONF[band] ?? CONF.Medium : null;
  const today = formatDate(new Date());
  const breadcrumb = [org.country, org.sport, org.organization_type, org.level]
    .filter((v): v is string => !!v && v.length > 0)
    .join(" · ");

  return (
    <>
      <Script src="/doc-page.js" strategy="beforeInteractive" />

      <style>{`
        doc-page:not(:defined){visibility:hidden}
        .profile-doc a{color:#9C7C2E;text-decoration:none}
        .profile-doc a:hover{color:#C6A24E}
        @media print { .profile-nav-bar { display:none !important; } }
      `}</style>

      {/* Back nav bar — hidden when printing */}
      <div className="profile-nav-bar" style={{ fontFamily: "'Manrope', sans-serif", padding: "16px 0 8px", display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <a href={`/registry/${org.id}`} style={{ fontSize: 12.5, fontWeight: 500, color: "#A29C8E", textDecoration: "none" }}>
          &larr; Back to organisation
        </a>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "#D4C5A9" }}>|</span>
        <a href="/registry" style={{ fontSize: 12.5, fontWeight: 500, color: "#A29C8E", textDecoration: "none" }}>
          Registry
        </a>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "#D4C5A9" }}>|</span>
        <button
          onClick={() => window.print()}
          style={{ fontSize: 12.5, fontWeight: 600, color: "#C5A059", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          Print / Save PDF
        </button>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "#D4C5A9" }}>|</span>
        <a
          href={`/registry/${org.id}/report`}
          download
          style={{ fontSize: 12.5, fontWeight: 600, color: "#C5A059", textDecoration: "none" }}
        >
          Download .docx
        </a>
      </div>

      {/* ── Document ─────────────────────────────────────────────────── */}
      <div ref={containerRef} className="profile-doc">
        {/* @ts-expect-error doc-page is a web component */}
        <doc-page size="a4" margin="0.72in">

          {/* Running header */}
          <div slot="header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0 12px", margin: "0 0 6px", borderBottom: "1px solid #E7DFCE" }}>
            <img src="/logos/stza-logo-dark-crop.png" alt="STZA" style={{ height: 16, width: "auto", display: "block" }} />
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 9, lineHeight: "1", letterSpacing: ".16em", textTransform: "uppercase", color: "#9C7C2E" }}>Organisation profile</span>
          </div>

          {/* Running footer */}
          <div slot="footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 3px", margin: "6px 0 0", borderTop: "1px solid #E7DFCE", fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 8.5, lineHeight: "1.3", color: "#9A968B" }}>
            <span>STZA&reg; &middot; Sports Tech Africa Ltd &nbsp;|&nbsp; AfricanSTN information system</span>
            <span>Internal use only</span>
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, lineHeight: "1", letterSpacing: ".22em", textTransform: "uppercase", color: "#C6A24E", margin: "0 0 10px" }}>Organisation profile</div>
                <h1 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 28, lineHeight: "1.1", color: "#FFFFFF", margin: "0 0 7px", letterSpacing: "-.01em" }}>{org.organization_name ?? "Untitled organisation"}</h1>
                {breadcrumb && (
                  <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 12.5, lineHeight: "1.3", color: "#B7B2A6" }}>
                    {breadcrumb}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {conf && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: conf.bg, border: `1px solid ${conf.border}`, borderRadius: 5, padding: "6px 11px", margin: "0 0 12px" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: conf.dot, display: "block" }} />
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, lineHeight: "1", letterSpacing: ".1em", textTransform: "uppercase", color: conf.color }}>{band} confidence</span>
                  </div>
                )}
                {!conf && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 5, padding: "6px 11px", margin: "0 0 12px" }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, lineHeight: "1", letterSpacing: ".1em", textTransform: "uppercase", color: "#8C877B" }}>Unverified</span>
                  </div>
                )}
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 500, fontSize: 10, lineHeight: "1.5", color: "#8C877B" }}>
                  Generated {today}
                </div>
              </div>
            </div>
          </div>

          {/* ===== IDENTIFICATION ===== */}
          <Section title="Identification">
            <FieldRow label="Organisation name" value={org.organization_name} fullWidth />
            <FieldRow label="AfricanSTN ID" value={org.astn_id} />
            <FieldRow label="Organisation type" value={org.organization_type} />
            <FieldRow label="Status" value={org.status} />
            <FieldRow label="AfricanSTN vertical" value={org.astn_vertical} />
          </Section>

          {/* ===== CLASSIFICATION ===== */}
          <Section title="Classification">
            <FieldRow label="Country" value={org.country} />
            <FieldRow label="Country ISO" value={org.country_iso} />
            <FieldRow label="Region / province" value={org.region_province} />
            <FieldRow label="Sport" value={org.sport} />
            <FieldRow label="Level" value={org.level} />
            <FieldRow label="Parent national body" value={org.parent_national_body} />
            <FieldRow label="Continental body" value={org.continental_body} />
            <FieldRow label="National body website" value={org.national_body_website} fullWidth />
          </Section>

          {/* ===== WEB & CONTACT ===== */}
          <Section title="Web &amp; contact">
            <FieldRow label="Organisation website" value={org.organization_website} fullWidth />
            <FieldRow label="Contact email" value={org.contact_email} />
            <FieldRow label="Contact phone" value={org.contact_phone} />
            <FieldRow label="Social media" value={org.social_media} fullWidth />
          </Section>

          {/* ===== PARTNERSHIP & COMMERCIAL ===== */}
          <Section title="Partnership &amp; commercial">
            <FieldRow label="Partnership type" value={org.partnership_type} />
            <FieldRow label="Commercial priority" value={org.commercial_priority} />
            <FieldRow label="Outreach candidate" value={org.outreach_candidate} />
            <FieldRow label="Owner" value={org.owner} />
            <FieldRow label="Review date" value={org.review_date} />
            <FieldRow label="Next action" value={org.next_action} fullWidth />
          </Section>

          {/* ===== VERIFICATION ===== */}
          <Section title="Verification &amp; provenance">
            <FieldRow label="Source confidence" value={org.source_confidence} fullWidth />
            <FieldRow label="Verification source" value={org.verification_source} />
            <FieldRow label="Primary source" value={org.verification_source_primary} />
            <FieldRow label="Cross-reference" value={org.verification_source_xref} />
            <FieldRow label="Source label" value={org.verification_source_label} />
            <FieldRow label="Verification date" value={org.verification_date} />
            <FieldRow label="Data source" value={org.data_source} />
          </Section>

          {/* ===== NOTES & TAGS ===== */}
          {(org.notes || org.tags) && (
            <Section title="Notes &amp; tags">
              <FieldRow label="Tags" value={org.tags} fullWidth />
              <FieldRow label="Notes" value={org.notes} fullWidth />
            </Section>
          )}

          {/* ===== SYSTEM ===== */}
          <div style={{ breakInside: "avoid" as const, margin: "0 0 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px" }}>
              <h2 style={S.sectionHead}>System</h2>
              <div style={S.sectionRule} />
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1, border: "1px solid #E7DFCE", borderRadius: 8, padding: "13px 16px" }}>
                <div style={{ ...S.labelSm, margin: "0 0 5px" }}>Created</div>
                <div style={S.valueMd}>{formatIsoDate(org.created_at)}</div>
              </div>
              <div style={{ flex: 1, border: "1px solid #E7DFCE", borderRadius: 8, padding: "13px 16px" }}>
                <div style={{ ...S.labelSm, margin: "0 0 5px" }}>Last updated</div>
                <div style={S.valueMd}>{formatIsoDate(org.updated_at)}</div>
              </div>
            </div>
          </div>

          {/* ===== CLOSING / DISCLAIMER ===== */}
          <div style={{ borderTop: "2px solid #141414", padding: "14px 0 0", breakInside: "avoid" as const }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "0 0 10px" }}>
              <img src="/logos/stza-logo-dark-crop.png" alt="STZA" style={{ height: 18, width: "auto", display: "block" }} />
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10, lineHeight: "1.4", color: "#9A968B", textAlign: "right" }}>AfricanSTN information system &middot; African Sports Technology Network</span>
            </div>
            <p style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 9.5, lineHeight: "1.5", fontStyle: "italic", color: "#9A968B", margin: 0 }}>
              This document is generated from the AfricanSTN registry and is for internal use only. Data is sourced from public records and third-party databases; verification status is indicated above. STZA&reg; is a trading name of Sports Tech Africa Limited (Companies House No. 16850337 &middot; ICO No. C1880558), United Kingdom.
            </p>
          </div>

        {/* @ts-expect-error doc-page is a web component */}
        </doc-page>
      </div>
    </>
  );
}

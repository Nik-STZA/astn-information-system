"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import Link from "next/link";
import type { Prospect, Client, ProspectDocument, AnalysisFinding, ProspectAssessment, Jurisdiction, ComplianceAssessmentV2, ComplianceDocumentV2 } from "@/lib/data/compliance";
import { flagUrl as sharedFlagUrl } from "@/lib/country-iso";
import {
  addProspect,
  editProspect,
  removeProspect,
  addClient,
  editClient,
  addActivity,
  runProspectPipeline,
  getProspectPipelineResults,
  verifyIRStatus,
  getJurisdictions,
  runClientPipelineV2,
  getClientPipelineResultsV2,
} from "./actions";

/* ── Constants ─────────────────────────────────────────────────── */

const SECTORS = [
  "SaaS and Cloud",
  "Streaming and Media",
  "E-Commerce",
  "Financial Services",
  "AdTech and Data",
  "NGO and Foundation",
  "Sports Technology",
];

const STATUSES = ["identified", "researched", "contacted", "responded", "converted", "declined"];
const PRIORITIES = ["high", "medium", "low"];
const CLIENT_STATUSES = ["prospect", "onboarding", "engaged", "paused", "churned"];
const SERVICE_TIERS = ["essential", "professional", "enterprise"];

/* ── Pill colour metadata ──────────────────────────────────────── */

const STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  identified: { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
  researched: { color: "#3E6B8E", bg: "#E7EEF4", border: "#C6D8E5" },
  contacted:  { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  responded:  { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  converted:  { color: "#8B7340", bg: "#FBF1DE", border: "#EAD6A6" },
  declined:   { color: "#CC0000", bg: "#FBE3E3", border: "#E6C4C4" },
};

const PRIORITY_META: Record<string, { color: string; bg: string; border: string }> = {
  high:   { color: "#B4432C", bg: "#FBE7E1", border: "#EDCBBF" },
  medium: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  low:    { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
};

const CLIENT_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  prospect:   { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
  onboarding: { color: "#3E6B8E", bg: "#E7EEF4", border: "#C6D8E5" },
  engaged:    { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  paused:     { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  churned:    { color: "#CC0000", bg: "#FBE3E3", border: "#E6C4C4" },
};

const PILL_UNSET = { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" };

/* ── Shared components ─────────────────────────────────────────── */

function Pill({ value, meta }: { value: string | null; meta: Record<string, { color: string; bg: string; border: string }> }) {
  if (!value) return <span style={{ fontSize: 12, color: "#B9B2A2" }}>{"—"}</span>;
  const m = meta[value] ?? PILL_UNSET;
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 700,
        fontSize: 10,
        lineHeight: 1,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 20,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

function StatCard({ label, value, dashed }: { label: string; value: string; dashed?: boolean }) {
  return (
    <div
      className={dashed ? "card-empty" : "card"}
      style={{
        padding: "16px 18px",
      }}
    >
      <div className={dashed ? "kpi-number-empty" : ""} style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.1, color: dashed ? "#B9B2A2" : "var(--tx)" }}>
        {value}
      </div>
      <div style={{ fontWeight: 500, fontSize: 11.5, color: "#8E9196", marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontWeight: 600, fontSize: 11, color: "#6E6A62", marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function DetailRow({ label, value, link }: { label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontWeight: 500, fontSize: 12.5, color: "#8E9196", width: 140, flexShrink: 0 }}>{label}</span>
      {value ? (
        link ? (
          <a
            href={value.startsWith("http") ? value : `https://${value}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontWeight: 500, fontSize: 12.5, color: "#B08D3F", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {value}
          </a>
        ) : (
          <span style={{ fontWeight: 500, fontSize: 12.5, color: "var(--tx)" }}>{value}</span>
        )
      ) : (
        <span style={{ fontWeight: 500, fontSize: 12.5, color: "#B9B2A2" }}>{"—"}</span>
      )}
    </div>
  );
}

/* ── Input styles ──────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--bd)",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--tx)",
  background: "var(--pnl)",
  outline: "none",
};

const btnPrimaryStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  color: "#141414",
  background: "#C5A059",
  border: "none",
  borderRadius: 6,
  padding: "9px 16px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnSecondaryStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  color: "#55524C",
  background: "var(--pnl)",
  border: "1px solid #D4C5A9",
  borderRadius: 6,
  padding: "9px 16px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnDangerStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  color: "#CC0000",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "4px 8px",
  borderRadius: 4,
};

/* ── Modal ─────────────────────────────────────────────────────── */

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 80, padding: "80px 16px 16px" }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)" }} onClick={onClose} />
      <div style={{ position: "relative", background: "var(--pnl)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.2)", width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid var(--bd)" }}>
          <h3 style={{ fontWeight: 700, fontSize: 16, color: "var(--tx)", margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8E9196", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ padding: "16px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

/* ── Prospect form ─────────────────────────────────────────────── */

function ProspectForm({ prospect, onClose }: { prospect?: Prospect; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (prospect) { await editProspect(prospect.id, fd); } else { await addProspect(fd); }
      onClose();
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <FormField label="Company name *">
          <input name="company_name" required defaultValue={prospect?.company_name ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Website">
          <input name="company_website" defaultValue={prospect?.company_website ?? ""} placeholder="https://" style={inputStyle} />
        </FormField>
        <FormField label="Country">
          <input name="company_country" defaultValue={prospect?.company_country ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Sector">
          <select name="sector" defaultValue={prospect?.sector ?? ""} style={inputStyle}>
            <option value="">Select...</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Priority">
          <select name="priority" defaultValue={prospect?.priority ?? "medium"} style={inputStyle}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Outreach status">
          <select name="outreach_status" defaultValue={prospect?.outreach_status ?? "identified"} style={inputStyle}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="IR registered">
          <select name="ir_registered" defaultValue={prospect?.ir_registered === true ? "true" : prospect?.ir_registered === false ? "false" : ""} style={inputStyle}>
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </FormField>
        <FormField label="Estimated tier">
          <select name="estimated_tier" defaultValue={prospect?.estimated_tier ?? ""} style={inputStyle}>
            <option value="">Select...</option>
            {SERVICE_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="SA presence evidence">
        <input name="sa_presence_evidence" defaultValue={prospect?.sa_presence_evidence ?? ""} style={inputStyle} placeholder="e.g. App available on SA App Store" />
      </FormField>

      {/* Document / URL fields */}
      <div style={{ border: "1px solid var(--bd)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8E9196" }}>Documents &amp; URLs for review</div>
        <FormField label="Privacy policy URL">
          <input name="privacy_policy_url" type="url" defaultValue={prospect?.privacy_policy_url ?? ""} style={inputStyle} placeholder="https://example.com/privacy" />
        </FormField>
        <FormField label="Terms of service URL">
          <input name="terms_url" type="url" defaultValue={prospect?.terms_url ?? ""} style={inputStyle} placeholder="https://example.com/terms" />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <FormField label="LinkedIn URL">
            <input name="linkedin_url" type="url" defaultValue={prospect?.linkedin_url ?? ""} style={inputStyle} placeholder="https://linkedin.com/company/..." />
          </FormField>
          <FormField label="App Store / Play Store URL">
            <input name="app_store_url" type="url" defaultValue={prospect?.app_store_url ?? ""} style={inputStyle} placeholder="https://apps.apple.com/..." />
          </FormField>
        </div>
        <FormField label="Other review URLs (one per line)">
          <textarea name="other_urls" rows={2} defaultValue={prospect?.other_urls ?? ""} style={inputStyle} placeholder="Paste additional URLs for compliance review" />
        </FormField>
      </div>

      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={prospect?.notes ?? ""} style={inputStyle} />
      </FormField>
      {prospect && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <FormField label="Outreach date">
            <input type="date" name="outreach_date" defaultValue={prospect.outreach_date?.slice(0, 10) ?? ""} style={inputStyle} />
          </FormField>
          <FormField label="Channel">
            <input name="outreach_channel" defaultValue={prospect.outreach_channel ?? ""} style={inputStyle} placeholder="e.g. Email, LinkedIn" />
          </FormField>
          <FormField label="Response date">
            <input type="date" name="response_date" defaultValue={prospect.response_date?.slice(0, 10) ?? ""} style={inputStyle} />
          </FormField>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>Cancel</button>
        <button type="submit" disabled={isPending} style={{ ...btnPrimaryStyle, opacity: isPending ? 0.6 : 1 }}>
          {isPending ? "Saving..." : prospect ? "Update prospect" : "Add prospect"}
        </button>
      </div>
    </form>
  );
}

/* ── Prospect detail slide-out ─────────────────────────────────── */

function SeverityPill({ severity }: { severity: string }) {
  const meta: Record<string, { color: string; bg: string; border: string }> = {
    critical: { color: "#CC0000", bg: "#FBE3E3", border: "#E6C4C4" },
    high: { color: "#B4432C", bg: "#FBE7E1", border: "#EDCBBF" },
    medium: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
    low: { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
    info: { color: "#3E6B8E", bg: "#E7EEF4", border: "#C6D8E5" },
  };
  const m = meta[severity] ?? meta.info;
  return (
    <span style={{
      display: "inline-block", fontWeight: 700, fontSize: 9, lineHeight: 1,
      textTransform: "uppercase", letterSpacing: "0.04em",
      color: m.color, background: m.bg, border: `1px solid ${m.border}`,
      borderRadius: 20, padding: "3px 8px", whiteSpace: "nowrap",
    }}>
      {severity}
    </span>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const s = Number(score ?? 0);
  const color = s >= 7 ? "#2E7D32" : s >= 4 ? "#A67514" : "#B4432C";
  return (
    <div style={{ textAlign: "center", padding: "8px 4px" }}>
      <div style={{ fontWeight: 800, fontSize: 18, color }}>{s}</div>
      <div style={{ fontWeight: 500, fontSize: 9, color: "#8E9196", marginTop: 2, lineHeight: 1.2 }}>{label}</div>
    </div>
  );
}


/** Score badge for 0–100 scale (V2 engine). */
function ScoreBadge100({ score, label }: { score: number; label: string }) {
  const s = Math.round(score ?? 0);
  const color = s >= 70 ? "#2E7D32" : s >= 40 ? "#A67514" : "#B4432C";
  return (
    <div style={{ textAlign: "center", padding: "8px 4px" }}>
      <div style={{ fontWeight: 800, fontSize: 16, color }}>{s}</div>
      <div style={{ fontWeight: 500, fontSize: 9, color: "#8E9196", marginTop: 2, lineHeight: 1.2 }}>{label}</div>
    </div>
  );
}

function IRVerificationPanel({ prospect, onProspectUpdate }: { prospect: Prospect; onProspectUpdate?: (updated: Prospect) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isVerified = prospect.ir_verification_method && prospect.ir_verification_method !== "assumed";
  const headerStyle: React.CSSProperties = { fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#8E9196", marginBottom: 10 };
  const labelStyle: React.CSSProperties = { fontWeight: 500, fontSize: 10.5, color: "#B9B2A2", marginBottom: 3 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--bd)", fontSize: 12.5, fontFamily: "inherit", background: "var(--pnl)", color: "var(--tx)" };

  const handleSubmit = () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    startSaving(async () => {
      await verifyIRStatus(prospect.id, fd);
      // Optimistically update local state so status badge refreshes
      if (onProspectUpdate) {
        const irRegisteredVal = fd.get("ir_registered") as string;
        onProspectUpdate({
          ...prospect,
          ir_registered: irRegisteredVal === "true" ? true : irRegisteredVal === "false" ? false : null,
          ir_verification_method: "manual_portal",
          ir_verified_date: (fd.get("ir_verified_date") as string) || new Date().toISOString().slice(0, 10),
          ir_verification_notes: (fd.get("ir_verification_notes") as string) || null,
          ir_entity_name: (fd.get("ir_entity_name") as string) || null,
          ir_registration_no: (fd.get("ir_registration_no") as string) || null,
          ir_io_name: (fd.get("ir_io_name") as string) || null,
          ir_io_designation: (fd.get("ir_io_designation") as string) || null,
          ir_registration_date: (fd.get("ir_registration_date") as string) || null,
          ir_organisation_type: (fd.get("ir_organisation_type") as string) || null,
        });
      }
      setOpen(false);
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={headerStyle}>IR verification</div>
        {isVerified ? (
          <span style={{ fontSize: 10, fontWeight: 600, color: "#2E7D32", background: "#E7F1EA", border: "1px solid #C7E1D1", borderRadius: 10, padding: "2px 8px" }}>Verified</span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 600, color: "#A67514", background: "#FBF1DE", border: "1px solid #EAD6A6", borderRadius: 10, padding: "2px 8px" }}>Not verified</span>
        )}
      </div>
      {isVerified && !open ? (
        <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10, padding: 14, marginTop: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#8E9196" }}>Status</span>
              <span style={{ fontWeight: 600, color: prospect.ir_registered ? "#2E7D32" : "#B4432C" }}>
                {prospect.ir_registered ? "Registered" : "Not registered"}
              </span>
            </div>
            {prospect.ir_entity_name && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8E9196" }}>Entity name</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>{prospect.ir_entity_name}</span>
              </div>
            )}
            {prospect.ir_registration_no && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8E9196" }}>Registration no.</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>{prospect.ir_registration_no}</span>
              </div>
            )}
            {prospect.ir_registration_date && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8E9196" }}>Registration date</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>{new Date(prospect.ir_registration_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
            )}
            {prospect.ir_organisation_type && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8E9196" }}>Organisation type</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>{prospect.ir_organisation_type}</span>
              </div>
            )}
            {prospect.ir_io_name && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8E9196" }}>Information Officer</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>
                  {prospect.ir_io_name}{prospect.ir_io_designation ? ` (${prospect.ir_io_designation})` : ""}
                </span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#8E9196" }}>Verified</span>
              <span style={{ fontWeight: 500, color: "var(--tx)" }}>
                {prospect.ir_verified_date ? new Date(prospect.ir_verified_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"} via portal
              </span>
            </div>
            {prospect.ir_verification_notes && (
              <p style={{ fontSize: 11.5, color: "#55524C", margin: "4px 0 0", lineHeight: 1.4, fontStyle: "italic" }}>{prospect.ir_verification_notes}</p>
            )}
          </div>
          <button onClick={() => setOpen(true)} style={{ marginTop: 10, width: "100%", padding: "7px 12px", borderRadius: 6, border: "1px solid var(--bd)", background: "transparent", cursor: "pointer", fontSize: 11.5, fontWeight: 500, color: "#8E9196", fontFamily: "inherit" }}>
            Re-verify
          </button>
        </div>
      ) : (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10, padding: 14, marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 11, color: "#8E9196", margin: 0, lineHeight: 1.4 }}>
            Search the IR eServices portal (<a href="https://eservices.inforegulator.org.za/search/default.aspx" target="_blank" rel="noopener noreferrer" style={{ color: "#B08D3F" }}>Organisation Search</a>) and record the result below.
          </p>
          <div>
            <div style={labelStyle}>Found on register?</div>
            <select name="ir_registered" defaultValue={prospect.ir_registered === true ? "true" : prospect.ir_registered === false ? "false" : ""} style={inputStyle} required>
              <option value="">— Select —</option>
              <option value="true">Yes — registered</option>
              <option value="false">No — not found</option>
            </select>
          </div>
          <div>
            <div style={labelStyle}>Entity name on register</div>
            <input name="ir_entity_name" defaultValue={prospect.ir_entity_name || ""} placeholder="e.g. GARMIN SOUTH AFRICA TECHNOLOGIES" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={labelStyle}>Registration no.</div>
              <input name="ir_registration_no" defaultValue={prospect.ir_registration_no || ""} placeholder="YYYY-NNNNNN" style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Registration date</div>
              <input type="date" name="ir_registration_date" defaultValue={prospect.ir_registration_date || ""} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={labelStyle}>Organisation type</div>
              <select name="ir_organisation_type" defaultValue={prospect.ir_organisation_type || ""} style={inputStyle}>
                <option value="">Select...</option>
                <option value="Private Body">Private Body</option>
                <option value="Public Body">Public Body</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Verification date</div>
              <input type="date" name="ir_verified_date" defaultValue={prospect.ir_verified_date || new Date().toISOString().slice(0, 10)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={labelStyle}>IO name</div>
              <input name="ir_io_name" defaultValue={prospect.ir_io_name || ""} placeholder="Surname, First name(s)" style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>IO designation</div>
              <input name="ir_io_designation" defaultValue={prospect.ir_io_designation || ""} placeholder="e.g. Managing Director" style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Notes</div>
            <textarea name="ir_verification_notes" defaultValue={prospect.ir_verification_notes || ""} placeholder="Search terms used, false positives, etc." rows={2} style={{ ...inputStyle, resize: "vertical" as const }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={{ flex: 1, padding: "9px 12px", borderRadius: 6, border: "none", background: "#1A1C1E", color: "#fff", fontWeight: 600, fontSize: 12, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
              {saving ? "Saving..." : "Save verification"}
            </button>
            {isVerified && (
              <button type="button" onClick={() => setOpen(false)} style={{ padding: "9px 12px", borderRadius: 6, border: "1px solid var(--bd)", background: "transparent", color: "#8E9196", fontWeight: 500, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function ProspectDetail({
  prospect, onClose, onEdit, onRunPipeline, pipelineRunning, pipelineResult,
  pipelineData, onProspectUpdate,
}: {
  prospect: Prospect; onClose: () => void; onEdit: () => void;
  onRunPipeline: () => void; pipelineRunning: boolean;
  pipelineResult: { error?: string | null; data?: Record<string, unknown> | null } | null;
  pipelineData: {
    documents: ProspectDocument[];
    findings: AnalysisFinding[];
    assessment: ProspectAssessment | null;
  } | null;
  onProspectUpdate?: (updated: Prospect) => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)" }} onClick={onClose} />
      <div style={{ position: "relative", background: "#F5F0E8", height: "100%", width: "100%", maxWidth: 520, overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,.15)", animation: "slideIn .25s ease-out" }}>
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 1, background: "#F5F0E8", borderBottom: "1px solid #E4D9C4", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontWeight: 700, fontSize: 16, color: "var(--tx)", margin: 0 }}>{prospect.company_name}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a href={`/compliance/assessment/${prospect.id}`} style={{ ...btnSecondaryStyle, textDecoration: "none", textAlign: "center" }}>Assessment</a>
            <button onClick={onEdit} style={btnPrimaryStyle}>Edit</button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8E9196", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>&times;</button>
          </div>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Status cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div style={{ textAlign: "center", padding: 12, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)" }}>
              <Pill value={prospect.priority} meta={PRIORITY_META} />
              <div style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196", marginTop: 6 }}>Priority</div>
            </div>
            <div style={{ textAlign: "center", padding: 12, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)" }}>
              <Pill value={prospect.outreach_status} meta={STATUS_META} />
              <div style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196", marginTop: 6 }}>Status</div>
            </div>
            <div style={{ textAlign: "center", padding: 12, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)" }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {prospect.ir_registered === true ? <span style={{ color: "#2E7D32" }}>Yes</span>
                  : prospect.ir_registered === false ? <span style={{ color: "#B4432C" }}>No</span>
                  : <span style={{ color: "#B9B2A2" }}>Unknown</span>}
              </div>
              <div style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196", marginTop: 4 }}>IR registered</div>
            </div>
          </div>

          {/* IR verification panel */}
          <IRVerificationPanel prospect={prospect} onProspectUpdate={onProspectUpdate} />

          {/* Company details */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Company details</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <DetailRow label="Country" value={prospect.company_country} />
              <DetailRow label="Sector" value={prospect.sector} />
              <DetailRow label="Website" value={prospect.company_website} link />
              <DetailRow label="Estimated tier" value={prospect.estimated_tier} />
            </div>
          </div>

          {/* SA presence */}
          {prospect.sa_presence_evidence && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 6 }}>SA presence evidence</div>
              <p style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", background: "var(--pnl)", borderRadius: 8, padding: 12, margin: 0, lineHeight: 1.5 }}>{prospect.sa_presence_evidence}</p>
            </div>
          )}

          {/* Documents & URLs */}
          {(prospect.privacy_policy_url || prospect.terms_url || prospect.linkedin_url || prospect.app_store_url || prospect.other_urls) && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Documents &amp; URLs</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <DetailRow label="Privacy policy" value={prospect.privacy_policy_url} link />
                <DetailRow label="Terms of service" value={prospect.terms_url} link />
                <DetailRow label="LinkedIn" value={prospect.linkedin_url} link />
                <DetailRow label="App Store" value={prospect.app_store_url} link />
                {prospect.other_urls && (
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 10.5, color: "#B9B2A2" }}>Other URLs</span>
                    <div style={{ fontSize: 12.5, background: "var(--pnl)", borderRadius: 8, padding: 10, marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                      {prospect.other_urls.split("\n").filter(Boolean).map((url, i) => (
                        <a key={i} href={url.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "#B08D3F", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{url.trim()}</a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Research pipeline */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Compliance pipeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: "#8E9196" }}>Status</span>
                <Pill value={prospect.research_status || "not_started"} meta={{
                  assessed: { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
                  complete: { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
                  analysed: { color: "#3E6B8E", bg: "#E7EEF4", border: "#C6D8E5" },
                  analysing: { color: "#3E6B8E", bg: "#E7EEF4", border: "#C6D8E5" },
                  collected: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
                  collecting: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
                  not_started: { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: "#8E9196" }}>Documents</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>{prospect.document_count || 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: "#8E9196" }}>Findings</span>
                <span style={{ fontWeight: 500, color: "var(--tx)" }}>
                  {prospect.finding_count || 0}
                  {(prospect.critical_finding_count || 0) > 0 && (
                    <span style={{ marginLeft: 4, color: "#B4432C", fontWeight: 600 }}>
                      ({prospect.critical_finding_count} critical/high)
                    </span>
                  )}
                </span>
              </div>
              {prospect.last_research_date && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: "#8E9196" }}>Last run</span>
                  <span style={{ fontWeight: 500, color: "var(--tx)" }}>{new Date(prospect.last_research_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              )}
              <button
                onClick={onRunPipeline}
                disabled={pipelineRunning}
                style={{
                  width: "100%", padding: "10px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  border: "none", cursor: pipelineRunning ? "wait" : "pointer",
                  background: pipelineRunning ? "#EEECE7" : "#1A1C1E",
                  color: pipelineRunning ? "#8E9196" : "#FFFFFF",
                  transition: "background .15s",
                }}
              >
                {pipelineRunning ? "Running pipeline..." : prospect.research_status === "assessed" || prospect.research_status === "complete" ? "Re-run analysis" : "Run compliance analysis"}
              </button>
              {pipelineResult?.error && (
                <p style={{ fontSize: 11, color: "#B4432C", background: "#FBE7E1", borderRadius: 6, padding: 10, margin: 0 }}>{pipelineResult.error}</p>
              )}
              {pipelineResult?.data && !pipelineResult.error && (
                <p style={{ fontSize: 11, color: "#2E7D32", background: "#E7F1EA", borderRadius: 6, padding: 10, margin: 0 }}>
                  Pipeline complete. {(pipelineResult.data as Record<string, unknown>)["findings_count"] as number || ((pipelineResult.data as Record<string, unknown>)["stages"] as Record<string, Record<string, unknown>> | undefined)?.["analyse"]?.["findings_count"] as number || 0} findings generated.
                </p>
              )}
            </div>
          </div>

          {/* Assessment scores (from rule engine) */}
          {pipelineData?.assessment && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Assessment scores</div>
              <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontWeight: 800, fontSize: 24,
                      color: Number(pipelineData.assessment.score_overall ?? 0) >= 7 ? "#2E7D32" : Number(pipelineData.assessment.score_overall ?? 0) >= 4 ? "#A67514" : "#B4432C",
                    }}>
                      {Number(pipelineData.assessment.score_overall ?? 0)}/10
                    </span>
                    <SeverityPill severity={pipelineData.assessment.overall_severity} />
                  </div>
                  <span style={{ fontWeight: 500, fontSize: 10, color: "#8E9196" }}>
                    {pipelineData.assessment.generated_by} v{pipelineData.assessment.agent_version}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
                  <ScoreBadge score={pipelineData.assessment.score_ir_registration} label="IR reg." />
                  <ScoreBadge score={pipelineData.assessment.score_biometric_handling} label="Biometric" />
                  <ScoreBadge score={pipelineData.assessment.score_cross_border} label="Cross-border" />
                  <ScoreBadge score={pipelineData.assessment.score_consent_mechanism} label="Consent" />
                  <ScoreBadge score={pipelineData.assessment.score_breach_notification} label="Breach" />
                  <ScoreBadge score={pipelineData.assessment.score_data_subject_rights} label="DSR" />
                </div>
                {pipelineData.assessment.executive_summary && (
                  <p style={{ fontWeight: 500, fontSize: 11.5, color: "#55524C", margin: "12px 0 0", lineHeight: 1.5, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
                    {pipelineData.assessment.executive_summary}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Documents fetched */}
          {pipelineData && pipelineData.documents.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 8 }}>Fetched documents ({pipelineData.documents.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pipelineData.documents.map((doc) => (
                  <div key={doc.id} style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 12, color: "var(--tx)" }}>{doc.document_type}</span>
                      {doc.source_url && (
                        <a href={doc.source_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, fontWeight: 500, fontSize: 11, color: "#B08D3F", textDecoration: "none" }}>
                          source
                        </a>
                      )}
                    </div>
                    <span style={{ fontWeight: 500, fontSize: 10, color: "#8E9196" }}>
                      {doc.markdown_content ? `${(doc.markdown_content.length / 1000).toFixed(1)}k chars` : "empty"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Findings */}
          {pipelineData && pipelineData.findings.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 8 }}>
                Findings ({pipelineData.findings.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pipelineData.findings.map((f) => (
                  <div key={f.id} style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 11, color: "var(--tx)", textTransform: "capitalize" }}>
                        {f.check_category.replace(/_/g, " ")}
                      </span>
                      <SeverityPill severity={f.severity} />
                    </div>
                    <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: "#55524C" }}>{f.finding}</p>
                    {f.recommendation && (
                      <p style={{ margin: "6px 0 0", fontSize: 10.5, lineHeight: 1.4, color: "#8E9196", fontStyle: "italic" }}>
                        {f.recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outreach timeline */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Outreach timeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <DetailRow label="Outreach date" value={prospect.outreach_date?.slice(0, 10)} />
              <DetailRow label="Channel" value={prospect.outreach_channel} />
              <DetailRow label="Response date" value={prospect.response_date?.slice(0, 10)} />
            </div>
          </div>

          {/* Notes */}
          {prospect.notes && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 6 }}>Notes</div>
              <p style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", whiteSpace: "pre-wrap", background: "var(--pnl)", borderRadius: 8, padding: 12, margin: 0, lineHeight: 1.5 }}>{prospect.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Client detail slide-out ───────────────────────────────────── */

function ClientDetail({ client, onClose, onEdit, onAddActivity, jurisdictions }: { client: Client; onClose: () => void; onEdit: () => void; onAddActivity: () => void; jurisdictions: Jurisdiction[] }) {
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<number | "">(jurisdictions.length === 1 ? jurisdictions[0].id : "");
  const [v2Running, setV2Running] = useState(false);
  const [v2Error, setV2Error] = useState<string | null>(null);
  const [v2Success, setV2Success] = useState<string | null>(null);
  const [v2Data, setV2Data] = useState<{
    documents: ComplianceDocumentV2[];
    assessments: ComplianceAssessmentV2[];
    latestAssessment: ComplianceAssessmentV2 | null;
  } | null>(null);
  const [v2Loading, startV2] = useTransition();

  const loadV2Data = useCallback(() => {
    startV2(async () => {
      const results = await getClientPipelineResultsV2(client.id);
      setV2Data({
        documents: results.documents,
        assessments: results.assessments,
        latestAssessment: results.latestAssessment,
      });
    });
  }, [client.id]);

  useEffect(() => { loadV2Data(); }, [loadV2Data]);

  const handleRunV2Pipeline = useCallback(() => {
    if (!selectedJurisdiction) return;
    setV2Running(true);
    setV2Error(null);
    setV2Success(null);
    startV2(async () => {
      try {
        const urls: Array<{ url: string; document_type: string; title?: string }> = [];
        if (client.company_website) {
          const raw = client.company_website.startsWith("http") ? client.company_website : `https://${client.company_website}`;
          const origin = new URL(raw).origin;
          urls.push({ url: raw, document_type: "other", title: `${client.company_name} — website` });
          urls.push({ url: `${origin}/privacy`, document_type: "privacy_policy", title: `${client.company_name} — privacy policy` });
          urls.push({ url: `${origin}/privacy-policy`, document_type: "privacy_policy", title: `${client.company_name} — privacy policy (alt)` });
          urls.push({ url: `${origin}/terms`, document_type: "terms_of_service", title: `${client.company_name} — terms` });
        }
        const result = await runClientPipelineV2(client.id, selectedJurisdiction, urls);
        if (result.error) {
          setV2Error(result.error);
        } else {
          setV2Success("Pipeline complete");
          loadV2Data();
        }
      } catch {
        setV2Error("Pipeline failed unexpectedly");
      } finally {
        setV2Running(false);
      }
    });
  }, [client, selectedJurisdiction, loadV2Data]);

  const latestAssessment = v2Data?.latestAssessment;
  const domainEntries = latestAssessment?.domain_scores
    ? Object.entries(latestAssessment.domain_scores)
    : [];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)" }} onClick={onClose} />
      <div style={{ position: "relative", background: "#F5F0E8", height: "100%", width: "100%", maxWidth: 520, overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,.15)", animation: "slideIn .25s ease-out" }}>
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <div style={{ position: "sticky", top: 0, zIndex: 1, background: "#F5F0E8", borderBottom: "1px solid #E4D9C4", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontWeight: 700, fontSize: 16, color: "var(--tx)", margin: 0 }}>{client.company_name}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={onAddActivity} style={btnSecondaryStyle}>+ Activity</button>
            <button onClick={onEdit} style={btnPrimaryStyle}>Edit</button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8E9196", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>&times;</button>
          </div>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Status cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div style={{ textAlign: "center", padding: 12, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)" }}>
              <Pill value={client.status} meta={CLIENT_STATUS_META} />
              <div style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196", marginTop: 6 }}>Status</div>
            </div>
            <div style={{ textAlign: "center", padding: 12, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--tx)" }}>{client.service_tier ?? "—"}</div>
              <div style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196", marginTop: 4 }}>Service tier</div>
            </div>
            <div style={{ textAlign: "center", padding: 12, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--tx)" }}>
                {client.annual_fee_gbp != null ? `£${Number(client.annual_fee_gbp).toLocaleString("en-GB")}` : "—"}
              </div>
              <div style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196", marginTop: 4 }}>Annual fee</div>
            </div>
          </div>

          {/* Company details */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Company details</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <DetailRow label="Country" value={client.company_country} />
              <DetailRow label="Website" value={client.company_website} link />
              <DetailRow label="Engagement start" value={client.engagement_start?.slice(0, 10)} />
            </div>
          </div>

          {/* Contact */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Contact</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <DetailRow label="Name" value={client.contact_name} />
              <DetailRow label="Email" value={client.contact_email} />
              <DetailRow label="Role" value={client.contact_role} />
            </div>
          </div>

          {/* Data processing flags */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Data processing</div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: client.processes_biometric ? "#CC7700" : "#DED9CE" }} />
                Biometric: {client.processes_biometric ? "Yes" : "No"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: client.processes_minors ? "#B4432C" : "#DED9CE" }} />
                Minors: {client.processes_minors ? "Yes" : "No"}
              </div>
            </div>
          </div>

          {/* ─── V2 Compliance Analysis Pipeline ─────────────────────── */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>
              Compliance analysis
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select
                value={selectedJurisdiction}
                onChange={(e) => setSelectedJurisdiction(e.target.value ? Number(e.target.value) : "")}
                style={{ ...inputStyle, width: "100%" }}
              >
                <option value="">Select jurisdiction...</option>
                {jurisdictions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.short_name} — {j.name} ({j.domain_count} domains, {j.requirement_count} requirements)
                  </option>
                ))}
              </select>

              <button
                onClick={handleRunV2Pipeline}
                disabled={v2Running || !selectedJurisdiction}
                style={{
                  width: "100%", padding: "10px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  border: "none", cursor: v2Running || !selectedJurisdiction ? "not-allowed" : "pointer",
                  background: v2Running || !selectedJurisdiction ? "#EEECE7" : "#1A1C1E",
                  color: v2Running || !selectedJurisdiction ? "#8E9196" : "#FFFFFF",
                  transition: "background .15s",
                }}
              >
                {v2Running ? "Running pipeline..." : latestAssessment ? "Re-run analysis" : "Run compliance analysis"}
              </button>

              {v2Error && (
                <p style={{ fontSize: 11, color: "#B4432C", background: "#FBE7E1", borderRadius: 6, padding: 10, margin: 0 }}>{v2Error}</p>
              )}
              {v2Success && !v2Error && (
                <p style={{ fontSize: 11, color: "#2E7D32", background: "#E7F1EA", borderRadius: 6, padding: 10, margin: 0 }}>{v2Success}</p>
              )}
            </div>
          </div>

          {/* V2 loading indicator */}
          {v2Loading && !v2Data && (
            <p style={{ fontSize: 11.5, color: "#8E9196", fontStyle: "italic", margin: 0 }}>Loading assessment data...</p>
          )}

          {/* V2 empty state — data loaded but no assessments */}
          {v2Data && !latestAssessment && v2Data.documents.length === 0 && !v2Loading && (
            <div style={{
              background: "rgba(197,160,89,.06)", border: "1px dashed #D4C5A9", borderRadius: 10,
              padding: "16px 20px", textAlign: "center",
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--tx)", marginBottom: 4 }}>No assessments yet</div>
              <p style={{ fontSize: 11.5, color: "#8E9196", margin: 0, lineHeight: 1.5 }}>
                Select a jurisdiction above and run a compliance analysis to assess this client&apos;s data protection posture.
              </p>
            </div>
          )}

          {/* V2 Assessment results */}
          {latestAssessment && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>
                Assessment — {latestAssessment.jurisdiction ?? latestAssessment.jurisdiction_code ?? "unknown"}
              </div>
              <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontWeight: 800, fontSize: 24,
                      color: latestAssessment.overall_score >= 70 ? "#2E7D32" : latestAssessment.overall_score >= 40 ? "#A67514" : "#B4432C",
                    }}>
                      {Math.round(latestAssessment.overall_score)}/100
                    </span>
                    <SeverityPill severity={latestAssessment.confidence_level ?? "medium"} />
                  </div>
                  <span style={{ fontWeight: 500, fontSize: 10, color: "#8E9196" }}>v{latestAssessment.engine_version}</span>
                </div>

                {domainEntries.length > 0 && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(domainEntries.length, 5)}, 1fr)`,
                    gap: 4, borderTop: "1px solid var(--bd)", paddingTop: 10,
                  }}>
                    {domainEntries.map(([code, ds]) => (
                      <ScoreBadge100 key={code} score={ds.score} label={ds.name} />
                    ))}
                  </div>
                )}

                {latestAssessment.working_papers?.executive_summary && (
                  <p style={{ fontWeight: 500, fontSize: 11.5, color: "#55524C", margin: "12px 0 0", lineHeight: 1.5, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
                    {latestAssessment.working_papers.executive_summary.slice(0, 400)}
                    {latestAssessment.working_papers.executive_summary.length > 400 ? "..." : ""}
                  </p>
                )}

                <div style={{ marginTop: 12, borderTop: "1px solid var(--bd)", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 500, fontSize: 10.5, color: "#8E9196" }}>
                    {latestAssessment.completed_at
                      ? new Date(latestAssessment.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "In progress"}
                  </span>
                  <Link
                    href={`/compliance/assessment-v2/${latestAssessment.id}`}
                    style={{ fontWeight: 600, fontSize: 11, color: "#B08D3F", textDecoration: "none" }}
                  >
                    View full report &rarr;
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* V2 Documents */}
          {v2Data && v2Data.documents.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 8 }}>
                Documents ({v2Data.documents.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {v2Data.documents.slice(0, 8).map((doc) => (
                  <div key={doc.id} style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 12, color: "var(--tx)" }}>{doc.title || doc.document_type}</span>
                      {doc.source_url && (
                        <a href={doc.source_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, fontWeight: 500, fontSize: 11, color: "#B08D3F", textDecoration: "none" }}>source</a>
                      )}
                    </div>
                    <span style={{ fontWeight: 500, fontSize: 10, color: "#8E9196" }}>
                      {doc.word_count ? `${doc.word_count.toLocaleString("en-GB")} words` : doc.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assessment history */}
          {v2Data && v2Data.assessments.length > 1 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 8 }}>
                Assessment history ({v2Data.assessments.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {v2Data.assessments.map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, padding: "6px 0" }}>
                    <span style={{ color: "#55524C" }}>{a.jurisdiction ?? a.jurisdiction_code ?? "—"} — {Math.round(a.overall_score)}/100</span>
                    <span style={{ color: "#8E9196", fontSize: 10 }}>
                      {a.status} · {a.completed_at ? new Date(a.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity summary */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 6 }}>Activities</div>
            <p style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", margin: 0 }}>{client.activity_count} activities logged</p>
          </div>

          {/* Notes */}
          {client.notes && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 6 }}>Notes</div>
              <p style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", whiteSpace: "pre-wrap", background: "var(--pnl)", borderRadius: 8, padding: 12, margin: 0, lineHeight: 1.5 }}>{client.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Client form ───────────────────────────────────────────────── */

function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (client) { await editClient(client.id, fd); } else { await addClient(fd); }
      onClose();
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <FormField label="Company name *">
          <input name="company_name" required defaultValue={client?.company_name ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Website">
          <input name="company_website" defaultValue={client?.company_website ?? ""} placeholder="https://" style={inputStyle} />
        </FormField>
        <FormField label="Country">
          <input name="company_country" defaultValue={client?.company_country ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Status">
          <select name="status" defaultValue={client?.status ?? "prospect"} style={inputStyle}>
            {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Contact name">
          <input name="contact_name" defaultValue={client?.contact_name ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Contact email">
          <input name="contact_email" type="email" defaultValue={client?.contact_email ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Contact role">
          <input name="contact_role" defaultValue={client?.contact_role ?? ""} style={inputStyle} placeholder="e.g. DPO, Legal Counsel" />
        </FormField>
        <FormField label="Service tier">
          <select name="service_tier" defaultValue={client?.service_tier ?? ""} style={inputStyle}>
            <option value="">Select...</option>
            {SERVICE_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Annual fee (GBP)">
          <input name="annual_fee_gbp" type="number" step="0.01" defaultValue={client?.annual_fee_gbp ?? ""} style={inputStyle} />
        </FormField>
        <FormField label="Engagement start">
          <input name="engagement_start" type="date" defaultValue={client?.engagement_start?.slice(0, 10) ?? ""} style={inputStyle} />
        </FormField>
      </div>
      <div style={{ display: "flex", gap: 20 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" name="processes_biometric" value="true" defaultChecked={client?.processes_biometric ?? false} />
          Processes biometric data
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" name="processes_minors" value="true" defaultChecked={client?.processes_minors ?? false} />
          Processes minors&apos; data
        </label>
      </div>
      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} style={inputStyle} />
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>Cancel</button>
        <button type="submit" disabled={isPending} style={{ ...btnPrimaryStyle, opacity: isPending ? 0.6 : 1 }}>
          {isPending ? "Saving..." : client ? "Update client" : "Add client"}
        </button>
      </div>
    </form>
  );
}

/* ── Main component ────────────────────────────────────────────── */

export default function ComplianceClient({
  initialProspects,
  initialClients,
}: {
  initialProspects: Prospect[];
  initialClients: Client[];
}) {
  const [tab, setTab] = useState<"prospects" | "clients">("prospects");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState("");

  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showProspectForm, setShowProspectForm] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showActivityForm, setShowActivityForm] = useState<Client | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<{ error?: string | null; data?: Record<string, unknown> | null } | null>(null);
  const [pipelineData, setPipelineData] = useState<{
    documents: ProspectDocument[];
    findings: AnalysisFinding[];
    assessment: ProspectAssessment | null;
  } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Prospect | null>(null);
  const [jurisdictionsList, setJurisdictionsList] = useState<Jurisdiction[]>([]);
  const [isPending, startTransition] = useTransition();

  // Load jurisdictions once on mount
  useEffect(() => {
    startTransition(async () => {
      const res = await getJurisdictions();
      if (res.data?.data) setJurisdictionsList(res.data.data);
    });
  }, []);

  /* Load pipeline results when a prospect with assessment data is selected */
  const loadPipelineData = useCallback(
    (prospect: Prospect) => {
      if (prospect.research_status && prospect.research_status !== "not_started") {
        startTransition(async () => {
          const results = await getProspectPipelineResults(prospect.id);
          setPipelineData(results);
        });
      } else {
        setPipelineData(null);
      }
    },
    [startTransition],
  );

  /* derived data */
  const prospects = initialProspects;
  const clients = initialClients;

  const filteredProspects = prospects.filter((p) => {
    if (search && !p.company_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (sectorFilter && p.sector !== sectorFilter) return false;
    if (statusFilter && p.outreach_status !== statusFilter) return false;
    if (priorityFilter && p.priority !== priorityFilter) return false;
    return true;
  });

  const filteredClients = clients.filter((c) => {
    if (search && !c.company_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (clientStatusFilter && c.status !== clientStatusFilter) return false;
    return true;
  });

  const activeClients = clients.filter((c) => c.status === "engaged" || c.status === "onboarding");
  const arr = clients.reduce((sum, c) => sum + (c.annual_fee_gbp ?? 0), 0);
  const highPriority = prospects.filter((p) => p.priority === "high").length;
  const contacted = prospects.filter((p) => p.outreach_status === "contacted" || p.outreach_status === "responded" || p.outreach_status === "converted").length;

  const byStatus = STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: prospects.filter((p) => p.outreach_status === s).length }),
    {} as Record<string, number>,
  );

  const handleRunPipeline = useCallback(
    (prospect: Prospect) => {
      setPipelineRunning(true);
      setPipelineResult(null);
      startTransition(async () => {
        try {
          const result = await runProspectPipeline(prospect.id);
          setPipelineResult(result);
          // Reload pipeline data to show results
          if (!result.error) {
            const results = await getProspectPipelineResults(prospect.id);
            setPipelineData(results);
          }
        } catch {
          setPipelineResult({ error: "Pipeline failed" });
        } finally {
          setPipelineRunning(false);
        }
      });
    },
    [startTransition],
  );

  const handleDelete = useCallback(
    (prospect: Prospect) => {
      startTransition(async () => {
        await removeProspect(prospect.id);
        setShowDeleteConfirm(null);
        setSelectedProspect(null);
      });
    },
    [startTransition],
  );

  const compFlagUrl = (country?: string | null) => sharedFlagUrl(country ?? null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 10, lineHeight: 1, letterSpacing: "0.2em", textTransform: "uppercase", color: "#B08D3F", marginBottom: 9 }}>
            AfricanSTN &middot; Regulatory
          </div>
          <h1 style={{ fontWeight: 800, fontSize: 27, lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--tx)", margin: "0 0 5px" }}>
            Compliance services
          </h1>
          <p style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.45, color: "#8E9196", margin: 0 }}>
            POPIA representative services. {prospects.length} prospects, {activeClients.length} active clients.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setShowProspectForm(true)} style={btnPrimaryStyle}>+ Add prospect</button>
          <button onClick={() => setShowClientForm(true)} style={btnSecondaryStyle}>+ Add client</button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <StatCard label="Total prospects" value={String(prospects.length)} />
        <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.1, color: "#B4432C" }}>{highPriority}</div>
          <div style={{ fontWeight: 500, fontSize: 11.5, color: "#8E9196", marginTop: 4 }}>High priority</div>
        </div>
        <StatCard label="Contacted" value={String(contacted)} />
        <StatCard label="Active clients" value={String(activeClients.length)} dashed />
        <StatCard label="ARR" value={arr > 0 ? `£${arr.toLocaleString("en-GB")}` : "—"} dashed />
      </div>

      {/* Outreach funnel */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10, padding: "12px 16px" }}>
        {STATUSES.map((s, i) => {
          const m = STATUS_META[s] ?? PILL_UNSET;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && <span style={{ color: "#D9CDB4", fontWeight: 400, fontSize: 14, margin: "0 10px" }}>&rarr;</span>}
              <span style={{
                fontWeight: 700, fontSize: 10, lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.04em",
                color: m.color, background: m.bg, border: `1px solid ${m.border}`, borderRadius: 20, padding: "5px 11px", whiteSpace: "nowrap",
              }}>
                {s} <span style={{ fontWeight: 500, opacity: 0.7 }}>({byStatus[s] ?? 0})</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1.5px solid var(--bd)" }}>
        {(["prospects", "clients"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontWeight: tab === t ? 700 : 500,
              fontSize: 13,
              lineHeight: 1,
              color: tab === t ? "var(--tx)" : "#8E9196",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2.5px solid #C5A059" : "2.5px solid transparent",
              padding: "10px 18px",
              cursor: "pointer",
              textTransform: "capitalize",
              marginBottom: -1.5,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 220 }}
        />
        {tab === "prospects" ? (
          <>
            <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
              <option value="">All sectors</option>
              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 160 }}>
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 150 }}>
              <option value="">All priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        ) : (
          <select value={clientStatusFilter} onChange={(e) => setClientStatusFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
            <option value="">All statuses</option>
            {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Prospect table */}
      {tab === "prospects" && (
        <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(26,28,30,.05)" }}>
          {filteredProspects.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center", color: "#8E9196", fontSize: 13 }}>No prospects match the current filters.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F6F1E7", borderBottom: "1.5px solid #E4D9C4" }}>
                  {["Company", "Country", "Sector", "Priority", "Status", "IR reg.", ""].map((h) => (
                    <th key={h || "action"} style={{
                      textAlign: h === "" ? "right" : "left",
                      fontWeight: 700, fontSize: 10.5, lineHeight: 1, letterSpacing: "0.06em", textTransform: "uppercase",
                      color: "#6E6A62", padding: "13px 16px", whiteSpace: "nowrap",
                    }}>
                      {h || "Action"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProspects.map((p, idx) => {
                  const flag = compFlagUrl(p.company_country);
                  return (
                    <tr
                      key={p.id}
                      style={{ background: idx % 2 ? "#FBF8F1" : "#FFFFFF", borderBottom: "1px solid #F0E8D8", cursor: "pointer" }}
                      className="hover:!bg-[#FBF6EC]"
                      onClick={() => { setSelectedProspect(p); loadPipelineData(p); }}
                    >
                      <td style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: "var(--tx)", padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {flag && <img src={flag} alt="" style={{ width: 18, height: 13, borderRadius: 2, objectFit: "cover" }} />}
                          {p.company_name}
                        </div>
                      </td>
                      <td style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", padding: "12px 16px", whiteSpace: "nowrap" }}>{p.company_country ?? "—"}</td>
                      <td style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", padding: "12px 16px" }}>{p.sector ?? "—"}</td>
                      <td style={{ padding: "12px 16px" }}><Pill value={p.priority} meta={PRIORITY_META} /></td>
                      <td style={{ padding: "12px 16px" }}><Pill value={p.outreach_status} meta={STATUS_META} /></td>
                      <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 12.5 }}>
                        {p.ir_registered === true ? <span style={{ color: "#2E7D32" }}>Yes</span>
                          : p.ir_registered === false ? <span style={{ color: "#B4432C" }}>No</span>
                          : <span style={{ color: "#B9B2A2" }}>—</span>}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedProspect(p); loadPipelineData(p); }}
                          style={{ fontWeight: 600, fontSize: 11, color: "#B08D3F", background: "none", border: "none", cursor: "pointer" }}
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Client table */}
      {tab === "clients" && (
        <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(26,28,30,.05)" }}>
          {filteredClients.length === 0 ? (
            <div style={{ padding: "40px 18px", textAlign: "center", border: "1.5px dashed #D9CDB4", borderRadius: 12, margin: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#8E9196", marginBottom: 4 }}>No clients yet</div>
              <div style={{ fontWeight: 500, fontSize: 12, color: "#B9B2A2" }}>Convert prospects or add clients directly.</div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F6F1E7", borderBottom: "1.5px solid #E4D9C4" }}>
                  {["Company", "Status", "Tier", "Annual fee", "Activities", ""].map((h) => (
                    <th key={h || "action"} style={{
                      textAlign: h === "" ? "right" : "left",
                      fontWeight: 700, fontSize: 10.5, lineHeight: 1, letterSpacing: "0.06em", textTransform: "uppercase",
                      color: "#6E6A62", padding: "13px 16px", whiteSpace: "nowrap",
                    }}>
                      {h || "Action"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={{ background: idx % 2 ? "#FBF8F1" : "#FFFFFF", borderBottom: "1px solid #F0E8D8", cursor: "pointer" }}
                    className="hover:!bg-[#FBF6EC]"
                    onClick={() => setSelectedClient(c)}
                  >
                    <td style={{ fontWeight: 600, fontSize: 13, color: "var(--tx)", padding: "12px 16px" }}>{c.company_name}</td>
                    <td style={{ padding: "12px 16px" }}><Pill value={c.status} meta={CLIENT_STATUS_META} /></td>
                    <td style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", padding: "12px 16px", textTransform: "capitalize" }}>{c.service_tier ?? "—"}</td>
                    <td style={{ fontWeight: 600, fontSize: 12.5, color: "var(--tx)", padding: "12px 16px" }}>
                      {c.annual_fee_gbp != null ? `£${Number(c.annual_fee_gbp).toLocaleString("en-GB")}` : "—"}
                    </td>
                    <td style={{ fontWeight: 500, fontSize: 12.5, color: "#55524C", padding: "12px 16px" }}>{c.activity_count}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", display: "flex", gap: 12, justifyContent: "flex-end" }}>
                      <Link
                        href={`/compliance/client/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontWeight: 600, fontSize: 11, color: "#2E7D32", background: "none", border: "none", cursor: "pointer", textDecoration: "none" }}
                      >
                        Remediation
                      </Link>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedClient(c); }}
                        style={{ fontWeight: 600, fontSize: 11, color: "#B08D3F", background: "none", border: "none", cursor: "pointer" }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modals & detail panels */}
      <Modal open={showProspectForm} onClose={() => { setShowProspectForm(false); setEditingProspect(null); }} title={editingProspect ? "Edit prospect" : "Add prospect"}>
        <ProspectForm prospect={editingProspect ?? undefined} onClose={() => { setShowProspectForm(false); setEditingProspect(null); }} />
      </Modal>

      <Modal open={showClientForm} onClose={() => { setShowClientForm(false); setEditingClient(null); }} title={editingClient ? "Edit client" : "Add client"}>
        <ClientForm client={editingClient ?? undefined} onClose={() => { setShowClientForm(false); setEditingClient(null); }} />
      </Modal>

      {showActivityForm && (
        <Modal open onClose={() => setShowActivityForm(null)} title={`Log activity — ${showActivityForm.company_name}`}>
          <ActivityForm clientId={showActivityForm.id} onClose={() => setShowActivityForm(null)} />
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(null)} title="Delete prospect">
          <p style={{ fontSize: 13, color: "#55524C", margin: "0 0 16px" }}>
            Permanently delete <strong>{showDeleteConfirm.company_name}</strong>? This cannot be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => setShowDeleteConfirm(null)} style={btnSecondaryStyle}>Cancel</button>
            <button onClick={() => handleDelete(showDeleteConfirm)} disabled={isPending} style={{ ...btnDangerStyle, background: "#FBE3E3", borderRadius: 6, padding: "9px 16px", fontWeight: 600, fontSize: 12, border: "1px solid #E6C4C4" }}>
              {isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Modal>
      )}

      {selectedProspect && (
        <ProspectDetail
          prospect={selectedProspect}
          onClose={() => { setSelectedProspect(null); setPipelineResult(null); setPipelineData(null); }}
          onEdit={() => { setEditingProspect(selectedProspect); setShowProspectForm(true); }}
          onRunPipeline={() => handleRunPipeline(selectedProspect)}
          pipelineRunning={pipelineRunning}
          pipelineResult={pipelineResult}
          pipelineData={pipelineData}
          onProspectUpdate={(updated) => setSelectedProspect(updated)}
        />
      )}

      {selectedClient && (
        <ClientDetail
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onEdit={() => { setEditingClient(selectedClient); setShowClientForm(true); }}
          onAddActivity={() => setShowActivityForm(selectedClient)}
          jurisdictions={jurisdictionsList}
        />
      )}

    </div>
  );
}

/* ── Activity form ───────────────────────────────────────────────────────── */
/* (ComplianceReport removed — Assessment button now navigates to /compliance/assessment/[id]
   which uses the designer's doc-page layout with proper A4 printing) */

/* ── Activity form ───────────────────────────────────────────────────────── */

function ActivityForm({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("client_id", String(clientId));
    startTransition(async () => {
      await addActivity(fd);
      onClose();
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FormField label="Activity type *">
        <select name="activity_type" required style={inputStyle}>
          <option value="">Select...</option>
          <option value="io_registration">IO Registration</option>
          <option value="policy_review">Policy Review</option>
          <option value="breach_response">Breach Response</option>
          <option value="dsar_handling">DSAR Handling</option>
          <option value="compliance_audit">Compliance Audit</option>
          <option value="training">Training</option>
          <option value="correspondence">Correspondence</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <FormField label="Date *">
          <input type="date" name="activity_date" required defaultValue={new Date().toISOString().slice(0, 10)} style={inputStyle} />
        </FormField>
        <FormField label="Hours">
          <input type="number" name="hours" step="0.25" min="0" style={inputStyle} placeholder="0.0" />
        </FormField>
      </div>
      <FormField label="Performed by">
        <input name="performed_by" style={inputStyle} placeholder="e.g. Nik" />
      </FormField>
      <FormField label="Description *">
        <textarea name="description" required rows={3} style={inputStyle} placeholder="Describe the activity..." />
      </FormField>
      <FormField label="Next due date">
        <input type="date" name="next_due" style={inputStyle} />
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
        <button type="button" onClick={onClose} style={btnSecondaryStyle}>Cancel</button>
        <button type="submit" disabled={isPending} style={{ ...btnPrimaryStyle, opacity: isPending ? 0.6 : 1 }}>
          {isPending ? "Saving..." : "Log activity"}
        </button>
      </div>
    </form>
  );
}

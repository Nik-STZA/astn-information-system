"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import type { Prospect, Client } from "@/lib/data/compliance";
import { flagUrl as sharedFlagUrl } from "@/lib/country-iso";
import type { Country, EnforcementAction } from "@/lib/data/data-protection";
import {
  addProspect,
  editProspect,
  removeProspect,
  addClient,
  editClient,
  addActivity,
  runProspectPipeline,
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

function ProspectDetail({
  prospect, onClose, onEdit, onReport, onRunPipeline, pipelineRunning, pipelineResult,
}: {
  prospect: Prospect; onClose: () => void; onEdit: () => void; onReport: () => void;
  onRunPipeline: () => void; pipelineRunning: boolean;
  pipelineResult: { error?: string | null; data?: Record<string, unknown> | null } | null;
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
            <button onClick={onReport} style={btnSecondaryStyle}>Assessment</button>
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
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>Research pipeline</div>
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

function ClientDetail({ client, onClose, onEdit, onAddActivity }: { client: Client; onClose: () => void; onEdit: () => void; onAddActivity: () => void }) {
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
  countries,
  enforcement,
}: {
  initialProspects: Prospect[];
  initialClients: Client[];
  countries: Country[];
  enforcement: EnforcementAction[];
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
  const [showReport, setShowReport] = useState<Prospect | null>(null);
  const [showActivityForm, setShowActivityForm] = useState<Client | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<{ error?: string | null; data?: Record<string, unknown> | null } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Prospect | null>(null);
  const [isPending, startTransition] = useTransition();

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
                      onClick={() => setSelectedProspect(p)}
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
                          onClick={(e) => { e.stopPropagation(); setSelectedProspect(p); }}
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
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
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

      {selectedProspect && !showReport && (
        <ProspectDetail
          prospect={selectedProspect}
          onClose={() => { setSelectedProspect(null); setPipelineResult(null); }}
          onEdit={() => { setEditingProspect(selectedProspect); setShowProspectForm(true); }}
          onReport={() => setShowReport(selectedProspect)}
          onRunPipeline={() => handleRunPipeline(selectedProspect)}
          pipelineRunning={pipelineRunning}
          pipelineResult={pipelineResult}
        />
      )}

      {selectedClient && (
        <ClientDetail
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onEdit={() => { setEditingClient(selectedClient); setShowClientForm(true); }}
          onAddActivity={() => setShowActivityForm(selectedClient)}
        />
      )}

      {showReport && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "white", overflowY: "auto" }}>
          <div style={{ position: "sticky", top: 0, zIndex: 1, background: "white", borderBottom: "1px solid #E4D9C4", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ fontWeight: 700, fontSize: 16, color: "#1A1C1E", margin: 0 }}>POPIA compliance assessment — {showReport.company_name}</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()} style={btnPrimaryStyle}>Print / PDF</button>
              <button onClick={() => setShowReport(null)} style={btnSecondaryStyle}>Close</button>
            </div>
          </div>
          <ComplianceReport prospect={showReport} countries={countries} enforcement={enforcement} />
        </div>
      )}
    </div>
  );
}

/* ── Score gauge helper ────────────────────────────────────────── */

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? "#2E7D32" : pct >= 40 ? "#A67514" : "#B4432C";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto" }}>
        <svg viewBox="0 0 36 36" style={{ width: 64, height: 64, transform: "rotate(-90deg)" }}>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#EEECE7" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color }}>{pct}</div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 10, color: "#6E6A62", marginTop: 6 }}>{label}</div>
    </div>
  );
}

/* ── Compliance report (print-ready POPIA assessment) ──────────── */

function ComplianceReport({
  prospect,
  countries,
  enforcement,
}: {
  prospect: Prospect;
  countries: Country[];
  enforcement: EnforcementAction[];
}) {
  const sa = countries.find((c) => c.iso_code === "ZA");
  const saEnforcement = enforcement.filter((e) => e.country_name === "South Africa").slice(0, 5);

  /* assessment scoring */
  const hasPrivacyPolicy = prospect.privacy_policy_url ? 20 : 0;
  const hasTerms = prospect.terms_url ? 10 : 0;
  const irRegistered = prospect.ir_registered === true ? 30 : 0;
  const saPresence = prospect.sa_presence_evidence ? 10 : 0;
  const baseScore = hasPrivacyPolicy + hasTerms + irRegistered + saPresence;
  const overallScore = Math.min(100, baseScore + (prospect.finding_count ? Math.max(0, 30 - (prospect.critical_finding_count ?? 0) * 10) : 0));
  const riskLevel = overallScore >= 70 ? "Low" : overallScore >= 40 ? "Medium" : "High";
  const riskColor = overallScore >= 70 ? "#2E7D32" : overallScore >= 40 ? "#A67514" : "#B4432C";

  return (
    <div id="compliance-report" style={{ maxWidth: 800, margin: "0 auto", padding: "40px 48px", fontFamily: "'Manrope', sans-serif", fontSize: 12, lineHeight: 1.6, color: "#1A1C1E" }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #compliance-report, #compliance-report * { visibility: visible !important; }
          #compliance-report { position: absolute; left: 0; top: 0; width: 100%; padding: 20mm; margin: 0; max-width: none; font-size: 10pt; }
          @page { size: A4; margin: 20mm; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Report header */}
      <div style={{ borderBottom: "2px solid #C5A059", paddingBottom: 20, marginBottom: 30 }}>
        <div style={{ fontWeight: 700, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: "#8E9196", marginBottom: 8 }}>
          AfricanSTN &middot; POPIA Compliance Assessment
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 22, color: "#1A1C1E", margin: "0 0 4px" }}>{prospect.company_name}</h1>
        <p style={{ fontWeight: 500, fontSize: 11, color: "#8E9196", margin: 0 }}>
          Generated {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} &middot; Confidential
        </p>
      </div>

      {/* Executive summary */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontWeight: 700, fontSize: 15, color: "#1A1C1E", borderBottom: "1px solid #E4D9C4", paddingBottom: 6, marginBottom: 14 }}>Executive summary</h2>
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 16 }}>
          <ScoreGauge score={overallScore} label="Overall" />
          <div style={{ flex: 1 }}>
            <p style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.6 }}>
              <strong>{prospect.company_name}</strong> has been assessed for compliance with South Africa&apos;s Protection of Personal Information Act (POPIA).
              The overall compliance posture is rated <strong style={{ color: riskColor }}>{riskLevel} risk</strong> with a score of {overallScore}/100.
            </p>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "#55524C" }}>
              {prospect.ir_registered === false
                ? "The company does not appear on the Information Regulator's register, which is a significant compliance gap for any organisation processing South African personal data."
                : prospect.ir_registered === true
                ? "The company is registered with the Information Regulator."
                : "Registration with the Information Regulator could not be confirmed."}
            </p>
          </div>
        </div>
      </section>

      {/* Risk assessment */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontWeight: 700, fontSize: 15, color: "#1A1C1E", borderBottom: "1px solid #E4D9C4", paddingBottom: 6, marginBottom: 14 }}>Risk assessment</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <ScoreGauge score={hasPrivacyPolicy + hasTerms} label="Documentation" />
          <ScoreGauge score={irRegistered} label="Registration" />
          <ScoreGauge score={saPresence ? 80 : 20} label="SA presence" />
          <ScoreGauge score={prospect.finding_count ? Math.max(10, 100 - (prospect.critical_finding_count ?? 0) * 20) : 50} label="Policy review" />
        </div>
      </section>

      {/* SA regulatory landscape */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontWeight: 700, fontSize: 15, color: "#1A1C1E", borderBottom: "1px solid #E4D9C4", paddingBottom: 6, marginBottom: 14 }}>SA regulatory landscape</h2>
        {sa && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#F6F1E7", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8E9196", marginBottom: 6 }}>Law</div>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1A1C1E" }}>{sa.law_name ?? "POPIA"}</div>
            </div>
            <div style={{ background: "#F6F1E7", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8E9196", marginBottom: 6 }}>Authority</div>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1A1C1E" }}>{sa.authority_name ?? "Information Regulator"}</div>
            </div>
            <div style={{ background: "#F6F1E7", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8E9196", marginBottom: 6 }}>Max fine</div>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1A1C1E" }}>{sa.max_fine_description ?? "R10 million / 10 years imprisonment"}</div>
            </div>
            <div style={{ background: "#F6F1E7", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8E9196", marginBottom: 6 }}>Breach notification</div>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1A1C1E" }}>{sa.breach_notification_detail ?? "As soon as reasonably possible"}</div>
            </div>
          </div>
        )}
        {saEnforcement.length > 0 && (
          <>
            <h3 style={{ fontWeight: 700, fontSize: 12, color: "#6E6A62", marginBottom: 8 }}>Recent enforcement actions</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#F6F1E7" }}>
                  <th style={{ textAlign: "left", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62", padding: "8px 12px" }}>Date</th>
                  <th style={{ textAlign: "left", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62", padding: "8px 12px" }}>Entity</th>
                  <th style={{ textAlign: "left", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62", padding: "8px 12px" }}>Type</th>
                  <th style={{ textAlign: "right", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62", padding: "8px 12px" }}>Fine</th>
                </tr>
              </thead>
              <tbody>
                {saEnforcement.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F0E8D8" }}>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{e.action_date?.slice(0, 10) ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{e.target_entity ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{e.action_type ?? "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>
                      {e.fine_amount ? `${e.fine_currency ?? "ZAR"} ${Number(e.fine_amount).toLocaleString("en-GB")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* POPIA obligations */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontWeight: 700, fontSize: 15, color: "#1A1C1E", borderBottom: "1px solid #E4D9C4", paddingBottom: 6, marginBottom: 14 }}>POPIA obligations</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { title: "Information Officer", desc: "Appoint and register an Information Officer with the Regulator", status: prospect.ir_registered === true ? "done" : "gap" },
            { title: "Privacy notice", desc: "Provide clear notice of purpose, categories, and rights", status: prospect.privacy_policy_url ? "partial" : "gap" },
            { title: "Lawful basis", desc: "Identify a lawful basis (consent, contract, legitimate interest, etc.) for each processing activity", status: "review" },
            { title: "Data subject rights", desc: "Procedures for access, correction, and deletion requests", status: "review" },
            { title: "Cross-border transfers", desc: "Ensure adequate safeguards for transfers outside SA", status: "review" },
            { title: "Security safeguards", desc: "Implement appropriate technical and organisational measures", status: "review" },
            { title: "Breach notification", desc: "Notify the Regulator and data subjects of security compromises", status: "review" },
            { title: "Special personal information", desc: "Additional protections for biometric, health, and children's data", status: "review" },
          ].map((o) => {
            const colors = o.status === "done" ? { bg: "#E7F1EA", border: "#C7E1D1", color: "#2E7D32" }
              : o.status === "partial" ? { bg: "#FBF1DE", border: "#EAD6A6", color: "#A67514" }
              : o.status === "gap" ? { bg: "#FBE7E1", border: "#EDCBBF", color: "#B4432C" }
              : { bg: "#EEECE7", border: "#DED9CE", color: "#8E9196" };
            return (
              <div key={o.title} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, background: colors.bg }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: "#1A1C1E" }}>{o.title}</span>
                  <span style={{ fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: colors.color }}>
                    {o.status === "done" ? "Complete" : o.status === "partial" ? "Partial" : o.status === "gap" ? "Gap" : "Needs review"}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#55524C" }}>{o.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recommended next steps */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontWeight: 700, fontSize: 15, color: "#1A1C1E", borderBottom: "1px solid #E4D9C4", paddingBottom: 6, marginBottom: 14 }}>Recommended next steps</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            prospect.ir_registered !== true && "Register an Information Officer with the Information Regulator (mandatory under s55 of POPIA).",
            !prospect.privacy_policy_url && "Publish a POPIA-compliant privacy notice that covers all required disclosures under s18.",
            "Conduct a data mapping exercise to identify all personal information processing activities in South Africa.",
            "Implement appropriate security safeguards (s19) and a breach response plan (s22).",
            "Review cross-border transfer mechanisms (s72) for personal information leaving South Africa.",
            "Appoint a POPIA representative service provider to maintain ongoing compliance and respond to regulatory correspondence.",
          ].filter(Boolean).map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: "#C5A059", flexShrink: 0, width: 20, textAlign: "right" }}>{i + 1}.</span>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>{step}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <section style={{ borderTop: "1px solid #E4D9C4", paddingTop: 16, marginTop: 20 }}>
        <p style={{ fontSize: 9.5, lineHeight: 1.6, color: "#8E9196", margin: 0 }}>
          <strong>Disclaimer:</strong> This assessment is provided for informational purposes only and does not constitute legal advice.
          AfricanSTN / Sports Tech Africa Ltd is not a law firm. Organisations should seek independent legal counsel for compliance matters.
          Information about the regulatory environment is based on publicly available sources and may not reflect the most recent developments.
          Assessment scores are indicative and based on limited publicly available information about the assessed entity.
        </p>
      </section>
    </div>
  );
}

/* ── Activity form ─────────────────────────────────────────────── */

function ActivityForm({ clientId, onClose }: { clientId: number; onClose: () => void }) {
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

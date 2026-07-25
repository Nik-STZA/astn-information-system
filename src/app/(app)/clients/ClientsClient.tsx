"use client";

import { useState, useEffect, useCallback } from "react";
import type { Client, ProspectDocument, AnalysisFinding, ProspectAssessment } from "@/lib/data/compliance";
import { fetchClientAssessmentsV2 } from "@/lib/data/compliance";
import { getProspectDocuments, getProspectAnalysis, getProspectAssessments } from "../compliance/actions";
import { flagUrl } from "@/lib/country-iso";
import type {
  Engagement,
  IORegistration,
  BreachIncident,
  ComplianceTask,
  Correspondence,
  ClientManagementSummary,
  ProcessingActivity,
  SpecialCategory,
  RemediationItem,
  DataSubjectRequest,
} from "@/lib/data/client-management";
import {
  fetchEngagements,
  fetchRegistrations,
  fetchBreaches,
  fetchClientTasks,
  fetchClientCorrespondence,
  createEngagement,
  updateEngagement,
  deleteEngagement,
  createRegistration,
  updateRegistration,
  deleteRegistration,
  createBreach,
  updateBreach,
  deleteBreach,
  createTask,
  updateTask,
  deleteTask,
  createCorrespondence,
  updateCorrespondence,
  deleteCorrespondence,
  fetchProcessingActivities,
  createProcessingActivity,
  updateProcessingActivity,
  deleteProcessingActivity,
  fetchSpecialCategories,
  initSpecialCategories,
  updateSpecialCategory,
  fetchRemediationItems,
  updateRemediationItem,
  generateRemediationItems,
  fetchDSARs,
  createDSAR,
  updateDSAR,
  deleteDSAR,
} from "./actions";
import { createClientAction, updateClientAction } from "./actions";
import ComplianceRadar from "@/components/ComplianceRadar";
import { exportROPA } from "@/lib/export-ropa";

// ─── Status pill metadata ────────────────────────────────────────────────────

const CLIENT_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  prospect:  { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
  onboarding:{ color: "#3E6B8E", bg: "#E5EDF3", border: "#C5D6E4" },
  engaged:   { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  paused:    { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  churned:   { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
};

const ENGAGEMENT_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  draft:      { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
  sent:       { color: "#3E6B8E", bg: "#E5EDF3", border: "#C5D6E4" },
  signed:     { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  active:     { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  suspended:  { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  terminated: { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
};

const REG_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  pending:      { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  submitted:    { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  confirmed:    { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  rejected:     { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
  deregistered: { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
};

const TASK_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  pending:     { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  in_progress: { color: "#3E6B8E", bg: "#E5EDF3", border: "#C5D6E4" },
  completed:   { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  overdue:     { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
  cancelled:   { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
};

const PROCESSING_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  active:       { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  inactive:     { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
  under_review: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
};

const COMPLIANCE_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  not_assessed:  { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
  compliant:     { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  partial:       { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  non_compliant: { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
};

const PRIOR_AUTH_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  not_required: { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
  pending:      { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  submitted:    { color: "#3E6B8E", bg: "#E5EDF3", border: "#C5D6E4" },
  approved:     { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  refused:      { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
};

const CATEGORY_LABELS: Record<string, string> = {
  religious_beliefs: "Religious or philosophical beliefs",
  race_ethnicity: "Race or ethnic origin",
  trade_union: "Trade union membership",
  political: "Political persuasion",
  health: "Health or sex life",
  sex_life: "Sexual orientation",
  biometric: "Biometric information",
  criminal: "Criminal behaviour / offences",
  children: "Children's personal information",
};
// ─── Helpers ─────────────────────────────────────────────────────────────────

function Pill({ status, meta }: { status: string; meta: Record<string, { color: string; bg: string; border: string }> }) {
  const m = meta[status] ?? meta["pending"] ?? { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" };
  return (
    <span
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".05em",
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 20,
        padding: "4px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function gbp(n: number | null | undefined): string {
  if (n == null || n === 0) return "£0";
  return "£" + n.toLocaleString("en-GB");
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function toDateInput(d: string | null | undefined): string {
  if (!d) return "";
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
}

// ─── Shared styles ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: "#1A1C1E",
  background: "#fff",
  border: "1px solid #D4C5A9",
  borderRadius: 7,
  padding: "9px 12px",
  width: "100%",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: "#141414",
  background: "#C5A059",
  border: "none",
  borderRadius: 7,
  padding: "10px 14px",
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: "#55524C",
  background: "#fff",
  border: "1px solid #D4C5A9",
  borderRadius: 7,
  padding: "10px 14px",
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  background: "#CC0000",
  border: "none",
  borderRadius: 7,
  padding: "10px 14px",
  cursor: "pointer",
};

const btnIcon: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  color: "#8E9196",
  background: "none",
  border: "1px solid transparent",
  borderRadius: 5,
  padding: "4px 7px",
  cursor: "pointer",
  lineHeight: 1,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#8E9196",
  display: "block",
  marginBottom: 5,
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "Manrope, sans-serif",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#9A968B",
  marginBottom: 4,
};

// ─── Tab types ───────────────────────────────────────────────────────────────

type TabKey = "engagements" | "io" | "breaches" | "tasks" | "correspondence" | "data_mapping" | "special_categories" | "remediation" | "dsars" | "pipeline";

const TABS: { key: TabKey; label: string }[] = [
  { key: "engagements", label: "Engagements" },
  { key: "pipeline", label: "Pipeline" },
  { key: "io", label: "IO registrations" },
  { key: "data_mapping", label: "Data mapping" },
  { key: "special_categories", label: "Special categories" },
  { key: "tasks", label: "Tasks" },
  { key: "remediation", label: "Remediation" },
  { key: "dsars", label: "DSARs" },
  { key: "correspondence", label: "Correspondence" },
  { key: "breaches", label: "Breaches" },
];

// ─── Reusable modal backdrop ────────────────────────────────────────────────

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,17,19,.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E4D9C4", width: 560, maxHeight: "90vh", overflow: "auto", padding: "24px 28px", boxShadow: "0 8px 30px rgba(26,28,30,.15)" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Confirm dialog ─────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, onConfirm, onCancel, loading }: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <ModalBackdrop onClose={onCancel}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 12 }}>
        {title}
      </div>
      <p style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: "#55524C", margin: "0 0 20px" }}>
        {message}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button type="button" onClick={onCancel} style={btnSecondary} disabled={loading}>Cancel</button>
        <button type="button" onClick={onConfirm} style={{ ...btnDanger, opacity: loading ? 0.6 : 1 }} disabled={loading}>
          {loading ? "Deleting…" : "Delete"}
        </button>
      </div>
    </ModalBackdrop>
  );
}

// ─── Card action buttons ────────────────────────────────────────────────────

function CardActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        style={btnIcon}
        title="Edit"
        onMouseEnter={(e) => { e.currentTarget.style.color = "#C5A059"; e.currentTarget.style.borderColor = "#D4C5A9"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#8E9196"; e.currentTarget.style.borderColor = "transparent"; }}
      >
        ✎
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={btnIcon}
        title="Delete"
        onMouseEnter={(e) => { e.currentTarget.style.color = "#CC0000"; e.currentTarget.style.borderColor = "#FCA5A5"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#8E9196"; e.currentTarget.style.borderColor = "transparent"; }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Detail row helper ───────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      <div>
        <div style={sectionLabel}>{label}</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

// ─── Card components ────────────────────────────────────────────────────────

function EngagementCard({ e, onEdit, onDelete }: { e: Engagement; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "15px 17px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
          {e.service_tier === "representative" ? "Representative service" : "Authorised IO service"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill status={e.engagement_status} meta={ENGAGEMENT_STATUS_META} />
          <CardActions onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <div>
          <div style={sectionLabel}>Start</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
            {fmtDate(e.start_date)}
          </div>
        </div>
        <div>
          <div style={sectionLabel}>Annual fee</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
            {gbp(e.annual_fee_gbp)}
          </div>
        </div>
        <div>
          <div style={sectionLabel}>Frequency</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
            {e.payment_frequency ? e.payment_frequency.charAt(0).toUpperCase() + e.payment_frequency.slice(1) : "—"}
          </div>
        </div>
        <div>
          <div style={sectionLabel}>Agreement</div>
          {e.agreement_document_url ? (
            <a href={e.agreement_document_url} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#9C7C2E" }}>
              View PDF
            </a>
          ) : (
            <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#8E9196" }}>—</span>
          )}
        </div>
      </div>
    </div>
  );
}

function RegistrationCard({ r, onEdit, onDelete }: { r: IORegistration; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "15px 17px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
          {r.registration_type === "information_officer" ? "Information Officer" : "Deputy IO"} — {r.registrant_name}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill status={r.registration_status} meta={REG_STATUS_META} />
          <CardActions onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <div>
          <div style={sectionLabel}>Type</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
            {r.registration_type === "information_officer" ? "Information Officer" : "Deputy IO"}
          </div>
        </div>
        <div>
          <div style={sectionLabel}>Portal</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
            {r.portal_used === "eservices" ? "eServices" : r.portal_used === "bizportal" ? "BizPortal" : r.portal_used ?? "—"}
          </div>
        </div>
        <div>
          <div style={sectionLabel}>Submitted</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
            {fmtDate(r.submitted_date)}
          </div>
        </div>
        <div>
          <div style={sectionLabel}>IR reference</div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: r.ir_reference_number ? "#1A1C1E" : "#8E9196" }}>
            {r.ir_reference_number ?? "Pending"}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ t, onEdit, onDelete }: { t: ComplianceTask; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid #EFE7D6", borderRadius: 9, padding: "13px 16px", background: "#FAF7F0" }}>
      <div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E", marginBottom: 2 }}>
          {t.title}
        </div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.3, color: "#8E9196" }}>
          {t.due_date ? `Due ${fmtDate(t.due_date)}` : "No due date"} · assigned to {t.assigned_to ?? "unassigned"}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Pill status={t.status} meta={TASK_STATUS_META} />
        <CardActions onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

function BreachCard({ b, onEdit, onDelete }: { b: BreachIncident; onEdit: () => void; onDelete: () => void }) {
  const severityColor: Record<string, string> = { low: "#8E9196", medium: "#A67514", high: "#CC7700", critical: "#CC0000" };
  const deadlinePassed = b.notification_deadline && new Date(b.notification_deadline) < new Date();
  const irStatus = b.reported_to_ir ? "Reported" : deadlinePassed ? "Overdue" : "Pending";
  const irColor = b.reported_to_ir ? "#2E7D32" : deadlinePassed ? "#CC0000" : "#A67514";
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "15px 17px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
          {b.incident_type ?? "Breach incident"} — {fmtDate(b.incident_date)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "Manrope, sans-serif", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
            color: severityColor[b.severity ?? "low"] ?? "#8E9196",
            background: (severityColor[b.severity ?? "low"] ?? "#8E9196") + "18",
            border: `1px solid ${severityColor[b.severity ?? "low"] ?? "#8E9196"}40`,
            borderRadius: 20, padding: "4px 9px", whiteSpace: "nowrap",
          }}>
            {b.severity ?? "unknown"}
          </span>
          <CardActions onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: "#55524C", marginBottom: 8 }}>
        {b.description ?? "No description provided."}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontFamily: "Manrope, sans-serif", fontSize: 11, color: "#6B6760" }}>
        <span>IR notification: <span style={{ fontWeight: 700, color: irColor }}>{irStatus}</span></span>
        {b.notification_deadline && <span>Deadline: {fmtDate(b.notification_deadline)}</span>}
        <span>Data subjects notified: <span style={{ fontWeight: 700, color: b.data_subjects_notified ? "#2E7D32" : "#8E9196" }}>{b.data_subjects_notified ? "Yes" : "No"}</span></span>
        {b.data_subjects_count != null && <span>Est. affected: {b.data_subjects_count.toLocaleString("en-GB")}</span>}
      </div>
    </div>
  );
}

function CorrespondenceCard({ c, onEdit, onDelete }: { c: Correspondence; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "13px 16px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
          {c.subject}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "Manrope, sans-serif", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
            color: c.direction === "inbound" ? "#3E6B8E" : "#A67514",
            background: c.direction === "inbound" ? "#E5EDF3" : "#FBF1DE",
            border: `1px solid ${c.direction === "inbound" ? "#C5D6E4" : "#EAD6A6"}`,
            borderRadius: 20, padding: "4px 9px", whiteSpace: "nowrap",
          }}>
            {c.direction}
          </span>
          <CardActions onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.3, color: "#8E9196" }}>
        {c.correspondent} · {fmtDate(c.received_date)}
        {c.response_due_date && ` · response due ${fmtDate(c.response_due_date)}`}
      </div>
    </div>
  );
}


// ─── Processing Activity card ───────────────────────────────────────────────

function ProcessingActivityCard({ a, onEdit, onDelete }: { a: ProcessingActivity; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #DDD9D0", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: "#1A1C1E", fontSize: 14 }}>{a.activity_name}</div>
          <div style={{ fontSize: 12, color: "#8E9196", marginTop: 2 }}>{a.purpose}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Pill status={a.status} meta={PROCESSING_STATUS_META} />
          <CardActions onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 12, color: "#6B6760" }}>
        <DetailRow label="Legal basis" value={a.legal_basis?.replace(/_/g, " ")} />
        {a.estimated_volume && <DetailRow label="Volume" value={a.estimated_volume} />}
        {a.cross_border && <DetailRow label="Cross-border" value={a.transfer_countries?.join(", ") || "Yes"} />}
        {a.retention_period && <DetailRow label="Retention" value={a.retention_period} />}
      </div>
      {a.personal_data_types && a.personal_data_types.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {a.personal_data_types.map((t) => (
            <span key={t} style={{ fontSize: 11, background: "#F5F0E8", color: "#6B6760", borderRadius: 4, padding: "2px 6px" }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Special Category card ──────────────────────────────────────────────────

function scProcessedDot(v: boolean | null): { color: string; bg: string; label: string } {
  if (v === true) return { color: "#CC7700", bg: "#FFF3E0", label: "Processes" };
  if (v === false) return { color: "#2E7D32", bg: "#E8F5E9", label: "Does not process" };
  return { color: "#8E9196", bg: "#F4F3F0", label: "Not applicable" };
}

function SpecialCategoryCard({ sc, onEdit }: { sc: SpecialCategory; onEdit: () => void }) {
  const label = CATEGORY_LABELS[sc.category] || sc.category.replace(/_/g, " ");
  return (
    <div
      style={{
        background: "#fff", border: "1px solid #DDD9D0", borderRadius: 10,
        padding: "12px 16px", marginBottom: 8, cursor: "pointer",
        opacity: sc.is_processed === true ? 1 : 0.7,
      }}
      onClick={onEdit}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", display: "inline-block",
            background: scProcessedDot(sc.is_processed).color,
          }} />
          <span style={{ fontWeight: 600, color: "#1A1C1E", fontSize: 14 }}>{label}</span>
          <span style={{
            fontSize: 11, padding: "1px 8px", borderRadius: 10,
            color: scProcessedDot(sc.is_processed).color,
            background: scProcessedDot(sc.is_processed).bg,
          }}>{scProcessedDot(sc.is_processed).label}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {sc.is_processed === true && sc.prior_auth_required && (
            <Pill status={sc.prior_auth_status || "pending"} meta={PRIOR_AUTH_STATUS_META} />
          )}
          {sc.is_processed === true && (
            <Pill status={sc.compliance_status} meta={COMPLIANCE_STATUS_META} />
          )}
        </div>
      </div>
      {sc.is_processed === true && sc.processing_description && (
        <div style={{ fontSize: 12, color: "#6B6760", marginTop: 6, paddingLeft: 24 }}>{sc.processing_description}</div>
      )}
      {sc.is_processed === true && sc.safeguards && (
        <div style={{ fontSize: 12, color: "#8E9196", marginTop: 4, paddingLeft: 24 }}>Safeguards: {sc.safeguards}</div>
      )}
    </div>
  );
}

// ─── Empty tab state ─────────────────────────────────────────────────────────

function EmptyTab({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="card-empty" style={{ padding: "36px 20px", textAlign: "center" }}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: "#8E9196", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: "#B9B2A2" }}>
        {subtitle}
      </div>
    </div>
  );
}

// ─── Entity form modals ─────────────────────────────────────────────────────

function EngagementFormModal({ clientId, initial, onClose, onSaved }: {
  clientId: string;
  initial?: Engagement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      service_tier: fd.get("service_tier"),
      engagement_status: fd.get("engagement_status") || "draft",
      start_date: fd.get("start_date") || null,
      end_date: fd.get("end_date") || null,
      annual_fee_gbp: fd.get("annual_fee_gbp") ? Number(fd.get("annual_fee_gbp")) : null,
      annual_fee_zar: fd.get("annual_fee_zar") ? Number(fd.get("annual_fee_zar")) : null,
      payment_frequency: fd.get("payment_frequency") || "annual",
      agreement_document_url: fd.get("agreement_document_url") || null,
      notes: fd.get("notes") || null,
    };
    const res = isEdit
      ? await updateEngagement(initial!.id, payload)
      : await createEngagement(clientId, payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
    onClose();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 20 }}>
        {isEdit ? "Edit engagement" : "Add engagement"}
      </div>
      {error && <div style={{ background: "#FDF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Service tier *</label>
            <select name="service_tier" defaultValue={initial?.service_tier ?? "representative"} style={inputStyle} required>
              <option value="representative">Representative</option>
              <option value="authorised_io">Authorised IO</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="engagement_status" defaultValue={initial?.engagement_status ?? "draft"} style={inputStyle}>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="signed">Signed</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Start date</label>
            <input name="start_date" type="date" defaultValue={toDateInput(initial?.start_date)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End date</label>
            <input name="end_date" type="date" defaultValue={toDateInput(initial?.end_date)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Annual fee (GBP)</label>
            <input name="annual_fee_gbp" type="number" step="0.01" defaultValue={initial?.annual_fee_gbp ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Annual fee (ZAR)</label>
            <input name="annual_fee_zar" type="number" step="0.01" defaultValue={initial?.annual_fee_zar ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Payment frequency</label>
            <select name="payment_frequency" defaultValue={initial?.payment_frequency ?? "annual"} style={inputStyle}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Agreement URL</label>
            <input name="agreement_document_url" defaultValue={initial?.agreement_document_url ?? ""} style={inputStyle} placeholder="https://..." />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Notes</label>
            <textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create engagement"}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

function RegistrationFormModal({ clientId, initial, onClose, onSaved }: {
  clientId: string;
  initial?: IORegistration;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      registration_type: fd.get("registration_type"),
      registrant_name: fd.get("registrant_name"),
      registrant_email: fd.get("registrant_email") || null,
      registrant_phone: fd.get("registrant_phone") || null,
      registrant_role: fd.get("registrant_role") || null,
      registration_status: fd.get("registration_status") || "pending",
      submitted_date: fd.get("submitted_date") || null,
      confirmed_date: fd.get("confirmed_date") || null,
      portal_used: fd.get("portal_used") || null,
      portal_organisation_type: fd.get("portal_organisation_type") || "other_private",
      ir_reference_number: fd.get("ir_reference_number") || null,
      notes: fd.get("notes") || null,
    };
    const res = isEdit
      ? await updateRegistration(initial!.id, payload)
      : await createRegistration(clientId, payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
    onClose();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 20 }}>
        {isEdit ? "Edit IO registration" : "Add IO registration"}
      </div>
      {error && <div style={{ background: "#FDF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Registration type *</label>
            <select name="registration_type" defaultValue={initial?.registration_type ?? "information_officer"} style={inputStyle} required>
              <option value="information_officer">Information Officer</option>
              <option value="deputy_information_officer">Deputy IO</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="registration_status" defaultValue={initial?.registration_status ?? "pending"} style={inputStyle}>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="confirmed">Confirmed</option>
              <option value="rejected">Rejected</option>
              <option value="deregistered">Deregistered</option>
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Registrant name *</label>
            <input name="registrant_name" required defaultValue={initial?.registrant_name ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Registrant email</label>
            <input name="registrant_email" type="email" defaultValue={initial?.registrant_email ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Registrant phone</label>
            <input name="registrant_phone" defaultValue={initial?.registrant_phone ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Registrant role</label>
            <input name="registrant_role" defaultValue={initial?.registrant_role ?? ""} style={inputStyle} placeholder="e.g. Data Protection Officer" />
          </div>
          <div>
            <label style={labelStyle}>Portal used</label>
            <select name="portal_used" defaultValue={initial?.portal_used ?? ""} style={inputStyle}>
              <option value="">Not specified</option>
              <option value="eservices">eServices</option>
              <option value="bizportal">BizPortal</option>
              <option value="manual_email">Manual / email</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Submitted date</label>
            <input name="submitted_date" type="date" defaultValue={toDateInput(initial?.submitted_date)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Confirmed date</label>
            <input name="confirmed_date" type="date" defaultValue={toDateInput(initial?.confirmed_date)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>IR reference number</label>
            <input name="ir_reference_number" defaultValue={initial?.ir_reference_number ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Organisation type</label>
            <input name="portal_organisation_type" defaultValue={initial?.portal_organisation_type ?? "other_private"} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Notes</label>
            <textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add registration"}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

function BreachFormModal({ clientId, initial, onClose, onSaved }: {
  clientId: string;
  initial?: BreachIncident;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      incident_date: fd.get("incident_date"),
      incident_type: fd.get("incident_type") || null,
      description: fd.get("description") || null,
      severity: fd.get("severity") || null,
      data_subjects_affected: fd.get("data_subjects_affected") ? Number(fd.get("data_subjects_affected")) : null,
      reported_to_ir: fd.get("reported_to_ir") === "true",
      ir_report_date: fd.get("ir_report_date") || null,
      ir_reference_number: fd.get("ir_reference_number") || null,
      status: fd.get("status") || "reported",
      remediation_notes: fd.get("remediation_notes") || null,
      data_subjects_notified: fd.get("data_subjects_notified") === "true",
      data_subjects_notification_date: fd.get("data_subjects_notification_date") || null,
      data_subjects_count: fd.get("data_subjects_count") ? Number(fd.get("data_subjects_count")) : null,
    };
    const res = isEdit
      ? await updateBreach(initial!.id, payload)
      : await createBreach(clientId, payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
    onClose();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 20 }}>
        {isEdit ? "Edit breach record" : "Log breach incident"}
      </div>
      {error && <div style={{ background: "#FDF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Incident date *</label>
            <input name="incident_date" type="date" required defaultValue={toDateInput(initial?.incident_date)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Incident type</label>
            <input name="incident_type" defaultValue={initial?.incident_type ?? ""} style={inputStyle} placeholder="e.g. Cyber attack, Human error" />
          </div>
          <div>
            <label style={labelStyle}>Severity</label>
            <select name="severity" defaultValue={initial?.severity ?? ""} style={inputStyle}>
              <option value="">Not assessed</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Data subjects affected</label>
            <input name="data_subjects_affected" type="number" defaultValue={initial?.data_subjects_affected ?? ""} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Description</label>
            <textarea name="description" rows={3} defaultValue={initial?.description ?? ""} style={{ ...inputStyle, resize: "vertical" }} placeholder="Nature of the breach, categories of data, circumstances..." />
          </div>
          <div>
            <label style={labelStyle}>Reported to IR</label>
            <select name="reported_to_ir" defaultValue={initial?.reported_to_ir ? "true" : "false"} style={inputStyle}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>IR report date</label>
            <input name="ir_report_date" type="date" defaultValue={toDateInput(initial?.ir_report_date)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>IR reference</label>
            <input name="ir_reference_number" defaultValue={initial?.ir_reference_number ?? ""} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="status" defaultValue={initial?.status ?? "reported"} style={inputStyle}>
              <option value="reported">Reported</option>
              <option value="investigating">Investigating</option>
              <option value="contained">Contained</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          {/* ─── POPIA s22 data subject notification fields ─── */}
          <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #EFE7D6", paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 700, color: "#8E9196", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
              Data subject notification (POPIA s22)
            </div>
          </div>
          <div>
            <label style={labelStyle}>Est. data subjects (initial)</label>
            <input name="data_subjects_count" type="number" defaultValue={initial?.data_subjects_count ?? ""} style={inputStyle} placeholder="Estimate for IR form" />
          </div>
          <div>
            <label style={labelStyle}>Data subjects notified</label>
            <select name="data_subjects_notified" defaultValue={initial?.data_subjects_notified ? "true" : "false"} style={inputStyle}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Notification date</label>
            <input name="data_subjects_notification_date" type="date" defaultValue={toDateInput(initial?.data_subjects_notification_date)} style={inputStyle} />
          </div>
          {initial?.notification_deadline && (
            <div>
              <label style={labelStyle}>IR notification deadline</label>
              <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, color: new Date(initial.notification_deadline) < new Date() && !initial.reported_to_ir ? "#CC0000" : "#2E7D32", padding: "8px 0" }}>
                {fmtDate(initial.notification_deadline)}
                {new Date(initial.notification_deadline) < new Date() && !initial.reported_to_ir && " — OVERDUE"}
              </div>
            </div>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Remediation notes</label>
            <textarea name="remediation_notes" rows={2} defaultValue={initial?.remediation_notes ?? ""} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Log breach"}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

function TaskFormModal({ clientId, initial, onClose, onSaved }: {
  clientId: string;
  initial?: ComplianceTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      task_type: fd.get("task_type"), title: fd.get("title"),
      description: fd.get("description") || null, due_date: fd.get("due_date") || null,
      status: fd.get("status") || "pending", assigned_to: fd.get("assigned_to") || null,
    };
    if (isEdit && fd.get("completed_date")) payload.completed_date = fd.get("completed_date");
    const res = isEdit ? await updateTask(initial!.id, payload) : await createTask(clientId, payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved(); onClose();
  }
  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 20 }}>{isEdit ? "Edit task" : "Add task"}</div>
      {error && <div style={{ background: "#FDF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Title *</label>
            <input name="title" required defaultValue={initial?.title ?? ""} style={inputStyle} placeholder="e.g. Submit IO registration" />
          </div>
          <div>
            <label style={labelStyle}>Task type *</label>
            <select name="task_type" defaultValue={initial?.task_type ?? "compliance"} style={inputStyle} required>
              <option value="compliance">Compliance</option><option value="registration">Registration</option>
              <option value="review">Review</option><option value="correspondence">Correspondence</option>
              <option value="training">Training</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="status" defaultValue={initial?.status ?? "pending"} style={inputStyle}>
              <option value="pending">Pending</option><option value="in_progress">In progress</option>
              <option value="completed">Completed</option><option value="overdue">Overdue</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div><label style={labelStyle}>Due date</label><input name="due_date" type="date" defaultValue={toDateInput(initial?.due_date)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Assigned to</label><input name="assigned_to" defaultValue={initial?.assigned_to ?? ""} style={inputStyle} placeholder="e.g. nik@stza.io" /></div>
          {isEdit && <div><label style={labelStyle}>Completed date</label><input name="completed_date" type="date" defaultValue={toDateInput(initial?.completed_date)} style={inputStyle} /></div>}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Description</label>
            <textarea name="description" rows={3} defaultValue={initial?.description ?? ""} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : isEdit ? "Save changes" : "Add task"}</button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

function CorrespondenceFormModal({ clientId, initial, onClose, onSaved }: {
  clientId: string;
  initial?: Correspondence;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      direction: fd.get("direction"), correspondent: fd.get("correspondent") || "Information Regulator",
      subject: fd.get("subject"), received_date: fd.get("received_date") || null,
      response_due_date: fd.get("response_due_date") || null, responded_date: fd.get("responded_date") || null,
      urgency: fd.get("urgency") || "normal", status: fd.get("status") || "received",
      document_url: fd.get("document_url") || null, notes: fd.get("notes") || null,
    };
    const res = isEdit ? await updateCorrespondence(initial!.id, payload) : await createCorrespondence(clientId, payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved(); onClose();
  }
  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 20 }}>{isEdit ? "Edit correspondence" : "Log correspondence"}</div>
      {error && <div style={{ background: "#FDF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Direction *</label>
            <select name="direction" defaultValue={initial?.direction ?? "inbound"} style={inputStyle} required>
              <option value="inbound">Inbound (from IR)</option><option value="outbound">Outbound (to IR)</option>
            </select>
          </div>
          <div><label style={labelStyle}>Correspondent</label><input name="correspondent" defaultValue={initial?.correspondent ?? "Information Regulator"} style={inputStyle} /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Subject *</label><input name="subject" required defaultValue={initial?.subject ?? ""} style={inputStyle} placeholder="Brief description of the communication" /></div>
          <div><label style={labelStyle}>Date received/sent</label><input name="received_date" type="date" defaultValue={toDateInput(initial?.received_date)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Response due date</label><input name="response_due_date" type="date" defaultValue={toDateInput(initial?.response_due_date)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Responded date</label><input name="responded_date" type="date" defaultValue={toDateInput(initial?.responded_date)} style={inputStyle} /></div>
          <div>
            <label style={labelStyle}>Urgency</label>
            <select name="urgency" defaultValue={initial?.urgency ?? "normal"} style={inputStyle}>
              <option value="normal">Normal</option><option value="urgent">Urgent</option><option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="status" defaultValue={initial?.status ?? "received"} style={inputStyle}>
              <option value="received">Received</option><option value="acknowledged">Acknowledged</option>
              <option value="in_progress">In progress</option><option value="responded">Responded</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div><label style={labelStyle}>Document URL</label><input name="document_url" defaultValue={initial?.document_url ?? ""} style={inputStyle} placeholder="https://..." /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Notes</label><textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} style={{ ...inputStyle, resize: "vertical" }} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : isEdit ? "Save changes" : "Log correspondence"}</button>
        </div>
      </form>
    </ModalBackdrop>
  );
}


// ─── Processing Activity form modal ─────────────────────────────────────────

const LEGAL_BASES = ["consent", "contract", "legal_obligation", "legitimate_interest", "public_interest", "vital_interest"];
const VOLUME_OPTIONS = ["<1,000", "1,000-10,000", "10,000-100,000", "100,000+"];
const TRANSFER_MECHANISMS = ["adequate_protection", "consent", "binding_rules", "contractual"];

function ProcessingActivityFormModal({ clientId, initial, onClose, onSaved }: { clientId: string; initial?: ProcessingActivity; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    activity_name: initial?.activity_name || "",
    description: initial?.description || "",
    personal_data_types_str: initial?.personal_data_types?.join(", ") || "",
    data_subject_categories_str: initial?.data_subject_categories?.join(", ") || "",
    estimated_volume: initial?.estimated_volume || "",
    legal_basis: initial?.legal_basis || "consent",
    legal_basis_detail: initial?.legal_basis_detail || "",
    purpose: initial?.purpose || "",
    retention_period: initial?.retention_period || "",
    retention_basis: initial?.retention_basis || "",
    recipients_str: initial?.recipients?.join(", ") || "",
    cross_border: initial?.cross_border || false,
    transfer_countries_str: initial?.transfer_countries?.join(", ") || "",
    transfer_mechanism: initial?.transfer_mechanism || "",
    security_measures: initial?.security_measures || "",
    status: initial?.status || "active",
  });

  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        activity_name: form.activity_name,
        description: form.description || null,
        personal_data_types: form.personal_data_types_str ? form.personal_data_types_str.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        data_subject_categories: form.data_subject_categories_str ? form.data_subject_categories_str.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        estimated_volume: form.estimated_volume || null,
        legal_basis: form.legal_basis,
        legal_basis_detail: form.legal_basis_detail || null,
        purpose: form.purpose,
        retention_period: form.retention_period || null,
        retention_basis: form.retention_basis || null,
        recipients: form.recipients_str ? form.recipients_str.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        cross_border: form.cross_border,
        transfer_countries: form.transfer_countries_str ? form.transfer_countries_str.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        transfer_mechanism: form.transfer_mechanism || null,
        security_measures: form.security_measures || null,
        status: form.status,
      };
      if (isEdit && initial) {
        await updateProcessingActivity(initial.id, payload as Partial<ProcessingActivity>);
      } else {
        await createProcessingActivity(clientId, payload as Partial<ProcessingActivity>);
      }
      onSaved();
    } catch (err) { console.error(err); alert("Save failed"); }
    setSaving(false);
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 14, padding: 28, width: 560, maxHeight: "85vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 18px", fontSize: 18, color: "#1A1C1E" }}>{isEdit ? "Edit processing activity" : "Add processing activity"}</h3>

        <label style={labelStyle}>Activity name *</label>
        <input style={inputStyle} value={form.activity_name} onChange={(e) => set("activity_name", e.target.value)} required />

        <label style={labelStyle}>Purpose *</label>
        <input style={inputStyle} value={form.purpose} onChange={(e) => set("purpose", e.target.value)} required placeholder="Why this data is processed" />

        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => set("description", e.target.value)} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Legal basis *</label>
            <select style={inputStyle} value={form.legal_basis} onChange={(e) => set("legal_basis", e.target.value)}>
              {LEGAL_BASES.map((b) => <option key={b} value={b}>{b.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Estimated volume</label>
            <select style={inputStyle} value={form.estimated_volume} onChange={(e) => set("estimated_volume", e.target.value)}>
              <option value="">Select…</option>
              {VOLUME_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Legal basis detail</label>
        <input style={inputStyle} value={form.legal_basis_detail} onChange={(e) => set("legal_basis_detail", e.target.value)} placeholder="Specific justification" />

        <label style={labelStyle}>Personal data types (comma-separated)</label>
        <input style={inputStyle} value={form.personal_data_types_str} onChange={(e) => set("personal_data_types_str", e.target.value)} placeholder="name, email, phone, ID number" />

        <label style={labelStyle}>Data subject categories (comma-separated)</label>
        <input style={inputStyle} value={form.data_subject_categories_str} onChange={(e) => set("data_subject_categories_str", e.target.value)} placeholder="customers, employees, website visitors" />

        <label style={labelStyle}>Recipients (comma-separated)</label>
        <input style={inputStyle} value={form.recipients_str} onChange={(e) => set("recipients_str", e.target.value)} placeholder="Payroll provider, cloud host" />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Retention period</label>
            <input style={inputStyle} value={form.retention_period} onChange={(e) => set("retention_period", e.target.value)} placeholder="7 years after contract end" />
          </div>
          <div>
            <label style={labelStyle}>Retention basis</label>
            <input style={inputStyle} value={form.retention_basis} onChange={(e) => set("retention_basis", e.target.value)} placeholder="Legal or business justification" />
          </div>
        </div>

        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={form.cross_border} onChange={(e) => set("cross_border", e.target.checked)} /> Cross-border transfer
        </label>

        {form.cross_border && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Transfer countries (ISO codes)</label>
              <input style={inputStyle} value={form.transfer_countries_str} onChange={(e) => set("transfer_countries_str", e.target.value)} placeholder="GB, US, DE" />
            </div>
            <div>
              <label style={labelStyle}>Transfer mechanism</label>
              <select style={inputStyle} value={form.transfer_mechanism} onChange={(e) => set("transfer_mechanism", e.target.value)}>
                <option value="">Select…</option>
                {TRANSFER_MECHANISMS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
        )}

        <label style={labelStyle}>Security measures</label>
        <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.security_measures} onChange={(e) => set("security_measures", e.target.value)} placeholder="Encryption, access controls, etc." />

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="under_review">Under review</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : isEdit ? "Save changes" : "Add activity"}</button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ─── Special Category form modal ────────────────────────────────────────────

function SpecialCategoryFormModal({ item, onClose, onSaved }: { item: SpecialCategory; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const label = CATEGORY_LABELS[item.category] || item.category.replace(/_/g, " ");
  const [form, setForm] = useState({
    is_processed: item.is_processed as boolean | null,
    processing_description: item.processing_description || "",
    volume_estimate: item.volume_estimate || "",
    legal_basis: item.legal_basis || "",
    safeguards: item.safeguards || "",
    prior_auth_required: item.prior_auth_required || false,
    prior_auth_status: item.prior_auth_status || "not_required",
    prior_auth_reference: item.prior_auth_reference || "",
    prior_auth_date: item.prior_auth_date || "",
    compliance_status: item.compliance_status || "not_assessed",
    assessor_notes: item.assessor_notes || "",
  });

  const set = (k: string, v: string | boolean | null) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSpecialCategory(item.id, {
        is_processed: form.is_processed,
        processing_description: form.processing_description || null,
        volume_estimate: form.volume_estimate || null,
        legal_basis: form.legal_basis || null,
        safeguards: form.safeguards || null,
        prior_auth_required: form.prior_auth_required,
        prior_auth_status: form.prior_auth_status as SpecialCategory["prior_auth_status"],
        prior_auth_reference: form.prior_auth_reference || null,
        prior_auth_date: form.prior_auth_date || null,
        compliance_status: form.compliance_status as SpecialCategory["compliance_status"],
        assessor_notes: form.assessor_notes || null,
      });
      onSaved();
    } catch (err) { console.error(err); alert("Save failed"); }
    setSaving(false);
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 14, padding: 28, width: 520, maxHeight: "85vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 18px", fontSize: 18, color: "#1A1C1E" }}>{label}</h3>

        <label style={labelStyle}>Does the client process this category?</label>
        <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #DDD9D0", marginBottom: 12 }}>
          {([
            { value: true, label: "Yes — processes" },
            { value: false, label: "No — does not" },
            { value: null, label: "Not applicable" },
          ] as { value: boolean | null; label: string }[]).map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => set("is_processed", opt.value)}
              style={{
                flex: 1, padding: "8px 4px", fontSize: 13, fontWeight: form.is_processed === opt.value ? 700 : 400, cursor: "pointer", border: "none",
                background: form.is_processed === opt.value ? "#C5A059" : "#F5F0E8",
                color: form.is_processed === opt.value ? "#fff" : "#1A1C1E",
                transition: "all 0.15s",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {form.is_processed === true && (
          <>
            <label style={labelStyle}>Processing description</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.processing_description} onChange={(e) => set("processing_description", e.target.value)} placeholder="What processing of this category occurs?" />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Volume estimate</label>
                <input style={inputStyle} value={form.volume_estimate} onChange={(e) => set("volume_estimate", e.target.value)} placeholder="Approximate data subjects" />
              </div>
              <div>
                <label style={labelStyle}>Legal basis</label>
                <input style={inputStyle} value={form.legal_basis} onChange={(e) => set("legal_basis", e.target.value)} placeholder="consent, employment_law, etc." />
              </div>
            </div>

            <label style={labelStyle}>Safeguards in place</label>
            <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.safeguards} onChange={(e) => set("safeguards", e.target.value)} placeholder="What protections are in place?" />

            <div style={{ background: "#F5F0E8", borderRadius: 8, padding: 14, marginTop: 10 }}>
              <span style={sectionLabel}>s57 prior authorisation</span>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <input type="checkbox" checked={form.prior_auth_required} onChange={(e) => set("prior_auth_required", e.target.checked)} /> Prior authorisation required
              </label>
              {form.prior_auth_required && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 6 }}>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select style={inputStyle} value={form.prior_auth_status} onChange={(e) => set("prior_auth_status", e.target.value)}>
                      <option value="not_required">Not required</option>
                      <option value="pending">Pending</option>
                      <option value="submitted">Submitted</option>
                      <option value="approved">Approved</option>
                      <option value="refused">Refused</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>IR reference</label>
                    <input style={inputStyle} value={form.prior_auth_reference} onChange={(e) => set("prior_auth_reference", e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {form.is_processed === true && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <label style={labelStyle}>Compliance status</label>
                <select style={inputStyle} value={form.compliance_status} onChange={(e) => set("compliance_status", e.target.value)}>
                  <option value="not_assessed">Not assessed</option>
                  <option value="compliant">Compliant</option>
                  <option value="partial">Partial</option>
                  <option value="non_compliant">Non-compliant</option>
                </select>
              </div>
            </div>

            <label style={labelStyle}>Assessor notes</label>
            <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.assessor_notes} onChange={(e) => set("assessor_notes", e.target.value)} />
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ─── Remediation tab ──────────────────────────────────────────────────────────

const REMEDIATION_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  open:           { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
  in_progress:    { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  resolved:       { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  verified:       { color: "#1B5E20", bg: "#C8E6C9", border: "#81C784" },
  not_applicable: { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
  accepted_risk:  { color: "#6B6760", bg: "#F4F3F0", border: "#DDD9D0" },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#CC0000", high: "#CC7700", medium: "#A67514", low: "#8E9196",
};

function RemediationCard({ item, onUpdate }: { item: RemediationItem; onUpdate: (data: Partial<RemediationItem>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState(item.resolution_summary ?? "");
  const [evidenceDesc, setEvidenceDesc] = useState(item.evidence_description ?? "");
  const sevColor = SEVERITY_COLOR[item.severity] ?? "#8E9196";
  const statusMeta = REMEDIATION_STATUS_META[item.status] ?? REMEDIATION_STATUS_META.open;
  const overdue = item.due_date && new Date(item.due_date) < new Date() && !["resolved", "verified", "not_applicable", "accepted_risk"].includes(item.status);
  const isResolved = ["resolved", "verified", "not_applicable", "accepted_risk"].includes(item.status);
  const inputStyle = { fontFamily: "Manrope, sans-serif", fontSize: 12, width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #D4C5A9", background: "#FFFDF8" };
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "14px 16px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, color: "#1A1C1E", lineHeight: 1.3 }}>
            <span style={{ marginRight: 6, fontSize: 10, color: "#8E9196" }}>{expanded ? "▼" : "▶"}</span>
            {item.title}
            {item.popia_reference && <span style={{ fontWeight: 500, color: "#8E9196", marginLeft: 6, fontSize: 11 }}>POPIA {item.popia_reference}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span style={{
            fontFamily: "Manrope, sans-serif", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
            color: sevColor, background: sevColor + "18", border: `1px solid ${sevColor}40`,
            borderRadius: 20, padding: "4px 9px", whiteSpace: "nowrap",
          }}>{item.severity}</span>
          <select
            value={item.status}
            onChange={(e) => {
              const newStatus = e.target.value;
              const updates: Partial<RemediationItem> = { status: newStatus as RemediationItem["status"] };
              if (newStatus === "resolved" && !item.resolved_date) updates.resolved_date = new Date().toISOString().slice(0, 10);
              onUpdate(updates);
              if (newStatus === "resolved" || newStatus === "in_progress") setExpanded(true);
            }}
            style={{
              fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              color: statusMeta.color, background: statusMeta.bg, border: `1px solid ${statusMeta.border}`,
              borderRadius: 20, padding: "4px 10px", cursor: "pointer", appearance: "auto",
            }}
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="verified">Verified</option>
            <option value="not_applicable">N/A</option>
            <option value="accepted_risk">Accepted risk</option>
          </select>
        </div>
      </div>
      {item.description && (
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: "#55524C", marginBottom: 6 }}>
          {expanded ? item.description : (item.description.length > 200 ? item.description.slice(0, 200) + "…" : item.description)}
        </div>
      )}
      {item.recommendation && (
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.4, color: "#2E7D32", background: "#F0F7F1", borderRadius: 6, padding: "6px 10px", marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>Recommendation: </span>
          {expanded ? item.recommendation : (item.recommendation.length > 200 ? item.recommendation.slice(0, 200) + "…" : item.recommendation)}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontFamily: "Manrope, sans-serif", fontSize: 11, color: "#8E9196" }}>
        {item.assigned_to && <span>Assigned to: {item.assigned_to}</span>}
        {item.due_date && <span style={{ color: overdue ? "#CC0000" : undefined, fontWeight: overdue ? 700 : undefined }}>Due: {fmtDate(item.due_date)}{overdue ? " — OVERDUE" : ""}</span>}
        {item.resolved_date && <span>Resolved: {fmtDate(item.resolved_date)}</span>}
        {item.verified_date && <span>Verified: {fmtDate(item.verified_date)} by {item.verified_by}</span>}
      </div>
      {/* Expanded: resolution and evidence fields */}
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E7D9BE" }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#6B6760", display: "block", marginBottom: 4 }}>Resolution summary</label>
            <textarea
              value={resolutionSummary}
              onChange={(e) => setResolutionSummary(e.target.value)}
              placeholder={isResolved ? "Describe what was done to resolve this item" : "Will be completed when status is set to Resolved"}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#6B6760", display: "block", marginBottom: 4 }}>Evidence / supporting documents</label>
            <textarea
              value={evidenceDesc}
              onChange={(e) => setEvidenceDesc(e.target.value)}
              placeholder="Reference policies, documents, or URLs that evidence compliance (e.g. privacy policy URL, IR registration reference)"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                onUpdate({ resolution_summary: resolutionSummary || null, evidence_description: evidenceDesc || null } as Partial<RemediationItem>);
                setExpanded(false);
              }}
              style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#FFF", background: "#C5A059", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}
            >
              Save
            </button>
          </div>
          {item.resolution_summary && !expanded && (
            <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, color: "#2E7D32", marginTop: 4 }}>
              Resolution: {item.resolution_summary}
            </div>
          )}
        </div>
      )}
      {/* Show resolution summary inline when collapsed and resolved */}
      {!expanded && item.resolution_summary && (
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.4, color: "#2E7D32", background: "#E8F5E9", borderRadius: 6, padding: "6px 10px", marginTop: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>Resolution: </span>
          {item.resolution_summary.length > 150 ? item.resolution_summary.slice(0, 150) + "…" : item.resolution_summary}
        </div>
      )}
      {!expanded && item.evidence_description && (
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.4, color: "#1565C0", background: "#E3F2FD", borderRadius: 6, padding: "6px 10px", marginTop: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>Evidence: </span>
          {item.evidence_description.length > 150 ? item.evidence_description.slice(0, 150) + "…" : item.evidence_description}
        </div>
      )}
    </div>
  );
}

function RemediationTab({ items, clientId, onRefresh }: { items: RemediationItem[]; clientId: string; onRefresh: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    const res = await generateRemediationItems(clientId);
    setGenerating(false);
    if (res.error) { setGenError(res.error); return; }
    onRefresh();
  }

  async function handleUpdate(id: number, data: Partial<RemediationItem>) {
    await updateRemediationItem(id, data);
    onRefresh();
  }

  const openCount = items.filter((i) => ["open", "in_progress"].includes(i.status)).length;
  const resolvedCount = items.filter((i) => ["resolved", "verified"].includes(i.status)).length;

  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <p style={{ fontFamily: "Manrope, sans-serif", color: "#8E9196", fontSize: 13, marginBottom: 12 }}>No remediation items yet.</p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, color: "#9C7C2E", background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 6, padding: "8px 16px", cursor: "pointer", opacity: generating ? 0.6 : 1 }}
        >
          {generating ? "Generating…" : "Generate from assessment"}
        </button>
        {genError && <p style={{ color: "#CC0000", fontSize: 12, marginTop: 8 }}>{genError}</p>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, color: "#6B6760" }}>
          {openCount} open · {resolvedCount} resolved · {items.length} total
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#9C7C2E", background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 6, padding: "5px 10px", cursor: "pointer", opacity: generating ? 0.6 : 1 }}
        >
          {generating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
      {genError && <p style={{ color: "#CC0000", fontSize: 12, marginBottom: 8 }}>{genError}</p>}
      <div style={{ background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 8, padding: "12px 16px", fontSize: 12, fontFamily: "Manrope, sans-serif", color: "#4A4637", lineHeight: 1.6, marginBottom: 10 }}>
        <strong style={{ color: "#1A1C1E" }}>Remediation workflow</strong><br />
        Each item below is a compliance gap identified from the POPIA assessment. Click the arrow to expand an item, then record what action you took in &quot;Resolution summary&quot; and reference supporting evidence (e.g. privacy policy URL, IR registration number). Change the status to &quot;Resolved&quot; once addressed, or &quot;Accepted risk&quot; with justification. Resolving items improves your Governance score.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <RemediationCard key={item.id} item={item} onUpdate={(data) => handleUpdate(item.id, data)} />
        ))}
      </div>
    </div>
  );
}

// ─── DSAR helpers ───────────────────────────────────────────────────────────

const DSAR_STATUS_META: Record<string, { color: string; bg: string; border: string }> = {
  received:               { color: "#3E6B8E", bg: "#E5EDF3", border: "#C5D6E4" },
  identity_verification:  { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  in_progress:            { color: "#3E6B8E", bg: "#E5EDF3", border: "#C5D6E4" },
  awaiting_info:          { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  completed:              { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  refused:                { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
  escalated:              { color: "#CC0000", bg: "#FDF2F2", border: "#FCA5A5" },
  closed:                 { color: "#8E9196", bg: "#F4F3F0", border: "#DDD9D0" },
};

const DSAR_PRIORITY_META: Record<string, { color: string; bg: string }> = {
  low:    { color: "#8E9196", bg: "#F4F3F0" },
  normal: { color: "#3E6B8E", bg: "#E5EDF3" },
  high:   { color: "#A67514", bg: "#FBF1DE" },
  urgent: { color: "#CC0000", bg: "#FDF2F2" },
};

const DSAR_TYPE_LABELS: Record<string, string> = {
  access: "Access (s23)", correction: "Correction (s24)", deletion: "Deletion (s24)",
  objection: "Objection (s11)", portability: "Portability", other: "Other",
};

function DSARCard({ d, onEdit, onDelete }: { d: DataSubjectRequest; onEdit: () => void; onDelete: () => void }) {
  const sm = DSAR_STATUS_META[d.status] ?? DSAR_STATUS_META.received;
  const pm = DSAR_PRIORITY_META[d.priority] ?? DSAR_PRIORITY_META.normal;
  const isOverdue = d.deadline && !d.completed_date && new Date(d.deadline) < new Date();
  return (
    <div style={{ background: "#fff", border: "1px solid #E7E3DB", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700, fontSize: 13, color: "#1A1C1E", marginBottom: 2 }}>
            {DSAR_TYPE_LABELS[d.request_type] ?? d.request_type} — {d.data_subject_name}
          </div>
          <div style={{ fontSize: 11, color: "#8E9196" }}>
            Received {fmtDate(d.received_date)}{d.assigned_to ? ` · Assigned: ${d.assigned_to}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {d.priority !== "normal" && <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "Manrope, sans-serif", padding: "2px 7px", borderRadius: 4, background: pm.bg, color: pm.color }}>{d.priority}</span>}
          <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "Manrope, sans-serif", padding: "2px 7px", borderRadius: 4, background: sm.bg, color: sm.color, border: `1px solid ${sm.border}` }}>{d.status.replace(/_/g, " ")}</span>
          <button onClick={onEdit} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#8E9196" }}>Edit</button>
          <button onClick={onDelete} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#CC0000" }}>Del</button>
        </div>
      </div>
      {d.description && <div style={{ fontSize: 12, color: "#4A4A4A", marginBottom: 6, lineHeight: 1.4 }}>{d.description.length > 200 ? d.description.slice(0, 200) + "…" : d.description}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11, color: "#8E9196" }}>
        {d.deadline && (
          <span style={{ color: isOverdue ? "#CC0000" : "#8E9196", fontWeight: isOverdue ? 700 : 400 }}>
            {isOverdue ? "OVERDUE" : "Deadline"}: {fmtDate(d.deadline)}
          </span>
        )}
        <span>ID verified: {d.identity_verified ? "Yes" : "No"}</span>
        {d.data_subject_category && <span>Category: {d.data_subject_category}</span>}
        {d.third_parties_notified && <span style={{ color: "#2E7D32" }}>Third parties notified</span>}
        {d.completed_date && <span style={{ color: "#2E7D32" }}>Completed: {fmtDate(d.completed_date)}</span>}
      </div>
      {d.response_summary && <div style={{ marginTop: 6, fontSize: 11, color: "#2E7D32", background: "#E7F1EA", padding: "6px 10px", borderRadius: 6, lineHeight: 1.4 }}>{d.response_summary}</div>}
      {d.refusal_reason && <div style={{ marginTop: 6, fontSize: 11, color: "#CC0000", background: "#FDF2F2", padding: "6px 10px", borderRadius: 6, lineHeight: 1.4 }}>Refused: {d.refusal_reason}</div>}
    </div>
  );
}

function DSARFormModal({ clientId, initial, onClose, onSaved }: { clientId: string; initial?: DataSubjectRequest; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [requestType, setRequestType] = useState(initial?.request_type ?? "access");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [dsName, setDsName] = useState(initial?.data_subject_name ?? "");
  const [dsEmail, setDsEmail] = useState(initial?.data_subject_email ?? "");
  const [dsPhone, setDsPhone] = useState(initial?.data_subject_phone ?? "");
  const [dsIdType, setDsIdType] = useState(initial?.data_subject_id_type ?? "");
  const [dsIdRef, setDsIdRef] = useState(initial?.data_subject_id_ref ?? "");
  const [dsCategory, setDsCategory] = useState(initial?.data_subject_category ?? "");
  const [identityVerified, setIdentityVerified] = useState(initial?.identity_verified ?? false);
  const [status, setStatus] = useState(initial?.status ?? "received");
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to ?? "");
  const [receivedDate, setReceivedDate] = useState(initial?.received_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [acknowledgedDate, setAcknowledgedDate] = useState(initial?.acknowledged_date?.slice(0, 10) ?? "");
  const [deadline, setDeadline] = useState(initial?.deadline?.slice(0, 10) ?? "");
  const [completedDate, setCompletedDate] = useState(initial?.completed_date?.slice(0, 10) ?? "");
  const [responseSummary, setResponseSummary] = useState(initial?.response_summary ?? "");
  const [refusalReason, setRefusalReason] = useState(initial?.refusal_reason ?? "");
  const [thirdPartiesNotified, setThirdPartiesNotified] = useState(initial?.third_parties_notified ?? false);
  const [thirdPartyDetails, setThirdPartyDetails] = useState(initial?.third_party_details ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const isEdit = !!initial;

  async function handleSave() {
    if (!dsName.trim()) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      request_type: requestType,
      description: description || null,
      data_subject_name: dsName.trim(),
      data_subject_email: dsEmail || null,
      data_subject_phone: dsPhone || null,
      data_subject_id_type: dsIdType || null,
      data_subject_id_ref: dsIdRef || null,
      data_subject_category: dsCategory || null,
      identity_verified: identityVerified,
      status,
      priority,
      assigned_to: assignedTo || null,
      received_date: receivedDate || null,
      acknowledged_date: acknowledgedDate || null,
      deadline: deadline || null,
      notes: notes || null,
    };
    if (isEdit) {
      payload.completed_date = completedDate || null;
      payload.response_summary = responseSummary || null;
      payload.refusal_reason = refusalReason || null;
      payload.third_parties_notified = thirdPartiesNotified;
      payload.third_party_details = thirdPartyDetails || null;
    }
    const res = isEdit ? await updateDSAR(initial.id, payload) : await createDSAR(clientId, payload);
    setSaving(false);
    if (!res.error) onSaved();
  }

  const inputStyle: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 12, padding: "7px 10px", border: "1px solid #D4C5A9", borderRadius: 6, width: "100%", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#1A1C1E", marginBottom: 4, display: "block" };
  const sectionTitle: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 700, color: "#C5A059", marginBottom: 8, marginTop: 14, borderBottom: "1px solid #E7E3DB", paddingBottom: 4 };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", background: "#fff", borderRadius: 10, padding: "20px 24px" }}>
        <div style={{ fontFamily: "Manrope, sans-serif", fontWeight: 800, fontSize: 15, color: "#1A1C1E", marginBottom: 14 }}>{isEdit ? "Edit DSAR" : "Log data subject request"}</div>

        <div style={sectionTitle}>Request details</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Type *</label><select value={requestType} onChange={(e) => setRequestType(e.target.value as DataSubjectRequest["request_type"])} style={inputStyle}><option value="access">Access (s23)</option><option value="correction">Correction (s24)</option><option value="deletion">Deletion (s24)</option><option value="objection">Objection (s11)</option><option value="portability">Portability</option><option value="other">Other</option></select></div>
          <div><label style={labelStyle}>Priority</label><select value={priority} onChange={(e) => setPriority(e.target.value as DataSubjectRequest["priority"])} style={inputStyle}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
        </div>
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>

        <div style={sectionTitle}>Data subject</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Name *</label><input value={dsName} onChange={(e) => setDsName(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Email</label><input value={dsEmail} onChange={(e) => setDsEmail(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Phone</label><input value={dsPhone} onChange={(e) => setDsPhone(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Category</label><select value={dsCategory} onChange={(e) => setDsCategory(e.target.value)} style={inputStyle}><option value="">—</option><option value="customer">Customer</option><option value="employee">Employee</option><option value="supplier">Supplier</option><option value="website_visitor">Website visitor</option><option value="other">Other</option></select></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>ID type</label><select value={dsIdType} onChange={(e) => setDsIdType(e.target.value)} style={inputStyle}><option value="">—</option><option value="id_number">SA ID number</option><option value="passport">Passport</option><option value="other">Other</option></select></div>
          <div><label style={labelStyle}>ID ref (masked)</label><input value={dsIdRef} onChange={(e) => setDsIdRef(e.target.value)} style={inputStyle} placeholder="e.g. ***1234" /></div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}><label style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={identityVerified} onChange={(e) => setIdentityVerified(e.target.checked)} /> Identity verified</label></div>
        </div>

        <div style={sectionTitle}>Workflow</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Status</label><select value={status} onChange={(e) => setStatus(e.target.value as DataSubjectRequest["status"])} style={inputStyle}><option value="received">Received</option><option value="identity_verification">Identity verification</option><option value="in_progress">In progress</option><option value="awaiting_info">Awaiting info</option><option value="completed">Completed</option><option value="refused">Refused</option><option value="escalated">Escalated</option><option value="closed">Closed</option></select></div>
          <div><label style={labelStyle}>Assigned to</label><input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={inputStyle} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Received</label><input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Acknowledged</label><input type="date" value={acknowledgedDate} onChange={(e) => setAcknowledgedDate(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Deadline</label><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inputStyle} placeholder="Auto: +30 days" /></div>
        </div>

        {isEdit && (
          <>
            <div style={sectionTitle}>Response</div>
            <div style={{ marginBottom: 10 }}><label style={labelStyle}>Completed date</label><input type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} style={inputStyle} /></div>
            <div style={{ marginBottom: 10 }}><label style={labelStyle}>Response summary</label><textarea value={responseSummary} onChange={(e) => setResponseSummary(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            {status === "refused" && <div style={{ marginBottom: 10 }}><label style={labelStyle}>Refusal reason (POPIA s18 exemption)</label><textarea value={refusalReason} onChange={(e) => setRefusalReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>}
            {(requestType === "correction" || requestType === "deletion") && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><input type="checkbox" checked={thirdPartiesNotified} onChange={(e) => setThirdPartiesNotified(e.target.checked)} /> Third parties notified (s25)</label>
                {thirdPartiesNotified && <textarea value={thirdPartyDetails} onChange={(e) => setThirdPartyDetails(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Which third parties were notified?" />}
              </div>
            )}
          </>
        )}

        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, padding: "7px 16px", border: "1px solid #D4C5A9", borderRadius: 6, background: "#fff", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !dsName.trim()} style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 700, padding: "7px 16px", border: "none", borderRadius: 6, background: "#1A1C1E", color: "#fff", cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : isEdit ? "Update" : "Log request"}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Client detail panel ─────────────────────────────────────────────────────

type ModalState = { type: "add"; entity: TabKey } | { type: "edit"; entity: "engagements"; item: Engagement } | { type: "edit"; entity: "io"; item: IORegistration } | { type: "edit"; entity: "breaches"; item: BreachIncident } | { type: "edit"; entity: "tasks"; item: ComplianceTask } | { type: "edit"; entity: "correspondence"; item: Correspondence } | { type: "edit"; entity: "data_mapping"; item: ProcessingActivity } | { type: "edit"; entity: "special_categories"; item: SpecialCategory } | { type: "edit"; entity: "dsars"; item: DataSubjectRequest } | null;
type DeleteState = { entity: TabKey; id: number; label: string } | null;

function ClientDetail({ client, onClientUpdated }: { client: Client; onClientUpdated?: () => void }) {
  const [tab, setTab] = useState<TabKey>("engagements");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [registrations, setRegistrations] = useState<IORegistration[]>([]);
  const [breaches, setBreaches] = useState<BreachIncident[]>([]);
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [correspondence, setCorrespondence] = useState<Correspondence[]>([]);
  const [processingActivities, setProcessingActivities] = useState<ProcessingActivity[]>([]);
  const [specialCategories, setSpecialCategories] = useState<SpecialCategory[]>([]);
  const [remediationItems, setRemediationItems] = useState<RemediationItem[]>([]);
  const [dsars, setDsars] = useState<DataSubjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [assessmentDomains, setAssessmentDomains] = useState<{ dimension: string; score: number }[]>([]);
  const [assessmentLabel, setAssessmentLabel] = useState<string>("");
  const [modal, setModal] = useState<ModalState>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const cid = String(client.id);

  // Pipeline data from the linked prospect (migration 016) — documents,
  // findings, and assessments produced before conversion.
  const [pipelineDocs, setPipelineDocs] = useState<ProspectDocument[]>([]);
  const [pipelineFindings, setPipelineFindings] = useState<AnalysisFinding[]>([]);
  const [pipelineAssessments, setPipelineAssessments] = useState<ProspectAssessment[]>([]);

  useEffect(() => {
    if (!client.prospect_id) return;
    const pid = String(client.prospect_id);
    Promise.all([getProspectDocuments(pid), getProspectAnalysis(pid), getProspectAssessments(pid)])
      .then(([dR, aR, sR]) => {
        setPipelineDocs(dR.data?.data ?? []);
        setPipelineFindings(aR.data?.data ?? []);
        setPipelineAssessments(sR.data?.data ?? []);
      });
  }, [client.prospect_id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEngagements(cid), fetchRegistrations(cid), fetchBreaches(cid), fetchClientTasks(cid), fetchClientCorrespondence(cid), fetchProcessingActivities(cid), fetchSpecialCategories(cid), fetchRemediationItems(cid), fetchDSARs(cid)])
      .then(([eR, rR, bR, tR, cR, paR, scR, riR, dsarR]) => {
        setEngagements(eR.data?.data ?? []); setRegistrations(rR.data?.data ?? []);
        setBreaches(bR.data?.data ?? []); setTasks(tR.data?.data ?? []);
        setCorrespondence(cR.data?.data ?? []);
        setProcessingActivities(paR.data?.data ?? []);
        setSpecialCategories(scR.data?.data ?? []);
        setRemediationItems(riR.data?.data ?? []);
        setDsars(dsarR.data?.data ?? []);
        setLoading(false);
      });
  }, [cid, refreshKey]);

  // Real compliance scores for the radar — the latest assessment's per-domain scores.
  useEffect(() => {
    fetchClientAssessmentsV2(cid).then((r) => {
      const list = (r.data?.data ?? []).filter(
        (a) => a.status === "completed" || a.status === "reviewed",
      );
      const latest = list.sort((a, b) => b.id - a.id)[0];
      if (latest?.domain_scores) {
        setAssessmentDomains(
          Object.values(latest.domain_scores).map((d) => ({
            dimension: d.name,
            score: Math.round(d.score),
          })),
        );
        setAssessmentLabel(latest.jurisdiction || latest.jurisdiction_code || "Compliance");
      } else {
        setAssessmentDomains([]);
      }
    });
  }, [cid, refreshKey]);

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    let res;
    switch (confirmDelete.entity) {
      case "engagements": res = await deleteEngagement(confirmDelete.id); break;
      case "io": res = await deleteRegistration(confirmDelete.id); break;
      case "breaches": res = await deleteBreach(confirmDelete.id); break;
      case "tasks": res = await deleteTask(confirmDelete.id); break;
      case "correspondence": res = await deleteCorrespondence(confirmDelete.id); break;
      case "data_mapping": res = await deleteProcessingActivity(confirmDelete.id); break;
      case "dsars": res = await deleteDSAR(confirmDelete.id); break;
    }
    setDeleting(false);
    if (!res?.error) { setConfirmDelete(null); refresh(); }
  }

  const flag = flagUrl(client.company_country);
  const tabBase: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 12.5, fontWeight: 700, background: "none", border: "none", padding: "14px 14px", cursor: "pointer", marginBottom: -1, whiteSpace: "nowrap" };
  const addBtnSmall: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#9C7C2E", background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 6, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" };
  const TAB_ADD: Record<TabKey, string> = { engagements: "+ Engagement", pipeline: "", io: "+ Registration", breaches: "+ Breach", tasks: "+ Task", correspondence: "+ Correspondence", data_mapping: "+ Activity", special_categories: "", remediation: "", dsars: "+ DSAR" };

  return (
    <div style={{ flex: 1, minWidth: 420, background: "#fff", border: "1px solid #E4D9C4", borderRadius: 12, boxShadow: "0 1px 3px rgba(26,28,30,.05)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #F0E8D8" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {flag && <span style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", display: "block", border: "1px solid #E4D9C4", flexShrink: 0 }}><img src={flag} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></span>}
            <div>
              <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: "#1A1C1E" }}>{client.company_name}</div>
              <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11.5, fontWeight: 500, lineHeight: 1, color: "#8E9196", marginTop: 3 }}>{[client.company_country, client.company_website].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {client.annual_fee_gbp != null && client.annual_fee_gbp > 0 && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 16, fontWeight: 800, lineHeight: 1, color: "#1A1C1E", fontVariantNumeric: "tabular-nums" }}>{gbp(client.annual_fee_gbp)}</div>
                <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 9.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#8E9196", marginTop: 4 }}>Annual fee</div>
              </div>
            )}
            <Pill status={client.status} meta={CLIENT_STATUS_META} />
            <button onClick={() => setShowEditClient(true)} style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#8E9196", background: "none", border: "1px solid #D4C5A9", borderRadius: 6, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }} title="Edit client details">Edit</button>
          </div>
        </div>
      </div>
      {showEditClient && <EditClientModal client={client} onClose={() => setShowEditClient(false)} onSaved={() => { setShowEditClient(false); onClientUpdated?.(); }} />}
      {/* IR verification carried over from the compliance pipeline (prospect link, migration 016) */}
      {client.prospect_ir_registered != null && (
        <div style={{ margin: "0 24px 14px", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--table-header)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>IR verification</span>
            <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 700, color: client.prospect_ir_registered ? "var(--success-green)" : "var(--risk-red)" }}>
              {client.prospect_ir_registered ? "Registered" : "Not registered"}
            </span>
            {client.prospect_ir_registration_no && (
              <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, color: "var(--tx)", fontVariantNumeric: "tabular-nums" }}>No. {client.prospect_ir_registration_no}</span>
            )}
            {client.prospect_ir_io_name && (
              <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "var(--label-text)" }}>
                IO: {client.prospect_ir_io_name}{client.prospect_ir_io_designation ? ` (${client.prospect_ir_io_designation})` : ""}
              </span>
            )}
            {client.prospect_ir_verified_date && (
              <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 11.5, fontWeight: 500, color: "var(--sub)" }}>
                Verified {new Date(client.prospect_ir_verified_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
          <a href="/compliance" style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "var(--gold-dark)", textDecoration: "none", whiteSpace: "nowrap" }}>
            View compliance pipeline →
          </a>
        </div>
      )}
      {/* Compliance radar */}
      {!loading && (
        <div style={{ padding: "0 24px 8px" }}>
          <ComplianceRadar
            assessmentDomains={assessmentDomains}
            assessmentLabel={assessmentLabel}
            registrations={registrations}
            processingActivities={processingActivities}
            specialCategories={specialCategories}
            breaches={breaches}
            tasks={tasks}
            dsars={dsars}
          />
        </div>
      )}
      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 16px", borderBottom: "1px solid #E4D9C4", flexWrap: "wrap" }}>
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} style={{ ...tabBase, color: tab === t.key ? "#1A1C1E" : "#A29C8E", borderBottom: tab === t.key ? "2.5px solid #C5A059" : "2.5px solid transparent" }}>{t.label}</button>)}
      </div>
      {/* Tab content */}
      <div style={{ padding: "20px 24px" }}>
        {!loading && TAB_ADD[tab] && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}><button onClick={() => setModal({ type: "add", entity: tab })} style={addBtnSmall}>{TAB_ADD[tab]}</button></div>}
        {loading ? (
          <div style={{ padding: "36px 20px", textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 500, color: "#8E9196" }}>Loading…</div>
        ) : (
          <>
            {tab === "pipeline" && (!client.prospect_id
              ? <EmptyTab title="No linked prospect" subtitle="This client was created directly rather than converted from the compliance pipeline." />
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div>
                    <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)", marginBottom: 8 }}>Assessments ({pipelineAssessments.length})</div>
                    {pipelineAssessments.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--empty-text)" }}>None yet.</div> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {pipelineAssessments.slice(0, 5).map((a) => (
                          <div key={a.id} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tx)" }}>
                              {a.overall_severity ? `Severity: ${a.overall_severity}` : "Assessment"}
                              {a.score_overall != null ? ` · score ${Number(a.score_overall).toFixed(0)}` : ""}
                            </span>
                            <span style={{ fontSize: 11.5, color: "var(--sub)" }}>{a.created_at ? new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)", marginBottom: 8 }}>Findings ({pipelineFindings.length})</div>
                    {pipelineFindings.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--empty-text)" }}>None yet.</div> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {pipelineFindings.slice(0, 10).map((f) => (
                          <div key={f.id} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", fontSize: 12.5, color: "var(--tx)", display: "flex", gap: 10, alignItems: "baseline" }}>
                            {f.severity && <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: f.severity === "critical" || f.severity === "high" ? "var(--risk-red)" : "var(--sub)", whiteSpace: "nowrap" }}>{f.severity}</span>}
                            <span>{f.finding || f.check_category || "Finding"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)", marginBottom: 8 }}>Documents ({pipelineDocs.length})</div>
                    {pipelineDocs.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--empty-text)" }}>None yet.</div> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {pipelineDocs.map((d) => (
                          <div key={d.id} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ color: "var(--tx)", fontWeight: 600 }}>{d.document_title ?? d.document_type}</span>
                            {d.source_url && <a href={d.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--gold-dark)", textDecoration: "none", fontSize: 11.5 }}>Open →</a>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <a href="/compliance" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--gold-dark)", textDecoration: "none" }}>Open full pipeline view →</a>
                </div>
              ))}
            {tab === "engagements" && (engagements.length === 0
              ? <EmptyTab title="No engagements yet" subtitle="Add an engagement to track service agreements." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{engagements.map((e) => <EngagementCard key={e.id} e={e} onEdit={() => setModal({ type: "edit", entity: "engagements", item: e })} onDelete={() => setConfirmDelete({ entity: "engagements", id: e.id, label: e.service_tier === "representative" ? "Representative service" : "Authorised IO service" })} />)}</div>)}
            {tab === "io" && (registrations.length === 0
              ? <EmptyTab title="No IO registrations" subtitle="Register an Information Officer or Deputy IO." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{registrations.map((r) => <RegistrationCard key={r.id} r={r} onEdit={() => setModal({ type: "edit", entity: "io", item: r })} onDelete={() => setConfirmDelete({ entity: "io", id: r.id, label: r.registrant_name + " registration" })} />)}</div>)}
            {tab === "breaches" && (breaches.length === 0
              ? <EmptyTab title="No breaches recorded" subtitle="Log an incident if a data breach is reported." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{breaches.map((b) => <BreachCard key={b.id} b={b} onEdit={() => setModal({ type: "edit", entity: "breaches", item: b })} onDelete={() => setConfirmDelete({ entity: "breaches", id: b.id, label: (b.incident_type ?? "Breach") + " — " + fmtDate(b.incident_date) })} />)}</div>)}
            {tab === "tasks" && (tasks.length === 0
              ? <EmptyTab title="No tasks" subtitle="Add compliance tasks to track deadlines." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{tasks.map((t) => <TaskCard key={t.id} t={t} onEdit={() => setModal({ type: "edit", entity: "tasks", item: t })} onDelete={() => setConfirmDelete({ entity: "tasks", id: t.id, label: t.title })} />)}</div>)}
            {tab === "correspondence" && (correspondence.length === 0
              ? <EmptyTab title="No correspondence yet" subtitle="Log Information Regulator correspondence here." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{correspondence.map((c) => <CorrespondenceCard key={c.id} c={c} onEdit={() => setModal({ type: "edit", entity: "correspondence", item: c })} onDelete={() => setConfirmDelete({ entity: "correspondence", id: c.id, label: c.subject })} />)}</div>)}
            {tab === "data_mapping" && (processingActivities.length === 0
              ? <EmptyTab title="No processing activities" subtitle="Document what personal data the client processes (ROPA)." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 8, padding: "12px 16px", fontSize: 12, fontFamily: "Manrope, sans-serif", color: "#4A4637", lineHeight: 1.6 }}>
                    <strong style={{ color: "#1A1C1E" }}>POPIA s14 — Record of Processing Activities (ROPA)</strong><br />
                    Document each way this client processes personal data. For each activity, specify the legal basis, purpose, data types collected, retention period, and any cross-border transfers. Adding 5+ active activities brings the ROPA score to 100%. Use &quot;Export ROPA&quot; to generate the statutory document for the Information Regulator.
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, color: "#1A1C1E", background: "#F5F0E8", border: "1px solid #D4C5A9", borderRadius: 6, padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                      onClick={() => exportROPA({ clientName: client.company_name, activities: processingActivities, specialCategories })}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg> Export ROPA
                    </button>
                  </div>
                  {processingActivities.map((a) => <ProcessingActivityCard key={a.id} a={a} onEdit={() => setModal({ type: "edit", entity: "data_mapping", item: a })} onDelete={() => setConfirmDelete({ entity: "data_mapping", id: a.id, label: a.activity_name })} />)}
                </div>)}
            {tab === "special_categories" && (
              <div>
                <div style={{ background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 8, padding: "12px 16px", fontSize: 12, fontFamily: "Manrope, sans-serif", color: "#4A4637", lineHeight: 1.6, marginBottom: 12 }}>
                  <strong style={{ color: "#1A1C1E" }}>POPIA s26-33 — Special personal information</strong><br />
                  POPIA defines 9 categories of special personal information (religious beliefs, race/ethnicity, trade union membership, political persuasion, health, sex life, biometric data, criminal behaviour, and children&apos;s data). Initialise all 9 categories below, then for each one record whether the client processes it, the legal basis, and safeguards in place. Some categories require prior authorisation from the Information Regulator.
                </div>
                {specialCategories.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <p style={{ color: "#8E9196", fontSize: 13, marginBottom: 12 }}>No special categories initialised yet.</p>
                    <button style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600, color: "#9C7C2E", background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }} onClick={async () => { await initSpecialCategories(cid); refresh(); }}>Initialise all 9 POPIA categories</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{specialCategories.map((sc) => <SpecialCategoryCard key={sc.id} sc={sc} onEdit={() => setModal({ type: "edit", entity: "special_categories", item: sc })} />)}</div>
                )}
              </div>
            )}
            {tab === "remediation" && (
              <RemediationTab items={remediationItems} clientId={cid} onRefresh={refresh} />
            )}
            {tab === "dsars" && (dsars.length === 0
              ? <EmptyTab title="No data subject requests" subtitle="Log access, correction, or deletion requests here (POPIA s23-25)." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{dsars.map((d) => <DSARCard key={d.id} d={d} onEdit={() => setModal({ type: "edit", entity: "dsars", item: d })} onDelete={() => setConfirmDelete({ entity: "dsars", id: d.id, label: `${d.request_type} — ${d.data_subject_name}` })} />)}</div>)}
          </>
        )}
      </div>
      {/* Entity form modals */}
      {modal?.entity === "engagements" && <EngagementFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "io" && <RegistrationFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "breaches" && <BreachFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "tasks" && <TaskFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "correspondence" && <CorrespondenceFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "data_mapping" && <ProcessingActivityFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {modal?.entity === "special_categories" && modal.type === "edit" && <SpecialCategoryFormModal item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {modal?.entity === "dsars" && <DSARFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {/* Delete confirmation */}
      {confirmDelete && <ConfirmDialog title="Delete record" message={"Are you sure you want to delete \"" + confirmDelete.label + "\"? This cannot be undone."} onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} loading={deleting} />}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function ClientsClient({ initialClients, summary }: { initialClients: Client[]; summary: ClientManagementSummary | null }) {
  const [clients] = useState<Client[]>(initialClients);
  const [selectedId, setSelectedId] = useState<string | null>(clients[0]?.id ?? null);
  const [showAddForm, setShowAddForm] = useState(false);
  const selected = clients.find((c) => c.id === selectedId) ?? null;

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196" }}>AfricanSTN · Commercial</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <h1 style={{ fontFamily: "Manrope, sans-serif", fontSize: 26, fontWeight: 800, color: "#1A1C1E", margin: 0 }}>Clients</h1>
          <button onClick={() => setShowAddForm(true)} style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, color: "#fff", background: "#C5A059", border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}>+ Add client</button>
        </div>
      </div>
      {/* Body */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Sidebar */}
        <div style={{ width: 270, flexShrink: 0 }}>
          <div style={{ background: "#fff", border: "1px solid #E4D9C4", borderRadius: 12, overflow: "hidden" }}>
            {clients.map((c) => {
              const active = c.id === selectedId;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #F0E8D8", padding: "14px 16px", cursor: "pointer", background: active ? "#FAF6EE" : "#fff", borderLeft: active ? "3px solid #C5A059" : "3px solid transparent" }}>
                  <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: active ? 800 : 600, color: "#1A1C1E", lineHeight: 1.3 }}>{c.company_name}</div>
                  <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, color: "#8E9196", marginTop: 2 }}>{c.company_country ?? "—"}</div>
                </button>
              );
            })}
            {clients.length === 0 && <div style={{ padding: "24px 16px", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "#8E9196", textAlign: "center" }}>No clients yet</div>}
          </div>
        </div>
        {/* Detail */}
        {selected ? <ClientDetail client={selected} onClientUpdated={() => window.location.reload()} /> : <div style={{ flex: 1, padding: "60px 20px", textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 14, color: "#8E9196" }}>Select a client</div>}
      </div>
      {showAddForm && <AddClientModal onClose={() => setShowAddForm(false)} />}
    </div>
  );
}

// ─── Add client modal ────────────────────────────────────────────────────────

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      company_name: fd.get("company_name") as string,
      company_website: (fd.get("company_website") as string) || null,
      company_country: (fd.get("company_country") as string) || null,
      contact_name: (fd.get("contact_name") as string) || null,
      contact_email: (fd.get("contact_email") as string) || null,
      contact_role: (fd.get("contact_role") as string) || null,
      status: (fd.get("status") as string) || "prospect",
      service_tier: (fd.get("service_tier") as string) || null,
      annual_fee_gbp: fd.get("annual_fee_gbp") ? Number(fd.get("annual_fee_gbp")) : null,
      notes: (fd.get("notes") as string) || null,
    };
    const res = await createClientAction(payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    window.location.reload();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <h2 style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", margin: "0 0 20px" }}>Add client</h2>
      {error && <div style={{ background: "#FEE", border: "1px solid #CC0000", borderRadius: 6, padding: "8px 12px", marginBottom: 14, fontFamily: "Manrope, sans-serif", fontSize: 12, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 16px" }}>
          <div><label style={labelStyle}>Company name *</label><input name="company_name" required style={inputStyle} /></div>
          <div><label style={labelStyle}>Website</label><input name="company_website" style={inputStyle} /></div>
          <div><label style={labelStyle}>Country</label><input name="company_country" style={inputStyle} /></div>
          <div><label style={labelStyle}>Contact name</label><input name="contact_name" style={inputStyle} /></div>
          <div><label style={labelStyle}>Contact email</label><input name="contact_email" type="email" style={inputStyle} /></div>
          <div><label style={labelStyle}>Contact role</label><input name="contact_role" style={inputStyle} /></div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="status" defaultValue="prospect" style={inputStyle}>
              <option value="prospect">Prospect</option><option value="onboarding">Onboarding</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="churned">Churned</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Service tier</label>
            <select name="service_tier" defaultValue="" style={inputStyle}>
              <option value="">—</option><option value="representative">Representative</option><option value="authorised_io">Authorised IO</option><option value="full_service">Full service</option>
            </select>
          </div>
          <div><label style={labelStyle}>Annual fee (GBP)</label><input name="annual_fee_gbp" type="number" step="0.01" style={inputStyle} /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Notes</label><textarea name="notes" rows={3} style={{ ...inputStyle, resize: "vertical" }} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Add client"}</button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ─── Edit client modal ──────────────────────────────────────────────────────

function EditClientModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      company_name: fd.get("company_name") as string,
      company_website: (fd.get("company_website") as string) || null,
      company_country: (fd.get("company_country") as string) || null,
      contact_name: (fd.get("contact_name") as string) || null,
      contact_email: (fd.get("contact_email") as string) || null,
      contact_role: (fd.get("contact_role") as string) || null,
      status: (fd.get("status") as string) || "prospect",
      service_tier: (fd.get("service_tier") as string) || null,
      annual_fee_gbp: fd.get("annual_fee_gbp") ? Number(fd.get("annual_fee_gbp")) : null,
      notes: (fd.get("notes") as string) || null,
    };
    const res = await updateClientAction(client.id, payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <h2 style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", margin: "0 0 20px" }}>Edit client</h2>
      {error && <div style={{ background: "#FEE", border: "1px solid #CC0000", borderRadius: 6, padding: "8px 12px", marginBottom: 14, fontFamily: "Manrope, sans-serif", fontSize: 12, color: "#CC0000" }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 16px" }}>
          <div><label style={labelStyle}>Company name *</label><input name="company_name" required defaultValue={client.company_name} style={inputStyle} /></div>
          <div><label style={labelStyle}>Website</label><input name="company_website" defaultValue={client.company_website ?? ""} style={inputStyle} /></div>
          <div><label style={labelStyle}>Country</label><input name="company_country" defaultValue={client.company_country ?? ""} style={inputStyle} /></div>
          <div><label style={labelStyle}>Contact name</label><input name="contact_name" defaultValue={client.contact_name ?? ""} style={inputStyle} /></div>
          <div><label style={labelStyle}>Contact email</label><input name="contact_email" type="email" defaultValue={client.contact_email ?? ""} style={inputStyle} /></div>
          <div><label style={labelStyle}>Contact role</label><input name="contact_role" defaultValue={client.contact_role ?? ""} style={inputStyle} /></div>
          <div>
            <label style={labelStyle}>Status</label>
            <select name="status" defaultValue={client.status} style={inputStyle}>
              <option value="prospect">Prospect</option><option value="onboarding">Onboarding</option><option value="engaged">Engaged</option><option value="paused">Paused</option><option value="churned">Churned</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Service tier</label>
            <select name="service_tier" defaultValue={client.service_tier ?? ""} style={inputStyle}>
              <option value="">—</option><option value="representative">Representative</option><option value="authorised_io">Authorised IO</option><option value="full_service">Full service</option>
            </select>
          </div>
          <div><label style={labelStyle}>Annual fee (GBP)</label><input name="annual_fee_gbp" type="number" step="0.01" defaultValue={client.annual_fee_gbp ?? ""} style={inputStyle} /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Notes</label><textarea name="notes" rows={3} defaultValue={client.notes ?? ""} style={{ ...inputStyle, resize: "vertical" }} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

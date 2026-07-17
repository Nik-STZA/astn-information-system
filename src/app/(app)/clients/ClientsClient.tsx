"use client";

import { useState, useEffect, useCallback } from "react";
import type { Client } from "@/lib/data/compliance";
import { flagUrl } from "@/lib/country-iso";
import type {
  Engagement,
  IORegistration,
  BreachIncident,
  ComplianceTask,
  Correspondence,
  ClientManagementSummary,
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
} from "@/lib/data/client-management";
import { createClient } from "@/lib/data/compliance";

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

type TabKey = "engagements" | "io" | "breaches" | "tasks" | "correspondence";

const TABS: { key: TabKey; label: string }[] = [
  { key: "engagements", label: "Engagements" },
  { key: "io", label: "IO registrations" },
  { key: "breaches", label: "Breaches" },
  { key: "tasks", label: "Tasks" },
  { key: "correspondence", label: "Correspondence" },
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
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: "#55524C" }}>
        {b.description ?? "No description provided."}
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

// ─── Client detail panel ─────────────────────────────────────────────────────

type ModalState = { type: "add"; entity: TabKey } | { type: "edit"; entity: "engagements"; item: Engagement } | { type: "edit"; entity: "io"; item: IORegistration } | { type: "edit"; entity: "breaches"; item: BreachIncident } | { type: "edit"; entity: "tasks"; item: ComplianceTask } | { type: "edit"; entity: "correspondence"; item: Correspondence } | null;
type DeleteState = { entity: TabKey; id: number; label: string } | null;

function ClientDetail({ client }: { client: Client }) {
  const [tab, setTab] = useState<TabKey>("engagements");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [registrations, setRegistrations] = useState<IORegistration[]>([]);
  const [breaches, setBreaches] = useState<BreachIncident[]>([]);
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [correspondence, setCorrespondence] = useState<Correspondence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState<ModalState>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const cid = String(client.id);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEngagements(cid), fetchRegistrations(cid), fetchBreaches(cid), fetchClientTasks(cid), fetchClientCorrespondence(cid)])
      .then(([eR, rR, bR, tR, cR]) => {
        setEngagements(eR.data?.data ?? []); setRegistrations(rR.data?.data ?? []);
        setBreaches(bR.data?.data ?? []); setTasks(tR.data?.data ?? []);
        setCorrespondence(cR.data?.data ?? []); setLoading(false);
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
    }
    setDeleting(false);
    if (!res?.error) { setConfirmDelete(null); refresh(); }
  }

  const flag = flagUrl(client.company_country);
  const tabBase: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 12.5, fontWeight: 700, background: "none", border: "none", padding: "14px 14px", cursor: "pointer", marginBottom: -1, whiteSpace: "nowrap" };
  const addBtnSmall: React.CSSProperties = { fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 600, color: "#9C7C2E", background: "#FAF6EE", border: "1px solid #E7D9BE", borderRadius: 6, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" };
  const TAB_ADD: Record<TabKey, string> = { engagements: "+ Engagement", io: "+ Registration", breaches: "+ Breach", tasks: "+ Task", correspondence: "+ Correspondence" };

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
          </div>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 16px", borderBottom: "1px solid #E4D9C4", flexWrap: "wrap" }}>
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} style={{ ...tabBase, color: tab === t.key ? "#1A1C1E" : "#A29C8E", borderBottom: tab === t.key ? "2.5px solid #C5A059" : "2.5px solid transparent" }}>{t.label}</button>)}
      </div>
      {/* Tab content */}
      <div style={{ padding: "20px 24px" }}>
        {!loading && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}><button onClick={() => setModal({ type: "add", entity: tab })} style={addBtnSmall}>{TAB_ADD[tab]}</button></div>}
        {loading ? (
          <div style={{ padding: "36px 20px", textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 500, color: "#8E9196" }}>Loading…</div>
        ) : (
          <>
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
          </>
        )}
      </div>
      {/* Entity form modals */}
      {modal?.entity === "engagements" && <EngagementFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "io" && <RegistrationFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "breaches" && <BreachFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "tasks" && <TaskFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.entity === "correspondence" && <CorrespondenceFormModal clientId={cid} initial={modal.type === "edit" ? modal.item : undefined} onClose={() => setModal(null)} onSaved={refresh} />}
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
        {selected ? <ClientDetail client={selected} /> : <div style={{ flex: 1, padding: "60px 20px", textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 14, color: "#8E9196" }}>Select a client</div>}
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
    const res = await createClient(payload);
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

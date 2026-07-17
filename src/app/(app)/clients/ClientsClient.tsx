"use client";

import { useState, useEffect } from "react";
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
  createRegistration,
  createBreach,
  createTask,
  createCorrespondence,
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

// ─── Engagement card ─────────────────────────────────────────────────────────

function EngagementCard({ e }: { e: Engagement }) {
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "15px 17px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
          {e.service_tier === "representative" ? "Representative service" : "Authorised IO service"}
        </span>
        <Pill status={e.engagement_status} meta={ENGAGEMENT_STATUS_META} />
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

// ─── IO Registration card ────────────────────────────────────────────────────

function RegistrationCard({ r }: { r: IORegistration }) {
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "15px 17px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
          {r.registration_type === "information_officer" ? "Information Officer" : "Deputy IO"} — {r.registrant_name}
        </span>
        <Pill status={r.registration_status} meta={REG_STATUS_META} />
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

// ─── Task card ───────────────────────────────────────────────────────────────

function TaskCard({ t }: { t: ComplianceTask }) {
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
      <Pill status={t.status} meta={TASK_STATUS_META} />
    </div>
  );
}

// ─── Breach card ─────────────────────────────────────────────────────────────

function BreachCard({ b }: { b: BreachIncident }) {
  const severityColor: Record<string, string> = { low: "#8E9196", medium: "#A67514", high: "#CC7700", critical: "#CC0000" };
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "15px 17px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
          {b.incident_type ?? "Breach incident"} — {fmtDate(b.incident_date)}
        </span>
        <span style={{
          fontFamily: "Manrope, sans-serif", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
          color: severityColor[b.severity ?? "low"] ?? "#8E9196",
          background: (severityColor[b.severity ?? "low"] ?? "#8E9196") + "18",
          border: `1px solid ${severityColor[b.severity ?? "low"] ?? "#8E9196"}40`,
          borderRadius: 20, padding: "4px 9px", whiteSpace: "nowrap",
        }}>
          {b.severity ?? "unknown"}
        </span>
      </div>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: "#55524C" }}>
        {b.description ?? "No description provided."}
      </div>
    </div>
  );
}

// ─── Correspondence card ─────────────────────────────────────────────────────

function CorrespondenceCard({ c }: { c: Correspondence }) {
  return (
    <div style={{ border: "1px solid #EFE7D6", borderRadius: 9, padding: "13px 16px", background: "#FAF7F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: "#1A1C1E" }}>
          {c.subject}
        </span>
        <span style={{
          fontFamily: "Manrope, sans-serif", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
          color: c.direction === "inbound" ? "#3E6B8E" : "#A67514",
          background: c.direction === "inbound" ? "#E5EDF3" : "#FBF1DE",
          border: `1px solid ${c.direction === "inbound" ? "#C5D6E4" : "#EAD6A6"}`,
          borderRadius: 20, padding: "4px 9px", whiteSpace: "nowrap",
        }}>
          {c.direction}
        </span>
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
    <div className="card-empty" style={{ padding: "36px 20px", textAlign: "center", margin: 16 }}>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: "#8E9196", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: "#B9B2A2" }}>
        {subtitle}
      </div>
    </div>
  );
}

// ─── Client detail panel ─────────────────────────────────────────────────────

function ClientDetail({ client }: { client: Client }) {
  const [tab, setTab] = useState<TabKey>("engagements");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [registrations, setRegistrations] = useState<IORegistration[]>([]);
  const [breaches, setBreaches] = useState<BreachIncident[]>([]);
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [correspondence, setCorrespondence] = useState<Correspondence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const cid = String(client.id);
    Promise.all([
      fetchEngagements(cid),
      fetchRegistrations(cid),
      fetchBreaches(cid),
      fetchClientTasks(cid),
      fetchClientCorrespondence(cid),
    ]).then(([eRes, rRes, bRes, tRes, cRes]) => {
      setEngagements(eRes.data?.data ?? []);
      setRegistrations(rRes.data?.data ?? []);
      setBreaches(bRes.data?.data ?? []);
      setTasks(tRes.data?.data ?? []);
      setCorrespondence(cRes.data?.data ?? []);
      setLoading(false);
    });
  }, [client.id]);

  const flag = flagUrl(client.company_country);
  const statusMeta = CLIENT_STATUS_META[client.status] ?? CLIENT_STATUS_META["prospect"];

  const tabBase: React.CSSProperties = {
    fontFamily: "Manrope, sans-serif",
    fontSize: 12.5,
    fontWeight: 700,
    background: "none",
    border: "none",
    padding: "14px 14px",
    cursor: "pointer",
    marginBottom: -1,
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 420,
        background: "#fff",
        border: "1px solid #E4D9C4",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(26,28,30,.05)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #F0E8D8" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {flag && (
              <span style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", display: "block", border: "1px solid #E4D9C4", flexShrink: 0 }}>
                <img src={flag} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </span>
            )}
            <div>
              <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: "#1A1C1E" }}>
                {client.company_name}
              </div>
              <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11.5, fontWeight: 500, lineHeight: 1, color: "#8E9196", marginTop: 3 }}>
                {[client.company_country, client.company_website].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {client.annual_fee_gbp != null && client.annual_fee_gbp > 0 && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 16, fontWeight: 800, lineHeight: 1, color: "#1A1C1E", fontVariantNumeric: "tabular-nums" }}>
                  {gbp(client.annual_fee_gbp)}
                </div>
                <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 9.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#8E9196", marginTop: 4 }}>
                  Annual fee
                </div>
              </div>
            )}
            <Pill status={client.status} meta={CLIENT_STATUS_META} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 16px", borderBottom: "1px solid #E4D9C4", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              ...tabBase,
              color: tab === t.key ? "#1A1C1E" : "#A29C8E",
              borderBottom: tab === t.key ? "2.5px solid #C5A059" : "2.5px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: "20px 24px" }}>
        {loading ? (
          <div style={{ padding: "36px 20px", textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 500, color: "#8E9196" }}>
            Loading…
          </div>
        ) : (
          <>
            {tab === "engagements" && (
              engagements.length === 0 ? (
                <EmptyTab title="No engagements yet" subtitle="Add an engagement to track service agreements for this client." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {engagements.map((e) => <EngagementCard key={e.id} e={e} />)}
                </div>
              )
            )}
            {tab === "io" && (
              registrations.length === 0 ? (
                <EmptyTab title="No IO registrations" subtitle="Register an Information Officer or Deputy IO for this client." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {registrations.map((r) => <RegistrationCard key={r.id} r={r} />)}
                </div>
              )
            )}
            {tab === "breaches" && (
              breaches.length === 0 ? (
                <EmptyTab title="No breaches recorded" subtitle="Log an incident here if a data breach is reported for this client." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {breaches.map((b) => <BreachCard key={b.id} b={b} />)}
                </div>
              )
            )}
            {tab === "tasks" && (
              tasks.length === 0 ? (
                <EmptyTab title="No tasks" subtitle="Add compliance tasks to track obligations and deadlines for this client." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {tasks.map((t) => <TaskCard key={t.id} t={t} />)}
                </div>
              )
            )}
            {tab === "correspondence" && (
              correspondence.length === 0 ? (
                <EmptyTab title="No correspondence yet" subtitle="Inbound and outbound Information Regulator correspondence will be logged here." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {correspondence.map((c) => <CorrespondenceCard key={c.id} c={c} />)}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ClientsClient({
  initialClients,
  summary,
}: {
  initialClients: Client[];
  summary: ClientManagementSummary | null;
}) {
  const [clients] = useState(initialClients);
  const [selectedId, setSelectedId] = useState<string | null>(clients.length > 0 ? clients[0].id : null);
  const [showAddForm, setShowAddForm] = useState(false);

  const selectedClient = clients.find((c) => c.id === selectedId) ?? null;

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "30px 26px 60px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#B08D3F", marginBottom: 9 }}>
            AfricanSTN · Commercial
          </div>
          <h1 style={{ fontFamily: "Manrope, sans-serif", fontSize: 27, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-.02em", color: "#1A1C1E", margin: "0 0 5px" }}>
            Clients
          </h1>
          <p style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 500, lineHeight: 1.4, color: "#8E9196", margin: 0 }}>
            Engagements, IO registrations, breaches, tasks &amp; regulatory correspondence.
          </p>
        </div>
        <button onClick={() => setShowAddForm(true)} style={{ ...btnPrimary, flexShrink: 0 }}>
          + Add client
        </button>
      </div>

      {/* Info banner when no clients */}
      {clients.length === 0 && (
        <div style={{ background: "#FBF3E4", border: "1px solid #E7D2A6", borderRadius: 8, padding: "9px 14px", marginBottom: 18, fontFamily: "Manrope, sans-serif", fontSize: 11.5, fontWeight: 500, lineHeight: 1.4, color: "#A07A2E" }}>
          No live clients yet. Convert a prospect in Compliance to add clients here, or add one manually.
        </div>
      )}

      {/* Main layout */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Client list sidebar */}
        <div style={{ width: 270, flexShrink: 0, background: "#fff", border: "1px solid #E4D9C4", borderRadius: 12, padding: 14, boxShadow: "0 1px 3px rgba(26,28,30,.05)" }}>
          <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8E9196", margin: "2px 0 12px 4px" }}>
            Clients · {clients.length}
          </div>
          {clients.length === 0 ? (
            <div style={{ margin: "12px 4px 2px", fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.5, color: "#A29C8E" }}>
              Convert a prospect in Compliance to add more clients here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {clients.map((c) => {
                const isSelected = c.id === selectedId;
                const flag = flagUrl(c.company_country);
                const sm = CLIENT_STATUS_META[c.status] ?? CLIENT_STATUS_META["prospect"];
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      background: isSelected ? "#FAF6EE" : "transparent",
                      border: isSelected ? "1px solid #E7D9BE" : "1px solid transparent",
                      borderLeft: isSelected ? "3px solid #C5A059" : "3px solid transparent",
                      borderRadius: 8,
                      padding: "12px 13px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                      {flag && (
                        <span style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", display: "block", border: "1px solid #E4D9C4" }}>
                          <img src={flag} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        </span>
                      )}
                      <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: "#1A1C1E" }}>
                        {c.company_name}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Pill status={c.status} meta={CLIENT_STATUS_META} />
                      {c.service_tier && (
                        <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1, color: "#8E9196" }}>
                          {c.service_tier.charAt(0).toUpperCase() + c.service_tier.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedClient ? (
          <ClientDetail client={selectedClient} />
        ) : (
          <div
            style={{
              flex: 1,
              minWidth: 420,
              background: "#fff",
              border: "1px dashed #D9CDB4",
              borderRadius: 12,
              padding: "56px 24px",
              textAlign: "center",
            }}
          >
            <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: "#1A1C1E", marginBottom: 6 }}>
              {clients.length === 0 ? "No clients yet" : "Select a client"}
            </div>
            <p style={{ fontFamily: "Manrope, sans-serif", fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, color: "#8E9196", margin: "0 0 18px", maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
              {clients.length === 0
                ? "Add a client manually or convert a prospect from the Compliance page to get started."
                : "Click a client in the list to view their engagements, registrations, and compliance details."}
            </p>
            {clients.length === 0 && (
              <button onClick={() => setShowAddForm(true)} style={btnPrimary}>
                + Add your first client
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add client modal */}
      {showAddForm && (
        <AddClientModal onClose={() => setShowAddForm(false)} />
      )}
    </div>
  );
}

// ─── Add client modal ────────────────────────────────────────────────────────

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      company_name: fd.get("company_name") as string,
      company_website: (fd.get("company_website") as string) || null,
      company_country: (fd.get("company_country") as string) || null,
      contact_name: (fd.get("contact_name") as string) || null,
      contact_email: (fd.get("contact_email") as string) || null,
      contact_role: (fd.get("contact_role") as string) || null,
      status: fd.get("status") as string,
      service_tier: (fd.get("service_tier") as string) || null,
      annual_fee_gbp: fd.get("annual_fee_gbp") ? Number(fd.get("annual_fee_gbp")) : null,
      notes: (fd.get("notes") as string) || null,
    };

    const res = await createClient(payload);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      window.location.reload();
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,17,19,.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E4D9C4", width: 520, maxHeight: "90vh", overflow: "auto", padding: "24px 28px", boxShadow: "0 8px 30px rgba(26,28,30,.15)" }}>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1C1E", marginBottom: 20 }}>
          Add client
        </div>
        {error && (
          <div style={{ background: "#FDF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#CC0000" }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Company name *</label>
              <input name="company_name" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Website</label>
              <input name="company_website" style={inputStyle} placeholder="catapultsports.com" />
            </div>
            <div>
              <label style={labelStyle}>Country</label>
              <input name="company_country" style={inputStyle} placeholder="Australia" />
            </div>
            <div>
              <label style={labelStyle}>Contact name</label>
              <input name="contact_name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Contact email</label>
              <input name="contact_email" type="email" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Contact role</label>
              <input name="contact_role" style={inputStyle} placeholder="DPO" />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select name="status" defaultValue="engaged" style={inputStyle}>
                <option value="prospect">Prospect</option>
                <option value="onboarding">Onboarding</option>
                <option value="engaged">Engaged</option>
                <option value="paused">Paused</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Service tier</label>
              <input name="service_tier" style={inputStyle} placeholder="representative" />
            </div>
            <div>
              <label style={labelStyle}>Annual fee (GBP)</label>
              <input name="annual_fee_gbp" type="number" style={inputStyle} placeholder="0" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Notes</label>
              <textarea name="notes" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Create client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

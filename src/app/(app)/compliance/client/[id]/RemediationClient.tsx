"use client";

import { useState, useTransition } from "react";
import ProcessorRegisterPanel from "./ProcessorRegisterPanel";
import Link from "next/link";
import type { Client } from "@/lib/data/compliance";
import type { RemediationItem, AuditEntry } from "@/lib/data/remediation";
import {
  updateRemediationStatus,
  addNote,
  generateRemediationItems,
} from "./actions";
import { generateAuditReport } from "@/lib/reports/auditReport";

/* ── Constants ─────────────────────────────────────────────────── */

const STATUS_ORDER = [
  "open",
  "in_progress",
  "resolved",
  "verified",
  "not_applicable",
  "accepted_risk",
];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  verified: "Verified",
  not_applicable: "N/A",
  accepted_risk: "Accepted risk",
};

const STATUS_META: Record<
  string,
  { color: string; bg: string; border: string }
> = {
  open: { color: "#B4432C", bg: "#FBE7E1", border: "#EDCBBF" },
  in_progress: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  resolved: { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  verified: { color: "#1B5E20", bg: "#C8E6C9", border: "#A5D6A7" },
  not_applicable: { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
  accepted_risk: { color: "#6E6A62", bg: "#F2F0EB", border: "#DDD9D1" },
};

const SEVERITY_META: Record<
  string,
  { color: string; bg: string; border: string }
> = {
  critical: { color: "#B4432C", bg: "#FBE7E1", border: "#EDCBBF" },
  high: { color: "#CC7700", bg: "#FEF3E2", border: "#F5DDB5" },
  medium: { color: "#A67514", bg: "#FBF1DE", border: "#EAD6A6" },
  low: { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" },
  info: { color: "#6E6A62", bg: "#F2F0EB", border: "#DDD9D1" },
};

const PILL_UNSET = { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" };

const ACTION_ICONS: Record<string, string> = {
  batch_created: "📋",
  status_changed: "🔄",
  note_added: "📝",
  updated: "✏️",
  created: "➕",
  evidence_attached: "📎",
  assigned: "👤",
  verified: "✅",
};

/* ── Shared components ─────────────────────────────────────────── */

function Pill({
  value,
  meta,
}: {
  value: string;
  meta: Record<string, { color: string; bg: string; border: string }>;
}) {
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
      {STATUS_LABELS[value] || value}
    </span>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 26,
          lineHeight: 1.1,
          color: color || "var(--tx)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontWeight: 500,
          fontSize: 11.5,
          color: "#8E9196",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Tab type ──────────────────────────────────────────────────── */

type Tab = "remediation" | "audit" | "systems";

/* ── Main component ────────────────────────────────────────────── */

export default function RemediationClient({
  client,
  initialItems,
  initialAudit,
}: {
  client: Client;
  initialItems: RemediationItem[];
  initialAudit: AuditEntry[];
}) {
  const [items, setItems] = useState(initialItems);
  const [audit, setAudit] = useState(initialAudit);
  const [tab, setTab] = useState<Tab>("remediation");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [noteText, setNoteText] = useState("");
  const [generating, setGenerating] = useState(false);

  /* ── Derived stats ──────────────────────────────────────────── */

  const openCount = items.filter(
    (i) => i.status === "open" || i.status === "in_progress"
  ).length;
  const resolvedCount = items.filter(
    (i) => i.status === "resolved" || i.status === "verified"
  ).length;
  const criticalOpen = items.filter(
    (i) =>
      (i.status === "open" || i.status === "in_progress") &&
      (i.severity === "critical" || i.severity === "high")
  ).length;
  const totalItems = items.length;

  const progressPct =
    totalItems > 0 ? Math.round((resolvedCount / totalItems) * 100) : 0;

  /* ── Filtered items ─────────────────────────────────────────── */

  const filteredItems =
    statusFilter === "all"
      ? items
      : items.filter((i) => i.status === statusFilter);

  /* ── Handlers ───────────────────────────────────────────────── */

  function handleStatusChange(itemId: number, newStatus: string) {
    startTransition(async () => {
      const result = await updateRemediationStatus(itemId, newStatus);
      if (result?.data) {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, ...result.data } : i))
        );
      }
    });
  }

  function handleAddNote(itemId: number) {
    if (!noteText.trim()) return;
    startTransition(async () => {
      await addNote(itemId, noteText.trim());
      setNoteText("");
      // Refresh audit
      window.location.reload();
    });
  }

  async function handleGenerate() {
    if (!client.id) return;
    setGenerating(true);
    try {
      const result = await generateRemediationItems(client.id);
      if (result?.data) {
        setItems(result.data.data || []);
      }
    } finally {
      setGenerating(false);
      window.location.reload();
    }
  }

  async function handleExportReport() {
    const blob = await generateAuditReport({
      companyName: client.company_name,
      clientStatus: client.status,
      serviceTier: client.service_tier ?? null,
      contactName: client.contact_name ?? null,
      contactEmail: client.contact_email ?? null,
      items,
      audit,
      generatedBy: "nik@stza.io",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeCompany = client.company_name.replace(/[^a-zA-Z0-9]/g, "_");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `POPIA_Audit_Report_${safeCompany}_${dateStr}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <Link
          href="/compliance"
          style={{
            fontWeight: 600,
            fontSize: 11.5,
            color: "var(--gold-dark)",
            textDecoration: "none",
          }}
        >
          Compliance
        </Link>
        <span style={{ color: "var(--sub)", fontSize: 11.5 }}>
          {" "}
          / {client.company_name}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <h1>
          {client.company_name}{" "}
          <span
            style={{ fontWeight: 400, fontSize: 16, color: "var(--sub)" }}
          >
            — POPIA remediation
          </span>
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          {items.length === 0 && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-primary"
              style={{ fontSize: 12 }}
            >
              {generating ? "Generating..." : "Generate remediation items"}
            </button>
          )}
          {items.length > 0 && (
            <button
              onClick={handleExportReport}
              className="btn-secondary"
              style={{ fontSize: 12 }}
            >
              Export audit report
            </button>
          )}
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard label="Total items" value={totalItems} />
        <StatCard label="Open / in progress" value={openCount} color={openCount > 0 ? "#B4432C" : "#2E7D32"} />
        <StatCard label="Critical / high open" value={criticalOpen} color={criticalOpen > 0 ? "#CC0000" : "#2E7D32"} />
        <StatCard label="Resolved / verified" value={resolvedCount} color="#2E7D32" />

        {/* Progress bar card */}
        <div className="card" style={{ padding: "16px 18px" }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: 26,
              lineHeight: 1.1,
              color: "var(--tx)",
            }}
          >
            {progressPct}%
          </div>
          <div
            style={{
              fontWeight: 500,
              fontSize: 11.5,
              color: "#8E9196",
              marginTop: 4,
              marginBottom: 6,
            }}
          >
            Complete
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: "var(--bd)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "#2E7D32",
                borderRadius: 3,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--bd)",
          marginBottom: 20,
        }}
      >
        {(["remediation", "audit", "systems"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 20px",
              fontWeight: tab === t ? 700 : 500,
              fontSize: 13,
              color: tab === t ? "var(--tx)" : "var(--sub)",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid #C5A059" : "2px solid transparent",
              cursor: "pointer",
              textTransform: "capitalize",
              transition: "color 0.15s",
            }}
          >
            {t === "remediation" ? "Remediation items" : t === "audit" ? "Audit trail" : "Systems & DPAs"}
          </button>
        ))}
      </div>

      {tab === "systems" && <ProcessorRegisterPanel clientId={client.id} />}

      {/* ── Remediation tab ───────────────────────────────────── */}
      {tab === "remediation" && (
        <>
          {/* Filter bar */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            {["all", ...STATUS_ORDER].map((s) => {
              const count =
                s === "all"
                  ? items.length
                  : items.filter((i) => i.status === s).length;
              if (s !== "all" && count === 0) return null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: "5px 14px",
                    fontSize: 11,
                    fontWeight: statusFilter === s ? 700 : 500,
                    borderRadius: 20,
                    border: `1px solid ${statusFilter === s ? "#C5A059" : "var(--bd)"}`,
                    background: statusFilter === s ? "#C5A059" : "var(--pnl)",
                    color: statusFilter === s ? "#1A1C1E" : "var(--tx)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {s === "all" ? "All" : STATUS_LABELS[s] || s} ({count})
                </button>
              );
            })}
          </div>

          {/* Items list */}
          {filteredItems.length === 0 ? (
            <div className="card-empty" style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 14, color: "var(--empty-text)" }}>
                {items.length === 0
                  ? "No remediation items yet. Run the assessment pipeline first, then generate items."
                  : "No items match this filter."}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredItems.map((item) => {
                const isExpanded = expandedId === item.id;
                return (
                  <div key={item.id} className="card" style={{ overflow: "hidden" }}>
                    {/* Row header — click to expand */}
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px 1fr 100px 90px 100px",
                        alignItems: "center",
                        padding: "14px 18px",
                        gap: 12,
                        cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--cardhover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Pill value={item.severity} meta={SEVERITY_META} />
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: "var(--tx)",
                          }}
                        >
                          {item.title}
                        </div>
                        {item.popia_reference && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--sub)",
                              fontWeight: 500,
                            }}
                          >
                            POPIA {item.popia_reference}
                          </span>
                        )}
                      </div>
                      <Pill value={item.status} meta={STATUS_META} />
                      <div style={{ fontSize: 11, color: "var(--sub)" }}>
                        {item.due_date ? formatDate(item.due_date) : "No due date"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--sub)" }}>
                        {item.assigned_to || "Unassigned"}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div
                        style={{
                          borderTop: "1px solid var(--bd)",
                          padding: "18px 18px 14px",
                          background: "var(--cardhover)",
                        }}
                      >
                        {/* Finding description */}
                        <div style={{ marginBottom: 14 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.1em",
                              color: "var(--label-text)",
                              marginBottom: 4,
                            }}
                          >
                            Finding
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.6,
                              color: "var(--tx)",
                            }}
                          >
                            {item.description || "—"}
                          </div>
                        </div>

                        {/* Recommendation */}
                        {item.recommendation && (
                          <div style={{ marginBottom: 14 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 10,
                                textTransform: "uppercase",
                                letterSpacing: "0.1em",
                                color: "var(--label-text)",
                                marginBottom: 4,
                              }}
                            >
                              Recommendation
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                lineHeight: 1.6,
                                color: "var(--tx)",
                              }}
                            >
                              {item.recommendation}
                            </div>
                          </div>
                        )}

                        {/* Resolution summary */}
                        {item.resolution_summary && (
                          <div style={{ marginBottom: 14 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 10,
                                textTransform: "uppercase",
                                letterSpacing: "0.1em",
                                color: "var(--label-text)",
                                marginBottom: 4,
                              }}
                            >
                              Resolution
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                lineHeight: 1.6,
                                color: "var(--tx)",
                              }}
                            >
                              {item.resolution_summary}
                            </div>
                          </div>
                        )}

                        {/* Dates */}
                        <div
                          style={{
                            display: "flex",
                            gap: 24,
                            flexWrap: "wrap",
                            marginBottom: 16,
                            fontSize: 12,
                            color: "var(--sub)",
                          }}
                        >
                          <span>Created: {formatDate(item.created_at)}</span>
                          {item.started_date && (
                            <span>Started: {formatDate(item.started_date)}</span>
                          )}
                          {item.resolved_date && (
                            <span>Resolved: {formatDate(item.resolved_date)}</span>
                          )}
                          {item.verified_date && (
                            <span>
                              Verified: {formatDate(item.verified_date)} by{" "}
                              {item.verified_by || "—"}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          {/* Status change buttons */}
                          {item.status === "open" && (
                            <button
                              className="btn-primary"
                              style={{ fontSize: 11, padding: "6px 14px" }}
                              onClick={() => handleStatusChange(item.id, "in_progress")}
                              disabled={isPending}
                            >
                              Start work
                            </button>
                          )}
                          {item.status === "in_progress" && (
                            <button
                              className="btn-primary"
                              style={{ fontSize: 11, padding: "6px 14px" }}
                              onClick={() => handleStatusChange(item.id, "resolved")}
                              disabled={isPending}
                            >
                              Mark resolved
                            </button>
                          )}
                          {item.status === "resolved" && (
                            <button
                              className="btn-primary"
                              style={{ fontSize: 11, padding: "6px 14px" }}
                              onClick={() => handleStatusChange(item.id, "verified")}
                              disabled={isPending}
                            >
                              Verify
                            </button>
                          )}
                          {(item.status === "open" || item.status === "in_progress") && (
                            <>
                              <button
                                className="btn-secondary"
                                style={{ fontSize: 11, padding: "6px 14px" }}
                                onClick={() =>
                                  handleStatusChange(item.id, "not_applicable")
                                }
                                disabled={isPending}
                              >
                                N/A
                              </button>
                              <button
                                className="btn-secondary"
                                style={{ fontSize: 11, padding: "6px 14px" }}
                                onClick={() =>
                                  handleStatusChange(item.id, "accepted_risk")
                                }
                                disabled={isPending}
                              >
                                Accept risk
                              </button>
                            </>
                          )}

                          {/* Add note */}
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              marginLeft: "auto",
                              alignItems: "center",
                            }}
                          >
                            <input
                              type="text"
                              placeholder="Add a note..."
                              value={expandedId === item.id ? noteText : ""}
                              onChange={(e) => setNoteText(e.target.value)}
                              className="input-brand"
                              style={{
                                fontSize: 12,
                                padding: "6px 10px",
                                width: 240,
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddNote(item.id);
                              }}
                            />
                            <button
                              className="btn-text"
                              style={{ fontSize: 11 }}
                              onClick={() => handleAddNote(item.id)}
                              disabled={isPending || !noteText.trim()}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Audit trail tab ───────────────────────────────────── */}
      {tab === "audit" && (
        <div>
          {audit.length === 0 ? (
            <div
              className="card-empty"
              style={{ padding: "40px 24px", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--empty-text)" }}>
                No audit entries yet. Actions on remediation items will appear
                here automatically.
              </div>
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--table-header)" }}>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "var(--label-text)",
                      }}
                    >
                      When
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "var(--label-text)",
                      }}
                    >
                      Action
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "var(--label-text)",
                      }}
                    >
                      Description
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "var(--label-text)",
                      }}
                    >
                      By
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "var(--label-text)",
                      }}
                    >
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr
                      key={entry.id}
                      style={{ borderBottom: "1px solid var(--bd)" }}
                    >
                      <td
                        style={{
                          padding: "10px 14px",
                          fontSize: 12,
                          color: "var(--sub)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatDateTime(entry.performed_at)}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>
                        <span style={{ marginRight: 6 }}>
                          {ACTION_ICONS[entry.action] || "•"}
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 11,
                            color: "var(--tx)",
                          }}
                        >
                          {entry.action.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontSize: 12,
                          color: "var(--tx)",
                          maxWidth: 400,
                        }}
                      >
                        {entry.description}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontSize: 12,
                          color: "var(--sub)",
                        }}
                      >
                        {entry.performed_by}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontSize: 11,
                          color: "var(--sub)",
                        }}
                      >
                        {entry.old_value && entry.new_value ? (
                          <span>
                            <span style={{ textDecoration: "line-through", opacity: 0.6 }}>
                              {entry.old_value}
                            </span>
                            {" → "}
                            <span style={{ fontWeight: 600, color: "var(--tx)" }}>
                              {entry.new_value}
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

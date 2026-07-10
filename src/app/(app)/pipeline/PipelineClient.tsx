"use client";

import { useState } from "react";
import type { PipelineOpportunity, DashboardStats } from "@/lib/data/pipeline";
import { createOpportunity, updateOpportunity } from "@/lib/data/pipeline";

// ─── Stage metadata ──────────────────────────────────────────────────────────

const STAGES = [
  { key: "identified",   label: "Identified",   color: "#8E9196" },
  { key: "qualified",    label: "Qualified",     color: "#3E6B8E" },
  { key: "proposal",     label: "Proposal",      color: "#C5A059" },
  { key: "negotiation",  label: "Negotiation",   color: "#8156A6" },
  { key: "won",          label: "Won",           color: "#2E7D32" },
  { key: "lost",         label: "Lost",          color: "#CC0000" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

function stageColor(stage: string): string {
  return STAGES.find((s) => s.key === stage.toLowerCase())?.color ?? "#8E9196";
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function gbp(n: number | null | undefined): string {
  if (n == null || n === 0) return "£0";
  return "£" + n.toLocaleString("en-GB");
}

// ─── Style constants ─────────────────────────────────────────────────────────

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

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ value, label, dashed }: { value: string; label: string; dashed?: boolean }) {
  return (
    <div
      style={{
        background: dashed ? "#F7F2E9" : "#fff",
        border: dashed ? "1px dashed #D9CDB4" : "1px solid #E4D9C4",
        borderRadius: 10,
        padding: "16px 18px",
        boxShadow: dashed ? "none" : "0 1px 3px rgba(26,28,30,.05)",
      }}
    >
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 26,
          fontWeight: 800,
          lineHeight: 1,
          color: dashed ? "#B9B2A2" : "#1A1C1E",
          fontVariantNumeric: "tabular-nums",
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.3,
          color: "#8E9196",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Stage card ──────────────────────────────────────────────────────────────

function StageCard({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        background: "#fff",
        border: "1px solid #E4D9C4",
        borderRadius: 9,
        padding: "14px 16px",
        boxShadow: "0 1px 3px rgba(26,28,30,.05)",
      }}
    >
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 22,
          fontWeight: 800,
          lineHeight: 1,
          color: count === 0 ? "#B9B2A2" : "#1A1C1E",
          fontVariantNumeric: "tabular-nums",
          marginBottom: 7,
        }}
      >
        {count}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.2,
            color: "#55524C",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Pill ────────────────────────────────────────────────────────────────────

function StagePill({ stage }: { stage: string }) {
  const c = stageColor(stage);
  return (
    <span
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".05em",
        color: c,
        background: c + "18",
        border: `1px solid ${c}40`,
        borderRadius: 20,
        padding: "4px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {stage}
    </span>
  );
}

// ─── Cross-module summary card ───────────────────────────────────────────────

function SummaryCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string; muted?: boolean }[];
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E4D9C4",
        borderRadius: 12,
        padding: "20px 22px",
        boxShadow: "0 1px 3px rgba(26,28,30,.05)",
      }}
    >
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 13.5,
          fontWeight: 700,
          lineHeight: 1.2,
          color: "#1A1C1E",
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "9px 0",
            borderBottom: i < rows.length - 1 ? "1px solid #F0E8D8" : "none",
          }}
        >
          <span
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1,
              color: r.muted ? "#9A968B" : "#55524C",
            }}
          >
            {r.label}
          </span>
          <span
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 12.5,
              fontWeight: 700,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: r.color ?? (r.muted ? "#B9B2A2" : "#1A1C1E"),
            }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Opportunity form modal ──────────────────────────────────────────────────

function OpportunityForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: PipelineOpportunity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      opportunity_name: fd.get("opportunity_name") as string,
      service_type: (fd.get("service_type") as string) || null,
      stage: fd.get("stage") as string,
      value_gbp: fd.get("value_gbp") ? Number(fd.get("value_gbp")) : null,
      value_recurring: fd.get("value_recurring") === "on",
      expected_close_date: (fd.get("expected_close_date") as string) || null,
      owner: (fd.get("owner") as string) || null,
      notes: (fd.get("notes") as string) || null,
    };

    const res = initial
      ? await updateOpportunity(initial.id, payload)
      : await createOpportunity(payload);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      onSaved();
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15,17,19,.45)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #E4D9C4",
          width: 500,
          maxHeight: "90vh",
          overflow: "auto",
          padding: "24px 28px",
          boxShadow: "0 8px 30px rgba(26,28,30,.15)",
        }}
      >
        <div
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 18,
            fontWeight: 800,
            color: "#1A1C1E",
            marginBottom: 20,
          }}
        >
          {initial ? "Edit opportunity" : "Add opportunity"}
        </div>
        {error && (
          <div
            style={{
              background: "#FDF2F2",
              border: "1px solid #FCA5A5",
              borderRadius: 8,
              padding: "9px 14px",
              marginBottom: 16,
              fontFamily: "Manrope, sans-serif",
              fontSize: 12,
              fontWeight: 500,
              color: "#CC0000",
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Opportunity name *
              </label>
              <input name="opportunity_name" required defaultValue={initial?.opportunity_name ?? ""} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Service type
              </label>
              <input name="service_type" defaultValue={initial?.service_type ?? ""} style={inputStyle} placeholder="e.g. Representative" />
            </div>
            <div>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Stage *
              </label>
              <select name="stage" required defaultValue={initial?.stage ?? "identified"} style={inputStyle}>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Value (GBP)
              </label>
              <input name="value_gbp" type="number" defaultValue={initial?.value_gbp ?? ""} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Expected close
              </label>
              <input name="expected_close_date" type="date" defaultValue={initial?.expected_close_date ?? ""} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Owner
              </label>
              <input name="owner" defaultValue={initial?.owner ?? ""} style={inputStyle} placeholder="e.g. nik@stza.io" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 18 }}>
              <input name="value_recurring" type="checkbox" defaultChecked={initial?.value_recurring ?? false} />
              <span style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 500, color: "#55524C" }}>Recurring value</span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8E9196", display: "block", marginBottom: 5 }}>
                Notes
              </label>
              <textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : initial ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PipelineClient({
  opportunities: initialOpportunities,
  stats,
}: {
  opportunities: PipelineOpportunity[];
  stats: DashboardStats | null;
}) {
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [showForm, setShowForm] = useState(false);
  const [editOpp, setEditOpp] = useState<PipelineOpportunity | undefined>();

  // Derived stats from actual data
  const totalOpps = opportunities.length;
  const totalValue = opportunities.reduce((s, o) => s + (o.value_gbp ?? 0), 0);
  const activeStages = ["identified", "qualified", "proposal", "negotiation"];
  const activeValue = opportunities
    .filter((o) => activeStages.includes(o.stage.toLowerCase()))
    .reduce((s, o) => s + (o.value_gbp ?? 0), 0);
  const wonCount = opportunities.filter((o) => o.stage.toLowerCase() === "won").length;

  // Stage counts
  const stageCounts: Record<string, number> = {};
  STAGES.forEach((s) => (stageCounts[s.key] = 0));
  opportunities.forEach((o) => {
    const k = o.stage.toLowerCase() as StageKey;
    if (k in stageCounts) stageCounts[k]++;
  });

  // Cross-module stats (from dashboard endpoint)
  const p = stats?.prospects;
  const c = stats?.clients;
  const content = stats?.content;

  const isDashed = totalOpps === 0;

  function handleSaved() {
    setShowForm(false);
    setEditOpp(undefined);
    // Reload page to get fresh data
    window.location.reload();
  }

  return (
    <div
      style={{
        maxWidth: 1320,
        margin: "0 auto",
        padding: "30px 26px 60px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          marginBottom: 22,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: "#B08D3F",
              marginBottom: 9,
            }}
          >
            AfricanSTN · Commercial
          </div>
          <h1
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 27,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-.02em",
              color: "#1A1C1E",
              margin: "0 0 5px",
            }}
          >
            Business development pipeline
          </h1>
          <p
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.4,
              color: "#8E9196",
              margin: 0,
            }}
          >
            Opportunities · revenue tracking · interactions.
          </p>
        </div>
        <button
          onClick={() => {
            setEditOpp(undefined);
            setShowForm(true);
          }}
          style={{ ...btnPrimary, flexShrink: 0 }}
        >
          + Add opportunity
        </button>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 22,
        }}
      >
        <StatCard value={String(totalOpps)} label="Pipeline opportunities" dashed={isDashed} />
        <StatCard value={gbp(totalValue)} label="Total value" dashed={isDashed} />
        <StatCard value={gbp(activeValue)} label="Active value" dashed={isDashed} />
        <StatCard value={String(wonCount)} label="Won" dashed={isDashed} />
      </div>

      {/* Stage breakdown */}
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#8E9196",
          marginBottom: 14,
        }}
      >
        Stage breakdown
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 26, flexWrap: "wrap" }}>
        {STAGES.map((s) => (
          <StageCard key={s.key} count={stageCounts[s.key] ?? 0} label={s.label} color={s.color} />
        ))}
      </div>

      {/* Opportunities table or empty state */}
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#8E9196",
          marginBottom: 14,
        }}
      >
        Opportunities
      </div>

      {opportunities.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px dashed #D9CDB4",
            borderRadius: 12,
            padding: "56px 24px",
            textAlign: "center",
            marginBottom: 26,
          }}
        >
          <div
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1.3,
              color: "#1A1C1E",
              marginBottom: 6,
            }}
          >
            No pipeline opportunities yet
          </div>
          <p
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              lineHeight: 1.5,
              color: "#8E9196",
              margin: "0 0 18px",
              maxWidth: 420,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Add an opportunity to track deal stages, values, expected close dates and interaction
            history against a prospect or client.
          </p>
          <button
            onClick={() => {
              setEditOpp(undefined);
              setShowForm(true);
            }}
            style={btnPrimary}
          >
            + Add your first opportunity
          </button>
        </div>
      ) : (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E4D9C4",
            borderRadius: 12,
            overflow: "hidden",
            marginBottom: 26,
            boxShadow: "0 1px 3px rgba(26,28,30,.05)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F6F1E7" }}>
                {["Opportunity", "Service", "Stage", "Value", "Close date", "Owner"].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "#8E9196",
                      textAlign: "left",
                      padding: "11px 16px",
                      borderBottom: "1px solid #E4D9C4",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp, i) => (
                <tr
                  key={opp.id}
                  onClick={() => {
                    setEditOpp(opp);
                    setShowForm(true);
                  }}
                  className="hover:!bg-[#FBF6EC]"
                  style={{
                    background: i % 2 === 0 ? "#FFFFFF" : "#FBF8F1",
                    cursor: "pointer",
                    borderBottom: "1px solid #F0E8D8",
                  }}
                >
                  <td
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#1A1C1E",
                      padding: "12px 16px",
                    }}
                  >
                    {opp.opportunity_name}
                  </td>
                  <td
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#55524C",
                      padding: "12px 16px",
                    }}
                  >
                    {opp.service_type ?? "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <StagePill stage={opp.stage} />
                  </td>
                  <td
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#1A1C1E",
                      fontVariantNumeric: "tabular-nums",
                      padding: "12px 16px",
                    }}
                  >
                    {gbp(opp.value_gbp)}
                    {opp.value_recurring && (
                      <span style={{ fontSize: 10, fontWeight: 500, color: "#8E9196", marginLeft: 4 }}>
                        /yr
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#55524C",
                      padding: "12px 16px",
                    }}
                  >
                    {opp.expected_close_date
                      ? new Date(opp.expected_close_date).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td
                    style={{
                      fontFamily: "Manrope, sans-serif",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#8E9196",
                      padding: "12px 16px",
                    }}
                  >
                    {opp.owner ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-module summary */}
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#8E9196",
          marginBottom: 14,
        }}
      >
        Cross-module summary
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <SummaryCard
          title="Compliance prospects"
          rows={[
            { label: "Total", value: String(p?.total ?? 0) },
            { label: "High priority", value: String(p?.high_priority ?? 0), color: "#B4432C" },
            { label: "Contacted", value: String(p?.contacted ?? 0) },
          ]}
        />
        <SummaryCard
          title="Clients"
          rows={[
            { label: "Total", value: String(c?.total ?? 0), muted: (c?.total ?? 0) === 0 },
            { label: "Active", value: String(c?.active ?? 0), muted: (c?.active ?? 0) === 0 },
            { label: "ARR", value: gbp(c?.arr ?? 0), muted: (c?.arr ?? 0) === 0 },
          ]}
        />
        <SummaryCard
          title="Content"
          rows={[
            { label: "Editions", value: String(content?.total ?? 0) },
            { label: "Published", value: String(content?.published ?? 0), muted: (content?.published ?? 0) === 0 },
            { label: "In progress", value: String(content?.in_progress ?? 0), color: (content?.in_progress ?? 0) > 0 ? "#A67514" : undefined },
          ]}
        />
      </div>

      {/* Form modal */}
      {showForm && (
        <OpportunityForm
          initial={editOpp}
          onClose={() => {
            setShowForm(false);
            setEditOpp(undefined);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

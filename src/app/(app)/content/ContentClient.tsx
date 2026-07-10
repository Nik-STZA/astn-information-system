"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Edition } from "@/lib/data/content";

/* ── Flag lookup (shared utility) ────────────────────────────────────────── */
import { flagUrl } from "@/lib/country-iso";

/* ── Status config ───────────────────────────────────────────────────────── */
type StatusMeta = { label: string; bg: string; text: string; border: string };
const STATUS_META: Record<string, StatusMeta> = {
  planned:     { label: "Planned",     bg: "#F0ECE3", text: "#8E9196", border: "#D9CDB4" },
  researching: { label: "Researching", bg: "#EBF0F5", text: "#3E6B8E", border: "#C0D1E0" },
  drafting:    { label: "Drafting",    bg: "#FBF1DE", text: "#A67514", border: "#EAD6A6" },
  draft:       { label: "Drafted",     bg: "#FBF1DE", text: "#A67514", border: "#EAD6A6" },
  drafted:     { label: "Drafted",     bg: "#FBF1DE", text: "#A67514", border: "#EAD6A6" },
  review:      { label: "Review",      bg: "#F0E8F5", text: "#8156A6", border: "#D4C0E8" },
  scheduled:   { label: "Scheduled",   bg: "#EBF0F5", text: "#3E6B8E", border: "#C0D1E0" },
  published:   { label: "Published",   bg: "#E8F5E9", text: "#2E7D32", border: "#B2DFBA" },
  archived:    { label: "Archived",    bg: "#F0ECE3", text: "#8E9196", border: "#D9CDB4" },
};

function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status, bg: "#F0ECE3", text: "#8E9196", border: "#D9CDB4" };
}

/* ── Props ───────────────────────────────────────────────────────────────── */
type Props = {
  editions: Edition[];
  error: string | null;
};

export default function ContentClient({ editions, error }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  /* Derived stats */
  const published = editions.filter((e) => e.status === "published").length;
  const inProgress = editions.filter((e) =>
    ["drafting", "draft", "drafted", "review", "researching"].includes(e.status)
  ).length;
  const totalWords = editions.reduce((sum, e) => sum + (e.word_count ?? 0), 0);

  return (
    <div style={{ fontFamily: "'Manrope', sans-serif" }}>
      {/* Breadcrumb + header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "#A29C8E", marginBottom: 8 }}>
          AfricanSTN <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span> Publishing
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 27, fontWeight: 800, color: "var(--tx)", margin: 0 }}>
            Content engine
          </h1>
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: "9px 20px",
              backgroundColor: "#C5A059",
              color: "#FFFFFF",
              fontSize: 13.5,
              fontWeight: 600,
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
            }}
          >
            + New edition
          </button>
        </div>
      </div>

      {/* Stat cards row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard label="Total editions" value={editions.length} />
        <StatCard label="Published" value={published} dashed muted />
        <StatCard label="In progress" value={inProgress} valueColor="#A67514" />
        <StatCard label="Total words" value={totalWords.toLocaleString("en-GB")} />
      </div>

      {/* Editions section */}
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", margin: 0 }}>Editions</h2>
      </div>

      {editions.length === 0 ? (
        <div style={{
          border: "1px dashed #D9CDB4",
          borderRadius: 14,
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "#F7F2E9",
          marginTop: 16,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2E7D32", marginBottom: 6 }}>
            No editions yet
          </div>
          <div style={{ fontSize: 12.5, color: "#A29C8E" }}>
            Create your first edition to start the content pipeline.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 16 }}>
          {editions.map((e) => (
            <EditionCard key={e.id} edition={e} />
          ))}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          marginTop: 24,
          padding: "14px 18px",
          backgroundColor: "#FEF2F2",
          border: "1px solid #FECACA",
          borderRadius: 12,
          color: "#CC0000",
          fontSize: 13,
        }}>
          <strong>API error:</strong> {error}
        </div>
      )}

      {/* New edition modal */}
      {showForm && (
        <EditionForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ── StatCard ────────────────────────────────────────────────────────────── */
function StatCard({
  label,
  value,
  dashed,
  muted,
  valueColor,
}: {
  label: string;
  value: number | string;
  dashed?: boolean;
  muted?: boolean;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: "18px 20px",
        border: dashed ? "1px dashed #D9CDB4" : "1px solid var(--bd)",
        backgroundColor: dashed ? "#F7F2E9" : "var(--pnl)",
      }}
    >
      <div
        style={{
          fontSize: 26,
          fontWeight: 800,
          color: muted ? "#B9B2A2" : valueColor ?? "var(--tx)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: muted ? "#B9B2A2" : "#A29C8E", marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

/* ── EditionCard ─────────────────────────────────────────────────────────── */
function EditionCard({ edition }: { edition: Edition }) {
  const sm = getStatusMeta(edition.status);
  const flag = flagUrl(edition.country_name);

  return (
    <a
      href={`/content/${edition.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRadius: 14,
        border: "1px solid var(--bd)",
        backgroundColor: "var(--pnl)",
        padding: "20px 22px 16px",
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 0.15s, box-shadow 0.15s",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#C5A059";
        e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.07)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--bd)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Top row: badge + pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#B08D3F",
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}>
          Edition #{edition.edition_number}
        </span>
        <span style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          backgroundColor: sm.bg,
          color: sm.text,
          border: `1px solid ${sm.border}`,
        }}>
          {sm.label}
        </span>
      </div>

      {/* Title + subtitle */}
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", lineHeight: 1.35, marginBottom: 4 }}>
        {edition.title}
      </div>
      {edition.subtitle && (
        <div style={{ fontSize: 12.5, fontWeight: 400, color: "#A29C8E", lineHeight: 1.4 }}>
          {edition.subtitle}
        </div>
      )}

      {/* Footer */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 14,
        paddingTop: 12,
        borderTop: "1px solid #F0E8D8",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {flag && (
            <img
              src={flag}
              alt=""
              style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
            />
          )}
          <span style={{ fontSize: 12, fontWeight: 500, color: "#A29C8E" }}>
            {edition.country_name ?? "—"}
          </span>
        </div>
        {edition.word_count != null && (
          <span style={{ fontSize: 12, fontWeight: 500, color: "#A29C8E" }}>
            {edition.word_count.toLocaleString("en-GB")} words
          </span>
        )}
      </div>
    </a>
  );
}

/* ── EditionForm modal ───────────────────────────────────────────────────── */
function EditionForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      series: (fd.get("series") as string) || "weekly",
      edition_number: Number(fd.get("edition_number")) || 1,
      title: fd.get("title") as string,
      subtitle: (fd.get("subtitle") as string) || null,
      country_name: (fd.get("country_name") as string) || null,
      status: (fd.get("status") as string) || "planned",
      target_publish_date: (fd.get("target_publish_date") as string) || null,
    };

    try {
      const res = await fetch("/api/proxy/content/editions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || res.statusText);
      }
      onSaved();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [onSaved]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--bd)",
    backgroundColor: "var(--pnl)",
    color: "var(--tx)",
    outline: "none",
    fontFamily: "'Manrope', sans-serif",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#A29C8E",
    marginBottom: 4,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        backgroundColor: "var(--pg)",
        borderRadius: 16,
        border: "1px solid var(--bd)",
        width: 520,
        maxHeight: "85vh",
        overflowY: "auto",
        padding: 28,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)", margin: 0 }}>New edition</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#A29C8E", cursor: "pointer" }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Series</label>
              <select name="series" defaultValue="weekly" style={inputStyle}>
                <option value="weekly">Weekly</option>
                <option value="special">Special</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Edition #</label>
              <input name="edition_number" type="number" min={1} defaultValue={1} style={inputStyle} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Title *</label>
            <input name="title" required style={inputStyle} placeholder="e.g. South Africa — POPIA compliance deep dive" />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Subtitle</label>
            <input name="subtitle" style={inputStyle} placeholder="Optional subtitle" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Country</label>
              <input name="country_name" style={inputStyle} placeholder="e.g. South Africa" />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select name="status" defaultValue="planned" style={inputStyle}>
                <option value="planned">Planned</option>
                <option value="researching">Researching</option>
                <option value="drafting">Drafting</option>
                <option value="review">Review</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Target publish date</label>
            <input name="target_publish_date" type="date" style={inputStyle} />
          </div>

          {formError && (
            <div style={{ marginBottom: 14, padding: "10px 14px", backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#CC0000", fontSize: 12.5 }}>
              {formError}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 20px",
                borderRadius: 10,
                border: "1px solid #D4C5A9",
                backgroundColor: "transparent",
                color: "#B08D3F",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "9px 20px",
                borderRadius: 10,
                border: "none",
                backgroundColor: "#C5A059",
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : "Create edition"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

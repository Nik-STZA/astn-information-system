"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import ResolutionPanel from "./ResolutionPanel";
import {
  loadRemediationBoardV2,
  generateBoardFromAssessment,
  updateRemediationStatusV2,
  loadResolutionV2,
  generateResolutionV2,
  saveResolutionV2,
  type RemediationBoardV2Loaded,
} from "./actions";
import type { RemediationV2Item } from "@/lib/data/remediation";

const SEV: Record<string, { fg: string; bg: string }> = {
  critical: { fg: "#CC0000", bg: "rgba(204,0,0,0.10)" },
  high: { fg: "#CC0000", bg: "rgba(204,0,0,0.10)" },
  medium: { fg: "#CC7700", bg: "rgba(204,119,0,0.10)" },
  low: { fg: "#8E9196", bg: "rgba(142,145,150,0.12)" },
};

const STATUSES = ["open", "in_progress", "resolved", "verified", "accepted_risk"];

const btn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 12px",
  borderRadius: 6,
  border: "1px solid var(--bd)",
  background: "var(--bg)",
  color: "var(--tx)",
  cursor: "pointer",
};

// V2 resolution actions injected into the shared ResolutionPanel.
const v2ResolutionActions = {
  load: loadResolutionV2,
  generate: generateResolutionV2,
  save: saveResolutionV2,
};

export default function RemediationV2Panel({ clientId }: { clientId: string }) {
  const [board, setBoard] = useState<RemediationBoardV2Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeJur, setActiveJur] = useState<string>("all");

  function reload() {
    return loadRemediationBoardV2(clientId).then((b) => {
      setBoard(b);
      setLoading(false);
    });
  }

  useEffect(() => {
    let live = true;
    loadRemediationBoardV2(clientId).then((b) => {
      if (live) {
        setBoard(b);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const items = board?.data ?? [];
  const shown = useMemo(
    () => (activeJur === "all" ? items : items.filter((i) => i.jurisdiction_code === activeJur)),
    [items, activeJur],
  );

  function generate(assessmentId: number) {
    startTransition(async () => {
      await generateBoardFromAssessment(clientId, assessmentId);
      await reload();
    });
  }
  function setStatus(id: number, status: string) {
    startTransition(async () => {
      await updateRemediationStatusV2(id, status);
      await reload();
    });
  }

  if (loading) return <div style={{ color: "var(--sub)", fontSize: 13, padding: 12 }}>Loading remediation…</div>;

  const assessments = board?.assessments ?? [];
  const jurs = board?.jurisdictions ?? [];

  return (
    <div>
      {/* Generate from each assessment (one per jurisdiction) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 16,
          padding: 12,
          border: "1px solid var(--bd)",
          borderRadius: 8,
          background: "var(--pnl)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--label-text)" }}>
          Generate from assessment
        </span>
        {assessments.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--sub)" }}>
            No completed assessment yet — run one on the Overview tab, then generate remediation here.
          </span>
        )}
        {assessments.map((a) => (
          <button key={a.id} onClick={() => generate(a.id)} disabled={busy} style={btn}>
            {busy ? "Working…" : `${a.jurisdiction} assessment`}
            {a.overall_score != null && (
              <span style={{ color: "var(--sub)", fontWeight: 400 }}> · {Math.round(Number(a.overall_score))}/100</span>
            )}
          </button>
        ))}
        <span style={{ fontSize: 10.5, color: "var(--sub)", flexBasis: "100%" }}>
          Reads the real dual-model assessment findings for that regime and rebuilds its board. Preserves any status you&apos;ve already set.
        </span>
      </div>

      {/* Jurisdiction tabs */}
      {jurs.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <JurChip label={`All (${items.length})`} active={activeJur === "all"} onClick={() => setActiveJur("all")} />
          {jurs.map((j) => (
            <JurChip
              key={j.jurisdiction_code}
              label={`${j.jurisdiction_name} (${j.total})`}
              active={activeJur === j.jurisdiction_code}
              onClick={() => setActiveJur(j.jurisdiction_code)}
            />
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ color: "var(--sub)", fontSize: 13, padding: "20px 12px", textAlign: "center", border: "1px dashed var(--bd)", borderRadius: 8 }}>
          No remediation items. Either no assessment has been generated into the board yet, or the assessment found no gaps for this regime.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onStatus={(s) => setStatus(item.id, s)}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JurChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        padding: "5px 12px",
        borderRadius: 16,
        border: active ? "1px solid #C5A059" : "1px solid var(--bd)",
        background: active ? "rgba(197,160,89,0.14)" : "var(--bg)",
        color: "var(--tx)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ItemRow({
  item,
  expanded,
  onToggle,
  onStatus,
  busy,
}: {
  item: RemediationV2Item;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (s: string) => void;
  busy: boolean;
}) {
  const sev = SEV[item.severity || "low"] || SEV.low;
  return (
    <div style={{ border: "1px solid var(--bd)", borderRadius: 8, background: "var(--bg)" }}>
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, color: sev.fg, background: sev.bg }}>
          {item.severity}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, border: "1px solid var(--gold-border, #D4C5A9)", color: "var(--tx)" }}>
          {item.jurisdiction_name || item.jurisdiction_code}
        </span>
        {item.legal_reference && (
          <span style={{ fontSize: 11, color: "var(--sub)", fontWeight: 600 }}>{item.legal_reference}</span>
        )}
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--tx)", flex: 1, minWidth: 180 }}>{item.title}</span>
        <span style={{ fontSize: 11, color: "var(--sub)", textTransform: "capitalize" }}>{item.status.replace(/_/g, " ")}</span>
        {item.finding_status && (
          <span style={{ fontSize: 10.5, color: item.finding_status === "absent" ? "#CC0000" : "#CC7700" }}>
            {item.finding_status === "absent" ? "gap" : "partial"}
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--bd)" }}>
          {item.description && (
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--tx)", margin: "12px 0" }}>{item.description}</p>
          )}
          {item.recommendation && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--label-text)", marginBottom: 4 }}>
                Recommendation
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--tx)", margin: 0 }}>{item.recommendation}</p>
            </div>
          )}

          {/* The dual-model resolution — same panel as V1, wired to /api/v2 endpoints */}
          <ResolutionPanel itemId={item.id} actions={v2ResolutionActions} />

          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--label-text)" }}>
              Status
            </span>
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onStatus(s)}
                disabled={busy || s === item.status}
                style={{
                  fontSize: 11,
                  fontWeight: s === item.status ? 700 : 500,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: s === item.status ? "1px solid #C5A059" : "1px solid var(--bd)",
                  background: s === item.status ? "rgba(197,160,89,0.14)" : "var(--bg)",
                  color: "var(--tx)",
                  cursor: s === item.status ? "default" : "pointer",
                  textTransform: "capitalize",
                }}
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

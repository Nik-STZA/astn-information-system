"use client";

import { useEffect, useState, useTransition } from "react";
import { loadResolution, generateResolution, saveResolution } from "./actions";
import type { RemediationResolution } from "@/lib/data/remediation";

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
const primaryBtn: React.CSSProperties = {
  ...btn,
  border: "1px solid #C5A059",
  background: "#C5A059",
  color: "#1A1C1E",
};

export default function ResolutionPanel({ itemId }: { itemId: number }) {
  const [res, setRes] = useState<RemediationResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let live = true;
    loadResolution(itemId).then((r) => {
      if (live) {
        setRes(r);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [itemId]);

  function generate() {
    startTransition(async () => {
      const r = await generateResolution(itemId);
      if (r) setRes(r);
    });
  }
  function approve() {
    startTransition(async () => {
      const r = await saveResolution(itemId, { status: "confirmed" });
      if (r) setRes(r);
    });
  }
  function saveEdit() {
    startTransition(async () => {
      const r = await saveResolution(itemId, { resolution: draft, status: "confirmed" });
      if (r) setRes(r);
      setEditing(false);
    });
  }

  if (loading) return null;

  const badge =
    res?.agreement === "agreed"
      ? { t: "✓ Both models agree", bg: "rgba(46,125,50,0.12)", fg: "#2E7D32" }
      : res?.agreement === "flagged"
        ? { t: "⚑ Models differ — review", bg: "rgba(204,119,0,0.12)", fg: "#CC7700" }
        : null;

  return (
    <div
      style={{
        marginBottom: 14,
        border: "1px solid var(--bd)",
        borderRadius: 8,
        padding: 12,
        background: "var(--pnl)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--label-text)" }}>
          Resolution — AI-generated, dual-model verified
        </div>
        {badge && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12, background: badge.bg, color: badge.fg }}>
            {badge.t}
          </span>
        )}
      </div>

      {!res ? (
        <div>
          <button onClick={generate} disabled={busy} style={primaryBtn}>
            {busy ? "Generating (Gemini + Claude)…" : "Generate resolution"}
          </button>
          <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 6 }}>
            Reads this client&apos;s actual document, drafts a concrete cited fix, and cross-checks it across two independent models.
          </div>
        </div>
      ) : editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            style={{ width: "100%", fontSize: 12.5, lineHeight: 1.55, padding: 10, borderRadius: 6, border: "1px solid var(--bd)", background: "var(--bg)", color: "var(--tx)", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={saveEdit} disabled={busy} style={primaryBtn}>Save &amp; approve</button>
            <button onClick={() => setEditing(false)} style={btn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--tx)", whiteSpace: "pre-wrap" }}>
            {res.resolution}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--sub)", textTransform: "capitalize" }}>status: {res.status.replace(/_/g, " ")}</span>
            {res.status !== "confirmed" && res.status !== "applied" && (
              <button onClick={approve} disabled={busy} style={primaryBtn}>Approve</button>
            )}
            <button onClick={() => { setDraft(res.resolution || ""); setEditing(true); }} style={btn}>Edit</button>
            <button onClick={generate} disabled={busy} style={btn}>{busy ? "…" : "Regenerate"}</button>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 8 }}>
            Draft for your review — not client-facing until you approve. Regulatory-lens; client obtains their own legal sign-off.
          </div>
        </div>
      )}
    </div>
  );
}

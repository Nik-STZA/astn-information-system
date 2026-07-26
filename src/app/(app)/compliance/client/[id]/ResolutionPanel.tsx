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

// Split the composed resolution into its sections for distinct styling.
function parseResolution(text: string) {
  let rest = text || "";
  let reviewNote: string | null = null;
  const rev = rest.match(/^REVIEW:\s*([\s\S]+?)(?:\n\n|$)/);
  if (rev) {
    reviewNote = rev[1].trim();
    rest = rest.slice(rev[0].length);
  }
  let citations: string[] = [];
  const cit = rest.match(/\n\nCitations:\s*([\s\S]+)$/);
  if (cit) {
    citations = cit[1].split(",").map((s) => s.trim()).filter(Boolean);
    rest = rest.slice(0, rest.length - cit[0].length);
  }
  let redraft: string | null = null;
  const rd = rest.match(/\n\nSuggested redraft[^\n]*:\n([\s\S]+)$/);
  if (rd) {
    redraft = rd[1].trim();
    rest = rest.slice(0, rest.length - rd[0].length);
  }
  let gaps: string[] = [];
  const gp = rest.match(/\n\nGaps:\n([\s\S]+)$/);
  if (gp) {
    gaps = gp[1].split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    rest = rest.slice(0, rest.length - gp[0].length);
  }
  return { reviewNote, summary: rest.trim(), gaps, redraft, citations };
}

function ResolutionBody({ text }: { text: string }) {
  const p = parseResolution(text);
  const label: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 5,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {p.reviewNote && (
        <div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 6, background: "rgba(204,119,0,0.1)", color: "#CC7700", border: "1px solid rgba(204,119,0,0.25)" }}>
          {p.reviewNote}
        </div>
      )}
      {p.summary && (
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--tx)" }}>{p.summary}</div>
      )}
      {p.gaps.length > 0 && (
        <div>
          <div style={{ ...label, color: "var(--label-text)" }}>Gaps &amp; enhancements</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
            {p.gaps.map((g, i) => {
              const m = g.match(/^\[(Statutory|Enhancement)\]\s*(.*)$/i);
              const kind = m ? m[1].toLowerCase() : null;
              const text = m ? m[2] : g;
              const tag =
                kind === "statutory"
                  ? { t: "Statutory", fg: "#CC0000", bg: "rgba(204,0,0,0.10)" }
                  : kind === "enhancement"
                    ? { t: "Enhancement", fg: "#CC7700", bg: "rgba(204,119,0,0.10)" }
                    : null;
              return (
                <li key={i} style={{ fontSize: 12, lineHeight: 1.55, color: "var(--tx)" }}>
                  {tag && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 4, marginRight: 6, color: tag.fg, background: tag.bg }}>
                      {tag.t}
                    </span>
                  )}
                  {text}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {p.redraft && (
        <div style={{ borderLeft: "3px solid #C5A059", background: "rgba(197,160,89,0.07)", borderRadius: "0 6px 6px 0", padding: "10px 12px" }}>
          <div style={{ ...label, color: "#C5A059" }}>Suggested redraft — pending client legal review</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--tx)", whiteSpace: "pre-wrap" }}>{p.redraft}</div>
        </div>
      )}
      {p.citations.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ ...label, color: "var(--label-text)", marginBottom: 0, marginRight: 2 }}>Cites</span>
          {p.citations.map((c, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, border: "1px solid var(--gold-border, #D4C5A9)", color: "var(--tx)", background: "var(--bg)" }}>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Actions are injectable so the same panel drives both the legacy board and the V2
// jurisdiction-native board (which hits /api/v2/... endpoints). Defaults to V1.
type ResolutionActions = {
  load: (id: number) => Promise<RemediationResolution | null>;
  generate: (id: number) => Promise<RemediationResolution | null>;
  save: (id: number, patch: { resolution?: string; status?: string }) => Promise<RemediationResolution | null>;
};

export default function ResolutionPanel({
  itemId,
  actions,
}: {
  itemId: number;
  actions?: ResolutionActions;
}) {
  const A: ResolutionActions =
    actions ?? { load: loadResolution, generate: generateResolution, save: saveResolution };
  const [res, setRes] = useState<RemediationResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let live = true;
    A.load(itemId).then((r) => {
      if (live) {
        setRes(r);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  function generate() {
    startTransition(async () => {
      const r = await A.generate(itemId);
      if (r) setRes(r);
    });
  }
  function approve() {
    startTransition(async () => {
      const r = await A.save(itemId, { status: "confirmed" });
      if (r) setRes(r);
    });
  }
  function saveEdit() {
    startTransition(async () => {
      const r = await A.save(itemId, { resolution: draft, status: "confirmed" });
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
          <ResolutionBody text={res.resolution || ""} />
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

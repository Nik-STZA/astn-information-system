"use client";

import { useEffect, useRef, useState } from "react";
import type { LinkedInDraft } from "@/lib/data/content";
import { validateLinkedInPost } from "@/lib/linkedin-spec";
import { loadDrafts, saveDraft, generateLinkedIn, linkedinStatus } from "./actions";

function GenerateButton({ onGenerated }: { onGenerated: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function run() {
    setState("running");
    setMsg("Generating from the latest brief…");
    const res = await generateLinkedIn();
    if (res.error) {
      setState("error");
      setMsg(res.error.includes("not configured") ? "GitHub dispatch token pending." : res.error);
      return;
    }
    pollRef.current = setInterval(async () => {
      const s = await linkedinStatus();
      if (s.data?.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setState("idle");
        setMsg(s.data.conclusion === "success" ? "Draft ready below." : "Generation failed — see GitHub.");
        if (s.data.conclusion === "success") onGenerated();
      }
    }, 15000);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {msg && <span style={{ fontSize: 11.5, color: state === "error" ? "var(--alert-red)" : "var(--sub)" }}>{msg}</span>}
      <button
        onClick={run}
        disabled={state === "running"}
        style={{ fontWeight: 700, fontSize: 12, padding: "8px 18px", borderRadius: 6, border: "none", background: "#C5A059", color: "#141414", cursor: "pointer", opacity: state === "running" ? 0.6 : 1 }}
      >
        {state === "running" ? "Generating…" : "Generate LinkedIn post"}
      </button>
    </div>
  );
}

function DraftEditor({ draft, onSaved }: { draft: LinkedInDraft; onSaved: () => void }) {
  const [text, setText] = useState(draft.edited_text ?? draft.post_text);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [saved, setSaved] = useState(false);
  const v = validateLinkedInPost(text);

  async function persist(status?: "approved") {
    setBusy(status ? "approve" : "save");
    const res = await saveDraft(draft.id, { edited_text: text, ...(status ? { status } : {}) });
    setBusy(null);
    if (!res.error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (status) onSaved();
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18, alignItems: "start" }}>
      {/* Editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
            Post {draft.week_ending ? `— w/e ${draft.week_ending}` : ""}
          </span>
          <span style={{ fontSize: 11.5, color: v.charCount <= 3000 ? "var(--sub)" : "var(--alert-red)", fontVariantNumeric: "tabular-nums" }}>
            {v.charCount} chars · {v.wordCount} words
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          style={{ fontSize: 13, lineHeight: 1.6, padding: "14px 16px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", resize: "vertical", fontFamily: "inherit", whiteSpace: "pre-wrap" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => persist()}
            disabled={busy !== null}
            style={{ fontWeight: 600, fontSize: 12, padding: "7px 16px", borderRadius: 6, border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", cursor: "pointer" }}
          >
            {busy === "save" ? "Saving…" : "Save edits"}
          </button>
          <button
            onClick={() => persist("approved")}
            disabled={busy !== null || !v.ready}
            title={v.ready ? "Approve for posting" : "Fix the hard checks first"}
            style={{ fontWeight: 700, fontSize: 12, padding: "7px 18px", borderRadius: 6, border: "none", background: v.ready ? "var(--success-green)" : "var(--bd)", color: v.ready ? "#fff" : "var(--sub)", cursor: v.ready ? "pointer" : "not-allowed" }}
          >
            {busy === "approve" ? "Approving…" : draft.status === "approved" ? "Approved ✓" : "Approve"}
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(text); }}
            style={{ fontWeight: 600, fontSize: 12, padding: "7px 12px", borderRadius: 6, border: "none", background: "transparent", color: "var(--gold-dark)", cursor: "pointer" }}
          >
            Copy
          </button>
          {saved && <span style={{ fontSize: 11.5, color: "var(--success-green)" }}>Saved</span>}
        </div>
      </div>

      {/* Live spec validation */}
      <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>Spec check</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: v.ready ? "var(--success-green)" : "var(--warning-amber)" }}>
            {v.ready ? "Postable" : "Not ready"}
          </span>
        </div>
        {v.checks.map((c) => (
          <div key={c.label} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ fontSize: 13, color: c.pass ? "var(--success-green)" : c.hard ? "var(--alert-red)" : "var(--warning-amber)", width: 14 }}>
              {c.pass ? "✓" : c.hard ? "✗" : "!"}
            </span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 12, color: "var(--tx)" }}>
                {c.label}
                {!c.hard && <span style={{ color: "var(--sub)", fontSize: 10.5 }}> (guide)</span>}
              </span>
              <span style={{ fontSize: 11, color: "var(--sub)" }}>{c.detail}</span>
            </div>
          </div>
        ))}
        <p style={{ fontSize: 10.5, color: "var(--empty-text)", margin: "4px 0 0", lineHeight: 1.4 }}>
          Hard checks (✗) block approval. Guides (!) are quality signals from the post spec.
        </p>
      </div>
    </div>
  );
}

export default function LinkedInClient({ initialDrafts }: { initialDrafts: LinkedInDraft[] }) {
  const [drafts, setDrafts] = useState<LinkedInDraft[]>(initialDrafts);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function refresh() {
    const res = await loadDrafts();
    setDrafts(res.data?.data ?? []);
  }

  const latest = drafts[0];

  function fmtWeek(d: LinkedInDraft) {
    return d.week_ending
      ? new Date(d.week_ending).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : new Date(d.created_at).toLocaleDateString("en-GB");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <GenerateButton onGenerated={refresh} />
      </div>

      {!latest ? (
        <div style={{ padding: "48px 20px", textAlign: "center", border: "1.5px dashed var(--empty-border)", borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--sub)", marginBottom: 4 }}>No LinkedIn drafts yet</div>
          <div style={{ fontWeight: 500, fontSize: 12.5, color: "var(--empty-text)" }}>
            Generate one from the latest weekly brief above.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
            This week
          </div>
          <DraftEditor key={latest.id} draft={latest} onSaved={refresh} />
        </div>
      )}

      {/* Every earlier week is its own expandable section, newest first. */}
      {drafts.length > 1 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
            Earlier weeks
          </div>
          {drafts.slice(1).map((d) => {
            const open = expandedId === d.id;
            return (
              <div key={d.id} style={{ border: "1px solid var(--bd)", borderRadius: 8, overflow: "hidden", background: "var(--pnl)" }}>
                <button
                  onClick={() => setExpandedId(open ? null : d.id)}
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", background: open ? "var(--table-header)" : "transparent", border: "none", cursor: "pointer" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "var(--sub)", fontSize: 12, width: 12 }}>{open ? "▾" : "▸"}</span>
                    <span style={{ color: "var(--tx)", fontSize: 13, fontWeight: 600 }}>w/e {fmtWeek(d)}</span>
                    <span style={{ color: "var(--sub)", fontSize: 11.5 }}>{d.char_count ?? "?"} chars</span>
                  </span>
                  <span style={{ color: d.status === "approved" ? "var(--success-green)" : d.status === "posted" ? "var(--gold-dark)" : "var(--sub)", fontSize: 11.5, fontWeight: 600, textTransform: "capitalize" }}>{d.status}</span>
                </button>
                {open && (
                  <div style={{ padding: "14px 16px", borderTop: "1px solid var(--bd)" }}>
                    <DraftEditor key={d.id} draft={d} onSaved={refresh} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

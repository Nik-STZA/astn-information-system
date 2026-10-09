"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LinkedInDraft } from "@/lib/data/content";
import { validateLinkedInPost } from "@/lib/linkedin-spec";
import { loadDrafts, saveDraft, publishDraft, generateEdition, editionStatus } from "./actions";

function GenerateButton({ onGenerated }: { onGenerated: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function run() {
    setState("running");
    setRunUrl(null);
    setMsg("Building this week's draft brief and post…");
    const res = await generateEdition();
    if (res.error) {
      setState("error");
      setMsg(res.error.includes("not configured") ? "GitHub dispatch token pending." : res.error);
      return;
    }
    pollRef.current = setInterval(async () => {
      const s = await editionStatus();
      if (s.data?.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setState("idle");
        setRunUrl(s.data.html_url ?? null);
        setMsg(s.data.conclusion === "success"
          ? "Draft ready below."
          : "No draft produced — held (already published, or nothing approved) or failed.");
        if (s.data.conclusion === "success") onGenerated();
      }
    }, 15000);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {msg && <span style={{ fontSize: 11.5, color: state === "error" ? "var(--alert-red)" : "var(--sub)" }}>{msg}</span>}
      {runUrl && <a href={runUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--gold-dark)" }}>Run log</a>}
      <button
        onClick={run}
        disabled={state === "running"}
        style={{ fontWeight: 700, fontSize: 12, padding: "8px 18px", borderRadius: 6, border: "none", background: "#C5A059", color: "#141414", cursor: "pointer", opacity: state === "running" ? 0.6 : 1 }}
      >
        {state === "running" ? "Generating…" : "Generate draft edition"}
      </button>
    </div>
  );
}

function DraftEditor({ draft, onSaved }: { draft: LinkedInDraft; onSaved: () => void }) {
  const [text, setText] = useState(draft.edited_text ?? draft.post_text);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [saved, setSaved] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const v = validateLinkedInPost(text);
  // Approving the post is the week's single sign-off: while the brief is a
  // draft, it also publishes the brief to africanstn.com.
  const publishes = draft.brief_status === "draft";

  async function persist() {
    setBusy("save");
    const res = await saveDraft(draft.id, { edited_text: text });
    setBusy(null);
    if (!res.error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function approve() {
    if (publishes && !window.confirm(
      `Approve this post and publish the w/e ${draft.week_ending ?? ""} brief to africanstn.com? The week is then locked.`,
    )) return;
    setBusy("approve");
    setOutcome(null);
    const res = await publishDraft(draft.id, text);
    setBusy(null);
    if (res.error || !res.data) {
      setOutcome({ ok: false, text: res.error ?? "Approval failed" });
      return;
    }
    const r = res.data;
    const site =
      r.site_rebuild === "triggered" ? "site rebuild started"
      : r.site_rebuild === "not_configured" ? "site rebuild NOT configured — trigger a Netlify deploy by hand"
      : r.site_rebuild === "not_needed" ? ""
      : `site rebuild ${r.site_rebuild} — trigger a Netlify deploy by hand`;
    setOutcome({
      ok: r.site_rebuild === "triggered" || r.site_rebuild === "not_needed",
      text: r.published
        ? `Published w/e ${r.week_ending ?? ""} · ${r.items_reported} items marked used · ${site}`
        : "Post approved (brief was already published).",
    });
    onSaved();
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
            onClick={approve}
            disabled={busy !== null || !v.ready || draft.status === "approved"}
            title={!v.ready ? "Fix the hard checks first" : publishes ? "Approve the post and publish the brief to the site" : "Approve for posting"}
            style={{ fontWeight: 700, fontSize: 12, padding: "7px 18px", borderRadius: 6, border: "none", background: v.ready ? "var(--success-green)" : "var(--bd)", color: v.ready ? "#fff" : "var(--sub)", cursor: v.ready ? "pointer" : "not-allowed" }}
          >
            {busy === "approve" ? "Publishing…" : draft.status === "approved" ? "Approved ✓" : publishes ? "Approve & publish" : "Approve"}
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(text); }}
            style={{ fontWeight: 600, fontSize: 12, padding: "7px 12px", borderRadius: 6, border: "none", background: "transparent", color: "var(--gold-dark)", cursor: "pointer" }}
          >
            Copy
          </button>
          {saved && <span style={{ fontSize: 11.5, color: "var(--success-green)" }}>Saved</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
          Brief:{" "}
          <span style={{ fontWeight: 600, color: draft.brief_status === "published" ? "var(--success-green)" : "var(--warning-amber)" }}>
            {draft.brief_status === "published" ? "Published" : draft.brief_status === "draft" ? "Draft — not on the site yet" : "Not linked"}
          </span>
          {draft.brief_item_count != null && <> · {draft.brief_item_count} items</>}
          {draft.brief_id && <> · <Link href={`/content/briefs/${draft.brief_id}`} style={{ color: "var(--gold-dark)" }}>View brief</Link></>}
        </div>
        {outcome && (
          <div style={{ fontSize: 12, color: outcome.ok ? "var(--success-green)" : "var(--alert-red)" }}>{outcome.text}</div>
        )}
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
            Generate this week&apos;s draft edition above.
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auditBrief } from "@/lib/brief-audit";
import { parseBriefMarkdown, rebuildBriefMarkdown, countStories, type ParsedBrief, type BriefStory } from "@/lib/brief-items";
import { markdownToHtml } from "@/lib/markdown";
import { saveBrief, regeneratePost, regeneratePostStatus } from "./actions";

/**
 * Draft brief editor: edit the markdown, see the fact-discipline audit live,
 * save, then redraft the LinkedIn post from the edited brief. Publishing stays
 * on the LinkedIn page (Approve & publish), so the post and the brief always
 * go out together.
 *
 * Now includes an Items panel for toggling/reordering stories post-generation.
 */
export default function BriefEditor({ id, initialMarkdown }: { id: string; initialMarkdown: string }) {
  const [text, setText] = useState(initialMarkdown);
  const [savedText, setSavedText] = useState(initialMarkdown);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [rightPanel, setRightPanel] = useState<"audit" | "items">("audit");
  const [busy, setBusy] = useState<"save" | "post" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const audit = useMemo(() => auditBrief(text), [text]);
  const parsed = useMemo(() => parseBriefMarkdown(text), [text]);
  const storyCount = useMemo(() => countStories(parsed), [parsed]);
  const dirty = text !== savedText;

  // Item toggle — flip the included flag and rebuild markdown
  const toggleItem = useCallback((storyId: string) => {
    const updated: ParsedBrief = {
      ...parsed,
      sections: parsed.sections.map((sec) => ({
        ...sec,
        stories: sec.stories.map((s) =>
          s.id === storyId ? { ...s, included: !s.included } : s
        ),
      })),
    };
    setText(rebuildBriefMarkdown(updated));
  }, [parsed]);

  // Move a story within its section
  const moveItem = useCallback((storyId: string, direction: "up" | "down") => {
    const updated: ParsedBrief = {
      ...parsed,
      sections: parsed.sections.map((sec) => {
        const idx = sec.stories.findIndex((s) => s.id === storyId);
        if (idx === -1) return sec;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= sec.stories.length) return sec;
        const newStories = [...sec.stories];
        [newStories[idx], newStories[targetIdx]] = [newStories[targetIdx], newStories[idx]];
        return { ...sec, stories: newStories };
      }),
    };
    setText(rebuildBriefMarkdown(updated));
  }, [parsed]);

  async function save() {
    setBusy("save");
    setMsg(null);
    const res = await saveBrief(id, text);
    setBusy(null);
    if (res.error) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setSavedText(text);
    setMsg({ ok: true, text: "Saved. Redraft the LinkedIn post so it matches the edited brief." });
  }

  async function redraftPost() {
    if (dirty) {
      setMsg({ ok: false, text: "Save the brief first." });
      return;
    }
    setBusy("post");
    setMsg({ ok: true, text: "Redrafting the LinkedIn post from this brief…" });
    const res = await regeneratePost();
    if (res.error) {
      setBusy(null);
      setMsg({ ok: false, text: res.error });
      return;
    }
    pollRef.current = setInterval(async () => {
      const s = await regeneratePostStatus();
      if (s.data?.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setBusy(null);
        setMsg(s.data.conclusion === "success"
          ? { ok: true, text: "New LinkedIn draft ready - review and Approve & publish on the LinkedIn page." }
          : { ok: false, text: "Redraft failed - see the run log on GitHub." });
      }
    }, 15000);
  }

  const btn = { fontWeight: 600, fontSize: 12, padding: "7px 16px", borderRadius: 6, cursor: "pointer" } as const;
  const panelBtn = (active: boolean) => ({
    ...btn,
    border: "1px solid var(--bd)",
    background: active ? "var(--table-header)" : "transparent",
    color: "var(--tx)",
    fontSize: 11,
    padding: "5px 12px",
  } as const);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{ ...btn, border: "1px solid var(--bd)", background: mode === m ? "var(--table-header)" : "transparent", color: "var(--tx)", textTransform: "capitalize" }}
            >
              {m}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            onClick={save}
            disabled={busy !== null || !dirty}
            style={{ ...btn, border: "none", background: dirty ? "#C5A059" : "var(--bd)", color: dirty ? "#141414" : "var(--sub)", fontWeight: 700 }}
          >
            {busy === "save" ? "Saving…" : dirty ? "Save brief" : "Saved"}
          </button>
          <button
            onClick={redraftPost}
            disabled={busy !== null}
            style={{ ...btn, border: "1px solid var(--bd)", background: "transparent", color: "var(--gold-dark)" }}
          >
            {busy === "post" ? "Redrafting…" : "Redraft LinkedIn post"}
          </button>
        </div>
        {msg && <div style={{ fontSize: 12, color: msg.ok ? "var(--success-green)" : "var(--alert-red)" }}>{msg.text}</div>}
        {mode === "edit" ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={34}
            spellCheck
            style={{ fontSize: 12.5, lineHeight: 1.6, padding: "14px 16px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", resize: "vertical", fontFamily: "ui-monospace, Menlo, Consolas, monospace", whiteSpace: "pre-wrap" }}
          />
        ) : (
          <article
            className="brief-prose"
            style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "20px 24px", fontSize: 13.5, lineHeight: 1.65, color: "var(--tx)" }}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
          />
        )}
        <p style={{ fontSize: 11, color: "var(--empty-text)", margin: 0 }}>
          Publishing happens on the <Link href="/content/linkedin" style={{ color: "var(--gold-dark)" }}>LinkedIn page</Link>: Approve &amp; publish puts this brief and its post out together.
        </p>
      </div>

      {/* Right panel: toggle between Fact check and Items */}
      <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
          <button onClick={() => setRightPanel("audit")} style={panelBtn(rightPanel === "audit")}>Fact check</button>
          <button onClick={() => setRightPanel("items")} style={panelBtn(rightPanel === "items")}>
            Items{storyCount.total > 0 && ` (${storyCount.included}/${storyCount.total})`}
          </button>
        </div>

        {rightPanel === "audit" ? (
          <AuditPanel audit={audit} />
        ) : (
          <ItemsPanel parsed={parsed} onToggle={toggleItem} onMove={moveItem} />
        )}
      </div>
    </div>
  );
}

/* ── Audit panel (extracted from original) ─────────────────────────────── */

function AuditPanel({ audit }: { audit: ReturnType<typeof auditBrief> }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>Fact check</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: audit.warnings.length ? "var(--warning-amber)" : "var(--success-green)" }}>
          {audit.stories} stories · {audit.warnings.length ? `${audit.warnings.length} to review` : "clean"}
        </span>
      </div>
      {audit.warnings.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          Stories are facts only and The Week in Context is observation only - no speculation, hedging, advice or ideas found.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "70vh", overflowY: "auto" }}>
          {audit.warnings.map((w, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 11, color: "var(--sub)" }}>{w.where}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warning-amber)" }}>{w.problem}</span>
              <span style={{ fontSize: 11.5, color: "var(--tx)" }}>&ldquo;{w.text}&rdquo;</span>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10.5, color: "var(--empty-text)", margin: 0, lineHeight: 1.4 }}>
        Flags, not blocks. Stories state only what the source says. No advice, opportunities or product ideas anywhere - that is STZA&apos;s paid work. Each context bullet links two or more of this week&apos;s stories.
      </p>
    </>
  );
}

/* ── Items panel ───────────────────────────────────────────────────────── */

function ItemsPanel({
  parsed,
  onToggle,
  onMove,
}: {
  parsed: ParsedBrief;
  onToggle: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
}) {
  const storySections = parsed.sections.filter((s) => !s.isContextSection && s.stories.length > 0);

  if (storySections.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--sub)" }}>
        No parseable story items found. Stories use <code>### </code> headings under <code>## </code> section headings.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "70vh", overflowY: "auto" }}>
      {storySections.map((section) => (
        <div key={section.id}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--sub)", marginBottom: 6 }}>
            {section.heading}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {section.stories.map((story, idx) => (
              <StoryRow
                key={story.id}
                story={story}
                isFirst={idx === 0}
                isLast={idx === section.stories.length - 1}
                onToggle={() => onToggle(story.id)}
                onMoveUp={() => onMove(story.id, "up")}
                onMoveDown={() => onMove(story.id, "down")}
              />
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 10.5, color: "var(--empty-text)", margin: 0, lineHeight: 1.4 }}>
        Exclude items or reorder within a section. Changes update the markdown immediately. Save when done.
      </p>
    </div>
  );
}

function StoryRow({
  story,
  isFirst,
  isLast,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  story: BriefStory;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const arrowBtn = {
    background: "none",
    border: "none",
    padding: "0 2px",
    fontSize: 13,
    cursor: "pointer",
    color: "var(--sub)",
    lineHeight: 1,
  } as const;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        background: story.included ? "transparent" : "var(--pg)",
        opacity: story.included ? 1 : 0.5,
        border: "1px solid transparent",
      }}
    >
      <input
        type="checkbox"
        checked={story.included}
        onChange={onToggle}
        style={{ marginTop: 2, accentColor: "var(--gold-dark)", cursor: "pointer" }}
      />
      <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4, color: "var(--tx)", textDecoration: story.included ? "none" : "line-through" }}>
        {story.headline}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          style={{ ...arrowBtn, opacity: isFirst ? 0.25 : 1 }}
          title="Move up"
        >
          &#9650;
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          style={{ ...arrowBtn, opacity: isLast ? 0.25 : 1 }}
          title="Move down"
        >
          &#9660;
        </button>
      </div>
    </div>
  );
}

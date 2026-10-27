"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auditBrief } from "@/lib/brief-audit";
import {
  parseBriefMarkdown,
  rebuildBriefMarkdown,
  countStories,
  mergeExcluded,
  type ParsedBrief,
  type BriefStory,
  type StoryTone,
} from "@/lib/brief-items";
import { markdownToHtml } from "@/lib/markdown";
import { saveBrief, regeneratePost, regeneratePostStatus, loadApprovedPool, rewriteStoryAction, rewriteContextAction, loadBriefVersions, loadBriefVersion } from "./actions";
import type { ReviewItem, BriefVersion } from "@/lib/data/content";

/**
 * Draft brief editor: edit the markdown, see the fact-discipline audit live,
 * save, then redraft the LinkedIn post from the edited brief. Publishing stays
 * on the LinkedIn page (Approve & publish), so the post and the brief always
 * go out together.
 *
 * Items panel supports drag-and-drop reordering (within and across sections),
 * persistent deselection (excluded items stay visible and re-selectable),
 * and per-item editorial tone tags.
 */
export default function BriefEditor({ id, initialMarkdown }: { id: string; initialMarkdown: string }) {
  const [text, setText] = useState(initialMarkdown);
  const [savedText, setSavedText] = useState(initialMarkdown);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [rightPanel, setRightPanel] = useState<"audit" | "items" | "available" | "history">("audit");
  const [busy, setBusy] = useState<"save" | "post" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Source of truth for the Items panel — includes excluded items.
  // When the Items panel mutates this, `text` is derived from it.
  // When the textarea is edited directly, we re-parse and merge excluded items back.
  const [allParsed, setAllParsed] = useState<ParsedBrief>(() => parseBriefMarkdown(initialMarkdown));

  const audit = useMemo(() => auditBrief(text), [text]);
  const storyCount = useMemo(() => countStories(allParsed), [allParsed]);
  const dirty = text !== savedText;

  // Textarea changed by user typing — re-parse and merge excluded items back.
  const handleTextChange = useCallback((newText: string) => {
    setText(newText);
    const fresh = parseBriefMarkdown(newText);
    setAllParsed((prev) => mergeExcluded(fresh, prev));
  }, []);

  // Apply a mutation from the Items panel — update allParsed, derive text.
  const applyItemsEdit = useCallback((updater: (prev: ParsedBrief) => ParsedBrief) => {
    setAllParsed((prev) => {
      const updated = updater(prev);
      setText(rebuildBriefMarkdown(updated));
      return updated;
    });
  }, []);

  // Toggle a story's included flag
  const toggleItem = useCallback((sectionIdx: number, storyIdx: number) => {
    applyItemsEdit((prev) => ({
      ...prev,
      sections: prev.sections.map((sec, si) =>
        si !== sectionIdx ? sec : {
          ...sec,
          stories: sec.stories.map((s, ii) =>
            ii !== storyIdx ? s : { ...s, included: !s.included }
          ),
        }
      ),
    }));
  }, [applyItemsEdit]);

  // Move a story within or across sections
  const moveStory = useCallback((
    fromSection: number, fromIdx: number,
    toSection: number, toIdx: number,
  ) => {
    applyItemsEdit((prev) => {
      const sections = prev.sections.map((s) => ({ ...s, stories: [...s.stories] }));
      const [story] = sections[fromSection].stories.splice(fromIdx, 1);
      if (!story) return prev;
      const adjustedIdx = fromSection === toSection && fromIdx < toIdx ? toIdx - 1 : toIdx;
      sections[toSection].stories.splice(adjustedIdx, 0, story);
      return { ...prev, sections };
    });
  }, [applyItemsEdit]);

  // Set tone on a story (toggle off if same tone clicked again)
  const setTone = useCallback((sectionIdx: number, storyIdx: number, tone: StoryTone) => {
    applyItemsEdit((prev) => ({
      ...prev,
      sections: prev.sections.map((sec, si) =>
        si !== sectionIdx ? sec : {
          ...sec,
          stories: sec.stories.map((s, ii) =>
            ii !== storyIdx ? s : { ...s, tone: s.tone === tone ? null : tone }
          ),
        }
      ),
    }));
  }, [applyItemsEdit]);

  const toggleLinkedIn = useCallback((sectionIdx: number, storyIdx: number) => {
    applyItemsEdit((prev) => ({
      ...prev,
      sections: prev.sections.map((sec, si) =>
        si !== sectionIdx ? sec : {
          ...sec,
          stories: sec.stories.map((s, ii) =>
            ii !== storyIdx ? s : { ...s, linkedinInclude: !s.linkedinInclude }
          ),
        }
      ),
    }));
  }, [applyItemsEdit]);

  // Rewrite a story body via Gemini
  const rewriteItem = useCallback(async (sectionIdx: number, storyIdx: number) => {
    const story = allParsed.sections[sectionIdx]?.stories[storyIdx];
    if (!story) return;
    try {
      const res = await rewriteStoryAction({
        headline: story.headline,
        summary: story.body,
        source_name: story.sourceName ?? undefined,
        source_url: story.sourceUrl ?? undefined,
        tone: story.tone,
      });
      if (res.error) {
        console.error("[BriefEditor] rewrite failed:", res.error);
        setMsg({ ok: false, text: `Rewrite failed: ${res.error}` });
        return;
      }
      if (res.data?.body) {
        applyItemsEdit((prev) => ({
          ...prev,
          sections: prev.sections.map((sec, si) =>
            si !== sectionIdx ? sec : {
              ...sec,
              stories: sec.stories.map((s, ii) =>
                ii !== storyIdx ? s : { ...s, body: res.data!.body }
              ),
            }
          ),
        }));
        setMsg({ ok: true, text: "Story rewritten." });
      } else {
        console.error("[BriefEditor] rewrite returned no body:", res);
        setMsg({ ok: false, text: "Rewrite returned empty — check Gemini health endpoint." });
      }
    } catch (err) {
      console.error("[BriefEditor] rewrite exception:", err);
      setMsg({ ok: false, text: `Rewrite error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [allParsed, applyItemsEdit]);

  // Regenerate the "Week in Context" section from currently included stories
  const [contextBusy, setContextBusy] = useState(false);
  const regenerateContext = useCallback(async () => {
    // Gather all included stories across non-context sections
    const included: { headline: string; body: string }[] = [];
    for (const sec of allParsed.sections) {
      if (sec.isContextSection) continue;
      for (const s of sec.stories) {
        if (s.included) included.push({ headline: s.headline, body: s.body });
      }
    }
    if (included.length === 0) {
      setMsg({ ok: false, text: "No included stories to generate context from." });
      return;
    }
    setContextBusy(true);
    try {
      const res = await rewriteContextAction(included);
      if (res.error) {
        console.error("[BriefEditor] context regen failed:", res.error);
        setMsg({ ok: false, text: `Context regeneration failed: ${res.error}` });
        return;
      }
      if (res.data?.context) {
        applyItemsEdit((prev) => ({
          ...prev,
          sections: prev.sections.map((sec) =>
            sec.isContextSection ? { ...sec, preamble: "\n" + res.data!.context + "\n" } : sec
          ),
        }));
        setMsg({ ok: true, text: "Week in Context regenerated." });
      } else {
        console.error("[BriefEditor] context regen returned empty:", res);
        setMsg({ ok: false, text: "Context regen returned empty — check Gemini health endpoint." });
      }
    } catch (err) {
      console.error("[BriefEditor] context regen exception:", err);
      setMsg({ ok: false, text: `Context error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setContextBusy(false);
    }
  }, [allParsed, applyItemsEdit]);

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
    <div className="r-stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
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
            onChange={(e) => handleTextChange(e.target.value)}
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
          <button onClick={() => setRightPanel("available")} style={panelBtn(rightPanel === "available")}>Available</button>
          <button onClick={() => setRightPanel("history")} style={panelBtn(rightPanel === "history")}>History</button>
        </div>
        {rightPanel === "items" && storyCount.included > 0 && (
          <div style={{ fontSize: 10, color: "var(--sub)", display: "flex", gap: 8, alignItems: "center", paddingBottom: 4, borderBottom: "1px solid var(--bd)" }}>
            <span>Sources:</span>
            {storyCount.sourceFull > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success-green, #2E7D32)", display: "inline-block" }} />
                {storyCount.sourceFull} verified
              </span>
            )}
            {storyCount.sourcePartial > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning-amber, #CC7700)", display: "inline-block" }} />
                {storyCount.sourcePartial} partial
              </span>
            )}
            {storyCount.sourceMissing > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--alert-red, #CC0000)", display: "inline-block" }} />
                {storyCount.sourceMissing} missing
              </span>
            )}
          </div>
        )}

        {rightPanel === "audit" ? (
          <AuditPanel audit={audit} />
        ) : rightPanel === "items" ? (
          <ItemsPanel
            parsed={allParsed}
            onToggle={toggleItem}
            onMove={moveStory}
            onTone={setTone}
            onLinkedIn={toggleLinkedIn}
            onRewrite={rewriteItem}
            onRegenerateContext={regenerateContext}
            contextBusy={contextBusy}
          />
        ) : rightPanel === "available" ? (
          <AvailablePool
            parsed={allParsed}
            onInsert={(sectionIdx, story) => {
              applyItemsEdit((prev) => {
                const sections = prev.sections.map((s) => ({ ...s, stories: [...s.stories] }));
                sections[sectionIdx].stories.push(story);
                return { ...prev, sections };
              });
            }}
          />
        ) : (
          <VersionHistory
            briefId={id}
            onRestore={(markdown) => {
              handleTextChange(markdown);
              setMsg({ ok: true, text: "Restored from previous version" });
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ── Audit panel (unchanged) ─────────────────────────────────────────── */

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

/* ── Items panel with drag-and-drop ──────────────────────────────────── */

const TONE_OPTIONS: { key: StoryTone; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "brief", label: "Brief" },
  { key: "technical", label: "Technical" },
  { key: "conversational", label: "Casual" },
];

function ItemsPanel({
  parsed,
  onToggle,
  onMove,
  onTone,
  onLinkedIn,
  onRewrite,
  onRegenerateContext,
  contextBusy,
}: {
  parsed: ParsedBrief;
  onToggle: (si: number, ii: number) => void;
  onMove: (fromSi: number, fromIi: number, toSi: number, toIi: number) => void;
  onTone: (si: number, ii: number, tone: StoryTone) => void;
  onLinkedIn: (si: number, ii: number) => void;
  onRewrite: (si: number, ii: number) => Promise<void>;
  onRegenerateContext: () => Promise<void>;
  contextBusy: boolean;
}) {
  const storySections = parsed.sections
    .map((s, si) => ({ section: s, si }))
    .filter(({ section }) => !section.isContextSection && section.stories.length > 0);

  // Section names for the move-to-section pills
  const sectionNames = useMemo(
    () =>
      parsed.sections
        .map((s, si) => ({ label: s.heading.replace(/^\d+\.\s*/, ""), si, isContext: s.isContextSection }))
        .filter((s) => !s.isContext),
    [parsed],
  );

  // Drag state
  const [dragSource, setDragSource] = useState<{ si: number; ii: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ si: number; ii: number } | null>(null);

  const handleDragStart = useCallback((si: number, ii: number) => {
    setDragSource({ si, ii });
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragSource && dropTarget) {
      onMove(dragSource.si, dragSource.ii, dropTarget.si, dropTarget.ii);
    }
    setDragSource(null);
    setDropTarget(null);
  }, [dragSource, dropTarget, onMove]);

  const handleDragOver = useCallback((e: React.DragEvent, si: number, ii: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ si, ii });
  }, []);

  if (storySections.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--sub)" }}>
        No parseable story items found. Stories use <code>### </code> headings under <code>## </code> section headings.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "70vh", overflowY: "auto" }}>
      {storySections.map(({ section, si }) => (
        <div key={section.id}>
          <div
            style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--sub)", marginBottom: 6 }}
            onDragOver={(e) => handleDragOver(e, si, 0)}
          >
            {section.heading}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {/* Drop zone before first item */}
            <DropIndicator
              active={dragSource !== null && dropTarget?.si === si && dropTarget?.ii === 0}
              onDragOver={(e) => handleDragOver(e, si, 0)}
            />
            {section.stories.map((story, ii) => (
              <div key={story.id}>
                <StoryRow
                  story={story}
                  isDragging={dragSource?.si === si && dragSource?.ii === ii}
                  onToggle={() => onToggle(si, ii)}
                  onTone={(tone) => onTone(si, ii, tone)}
                  onLinkedIn={() => onLinkedIn(si, ii)}
                  onRewrite={() => onRewrite(si, ii)}
                  onDragStart={() => handleDragStart(si, ii)}
                  onDragEnd={handleDragEnd}
                  currentSi={si}
                  sectionNames={sectionNames}
                  onMoveToSection={(targetSi) => onMove(si, ii, targetSi, 0)}
                />
                {/* Drop zone after each item */}
                <DropIndicator
                  active={dragSource !== null && dropTarget?.si === si && dropTarget?.ii === ii + 1
                    && !(dragSource.si === si && (dragSource.ii === ii || dragSource.ii === ii + 1))}
                  onDragOver={(e) => handleDragOver(e, si, ii + 1)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* Week in Context section with Regenerate button */}
      {parsed.sections.filter((s) => s.isContextSection).map((sec) => (
        <div key={sec.id} style={{ borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--sub)" }}>
              {sec.heading}
            </span>
            <button
              onClick={onRegenerateContext}
              disabled={contextBusy}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid var(--gold-border)",
                background: contextBusy ? "var(--bd)" : "transparent",
                color: contextBusy ? "var(--sub)" : "var(--gold-dark)",
                cursor: contextBusy ? "not-allowed" : "pointer",
              }}
            >
              {contextBusy ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--sub)", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto" }}>
            {sec.preamble.trim() || "No context summary yet."}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 10.5, color: "var(--empty-text)", margin: 0, lineHeight: 1.4 }}>
        Drag items to reorder or move between sections. Uncheck to exclude (re-check to restore). Tone tags set the editorial treatment per story. Save when done.
      </p>
    </div>
  );
}

/* ── Drop indicator line ─────────────────────────────────────────────── */

function DropIndicator({
  active,
  onDragOver,
}: {
  active: boolean;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={(e) => e.preventDefault()}
      style={{
        height: active ? 3 : 8,
        background: active ? "var(--gold-dark)" : "transparent",
        borderRadius: 2,
        transition: "height 0.12s, background 0.12s",
        margin: active ? "1px 8px" : "0 8px",
        flexShrink: 0,
      }}
    />
  );
}

/* ── Story row with drag handle and tone tags ────────────────────────── */

function StoryRow({
  story,
  isDragging,
  onToggle,
  onTone,
  onLinkedIn,
  onRewrite,
  onDragStart,
  onDragEnd,
  currentSi,
  sectionNames,
  onMoveToSection,
}: {
  story: BriefStory;
  isDragging: boolean;
  onToggle: () => void;
  onTone: (tone: StoryTone) => void;
  onLinkedIn: () => void;
  onRewrite: () => Promise<void>;
  onDragStart: () => void;
  onDragEnd: () => void;
  currentSi: number;
  sectionNames: { label: string; si: number }[];
  onMoveToSection: (targetSi: number) => void;
}) {
  const [rewriting, setRewriting] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", story.headline);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 8px",
        borderRadius: 6,
        background: story.included ? "transparent" : "var(--pg)",
        opacity: isDragging ? 0.25 : story.included ? 1 : 0.5,
        border: "1px solid transparent",
        cursor: "grab",
        transition: "opacity 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{
            color: "var(--sub)",
            cursor: "grab",
            fontSize: 13,
            lineHeight: 1,
            userSelect: "none",
            paddingTop: 2,
          }}
          title="Drag to reorder or move between sections"
        >
          &#x2807;
        </span>
        <input
          type="checkbox"
          checked={story.included}
          onChange={onToggle}
          style={{ marginTop: 2, accentColor: "var(--gold-dark)", cursor: "pointer", flexShrink: 0 }}
        />
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: "var(--tx)",
              textDecoration: story.included ? "none" : "line-through",
            }}
          >
            {story.headline}
          </span>
          {story.included && (
            <span style={{ fontSize: 10, color: "var(--sub)", display: "flex", alignItems: "center", gap: 4 }}>
              <span
                title={
                  story.sourceUrl ? "Source verified (has URL)" :
                  story.sourceName ? "Source partial (name only, no URL)" :
                  "No source attribution"
                }
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: story.sourceUrl ? "var(--success-green, #2E7D32)" :
                              story.sourceName ? "var(--warning-amber, #CC7700)" :
                              "var(--alert-red, #CC0000)",
                  flexShrink: 0,
                }}
              />
              {story.sourceUrl ? (
                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--sub)", textDecoration: "underline" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {story.sourceName || "Source"}
                </a>
              ) : story.sourceName ? (
                <span>{story.sourceName}</span>
              ) : (
                <span style={{ fontStyle: "italic", opacity: 0.7 }}>No source</span>
              )}
            </span>
          )}
        </span>
      </div>
      {story.included && (
        <>
          <div style={{ display: "flex", gap: 3, paddingLeft: 34, flexWrap: "wrap", alignItems: "center" }}>
            {TONE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onTone(key)}
                style={{
                  fontSize: 9.5,
                  padding: "1px 6px",
                  borderRadius: 3,
                  border: story.tone === key ? "1px solid var(--gold-dark)" : "1px solid var(--bd)",
                  background: story.tone === key ? "var(--table-header)" : "transparent",
                  color: story.tone === key ? "var(--tx)" : "var(--sub)",
                  cursor: "pointer",
                  fontWeight: story.tone === key ? 700 : 500,
                  lineHeight: 1.6,
                }}
              >
                {label}
              </button>
            ))}
            <button
              disabled={rewriting}
              onClick={async () => {
                setRewriting(true);
                try { await onRewrite(); } finally { setRewriting(false); }
              }}
              style={{
                fontSize: 9.5,
                padding: "1px 6px",
                borderRadius: 3,
                border: "1px solid var(--gold-dark)",
                background: rewriting ? "var(--table-header)" : "transparent",
                color: "var(--gold-dark)",
                cursor: rewriting ? "wait" : "pointer",
                fontWeight: 600,
                lineHeight: 1.6,
                marginLeft: 4,
                opacity: rewriting ? 0.6 : 1,
              }}
              title="Rewrite this story in AfricanSTN editorial voice via Gemini"
            >
              {rewriting ? "Rewriting…" : "✎ Rewrite"}
            </button>
            <button
              onClick={onLinkedIn}
              style={{
                fontSize: 9.5,
                padding: "1px 6px",
                borderRadius: 3,
                border: story.linkedinInclude ? "1px solid var(--gold-dark)" : "1px solid var(--bd)",
                background: story.linkedinInclude ? "var(--gold-dark)" : "transparent",
                color: story.linkedinInclude ? "#fff" : "var(--sub)",
                cursor: "pointer",
                fontWeight: story.linkedinInclude ? 700 : 500,
                lineHeight: 1.6,
                marginLeft: 4,
              }}
              title={story.linkedinInclude ? "Must appear in LinkedIn post (click to remove)" : "Flag to include in LinkedIn post"}
            >
              LI
            </button>
          </div>
          {sectionNames.length > 1 && (
            <div style={{ display: "flex", gap: 3, paddingLeft: 34, flexWrap: "wrap", marginTop: 2 }}>
              {sectionNames.map(({ label, si }) => (
                <button
                  key={si}
                  disabled={si === currentSi}
                  onClick={() => onMoveToSection(si)}
                  style={{
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 10,
                    border: si === currentSi ? "1px solid var(--sub)" : "1px solid var(--bd)",
                    background: si === currentSi ? "var(--sub)" : "transparent",
                    color: si === currentSi ? "var(--pnl)" : "var(--sub)",
                    cursor: si === currentSi ? "default" : "pointer",
                    fontWeight: si === currentSi ? 700 : 400,
                    lineHeight: 1.6,
                    opacity: si === currentSi ? 1 : 0.7,
                  }}
                  title={si === currentSi ? "Current section" : `Move to ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Available pool — approved items not yet in the brief ──────────── */

function AvailablePool({
  parsed,
  onInsert,
}: {
  parsed: ParsedBrief;
  onInsert: (sectionIdx: number, story: BriefStory) => void;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) return;
    setLoading(true);
    loadApprovedPool(21).then((res) => {
      setItems(res.data?.data ?? []);
      setLoading(false);
      setLoaded(true);
    });
  }, [loaded]);

  const briefHeadlines = useMemo(() => {
    const set = new Set<string>();
    for (const sec of parsed.sections) {
      for (const s of sec.stories) {
        set.add(s.headline.toLowerCase().trim());
      }
    }
    return set;
  }, [parsed]);

  const targetSections = useMemo(
    () =>
      parsed.sections
        .map((s, si) => ({ heading: s.heading, si, isContext: s.isContextSection }))
        .filter((s) => !s.isContext),
    [parsed],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matched = q
      ? items.filter(
          (it) =>
            (it.title ?? "").toLowerCase().includes(q) ||
            (it.summary ?? "").toLowerCase().includes(q) ||
            (it.category ?? "").toLowerCase().includes(q),
        )
      : items;
    const available: ReviewItem[] = [];
    const alreadyIn: ReviewItem[] = [];
    for (const it of matched) {
      if (briefHeadlines.has((it.title ?? "").toLowerCase().trim())) {
        alreadyIn.push(it);
      } else {
        available.push(it);
      }
    }
    return { available, alreadyIn };
  }, [items, search, briefHeadlines]);

  /** Group available items by category, flag near-duplicates within each group */
  const grouped = useMemo(() => {
    const catMap = new Map<string, ReviewItem[]>();
    for (const it of filtered.available) {
      const cat = it.category || "Uncategorised";
      const arr = catMap.get(cat) ?? [];
      arr.push(it);
      catMap.set(cat, arr);
    }
    // Sort groups: largest first, then alpha
    const entries = Array.from(catMap.entries()).sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
    // Near-duplicate detection via word overlap (Jaccard)
    const stopwords = new Set(["the","a","an","in","on","at","to","for","of","and","is","with","by","from","as","its","has"]);
    function keywords(text: string): Set<string> {
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopwords.has(w));
      return new Set(words);
    }
    function jaccard(a: Set<string>, b: Set<string>): number {
      if (a.size === 0 && b.size === 0) return 0;
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      return inter / (a.size + b.size - inter);
    }
    // Build duplicate cluster ids
    const dupCluster = new Map<string, number>();
    let clusterId = 0;
    for (const [, groupItems] of entries) {
      const kws = groupItems.map((it) => ({ id: it.id, kw: keywords(it.title ?? "") }));
      for (let i = 0; i < kws.length; i++) {
        for (let j = i + 1; j < kws.length; j++) {
          if (jaccard(kws[i].kw, kws[j].kw) >= 0.4) {
            const existI = dupCluster.get(kws[i].id);
            const existJ = dupCluster.get(kws[j].id);
            const cid = existI ?? existJ ?? clusterId++;
            dupCluster.set(kws[i].id, cid);
            dupCluster.set(kws[j].id, cid);
          }
        }
      }
    }
    return { entries, dupCluster };
  }, [filtered.available]);

  function handleAdd(item: ReviewItem, sectionIdx: number) {
    setAddingId(item.id);
    const newStory: BriefStory = {
      id: `pool-${item.id}`,
      headline: item.title ?? "Untitled",
      body: `\n${item.summary ?? ""}\n`,
      included: true,
      tone: null,
      linkedinInclude: false,
      sourceName: item.source_name ?? null,
      sourceUrl: item.source_url ?? null,
    };
    onInsert(sectionIdx, newStory);
    setTimeout(() => setAddingId(null), 600);
  }

  if (loading) {
    return <span style={{ fontSize: 12, color: "var(--sub)" }}>Loading approved items…</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "70vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
          Available
        </span>
        <span style={{ fontSize: 11, color: "var(--sub)" }}>
          {filtered.available.length} available · {filtered.alreadyIn.length} in brief
        </span>
      </div>
      <input
        type="text"
        placeholder="Search approved items…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          fontSize: 12,
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid var(--bd)",
          background: "var(--pg)",
          color: "var(--tx)",
          outline: "none",
        }}
      />
      {filtered.available.length === 0 && filtered.alreadyIn.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          {items.length === 0 ? "No approved items found in the last 21 days." : "No items match your search."}
        </span>
      ) : (
        <>
          {grouped.entries.map(([cat, groupItems]) => (
            <div key={cat}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--gold-dark)",
                  marginTop: 4,
                  marginBottom: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {cat}
                <span style={{ fontSize: 10, fontWeight: 400, color: "var(--sub)" }}>
                  ({groupItems.length})
                </span>
              </div>
              {groupItems.map((item) => (
                <PoolItemRow
                  key={item.id}
                  item={item}
                  inBrief={false}
                  adding={addingId === item.id}
                  targetSections={targetSections}
                  onAdd={(si) => handleAdd(item, si)}
                  dupClusterId={grouped.dupCluster.get(item.id)}
                />
              ))}
            </div>
          ))}
          {filtered.alreadyIn.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--sub)",
                  marginTop: 6,
                  borderTop: "1px solid var(--bd)",
                  paddingTop: 8,
                }}
              >
                Already in brief ({filtered.alreadyIn.length})
              </div>
              {filtered.alreadyIn.map((item) => (
                <PoolItemRow key={item.id} item={item} inBrief={true} adding={false} targetSections={targetSections} onAdd={() => {}} dupClusterId={undefined} />
              ))}
            </>
          )}
        </>
      )}
      <p style={{ fontSize: 10.5, color: "var(--sub)", margin: 0, lineHeight: 1.4 }}>
        Approved items from the last 21 days. Click + to add to a section.
      </p>
    </div>
  );
}

/* ── Pool item row ─────────────────────────────────────────────────── */

function PoolItemRow({
  item,
  inBrief,
  adding,
  targetSections,
  onAdd,
  dupClusterId,
}: {
  item: ReviewItem;
  inBrief: boolean;
  adding: boolean;
  targetSections: { heading: string; si: number }[];
  onAdd: (sectionIdx: number) => void;
  dupClusterId: number | undefined;
}) {
  const [showSections, setShowSections] = useState(false);
  const created = item.created_at
    ? new Date(item.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 8px",
        borderRadius: 6,
        opacity: inBrief ? 0.4 : adding ? 0.3 : 1,
        background: adding ? "var(--table-header)" : "transparent",
        transition: "opacity 0.2s, background 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {inBrief ? (
          <span style={{ fontSize: 13, color: "var(--success-green)", flexShrink: 0, paddingTop: 1 }}>✓</span>
        ) : (
          <button
            onClick={() => setShowSections(!showSections)}
            title="Add to brief"
            style={{
              fontSize: 15,
              lineHeight: 1,
              color: "var(--gold-dark)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          >
            +
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, lineHeight: 1.4, color: "var(--tx)", fontWeight: 600 }}>
            {item.title ?? "Untitled"}
            {dupClusterId !== undefined && (
              <span
                title="Near-duplicate headline detected — consider picking one"
                style={{
                  fontSize: 9,
                  marginLeft: 5,
                  padding: "1px 4px",
                  borderRadius: 3,
                  background: "var(--warning-amber)",
                  color: "#fff",
                  fontWeight: 700,
                  verticalAlign: "middle",
                  whiteSpace: "nowrap",
                  display: "inline-block",
                }}
              >
                ≈&nbsp;similar
              </span>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>
            {item.source_name ?? "Unknown"} · {created}
            {item.category && (
              <>
                {" · "}
                <span style={{ color: "var(--gold-dark)" }}>{item.category}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {showSections && !inBrief && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 22, marginTop: 2 }}>
          <span style={{ fontSize: 10, color: "var(--sub)", fontWeight: 600 }}>Add to section:</span>
          {targetSections.map(({ heading, si }) => (
            <button
              key={si}
              onClick={() => {
                onAdd(si);
                setShowSections(false);
              }}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid var(--bd)",
                background: "transparent",
                color: "var(--tx)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {heading}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Version history panel ─────────────────────────────────────────── */

function VersionHistory({
  briefId,
  onRestore,
}: {
  briefId: string;
  onRestore: (markdown: string) => void;
}) {
  const [versions, setVersions] = useState<BriefVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadBriefVersions(briefId).then((res) => {
      if (cancelled) return;
      if (res.data) setVersions(res.data.data ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [briefId]);

  const loadVersionPreview = async (versionId: number) => {
    if (expandedId === versionId) {
      setExpandedId(null);
      setPreview(null);
      return;
    }
    setExpandedId(versionId);
    setPreviewLoading(true);
    const res = await loadBriefVersion(briefId, String(versionId));
    if (res.data) {
      setPreview(res.data.report_markdown ?? null);
    }
    setPreviewLoading(false);
  };

  if (loading) {
    return <span style={{ fontSize: 12, color: "var(--sub)" }}>Loading version history…</span>;
  }

  if (versions.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>Version history</span>
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          No previous versions yet. Versions are saved automatically each time you save the brief.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>Version history</span>
        <span style={{ fontSize: 11, color: "var(--sub)" }}>{versions.length} version{versions.length !== 1 ? "s" : ""}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "70vh", overflowY: "auto" }}>
        {versions.map((v) => {
          const date = new Date(v.saved_at);
          const dateStr = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
          const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          const isExpanded = expandedId === v.id;

          return (
            <div
              key={v.id}
              style={{
                border: "1px solid var(--bd)",
                borderRadius: 6,
                overflow: "hidden",
                background: isExpanded ? "var(--table-header)" : "transparent",
              }}
            >
              <button
                onClick={() => loadVersionPreview(v.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--tx)",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>v{v.version_num}</span>
                  <span style={{ fontSize: 10.5, color: "var(--sub)" }}>
                    {dateStr} at {timeStr}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  {v.word_count != null && (
                    <span style={{ fontSize: 10, color: "var(--sub)" }}>{v.word_count.toLocaleString("en-GB")} words</span>
                  )}
                  {v.story_count != null && (
                    <span style={{ fontSize: 10, color: "var(--sub)" }}>{v.story_count} stories</span>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div style={{ borderTop: "1px solid var(--bd)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {previewLoading ? (
                    <span style={{ fontSize: 11, color: "var(--sub)" }}>Loading…</span>
                  ) : preview ? (
                    <>
                      <pre
                        style={{
                          fontSize: 10.5,
                          lineHeight: 1.5,
                          color: "var(--tx)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxHeight: 300,
                          overflowY: "auto",
                          margin: 0,
                          padding: 8,
                          background: "var(--pg)",
                          borderRadius: 4,
                          border: "1px solid var(--bd)",
                        }}
                      >
                        {preview.slice(0, 2000)}{preview.length > 2000 ? "\n…" : ""}
                      </pre>
                      <button
                        onClick={() => {
                          if (preview) onRestore(preview);
                        }}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "5px 12px",
                          borderRadius: 4,
                          border: "1px solid var(--gold-dark)",
                          background: "transparent",
                          color: "var(--gold-dark)",
                          cursor: "pointer",
                          alignSelf: "flex-start",
                        }}
                      >
                        Restore this version
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--sub)" }}>Could not load version content.</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 10.5, color: "var(--sub)", margin: 0, lineHeight: 1.4 }}>
        Each save creates a snapshot. Restoring a version replaces the editor content but does not save — review the content then save manually.
      </p>
    </div>
  );
}

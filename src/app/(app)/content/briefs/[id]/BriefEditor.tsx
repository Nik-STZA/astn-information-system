"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { auditBrief } from "@/lib/brief-audit";
import { markdownToHtml } from "@/lib/markdown";
import { saveBrief, regeneratePost, regeneratePostStatus } from "./actions";

/**
 * Draft brief editor: edit the markdown, see the fact-discipline audit live,
 * save, then redraft the LinkedIn post from the edited brief. Publishing stays
 * on the LinkedIn page (Approve & publish), so the post and the brief always
 * go out together.
 */
export default function BriefEditor({ id, initialMarkdown }: { id: string; initialMarkdown: string }) {
  const [text, setText] = useState(initialMarkdown);
  const [savedText, setSavedText] = useState(initialMarkdown);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<"save" | "post" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const audit = useMemo(() => auditBrief(text), [text]);
  const dirty = text !== savedText;

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

      <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>Fact check</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: audit.warnings.length ? "var(--warning-amber)" : "var(--success-green)" }}>
            {audit.stories} stories · {audit.warnings.length ? `${audit.warnings.length} to review` : "clean"}
          </span>
        </div>
        {audit.warnings.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--sub)" }}>
            Every story has What happened and a horizon-tagged Opportunity; no speculation, hedging, capability lists or named-company advice found.
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
          Flags, not blocks. What happened must be supported by the source; Opportunity names categories, not companies, with one concrete idea and an honest horizon.
        </p>
      </div>
    </div>
  );
}

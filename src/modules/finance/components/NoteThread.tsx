"use client";

// Notes against a work item or an open item.
//
// This is an audit record, not a comment box. Notes cannot be edited or
// deleted, by anyone, ever: the database refuses both. A correction is a
// further note, the same way a reversal is a further journal rather than an
// edit to the original. The interface says so plainly rather than letting
// someone discover it by trying.

import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import styles from "./Page.module.css";

export type NoteKind = "note" | "decision" | "hold" | "query";

export interface Note {
  id: string;
  body: string;
  kind: NoteKind;
  actor_email: string;
  actor_role: string | null;
  created_at: string;
}

const KINDS: Array<{ key: NoteKind; label: string; hint: string }> = [
  { key: "note", label: "Note", hint: "General commentary" },
  { key: "decision", label: "Decision", hint: "A choice made and why" },
  { key: "hold", label: "Hold", hint: "Something deliberately not actioned" },
  { key: "query", label: "Query", hint: "An open question" },
];

const KIND_TONE: Record<NoteKind, string> = {
  note: "s-neutral",
  decision: "s-green",
  hold: "s-amber",
  query: "s-blue",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NoteThread({
  slug,
  targetType,
  targetId,
  initialCount = 0,
}: {
  slug: string;
  targetType: "wip_item" | "open_item";
  targetId: string;
  initialCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<NoteKind>("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/finance/${encodeURIComponent(slug)}/notes?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`
      );
      const b = await res.json();
      if (!res.ok) setError(b.error ?? "Could not load notes");
      else setNotes(b.data as Note[]);
    } catch {
      setError("Could not load notes");
    }
  }, [slug, targetType, targetId]);

  useEffect(() => {
    if (open && notes === null) void load();
  }, [open, notes, load]);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, body, kind }),
      });
      const b = await res.json();
      if (!res.ok) {
        setError(b.error ?? "Could not save the note");
        return;
      }
      setNotes((n) => [b as Note, ...(n ?? [])]);
      setBody("");
      setKind("note");
    } catch {
      setError("Could not save the note");
    } finally {
      setBusy(false);
    }
  }

  const count = notes?.length ?? initialCount;

  if (!open) {
    return (
      <button type="button" className={styles.miniBtn} onClick={() => setOpen(true)} style={{ gap: 5, color: count > 0 ? "var(--tx)" : "var(--sub)" }}>
        <MessageSquare size={13} aria-hidden="true" />
        {count > 0 ? `${count} note${count === 1 ? "" : "s"}` : "Add note"}
      </button>
    );
  }

  return (
    <div className={styles.card} style={{ padding: "12px 14px", marginTop: 8, background: "var(--pg)", width: "100%" }}>
      <div className="seg" role="radiogroup" aria-label="Kind of note" style={{ marginBottom: 8 }}>
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="radio"
            aria-checked={kind === k.key}
            title={k.hint}
            className={kind === k.key ? "seg-on" : undefined}
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        aria-label="Note"
        placeholder="What was decided, and why. For example: payment run loaded, three vendors held pending contract review."
        style={{
          width: "100%",
          font: "400 13px/1.5 var(--font-sans)",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid var(--bd)",
          background: "var(--pnl)",
          color: "var(--tx)",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? "Saving…" : "Save note"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Close
        </button>
        <span className={styles.small}>Notes cannot be edited or deleted. Correct one by adding another.</span>
      </div>

      {error && <div className={styles.warn} style={{ marginTop: 8 }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        {notes === null && <div className={styles.small}>Loading…</div>}
        {notes?.length === 0 && <div className={styles.small}>No notes yet.</div>}
        {notes?.map((n) => (
          <div key={n.id} style={{ borderTop: "1px solid var(--bd)", paddingTop: 8, marginTop: 8, fontSize: 13 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`${styles.status} ${styles[KIND_TONE[n.kind]]}`} style={{ height: 20, fontSize: 11 }}>
                {KINDS.find((k) => k.key === n.kind)?.label ?? n.kind}
              </span>
              <span className={styles.small}>
                {n.actor_role ? `${n.actor_role} · ` : ""}
                {when(n.created_at)}
              </span>
            </div>
            <div style={{ color: "var(--tx)", lineHeight: 1.55, marginTop: 4, whiteSpace: "pre-wrap" }}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

// Notes against a work item or an open item.
//
// This is an audit record, not a comment box. Notes cannot be edited or
// deleted, by anyone, ever: the database refuses both. A correction is a
// further note, the same way a reversal is a further journal rather than an
// edit to the original. The interface says so plainly rather than letting
// someone discover it by trying.

import { useCallback, useEffect, useState } from "react";

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

const KIND_COLOUR: Record<NoteKind, string> = {
  note: "var(--sub)",
  decision: "var(--success-green)",
  hold: "var(--warning-amber)",
  query: "var(--status-blue)",
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 8px",
          borderRadius: 5,
          border: "1px solid var(--bd)",
          background: count > 0 ? "rgba(197,160,89,.10)" : "transparent",
          color: count > 0 ? "var(--tx)" : "var(--sub)",
          cursor: "pointer",
        }}
      >
        {count > 0 ? `${count} note${count === 1 ? "" : "s"}` : "Add note"}
      </button>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        padding: "12px 14px",
        marginTop: 8,
        background: "var(--pg)",
        fontFamily: "Manrope, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            title={k.hint}
            onClick={() => setKind(k.key)}
            style={{
              fontSize: 10.5,
              fontWeight: kind === k.key ? 700 : 500,
              padding: "3px 8px",
              borderRadius: 4,
              cursor: "pointer",
              border: `1px solid ${kind === k.key ? KIND_COLOUR[k.key] : "var(--bd)"}`,
              background: kind === k.key ? "rgba(197,160,89,.10)" : "transparent",
              color: kind === k.key ? "var(--tx)" : "var(--sub)",
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="What was decided, and why. For example: payment run loaded, three vendors held pending contract review."
        style={{
          width: "100%",
          fontFamily: "Manrope, sans-serif",
          fontSize: 12.5,
          lineHeight: 1.5,
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid var(--bd)",
          background: "var(--pnl)",
          color: "var(--tx)",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !body.trim()}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            padding: "6px 12px",
            borderRadius: 5,
            border: "none",
            background: body.trim() ? "#C5A059" : "var(--bd)",
            color: body.trim() ? "#141414" : "var(--sub)",
            cursor: body.trim() ? "pointer" : "default",
          }}
        >
          {busy ? "Saving…" : "Save note"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "6px 10px",
            borderRadius: 5,
            border: "1px solid var(--bd)",
            background: "transparent",
            color: "var(--sub)",
            cursor: "pointer",
          }}
        >
          Close
        </button>
        <span style={{ fontSize: 10.5, color: "var(--sub)" }}>
          Notes cannot be edited or deleted. Correct one by adding another.
        </span>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--warning-amber)" }}>{error}</div>
      )}

      <div style={{ marginTop: 12 }}>
        {notes === null && <div style={{ fontSize: 11.5, color: "var(--sub)" }}>Loading…</div>}
        {notes?.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>No notes yet.</div>
        )}
        {notes?.map((n) => (
          <div
            key={n.id}
            style={{
              borderTop: "1px solid var(--bd)",
              paddingTop: 8,
              marginTop: 8,
              fontSize: 12.5,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: 3,
                  border: `1px solid ${KIND_COLOUR[n.kind]}`,
                  color: KIND_COLOUR[n.kind],
                }}
              >
                {n.kind}
              </span>
              <span style={{ color: "var(--sub)", fontSize: 11 }}>
                {n.actor_role ? `${n.actor_role} · ` : ""}
                {when(n.created_at)}
              </span>
            </div>
            <div style={{ color: "var(--tx)", lineHeight: 1.55, marginTop: 4, whiteSpace: "pre-wrap" }}>
              {n.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

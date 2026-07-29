"use client";

// Reveal-toggle for any field carrying a client secret (brief section 8.3).
//
// Rules this implements:
//   - masked on load, always
//   - reveal shows the value for 10 seconds then re-masks itself
//   - copy puts the value on the clipboard without ever displaying it
//   - every reveal, copy and rotate writes to finance.audit_log
//   - the value is never put in a URL, never logged, and never rendered into
//     the server HTML: it is fetched on demand and held only in component state
//
// Applies to any future integration screen, not just Xero.

import { useCallback, useEffect, useRef, useState } from "react";

const REVEAL_MS = 10_000;

type Field = "client_id" | "client_secret" | "refresh_token";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontFamily: "Manrope, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  padding: "5px 8px",
  borderRadius: 5,
  border: "1px solid var(--bd)",
  background: "transparent",
  color: "var(--sub)",
  cursor: "pointer",
};

export default function SensitiveField({
  label,
  slug,
  entity,
  field,
  available,
}: {
  label: string;
  slug: string;
  entity: string;
  field: Field;
  available: boolean;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
  }, []);

  // Re-mask on unmount so a value never outlives the view that showed it.
  useEffect(() => () => clearTimers(), [clearTimers]);

  async function request(action: "reveal" | "copy"): Promise<string | null> {
    const res = await fetch(
      `/api/finance/${encodeURIComponent(slug)}/xero/${encodeURIComponent(entity)}/secret`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, field }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNote(body.error === "not connected" ? "Not connected" : "Unavailable");
      return null;
    }
    return (await res.json()).value as string;
  }

  async function onReveal() {
    if (value) {
      clearTimers();
      setValue(null);
      setRemaining(0);
      return;
    }
    setBusy(true);
    setNote(null);
    const v = await request("reveal");
    setBusy(false);
    if (v === null) return;

    setValue(v);
    setRemaining(REVEAL_MS / 1000);
    clearTimers();
    const tick = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearTimers();
          setValue(null);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    timers.current.push(tick);
  }

  async function onCopy() {
    setBusy(true);
    setNote(null);
    const v = await request("copy");
    setBusy(false);
    if (v === null) return;
    try {
      await navigator.clipboard.writeText(v);
      setNote("Copied");
    } catch {
      setNote("Clipboard blocked");
    }
    setTimeout(() => setNote(null), 2500);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 0",
        borderTop: "1px solid var(--bd)",
        fontFamily: "Manrope, sans-serif",
      }}
    >
      <div style={{ width: 150, fontSize: 12, color: "var(--sub)", flexShrink: 0 }}>
        {label}
      </div>

      <code
        style={{
          flex: 1,
          minWidth: 200,
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: value ? "var(--tx)" : "var(--sub)",
          overflowWrap: "anywhere",
        }}
      >
        {value ?? (available ? "•".repeat(28) : "not set")}
      </code>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={onReveal}
          disabled={!available || busy}
          style={{ ...buttonStyle, opacity: available ? 1 : 0.45 }}
          title={value ? "Hide now" : "Reveal for 10 seconds"}
        >
          <EyeIcon off={!!value} />
          {value ? `Hide (${remaining})` : "Reveal"}
        </button>

        <button
          type="button"
          onClick={onCopy}
          disabled={!available || busy}
          style={{ ...buttonStyle, opacity: available ? 1 : 0.45 }}
          title="Copy without displaying"
        >
          <CopyIcon />
          Copy
        </button>

        {note && (
          <span style={{ fontSize: 11, color: "var(--sub)" }}>{note}</span>
        )}
      </div>
    </div>
  );
}

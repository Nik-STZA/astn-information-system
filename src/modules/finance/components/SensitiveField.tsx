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
import { Copy, Eye, EyeOff } from "lucide-react";
import styles from "./Page.module.css";

const REVEAL_MS = 10_000;

type Field = "client_id" | "client_secret" | "refresh_token";

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
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
      <div className={styles.label} style={{ width: 130, flexShrink: 0 }}>{label}</div>

      <code
        style={{
          flex: "1 1 180px",
          minWidth: 0,
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: value ? "var(--tx)" : "var(--sub)",
          // The mask is decoration: clip it rather than wrap a stray dot onto a second line.
          ...(value ? { overflowWrap: "anywhere" } : { whiteSpace: "nowrap", overflow: "hidden" }),
        }}
      >
        {value ?? (available ? "•".repeat(20) : "Not set")}
      </code>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={onReveal}
          disabled={!available || busy}
          style={{ gap: 5, opacity: available ? 1 : 0.45 }}
          title={value ? "Hide now" : "Reveal for 10 seconds"}
        >
          {value ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
          {value ? `Hide (${remaining})` : "Reveal"}
        </button>

        <button
          type="button"
          className={styles.miniBtn}
          onClick={onCopy}
          disabled={!available || busy}
          style={{ gap: 5, opacity: available ? 1 : 0.45 }}
          title="Copy without displaying"
        >
          <Copy size={13} aria-hidden="true" />
          Copy
        </button>

        {note && <span className={styles.small}>{note}</span>}
      </div>
    </div>
  );
}

"use client";

// Edit your name, initials and title. Initials left empty are made from the
// name (first and last word). finance-api checks the shape and saves it as
// the signed-in person only.

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./Page.module.css";

const input = { height: 36, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pg)", color: "var(--tx)", font: "inherit", fontSize: 14 } as const;
const label = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--sub)" } as const;

export function initialsFrom(name: string): string {
  const w = name.trim().split(/\s+/).filter((x) => /[A-Za-z0-9]/.test(x));
  const first = (x: string) => (x.match(/[A-Za-z0-9]/) ?? [""])[0].toUpperCase();
  if (w.length >= 2) return first(w[0]) + first(w[w.length - 1]);
  return w.length ? w[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() : "";
}

export default function ProfileForm({ initial }: { initial: { display_name: string; initials: string; title: string } }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = f.initials.trim().toUpperCase() || initialsFrom(f.display_name) || "?";
  const changed = JSON.stringify(f) !== JSON.stringify(initial);
  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/finance/profile", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: f.display_name, initials: f.initials, title: f.title }) });
    const out = (await res.json().catch(() => ({}))) as { issues?: string[]; error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: out.issues?.join(" ") ?? out.error ?? `That did not work (${res.status})` }); return; }
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={label}>Name<input style={input} value={f.display_name} maxLength={80} disabled={busy} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
      <label style={label}>Initials (1 to 4 letters or digits; empty makes them from your name)
        <input style={{ ...input, maxWidth: 120, textTransform: "uppercase" }} value={f.initials} maxLength={4} disabled={busy} onChange={(e) => setF({ ...f, initials: e.target.value })} /></label>
      <label style={label}>Title<input style={input} value={f.title} maxLength={80} disabled={busy} placeholder="e.g. CFO" onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <div className={styles.small} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: "var(--tx)", color: "var(--pnl)", fontSize: 11, fontWeight: 600 }}>{shown}</span>
        <span>How your entries show: {shown}{f.display_name.trim() ? `, ${f.display_name.trim()}` : ""}{f.title.trim() ? `, ${f.title.trim()}` : ""} on hover.</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" disabled={busy || !changed || !f.display_name.trim()} onClick={save}>Save</button>
        {msg && <span className={msg.ok ? styles.small : styles.error} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
      </div>
    </div>
  );
}

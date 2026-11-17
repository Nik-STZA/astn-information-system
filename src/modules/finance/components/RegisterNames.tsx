"use client";

// The client's own name for each asset register, set by the CFO
// (finance-api refuses anyone else). Each row saves on its own.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RegisterSetting } from "@/modules/finance/lib/asset-register";
import styles from "./Page.module.css";

function Row({ slug, g }: { slug: string; g: RegisterSetting }) {
  const router = useRouter();
  const [name, setName] = useState(g.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = name.trim() !== (g.display_name ?? "");
  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/asset-register/groupings/name`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grouping: g.grouping, name }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[]; name?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: out.issues?.join(" ") ?? out.error ?? `That did not work (${res.status})` }); return; }
    setMsg({ ok: true, text: `Saved. It now shows as "${out.name}".` });
    router.refresh();
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--sub)" }}>
        <span>Standard name: {g.catalogue_name}{g.paused ? " (paused)" : ""}</span>
        <input type="text" value={name} maxLength={60} placeholder={g.catalogue_name} disabled={busy} onChange={(e) => setName(e.target.value)}
          aria-label={`Name for ${g.catalogue_name}`}
          style={{ height: 36, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pg)", color: "var(--tx)", font: "inherit", fontSize: 14 }} />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" disabled={busy || !changed} onClick={save}>{g.display_name && !name.trim() ? "Use the standard name" : "Save name"}</button>
        {msg && <span className={msg.ok ? styles.small : styles.error} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function RegisterNames({ slug, registers }: { slug: string; registers: RegisterSetting[] }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{registers.map((g) => <Row key={g.grouping} slug={slug} g={g} />)}</div>;
}

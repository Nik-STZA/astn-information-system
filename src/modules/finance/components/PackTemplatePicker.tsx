"use client";

// Which management pack template the client uses (Settings > Financial). The
// CFO chooses; finance-api refuses anyone else, and refuses a template that
// would leave mapped accounts without a line.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PackTemplateView } from "@/modules/finance/lib/coa";
import styles from "./Page.module.css";

export default function PackTemplatePicker({ slug, view }: { slug: string; view: PackTemplateView }) {
  const router = useRouter();
  const [choice, setChoice] = useState(view.current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = view.templates.find((t) => t.key === choice);

  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/pack-template`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: choice }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: out.error ?? `That did not work (${res.status})` }); return; }
    setMsg({ ok: true, text: `Saved. The next pack uses ${chosen?.name ?? choice}.` });
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div role="radiogroup" aria-label="Pack template" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {view.templates.map((t) => (
          <label key={t.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 8, cursor: "pointer",
            border: `1px solid ${choice === t.key ? "var(--accent-text)" : "var(--bd)"}` }}>
            <input type="radio" name="pack-template" value={t.key} checked={choice === t.key} disabled={busy}
              onChange={() => setChoice(t.key)} style={{ marginTop: 3 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}{t.key === view.current ? " (in use)" : ""}</span>
              <span className={styles.small}>{t.description}</span>
            </span>
          </label>
        ))}
      </div>
      {view.ownLines.length > 0 && (
        <p className={styles.small} style={{ margin: 0 }}>
          This client also has its own lines, which stay whichever template it uses: {view.ownLines.map((l) => l.label).join(", ")}.
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" disabled={busy || choice === view.current} onClick={save}>Use this template</button>
        {msg && <span className={msg.ok ? styles.small : styles.error} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
      </div>
    </div>
  );
}

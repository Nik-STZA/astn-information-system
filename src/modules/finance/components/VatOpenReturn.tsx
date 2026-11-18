"use client";

// Open (or go back to) a VAT return for a period. Defaults to last month.

import { useRouter } from "next/navigation";
import { useState } from "react";
import page from "./Page.module.css";
import vat from "./Vat.module.css";

function lastMonth(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

export default function VatOpenReturn({ slug, registrationId }: { slug: string; registrationId: string | null }) {
  const router = useRouter();
  const d = lastMonth();
  const [start, setStart] = useState(d.start);
  const [end, setEnd] = useState(d.end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/vat/returns`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period_start: start, period_end: end, ...(registrationId ? { registration_id: registrationId } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(body.error ?? body.issues?.join("; ") ?? `That did not work (${res.status})`); return; }
    router.push(`/finance/clients/${encodeURIComponent(slug)}/vat/${body.id}`);
  }

  return (
    <div className={page.stack}>
      <div className={vat.form}>
        <label className={vat.field}>Period start<input className={vat.input} type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className={vat.field}>Period end<input className={vat.input} type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="btn-primary" disabled={busy || !start || !end} onClick={open}>{busy ? "Opening..." : "Open the return"}</button>
      </div>
      {err && <div className={page.error} role="alert">{err}</div>}
    </div>
  );
}

"use client";

// The pipeline: the client master's prospects by stage. A card moves a stage
// on or back, converts to a client (opening its set-up), or records that it is
// not going ahead (Former, with the reason, so it can be picked up later).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { pipelineColumns, stageStep, type MasterClient, type PipelineStage } from "@/modules/finance/lib/clients";
import { NewClient } from "./ClientMaster";
import styles from "./Page.module.css";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

export default function PipelineBoard({ clients }: { clients: MasterClient[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cols = pipelineColumns(clients);
  const total = cols.reduce((n, c) => n + c.clients.length, 0);

  async function change(c: MasterClient, body: Record<string, unknown>, then?: string) {
    setBusy(c.id);
    setError(null);
    const res = await fetch(`/api/clients/${c.slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(out.issues?.join(" ") ?? out.error ?? "Could not save");
    if (then) router.push(then);
    else router.refresh();
  }

  return (
    <div>
      <div className={styles.controls} style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className={styles.small}>
          {total} {total === 1 ? "prospect" : "prospects"}. Ones not going ahead move to Former in{" "}
          <Link href="/clients/all">All clients</Link>.
        </span>
        {!adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" />New prospect</button>}
      </div>
      {adding && <NewClient onlyProspect onDone={() => setAdding(false)} />}
      {error && <div className={styles.error} role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: 12, alignItems: "start" }}>
        {cols.map((col) => (
          <section key={col.stage} aria-label={col.label}
            style={{ background: "var(--cardhover)", borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px" }}>
              <h2 style={{ fontSize: 13 }}>{col.label}</h2>
              <span className={styles.small}>{col.clients.length}</span>
            </div>
            {col.clients.map((c) => {
              const back = stageStep(c.pipeline_stage, -1);
              const on = stageStep(c.pipeline_stage, 1);
              const b = busy === c.id;
              return (
                <article key={c.id} className={styles.card} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <Link href={`/clients/all/${c.slug}`} style={{ fontWeight: 500, color: "var(--tx)" }}>{c.name}</Link>
                  <div className={styles.small}>
                    {[c.jurisdiction, c.contact].filter(Boolean).join(" · ") || "No details yet"}
                    <br />Added {fmtDate(c.created_at)}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                    <button type="button" className={styles.miniBtn} disabled={b || !back} aria-label={`Move ${c.name} back a stage`} title="Back a stage"
                      onClick={() => back && change(c, { pipeline_stage: back as PipelineStage })} style={{ padding: "0 6px", opacity: back ? 1 : 0.35 }}>
                      <ChevronLeft size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className={styles.miniBtn} disabled={b || !on} aria-label={`Move ${c.name} on a stage`} title="On a stage"
                      onClick={() => on && change(c, { pipeline_stage: on as PipelineStage })} style={{ padding: "0 6px", opacity: on ? 1 : 0.35 }}>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                    <span style={{ flex: 1 }} />
                    <button type="button" className={`${styles.miniBtn} ${styles.miniPrimary}`} disabled={b}
                      onClick={() => change(c, { status: "engaged" }, `/clients/all/${c.slug}`)}>Convert</button>
                  </div>
                  <button type="button" className="btn-text" disabled={b} style={{ alignSelf: "flex-start", height: 26, padding: 0, fontSize: 12 }}
                    onClick={() => change(c, { status: "former", ended_reason: "Not taken up" })}>Not going ahead</button>
                </article>
              );
            })}
            {col.clients.length === 0 && <div className={styles.small} style={{ textAlign: "center", padding: "16px 4px" }}>Nothing here</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

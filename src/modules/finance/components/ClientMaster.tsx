"use client";

// The client list: every client, prospect and former client in one place,
// filtered, with its status and services, and a form to add one.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  STAGES, STATUS_LABEL, STATUS_TONE, activeServices, filterClients, pastServices, serviceLabel,
  type ClientFilter, type ClientStatus, type MasterClient,
} from "@/modules/finance/lib/clients";
import styles from "./Page.module.css";

const FILTERS: Array<{ key: ClientFilter; label: string }> = [
  { key: "clients", label: "Clients" },
  { key: "prospects", label: "Prospects" },
  { key: "former", label: "Former" },
  { key: "all", label: "All" },
];

const TH: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--sub)", textAlign: "left", padding: "10px 16px", borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap" };
const TD: React.CSSProperties = { fontSize: 13, color: "var(--tx)", padding: "12px 16px", borderBottom: "1px solid var(--bd)", verticalAlign: "middle" };
const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px", borderRadius: 6, fontSize: 12, background: "var(--cardhover)", color: "var(--label-text)", margin: "2px 4px 2px 0", whiteSpace: "nowrap" };
const pastChip: React.CSSProperties = { ...chip, background: "transparent", border: "1px dashed var(--bd)", color: "var(--sub)" };

function NewClient({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ClientStatus>("prospect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, status }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.issues?.join(" ") ?? body.error ?? "Could not add the client");
    router.push(`/clients/all/${body.slug}`);
  }

  return (
    <section className={`${styles.card} ${styles.pad} ${styles.stack} ${styles.narrow}`} aria-label="New client" style={{ marginBottom: 16 }}>
      <div className={styles.controls}>
        <label className={styles.label} htmlFor="new-client">Name</label>
        <input id="new-client" className={styles.select} style={{ flex: "1 1 220px" }} value={name} autoFocus
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) add(); }} />
        <div className="seg" role="group" aria-label="Start as">
          {(["prospect", "engaged"] as ClientStatus[]).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} className={status === s ? "seg-on" : undefined} onClick={() => setStatus(s)}>
              {s === "prospect" ? "Prospect" : "Client"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.controls}>
        <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={add}>{busy ? "Adding..." : "Add and set up"}</button>
        <button type="button" className="btn-text" onClick={onDone}>Cancel</button>
        <span className={styles.small}>A prospect starts in the pipeline at First contact.</span>
      </div>
      {error && <div className={styles.warn}>{error}</div>}
    </section>
  );
}

export default function ClientMaster({ clients }: { clients: MasterClient[] }) {
  const [filter, setFilter] = useState<ClientFilter>("clients");
  const [adding, setAdding] = useState(false);
  const shown = filterClients(clients, filter);

  return (
    <div>
      <div className={styles.controls} style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="Show">
          {FILTERS.map((f) => {
            const n = filterClients(clients, f.key).length;
            return (
              <button key={f.key} type="button" aria-pressed={filter === f.key} className={filter === f.key ? "seg-on" : undefined} onClick={() => setFilter(f.key)}>
                {f.label}<span style={{ opacity: 0.7, marginLeft: 6 }}>{n}</span>
              </button>
            );
          })}
        </div>
        {!adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" />New client</button>}
      </div>

      {adding && <NewClient onDone={() => setAdding(false)} />}

      <section className={styles.card} style={{ overflowX: "auto", maxWidth: 1100 }} aria-label="Clients">
        {shown.length === 0 ? (
          <div className={styles.empty}>{filter === "prospects" ? "No prospects in the pipeline." : "Nothing here."}</div>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680 }}>
            <thead>
              <tr><th style={TH}>Client</th><th style={TH}>Status</th><th style={TH}>Services</th><th style={TH}>Companies</th></tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const active = activeServices(c);
                const past = pastServices(c);
                const stage = c.status === "prospect" ? STAGES.find((s) => s.key === c.pipeline_stage)?.label : null;
                return (
                  <tr key={c.id}>
                    <td style={TD}>
                      <Link href={`/clients/all/${c.slug}`} style={{ fontWeight: 500, color: "var(--tx)" }}>{c.name}</Link>
                      {c.legal_name && c.legal_name !== c.name && <div className={styles.small}>{c.legal_name}</div>}
                    </td>
                    <td style={TD}>
                      <span className={`${styles.status} ${styles[STATUS_TONE[c.status]]}`}><span className={styles.dot} />{STATUS_LABEL[c.status]}</span>
                      {stage && <div className={styles.small} style={{ marginTop: 4 }}>{stage}</div>}
                    </td>
                    <td style={TD}>
                      {active.map((s) => <span key={s.service} style={chip}>{serviceLabel(s.service)}</span>)}
                      {past.map((s) => <span key={s.service} style={pastChip}>{serviceLabel(s.service)} (completed)</span>)}
                      {!active.length && !past.length && <span className={styles.small}>None yet</span>}
                    </td>
                    <td style={{ ...TD, color: c.companies ? "var(--tx)" : "var(--sub)" }}>{c.companies || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

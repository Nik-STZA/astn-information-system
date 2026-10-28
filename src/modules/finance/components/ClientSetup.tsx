"use client";

// One client's set-up: where it sits with us, its details, the services it
// takes, and the history of every change. Completing a service asks for a
// closing note; nothing is ever deleted.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ClipboardCheck, MessagesSquare, Receipt } from "lucide-react";
import {
  SERVICES, STAGES, STATUS_LABEL, eventText, mayHaveEnded,
  type ClientEvent, type ClientService, type ClientStatus, type MasterClient, type PipelineStage, type ServiceKey, type ServiceState,
} from "@/modules/finance/lib/clients";
import styles from "./Page.module.css";

const ICON: Record<ServiceKey, React.ReactNode> = {
  finance: <Receipt size={18} aria-hidden="true" />,
  data_protection: <ClipboardCheck size={18} aria-hidden="true" />,
  consulting: <MessagesSquare size={18} aria-hidden="true" />,
};

const fmtDate = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, padding: "10px 16px", borderBottom: "1px solid var(--bd)" };
const input: React.CSSProperties = { height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", font: "400 13px var(--font-sans)" };

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.issues?.join(" ") ?? b.error ?? "Could not save";
}

function ServiceRow({ client, svc, busy, onChange }: {
  client: MasterClient;
  svc: ClientService;
  busy: boolean;
  onChange: (state: ServiceState, note?: string) => void;
}) {
  const def = SERVICES.find((s) => s.key === svc.service)!;
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const options: Array<{ state: ServiceState; label: string }> = [
    { state: null, label: "Not taken" },
    { state: "active", label: "Active" },
    { state: "completed", label: "Completed" },
  ];
  const open =
    svc.service === "finance" ? { href: `/finance/clients/${client.slug}/work`, label: "Open Finance" }
    : svc.service === "data_protection" && client.compliance_client_id ? { href: "/clients", label: "Open in Engagements" }
    : null;

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 16, borderBottom: "1px solid var(--bd)" }}>
      <span style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 10, background: "var(--cardhover)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--label-text)" }}>{ICON[svc.service]}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div className={styles.rowTitle} style={{ fontSize: 14 }}>{def.label}</div>
        <div className={styles.small}>{def.blurb}</div>
        {svc.state === "active" && (
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {svc.started_on ? `Active since ${fmtDate(svc.started_on)}.` : "Active."}
            {open && <> <Link href={open.href}>{open.label}</Link></>}
          </div>
        )}
        {svc.state === "completed" && (
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Completed {fmtDate(svc.ended_on)}.{svc.closing_note ? ` ${svc.closing_note}` : ""} Its pages stay readable under Past.
          </div>
        )}
        <div className="seg" role="group" aria-label={`${def.label} for ${client.name}`} style={{ marginTop: 10 }}>
          {options.map((o) => (
            <button key={String(o.state)} type="button" disabled={busy} aria-pressed={svc.state === o.state}
              className={svc.state === o.state ? "seg-on" : undefined}
              onClick={() => { if (o.state === svc.state) return; if (o.state === "completed") setClosing(true); else { setClosing(false); onChange(o.state); } }}>
              {o.label}
            </button>
          ))}
        </div>
        {closing && (
          <div className={styles.controls} style={{ marginTop: 10 }}>
            <input aria-label="Closing note" placeholder="What was delivered, in a line" value={note} onChange={(e) => setNote(e.target.value)}
              style={{ ...input, flex: "1 1 240px" }} />
            <button type="button" className="btn-primary" disabled={busy} onClick={() => { onChange("completed", note); setClosing(false); setNote(""); }}>Complete</button>
            <button type="button" className="btn-text" onClick={() => setClosing(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClientSetup({ client, events }: { client: MasterClient; events: ClientEvent[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState({
    name: client.name, legal_name: client.legal_name ?? "", jurisdiction: client.jurisdiction ?? "",
    contact: client.contact ?? "", lead_email: client.lead_email ?? "",
  });
  const base = `/api/clients/${client.slug}`;

  async function run(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    const err = await send(url, method, body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  const changedDetails = Object.fromEntries(
    Object.entries(details).filter(([k, v]) => v.trim() !== String((client as unknown as Record<string, unknown>)[k] ?? "")).map(([k, v]) => [k, v.trim() || null])
  );

  return (
    <div>
      <Link href="/clients/all" className={styles.back}><ArrowLeft size={14} aria-hidden="true" />All clients</Link>

      <div className={styles.controls} style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <h1>{client.name}</h1>
          <p className={styles.small} style={{ margin: "4px 0 0" }}>Client set-up</p>
        </div>
        <div className="seg" role="group" aria-label="Status" style={{ flexWrap: "wrap" }}>
          {(["prospect", "engaged", "former", "internal"] as ClientStatus[]).map((s) => (
            <button key={s} type="button" disabled={busy} aria-pressed={client.status === s} className={client.status === s ? "seg-on" : undefined}
              onClick={() => client.status !== s && run(base, "PATCH", { status: s })}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.error} role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      {client.status === "prospect" && (
        <section className={`${styles.card} ${styles.pad} ${styles.controls}`} style={{ marginBottom: 16, maxWidth: 1100 }} aria-label="Pipeline">
          <span className={styles.label}>Pipeline stage</span>
          <div className="seg" role="group" aria-label="Pipeline stage" style={{ flexWrap: "wrap" }}>
            {STAGES.map((s) => (
              <button key={s.key} type="button" disabled={busy} aria-pressed={client.pipeline_stage === s.key} className={client.pipeline_stage === s.key ? "seg-on" : undefined}
                onClick={() => run(base, "PATCH", { pipeline_stage: s.key as PipelineStage })}>{s.label}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => run(base, "PATCH", { status: "engaged" })}>Convert to client</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(base, "PATCH", { status: "former", ended_reason: "Not taken up" })}>Not going ahead</button>
        </section>
      )}

      {mayHaveEnded(client) && (
        <div className={`${styles.card} ${styles.pad} ${styles.controls}`} style={{ marginBottom: 16, maxWidth: 1100, justifyContent: "space-between" }} role="status">
          <span style={{ fontSize: 13 }}>Nothing is active for {client.name}. If the relationship has ended, mark them as former: their history stays, and they leave the menu.</span>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(base, "PATCH", { status: "former" })}>Mark as former</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16, maxWidth: 1100, alignItems: "start" }}>
        <section className={styles.card} aria-label="Details">
          <div className={styles.cardHead}><h2>Details</h2></div>
          {([
            ["name", "Name"], ["legal_name", "Legal name"], ["jurisdiction", "Jurisdiction"],
            ["contact", "Main contact"], ["lead_email", "Lead at STZA (email)"],
          ] as Array<[keyof typeof details, string]>).map(([k, label]) => (
            <div key={k} style={field}>
              <label className={styles.small} htmlFor={`f-${k}`}>{label}</label>
              <input id={`f-${k}`} style={input} value={details[k]} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} />
            </div>
          ))}
          <div style={{ padding: "12px 16px" }}>
            <button type="button" className="btn-primary" disabled={busy || !Object.keys(changedDetails).length}
              onClick={() => run(base, "PATCH", changedDetails)}>Save details</button>
          </div>
        </section>

        <section className={styles.card} aria-label="Services">
          <div className={styles.cardHead}><h2>Services</h2><span className={styles.small}>Active shows its sections under this client</span></div>
          {client.services.map((s) => (
            <ServiceRow key={s.service} client={client} svc={s} busy={busy}
              onChange={(state, note) => run(`${base}/services/${s.service}`, "PUT", { state, ...(note ? { closing_note: note } : {}) })} />
          ))}
        </section>
      </div>

      <div className={styles.listHead}><h2>History</h2></div>
      <section className={styles.card} style={{ maxWidth: 1100 }} aria-label="History">
        {events.length === 0 ? (
          <div className={styles.empty}>No changes recorded yet.</div>
        ) : (
          events.map((e, i) => (
            <div key={i} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.grow}>{eventText(e)}</span>
                <span className={styles.small}>{e.actor_email.split("@")[0]} · {fmtWhen(e.at)}</span>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

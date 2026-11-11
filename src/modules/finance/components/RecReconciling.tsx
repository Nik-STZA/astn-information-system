"use client";

// A bank reconciliation worked on the platform (11 Nov 2026): the bank's own
// export is uploaded, set against Xero from the last day they agreed, and what
// does not match is held here as reconciling items until it clears.
//
// Statement balance + in Xero only - on the statement only = the ledger.
// Built for a phone first: rows, not tables.

import { useState } from "react";
import { Upload } from "lucide-react";
import { KIND_LABEL, SIDE_LABEL, dayLabel, money, type RecDetail, type RecEvidence, type ReconcilingItem, type ReconcilingKind } from "@/modules/finance/lib/recs";
import styles from "./Recs.module.css";

type Send = (path: string, body?: unknown, method?: string) => Promise<boolean>;

const MAX_BYTES = 700 * 1024;
const KINDS: ReconcilingKind[] = ["timing", "unreconciled", "error", "query"];

// A file as base64, in pieces so a large one does not overflow the stack.
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Money into the account positive; money out shows in brackets, as elsewhere.
const signed = (v: string | null) => money(v);

export default function RecReconciling({ data, ev, preparing, busy, send }: { data: RecDetail; ev: RecEvidence; preparing: boolean; busy: boolean; send: Send }) {
  const companies = data.cover.rows;
  const [entity, setEntity] = useState(companies[0]?.entity_id ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ side: "xero_only", kind: "timing", txn_date: "", description: "", amount: "", note: "" });
  const items = ev.reconciling ?? [];
  const open = items.filter((i) => i.state === "open");
  const cleared = items.filter((i) => i.state === "cleared");
  const [showCleared, setShowCleared] = useState(false);

  const upload = async (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) { setLocalError(`${file.name} is over ${Math.round(MAX_BYTES / 1024)} KB: export a shorter date range`); return; }
    await send("statement", { entity_id: entity, file_name: file.name, content_base64: await base64Of(file) });
  };

  return (
    <section className={`${styles.card} ${styles.section}`}>
      <div className={styles.cardHead}>
        <h2 className={styles.h2}>Bank statement and reconciling items</h2>
        <span className={styles.small}>Statement balance, plus what is in Xero but not yet on the statement, less what is on the statement but not in Xero, equals the ledger.</span>
      </div>

      {(ev.statements ?? []).map((st) => (
        <div key={st.id} className={styles.pad} style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className={styles.sub}><strong>{st.entity}</strong> · {st.file_name}</div>
          <div className={styles.small}>
            {st.line_count.toLocaleString("en-GB")} lines, {dayLabel(st.first_date)} to {dayLabel(st.last_date)}. Balance at the month end {signed(st.balance_at_end)}.
          </div>
          {st.said.map((s, i) => <div key={i} className={styles.small}>{s}</div>)}
        </div>
      ))}

      {(ev.bridge ?? []).filter((b) => b.evidence !== null || b.open > 0).map((b) => (
        <div key={b.entity_id} className={styles.pad} style={{ borderBottom: "1px solid var(--bd)" }}>
          {(ev.bridge ?? []).length > 1 && <div className={styles.sub}><strong>{b.entity}</strong></div>}
          <Line label="Statement balance" value={signed(b.evidence)} />
          <Line label="Add: in Xero, not on the statement" value={signed(b.xero_only)} />
          <Line label="Less: on the statement, not in Xero" value={signed(b.bank_only)} />
          <Line label="Comes to" value={signed(b.adjusted)} strong />
          <Line label="Ledger in Xero" value={signed(b.ledger)} />
          <Line label="Difference" value={signed(b.difference)} strong warn={b.difference !== null && Number(b.difference) !== 0} />
          {b.blocking > 0 && <div className={styles.small} style={{ marginTop: 6 }}>{b.blocking} open item{b.blocking === 1 ? "" : "s"} other than timing must be fixed or cleared before sign-off.</div>}
        </div>
      ))}

      {preparing && ev.statement_upload && (
        <div className={styles.pad} style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className={styles.actions} style={{ alignItems: "center" }}>
            {companies.length > 1 && (
              <select className={styles.pick} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Company">
                {companies.map((r) => <option key={r.entity_id} value={r.entity_id}>{r.entity}</option>)}
              </select>
            )}
            <label className="btn-secondary" style={{ cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Upload size={14} aria-hidden="true" />
              {(ev.statements ?? []).length ? "Upload the statement again" : "Upload the bank statement"}
              <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy}
                style={{ display: "none" }} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
          <div className={styles.small} style={{ marginTop: 6 }}>
            The bank&apos;s transaction export, CSV or Excel, with its balance column, from a date you know it agreed (or as far back as the bank allows) to after the month end. The file is read, not kept.
          </div>
          {localError && <div className={styles.small} style={{ marginTop: 6, color: "var(--alert-red)" }}>{localError}</div>}
        </div>
      )}

      <div className={styles.pad}>
        {open.length === 0
          ? <span className={styles.sub}>No open reconciling items.</span>
          : open.map((it) => <Item key={it.id ?? `${it.txn_date}${it.amount}`} it={it} preparing={preparing} busy={busy} send={send} many={companies.length > 1} />)}
        {cleared.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn-text" onClick={() => setShowCleared(!showCleared)}>{showCleared ? "Hide" : "Show"} {cleared.length} cleared</button>
            {showCleared && cleared.map((it) => <Item key={it.id ?? `${it.txn_date}${it.amount}`} it={it} preparing={preparing} busy={busy} send={send} many={companies.length > 1} />)}
          </div>
        )}
      </div>

      {preparing && (
        <div className={styles.pad} style={{ borderTop: "1px solid var(--bd)" }}>
          <button type="button" className="btn-text" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add a reconciling item"}</button>
          {adding && (
            <div className={styles.evForm}>
              {companies.length > 1 && (
                <select className={styles.pick} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Company">
                  {companies.map((r) => <option key={r.entity_id} value={r.entity_id}>{r.entity}</option>)}
                </select>
              )}
              <select className={styles.pick} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} aria-label="Where it is">
                <option value="xero_only">{SIDE_LABEL.xero_only}</option>
                <option value="bank_only">{SIDE_LABEL.bank_only}</option>
              </select>
              <select className={styles.pick} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Kind">
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <input className={styles.input} type="date" value={form.txn_date} onChange={(e) => setForm({ ...form, txn_date: e.target.value })} aria-label="Date" />
              <input className={styles.input} placeholder="What it is" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Description" />
              <input className={styles.input} inputMode="decimal" placeholder="Amount: money in positive, out negative" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="Amount" />
              <input className={styles.input} placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" />
              <button type="button" className="btn-primary" disabled={busy || !form.amount || form.description.trim().length < 3}
                onClick={async () => {
                  const ok = await send("reconciling", { ...form, entity_id: entity, txn_date: form.txn_date || null, amount: Number(form.amount.replace(/[,£\s]/g, "")) });
                  if (ok) { setAdding(false); setForm({ ...form, txn_date: "", description: "", amount: "", note: "" }); }
                }}>Save item</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Line({ label, value, strong = false, warn = false }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 15rem) 8rem", justifyContent: "start", columnGap: 12, fontSize: 13, lineHeight: 1.7, fontWeight: strong ? 600 : 400, color: warn ? "var(--alert-red)" : "var(--tx)" }}>
      <span>{label}</span><span className={styles.num}>{value}</span>
    </div>
  );
}

function Item({ it, preparing, busy, send, many }: { it: ReconcilingItem; preparing: boolean; busy: boolean; send: Send; many: boolean }) {
  const [clearing, setClearing] = useState(false);
  const [why, setWhy] = useState("");
  const live = preparing && it.id && it.state === "open";
  return (
    <div className={styles.evRow} style={{ flexWrap: "wrap" }}>
      <div className={styles.evMain}>
        <div><strong>{signed(it.amount)}</strong> · {it.txn_date ? dayLabel(it.txn_date) : "no date"}{many ? ` · ${it.entity}` : ""}</div>
        <div className={styles.small}>{it.description ?? "-"}</div>
        <div className={styles.small}>{SIDE_LABEL[it.side]}{it.source === "keyed" && it.added_by ? ` · added by ${it.added_by.startsWith("agent:") ? it.added_by.slice(6).toUpperCase() : it.added_by}` : " · from the statement"}</div>
        {it.note && <div className={styles.small}>{it.note}</div>}
        {it.state === "cleared" && <div className={styles.small}>Cleared{it.cleared_at ? ` ${dayLabel(it.cleared_at)}` : ""}{it.cleared_note ? `: ${it.cleared_note}` : ""}</div>}
        {live ? (
          <select className={styles.pick} style={{ marginTop: 6 }} value={it.kind} disabled={busy} onChange={(e) => void send(`reconciling/${it.id}`, { kind: e.target.value }, "PATCH")} aria-label="Kind">
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        ) : <div className={styles.small}>{KIND_LABEL[it.kind]}</div>}
        {clearing && (
          <div className={styles.actions} style={{ marginTop: 6 }}>
            <input className={styles.input} placeholder="Why it is cleared: through the bank on a date, fixed in Xero, explained" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Why it is cleared" />
            <button type="button" className="btn-primary" disabled={busy || why.trim().length < 5}
              onClick={async () => { if (await send(`reconciling/${it.id}`, { state: "cleared", cleared_note: why }, "PATCH")) setClearing(false); }}>Clear</button>
          </div>
        )}
      </div>
      {preparing && it.id && (
        <div className={styles.actions}>
          {it.state === "open" && !clearing && <button type="button" className="btn-text" disabled={busy} onClick={() => setClearing(true)}>Clear</button>}
          {it.state === "cleared" && <button type="button" className="btn-text" disabled={busy} onClick={() => void send(`reconciling/${it.id}`, { state: "open" }, "PATCH")}>Reopen</button>}
          {it.source === "keyed" && <button type="button" className="btn-text" disabled={busy} onClick={() => void send(`reconciling/${it.id}`, {}, "DELETE")}>Remove</button>}
        </div>
      )}
    </div>
  );
}

"use client";

// One contract (15 Nov 2026): how it becomes revenue or cost in three layers
// (standard pattern, the client's rules, this contract), its payments and
// milestones, what it holds on the balance sheet against the ledger, and its
// terms. Changes go through /api/finance/<slug>/contracts as the person.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./Contracts.module.css";
import page from "./Page.module.css";
import { dateLabel, DECISION_LABEL, FREQUENCY_LABEL, money, RENEWAL_LABEL, type ContractDetail as Detail, type Decision, type ScheduleItem } from "@/modules/finance/lib/contracts";

export default function ContractDetail({ slug, d }: { slug: string; d: Detail }) {
  const router = useRouter();
  const c = d.contract;
  const base = `/api/finance/${encodeURIComponent(slug)}/contracts/${c.id}`;
  const here = `/finance/clients/${encodeURIComponent(slug)}/contracts`;
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [pattern, setPattern] = useState(c.pattern);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [ending, setEnding] = useState(false);
  const active = c.status === "active";
  const cur = c.currency;

  async function call(path: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setIssues([]);
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setIssues(out.issues ?? [out.error ?? `Not saved (${r.status})`]); return false; }
    router.refresh();
    return true;
  }

  const payments = d.schedule.filter((s) => s.kind === "payment");
  const milestones = d.schedule.filter((s) => s.kind === "milestone");
  const sidePatterns = d.patterns.filter((p) => p.side === c.side);
  const approvedRules = d.client_rules.filter((r) => r.status === "approved");
  const draftRules = d.client_rules.filter((r) => r.status === "draft");
  const paid = payments.reduce((s, p) => s + (p.received_amount ?? (p.status === "met" ? p.amount ?? 0 : 0)), 0);

  return (
    <div>
      {issues.length > 0 && <div className={styles.issues} role="alert" style={{ margin: "0 0 12px" }}>Not saved:<ul>{issues.map((x) => <li key={x}>{x}</li>)}</ul></div>}

      {c.renewal !== "no" && c.status === "active" && (
        <Renewal c={c} busy={busy} onDecide={(body) => call("/renewal-decision", "POST", body)} />
      )}

      <section className={`${page.card} ${styles.section}`} aria-labelledby="how">
        <div className={page.cardHead}>
          <h2 id="how">How this contract becomes {c.side === "customer" ? "revenue" : "cost"}</h2>
          {c.pattern_confirmed_at
            ? <span className={styles.meta}>Confirmed by {c.pattern_confirmed_by} on {dateLabel(c.pattern_confirmed_at)}</span>
            : <span className={`${styles.pill} ${styles.pillAccent}`}>To confirm</span>}
        </div>
        <div className={styles.layers}>
          <div className={styles.layer}>
            <span className={styles.layerHead}>1. Standard pattern</span>
            <strong>{d.pattern?.label ?? c.pattern_label}</strong>
            <span>{d.pattern?.rule}</span>
            <span className={styles.meta}>Evidence: {d.pattern?.evidence}</span>
          </div>
          {c.side === "customer" && (
            <div className={styles.layer}>
              <span className={styles.layerHead}>2. This client&apos;s rules</span>
              {approvedRules.map((r) => <span key={r.title}>{r.title}{r.summary ? `: ${r.summary}` : ""}</span>)}
              {draftRules.map((r) => <span key={r.title} className={styles.meta}>Draft, not yet approved: {r.title}</span>)}
              {!d.client_rules.length && <span className={styles.meta}>None on the revenue procedure. Add them under Procedures.</span>}
            </div>
          )}
          <div className={styles.layer}>
            <span className={styles.layerHead}>{c.side === "customer" ? "3" : "2"}. This contract</span>
            <span>{milestones.length ? `${milestones.length} milestone${milestones.length === 1 ? "" : "s"}` : "No milestones"}, {payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"}` : "no payment schedule"}.</span>
            {c.payment_terms && <span className={styles.meta}>{c.payment_terms}</span>}
          </div>
        </div>
        {active && (
          <div className={styles.actions}>
            <label className={styles.field} style={{ minWidth: 200, flex: "0 1 260px" }}>{c.pattern_confirmed_at ? "Change the pattern" : "Pattern"}
              <select className={styles.select} value={pattern} onChange={(e) => setPattern(e.target.value)}>
                {sidePatterns.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            {(!c.pattern_confirmed_at || pattern !== c.pattern) && (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => call("/confirm-pattern", "POST", { pattern })}>
                {pattern === c.pattern ? `Confirm ${c.pattern_label.toLowerCase()}` : "Change and confirm"}
              </button>
            )}
            <span className={styles.meta}>The CFO confirms.</span>
          </div>
        )}
      </section>

      <section className={`${page.card} ${styles.section}`} aria-labelledby="sched">
        <div className={page.cardHead}>
          <h2 id="sched">Payments and milestones</h2>
          {payments.length > 0 && <span className={styles.meta}>Received {money(paid, cur)} of {money(payments.reduce((s, p) => s + (p.amount ?? 0), 0), cur)}</span>}
        </div>
        {d.schedule.length === 0 && <div className={styles.empty}>No payments or milestones yet.</div>}
        {[...payments, ...milestones].map((s) => (
          <ScheduleRow key={s.id} s={s} cur={cur} busy={busy} open={editing === s.id} active={active}
            onOpen={() => setEditing(editing === s.id ? null : s.id)}
            onSave={async (body) => { if (await call(`/schedule/${s.id}`, "PATCH", body)) setEditing(null); }} />
        ))}
        {active && (adding
          ? <AddLine busy={busy} onCancel={() => setAdding(false)} onAdd={async (body) => { if (await call("/schedule", "POST", body)) setAdding(false); }} />
          : <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => setAdding(true)}>Add a payment or milestone</button></div>)}
      </section>

      {/* Always on a customer contract (15 Nov 2026: the first live contract,
          read from a PDF, had no account code, so this section was hidden and
          nothing could be recorded against the Income in Advance rec). */}
      {(c.side === "customer" || c.account_code || d.movements.length > 0) && (
        <section className={`${page.card} ${styles.section}`} aria-labelledby="held">
          <div className={page.cardHead}>
            <h2 id="held">{c.account_code ? `Held on account ${c.account_code}` : "Held on the balance sheet"}</h2>
            <span className={styles.amount}>{money(d.held, cur)}</span>
          </div>
          {!c.account_code && (
            <div className={styles.notice} style={{ marginTop: 12 }}>
              No balance sheet account is set, so the reconciliation cannot match this contract to the ledger.
              {active ? <> Set the Xero code it holds money on (for deferred income, usually 810) under <Link prefetch={false} href={`${here}/${c.id}?edit=1`}>Terms, Edit</Link>, then record what has been billed in.</> : null}
            </div>
          )}
          {d.ledger && (
            <div className={styles.tieRow}>
              <span className={styles.grow}>At {dateLabel(d.ledger.period_end)}, the latest reconciled month</span>
              <span>Register {money(d.ledger.register)}</span>
              <span>Ledger {money(d.ledger.closing)}</span>
              {Math.round(d.ledger.register * 100) === Math.round(d.ledger.closing * 100)
                ? <span className={styles.agrees}>Agrees</span>
                : <span className={styles.differs}>Differs: other contracts may share the account</span>}
            </div>
          )}
          {d.movements.map((m) => (
            <div key={m.id} className={styles.tieRow} style={m.withdrawn_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
              <span className={styles.grow}>{dateLabel(m.on_date)} · {m.kind === "billed" ? "Billed in" : "Released"}{m.ref ? ` · ${m.ref}` : ""}{m.note ? ` · ${m.note}` : ""}</span>
              <span>{m.kind === "released" ? "-" : ""}{money(m.amount, cur)}</span>
              {!m.withdrawn_at && active && <button type="button" className={styles.btn} disabled={busy} onClick={() => call(`/movements/${m.id}/withdraw`, "POST", {})}>Withdraw</button>}
            </div>
          ))}
          {active && c.account_code && (moving
            ? <AddMovement busy={busy} onCancel={() => setMoving(false)} onAdd={async (body) => { if (await call("/movements", "POST", body)) setMoving(false); }} />
            : <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={() => setMoving(true)}>Record billed or released</button>
                <span className={styles.meta}>A release is recorded once its journal is in Xero.</span>
              </div>)}
        </section>
      )}

      <section className={`${page.card} ${styles.section}`} aria-labelledby="terms">
        <div className={page.cardHead}>
          <h2 id="terms">Terms</h2>
          {active && <Link prefetch={false} className={styles.btn} href={`${here}/${c.id}?edit=1`}>Edit</Link>}
        </div>
        <div className={styles.facts}>
          <Fact label="Company" value={c.entity_name} />
          <Fact label="Side" value={c.side === "customer" ? "Customer: the company sells" : "Supplier: the company buys"} />
          <Fact label="Reference" value={c.reference} />
          <Fact label="Total value" value={c.total_value != null ? money(c.total_value, cur) : null} />
          <Fact label="Starts" value={c.start_date ? dateLabel(c.start_date) : null} />
          <Fact label="Ends" value={c.end_date ? dateLabel(c.end_date) : null} />
          <Fact label="Renewal" value={RENEWAL_LABEL[c.renewal]} />
          <Fact label="Notice" value={c.notice_days != null ? `${c.notice_days} days${c.notice_by ? `, by ${dateLabel(c.notice_by)}` : ""}` : null} />
          <Fact label="Payment terms" value={c.payment_terms} />
          <Fact label="Price" value={c.cost_amount != null && c.billing_frequency ? `${money(c.cost_amount, cur)} ${FREQUENCY_LABEL[c.billing_frequency]}${c.annual_value != null ? ` (${money(c.annual_value, cur)} a year)` : ""}` : null} />
          <div className={styles.fact}>
            <span className={styles.factLabel}>Signed contract</span>
            <span className={styles.factValue}>{c.document_url ? <a href={c.document_url} target="_blank" rel="noopener noreferrer">Open the document</a> : "-"}</span>
          </div>
          <Fact label="Added" value={`${dateLabel(c.created_at)} by ${c.created_by}${c.source === "upload" ? ", from a PDF" : ""}`} />
          {d.upload && <Fact label="Read from" value={`${d.upload.file_name} (file deleted once read)`} />}
          {c.status !== "active" && <Fact label={c.status === "ended" ? "Ended" : "Cancelled"} value={c.end_reason} />}
        </div>
        {c.notes && <div className={styles.notice} style={{ whiteSpace: "pre-line" }}>{c.notes}</div>}
        {active && (ending
          ? <EndForm busy={busy} onCancel={() => setEnding(false)} onEnd={(body) => call("/end", "POST", body)} />
          : <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => setEnding(true)}>End or cancel</button></div>)}
      </section>
    </div>
  );
}

// The coming renewal: when it renews, the notice deadline, what it is worth,
// and the decision (keep, cancel, renegotiate) with why. Any role records it.
function Renewal({ c, busy, onDecide }: { c: Detail["contract"]; busy: boolean; onDecide: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [choice, setChoice] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const decided = c.renewal_decision ?? null;
  return (
    <section className={`${page.card} ${styles.section}`} aria-labelledby="renewal">
      <div className={page.cardHead}>
        <h2 id="renewal">{c.end_date ? `Renews on ${dateLabel(c.end_date)}` : "Renewal"}</h2>
        {decided
          ? <span className={`${styles.pill} ${decided === "keep" ? "" : styles.pillAccent}`}>Decided: {DECISION_LABEL[decided]}</span>
          : c.end_date ? <span className={`${styles.pill} ${styles.pillAccent}`}>To decide</span> : null}
      </div>
      <div className={styles.facts}>
        <Fact label="How" value={RENEWAL_LABEL[c.renewal]} />
        <Fact label="Notice by" value={c.notice_by ? dateLabel(c.notice_by) : c.notice_days == null ? "Notice period not set" : null} />
        <Fact label="At stake" value={c.annual_value != null ? `${money(c.annual_value, c.currency)} a year` : "No price set"} />
        {decided && <Fact label="Why" value={`${c.renewal_decision_note ?? ""}${c.renewal_decided_by ? ` (${c.renewal_decided_by}, ${dateLabel(c.renewal_decided_at)})` : ""}`} />}
      </div>
      {!c.end_date
        ? <div className={styles.notice}>Set the end date under Terms to track this renewal.</div>
        : (
          <div className={styles.actions}>
            {(["keep", "cancel", "renegotiate"] as Decision[]).map((d) => (
              <button key={d} type="button" className={`${styles.btn} ${choice === d ? styles.btnPrimary : ""}`} disabled={busy} onClick={() => setChoice(d)}>{DECISION_LABEL[d]}</button>
            ))}
            {choice && (
              <>
                <label className={styles.field} style={{ flex: "1 1 240px" }}>Why
                  <input className={styles.input} value={note} placeholder={choice === "cancel" ? "e.g. not used since July" : ""} onChange={(e) => setNote(e.target.value)} />
                </label>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || note.trim().length < 5}
                  onClick={async () => { if (await onDecide({ decision: choice, note })) { setChoice(null); setNote(""); } }}>
                  {decided ? "Change the decision" : "Record the decision"}
                </button>
              </>
            )}
            {!choice && <span className={styles.meta}>{choice === null && decided === "cancel" && c.notice_by ? `Give notice by ${dateLabel(c.notice_by)}, then end the contract below.` : "Keep closes the notice task; cancel and renegotiate keep it open."}</span>}
          </div>
        )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className={styles.fact}><span className={styles.factLabel}>{label}</span><span className={styles.factValue}>{value || "-"}</span></div>;
}

function ScheduleRow({ s, cur, busy, open, active, onOpen, onSave }: {
  s: ScheduleItem; cur: string; busy: boolean; open: boolean; active: boolean; onOpen: () => void; onSave: (b: Record<string, unknown>) => void;
}) {
  const [v, setV] = useState({
    due_on: s.due_on ?? "", expected: s.expected ?? "", status: s.status,
    received_amount: s.received_amount != null ? String(s.received_amount) : "", received_on: s.received_on ?? "", evidence: s.evidence ?? "", note: s.note ?? "",
  });
  const met = s.status === "met";
  const statusText = s.status === "cancelled" ? "Cancelled"
    : met ? (s.kind === "milestone" ? `Met: ${s.evidence ?? ""}` : `Received ${money(s.received_amount ?? s.amount, cur)}${s.received_on ? ` on ${dateLabel(s.received_on)}` : ""}`)
    : s.due_on ? `Due ${dateLabel(s.due_on)}` : s.expected ? `Expected ${s.expected}` : "Date not set";
  return (
    <div className={styles.row}>
      <div>
        <div className={styles.name} style={{ textDecoration: "none" }}>{s.kind === "milestone" ? "Milestone" : `Payment ${s.seq}`}: {s.label}</div>
        <div className={styles.meta}>{s.trigger_text ?? ""}{s.note ? ` · ${s.note}` : ""}</div>
        <div className={styles.meta} style={{ color: met ? "var(--success-green)" : undefined }}>{statusText}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className={styles.amount}>{s.amount != null ? money(s.amount, cur) : ""}</div>
        {active && <button type="button" className={styles.btn} style={{ marginTop: 6 }} onClick={onOpen}>{open ? "Close" : "Update"}</button>}
      </div>
      {open && (
        <div className={styles.form} style={{ gridColumn: "1 / -1", padding: "8px 0 0" }}>
          <label className={styles.field}>Date<input className={styles.input} type="date" value={v.due_on} onChange={(e) => setV({ ...v, due_on: e.target.value })} /></label>
          <label className={styles.field}>Or expected<input className={styles.input} value={v.expected} onChange={(e) => setV({ ...v, expected: e.target.value })} /></label>
          <label className={styles.field}>Status
            <select className={styles.select} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ScheduleItem["status"] })}>
              <option value="pending">Pending</option>
              <option value="met">{s.kind === "milestone" ? "Met" : "Received"}</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          {s.kind === "payment" && <>
            <label className={styles.field}>Received<input className={styles.input} inputMode="decimal" value={v.received_amount} onChange={(e) => setV({ ...v, received_amount: e.target.value })} /></label>
            <label className={styles.field}>Received on<input className={styles.input} type="date" value={v.received_on} onChange={(e) => setV({ ...v, received_on: e.target.value })} /></label>
          </>}
          <label className={styles.field}>{s.kind === "milestone" ? "Evidence it is met (needed)" : "Evidence"}<input className={styles.input} value={v.evidence} placeholder={s.kind === "milestone" ? "e.g. signed handover note, 12 Feb 2027" : ""} onChange={(e) => setV({ ...v, evidence: e.target.value })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>Note<input className={styles.input} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
          <div className={styles.wide}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => onSave({
              due_on: v.due_on || null, expected: v.expected || null, status: v.status,
              ...(s.kind === "payment" ? { received_amount: v.received_amount === "" ? null : v.received_amount, received_on: v.received_on || null } : {}),
              evidence: v.evidence || null, note: v.note || null,
            })}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddLine({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [v, setV] = useState({ kind: "payment", label: "", trigger_text: "", amount: "", due_on: "", expected: "" });
  return (
    <div className={styles.form} style={{ borderTop: "1px solid var(--bd)" }}>
      <label className={styles.field}>Kind
        <select className={styles.select} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          <option value="payment">Payment</option>
          <option value="milestone">Milestone</option>
        </select>
      </label>
      <label className={styles.field}>Label<input className={styles.input} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></label>
      <label className={styles.field}>Due when<input className={styles.input} value={v.trigger_text} onChange={(e) => setV({ ...v, trigger_text: e.target.value })} /></label>
      <label className={styles.field}>Amount<input className={styles.input} inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></label>
      <label className={styles.field}>Date<input className={styles.input} type="date" value={v.due_on} onChange={(e) => setV({ ...v, due_on: e.target.value })} /></label>
      <label className={styles.field}>Or expected<input className={styles.input} value={v.expected} onChange={(e) => setV({ ...v, expected: e.target.value })} /></label>
      <div className={styles.wide} style={{ display: "flex", gap: 8 }}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => onAdd({
          kind: v.kind, label: v.label, trigger_text: v.trigger_text || null, amount: v.amount === "" ? null : v.amount, due_on: v.due_on || null, expected: v.expected || null,
        })}>Add</button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AddMovement({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [v, setV] = useState({ kind: "billed", on_date: "", amount: "", ref: "", note: "" });
  return (
    <div className={styles.form} style={{ borderTop: "1px solid var(--bd)" }}>
      <label className={styles.field}>What
        <select className={styles.select} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          <option value="billed">Billed into the account</option>
          <option value="released">Released from it</option>
        </select>
      </label>
      <label className={styles.field}>Date<input className={styles.input} type="date" value={v.on_date} onChange={(e) => setV({ ...v, on_date: e.target.value })} /></label>
      <label className={styles.field}>Amount<input className={styles.input} inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></label>
      <label className={styles.field}>Invoice or journal<input className={styles.input} value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} /></label>
      <label className={`${styles.field} ${styles.wide}`}>Note<input className={styles.input} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
      <div className={styles.wide} style={{ display: "flex", gap: 8 }}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => onAdd({ ...v, ref: v.ref || null, note: v.note || null })}>Record</button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function EndForm({ busy, onEnd, onCancel }: { busy: boolean; onEnd: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [v, setV] = useState({ status: "ended", reason: "" });
  return (
    <div className={styles.form} style={{ borderTop: "1px solid var(--bd)" }}>
      <label className={styles.field}>Status
        <select className={styles.select} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
          <option value="ended">Ended</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      <label className={`${styles.field} ${styles.wide}`}>Why (10 characters or more)<input className={styles.input} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></label>
      <div className={styles.wide} style={{ display: "flex", gap: 8 }}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || v.reason.trim().length < 10} onClick={() => onEnd(v)}>Confirm</button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

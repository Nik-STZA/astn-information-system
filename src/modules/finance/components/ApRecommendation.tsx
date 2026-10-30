"use client";

// The AP Clerk's suggested coding on a queue item, with one tap to use it.
// Using it is the CFO's decision (the same decision route as the coding form):
// an exception becomes approved, a clean bill is re-coded. Nothing goes to Xero
// until Send.

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./ApQueue.module.css";
import MarkdownOutput from "./MarkdownOutput";
import { shortDate } from "@/modules/finance/lib/ap-labels";
import type { ApRecommendation as Rec, ApState } from "@/modules/finance/lib/ap-queue";
import { SentNote, sendToXero } from "./ApActions";
import type { ApSendResult } from "@/modules/finance/lib/ap-queue";

export default function ApRecommendation({ slug, entity, itemId, state, rec, lines, labels, billSupplier }: {
  slug: string;
  entity: string;
  itemId: string;
  state: ApState;
  rec: Rec;
  lines: Array<{ description: string; account: string | null; tax: string | null }>;
  // Account and VAT names for rec.lines, in the same order (from the server).
  labels: Array<{ account: string; tax: string }>;
  billSupplier: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [sendIssues, setSendIssues] = useState<string[]>([]);
  const [sent, setSent] = useState<ApSendResult | null>(null);
  const open = ["exception", "clean", "approved"].includes(state);
  const inUse = rec.lines.every((l) => lines[l.index]?.account === l.account_code && lines[l.index]?.tax === l.tax_type);

  const supplierInUse = !rec.supplier || rec.supplier.name === billSupplier;

  // The right supplier on the bill: created in Xero first if it is a new one.
  async function useSupplier() {
    const s = rec.supplier;
    if (!s) return;
    setBusy(true); setError(null); setIssues([]);
    try {
      let contactId = s.contact_id;
      if (!contactId) {
        const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/supplier`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: s.name, vat_number: s.vat_number, country: s.country, item_id: itemId }),
        });
        const out = await res.json().catch(() => ({}));
        if (res.status === 422) { setIssues(out.issues ?? [out.error]); return; }
        if (!res.ok || !out.ContactID) throw new Error(out.error ?? `The supplier could not be created (${res.status})`);
        contactId = out.ContactID;
      }
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/items/${itemId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", note: `Supplier changed to ${s.name}`, edits: { contact: { ContactID: contactId, Name: s.name } } }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 422) { setIssues(out.issues ?? [out.error]); return; }
      if (!res.ok) throw new Error(out.error ?? `Not saved (${res.status})`);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Not saved"); } finally { setBusy(false); }
  }

  // thenSend: approve with this coding and send to Xero in the same tap.
  async function use(thenSend = false) {
    setBusy(true); setError(null); setIssues([]); setSendIssues([]);
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/items/${itemId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          note: "Coding as recommended by the AP Clerk",
          edits: {
            lines: rec.lines.map((l) => ({ index: l.index, account_code: l.account_code, tax_type: l.tax_type })),
            ...(rec.due_date ? { due_date: rec.due_date } : {}),
          },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 422) { setIssues(out.issues ?? [out.error]); return; }
      if (!res.ok) throw new Error(out.error ?? `Not saved (${res.status})`);
      if (thenSend) {
        const r = await sendToXero(slug, entity, itemId);
        if (r.validation !== "PASS") { setSendIssues(r.issues ?? ["Xero would not take it"]); return; }
        setSent(r);
      }
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Not saved"); } finally { setBusy(false); }
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>AP Clerk recommends</h3>
      <div className={styles.reason}>
        <div className={styles.reasonDetail}><MarkdownOutput text={rec.note} /></div>
      </div>
      {rec.supplier && (
        <div className={styles.line}>
          <div className={styles.lineTop}>
            <span className={styles.lineDesc}>Supplier: {rec.supplier.name}{rec.supplier.contact_id ? "" : " (new in Xero)"}</span>
          </div>
          <div className={styles.lineCoding}>
            <div>Bill has: {billSupplier ?? "no supplier"}</div>
            {rec.supplier.vat_number && <div>VAT number: {rec.supplier.vat_number}</div>}
            {rec.supplier.country && <div>Country: {rec.supplier.country}</div>}
          </div>
          <div className={styles.reasonDetail}>{rec.supplier.reason}</div>
          {open && !sent && !supplierInUse && (
            <div className={styles.buttonRow}>
              <button type="button" className={styles.buttonSecondary} onClick={useSupplier} disabled={busy}>
                {busy ? "Working..." : rec.supplier.contact_id ? "Use this supplier" : "Create in Xero and use"}
              </button>
            </div>
          )}
          {open && supplierInUse && <p className={styles.done}>This supplier is on the bill.</p>}
        </div>
      )}
      {rec.lines.map((l, n) => (
        <div key={l.index} className={styles.line}>
          <div className={styles.lineTop}>
            <span className={styles.lineDesc}>{lines[l.index]?.description ?? `Line ${l.index + 1}`}</span>
          </div>
          <div className={styles.lineCoding}>
            <div>Account: {labels[n]?.account ?? l.account_code}</div>
            <div>VAT: {labels[n]?.tax ?? l.tax_type}</div>
          </div>
          {l.reason && <div className={styles.reasonDetail}>{l.reason}</div>}
        </div>
      ))}
      {rec.due_date && <div className={styles.meta}>Due date: {shortDate(rec.due_date)}</div>}
      <div className={styles.meta}>Suggested {shortDate(rec.at)} for {rec.by_email}</div>
      {open && !inUse && !sent && (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.button} onClick={() => use(true)} disabled={busy}>
            {busy ? "Working..." : state === "exception" ? "Approve and send" : "Use and send"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={() => use(false)} disabled={busy}>
            {state === "exception" ? "Approve only" : "Use only"}
          </button>
        </div>
      )}
      {sent && <SentNote result={sent} />}
      {sendIssues.length > 0 && (
        <div className={styles.reason} role="alert">
          <div className={styles.reasonLabel}>Coding saved, but Xero would not take it yet</div>
          <ul className={styles.issueList}>{sendIssues.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {open && inUse && <p className={styles.done}>This coding is on the bill.</p>}
      {issues.length > 0 && (
        <div className={styles.reason} role="alert">
          <div className={styles.reasonLabel}>Not saved</div>
          <ul className={styles.issueList}>{issues.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

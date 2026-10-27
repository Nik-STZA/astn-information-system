"use client";

// The AP Clerk's suggested coding on a queue item, with one tap to use it.
// Using it is the CFO's decision (the same decision route as the coding form):
// an exception becomes approved, a clean bill is re-coded. Nothing goes to Xero
// until Send.

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./ApQueue.module.css";
import { shortDate } from "@/modules/finance/lib/ap-labels";
import type { ApRecommendation as Rec, ApState } from "@/modules/finance/lib/ap-queue";

export default function ApRecommendation({ slug, entity, itemId, state, rec, lines, labels }: {
  slug: string;
  entity: string;
  itemId: string;
  state: ApState;
  rec: Rec;
  lines: Array<{ description: string; account: string | null; tax: string | null }>;
  // Account and VAT names for rec.lines, in the same order (from the server).
  labels: Array<{ account: string; tax: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const open = ["exception", "clean", "approved"].includes(state);
  const inUse = rec.lines.every((l) => lines[l.index]?.account === l.account_code && lines[l.index]?.tax === l.tax_type);

  async function use() {
    setBusy(true); setError(null); setIssues([]);
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
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Not saved"); } finally { setBusy(false); }
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>AP Clerk recommends</h3>
      <div className={styles.reason}>
        <div className={styles.reasonDetail}>{rec.note}</div>
      </div>
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
      {open && !inUse && (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.button} onClick={use} disabled={busy}>
            {busy ? "Saving..." : state === "exception" ? "Approve with this coding" : "Use this coding"}
          </button>
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

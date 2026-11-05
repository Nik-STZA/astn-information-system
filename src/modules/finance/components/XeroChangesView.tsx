"use client";

// Proposed changes to Xero, grouped by where each one is: waiting for the CFO,
// to check in Xero (the last attempt did not finish cleanly), made, or
// rejected. Cards at every width, so it reads the same on a phone.
//
// Nothing here talks to Xero. Approving asks finance-api, which makes the
// change through the same write route Cowork uses.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import MarkdownOutput from "@/modules/finance/components/MarkdownOutput";
import { assetFacts, grouped, proposerLabel, type XeroChange, type XeroChangeList } from "@/modules/finance/lib/xero-changes";
import styles from "./Journals.module.css";

type Send = (path: string, body?: unknown) => Promise<boolean>;

const said = (b: Record<string, unknown>, fallback: string) =>
  String((b.issues as string[] | undefined)?.join(" ") ?? b.error ?? fallback);

export default function XeroChangesView({ slug, data, focus, all }: { slug: string; data: XeroChangeList; focus: string | null; all: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const send: Send = async (path, body = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/xero-changes/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(said(b, "That did not work"));
    else if (b.written) setNotice(`Made in Xero. ${b.after ?? ""}`.trim());
    router.refresh();
    return res.ok;
  };

  if (data.migration_missing) {
    return <div className={styles.alert} role="status">Xero changes are built but not switched on: migration 039 has not been applied to the database yet.</div>;
  }

  const groups = grouped(data.changes).filter((g) => g.rows.length > 0);

  return (
    <div>
      <div className={styles.bar}>
        <Link className="btn-secondary" href={`/finance/clients/${slug}/xero-changes${all ? "" : "?all=1"}`} prefetch={false}>
          {all ? "Show recent only" : "Show all"}
        </Link>
        <span className={styles.barEnd}>{data.counts?.waiting ?? 0} waiting for you</span>
      </div>

      {error && <div className={styles.err} role="alert">{error}</div>}
      {notice && <div className={styles.alert} role="status">{notice}</div>}

      {groups.length === 0 && (
        <div className={`${styles.card} ${styles.pad}`}>
          <span className={styles.sub}>Nothing proposed. FM1 and the FC propose fixed assets here when a purchase is missing from the register.</span>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className={styles.section} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className={styles.h2}>{g.title} <span className={styles.count}>{g.rows.length}</span></h2>
          <div style={{ display: "grid", gap: 8 }}>
            {g.rows.map((c) => (
              <details key={c.id} id={`c-${c.id}`} className={`${styles.card} ${styles.fold}`} open={g.key === "waiting" || g.key === "check" || c.id === focus}>
                <summary className={styles.cardSummary}>
                  <div className={styles.rowTop}><span className={styles.rowName}>{c.summary}</span></div>
                  <div className={styles.rowMeta}><span>{c.label}</span><span>{c.entity_name}</span><span>{proposerLabel(c.proposed_by)}</span></div>
                </summary>
                <div className={styles.foldBody}><Detail c={c} busy={busy} send={send} /></div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Detail({ c, busy, send }: { c: XeroChange; busy: boolean; send: Send }) {
  const facts = c.kind === "create_fixed_asset" ? assetFacts(c.input.record) : [];
  return (
    <div className={styles.detail}>
      <div className={styles.lines}>
        {facts.map(([k, v]) => (
          <div key={k} className={styles.jLine}><span className={styles.sub}>{k}</span><span className={styles.lineText} style={{ textAlign: "right" }}>{v}</span></div>
        ))}
      </div>
      {c.reason && <div className={styles.reason}><div className={styles.label}>Reason</div><MarkdownOutput text={c.reason} /></div>}
      <p className={styles.small}>
        Proposed by {proposerLabel(c.proposed_by)}
        {c.approved_by && c.state !== "proposed" ? ` · approved by ${c.approved_by}` : ""}
        {c.rejected_by && c.state === "rejected" ? ` · rejected by ${c.rejected_by}` : ""}
      </p>
      <State c={c} />
      <Actions c={c} busy={busy} send={send} />
    </div>
  );
}

function State({ c }: { c: XeroChange }) {
  let text: string | null = null;
  if (c.state === "proposed") text = c.last_error ? `Xero refused the last attempt: ${c.last_error}` : "Approving makes this change in Xero.";
  if (c.state === "approved") {
    text = c.in_flight ? "Being made in Xero now."
      : `The last attempt did not finish cleanly${c.last_error ? ` (${c.last_error})` : ""}, so this may already be in Xero. Check Xero before doing anything else.`;
  }
  if (c.state === "written") text = `Made in Xero. ${c.after ?? ""}`.trim();
  if (c.state === "rejected") text = "Rejected. Nothing went to Xero.";
  const warn = (c.state === "proposed" && c.last_error) || (c.state === "approved" && !c.in_flight);
  return text ? <p className={warn ? styles.warnText : styles.sub}>{text}</p> : null;
}

function Actions({ c, busy, send }: { c: XeroChange; busy: boolean; send: Send }) {
  if (c.state === "proposed") {
    return (
      <div className={styles.actions}>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => send(`${c.id}/approve`)}>{c.last_error ? "Try again" : "Approve"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${c.id}/reject`)}>Reject</button>
      </div>
    );
  }
  if (c.state !== "approved" || c.in_flight) return null;
  return (
    <div className={styles.actions}>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${c.id}/approve`, { confirmed_in_xero: true })}>It is in Xero. Record it</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${c.id}/approve`, { confirmed_not_in_xero: true })}>I checked: it is not in Xero. Try again</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${c.id}/reject`, { confirmed_not_in_xero: true })}>I checked: it is not in Xero. Reject</button>
    </div>
  );
}

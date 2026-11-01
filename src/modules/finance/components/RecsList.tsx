"use client";

// The month's reconciliations. The list comes from the trial balance: nothing
// here adds or hides a line. Opening a stale list reads the trial balance again,
// which is also what notices a figure that moved after it was prepared.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { STATUS_LABEL, PROOF_LABEL, isStale, money, periodChoices, periodLong, type RecList, type RecRow } from "@/modules/finance/lib/recs";
import styles from "./Recs.module.css";

async function post(slug: string, path: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/recs/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export function StatusPill({ r }: { r: Pick<RecRow, "status" | "recheck_reason"> }) {
  if (r.recheck_reason) return <span className={`${styles.pill} ${styles.pillWarn}`}>Re-check</span>;
  const tone = r.status === "signed_off" ? styles.pillDone : r.status === "with_cfo" ? styles.pillYou : r.status === "sent_back" ? styles.pillWarn : "";
  return <span className={`${styles.pill} ${tone}`}>{STATUS_LABEL[r.status]}</span>;
}

const ownerOf = (r: RecRow) => r.with ?? (r.status === "signed_off" ? "Done" : "Not placed");
const accountOf = (r: RecRow) => `${r.account_name}${r.codes.length ? ` (${r.codes.join(", ")})` : ""}`;

export default function RecsList({ slug, data }: { slug: string; data: RecList }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    const r = await post(slug, "compose", { period: data.period });
    setBusy(false);
    if (!r.ok) setError(String((r.body.issues as string[] | undefined)?.join(" ") ?? r.body.error ?? "The trial balance could not be read"));
    router.refresh();
  }

  useEffect(() => {
    if (data.migration_missing || tried.current === data.period) return;
    tried.current = data.period;
    if (isStale(data.composed_at)) void refresh();
    // Once per month shown; refresh itself changes nothing this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.period, data.composed_at, data.migration_missing]);

  const startOpen = async () => {
    setBusy(true);
    setError(null);
    const open = data.recs.filter((r) => r.workable && ["not_started", "sent_back"].includes(r.status));
    const said: string[] = [];
    for (const r of open) {
      const res = await post(slug, `${r.id}/agent`, {});
      if (!res.ok) said.push(`${r.account_name}: ${String(res.body.error ?? "not started")}`);
    }
    setBusy(false);
    if (said.length) setError(said.join(" "));
    router.refresh();
  };

  if (data.migration_missing) {
    return <div className={styles.alert} role="status">Reconciliations are built but not switched on: migration 032 has not been applied to the database yet.</div>;
  }

  const anyOpen = data.recs.some((r) => r.workable && ["not_started", "sent_back"].includes(r.status));

  return (
    <div>
      <div className={styles.bar}>
        <select aria-label="Month" className={styles.pick} value={data.period}
          onChange={(e) => router.push(`/finance/clients/${slug}/reconciliations?period=${e.target.value}`)}>
          {periodChoices(data.period).map((p) => <option key={p} value={p}>{periodLong(p)}</option>)}
        </select>
        <button type="button" className="btn-secondary" disabled={busy} onClick={refresh}>
          <RefreshCw size={14} aria-hidden="true" />{busy ? "Reading..." : "Refresh from trial balance"}
        </button>
        {anyOpen && <button type="button" className="btn-primary" disabled={busy} onClick={startOpen}>Start agents on what is open</button>}
        <span className={styles.barEnd}>{data.counts.signed_off} of {data.counts.total} signed off</span>
      </div>

      {error && <div className={styles.err} role="alert">{error}</div>}

      {data.entity_errors.length > 0 && (
        <div className={styles.alert} role="alert">
          <strong>This list is not complete.</strong> {data.entity_errors.map((e) => `${e.entity}: ${e.error}`).join(" ")}
        </div>
      )}
      {data.notes.map((n) => <div key={n} className={styles.alert} role="status">{n}</div>)}
      {data.prior.open && (
        <div className={styles.note}>{data.prior.label} is still open. Opening balances may move if it changes, and any reconciliation affected will be marked to re-check.</div>
      )}
      {data.counts.recheck > 0 && (
        <div className={styles.alert} role="status">{data.counts.recheck === 1 ? "1 reconciliation needs" : `${data.counts.recheck} reconciliations need`} re-checking: a figure moved after it was prepared.</div>
      )}

      {data.recs.length === 0 ? (
        <div className={`${styles.card} ${styles.pad}`}><span className={styles.sub}>{data.composed_at ? "No balance sheet account has a balance or a movement this month." : "Reading the trial balance..."}</span></div>
      ) : (
        <>
          <div className={styles.cards}>
            {data.recs.map((r) => (
              <Link key={r.id} href={`/finance/clients/${slug}/reconciliations/${r.id}`} className={`${styles.card} ${styles.rowCard}`}>
                <div className={styles.rowTop}>
                  <span className={styles.rowName}>{accountOf(r)}</span>
                  <StatusPill r={r} />
                </div>
                <div className={styles.rowFigs}>
                  <div className={styles.fig}><div className={styles.figLabel}>Ledger</div><div className={styles.figValue}>{money(r.ledger)}</div></div>
                  <div className={styles.fig}><div className={styles.figLabel}>Support</div><div className={styles.figValue}>{money(r.support)}</div></div>
                  <div className={styles.fig}><div className={styles.figLabel}>Difference</div><div className={styles.figValue}>{money(r.difference)}</div></div>
                </div>
                {r.mixed_currency && <div className={styles.small}>Mixed currencies: no group total. Open it for each company.</div>}
                {r.sole_reviewer && <div className={styles.small}>Sole reviewer</div>}
                <div className={styles.rowMeta}><span>{PROOF_LABEL[r.proof]}</span><span>{r.placed || r.with ? `With ${ownerOf(r)}` : "Not placed"}</span>{r.class && <span>Class {r.class}</span>}</div>
              </Link>
            ))}
          </div>
          <div className={`${styles.card} ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th><th>Proved by</th><th className={styles.num}>Ledger</th><th className={styles.num}>Support</th>
                  <th className={styles.num}>Difference</th><th>Class</th><th>With</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recs.map((r) => (
                  <tr key={r.id}>
                    <td><Link className={styles.link} href={`/finance/clients/${slug}/reconciliations/${r.id}`}>{accountOf(r)}</Link></td>
                    <td className={styles.sub}>{PROOF_LABEL[r.proof]}</td>
                    <td className={styles.num}>{r.mixed_currency ? "Mixed" : money(r.ledger)}</td>
                    <td className={styles.num}>{r.mixed_currency ? "Mixed" : money(r.support)}</td>
                    <td className={`${styles.num} ${r.difference && !r.ties ? styles.strong : ""}`}>{money(r.difference)}</td>
                    <td>{r.class ?? "-"}</td>
                    <td>{ownerOf(r)}</td>
                    <td><StatusPill r={r} />{r.sole_reviewer && <div className={styles.small}>Sole reviewer</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className={styles.small}>{Number(data.tolerance ?? 0) === 0 ? "No rounding tolerance is set, so every variance is reported." : `Rounding tolerance: ${money(data.tolerance)} per company.`}</p>
    </div>
  );
}

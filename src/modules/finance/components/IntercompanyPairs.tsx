"use client";

// The group's intercompany accounts, one row per pair (CFO, 18 Nov 2026):
// each company's account and balance side by side, the difference, and
// whether it ties. It replaces the account table for the Intercompany line,
// so each account shows once. Unpaired accounts are matched into suggested
// pairs that are confirmed here with one tap (the pair is kept for every
// month); an account with no likely twin opens to choose one.
// A phone gets a card per pair; a wider screen a table.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money, type IntercompanyPair, type IntercompanySide, type IntercompanyView, type RecRow } from "@/modules/finance/lib/recs";
import { StatusPill } from "./RecsList";
import styles from "./Recs.module.css";

type Kind = "pair" | "suggested";

export default function IntercompanyPairs({ slug, ic, recs }: { slug: string; ic: IntercompanyView; recs: RecRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const href = (s: IntercompanySide) => `/finance/clients/${slug}/reconciliations/${s.rec_id}`;
  const label = (s: IntercompanySide) => {
    const r = byId.get(s.rec_id);
    return r?.codes.length ? `${s.account_name} (${r.codes.join(", ")})` : s.account_name;
  };
  const pill = (s: IntercompanySide) => <StatusPill r={byId.get(s.rec_id) ?? { status: s.status, recheck_reason: null }} />;
  const suggested = ic.suggested_pairs ?? [];
  const out = ic.pairs.filter((p) => !p.ties).length;
  const lonely = (u: IntercompanyView["unpaired"][number]) =>
    u.paired_elsewhere ? "Its chosen pair has no balance this month. Open it to check the pair." : "No likely pair in another company. Open it to choose one.";

  async function pair(p: IntercompanyPair) {
    if (!p.b.rec_account_id) return;
    setBusy(p.a.rec_id);
    setError(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/recs/${p.a.rec_id}/counterpart`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rec_account_id: p.b.rec_account_id }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
    setBusy(null);
    if (!res.ok) { setError(body.issues?.join(" ") ?? body.error ?? `The pair was not saved (${res.status})`); return; }
    router.refresh();
  }

  const outcome = (p: IntercompanyPair, kind: Kind) => kind === "suggested"
    ? <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void pair(p)}>{busy === p.a.rec_id ? "Pairing..." : "Pair"}</button>
    : <span className={`${styles.pill} ${p.ties ? styles.pillDone : styles.pillWarn}`}>{p.ties ? "Ties" : "Differs"}</span>;

  const rows: Array<{ p: IntercompanyPair; kind: Kind }> = [
    ...ic.pairs.map((p) => ({ p, kind: "pair" as Kind })),
    ...suggested.map((p) => ({ p, kind: "suggested" as Kind })),
  ];
  const summary = [
    ic.pairs.length ? `${ic.pairs.length} pair${ic.pairs.length === 1 ? "" : "s"}${out ? `, ${out} not agreeing` : ", all agreeing"}` : "",
    suggested.length ? `${suggested.length} suggested pair${suggested.length === 1 ? "" : "s"} to confirm` : "",
    ic.unpaired.length ? `${ic.unpaired.length} account${ic.unpaired.length === 1 ? "" : "s"} with no likely pair` : "",
  ].filter(Boolean).join("; ");

  return (
    <>
      <p className={styles.small} style={{ margin: "0 0 8px" }}>
        {summary}. Each company&apos;s balance with the other, a debit against a credit, should net to nil.
        {suggested.length > 0 && " A suggested pair is matched on the company names and the amounts; Pair keeps it for every month."}
      </p>
      {error && <div className={styles.err} role="alert">{error}</div>}

      <div className={styles.cards}>
        {rows.map(({ p, kind }) => (
          <div key={`${p.a.rec_id}${p.b.rec_id}`} className={`${styles.card} ${styles.pad}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {kind === "suggested" && <span className={styles.small}>Suggested pair</span>}
            {[p.a, p.b].map((s) => (
              <div key={s.rec_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                <span style={{ minWidth: 0 }}><Link className={styles.link} href={href(s)}>{label(s)}</Link><span className={styles.small}> · {s.entity}</span></span>
                <span className={styles.num}>{money(s.closing)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, fontWeight: 600 }}>
              <span>Difference {money(p.difference)}</span>{outcome(p, kind)}
            </div>
          </div>
        ))}
        {ic.unpaired.map((u) => (
          <div key={u.rec_id} className={`${styles.card} ${styles.pad}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
              <span style={{ minWidth: 0 }}><Link className={styles.link} href={href(u)}>{label(u)}</Link><span className={styles.small}> · {u.entity}</span></span>
              <span className={styles.num}>{money(u.closing)}</span>
            </div>
            <div className={styles.small}>{lonely(u)}</div>
          </div>
        ))}
      </div>

      <div className={`${styles.card} ${styles.tableWrap}`}>
        <table className={styles.table} style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "6%" }} /><col style={{ width: "22%" }} /><col style={{ width: "11%" }} /><col style={{ width: "6%" }} />
            <col style={{ width: "22%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Co.</th><th>Account</th><th className={styles.num}>Balance</th><th>Co.</th><th>Account</th><th className={styles.num}>Balance</th>
              <th className={styles.num}>Difference</th><th>Pair</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, kind }) => (
              <tr key={`${p.a.rec_id}${p.b.rec_id}`}>
                {[p.a, p.b].flatMap((s) => [
                  <td key={`${s.rec_id}c`}>{s.entity}</td>,
                  <td key={`${s.rec_id}a`} style={{ overflowWrap: "anywhere" }}><Link className={styles.link} href={href(s)}>{label(s)}</Link><div>{pill(s)}</div></td>,
                  <td key={`${s.rec_id}b`} className={styles.num}>{money(s.closing)}</td>,
                ])}
                <td className={`${styles.num} ${p.ties ? "" : styles.strong}`}>{money(p.difference)}</td>
                <td>{kind === "suggested" && <div className={styles.small}>Suggested</div>}{outcome(p, kind)}</td>
              </tr>
            ))}
            {ic.unpaired.map((u) => (
              <tr key={u.rec_id}>
                <td>{u.entity}</td>
                <td style={{ overflowWrap: "anywhere" }}><Link className={styles.link} href={href(u)}>{label(u)}</Link><div>{pill(u)}</div></td>
                <td className={styles.num}>{money(u.closing)}</td>
                <td colSpan={5} className={styles.small}>{lonely(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

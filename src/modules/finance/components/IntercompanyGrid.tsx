// The group's intercompany position for the month, as the management pack
// shows it (16 Nov 2026): each pair of accounts side by side with the
// difference, then a grid of what each company says about each other company.
// A pair ties when the two balances net to nil. Built for a phone first: pairs
// are rows; the grid scrolls inside its own card.

import Link from "next/link";
import { STATUS_LABEL, money, type IntercompanySide, type IntercompanyView } from "@/modules/finance/lib/recs";
import styles from "./Recs.module.css";

export default function IntercompanyGrid({ slug, ic }: { slug: string; ic: IntercompanyView }) {
  const href = (s: IntercompanySide) => `/finance/clients/${slug}/reconciliations/${s.rec_id}`;
  const cell = (from: string, to: string) => ic.grid.cells.find((c) => c.from === from && c.to === to) ?? null;
  const out = ic.pairs.filter((p) => !p.ties).length;

  return (
    <section className={`${styles.card} ${styles.section}`} style={{ marginBottom: 16 }}>
      <div className={styles.cardHead}>
        <h2 className={styles.h2}>Intercompany across the group</h2>
        <span className={styles.small}>
          {ic.ties
            ? `All ${ic.pairs.length} pair${ic.pairs.length === 1 ? "" : "s"} agree.`
            : [out ? `${out} pair${out === 1 ? " does" : "s do"} not agree` : "", ic.unpaired.length ? `${ic.unpaired.length} account${ic.unpaired.length === 1 ? " is" : "s are"} not paired` : ""].filter(Boolean).join("; ") + "."}
          {" "}Each company&apos;s balance with the other, a debit against a credit, should net to nil.
        </span>
      </div>

      {ic.pairs.map((p) => (
        <div key={`${p.a.rec_id}${p.b.rec_id}`} className={styles.pad} style={{ borderBottom: "1px solid var(--bd)" }}>
          <Side s={p.a} href={href(p.a)} />
          <Side s={p.b} href={href(p.b)} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginTop: 4, color: p.ties ? "var(--tx)" : "var(--alert-red)" }}>
            <span>{p.ties ? "Agrees" : "Difference"}</span><span className={styles.num}>{money(p.difference)}</span>
          </div>
        </div>
      ))}

      {ic.unpaired.map((u) => (
        <div key={u.rec_id} className={styles.pad} style={{ borderBottom: "1px solid var(--bd)" }}>
          <Side s={u} href={href(u)} />
          <div className={styles.small}>
            {u.paired_elsewhere
              ? "Its chosen pair has no balance this month or is not an intercompany account. Open it to check the pair"
              : "Not paired, so it cannot be checked against the other company. Open it and choose its pair"}
            {u.suggested ? `: most likely ${u.suggested.account_name} in ${u.suggested.entity} (difference ${money(u.suggested.difference)}).` : "."}
          </div>
        </div>
      ))}

      {ic.grid.entities.length > 1 && ic.grid.cells.length > 0 && (
        <div className={styles.pad} style={{ overflowX: "auto" }}>
          <div className={styles.small} style={{ marginBottom: 6 }}>What each company (row) holds for each other company (column). Each cell should be the reverse of its mirror.</div>
          <table className={styles.table} style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>Company</th>
                {ic.grid.entities.map((e) => <th key={e.id} className={styles.num}>{e.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {ic.grid.entities.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  {ic.grid.entities.map((c) => {
                    const v = r.id === c.id ? null : cell(r.id, c.id);
                    const off = v !== null && v.ties === false;
                    return <td key={c.id} className={styles.num} style={off ? { color: "var(--alert-red)", fontWeight: 600 } : undefined}>{r.id === c.id ? "-" : v === null ? "" : money(v.amount)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Side({ s, href }: { s: IntercompanySide; href: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, lineHeight: 1.7 }}>
      <span style={{ minWidth: 0 }}>
        <Link className={styles.link} href={href}>{s.account_name}</Link>
        <span className={styles.small}> · {s.entity} · {STATUS_LABEL[s.status]}</span>
      </span>
      <span className={styles.num}>{money(s.closing)}</span>
    </div>
  );
}

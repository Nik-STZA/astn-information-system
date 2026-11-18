// The register behind an asset rec's evidence, asset by asset (19 Nov 2026):
// Xero's fixed asset register or the os.stza.io register signed for the
// month, as it was when the evidence was fetched. Columns a source does not
// hold (Xero has no monthly charge; a cost account has no depreciation once
// Xero has run past the month) are left out rather than shown as nil.

import { money, type AssetDetail } from "@/modules/finance/lib/recs";
import styles from "./Recs.module.css";

const COLS: Array<{ key: "cost" | "additions" | "charge" | "accumulated" | "book_value"; label: string }> = [
  { key: "cost", label: "Cost" },
  { key: "additions", label: "Added in month" },
  { key: "charge", label: "Charge in month" },
  { key: "accumulated", label: "Accumulated" },
  { key: "book_value", label: "Book value" },
];

const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : money(n.toFixed(2)));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
};

export default function RecAssetList({ detail }: { detail: AssetDetail }) {
  const cols = COLS.filter((c) => detail.assets.some((a) => a[c.key] !== null && a[c.key] !== undefined && (c.key !== "additions" || a[c.key] !== 0)));
  const dated = detail.assets.some((a) => a.date);
  const sum = (k: (typeof COLS)[number]["key"]) => detail.assets.reduce((s, a) => s + (a[k] ?? 0), 0);
  const unlisted = Number(detail.unlisted);
  return (
    <details style={{ marginTop: 6 }}>
      <summary className={styles.small} style={{ cursor: "pointer" }}>
        {detail.register}: {detail.assets.length} asset{detail.assets.length === 1 ? "" : "s"}
      </summary>
      {detail.assets.length === 0 ? (
        <p className={styles.small}>No assets on this account at the month end.</p>
      ) : (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginTop: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--sub)", textAlign: "left" }}>
                <th style={th}>Asset</th>
                <th style={th}>Name</th>
                {dated && <th style={th}>Bought</th>}
                {cols.map((c) => <th key={c.key} style={{ ...th, textAlign: "right" }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {detail.assets.map((a, i) => (
                <tr key={`${a.asset_no}-${i}`}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{a.asset_no}</td>
                  <td style={td}>{a.name}{a.status && !["registered", "available"].includes(a.status) ? <span className={styles.small}> ({a.status})</span> : null}</td>
                  {dated && <td style={{ ...td, whiteSpace: "nowrap" }}>{day(a.date)}</td>}
                  {cols.map((c) => <td key={c.key} style={{ ...td, ...numCell }}>{num(a[c.key])}</td>)}
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td style={td} colSpan={dated ? 3 : 2}>Total</td>
                {cols.map((c) => <td key={c.key} style={{ ...td, ...numCell }}>{num(sum(c.key))}</td>)}
              </tr>
            </tbody>
          </table>
          {unlisted !== 0 && (
            <p className={styles.small} style={{ marginBottom: 0 }}>
              {money(detail.unlisted)} of the evidence figure is not on a listed asset (named items the register is tied after, or cost not yet split to an asset).
            </p>
          )}
        </div>
      )}
    </details>
  );
}

const th = { padding: "4px 8px", fontWeight: 500, borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap" as const };
const td = { padding: "4px 8px", borderBottom: "1px solid var(--bd)", verticalAlign: "top" as const };
const numCell = { textAlign: "right" as const, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" as const };

"use client";

// The contracts register for one client (15 Nov 2026): drop contract PDFs to be
// read, check what was read and add it, see what is coming up, and the list.
// Every change goes through /api/finance/<slug>/contracts as the signed-in
// person; finance-api checks their role on this client.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import styles from "./Contracts.module.css";
import page from "./Page.module.css";
import { dateLabel, DECISION_LABEL, MAX_FILE_BYTES, money, monthName, whenLabel, type ContractList, type Side } from "@/modules/finance/lib/contracts";

type Progress = { name: string; state: string; error?: string };

export default function ContractsView({ slug, data, side }: { slug: string; data: ContractList; side: Side | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const base = `/api/finance/${encodeURIComponent(slug)}/contracts`;
  const here = `/finance/clients/${encodeURIComponent(slug)}/contracts`;

  async function readUpload(id: string): Promise<string | null> {
    const r = await fetch(`${base}/uploads/${id}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const out = await r.json().catch(() => ({}));
    return r.ok ? null : out.error ?? `could not be read (${r.status})`;
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const list: Progress[] = files.map((f) => ({ name: f.name, state: "Waiting" }));
    setProgress([...list]);
    const set = (i: number, p: Partial<Progress>) => { list[i] = { ...list[i], ...p }; setProgress([...list]); };
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > MAX_FILE_BYTES) { set(i, { state: "Too large", error: `over ${MAX_FILE_BYTES / 1048576} MB` }); continue; }
      set(i, { state: "Uploading" });
      const r = await fetch(`${base}/uploads`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(f.name), "Content-Type": "application/pdf" }, body: f });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { set(i, { state: "Not uploaded", error: (out.issues ?? [out.error]).join("; ") }); continue; }
      if (out.already && out.upload?.read_state !== "waiting" && out.upload?.read_state !== "failed") { set(i, { state: "Already uploaded" }); continue; }
      set(i, { state: "Reading (about a minute)" });
      const err = await readUpload(out.upload.id);
      set(i, err ? { state: "Not read", error: err } : { state: "Read: check it below" });
    }
    setBusy(false);
    router.refresh();
  }

  async function act(path: string) {
    setBusy(true);
    const r = await fetch(`${base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) {
      const out = await r.json().catch(() => ({}));
      setProgress([{ name: "", state: "", error: out.error ?? (out.issues ?? []).join("; ") }]);
    }
    setBusy(false);
    router.refresh();
  }

  if (data.migration_missing) {
    return <div className={page.error} role="alert">Contracts are waiting for a database change (migration 047) to be applied.</div>;
  }

  const read = data.uploads.filter((u) => u.read_state === "read");
  const unread = data.uploads.filter((u) => u.read_state !== "read");
  const seg = (s: Side | null, label: string) => (
    <Link prefetch={false} href={s ? `${here}?side=${s}` : here} className={`${styles.segItem} ${side === s ? styles.segOn : ""}`} aria-current={side === s ? "page" : undefined}>{label}</Link>
  );

  return (
    <div>
      <div
        className={`${styles.drop} ${over ? styles.dropOn : ""}`}
        role="button" tabIndex={0} aria-label="Add contract PDFs"
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) upload([...e.dataTransfer.files]); }}
      >
        <FileUp size={22} aria-hidden="true" />
        <span className={styles.dropTitle}>{busy ? "Working..." : "Drop contract PDFs here, or tap to choose"}</span>
        <span>Contracts, accepted quotes, policies and leases. Read for finance terms only, then the file is deleted: the original stays on the client&apos;s drive.</span>
        <input ref={input} className={styles.hidden} type="file" accept="application/pdf,.pdf" multiple
          onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; upload(f); }} />
      </div>

      {progress.length > 0 && (
        <div className={`${page.card} ${styles.section}`} aria-live="polite">
          {progress.map((p, i) => (
            <div key={i} className={styles.tieRow}>
              {p.name && <span className={styles.grow}>{p.name}</span>}
              {p.state && <span>{p.state}</span>}
              {p.error && <span className={styles.differs}>{p.error}</span>}
            </div>
          ))}
        </div>
      )}

      {(read.length > 0 || unread.length > 0) && (
        <section className={styles.section} aria-labelledby="reads">
          <div className={styles.sectionHead}><h2 id="reads">Read, waiting for you to check</h2></div>
          <div className={page.card}>
            {read.map((u) => (
              <div key={u.id} className={styles.row}>
                <div>
                  <div className={styles.name}>{u.proposed?.is_contract === false ? `${u.file_name}: does not look like a contract` : (u.proposed?.counterparty ?? u.file_name)}</div>
                  <div className={styles.meta}>{u.file_name}{u.proposed?.summary ? ` · ${u.proposed.summary}` : ""}</div>
                </div>
                <div className={styles.pills}>
                  <Link prefetch={false} className={`${styles.btn} ${styles.btnPrimary}`} href={`${here}/new?upload=${u.id}`}>Check and add</Link>
                  <button type="button" className={styles.btn} disabled={busy} onClick={() => act(`uploads/${u.id}/dismiss`)}>Not a contract</button>
                </div>
              </div>
            ))}
            {unread.map((u) => (
              <div key={u.id} className={styles.row}>
                <div>
                  <div className={styles.name}>{u.file_name}</div>
                  <div className={styles.meta}>{u.read_state === "failed" ? `Not read: ${u.read_error ?? "unknown error"}` : u.read_state === "reading" ? "Being read" : "Waiting to be read"}</div>
                </div>
                <div className={styles.pills}>
                  {u.read_state !== "reading" && <button type="button" className={styles.btn} disabled={busy} onClick={async () => { setBusy(true); await readUpload(u.id); setBusy(false); router.refresh(); }}>Read it</button>}
                  <button type="button" className={styles.btn} disabled={busy} onClick={() => act(`uploads/${u.id}/dismiss`)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.renewing_soon && data.renewing_soon.count > 0 && (
        <div className={`${page.card} ${styles.section}`} style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: "6px 24px", alignItems: "baseline", fontSize: 13 }}>
          <strong style={{ fontSize: 14 }}>Renewing in the next {data.renewing_soon.days} days: {data.renewing_soon.count}</strong>
          {data.renewing_soon.supplier_annual > 0 && <span>{money(data.renewing_soon.supplier_annual)} a year of costs</span>}
          {data.renewing_soon.customer_annual > 0 && <span>{money(data.renewing_soon.customer_annual)} a year of income</span>}
          {data.renewing_soon.undecided > 0
            ? <span className={styles.differs}>{data.renewing_soon.undecided} still to decide</span>
            : <span className={styles.agrees}>All decided</span>}
          {data.renewing_soon.without_value > 0 && <span className={styles.meta}>{data.renewing_soon.without_value} without a price: add it to see what is at stake</span>}
        </div>
      )}

      {data.coming_up.length > 0 && (
        <section className={styles.section} aria-labelledby="soon">
          <div className={styles.sectionHead}><h2 id="soon">Coming up</h2></div>
          <div className={styles.cards}>
            {data.coming_up.slice(0, 9).map((x, i) => (
              <Link prefetch={false} key={`${x.contract_id}-${i}`} href={`${here}/${x.contract_id}`} className={`${page.card} ${styles.cardItem}`}>
                <span className={`${styles.when} ${x.overdue ? styles.whenRed : !x.due_on ? styles.whenAmber : ""}`}>{x.overdue ? `Overdue: ${whenLabel(x)}` : whenLabel(x)}</span>
                <strong>{x.counterparty}: {x.label}</strong>
                <span className={styles.meta}>{x.amount != null ? money(x.amount, x.currency) : x.kind === "notice" ? "Decide whether to renew before then" : x.kind === "milestone" ? "Milestone" : ""}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="list">
        <div className={styles.sectionHead}>
          <h2 id="list">Contracts</h2>
          <nav aria-label="Side" className={styles.seg}>{seg(null, "All")}{seg("customer", "Customers")}{seg("supplier", "Suppliers")}</nav>
        </div>
        <div className={page.card}>
          {data.contracts.length === 0 && <div className={styles.empty}>No contracts yet. Drop a PDF above, or add one by hand.</div>}
          {data.contracts.map((c) => (
            <div key={c.id} className={styles.row}>
              <div>
                <Link prefetch={false} className={styles.name} href={`${here}/${c.id}`}>{c.counterparty}</Link>
                <div className={styles.meta}>{c.side === "customer" ? "Customer" : "Supplier"} · {c.entity_name}{c.reference ? ` · ${c.reference}` : ""}</div>
                <div className={styles.pills}>
                  <span className={styles.pill}>{c.pattern_label}</span>
                  {!c.pattern_confirmed_at && <span className={`${styles.pill} ${styles.pillAccent}`}>Pattern to confirm</span>}
                  {c.renewal_decision && <span className={styles.pill}>Renewal: {DECISION_LABEL[c.renewal_decision]}</span>}
                  {c.status !== "active" && <span className={styles.pill}>{c.status === "ended" ? "Ended" : "Cancelled"}</span>}
                </div>
              </div>
              <div>
                <div className={styles.amount}>{c.annual_value != null ? `${money(c.annual_value, c.currency)} a year` : c.total_value != null ? money(c.total_value, c.currency) : "-"}</div>
                <div className={styles.meta} style={{ textAlign: "right" }}>
                  {c.next ? `${c.next.label}: ${whenLabel(c.next)}` : c.end_date ? `Ends ${dateLabel(c.end_date)}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {data.forward && (data.forward.total.income > 0 || data.forward.total.cost > 0 || data.forward.undated_income > 0) && (
        <section className={styles.section} aria-labelledby="fwd">
          <div className={styles.sectionHead}>
            <h2 id="fwd">Next 12 months under contract</h2>
            <span className={styles.meta}>For the budget and the forecast. Contracts that renew themselves are assumed to carry on unless the decision is to cancel.</span>
          </div>
          <div className={page.card} style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 420 }}>
              <thead>
                <tr style={{ color: "var(--sub)", fontSize: 12, textAlign: "right" }}>
                  <th scope="col" style={{ textAlign: "left", padding: "10px 16px", fontWeight: 600 }}>Month</th>
                  <th scope="col" style={{ padding: "10px 16px", fontWeight: 600 }}>Income</th>
                  <th scope="col" style={{ padding: "10px 16px", fontWeight: 600 }}>Costs</th>
                  <th scope="col" style={{ padding: "10px 16px", fontWeight: 600 }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.forward.months.map((m) => (
                  <tr key={m.month} style={{ borderTop: "1px solid var(--bd)", textAlign: "right" }}>
                    <th scope="row" style={{ textAlign: "left", padding: "8px 16px", fontWeight: 500 }}>{monthName(m.month)}{m.assumed ? <span className={styles.meta}> · includes {money(m.assumed)} assumed renewals</span> : null}</th>
                    <td style={{ padding: "8px 16px" }}>{m.income ? money(m.income) : "-"}</td>
                    <td style={{ padding: "8px 16px" }}>{m.cost ? money(m.cost) : "-"}</td>
                    <td style={{ padding: "8px 16px" }}>{money(m.net)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--bd)", textAlign: "right", fontWeight: 600 }}>
                  <th scope="row" style={{ textAlign: "left", padding: "10px 16px" }}>12 months</th>
                  <td style={{ padding: "10px 16px" }}>{money(data.forward.total.income)}</td>
                  <td style={{ padding: "10px 16px" }}>{money(data.forward.total.cost)}</td>
                  <td style={{ padding: "10px 16px" }}>{money(data.forward.total.income - data.forward.total.cost)}</td>
                </tr>
              </tbody>
            </table>
            {(data.forward.undated_income > 0 || data.forward.unpriced > 0) && (
              <div className={styles.meta} style={{ padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>
                {data.forward.undated_income > 0 ? `${money(data.forward.undated_income)} of contracted income has no date yet (${data.forward.undated_count} payment${data.forward.undated_count === 1 ? "" : "s"}), so it is not in a month. ` : ""}
                {data.forward.unpriced > 0 ? `${data.forward.unpriced} contract${data.forward.unpriced === 1 ? " has" : "s have"} no price or billing frequency, so ${data.forward.unpriced === 1 ? "it is" : "they are"} not counted.` : ""}
              </div>
            )}
          </div>
        </section>
      )}

      {data.ties.length > 0 && (
        <section className={styles.section} aria-labelledby="ties">
          <div className={styles.sectionHead}><h2 id="ties">Ties to the ledger</h2></div>
          <div className={page.card}>
            {data.ties.map((t) => (
              <div key={`${t.entity_name}-${t.account_code}`} className={styles.tieRow}>
                <span className={styles.grow}>{t.entity_name}, account {t.account_code}, {dateLabel(t.as_at)}</span>
                <span>Register {money(t.register)}</span>
                <span>Ledger {t.ledger == null ? "not reconciled yet" : money(t.ledger)}</span>
                {t.agrees === true && <span className={styles.agrees}>Agrees</span>}
                {t.agrees === false && <span className={styles.differs}>Differs by {money((t.ledger ?? 0) - t.register)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

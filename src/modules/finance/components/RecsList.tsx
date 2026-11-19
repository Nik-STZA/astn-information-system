"use client";

// The month's reconciliations. The list comes from the trial balance: nothing
// here adds or hides a line. Opening a stale list reads the trial balance again,
// which is also what notices a figure that moved after it was prepared.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { STATUS_LABEL, PROOF_LABEL, isStale, money, periodChoices, periodLong, recGroups, type RecList, type RecOrder, type RecRow } from "@/modules/finance/lib/recs";
import IntercompanyPairs from "./IntercompanyPairs";
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
  // How the list is shown: kept in this browser only, a convenience.
  const [order, setOrder] = useState<RecOrder>("line");
  const [entity, setEntity] = useState("");
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("stza-recs-view") ?? "{}");
      if (v.order === "line" || v.order === "name") setOrder(v.order);
    } catch { /* storage may be blocked */ }
  }, []);
  const pickOrder = (o: RecOrder) => {
    setOrder(o);
    try { localStorage.setItem("stza-recs-view", JSON.stringify({ order: o })); } catch { /* storage may be blocked */ }
  };

  async function refresh() {
    setBusy(true);
    setError(null);
    const r = await post(slug, "compose", { period: data.period });
    setBusy(false);
    if (!r.ok) setError(String((r.body.issues as string[] | undefined)?.join(" ") ?? r.body.error ?? "The trial balance could not be read"));
    else {
      // What the refresh did by itself: items carried from last month, and
      // evidence taken from the schedules os.stza.io keeps (accruals, VAT, contracts).
      const carried = Number(r.body.carried ?? 0);
      const ev = (r.body.evidence as Array<{ account: string; ok: boolean; fetched?: number; error?: string }> | undefined) ?? [];
      const parts = [
        carried ? `${carried} open reconciling item${carried === 1 ? "" : "s"} carried from last month` : "",
        ev.filter((e) => e.ok).length ? `evidence taken from os.stza.io for ${ev.filter((e) => e.ok).map((e) => e.account).join(", ")}` : "",
        ...ev.filter((e) => !e.ok).map((e) => `${e.account}: ${e.error}`),
      ].filter(Boolean);
      if (parts.length) setSaid(`Refreshed: ${parts.join("; ")}.`);
    }
    router.refresh();
  }

  useEffect(() => {
    if (data.migration_missing || tried.current === data.period) return;
    tried.current = data.period;
    if (isStale(data.composed_at)) void refresh();
    // Once per month shown; refresh itself changes nothing this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.period, data.composed_at, data.migration_missing]);

  // One request: finance-api queues every workable rec, sends re-checks with a
  // reviewer back to FM1, leaves anything on hold, and (CFO only) reopens signed
  // re-checks. The page can be closed once it answers (18 Nov 2026: a loop in
  // the browser stopped when the tab closed).
  const [said, setSaid] = useState<string | null>(null);
  const [openingNote, setOpeningNote] = useState("");
  const markOpening = async (on: boolean) => {
    setBusy(true);
    setError(null);
    const res = await post(slug, "opening", { period: data.period, opening: on, note: openingNote });
    setBusy(false);
    if (!res.ok) { setError(String(res.body.error ?? (res.body.issues as string[] | undefined)?.join(" ") ?? "Not saved")); return; }
    router.refresh();
  };
  // Recs FM1 finished on with nothing moved since are left alone by Run all
  // (finance-api lib/rec-inputs.js); this many were, last time.
  const [unchanged, setUnchanged] = useState(0);
  const startOpen = async (reopenSigned = false, includeUnchanged = false) => {
    setBusy(true);
    setError(null);
    setSaid(null);
    setUnchanged(0);
    const res = await post(slug, "agent-all", { period: data.period, reopen_signed: reopenSigned, include_unchanged: includeUnchanged });
    setBusy(false);
    if (!res.ok) { setError(String(res.body.error ?? (res.body.issues as string[] | undefined)?.join(" ") ?? "Agents were not started")); return; }
    const queued = (res.body.queued as unknown[] | undefined)?.length ?? 0;
    const skipped = (res.body.skipped as Array<{ account: string; why: string }> | undefined) ?? [];
    setSaid(`FM1 started on ${queued} reconciliation${queued === 1 ? "" : "s"}; they run one after another and the page can be closed.`
      + (skipped.length ? ` Left alone: ${skipped.map((x) => `${x.account} (${x.why})`).join("; ")}.` : ""));
    setUnchanged(skipped.filter((x) => /nothing has moved since/.test(x.why)).length);
    router.refresh();
  };

  if (data.migration_missing) {
    return <div className={styles.alert} role="status">Reconciliations are built but not switched on: migration 032 has not been applied to the database yet.</div>;
  }

  const anyOpen = data.recs.some((r) => (r.workable && ["not_started", "in_progress", "sent_back"].includes(r.status))
    || (r.recheck_reason && ["with_fc", "with_cfo"].includes(r.status)));
  const signedRecheck = data.recs.filter((r) => r.recheck_reason && r.status === "signed_off").length;
  const company = data.entities.some((e) => e.id === entity) ? entity : "";
  const groups = recGroups(data.recs, data.lines, { order, entity: company });
  // The Intercompany line's accounts show in the pairs table, once; any other
  // account on that line (one held by more than one company) stays in the table.
  const icIds = new Set(data.intercompany ? [...data.intercompany.pairs, ...(data.intercompany.suggested_pairs ?? [])]
    .flatMap((p) => [p.a.rec_id, p.b.rec_id]).concat(data.intercompany.unpaired.map((u) => u.rec_id)) : []);
  const rowsOf = (g: (typeof groups)[number]) => (g.key === "intercompany" ? g.rows.filter((r) => !icIds.has(r.id)) : g.rows);

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
        {anyOpen && <button type="button" className="btn-primary" disabled={busy} onClick={() => void startOpen(false)}>Start agents on what is open</button>}
        {signedRecheck > 0 && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void startOpen(true)}
            title="Reopens signed reconciliations whose figure moved since sign-off, then starts FM1 on them (CFO)">
            Also reopen {signedRecheck} signed re-check{signedRecheck === 1 ? "" : "s"}
          </button>
        )}
        <span className={styles.barEnd}>{data.counts.signed_off} of {data.counts.total} signed off</span>
      </div>

      {error && <div className={styles.err} role="alert">{error}</div>}
      {said && <div className={styles.note} role="status">{said}</div>}
      {unchanged > 0 && (
        <div className={styles.bar}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void startOpen(false, true)}>
            Run the {unchanged} unchanged anyway
          </button>
        </div>
      )}

      {data.entity_errors.length > 0 && (
        <div className={styles.alert} role="alert">
          <strong>This list is not complete.</strong> {data.entity_errors.map((e) => `${e.entity}: ${e.error}`).join(" ")}
        </div>
      )}
      {data.notes.map((n) => <div key={n} className={styles.alert} role="status">{n}</div>)}
      {data.opening && (
        <div className={styles.note} role="status">
          Closed outside os.stza.io: {data.opening.note}{data.opening.by ? ` (${data.opening.by})` : ""}. {periodLong(data.period)}&apos;s closing is the next month&apos;s opening, and its reconciliations are not worked here.{" "}
          <button type="button" className="btn-text" disabled={busy} onClick={() => void markOpening(false)}>Undo</button>
        </div>
      )}
      {!data.opening && data.counts.signed_off === 0 && data.counts.total > 0 && (
        <details className={styles.note}>
          <summary style={{ cursor: "pointer" }}>Was this month closed outside os.stza.io?</summary>
          <p style={{ margin: "6px 0" }}>Mark it as the opening month (CFO): the next month takes its closing as its opening and stops waiting for it. Say where it was closed and signed.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} maxLength={500}
              placeholder="e.g. Closed and signed in the August workbook, 22 Sep 2026" aria-label="Where the month was closed"
              style={{ flex: "1 1 260px", height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pg)", color: "var(--tx)", font: "inherit" }} />
            <button type="button" className="btn-secondary" disabled={busy || openingNote.trim().length < 10} onClick={() => void markOpening(true)}>Mark as the opening month</button>
          </div>
        </details>
      )}
      {data.prior.open && (
        <div className={styles.note}>{data.prior.label} is still open. Opening balances may move if it changes, and any reconciliation affected will be marked to re-check.</div>
      )}
      {data.counts.recheck > 0 && (
        <div className={styles.alert} role="status">{data.counts.recheck === 1 ? "1 reconciliation needs" : `${data.counts.recheck} reconciliations need`} re-checking: a figure moved after it was prepared.</div>
      )}

      {data.intercompany && !groups.some((g) => g.key === "intercompany") && (
        <section style={{ marginBottom: 16 }}>
          <h2 className={styles.h2} style={{ margin: "8px 0" }}>Intercompany across the group</h2>
          <IntercompanyPairs slug={slug} ic={data.intercompany} recs={data.recs} />
        </section>
      )}

      {data.recs.length > 0 && (
        <div className={styles.bar}>
          <div className="seg" role="group" aria-label="Order">
            <button type="button" className={order === "line" ? "seg-on" : ""} aria-pressed={order === "line"} onClick={() => pickOrder("line")}>By line</button>
            <button type="button" className={order === "name" ? "seg-on" : ""} aria-pressed={order === "name"} onClick={() => pickOrder("name")}>A to Z</button>
          </div>
          {data.entities.length > 1 && (
            <select aria-label="Company" className={styles.pick} value={company} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All companies</option>
              {data.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          {company && <span className={styles.small}>Figures are this company&apos;s own.</span>}
        </div>
      )}

      {data.recs.length === 0 ? (
        <div className={`${styles.card} ${styles.pad}`}><span className={styles.sub}>{data.composed_at ? "No balance sheet account has a balance or a movement this month." : "Reading the trial balance..."}</span></div>
      ) : (
        <>
          {groups.length === 0 && <div className={`${styles.card} ${styles.pad}`}><span className={styles.sub}>This company holds none of this month&apos;s accounts.</span></div>}
          {groups.map((g) => (
            <section key={g.key} style={{ marginBottom: 16 }}>
              {g.label && <h2 className={styles.h2} style={{ margin: "8px 0" }}>{g.label} <span className={styles.sub} style={{ fontWeight: 400 }}>· {g.rows.length}</span></h2>}
              {/* Intercompany shows one row per pair instead of its accounts (CFO, 18 Nov 2026). */}
              {g.key === "intercompany" && data.intercompany && <IntercompanyPairs slug={slug} ic={data.intercompany} recs={data.recs} />}
              {rowsOf(g).length > 0 && (<>
              <div className={styles.cards}>
                {rowsOf(g).map((r) => <RecCard key={r.id} slug={slug} r={r} />)}
              </div>
              <div className={`${styles.card} ${styles.tableWrap}`}>
                <table className={styles.table} style={{ tableLayout: "fixed" }}>
                  {/* The same widths in every group, so the columns line up down the page. */}
                  <colgroup>
                    <col style={{ width: "26%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} />
                    <col style={{ width: "11%" }} /><col style={{ width: "6%" }} /><col style={{ width: "8%" }} /><col style={{ width: "14%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Account</th><th>Proved by</th><th className={styles.num}>Ledger</th><th className={styles.num}>Support</th>
                      <th className={styles.num}>Difference</th><th>Class</th><th>With</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsOf(g).map((r) => (
                      <tr key={r.id}>
                        <td style={{ overflowWrap: "anywhere" }}><Link className={styles.link} href={`/finance/clients/${slug}/reconciliations/${r.id}`}>{accountOf(r)}</Link></td>
                        <td className={styles.sub} style={{ whiteSpace: "normal" }}>{PROOF_LABEL[r.proof]}</td>
                        <td className={styles.num}>{r.mixed_currency ? "Mixed" : money(r.ledger)}</td>
                        <td className={styles.num}>{r.mixed_currency ? "Mixed" : money(r.support)}</td>
                        <td className={`${styles.num} ${r.difference && !r.ties ? styles.strong : ""}`}>{money(r.difference)}</td>
                        <td>{r.class ?? "-"}</td>
                        <td>{ownerOf(r)}</td>
                        <td><StatusPill r={r} />{r.sole_reviewer && <div className={styles.small}>Sole reviewer</div>}<MovedLine r={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>)}
            </section>
          ))}
        </>
      )}
      <Tolerance slug={slug} value={data.tolerance ?? "0.00"} />
    </div>
  );
}

function RecCard({ slug, r }: { slug: string; r: RecRow }) {
  return (
    <Link href={`/finance/clients/${slug}/reconciliations/${r.id}`} className={`${styles.card} ${styles.rowCard}`}>
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
      <MovedLine r={r} />
      {r.sole_reviewer && <div className={styles.small}>Sole reviewer</div>}
      <div className={styles.rowMeta}><span>{PROOF_LABEL[r.proof]}</span><span>{r.placed || r.with ? `With ${ownerOf(r)}` : "Not placed"}</span>{r.class && <span>Class {r.class}</span>}</div>
    </Link>
  );
}

// On a signed rec flagged to re-check: Xero's figure now, against what was signed.
function MovedLine({ r }: { r: RecRow }) {
  if (r.ledger_now === undefined || r.moved === undefined) return null;
  return <div className={styles.small}>Xero now {money(r.ledger_now)} · moved {money(r.moved)} since sign-off</div>;
}

// The client's rounding tolerance: a difference this size or smaller, per
// company, counts as tying. Meant for pence, not for differences that need a
// reason: those are accepted at sign-off instead. Only the CFO sets it; the
// server refuses anyone else and logs the change.
function Tolerance({ slug, value }: { slug: string; value: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/recs/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tolerance: Number(v) }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr((out.issues as string[] | undefined)?.join(" ") ?? out.error ?? "That did not save"); return; }
    setOpen(false);
    router.refresh();
  };
  return (
    <div className={styles.small} style={{ marginTop: 12 }}>
      {Number(value) === 0 ? "No rounding tolerance is set, so every variance is reported." : `Rounding tolerance: ${money(value)} per company.`}{" "}
      {!open && <button type="button" className="btn-text" onClick={() => { setV(value); setOpen(true); }}>Change</button>}
      {open && (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <label>Tolerance per company
            <input className={styles.pick} style={{ width: 90, marginLeft: 8 }} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label="Rounding tolerance" />
          </label>
          <button type="button" className="btn-secondary" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
          <button type="button" className="btn-text" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <span>A larger difference is better accepted at sign-off with a reason. Only the CFO sets this.</span>
        </span>
      )}
      {err && <div className={styles.err} role="alert">{err}</div>}
    </div>
  );
}

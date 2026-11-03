"use client";

// The month's journals, grouped by where each one is: waiting for the CFO,
// approved and going to Xero, a draft in Xero, posted, or rejected. A journal
// proposed on a reconciliation is listed too, and decided on its reconciliation.
//
// Nothing here talks to Xero. Approving asks finance-api, which creates the
// journal in Xero as a DRAFT; a person posts it there.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Plus, RefreshCw, X } from "lucide-react";
import MarkdownOutput from "@/modules/finance/components/MarkdownOutput";
import { dayLabel, money, periodChoices, periodLong } from "@/modules/finance/lib/recs";
import {
  balanceOf, blankLine, grouped, needsXeroCheck, sourceLabel, toLines,
  type DraftLine, type JournalList, type JournalRow,
} from "@/modules/finance/lib/journals";
import SearchSelect from "./SearchSelect";
import styles from "./Journals.module.css";

type Send = (path: string, body?: unknown) => Promise<boolean>;

async function post(slug: string, path: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

const said = (b: Record<string, unknown>, fallback: string) =>
  String((b.issues as string[] | undefined)?.join(" ") ?? b.error ?? fallback);

export default function JournalsView({ slug, data }: { slug: string; data: JournalList }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const checked = useRef<string | null>(null);

  const send: Send = async (path, body = {}) => {
    setBusy(true);
    setError(null);
    const r = await post(slug, `journals/${path}`, body);
    setBusy(false);
    if (!r.ok) setError(said(r.body, "That did not work"));
    router.refresh();
    return r.ok;
  };

  // Drafts posted in Xero since the last look show as posted without anyone
  // asking: once per month shown, and only when the last look is old.
  useEffect(() => {
    if (data.migration_missing || checked.current === data.period) return;
    checked.current = data.period;
    if (!needsXeroCheck(data.journals)) return;
    void post(slug, "journals/refresh", { period: data.period }).then(() => router.refresh());
  }, [data.period, data.journals, data.migration_missing, slug, router]);

  const checkXero = async () => {
    setBusy(true);
    setError(null);
    const r = await post(slug, "journals/refresh", { period: data.period });
    setBusy(false);
    if (!r.ok) setError(said(r.body, "Xero could not be read"));
    else if ((r.body.errors as unknown[] | undefined)?.length) setError("Some drafts could not be read from Xero. Try again shortly.");
    router.refresh();
  };

  if (data.migration_missing) {
    return <div className={styles.alert} role="status">Journals are built but not switched on: migration 033 has not been applied to the database yet.</div>;
  }

  const groups = grouped(data.journals);
  const anyDrafts = data.journals.some((j) => j.kind === "register" && j.state === "draft_created");

  return (
    <div className={styles.journalsPage}>
      <div className={styles.bar}>
        <select aria-label="Month" className={styles.pick} value={data.period}
          onChange={(e) => router.push(`/finance/clients/${slug}/journals?period=${e.target.value}`)}>
          {periodChoices(data.period).map((p) => <option key={p} value={p}>{periodLong(p)}</option>)}
        </select>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          {adding ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{adding ? "Close" : "New journal"}
        </button>
        {anyDrafts && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={checkXero}>
            <RefreshCw size={14} aria-hidden="true" />Check Xero for posted drafts
          </button>
        )}
        <span className={styles.barEnd}>{data.counts?.waiting ?? 0} waiting for you</span>
      </div>

      {error && <div className={styles.err} role="alert">{error}</div>}

      {notice && <div className={styles.alert} role="status">{notice}</div>}

      {adding && <NewJournal slug={slug} data={data} onDone={(n) => { setAdding(false); setNotice(n); router.refresh(); }} />}

      {data.journals.length === 0 && !adding && (
        <div className={`${styles.card} ${styles.pad}`}>
          <span className={styles.sub}>No journals for {periodLong(data.period)} yet. Agents propose them here during the close, or add one with New journal.</span>
        </div>
      )}

      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.key} className={styles.section} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className={styles.h2}>{g.title} <span className={styles.count}>{g.rows.length}</span></h2>
          <div className={styles.cards}>
            {g.rows.map((j) => (
              <details key={j.id} className={`${styles.card} ${styles.fold}`} open={g.key === "waiting"}>
                <summary className={styles.cardSummary}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowName}>{j.jnl && <span className={styles.sub}>{j.jnl} </span>}{j.narration}</span>
                    <span className={styles.num}>{money(j.total)}</span>
                  </div>
                  <div className={styles.rowMeta}>
                    <span>{j.entity_name}</span><span>{dayLabel(j.journal_date)}</span><span>{sourceLabel(j)}</span>
                  </div>
                </summary>
                <div className={styles.foldBody}><Detail slug={slug} j={j} busy={busy} send={send} /></div>
              </details>
            ))}
          </div>
          <div className={`${styles.card} ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th aria-label="Open"></th><th>No.</th><th>Company</th><th>Date</th><th>Narration</th><th>From</th><th className={styles.num}>Total</th>
                </tr>
              </thead>
              {g.rows.map((j) => <Row key={j.id} slug={slug} j={j} busy={busy} send={send} startOpen={g.key === "waiting"} />)}
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// One journal on a computer: a row that opens to its lines and the decision.
function Row({ slug, j, busy, send, startOpen }: { slug: string; j: JournalRow; busy: boolean; send: Send; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <tbody>
      <tr className={styles.mainRow} onClick={() => setOpen((o) => !o)}>
        <td className={styles.toggleCell}>
          <button type="button" className={styles.toggle} aria-expanded={open} aria-label={open ? "Close" : "Open"} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
            <ChevronRight size={14} className={open ? styles.chevOpen : styles.chev} aria-hidden="true" />
          </button>
        </td>
        <td className={`${styles.nowrap} ${styles.sub}`}>{j.jnl ?? ""}</td>
        <td>{j.entity_name}</td>
        <td className={styles.nowrap}>{dayLabel(j.journal_date)}</td>
        <td className={styles.strong}>{j.narration}</td>
        <td className={styles.sub}>{sourceLabel(j)}</td>
        <td className={styles.num}>{money(j.total)}</td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td></td>
          <td colSpan={6}><Detail slug={slug} j={j} busy={busy} send={send} /></td>
        </tr>
      )}
    </tbody>
  );
}

// What a journal is, where it is, and what the CFO can do with it.
function Detail({ slug, j, busy, send }: { slug: string; j: JournalRow; busy: boolean; send: Send }) {
  return (
    <div className={styles.detail}>
      <div className={styles.lines}>
        {j.lines.map((l, i) => (
          <div key={i} className={styles.jLine}>
            <span className={styles.lineText}><span className={styles.code}>{l.account_code}</span>{l.description ? ` ${l.description}` : ""}</span>
            <span className={styles.num}>{l.amount > 0 ? "Dr" : "Cr"} {money(Math.abs(l.amount))}</span>
          </div>
        ))}
      </div>
      {j.reason && <div className={styles.reason}><div className={styles.label}>Reason</div><MarkdownOutput text={j.reason} /></div>}
      <p className={styles.small}>
        Proposed by {j.proposed_by.replace(/^agent:/, "").replace(/^(fm1|fc)$/, (m) => m.toUpperCase())}
        {j.approved_by && j.state !== "proposed" ? ` · approved by ${j.approved_by}` : ""}
        {j.rejected_by && j.state === "rejected" ? ` · rejected by ${j.rejected_by}` : ""}
      </p>
      <State slug={slug} j={j} />
      {j.kind === "register" && <Actions j={j} busy={busy} send={send} />}
    </div>
  );
}

function State({ slug, j }: { slug: string; j: JournalRow }) {
  if (j.kind === "rec" && j.rec) {
    const where = { proposed: "Waiting for you on the reconciliation.", approved: "Approved on the reconciliation. An agent creates the draft in Xero.", draft_created: `Draft in Xero${j.xero_journal_no ? `, number ${j.xero_journal_no}` : ""}. Post it there.`, rejected: "Rejected on the reconciliation." }[j.state as "proposed"] ?? null;
    return (
      <p className={styles.sub}>
        {where} <Link className={styles.link} href={`/finance/clients/${slug}/reconciliations/${j.rec.id}`}>Open the {j.rec.account_name} reconciliation</Link>
      </p>
    );
  }
  let text: string | null = null;
  if (j.state === "proposed") text = j.last_error ? `The last approval did not reach Xero: ${j.last_error}` : "Approving creates it in Xero as a draft. You post it there.";
  if (j.state === "approved") {
    text = j.retry_state === "live" ? "Being created in Xero now."
      : j.retry_state === "unknown" ? "The last attempt did not finish cleanly, so this draft may already be in Xero. Check Xero. If it is not there, reject this and propose it again."
        : j.retry_state === "drafted" ? "This draft is in Xero. Record it to move it on."
          : `Approved, but no draft was created${j.last_error ? `: ${j.last_error}` : "."}`;
  }
  if (j.state === "draft_created") {
    const gone = j.xero_status && !["DRAFT", "POSTED"].includes(j.xero_status.toUpperCase());
    text = gone ? `Xero says this draft is ${String(j.xero_status).toLowerCase()}.` : `Draft in Xero${j.xero_journal_no ? `, number ${j.xero_journal_no}` : ""}. Post it there.`;
  }
  if (j.state === "posted") text = `Posted in Xero${j.xero_journal_no ? `, number ${j.xero_journal_no}` : ""}.`;
  if (j.state === "rejected") text = "Rejected. Nothing went to Xero.";
  return text ? <p className={j.last_error && j.state !== "rejected" ? styles.warnText : styles.sub}>{text}</p> : null;
}

function Actions({ j, busy, send }: { j: JournalRow; busy: boolean; send: Send }) {
  if (j.state === "proposed") {
    return (
      <div className={styles.actions}>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => send(`${j.id}/approve`)}>Approve as Xero draft</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${j.id}/reject`)}>Reject</button>
      </div>
    );
  }
  if (j.state !== "approved" || j.retry_state === "live") return null;
  return (
    <div className={styles.actions}>
      {(j.can_retry || j.retry_state === "drafted") && (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => send(`${j.id}/approve`)}>{j.retry_state === "drafted" ? "Record the draft" : "Try again"}</button>
      )}
      {j.retry_state !== "drafted" && j.retry_state !== "unknown" && <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${j.id}/reject`)}>Reject</button>}
      {j.retry_state === "unknown" && <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`${j.id}/reject`, { confirmed_not_in_xero: true })}>I checked: it is not in Xero. Reject</button>}
    </div>
  );
}

// ── A new journal ────────────────────────────────────────────────────────────

function NewJournal({ slug, data, onDone }: { slug: string; data: JournalList; onDone: (notice: string | null) => void }) {
  const lastDay = (() => {
    const [y, m] = data.period.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();
  const [entity, setEntity] = useState(data.entities.length === 1 ? data.entities[0].slug : "");
  const [date, setDate] = useState(lastDay);
  const [narration, setNarration] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The company's accounts, for the account search: the same list Bills uses
  // (active, with a code, bank accounts left out as a journal cannot use them).
  const [accounts, setAccounts] = useState<Array<{ value: string; label: string; name: string }> | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  useEffect(() => {
    if (!entity) { setAccounts(null); return; }
    let live = true;
    setAccounts(null);
    setAccountsError(null);
    fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/options`)
      .then((r) => r.json())
      .then((o: { error?: string; accounts?: Array<{ code: string; name: string }> }) => {
        if (!live) return;
        if (o.error || !o.accounts) { setAccountsError(o.error ?? "The accounts could not be loaded"); return; }
        setAccounts(o.accounts.map((a) => ({ value: a.code, label: `${a.code} ${a.name}`, name: a.name })));
      })
      .catch(() => live && setAccountsError("The accounts could not be loaded"));
    return () => { live = false; };
  }, [slug, entity]);

  // Choosing an account fills an empty description with its name.
  const pickAccount = (i: number, code: string) => setLines((ls) => ls.map((l, n) => {
    if (n !== i) return l;
    const name = accounts?.find((a) => a.value === code)?.name ?? "";
    return { ...l, account_code: code, description: l.description.trim() ? l.description : name };
  }));

  const bal = balanceOf(lines);
  const filled = toLines(lines);
  const ready = Boolean(entity && date && narration.trim()) && filled.length >= 2 && bal.issues.length === 0 && bal.difference === 0;
  const set = (i: number, k: keyof DraftLine, v: string) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await post(slug, "journals", { entity, date, narration: narration.trim(), reason: reason.trim() || undefined, lines: filled });
    setBusy(false);
    if (!r.ok) { setError(said(r.body, "The journal was not saved")); return; }
    const warnings = (r.body.warnings as string[] | undefined) ?? [];
    onDone(warnings.length ? warnings.join(" ") : null);
  };

  return (
    <div className={`${styles.card} ${styles.section}`}>
      <div className={styles.cardHead}><h2 className={styles.h2}>New journal</h2><span className={styles.small}>Saved for the CFO to approve. Nothing goes to Xero until then.</span></div>
      <div className={styles.form}>
        <div className={styles.formGrid}>
          <label className={styles.field}>Company
            <select className={styles.input} value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Choose...</option>
              {data.entities.map((e) => <option key={e.slug} value={e.slug}>{e.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>Date
            <input type="date" className={styles.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.span2}`}>Narration (goes to Xero)
            <input className={styles.input} value={narration} maxLength={120} onChange={(e) => setNarration(e.target.value)} placeholder="October audit fee accrual" />
          </label>
        </div>

        <div className={styles.lineHead} aria-hidden="true">
          <span>Account</span><span>Description</span><span className={styles.num}>Debit</span><span className={styles.num}>Credit</span><span></span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className={styles.lineRow}>
            <div className={styles.field}><span className={styles.phoneOnly} aria-hidden="true">Account</span>
              {accounts
                ? <SearchSelect label={`Line ${i + 1} account`} hideLabel value={l.account_code} options={accounts}
                    placeholder="Type a code or name" onChange={(v) => pickAccount(i, v)} />
                : <input className={styles.input} value={l.account_code} inputMode="numeric" aria-label={`Line ${i + 1} account code`}
                    placeholder={!entity ? "Choose the company first" : accountsError ? "Type the code" : "Loading accounts..."}
                    onChange={(e) => set(i, "account_code", e.target.value)} />}
            </div>
            <label className={styles.field}><span className={styles.phoneOnly}>Description</span>
              <input className={styles.input} value={l.description} aria-label={`Line ${i + 1} description`} onChange={(e) => set(i, "description", e.target.value)} />
            </label>
            <label className={styles.field}><span className={styles.phoneOnly}>Debit</span>
              <input className={`${styles.input} ${styles.amount}`} value={l.debit} inputMode="decimal" aria-label={`Line ${i + 1} debit`} onChange={(e) => set(i, "debit", e.target.value)} />
            </label>
            <label className={styles.field}><span className={styles.phoneOnly}>Credit</span>
              <input className={`${styles.input} ${styles.amount}`} value={l.credit} inputMode="decimal" aria-label={`Line ${i + 1} credit`} onChange={(e) => set(i, "credit", e.target.value)} />
            </label>
            <button type="button" className="btn-text" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2}
              onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}><X size={14} aria-hidden="true" /></button>
          </div>
        ))}
        {accountsError && <p className={styles.small}>{accountsError}. Type the account code instead; it is checked when you save.</p>}
        <div>
          <button type="button" className="btn-text" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={14} aria-hidden="true" />Add line</button>
        </div>

        <div className={styles.balance} role="status" aria-live="polite">
          <span>Debits {money(bal.debits / 100)}</span>
          <span>Credits {money(bal.credits / 100)}</span>
          <span className={bal.difference === 0 && filled.length >= 2 ? styles.ok : styles.warnText}>
            {filled.length < 2 ? "Add at least two lines" : bal.difference === 0 ? "Balances" : `Out by ${money(Math.abs(bal.difference) / 100)}`}
          </span>
        </div>
        {bal.issues.length > 0 && <div className={styles.small}>{bal.issues.join(". ")}.</div>}

        <label className={styles.field}>Reason (stays in os.stza.io, never sent to Xero)
          <textarea className={styles.area} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this journal is needed, and the evidence." />
        </label>

        {error && <div className={styles.err} role="alert">{error}</div>}
        <div className={styles.actions}>
          <button type="button" className="btn-primary" disabled={busy || !ready} onClick={submit}>{busy ? "Saving..." : "Save for approval"}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onDone(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

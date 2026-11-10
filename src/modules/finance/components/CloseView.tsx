"use client";

// Close: one month's close on one page, worked here (Nik, 10 Nov 2026: no
// going to Work and back for each step). Each step is its task in Work and
// opens in place: what done means, its evidence, its reconciliations with
// Start FM1, its companies, a note, and Mark done, after which the next open
// step opens. FM1 can be started on every rec the month can work in one go.
// Work stays the record underneath; a rec is still signed off on its page.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Circle, CircleDot, ArrowRight, ChevronDown, ChevronRight, Bot } from "lucide-react";
import { canStart, dueText, nextOpen, type CloseStep, type CloseView as View, type Tone } from "@/modules/finance/lib/close";
import { money, periodChoices, periodLong, STATUS_LABEL as REC_STATUS } from "@/modules/finance/lib/recs";
import page from "./Page.module.css";
import styles from "./Close.module.css";

const PILL: Record<Tone, string> = { neutral: page["s-neutral"], blue: page["s-blue"], green: page["s-green"], amber: page["s-amber"], red: page["s-red"] };
const DOT: Record<Tone, string> = { neutral: "", blue: styles["d-blue"], green: styles["d-green"], amber: styles["d-amber"], red: styles["d-red"] };

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data, issues: res.ok ? [] : (data.issues ?? [data.error ?? `Not saved (${res.status})`]) as string[] };
}

export default function CloseView({ slug, view, today, errors }: { slug: string; view: View; today: string; errors: string[] }) {
  const router = useRouter();
  const base = `/finance/clients/${encodeURIComponent(slug)}`;
  const label = periodLong(view.period);
  const pct = view.total ? Math.round((view.done / view.total) * 100) : 0;
  const [openId, setOpenId] = useState<string | null>(view.steps.find((s) => s.task.status !== "done")?.task.id ?? null);

  return (
    <div>
      <div className={styles.bar}>
        <select aria-label="Month" className={styles.pick} value={view.period}
          onChange={(e) => router.push(`${base}/close?period=${e.target.value}`)}>
          {periodChoices(view.period).map((p) => <option key={p} value={p}>{periodLong(p)}</option>)}
        </select>
        {view.started && (
          <span className={styles.barEnd}>
            {view.signedOff ? "Signed off" : `${view.done} of ${view.total} steps done`}
          </span>
        )}
      </div>

      {errors.map((e) => <div key={e} className={styles.alert}>{e}</div>)}
      {view.priorOpen && (
        <div className={styles.alert}>
          {view.priorOpen.label} is still open: a reconciliation there is not signed off or needs a re-check, and its closing is this month&apos;s opening.{" "}
          <Link href={view.priorOpen.href}>Open {view.priorOpen.label}</Link>
        </div>
      )}

      {!view.started ? <StartClose slug={slug} period={view.period} label={label} /> : (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileN}>{view.done}/{view.total}</div>
              <div className={styles.tileLabel}>Steps done</div>
            </div>
            <Link className={styles.tile} href={`${base}/reconciliations?period=${view.period}`}>
              <div className={styles.tileN}>{view.recs ? `${view.recs.signed_off}/${view.recs.total}` : "-"}</div>
              <div className={styles.tileLabel}>Recs signed off{view.recs?.not_tying ? `, ${view.recs.not_tying} not tying` : ""}</div>
            </Link>
            <Link className={styles.tile} href={`${base}/journals?period=${view.period}`}>
              <div className={styles.tileN}>{view.journalsWaiting ?? "-"}</div>
              <div className={styles.tileLabel}>Journals to approve</div>
            </Link>
            <Link className={`${styles.tile} ${view.reviewForYou ? styles.tileYou : ""}`} href={`${base}/review`}>
              <div className={styles.tileN}>{view.reviewForYou ?? "-"}</div>
              <div className={styles.tileLabel}>Waiting on you in Review</div>
            </Link>
          </div>

          <StartAll slug={slug} view={view} label={label} />

          <div className={styles.progress} role="progressbar" aria-label="Close progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>

          <section className={styles.section}>
            <h2 className={styles.h2}>Steps</h2>
            <div className={styles.steps}>
              {view.steps.map((s) => (
                <StepItem key={s.task.id} slug={slug} s={s} today={today} open={openId === s.task.id}
                  toggle={() => setOpenId(openId === s.task.id ? null : s.task.id)}
                  onDone={() => setOpenId(nextOpen(view.steps, s.task.id)?.task.id ?? null)} />
              ))}
              {!view.steps.length && <div className={styles.step}><span /><span className={styles.sub}>The close has no steps under it in Work.</span></div>}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Sign-off</h2>
            <SignOff slug={slug} view={view} label={label} />
          </section>
        </>
      )}
    </div>
  );
}

// FM1 on every rec the month can work now, in one go.
function StartAll({ slug, view, label }: { slug: string; view: View; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ queued: number; skipped: Array<{ account: string; why: string }> } | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  if (!view.startable && !said) return null;
  async function go() {
    setBusy(true);
    const r = await send(`/api/finance/${encodeURIComponent(slug)}/recs/agent-all`, "POST", { period: view.period });
    setBusy(false);
    setIssues(r.issues);
    if (r.ok) setSaid({ queued: r.data.queued?.length ?? 0, skipped: r.data.skipped ?? [] });
    router.refresh();
  }
  return (
    <div className={styles.startAll}>
      <Bot size={18} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 200 }}>
        {said ? (
          <>
            FM1 started on {said.queued} reconciliation{said.queued === 1 ? "" : "s"}. It works through them one at a time and hands each to the FC; they reach you as the FC passes them.
            {said.skipped.length > 0 && (
              <details className={styles.sub} style={{ marginTop: 4 }}>
                <summary>{said.skipped.length} not started</summary>
                <ul className={styles.left}>{said.skipped.map((x) => <li key={x.account}>{x.account}: {x.why}</li>)}</ul>
              </details>
            )}
          </>
        ) : <>FM1 can start on {view.startable} reconciliation{view.startable === 1 ? "" : "s"} for {label} that {view.startable === 1 ? "is" : "are"} not yet with a reviewer.</>}
        {issues.length > 0 && <div className={styles.issues}>{issues.join(". ")}</div>}
      </div>
      {!said && <button type="button" className="btn-primary" disabled={busy} onClick={go}>{busy ? "Starting..." : `Start FM1 on ${view.startable}`}</button>}
    </div>
  );
}

// One step, opened in place: what done means, its evidence, its recs and
// companies, a note, and Mark done.
function StepItem({ slug, s, today, open, toggle, onDone }: { slug: string; s: CloseStep; today: string; open: boolean; toggle: () => void; onDone: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const done = s.task.status === "done";
  const Icon = done ? CheckCircle2 : s.status === "todo" ? Circle : CircleDot;
  const enc = encodeURIComponent;
  const work = `/api/finance/${enc(slug)}/work/tasks`;
  const base = `/finance/clients/${enc(slug)}`;

  async function act(fn: () => Promise<{ ok: boolean; issues: string[] }[]>, after?: () => void) {
    setBusy(true);
    setIssues([]);
    const results = await fn();
    setBusy(false);
    const bad = results.find((r) => !r.ok);
    if (bad) { setIssues(bad.issues); router.refresh(); return; }
    setNote("");
    after?.();
    router.refresh();
  }
  const withNote = async (status?: string) => {
    const out = [];
    if (note.trim()) out.push(await send(`${work}/${s.task.id}/notes`, "POST", { text: note.trim() }));
    if (status) out.push(await send(`${work}/${s.task.id}`, "PATCH", { status }));
    return out;
  };

  return (
    <div className={`${styles.stepItem} ${open ? styles.stepOpen : ""}`}>
      <button type="button" className={styles.step} onClick={toggle} aria-expanded={open}>
        <span className={`${styles.icon} ${done ? styles.iconDone : ""}`}><Icon size={18} aria-hidden="true" /></span>
        <div className={styles.stepTop}>
          <span className={styles.stepName}>{s.title}</span>
          <span className={`${page.status} ${PILL[s.tone]}`}>{s.statusLabel}</span>
          {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </div>
        <div className={styles.stepMeta}>
          <span>{s.owner}</span>
          {!done && <span className={s.late ? styles.late : undefined}>{dueText(s.due_on, today)}</span>}
          {s.companies && <span>{s.companies.done} of {s.companies.total} companies done</span>}
          {!done && s.waitsFor.length > 0 && <span>Waits for {s.waitsFor.join(", ")}</span>}
        </div>
        {s.evidence && (
          <div className={styles.evidence}>
            <span className={`${styles.dot} ${DOT[s.evidence.tone]}`} aria-hidden="true" />
            <span>{s.evidence.text}</span>
          </div>
        )}
      </button>

      {open && (
        <div className={styles.panel}>
          {s.task.notes && <p className={styles.panelNote}>{s.task.notes}</p>}

          {s.recs.length > 0 && (
            <div className={styles.recList}>
              {s.recs.map((r) => (
                <div key={r.id} className={styles.recRow}>
                  <Link className={styles.recName} href={`${base}/reconciliations/${enc(r.id)}`}>{r.account_name}</Link>
                  <span className={`${page.status} ${PILL[r.status === "signed_off" ? "green" : r.status === "with_cfo" || r.status === "with_fc" ? "blue" : r.status === "sent_back" ? "red" : "neutral"]}`}>{REC_STATUS[r.status]}</span>
                  <span className={styles.recFig}>{r.ties ? "Ties" : r.difference ? `Out by ${money(r.difference)}` : r.workable ? "No evidence yet" : "Not workable yet"}</span>
                  {canStart(r) && (
                    <button type="button" className={page.miniBtn} disabled={busy}
                      onClick={() => act(async () => [await send(`/api/finance/${enc(slug)}/recs/${enc(r.id)}/agent`, "POST", {})])}>Start FM1</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {s.subs.length > 0 && (
            <div className={styles.subList}>
              {s.subs.map((x) => (
                <label key={x.id} className={styles.check}>
                  <input type="checkbox" checked={x.done} disabled={busy}
                    onChange={() => act(async () => [await send(`${work}/${x.id}`, "PATCH", { status: x.done ? "todo" : "done" })])} />
                  {x.entity ?? x.title}
                </label>
              ))}
            </div>
          )}

          <textarea className={styles.noteBox} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note"
            placeholder={done ? "Why it is being reopened" : "What was done, or why it is done without its evidence"} />
          <div className={styles.panelActions}>
            {!done ? (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => act(() => withNote("done"), onDone)}>{busy ? "Saving..." : "Mark done"}</button>
            ) : (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => act(() => withNote("todo"))}>Reopen</button>
            )}
            <button type="button" className="btn-text" disabled={busy || !note.trim()} onClick={() => act(() => withNote())}>Add note</button>
            {s.evidence && <Link className="btn-text" href={s.evidence.href}>Open {s.evidence.href.includes("/bills") ? "Bills" : s.evidence.href.includes("/journals") ? "Journals" : "Reconciliations"}</Link>}
            <Link className={`${styles.sub} ${styles.workLink}`} href={s.href}>In Work</Link>
          </div>
          {issues.length > 0 && <div className={styles.issues}>{issues.join(". ")}</div>}
        </div>
      )}
    </div>
  );
}

function SignOff({ slug, view, label }: { slug: string; view: View; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const work = `/api/finance/${encodeURIComponent(slug)}/work/tasks`;

  if (!view.signOff) {
    return <div className={styles.signOff}>This close has no sign-off step in Work, so it is signed off there by hand.</div>;
  }
  if (view.signedOff) {
    const when = view.signOff.task.closed_at ? new Date(view.signOff.task.closed_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
    return <div className={styles.signOff}>{label} is signed off{when ? ` (${when})` : ""}.</div>;
  }

  async function signOff() {
    setBusy(true);
    const ids = [view.signOff!.task.id, ...(view.closeTask && view.closeTask.status !== "done" ? [view.closeTask.id] : [])];
    for (const id of ids) {
      const r = await send(`${work}/${id}`, "PATCH", { status: "done" });
      if (!r.ok) { setIssues(r.issues); setBusy(false); return; }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={`${styles.signOff} ${view.readyToSignOff ? styles.signOffReady : ""}`}>
      {view.readyToSignOff ? (
        <>
          Every step is done, every reconciliation is signed off and no journal is waiting. Signing off marks the sign-off and the {label} close done in Work.
          <div className={styles.signOffRow}>
            <button type="button" className="btn-primary" disabled={busy} onClick={signOff}>{busy ? "Signing off..." : `Sign off ${label}`}</button>
          </div>
        </>
      ) : (
        <>
          Left before {label} can be signed off:
          <ul className={styles.left} style={{ marginTop: 10 }}>
            {view.left.map((l) => (
              <li key={l.text}>
                <Link className={styles.leftLink} href={l.href}>
                  <span className={`${styles.dot} ${DOT[l.tone]}`} aria-hidden="true" />
                  <span style={{ flex: 1 }}>{l.text}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {issues.length > 0 && <div className={styles.issues}>{issues.join(". ")}</div>}
    </div>
  );
}

interface Preview { label: string; tasks: Array<{ title: string; owner: string; due_on: string; parent: string | null; waits_for: string[] }> }

// The month-end template, as Work's Start month-end: preview, then add.
function StartClose({ slug, period, label }: { slug: string; period: string; label: string }) {
  const router = useRouter();
  const [vat, setVat] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    const r = await send(`/api/finance/${encodeURIComponent(slug)}/work/tasks/month-end`, "POST", { period, vat, dry_run: dryRun });
    setBusy(false);
    setIssues(r.issues);
    if (!r.ok) { setPreview(null); return; }
    if (dryRun) setPreview(r.data as Preview); else router.refresh();
  }

  return (
    <div className={styles.start}>
      <h2>The {label} close has not been started</h2>
      Starting it adds the close to Work from the month-end template: each step with its owner, when it is due (working days after the month end) and what it waits for. You own the close and the sign-off.
      <div className={styles.startRow}>
        <label className={styles.check}>
          <input type="checkbox" checked={vat} onChange={(e) => { setVat(e.target.checked); setPreview(null); }} />Include a VAT return
        </label>
        {preview
          ? <button type="button" className="btn-primary" disabled={busy} onClick={() => run(false)}>{busy ? "Adding..." : `Start the ${label} close`}</button>
          : <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(true)}>{busy ? "Checking..." : "Preview the steps"}</button>}
      </div>
      {preview && (
        <ul className={styles.plan}>
          {preview.tasks.slice(1).map((t, i) => (
            <li key={i} className={t.parent && t.parent !== "close" ? styles.planSub : undefined}>
              <div>{t.title}</div>
              <div className={styles.sub}>
                Due {new Date(`${t.due_on}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
                {t.waits_for.length > 0 && <> · after {t.waits_for.join(", ")}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && <div className={styles.issues}>{issues.join(". ")}</div>}
    </div>
  );
}

"use client";

// Close: one month's close on one page. Each step is its task in Work, with
// what it waits for and the month's evidence beside it; below, what is left
// before sign-off. Acting stays on each piece's own screen: a row opens the
// task in Work, a rec on Reconciliations, a journal on Journals. The two
// actions here are the ones that belong to the close itself: starting it from
// the template, and the CFO's sign-off once nothing is left.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Circle, CircleDot, ArrowRight } from "lucide-react";
import { dueText, type CloseStep, type CloseView as View, type Tone } from "@/modules/finance/lib/close";
import { periodChoices, periodLong } from "@/modules/finance/lib/recs";
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

          <div className={styles.progress} role="progressbar" aria-label="Close progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>

          <section className={styles.section}>
            <h2 className={styles.h2}>Steps</h2>
            <div className={styles.steps}>
              {view.steps.map((s) => <StepRow key={s.task.id} s={s} today={today} />)}
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

function StepRow({ s, today }: { s: CloseStep; today: string }) {
  const done = s.task.status === "done";
  const Icon = done ? CheckCircle2 : s.status === "todo" ? Circle : CircleDot;
  return (
    <Link href={s.href} className={styles.step}>
      <span className={`${styles.icon} ${done ? styles.iconDone : ""}`}><Icon size={18} aria-hidden="true" /></span>
      <div className={styles.stepTop}>
        <span className={styles.stepName}>{s.title}</span>
        <span className={`${page.status} ${PILL[s.tone]}`}>{s.statusLabel}</span>
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
    </Link>
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

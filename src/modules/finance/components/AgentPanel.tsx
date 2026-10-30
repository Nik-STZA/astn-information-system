"use client";

// Queue agent work, read what happened, and carry the conversation on.
//
// The portal only queues; queueing starts the agent-runner Cloud Run Job, which
// takes 10 to 30 seconds to start. The wait is shown with a clock rather than
// left to be discovered, because a job that appears to do nothing is otherwise
// indistinguishable from one that failed.
//
// A finished run cannot be changed, so a reply is a new run that names the one
// it answers (parent_run_id, migration 014). Runs are grouped into
// conversations here by following those links.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRunRow } from "@/modules/finance/lib/api";
import MarkdownOutput from "@/modules/finance/components/MarkdownOutput";
import styles from "./Agents.module.css";
import { monthSpend, usdText } from "@/modules/finance/lib/agent-spend";
import { conversations } from "@/modules/finance/lib/conversations";
import { askedText } from "@/modules/finance/lib/page-context";

export const AGENTS = [
  { key: "", label: "Any", hint: "No specific agent: a general finance session for this client" },
  { key: "fc", label: "FC", hint: "Financial Controller review, close quality, commentary" },
  { key: "fpa", label: "FP&A", hint: "Variance, reforecast, runway, scenarios" },
  { key: "fm1", label: "FM1", hint: "Month-end close: bank, accruals, payroll, fixed assets, VAT return" },
  { key: "fm2", label: "FM2", hint: "Review AP, AR and VAT work" },
  { key: "ap-clerk", label: "AP Clerk", hint: "Supplier bills, coding, supplier statements" },
  { key: "ar-clerk", label: "AR Clerk", hint: "Sales invoices, billing reconciliation, ageing" },
];

// Who answered: initials in an avatar, as on Overview's agent activity.
const AGENT_IDENTITY: Record<string, { initials: string; title: string; short: string }> = {
  fc: { initials: "FC", title: "Financial Controller", short: "FC" },
  fpa: { initials: "PA", title: "FP&A", short: "FP&A" },
  fm2: { initials: "F2", title: "Finance Manager (AP, AR and VAT)", short: "FM2" },
  fm1: { initials: "F1", title: "Finance Manager (month-end and VAT)", short: "FM1" },
  "ap-clerk": { initials: "AP", title: "AP Clerk", short: "AP Clerk" },
  "ar-clerk": { initials: "AR", title: "AR Clerk", short: "AR Clerk" },
};

const DEFAULT_IDENTITY = { initials: "AI", title: "Finance team", short: "Team" };

export function agentIdentity(agent: string | null) {
  if (agent && AGENT_IDENTITY[agent]) return AGENT_IDENTITY[agent];
  return DEFAULT_IDENTITY;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", running: "Working", succeeded: "Done", failed: "Failed", cancelled: "Cancelled",
};

export const FINISHED = new Set(["succeeded", "failed", "cancelled"]);

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export async function postRun(
  slug: string,
  body: { agent: string | null; instruction: string; parentRunId?: string }
): Promise<string | null> {
  try {
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return b.error ?? "Could not queue the job";
  } catch {
    return "Could not queue the job";
  }
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`${styles.status} ${styles[`s-${status}`] ?? styles["s-queued"]}`}>
      <span className={styles.dot} />{STATUS_LABEL[status] ?? status}
    </span>
  );
}

// One turn: what was asked, what came back, and what it touched.
function Turn({ run, followUp }: { run: AgentRunRow; followUp: boolean }) {
  const identity = agentIdentity(run.agent);
  const seconds = run.duration_ms ? Math.round(run.duration_ms / 1000) : null;

  return (
    <div className={styles.turn}>
      <div className={styles.who}>
        {followUp && <StatusPill status={run.status} />}
        <span>
          {followUp ? "Follow-up from " : "Asked by "}
          {run.requested_by_email}
          {run.requested_by_role ? ` (${run.requested_by_role})` : ""}
          {` · ${when(run.queued_at)}`}
          {seconds !== null ? ` · ${seconds}s` : ""}
        </span>
      </div>

      <div className={styles.label}>{followUp ? "Follow-up" : "Question"}</div>
      <div className={styles.instruction}>{askedText(run.instruction)}</div>

      {run.output && (
        <>
          <div className={styles.answerHead}>
            <span className={styles.ava} aria-hidden="true">{identity.initials}</span>{identity.title}
          </div>
          <div className={styles.answer}><MarkdownOutput text={run.output} /></div>
        </>
      )}

      {!FINISHED.has(run.status) && (
        <div className={styles.pending}>
          <PendingStatus status={run.status} queuedAt={run.queued_at} startedAt={run.started_at} />
        </div>
      )}

      {run.error && <div className={styles.runError}>{run.error}</div>}

      {/* The forensic half: what it called and what it touched. Paths only. */}
      <div className={styles.forensic}>
        {run.tools_used?.length > 0 && (
          <div>Tools: {run.tools_used.map((t) => `${t.name} x${t.count}`).join(", ")}</div>
        )}
        {run.files_touched?.length > 0 && (
          <div>
            Files:
            <ul style={{ margin: "3px 0 0", paddingLeft: 16 }}>
              {run.files_touched.map((f) => <li key={f} style={{ overflowWrap: "anywhere" }}>{f}</li>)}
            </ul>
          </div>
        )}
        {run.cost_usd && <div>Cost: {usdText(Number(run.cost_usd))}</div>}
        {run.session_id && <div style={{ overflowWrap: "anywhere" }}>Session: {run.session_id}</div>}
      </div>
    </div>
  );
}

function ReplyBox({
  slug,
  parent,
  onQueued,
}: {
  slug: string;
  parent: AgentRunRow;
  onQueued: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const err = await postRun(slug, { agent: parent.agent, instruction: text, parentRunId: parent.id });
    if (err) setError(err);
    else {
      setText("");
      await onQueued();
    }
    setBusy(false);
  }

  return (
    <div className={styles.reply}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={styles.textarea}
        placeholder="Ask a follow-up. The agent sees this conversation so far." />
      <div className={styles.actions}>
        <button type="button" className="btn-primary" onClick={send} disabled={busy || !text.trim()}>
          {busy ? "Sending..." : "Send follow-up"}
        </button>
        {error && <span className={styles.warn}>{error}</span>}
      </div>
    </div>
  );
}

function Conversation({
  slug,
  runs,
  onQueued,
}: {
  slug: string;
  runs: AgentRunRow[];
  onQueued: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const root = runs[0];
  const latest = runs[runs.length - 1];
  const followUps = runs.length - 1;

  const identity = agentIdentity(root.agent);
  const toggle = () => setOpen((o) => !o);

  return (
    <div className={styles.conv}>
      <div role="button" tabIndex={0} aria-expanded={open} onClick={toggle} className={styles.convHead}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
        <span className={styles.ava} title={identity.title}>{identity.initials}</span>
        <span className={styles.convMain}>
          <span className={styles.convTitle}>{askedText(root.instruction)}</span>
          <span className={styles.convMeta}>
            {identity.short} · {when(latest.queued_at)}
            {followUps > 0 && ` · ${followUps} follow-up${followUps === 1 ? "" : "s"}`}
          </span>
        </span>
        <span className={styles.convSide}><StatusPill status={latest.status} /></span>
      </div>

      {open && (
        <div className={styles.body}>
          {runs.map((r, i) => <Turn key={r.id} run={r} followUp={i > 0} />)}
          {FINISHED.has(latest.status) && <ReplyBox slug={slug} parent={latest} onQueued={onQueued} />}
        </div>
      )}
    </div>
  );
}

export default function AgentPanel({
  slug,
  initialRuns,
}: {
  slug: string;
  initialRuns: AgentRunRow[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [agent, setAgent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`);
      if (res.ok) setRuns(((await res.json()).data as AgentRunRow[]) ?? []);
    } catch {
      /* a failed refresh is not worth interrupting the page for */
    }
  }, [slug]);

  // Poll only while something is outstanding. A finished list does not change
  // on its own, and polling a static list is just noise.
  const pending = runs.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!pending) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(refresh, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [pending, refresh]);

  async function queue() {
    if (!instruction.trim()) return;
    setBusy(true);
    setError(null);
    const err = await postRun(slug, { agent: agent || null, instruction });
    if (err) setError(err);
    else {
      setInstruction("");
      await refresh();
    }
    setBusy(false);
  }

  const selected = AGENTS.find((a) => a.key === agent);
  const threads = conversations(runs);
  const spend = monthSpend(runs);

  return (
    <div>
      <section className={`${styles.card} ${styles.ask}`} aria-label="Ask an agent">
        <div className={styles.segWrap}>
          <div className="seg" role="group" aria-label="Agent">
            {AGENTS.map((a) => (
              <button key={a.key || "none"} type="button" title={a.hint} aria-pressed={agent === a.key}
                className={agent === a.key ? "seg-on" : undefined} onClick={() => setAgent(a.key)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        {selected?.hint && <div className={styles.hint}>{selected.hint}</div>}
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} className={styles.textarea}
          placeholder="What should it do? For example: review the July bank reconciliation and tell me what is still outstanding." />
        <div className={styles.actions}>
          <button type="button" className="btn-primary" onClick={queue} disabled={busy || !instruction.trim()}>
            {busy ? "Asking..." : "Ask"}
          </button>
          <span className={styles.hint}>Runs in the cloud and usually starts within 30 seconds.</span>
        </div>
        {error && <div className={styles.warn}>{error}</div>}
      </section>

      <div className={styles.listHead}>
        <h2>Conversations</h2>
        {pending && <span className={styles.updating}>Updating</span>}
        {spend.costed + spend.uncosted > 0 && (
          <span className={styles.updating} style={{ marginLeft: "auto" }}
            title="What the model calls cost at list price, from each run's record">
            This month: {usdText(spend.usd)} across {spend.costed} run{spend.costed === 1 ? "" : "s"}
            {spend.uncosted ? `, ${spend.uncosted} without a cost` : ""}
          </span>
        )}
      </div>

      <section className={styles.card} aria-label="Conversations">
        {threads.length === 0 ? (
          <div className={styles.empty}>Nothing has been run for this client yet.</div>
        ) : (
          <div className={styles.list}>
            {threads.map((t) => <Conversation key={t[0].id} slug={slug} runs={t} onQueued={refresh} />)}
          </div>
        )}
      </section>
    </div>
  );
}

// What a run still in progress is doing, with a clock, so a wait reads as
// progress. Runs start as a Cloud Run Job, which takes 10 to 30 seconds to
// start (27 Oct 2026); the old "Waiting for the runner" looked like a hang.
// A run queued for more than two minutes has not been started, and says so.
const STUCK_SECONDS = 120;

export function PendingStatus({ status, queuedAt, startedAt }: { status: string; queuedAt: string; startedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const since = (iso: string | null) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : 0);
  const clock = (n: number) => (n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`);
  if (status === "queued") {
    const waited = since(queuedAt);
    return waited > STUCK_SECONDS
      ? <>Not started after {clock(waited)}. The agent runner did not pick this up; it will run when the runner next starts.</>
      : <>Starting the agent (usually 10 to 30 seconds)… {clock(waited)}</>;
  }
  return <>Working: reading the books and writing the answer… {clock(since(startedAt ?? queuedAt))}</>;
}

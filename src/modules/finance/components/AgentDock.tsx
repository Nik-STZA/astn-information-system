"use client";

// The finance team, on any client page: a button at the bottom right opens a
// panel where the person picks an agent and talks about what they have open.
// The question goes with what is on screen (lib/page-context.ts). Runs and
// conversations are the same ones the Agents page shows.

import { Bot, Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRunRow } from "@/modules/finance/lib/api";
import { conversations } from "@/modules/finance/lib/conversations";
import { agentFor, askedText, pageContext, withPageContext } from "@/modules/finance/lib/page-context";
import { AGENTS, FINISHED, PendingStatus, StatusPill, agentIdentity, postRun } from "./AgentPanel";
import MarkdownOutput from "./MarkdownOutput";
import styles from "./AgentDock.module.css";

const OPEN_KEY = "stza-agent-dock";

function remembered(): boolean {
  try { return sessionStorage.getItem(OPEN_KEY) === "open"; } catch { return false; }
}
function remember(open: boolean) {
  try { sessionStorage.setItem(OPEN_KEY, open ? "open" : "closed"); } catch { /* a convenience only */ }
}

export default function AgentDock() {
  const pathname = usePathname();
  const query = useSearchParams();
  const router = useRouter();
  const context = useMemo(() => pageContext(pathname, query), [pathname, query]);
  const slug = context?.slug ?? null;
  const onAgentsPage = context?.section === "Agents";

  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [agent, setAgent] = useState("");
  const [rootId, setRootId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setOpen(remembered()); }, []);
  useEffect(() => { setAgent(agentFor(context?.section ?? "")); }, [context?.section]);
  useEffect(() => { setRootId(null); setRuns([]); }, [slug]);

  const showing = open && !!slug && !onAgentsPage;
  useEffect(() => {
    document.documentElement.dataset.agentDock = showing ? "open" : "closed";
  }, [showing]);

  const refresh = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`);
      if (res.ok) setRuns(((await res.json()).data as AgentRunRow[]) ?? []);
    } catch { /* the next poll tries again */ }
  }, [slug]);

  useEffect(() => { if (showing) refresh(); }, [showing, refresh]);

  // While a run is going, keep reading; when it ends, refresh the page under it,
  // because the agent may have saved something that is on screen.
  const pending = runs.some((r) => !FINISHED.has(r.status));
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) router.refresh();
    wasPending.current = pending;
    if (!pending || !showing) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [pending, showing, refresh, router]);

  const threads = useMemo(() => conversations(runs), [runs]);
  const thread = rootId ? threads.find((t) => t[0].id === rootId) ?? null : null;
  const latest = thread ? thread[thread.length - 1] : null;

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [thread?.length, latest?.status]);

  if (!slug || onAgentsPage) return null;

  function toggle(next: boolean) {
    setOpen(next);
    remember(next);
  }

  async function send() {
    if (!text.trim() || !context || !slug) return;
    setBusy(true);
    setError(null);
    const screen = document.querySelector("main")?.textContent ?? "";
    const instruction = withPageContext(text, context, screen.replace(/\s+/g, " "));
    const err = await postRun(slug, latest
      ? { agent: latest.agent, instruction, parentRunId: latest.id }
      : { agent: agent || null, instruction });
    if (err) setError(err);
    else {
      setText("");
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`);
      const rows = res.ok ? ((await res.json()).data as AgentRunRow[]) ?? [] : runs;
      setRuns(rows);
      if (!rootId) {
        const mine = conversations(rows).find((t) => t[0].instruction === instruction);
        if (mine) setRootId(mine[0].id);
      }
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" className={styles.launcher} onClick={() => toggle(true)} aria-label="Talk to the finance team">
        <Bot size={20} aria-hidden="true" />
      </button>
    );
  }

  const canSend = !latest || FINISHED.has(latest.status);
  return (
    <aside className={styles.dock} aria-label="Finance team">
      <header className={styles.head}>
        <span className={styles.title}>{latest ? agentIdentity(latest.agent).title : "Finance team"}</span>
        {thread && (
          <button type="button" className={styles.icon} onClick={() => setRootId(null)} aria-label="New conversation" title="New conversation">
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
        <button type="button" className={styles.icon} onClick={() => toggle(false)} aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.scroll}>
        {thread ? (
          thread.map((run) => {
            const who = agentIdentity(run.agent);
            return (
              <div key={run.id} className={styles.turn}>
                {askedText(run.instruction).startsWith("Hand-off from ")
                  ? <div className={styles.handoff}>{askedText(run.instruction)}</div>
                  : <div className={styles.mine}>{askedText(run.instruction)}</div>}
                {run.output && (
                  <div className={styles.theirs}>
                    <div className={styles.who}><span className={styles.ava} aria-hidden="true">{who.initials}</span>{who.short}</div>
                    <MarkdownOutput text={run.output} />
                  </div>
                )}
                {!FINISHED.has(run.status) && (
                  <div className={styles.waiting}><PendingStatus status={run.status} queuedAt={run.queued_at} startedAt={run.started_at} /></div>
                )}
                {run.error && <div className={styles.error}>{run.error}</div>}
              </div>
            );
          })
        ) : (
          <>
            <div className="seg" role="group" aria-label="Agent" style={{ flexWrap: "wrap" }}>
              {AGENTS.map((a) => (
                <button key={a.key || "none"} type="button" title={a.hint} aria-pressed={agent === a.key}
                  className={agent === a.key ? "seg-on" : undefined} onClick={() => setAgent(a.key)}>
                  {a.label}
                </button>
              ))}
            </div>
            {threads.length > 0 && <div className={styles.label}>Recent</div>}
            {threads.slice(0, 8).map((t) => {
              const last = t[t.length - 1];
              return (
                <button key={t[0].id} type="button" className={styles.recent} onClick={() => setRootId(t[0].id)}>
                  <span className={styles.ava} aria-hidden="true">{agentIdentity(t[0].agent).initials}</span>
                  <span className={styles.recentText}>{askedText(t[0].instruction)}</span>
                  <StatusPill status={last.status} />
                </button>
              );
            })}
          </>
        )}
        <div ref={end} />
      </div>

      <footer className={styles.foot}>
        <div className={styles.context}>Sees: {context?.section}{context?.entity ? `, ${context.entity}` : ""}{context?.item ? ", this item" : ""}</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={styles.input}
          placeholder={thread ? "Reply" : "Ask about what you have open"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend && !busy) send(); } }} />
        <div className={styles.actions}>
          <button type="button" className="btn-primary" onClick={send} disabled={busy || !canSend || !text.trim()}>
            {busy ? "Sending..." : "Send"}
          </button>
          {error && <span className={styles.error}>{error}</span>}
        </div>
      </footer>
    </aside>
  );
}

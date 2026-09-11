"use client";

// Queue agent work, read what happened, and carry the conversation on.
//
// The portal only queues. Execution is on the operator's machine, so a job sits
// at "queued" until the runner picks it up. That is stated on screen rather
// than left to be discovered, because a job that appears to do nothing is
// otherwise indistinguishable from one that failed.
//
// A finished run cannot be changed, so a reply is a new run that names the one
// it answers (parent_run_id, migration 014). Runs are grouped into
// conversations here by following those links.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRunRow } from "@/modules/finance/lib/api";
import MarkdownOutput from "@/modules/finance/components/MarkdownOutput";
import { conversations } from "@/modules/finance/lib/conversations";

const AGENTS = [
  { key: "", label: "No specific agent", hint: "General session in the client folder" },
  { key: "fc", label: "FC", hint: "Financial Controller review, close quality, commentary" },
  { key: "fpa", label: "FP&A", hint: "Variance, reforecast, runway, scenarios" },
  { key: "fm2", label: "FM2", hint: "Review AP, AR and VAT work" },
  { key: "ap-clerk", label: "AP Clerk", hint: "AP posting, vendor setup, reconciliation" },
];

// Agent identity for the output section — icon, full title, accent colour
const AGENT_IDENTITY: Record<string, { icon: string; title: string; accent: string }> = {
  fc:         { icon: "\u{1F4CB}", title: "Financial Controller",        accent: "#C5A059" },  // clipboard
  fpa:        { icon: "\u{1F4C8}", title: "FP&A Analyst",               accent: "#5B8DEF" },  // chart increasing
  fm2:        { icon: "\u{1F50D}", title: "Finance Manager — AP/AR/VAT", accent: "#7EC8A0" },  // magnifying glass
  "ap-clerk": { icon: "\u{1F4C4}", title: "AP Clerk",                   accent: "#C4A0D9" },  // page facing up
};

const DEFAULT_IDENTITY = { icon: "\u{1F4BC}", title: "Finance Team", accent: "#8E9196" };  // briefcase

function agentIdentity(agent: string | null) {
  if (agent && AGENT_IDENTITY[agent]) return AGENT_IDENTITY[agent];
  return DEFAULT_IDENTITY;
}

const STATUS_COLOUR: Record<string, string> = {
  queued: "var(--sub)",
  running: "var(--status-blue)",
  succeeded: "var(--success-green)",
  failed: "var(--alert-red)",
  cancelled: "var(--sub)",
};

const FINISHED = new Set(["succeeded", "failed", "cancelled"]);

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function postRun(
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

function StatusPill({ status }: { status: string }) {
  const colour = STATUS_COLOUR[status] ?? "var(--sub)";
  return (
    <span
      style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
        padding: "2px 6px", borderRadius: 3, border: `1px solid ${colour}`, color: colour,
      }}
    >
      {status}
    </span>
  );
}

// One turn: what was asked, what came back, and what it touched.
function Turn({ run, followUp }: { run: AgentRunRow; followUp: boolean }) {
  const identity = agentIdentity(run.agent);
  const seconds = run.duration_ms ? Math.round(run.duration_ms / 1000) : null;

  return (
    <div
      style={
        followUp
          ? { marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--bd)" }
          : undefined
      }
    >
      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        {followUp && <StatusPill status={run.status} />}
        <span>
          {followUp ? "Follow-up from " : "Requested by "}
          {run.requested_by_email}
          {run.requested_by_role ? ` (${run.requested_by_role})` : ""}
          {` · ${when(run.queued_at)}`}
          {seconds !== null ? ` · ${seconds}s` : ""}
        </span>
      </div>

      <div style={{ color: "var(--sub)", fontSize: 11, marginBottom: 2 }}>
        {followUp ? "Follow-up" : "Instruction"}
      </div>
      <div style={{ color: "var(--tx)", whiteSpace: "pre-wrap", marginBottom: 10 }}>
        {run.instruction}
      </div>

      {run.output && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              padding: "6px 10px",
              borderRadius: 6,
              background: `${identity.accent}12`,
              border: `1px solid ${identity.accent}30`,
            }}
          >
            <span style={{ fontSize: 18 }}>{identity.icon}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: identity.accent, letterSpacing: ".02em" }}>
              {identity.title}
            </span>
          </div>
          <div style={{ color: "var(--sub)", fontSize: 11, marginBottom: 4 }}>Output</div>
          <div style={{ marginBottom: 10 }}>
            <MarkdownOutput text={run.output} />
          </div>
        </>
      )}

      {!FINISHED.has(run.status) && (
        <div style={{ fontSize: 11.5, color: STATUS_COLOUR[run.status], marginBottom: 10 }}>
          {run.status === "queued" ? "Waiting for the runner to pick this up…" : "Working on it…"}
        </div>
      )}

      {run.error && (
        <div style={{ color: "var(--alert-red)", whiteSpace: "pre-wrap", marginBottom: 10 }}>
          {run.error}
        </div>
      )}

      {/* The forensic half: what it called and what it touched. Paths only. */}
      <div style={{ fontSize: 11, color: "var(--sub)" }}>
        {run.tools_used?.length > 0 && (
          <div>Tools: {run.tools_used.map((t) => `${t.name} x${t.count}`).join(", ")}</div>
        )}
        {run.files_touched?.length > 0 && (
          <div style={{ marginTop: 3 }}>
            Files:
            <ul style={{ margin: "3px 0 0", paddingLeft: 16 }}>
              {run.files_touched.map((f) => (
                <li key={f} style={{ overflowWrap: "anywhere" }}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {run.cost_usd && <div style={{ marginTop: 3 }}>Cost: ${Number(run.cost_usd).toFixed(4)}</div>}
        {run.session_id && (
          <div style={{ marginTop: 3, overflowWrap: "anywhere" }}>Session: {run.session_id}</div>
        )}
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
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--bd)" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Ask a follow-up. The agent sees this conversation so far."
        style={{
          width: "100%", fontFamily: "Manrope, sans-serif", fontSize: 12.5, lineHeight: 1.5,
          padding: "8px 10px", borderRadius: 6, border: "1px solid var(--bd)",
          background: "var(--pg)", color: "var(--tx)", resize: "vertical",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 7, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          style={{
            fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "none",
            background: text.trim() ? "#C5A059" : "var(--bd)",
            color: text.trim() ? "#141414" : "var(--sub)",
            cursor: text.trim() ? "pointer" : "default",
          }}
        >
          {busy ? "Sending…" : "Send follow-up"}
        </button>
        {error && <span style={{ fontSize: 11.5, color: "var(--warning-amber)" }}>{error}</span>}
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

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        padding: "11px 13px",
        marginBottom: 8,
        background: "var(--pnl)",
        fontFamily: "Manrope, sans-serif",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
        }}
        style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", cursor: "pointer" }}
      >
        <StatusPill status={latest.status} />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: agentIdentity(root.agent).accent,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ fontSize: 13 }}>{agentIdentity(root.agent).icon}</span>
          {root.agent
            ? (AGENTS.find((a) => a.key === root.agent)?.label ?? root.agent)
            : "Team"}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--tx)", flex: 1, minWidth: 180 }}>
          {root.instruction.length > 90 ? `${root.instruction.slice(0, 90)}…` : root.instruction}
        </span>
        {followUps > 0 && (
          <span style={{ fontSize: 10.5, color: "var(--sub)", whiteSpace: "nowrap" }}>
            {followUps} follow-up{followUps === 1 ? "" : "s"}
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--sub)", whiteSpace: "nowrap" }}>
          {when(latest.queued_at)}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.55 }}>
          {runs.map((r, i) => (
            <Turn key={r.id} run={r} followUp={i > 0} />
          ))}
          {FINISHED.has(latest.status) && (
            <ReplyBox slug={slug} parent={latest} onQueued={onQueued} />
          )}
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

  return (
    <div>
      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 10,
          padding: "14px 16px",
          background: "var(--pnl)",
          marginBottom: 20,
          fontFamily: "Manrope, sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {AGENTS.map((a) => (
            <button
              key={a.key || "none"}
              type="button"
              title={a.hint}
              onClick={() => setAgent(a.key)}
              style={{
                fontSize: 11, fontWeight: agent === a.key ? 700 : 500,
                padding: "5px 10px", borderRadius: 5, cursor: "pointer",
                border: `1px solid ${agent === a.key ? "#C5A059" : "var(--bd)"}`,
                background: agent === a.key ? "rgba(197,160,89,.12)" : "transparent",
                color: agent === a.key ? "var(--tx)" : "var(--sub)",
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {selected?.hint && (
          <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 8 }}>{selected.hint}</div>
        )}

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="What should it do? For example: review the July bank reconciliation and tell me what is still outstanding."
          style={{
            width: "100%", fontFamily: "Manrope, sans-serif", fontSize: 12.5, lineHeight: 1.5,
            padding: "9px 11px", borderRadius: 6, border: "1px solid var(--bd)",
            background: "var(--pg)", color: "var(--tx)", resize: "vertical",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 9, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={queue}
            disabled={busy || !instruction.trim()}
            style={{
              fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none",
              background: instruction.trim() ? "#C5A059" : "var(--bd)",
              color: instruction.trim() ? "#141414" : "var(--sub)",
              cursor: instruction.trim() ? "pointer" : "default",
            }}
          >
            {busy ? "Queueing…" : "Queue job"}
          </button>
          <span style={{ fontSize: 10.5, color: "var(--sub)" }}>
            Runs on your machine. A job stays queued until the runner is running.
          </span>
        </div>

        {error && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--warning-amber)" }}>{error}</div>
        )}
      </div>

      <div
        style={{
          fontFamily: "Manrope, sans-serif", fontSize: 10, fontWeight: 700,
          letterSpacing: ".07em", textTransform: "uppercase", color: "var(--sub)", marginBottom: 8,
        }}
      >
        Conversations {pending && <span style={{ color: "var(--status-blue)" }}>· updating</span>}
      </div>

      {threads.length === 0 ? (
        <div
          style={{
            padding: 24, textAlign: "center", border: "1px dashed var(--empty-border)",
            borderRadius: 10, background: "var(--empty-bg)", color: "var(--empty-text)",
            fontFamily: "Manrope, sans-serif", fontSize: 13,
          }}
        >
          Nothing has been run for this client yet.
        </div>
      ) : (
        threads.map((t) => <Conversation key={t[0].id} slug={slug} runs={t} onQueued={refresh} />)
      )}
    </div>
  );
}

"use client";

// Queue agent work and read what happened.
//
// The portal only queues. Execution is on the operator's machine, so a job sits
// at "queued" until the runner picks it up. That is stated on screen rather
// than left to be discovered, because a job that appears to do nothing is
// otherwise indistinguishable from one that failed.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRunRow } from "@/modules/finance/lib/api";

const AGENTS = [
  { key: "", label: "No specific agent", hint: "General session in the client folder" },
  { key: "fc", label: "FC", hint: "Financial Controller review, close quality, commentary" },
  { key: "fpa", label: "FP&A", hint: "Variance, reforecast, runway, scenarios" },
  { key: "fm2", label: "FM2", hint: "Review AP, AR and VAT work" },
  { key: "ap-clerk", label: "AP Clerk", hint: "AP posting, vendor setup, reconciliation" },
];

const STATUS_COLOUR: Record<string, string> = {
  queued: "var(--sub)",
  running: "var(--status-blue)",
  succeeded: "var(--success-green)",
  failed: "var(--alert-red)",
  cancelled: "var(--sub)",
};

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function Run({ run }: { run: AgentRunRow }) {
  const [open, setOpen] = useState(false);
  const colour = STATUS_COLOUR[run.status] ?? "var(--sub)";
  const seconds = run.duration_ms ? Math.round(run.duration_ms / 1000) : null;

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
        <span
          style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
            padding: "2px 6px", borderRadius: 3, border: `1px solid ${colour}`, color: colour,
          }}
        >
          {run.status}
        </span>
        {run.agent && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#C5A059" }}>{run.agent}</span>
        )}
        <span style={{ fontSize: 12.5, color: "var(--tx)", flex: 1, minWidth: 180 }}>
          {run.instruction.length > 90 ? `${run.instruction.slice(0, 90)}…` : run.instruction}
        </span>
        <span style={{ fontSize: 11, color: "var(--sub)", whiteSpace: "nowrap" }}>
          {when(run.queued_at)}
          {seconds !== null ? ` · ${seconds}s` : ""}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.55 }}>
          <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 6 }}>
            Requested by {run.requested_by_email}
            {run.requested_by_role ? ` (${run.requested_by_role})` : ""}
          </div>

          <div style={{ color: "var(--sub)", fontSize: 11, marginBottom: 2 }}>Instruction</div>
          <div style={{ color: "var(--tx)", whiteSpace: "pre-wrap", marginBottom: 10 }}>
            {run.instruction}
          </div>

          {run.output && (
            <>
              <div style={{ color: "var(--sub)", fontSize: 11, marginBottom: 2 }}>Output</div>
              <div style={{ color: "var(--tx)", whiteSpace: "pre-wrap", marginBottom: 10 }}>
                {run.output}
              </div>
            </>
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
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agent || null, instruction }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not queue the job");
        return;
      }
      setInstruction("");
      await refresh();
    } catch {
      setError("Could not queue the job");
    } finally {
      setBusy(false);
    }
  }

  const selected = AGENTS.find((a) => a.key === agent);

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
        Runs {pending && <span style={{ color: "var(--status-blue)" }}>· updating</span>}
      </div>

      {runs.length === 0 ? (
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
        runs.map((r) => <Run key={r.id} run={r} />)
      )}
    </div>
  );
}

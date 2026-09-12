"use client";

// Queue a management pack build and follow it.
//
// A laptop build sits at "queued" until the report runner picks it up, and the
// page says so; a cloud build is already running when it appears, because
// finance-api starts the job itself. Output paths are shown with
// a copy button rather than as links: the files are on the Finance shared
// drive, which a browser cannot open by path.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PackExecutor, ReportRunRow } from "@/modules/finance/lib/api";

const STATUS_COLOUR: Record<string, string> = {
  queued: "var(--sub)",
  running: "var(--status-blue)",
  succeeded: "var(--success-green)",
  failed: "var(--alert-red)",
  cancelled: "var(--sub)",
};

const pad = (n: number) => String(n).padStart(2, "0");

function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// The current month and the eleven before it. The default is last month,
// because a pack is built after the month closes.
function recentMonths(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }
  return out;
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{
        fontSize: 10.5, padding: "2px 7px", borderRadius: 4, cursor: "pointer",
        border: "1px solid var(--bd)", background: "transparent", color: "var(--sub)",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? "Copied" : "Copy path"}
    </button>
  );
}

function RunRow({ run }: { run: ReportRunRow }) {
  const colour = STATUS_COLOUR[run.status] ?? "var(--sub)";
  const minutes = run.duration_ms ? Math.max(1, Math.round(run.duration_ms / 60000)) : null;

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        padding: "11px 13px",
        marginBottom: 8,
        background: "var(--pnl)",
        fontFamily: "Manrope, sans-serif",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
            padding: "2px 6px", borderRadius: 3, border: `1px solid ${colour}`, color: colour,
          }}
        >
          {run.status}
        </span>
        <span style={{ fontWeight: 700, color: "var(--tx)" }}>{monthLabel(run.period)}</span>
        <span style={{ color: "var(--sub)", fontSize: 11, flex: 1, minWidth: 180 }}>
          Requested by {run.requested_by_email}
        </span>
        <span style={{ fontSize: 11, color: "var(--sub)", whiteSpace: "nowrap" }}>
          {when(run.queued_at)}
          {minutes !== null ? ` · ${minutes} min` : ""}
        </span>
      </div>

      {run.status === "queued" && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--sub)" }}>
          Waiting for the report runner on your machine to pick this up.
        </div>
      )}
      {run.status === "running" && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--status-blue)" }}>
          Building. The full close pulls Xero for every entity and usually takes several minutes.
        </div>
      )}

      {run.output_files?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 4 }}>
            Saved as drafts to the Finance shared drive
          </div>
          {run.output_files.map((f) => (
            <div
              key={f.path}
              style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}
            >
              <span style={{ fontWeight: 600, color: "var(--tx)" }}>{f.name}</span>
              <span style={{ fontSize: 11, color: "var(--sub)", overflowWrap: "anywhere", flex: 1, minWidth: 200 }}>
                {f.path}
              </span>
              <CopyPath path={f.path} />
            </div>
          ))}
        </div>
      )}

      {run.error && (
        <div style={{ marginTop: 8, color: "var(--alert-red)", whiteSpace: "pre-wrap" }}>{run.error}</div>
      )}

      {run.log_tail && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 11, color: "var(--sub)", cursor: "pointer" }}>Pipeline log</summary>
          <pre
            style={{
              marginTop: 6, maxHeight: 320, overflow: "auto", fontSize: 11, lineHeight: 1.45,
              padding: "8px 10px", borderRadius: 6, background: "var(--pg)", color: "var(--tx)",
              whiteSpace: "pre-wrap", overflowWrap: "anywhere",
            }}
          >
            {run.log_tail}
          </pre>
        </details>
      )}
    </div>
  );
}

export default function ManagementPackPanel({
  slug,
  initialRuns,
  executor,
}: {
  slug: string;
  initialRuns: ReportRunRow[];
  executor: PackExecutor;
}) {
  const months = recentMonths();
  const [period, setPeriod] = useState(months[1]);
  const [runs, setRuns] = useState(initialRuns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/finance/${encodeURIComponent(slug)}/report-runs?report=management_pack`
      );
      if (res.ok) setRuns(((await res.json()).data as ReportRunRow[]) ?? []);
    } catch {
      /* a failed refresh is not worth interrupting the page for */
    }
  }, [slug]);

  // Poll only while a build is outstanding.
  const pending = runs.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!pending) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(refresh, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [pending, refresh]);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/report-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: "management_pack", period }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? "Could not queue the build");
      else await refresh();
    } catch {
      setError("Could not queue the build");
    } finally {
      setBusy(false);
    }
  }

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
          maxWidth: 760,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--sub)" }} htmlFor="pack-period">
            Month
          </label>
          <select
            id="pack-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            style={{
              fontFamily: "Manrope, sans-serif", fontSize: 12.5, padding: "6px 8px", borderRadius: 6,
              border: "1px solid var(--bd)", background: "var(--pg)", color: "var(--tx)",
            }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={build}
            disabled={busy}
            style={{
              fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none",
              background: "#C5A059", color: "#141414", cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "Queueing…" : "Build management pack"}
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 9, lineHeight: 1.6 }}>
          {executor === "cloud"
            ? "Runs in Google Cloud: nothing to start, and the laptop can be closed. "
            : "Runs on your machine: start the report runner and keep the laptop awake. "}
          The month&apos;s highlights and dashboard commentary files must exist first. The result is
          a draft, so check Balance Control (7 or fewer flagged items) and the cash-flow variance
          (£14 or less) before sign-off.
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
        Builds {pending && <span style={{ color: "var(--status-blue)" }}>· updating</span>}
      </div>

      {runs.length === 0 ? (
        <div
          style={{
            padding: 24, textAlign: "center", border: "1px dashed var(--empty-border)",
            borderRadius: 10, background: "var(--empty-bg)", color: "var(--empty-text)",
            fontFamily: "Manrope, sans-serif", fontSize: 13, maxWidth: 760,
          }}
        >
          No management pack has been built from here yet.
        </div>
      ) : (
        <div style={{ maxWidth: 980 }}>
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      )}
    </div>
  );
}

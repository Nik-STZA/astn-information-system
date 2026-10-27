"use client";

// Queue a management pack build and follow it.
//
// A laptop build sits at "queued" until the report runner picks it up, and the
// page says which kind of start it is waiting for; a cloud build is already running when it appears, because
// finance-api starts the job itself. Output paths are shown with
// a copy button rather than as links: the files are on the Finance shared
// drive, which a browser cannot open by path.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PackExecutor, PackPipeline, ReportRunRow } from "@/modules/finance/lib/api";
import { outputLinks } from "@/modules/finance/lib/drive-links";
import styles from "./Page.module.css";

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "s-neutral" },
  running: { label: "Building", tone: "s-blue" },
  succeeded: { label: "Built", tone: "s-green" },
  failed: { label: "Failed", tone: "s-red" },
  cancelled: { label: "Cancelled", tone: "s-neutral" },
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

function FileLink({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  // Opens in a new tab: Drive serves the download (or the preview) under the
  // viewer's own Google sign-in, so access follows the shared drive's membership.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${styles.miniBtn} ${primary ? styles.miniPrimary : ""}`}>
      {label}
    </a>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.miniBtn}
      onClick={() => {
        navigator.clipboard?.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy path"}
    </button>
  );
}

function RunRow({ run, executor }: { run: ReportRunRow; executor: PackExecutor }) {
  const st = STATUS[run.status] ?? { label: run.status, tone: "s-neutral" };
  const minutes = run.duration_ms ? Math.max(1, Math.round(run.duration_ms / 60000)) : null;

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <span className={`${styles.status} ${styles[st.tone]}`}><span className={styles.dot} />{st.label}</span>
        <span className={styles.rowTitle}>{monthLabel(run.period)}</span>
        <span className={`${styles.small} ${styles.grow}`}>Requested by {run.requested_by_email}</span>
        <span className={`${styles.small} ${styles.nowrap}`}>
          {when(run.queued_at)}
          {minutes !== null ? ` · ${minutes} min` : ""}
        </span>
      </div>

      {run.status === "queued" && (
        <div className={styles.small} style={{ marginTop: 6 }}>
          {executor === "local"
            ? "Waiting for the report runner on your machine to pick this up."
            : "Starting in Google Cloud."}
        </div>
      )}
      {run.status === "running" && (
        <div className={styles.small} style={{ marginTop: 6 }}>
          Building. The full close pulls Xero for every entity and usually takes several minutes.
        </div>
      )}

      {run.output_files?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className={styles.small}>Saved as drafts</div>
          {run.output_files.map((f) => {
            const links = outputLinks(f.path);
            return (
              <div key={f.path} className={styles.file}>
                <span className={styles.fileName}>{f.name}</span>
                {links.kind === "drive" ? (
                  <>
                    <FileLink href={links.download} label="Download" />
                    <FileLink href={links.open} label="Open in Drive" />
                  </>
                ) : (
                  <>
                    <span className={styles.small} style={{ overflowWrap: "anywhere" }}>{links.path}</span>
                    <CopyPath path={links.path} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {run.error && <div className={styles.warn} style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{run.error}</div>}

      {run.log_tail && (
        <details style={{ marginTop: 8 }}>
          <summary className={styles.summary}>Pipeline log</summary>
          <pre className={styles.log}>{run.log_tail}</pre>
        </details>
      )}
    </div>
  );
}

export default function ManagementPackPanel({
  slug,
  initialRuns,
  executor,
  pipeline,
}: {
  slug: string;
  initialRuns: ReportRunRow[];
  executor: PackExecutor;
  pipeline: PackPipeline;
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
      <section className={`${styles.card} ${styles.pad} ${styles.narrow} ${styles.stack}`} aria-label="Build a pack">
        <div className={styles.controls}>
          <label className={styles.label} htmlFor="pack-period">Month</label>
          <select id="pack-period" className={styles.select} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button type="button" className="btn-primary" onClick={build} disabled={busy || executor === "none"}>
            {busy ? "Starting..." : "Build management pack"}
          </button>
        </div>
        <div className={styles.small}>
          {executor === "none" ? (
            "No management pack pipeline is set up for this client yet, so there is nothing to build with."
          ) : pipeline === "engine" ? (
            "Runs in Google Cloud on the pack engine, straight from Xero: nothing to start. The result is a " +
            "draft with its checks on the Controls tab; a pack that fails them is still saved, with FAILED " +
            "CONTROLS in its name."
          ) : (
            <>
              {executor === "cloud"
                ? "Runs in Google Cloud: nothing to start, and the laptop can be closed. "
                : "Runs on your machine: start the report runner and keep the laptop awake. "}
              The month&apos;s highlights and dashboard commentary files must exist first. The result is
              a draft, so check Balance Control (7 or fewer flagged items) and the cash-flow variance
              (£14 or less) before sign-off.
            </>
          )}
        </div>
        {error && <div className={styles.warn}>{error}</div>}
      </section>

      <div className={styles.listHead}>
        <h2>Builds</h2>
        {pending && <span className={styles.updating}>Updating</span>}
      </div>

      <section className={`${styles.card} ${styles.wide}`} aria-label="Builds">
        {runs.length === 0 ? (
          <div className={styles.empty}>No management pack has been built from here yet.</div>
        ) : (
          runs.map((r) => <RunRow key={r.id} run={r} executor={executor} />)
        )}
      </section>
    </div>
  );
}

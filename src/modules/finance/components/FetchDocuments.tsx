"use client";

// Reads new Xero draft bills and Documents-inbox files into the queue: three a
// call (each is one model read, about 15-30 seconds), repeated while there are
// more, up to ten calls a press. Nothing is written to Xero. New items then go
// to the AP Clerk, which opens each document and suggests coding; that can also
// be asked for on its own, for items already in the queue.

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ApQueue.module.css";

const MAX_CALLS = 10;

const clerkInstruction = (entity: string) =>
  `Work the Bills queue for ${entity}: every open item with no recommendation yet. Open each document, check it is not already in Xero, and save your recommended coding on it. List anything you could not support and what you need from me.`;

const AGENT_NAMES: Record<string, string> = { "ap-clerk": "AP Clerk", fm2: "FM2", fc: "FC" };
const clock = (n: number) => (n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`);

interface Run { agent: string | null; status: string; started_at: string | null; queued_at: string }

export default function FetchDocuments({ slug, entity }: { slug: string; entity: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The agent working on this client's bills, if any, and when it began. It is
  // read from the runs, so it is still right after a reload.
  const [working, setWorking] = useState<{ name: string; since: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wasWorking = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`);
      if (!res.ok) return;
      const runs = ((await res.json()).data ?? []) as Run[];
      const live = runs.find((r) => (r.status === "queued" || r.status === "running") && r.agent && AGENT_NAMES[r.agent]);
      setWorking(live ? { name: AGENT_NAMES[live.agent as string], since: Date.parse(live.started_at ?? live.queued_at) } : null);
      if (wasWorking.current && !live) {
        setStatus("The agents have finished. Their suggestions are on each item.");
        router.refresh();
      }
      wasWorking.current = !!live;
    } catch { /* the next look tries again */ }
  }, [slug, router]);

  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    if (!working) return;
    const look = setInterval(check, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(look); clearInterval(tick); };
  }, [working, check]);

  async function askClerk() {
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/agent-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "ap-clerk", instruction: clerkInstruction(entity) }),
    });
    if (!res.ok) throw new Error("The AP Clerk could not be started");
    await check();
  }

  async function askClerkNow() {
    setBusy(true);
    setError(null);
    try {
      await askClerk();
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AP Clerk could not be started");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    let read = 0;
    let queued = 0;
    let setAside = 0;
    try {
      for (let call = 0; call < MAX_CALLS; call += 1) {
        setStatus(read ? `Reading documents: ${read} done so far...` : "Checking Xero drafts and the inbox...");
        const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/intake`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `New documents could not be read (${res.status})`);
        for (const r of body.results ?? []) {
          read += 1;
          if (r.skipped) setAside += 1;
          else if (r.state) queued += 1;
        }
        router.refresh();
        if (!body.remaining) break;
      }
      const summary = read
        ? `${read} file${read === 1 ? "" : "s"} read: ${queued} queued, ${setAside} set aside.`
        : "Nothing new in Xero drafts or the inbox.";
      setStatus(summary);
      if (queued) {
        await askClerk();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "New documents could not be read");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className={styles.button} onClick={run} disabled={busy}>
        {busy && <Loader2 size={14} className={styles.spin} aria-hidden="true" />}
        {busy ? "Reading..." : "Fetch new documents"}
      </button>
      <button type="button" className={styles.buttonSecondary} onClick={askClerkNow} disabled={busy || !!working}>
        Ask AP Clerk to code the queue
      </button>
      {working && (
        <span className={styles.status} aria-live="polite">
          <Loader2 size={14} className={styles.spin} aria-hidden="true" /> {working.name} is working: {clock(Math.max(0, Math.round((now - working.since) / 1000)))}
        </span>
      )}
      {status && !working && <span className={styles.status} aria-live="polite">{status}</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}

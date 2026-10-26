"use client";

// Reads new Documents-inbox files into the queue: three files a call (each file
// is one model read, about 15-30 seconds), repeated while the inbox has more,
// up to ten calls a press. Nothing is written to Xero.

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./ApQueue.module.css";

const MAX_CALLS = 10;

export default function FetchDocuments({ slug, entity }: { slug: string; entity: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    let read = 0;
    let queued = 0;
    let setAside = 0;
    try {
      for (let call = 0; call < MAX_CALLS; call += 1) {
        setStatus(read ? `Reading documents: ${read} done so far...` : "Checking the inbox...");
        const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/intake`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `The inbox could not be read (${res.status})`);
        for (const r of body.results ?? []) {
          read += 1;
          if (r.skipped) setAside += 1;
          else if (r.state) queued += 1;
        }
        router.refresh();
        if (!body.remaining) break;
      }
      setStatus(read
        ? `${read} file${read === 1 ? "" : "s"} read: ${queued} queued, ${setAside} set aside.`
        : "Nothing new in the inbox.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The inbox could not be read");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className={styles.button} onClick={run} disabled={busy}>
        {busy ? "Reading..." : "Fetch new documents"}
      </button>
      {status && <span className={styles.status} aria-live="polite">{status}</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { queueReverify } from "@/lib/data/registry-candidates-actions";
import type { ActionResult } from "@/lib/data/registry-candidates-shared";
import styles from "./RegistryCandidates.module.css";

const IDLE: ActionResult = { status: "idle" };

// Sends registry records to the researcher for re-verification. compact is the
// per-row button; otherwise it is the "send this page" button with its result.
export default function RegistryResearchButton({ ids, label, compact = false }: { ids: string[]; label: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(queueReverify.bind(null, ids), IDLE);

  if (compact) {
    return (
      <form action={action} style={{ display: "inline" }}>
        <button type="submit" className="btn-text" disabled={pending || state.status === "ok"} title={state.status !== "idle" ? state.message : "Send to the researcher"}>
          {pending ? "Sending…" : state.status === "ok" ? "Sent" : state.status === "error" ? "Failed" : label}
        </button>
      </form>
    );
  }
  return (
    <form action={action} className={styles.actions}>
      <button type="submit" className="btn-secondary" disabled={pending || !ids.length}>{pending ? "Sending…" : label}</button>
      {state.status === "ok" ? (
        <span className={styles.hint}>{state.message} <Link href="/registry/candidates">Open Candidates</Link></span>
      ) : state.status === "error" ? (
        <span className={styles.hint} style={{ color: "var(--alert-red)" }}>{state.message}</span>
      ) : (
        <span className={styles.hint}>Free website check, then a Gemini search. Nothing changes until you approve.</span>
      )}
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitCandidates } from "@/lib/data/registry-candidates-actions";
import type { ActionResult } from "@/lib/data/registry-candidates-shared";
import styles from "./RegistryCandidates.module.css";

const IDLE: ActionResult = { status: "idle" };

export default function RegistryCandidateSubmit() {
  const [state, action, pending] = useActionState(submitCandidates, IDLE);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok") form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className={`card ${styles.panel}`}>
      <div className={styles.panelHead}>
        <h2>Submit a candidate</h2>
      </div>
      <div className={styles.fields}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className="label-brand">Organisation name</span>
          <input name="name" className="input-brand" autoComplete="off" placeholder="e.g. Acme Sports Analytics" />
        </label>
        <label className={styles.field}>
          <span className="label-brand">Website</span>
          <input name="website" className="input-brand" inputMode="url" autoComplete="off" placeholder="acme.co.za" />
        </label>
        <label className={styles.field}>
          <span className="label-brand">Country</span>
          <input name="country" className="input-brand" autoComplete="off" />
        </label>
        <label className={styles.field}>
          <span className="label-brand">Sport</span>
          <input name="sport" className="input-brand" autoComplete="off" />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className="label-brand">Where you heard of it, or why it belongs</span>
          <textarea name="note" className="input-brand" />
        </label>
      </div>

      <details className={styles.details}>
        <summary>Paste several</summary>
        <label className={styles.field}>
          <span className={styles.hint}>
            One per line: a name, optionally followed by its website. Or columns split by | or tabs:
            name | website | country | sport | note. Up to 25 at a time.
          </span>
          <textarea name="batch" className="input-brand" rows={5} placeholder={"Acme Sports acme.co.za\nLagos Hoops | lagoshoops.ng | Nigeria | Basketball | met at the summit"} />
        </label>
      </details>

      <div className={styles.actions}>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send to reviewer"}
        </button>
        <span className={styles.hint}>The reviewer checks the registry for duplicates and researches each one. You approve before anything is added.</span>
      </div>
      <Message state={state} />
    </form>
  );
}

export function Message({ state }: { state: ActionResult }) {
  if (state.status === "idle") return null;
  if (state.status === "ok") return <div className={styles.message} role="status">{state.message}</div>;
  return (
    <div className={`${styles.message} ${styles.error}`} role="alert">
      {state.message}
      {state.errors?.length ? <ul>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
    </div>
  );
}

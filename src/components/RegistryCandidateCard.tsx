"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { approveCandidate, rejectCandidate, rerunCandidate } from "@/lib/data/registry-candidates-actions";
import {
  STATUS_LABEL,
  VERDICT_LABEL,
  safeHref,
  type ActionResult,
  type Candidate,
  type RegistryReference,
} from "@/lib/data/registry-candidates-shared";
import { Message } from "./RegistryCandidateSubmit";
import styles from "./RegistryCandidates.module.css";

const IDLE: ActionResult = { status: "idle" };

const STATUS_PILL: Record<Candidate["status"], string> = {
  queued: styles.pillBlue,
  reviewing: styles.pillBlue,
  proposed: styles.pillGold,
  failed: styles.pillRed,
  approved: styles.pillGreen,
  rejected: "",
};

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function RegistryCandidateCard({ candidate: c, reference }: { candidate: Candidate; reference: RegistryReference | null }) {
  const site = safeHref(c.submitted_website);
  const open = ["queued", "reviewing", "proposed", "failed"].includes(c.status);

  return (
    <article className={`card ${styles.panel}`}>
      <div className={styles.cardHead}>
        <span className={styles.name}>{c.submitted_name}</span>
        <div className={styles.pills}>
          <span className={`${styles.pill} ${STATUS_PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>
          {c.verdict && c.status === "proposed" ? <span className={styles.pill}>{VERDICT_LABEL[c.verdict]}</span> : null}
        </div>
      </div>
      <div className={styles.meta}>
        {site ? <a href={site} target="_blank" rel="noopener noreferrer">{c.submitted_website}</a> : null}
        {[c.submitted_country, c.submitted_sport].filter(Boolean).length ? ` · ${[c.submitted_country, c.submitted_sport].filter(Boolean).join(" · ")}` : null}
        {` · submitted ${when(c.submitted_at)}`}
        {c.decided_at ? ` · decided ${when(c.decided_at)}` : null}
      </div>
      {c.submitted_note ? <p className={styles.reason}>{c.submitted_note}</p> : null}

      {c.verdict_reason ? (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>{c.status === "failed" ? "What happened" : "Reviewer"}</span>
          <p className={styles.reason}>{c.verdict_reason}</p>
        </div>
      ) : null}

      {c.duplicates?.length ? (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Possibly already in the registry</span>
          <ul className={styles.links}>
            {c.duplicates.map((d) => (
              <li key={d.astn_id}>
                {d.organization_id ? <Link href={`/registry/${d.organization_id}`}>{d.astn_id} {d.organization_name}</Link> : `${d.astn_id} ${d.organization_name}`}
                {d.why ? <span> · {d.why}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.evidence?.length ? (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Evidence</span>
          <ul className={styles.links}>
            {c.evidence.map((e) => {
              const href = safeHref(e.url);
              return (
                <li key={e.url}>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer">{e.url}</a> : e.url}
                  <span> · {e.finding}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {c.status === "approved" && c.organization_id ? (
        <p className={styles.reason}>
          Added as <Link href={`/registry/${c.organization_id}`}>{c.astn_id ?? "a new record"}</Link>.
        </p>
      ) : null}
      {c.status === "rejected" && c.decision_note ? <p className={styles.reason}>Rejected: {c.decision_note}</p> : null}

      {c.status === "proposed" && c.proposal ? (
        c.verdict === "add" ? (
          <ApproveForm candidate={c} reference={reference} />
        ) : (
          <details className={styles.details}>
            <summary>Add it anyway</summary>
            <ApproveForm candidate={c} reference={reference} />
          </details>
        )
      ) : null}

      {open && (c.status === "proposed" || c.status === "failed") ? <SendBackOrReject candidate={c} /> : null}
    </article>
  );
}

function ApproveForm({ candidate: c, reference }: { candidate: Candidate; reference: RegistryReference | null }) {
  const [state, action, pending] = useActionState(approveCandidate.bind(null, c.id), IDLE);
  const p = c.proposal ?? {};
  const listId = (name: string) => `${name}-${c.id}`;

  return (
    <form action={action} className={styles.decide}>
      <span className={styles.sectionTitle}>Proposed record: correct anything before adding</span>
      <div className={styles.fields}>
        <Field label="Name" name="organization_name" value={p.organization_name} wide />
        <Select label="Country" name="country_iso" value={p.country_iso}
          options={(reference?.countries ?? []).map((x) => [x.iso_code, `${x.name} (${x.iso_code})`])} />
        <Select label="Sport" name="sport_code" value={p.sport_code}
          options={(reference?.sports ?? []).map((x) => [x.code, `${x.name} (${x.code})`])} />
        <Field label="Level" name="level" value={p.level} list={listId("level")} />
        <Field label="Organisation type" name="organization_type" value={p.organization_type} list={listId("type")} />
        <Select label="Vertical" name="astn_vertical" value={p.astn_vertical}
          options={(reference?.verticals ?? []).map((v) => [v, v])} />
        <Field label="Sub-vertical" name="astn_sub_vertical" value={p.astn_sub_vertical} />
        <Field label="Website" name="organization_website" value={p.organization_website} />
        <Field label="City or province" name="region_province" value={p.region_province} />
        <Field label="Founded" name="founded_year" value={p.founded_year} inputMode="numeric" />
        <Select label="Operational status" name="operational_status" value={p.operational_status}
          options={(reference?.operational_statuses ?? []).map((v) => [v, v])} />
        <Field label="Business model" name="business_model" value={p.business_model} />
        <Field label="Tags" name="tags" value={p.tags} />
        <Field label="Confidence" name="source_confidence" value={p.source_confidence} wide />
        <Field label="Verification source" name="verification_source" value={p.verification_source} wide />
        <label className={`${styles.field} ${styles.wide}`}>
          <span className="label-brand">Notes</span>
          <textarea name="notes" className="input-brand" defaultValue={p.notes ?? ""} rows={4} />
        </label>
      </div>
      <datalist id={listId("level")}>{(reference?.levels ?? []).map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id={listId("type")}>{(reference?.organization_types ?? []).map((v) => <option key={v} value={v} />)}</datalist>
      <div className={styles.actions}>
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Adding…" : "Add to registry"}</button>
        {state.status === "error" && state.canOverride ? (
          <button type="submit" name="allowDuplicate" value="1" className="btn-secondary" disabled={pending}>Add anyway</button>
        ) : null}
        <span className={styles.hint}>The ASTN ID is given when you add it.</span>
      </div>
      <Message state={state} />
    </form>
  );
}

function SendBackOrReject({ candidate: c }: { candidate: Candidate }) {
  const [note, setNote] = useState("");
  const [rerunState, rerun, rerunPending] = useActionState(rerunCandidate.bind(null, c.id), IDLE);
  const [rejectState, reject, rejectPending] = useActionState(rejectCandidate.bind(null, c.id), IDLE);
  const pending = rerunPending || rejectPending;

  return (
    <div className={styles.decide}>
      <label className={styles.field}>
        <span className="label-brand">Note (optional)</span>
        <textarea className="input-brand" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="What the reviewer should look at again, or why you are rejecting it" />
      </label>
      <div className={styles.actions}>
        <form action={rerun}>
          <input type="hidden" name="note" value={note} />
          <button type="submit" className="btn-secondary" disabled={pending}>{c.status === "failed" ? "Run again" : "Send back to reviewer"}</button>
        </form>
        <form action={reject}>
          <input type="hidden" name="note" value={note} />
          <button type="submit" className="btn-text" disabled={pending}>Reject</button>
        </form>
      </div>
      <Message state={rerunState.status !== "idle" ? rerunState : rejectState} />
    </div>
  );
}

function Field({ label, name, value, wide, list, inputMode }: {
  label: string; name: string; value: string | number | null | undefined; wide?: boolean; list?: string;
  inputMode?: "numeric" | "url";
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.wide : ""}`}>
      <span className="label-brand">{label}</span>
      <input name={name} className="input-brand" defaultValue={value ?? ""} list={list} inputMode={inputMode} autoComplete="off" />
    </label>
  );
}

function Select({ label, name, value, options }: { label: string; name: string; value: string | undefined; options: Array<[string, string]> }) {
  const known = options.some(([v]) => v === value);
  return (
    <label className={styles.field}>
      <span className="label-brand">{label}</span>
      <select name={name} className="input-brand" defaultValue={value ?? ""}>
        <option value="">Choose…</option>
        {value && !known ? <option value={value}>{value}</option> : null}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  applyReverify,
  approveCandidate,
  confirmDuplicate,
  rejectCandidate,
  rerunCandidate,
} from "@/lib/data/registry-candidates-actions";
import {
  DECIDED,
  REVERIFY_FIELD_LABEL,
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
  duplicate: "",
};

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// A decided candidate takes one line: what happened and where it went.
export function DecidedRow({ candidate: c, message }: { candidate: Candidate; message?: string }) {
  const outcome =
    c.status === "approved" ? (c.kind === "reverify" ? "Re-checked" : "Added as") : c.status === "duplicate" ? "Duplicate of" : null;
  return (
    <div className={styles.row}>
      <span className={`${styles.pill} ${STATUS_PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>
      <span className={styles.rowName}>{c.submitted_name}</span>
      <span className={styles.rowMeta}>
        {message ?? (
          <>
            {outcome && c.organization_id ? (
              <>
                {outcome} <Link href={`/registry/${c.organization_id}`}>{c.astn_id ?? "registry record"}</Link>
              </>
            ) : null}
            {c.kind === "reverify" && c.status === "approved" && c.decision_note ? ` · ${c.decision_note}` : null}
            {c.status === "rejected" && c.decision_note ? c.decision_note : null}
          </>
        )}
      </span>
      <span className={styles.rowDate}>{when(c.decided_at)}</span>
    </div>
  );
}

export default function RegistryCandidateCard({ candidate: c, reference }: { candidate: Candidate; reference: RegistryReference | null }) {
  // Once decided here the card folds to one line straight away, without
  // waiting for the list to reload.
  const [decided, setDecided] = useState<string | null>(null);
  if (DECIDED.includes(c.status)) return <DecidedRow candidate={c} />;
  if (decided) return <DecidedRow candidate={c} message={decided} />;

  const site = safeHref(c.submitted_website);
  const proposed = c.status === "proposed";
  const where = [c.submitted_country, c.submitted_sport].filter(Boolean).join(" · ");

  return (
    <article className={`card ${styles.panel}`}>
      <div className={styles.cardHead}>
        <span className={styles.name}>{c.submitted_name}</span>
        <div className={styles.pills}>
          {c.kind === "reverify" ? <span className={`${styles.pill} ${styles.pillBlue}`}>Re-check{c.astn_id ? ` of ${c.astn_id}` : ""}</span> : null}
          <span className={`${styles.pill} ${STATUS_PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>
          {c.verdict && proposed ? <span className={styles.pill}>{VERDICT_LABEL[c.verdict]}</span> : null}
        </div>
      </div>
      <div className={styles.meta}>
        {site ? <a href={site} target="_blank" rel="noopener noreferrer">{c.submitted_website}</a> : null}
        {where ? ` · ${where}` : null}
        {` · submitted ${when(c.submitted_at)}`}
      </div>

      {c.verdict_reason ? <p className={styles.reason}>{c.verdict_reason}</p> : null}

      {c.evidence?.length || c.duplicates?.length ? (
        <details className={styles.details}>
          <summary>
            {[
              c.duplicates?.length ? `${c.duplicates.length} registry match${c.duplicates.length === 1 ? "" : "es"}` : null,
              c.evidence?.length ? `${c.evidence.length} source${c.evidence.length === 1 ? "" : "s"}` : null,
            ].filter(Boolean).join(" · ")}
            {c.submitted_note ? " · your note" : null}
          </summary>
          <Evidence candidate={c} />
        </details>
      ) : null}

      {c.kind === "reverify" ? <WebsiteLine candidate={c} /> : null}
      {proposed && c.kind === "reverify" ? <ReverifyForm candidate={c} onDone={setDecided} /> : null}
      {proposed && c.kind !== "reverify" && c.verdict === "duplicate" ? <DuplicateActions candidate={c} onDone={setDecided} /> : null}
      {proposed && c.kind !== "reverify" && c.verdict !== "duplicate" && c.proposal ? (
        <details className={styles.details}>
          <summary>{c.verdict === "add" ? "Review the record and add" : "Add it anyway"}</summary>
          <ApproveForm candidate={c} reference={reference} onDone={setDecided} />
        </details>
      ) : null}
      {proposed || c.status === "failed" ? <SendBackOrReject candidate={c} onDone={setDecided} /> : null}
    </article>
  );
}

function Evidence({ candidate: c }: { candidate: Candidate }) {
  return (
    <div className={styles.section}>
      {c.submitted_note ? <p className={styles.reason}>Your note: {c.submitted_note}</p> : null}
      {c.duplicates?.length ? (
        <ul className={styles.links}>
          {c.duplicates.map((d) => (
            <li key={d.astn_id}>
              {d.organization_id ? <Link href={`/registry/${d.organization_id}`}>{d.astn_id} {d.organization_name}</Link> : `${d.astn_id} ${d.organization_name}`}
              {d.why ? <span> · {d.why}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {c.evidence?.length ? (
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
      ) : null}
    </div>
  );
}

// Fold the card when an action succeeds.
function useFoldOnSuccess(state: ActionResult, onDone: (message: string) => void) {
  useEffect(() => {
    if (state.status === "ok") onDone(state.message);
  }, [state, onDone]);
}

function WebsiteLine({ candidate: c }: { candidate: Candidate }) {
  const w = c.website_check;
  const m = c.research_meta;
  if (!w && !m) return null;
  const site = w?.outcome === "no_website" ? "no website on the record"
    : w ? `website ${w.outcome.replace(/_/g, " ")}${w.http_status ? ` (HTTP ${w.http_status})` : ""}${w.final_url && w.final_url !== w.url ? `, now at ${w.final_url}` : ""}`
    : null;
  return (
    <div className={styles.meta}>
      {[site, m?.searches !== undefined ? `${m.searches} Google search${m.searches === 1 ? "" : "es"} by Gemini` : null].filter(Boolean).join(" · ")}
    </div>
  );
}

function show(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === "" ? "(empty)" : String(v);
}

// Before and after for each proposed change; tick the ones to apply, correct
// any value first. Applying nothing still records the record as checked.
function ReverifyForm({ candidate: c, onDone }: { candidate: Candidate; onDone: (m: string) => void }) {
  const [state, action, pending] = useActionState(applyReverify.bind(null, c.id), IDLE);
  useFoldOnSuccess(state, onDone);
  const changes = Object.entries(c.proposal?.changes ?? {});

  return (
    <form action={action} className={styles.decide}>
      {changes.length ? (
        <div className={styles.changes}>
          {changes.map(([f, v]) => (
            <div key={f} className={styles.change}>
              <label className={styles.changeHead}>
                <input type="checkbox" name="apply" value={f} defaultChecked />
                <span className="label-brand">{REVERIFY_FIELD_LABEL[f] ?? f}</span>
              </label>
              <span className={styles.before}>{show(c.current?.[f])}</span>
              <input name={`value_${f}`} className="input-brand" defaultValue={String(v)} autoComplete="off" />
            </div>
          ))}
        </div>
      ) : (
        <span className={styles.hint}>No field changes proposed. Marking it checked records the research and the note.</span>
      )}
      <label className={styles.field}>
        <span className="label-brand">Note to add</span>
        <textarea name="notes_append" className="input-brand" rows={2} defaultValue={c.proposal?.notes_append ?? ""} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Applying…" : changes.length ? "Apply ticked changes" : "Mark as checked"}
        </button>
        {c.organization_id ? <Link href={`/registry/${c.organization_id}`} className="btn-text">Open record</Link> : null}
      </div>
      <Message state={state} />
    </form>
  );
}

function DuplicateActions({ candidate: c, onDone }: { candidate: Candidate; onDone: (m: string) => void }) {
  const [state, action, pending] = useActionState(confirmDuplicate.bind(null, c.id), IDLE);
  useFoldOnSuccess(state, onDone);
  const matches = (c.duplicates ?? []).filter((d) => d.organization_id);

  return (
    <form action={action} className={styles.decide}>
      {matches.length > 1 ? (
        <label className={styles.field}>
          <span className="label-brand">Duplicate of</span>
          <select name="organizationId" className="input-brand" defaultValue={matches[0].organization_id}>
            {matches.map((d) => <option key={d.organization_id} value={d.organization_id}>{d.astn_id} {d.organization_name}</option>)}
          </select>
        </label>
      ) : matches.length === 1 ? (
        <input type="hidden" name="organizationId" value={matches[0].organization_id} />
      ) : null}
      <div className={styles.actions}>
        <button type="submit" className="btn-primary" disabled={pending || !matches.length}>
          {pending ? "Closing…" : matches.length === 1 ? `Confirm duplicate of ${matches[0].astn_id}` : "Confirm duplicate"}
        </button>
        {matches.length === 1 ? (
          <Link href={`/registry/${matches[0].organization_id}`} className="btn-text">Open {matches[0].astn_id}</Link>
        ) : null}
      </div>
      <Message state={state} />
    </form>
  );
}

function ApproveForm({ candidate: c, reference, onDone }: { candidate: Candidate; reference: RegistryReference | null; onDone: (m: string) => void }) {
  const [state, action, pending] = useActionState(approveCandidate.bind(null, c.id), IDLE);
  useFoldOnSuccess(state, onDone);
  const p = c.proposal ?? {};
  const listId = (name: string) => `${name}-${c.id}`;

  return (
    <form action={action} className={styles.decide}>
      <span className={styles.hint}>Correct anything before adding. The ASTN ID is given when you add it.</span>
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
      </div>
      <Message state={state} />
    </form>
  );
}

function SendBackOrReject({ candidate: c, onDone }: { candidate: Candidate; onDone: (m: string) => void }) {
  const [note, setNote] = useState("");
  const [rerunState, rerun, rerunPending] = useActionState(rerunCandidate.bind(null, c.id), IDLE);
  const [rejectState, reject, rejectPending] = useActionState(rejectCandidate.bind(null, c.id), IDLE);
  useFoldOnSuccess(rerunState, onDone);
  useFoldOnSuccess(rejectState, onDone);
  const pending = rerunPending || rejectPending;
  const agreeReject = c.status === "proposed" && c.verdict === "reject";

  return (
    <details className={styles.details} open={agreeReject || c.status === "failed"}>
      <summary>{c.verdict === "duplicate" ? "Not a duplicate?" : "Other actions"}</summary>
      <div className={styles.decide}>
        <label className={styles.field}>
          <span className="label-brand">Note (optional)</span>
          <textarea className="input-brand" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What the reviewer should look at again, or why you are rejecting it" />
        </label>
        <div className={styles.actions}>
          <form action={reject}>
            <input type="hidden" name="note" value={note} />
            <button type="submit" className={agreeReject ? "btn-primary" : "btn-text"} disabled={pending}>
              {agreeReject ? "Agree: reject" : "Reject"}
            </button>
          </form>
          <form action={rerun}>
            <input type="hidden" name="note" value={note} />
            <button type="submit" className="btn-secondary" disabled={pending}>
              {c.status === "failed" ? "Run again" : "Send back to reviewer"}
            </button>
          </form>
        </div>
        <Message state={rerunState.status !== "idle" ? rerunState : rejectState} />
      </div>
    </details>
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

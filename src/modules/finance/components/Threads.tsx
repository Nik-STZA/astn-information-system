"use client";

// Threads (migration 050): one thread per thing the work is about (an account
// in a month, an asset, a cost line, a reconciliation, a register's month),
// shown on every page where that thing appears and read by the agents.
// Used by the Fixed assets page, each reconciliation and the Close page.
// Entries are permanent: a reply, a hold or a decision is a new entry.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dayName, type ThreadEntry } from "@/modules/finance/lib/asset-schedule";
import type { Me, ThreadSubject } from "@/modules/finance/lib/threads";
import styles from "./Threads.module.css";
import page from "./Page.module.css";

export type { Me, ThreadSubject };

const KINDS = [["note", "Note"], ["question", "Question"], ["hold", "Hold"], ["decision", "Decision"]] as const;
const KIND_TONE: Record<string, string> = { decision: "s-green", question: "s-amber", hold: "s-amber", finding: "s-blue", note: "s-neutral" };
const KIND_LABEL: Record<string, string> = { decision: "Decision", question: "Question", hold: "Hold", finding: "Finding", note: "Note" };

async function postEntry(slug: string, body: unknown): Promise<string | null> {
  const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/threads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const out = (await res.json().catch(() => ({}))) as { issues?: string[]; error?: string };
  return out.issues?.join(" ") ?? out.error ?? `That did not work (${res.status})`;
}

function Composer({ slug, me, subject, parentId, initialKind = "note", onDone, onCancel }: {
  slug: string; me: Me; subject: ThreadSubject; parentId?: string; initialKind?: string; onDone: () => void; onCancel?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [kind, setKind] = useState(initialKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function post() {
    setBusy(true); setError(null);
    const err = await postEntry(slug, { ...subject, parent_id: parentId, kind, body: text, needs_decision: !parentId && (kind === "question" || kind === "hold") });
    setBusy(false);
    if (err) setError(err); else { setText(""); onDone(); router.refresh(); }
  }
  return (
    <div className={styles.composer}>
      <textarea aria-label={parentId ? "Reply" : "Add to this thread"} rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
        placeholder={parentId ? "Reply, ask, hold or decide" : "A note, a question for the agent working on it, a hold, or a decision"} />
      {error && <p className={page.error} role="alert">{error}</p>}
      <div className={styles.buttons}>
        {KINDS.map(([k, l]) => <button key={k} type="button" className={`${styles.chip} ${kind === k ? styles.chipOn : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        <span className={styles.grow} />
        {onCancel && <button type="button" className="btn-text" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="button" className="btn-primary" onClick={post} disabled={busy || !text.trim()}>Post as {me.initials}</button>
      </div>
    </div>
  );
}

function Avatar({ e, small = false }: { e: ThreadEntry; small?: boolean }) {
  return <span className={`${styles.av} ${e.via_agent ? styles.avAgent : styles.avPerson} ${small ? styles.avSmall : ""}`} title={`${e.by.name}${e.by.role ? `, ${e.by.role}` : ""}`}>{e.by.initials}</span>;
}

// One entry with its replies. Reply and Decide work in place. The subject chip
// says what it is about when the list mixes subjects: a button (onSubject) on
// the page that holds the subject, a link (subjectHref) from elsewhere.
export function Entry({ slug, e, me, subject, onSubject, subjectHref }: {
  slug: string; e: ThreadEntry; me: Me; subject?: string | null; onSubject?: () => void; subjectHref?: string | null;
}) {
  const [replying, setReplying] = useState<null | string>(null);
  return (
    <div className={styles.entry}>
      <Avatar e={e} />
      <div className={styles.entryBody}>
        <div className={styles.entryMeta}>
          <span className={`${page.status} ${page[KIND_TONE[e.kind]]}`}>{KIND_LABEL[e.kind]}</span>
          {e.needs_decision && <span className={`${page.status} ${page[e.open ? "s-amber" : "s-green"]}`}>{e.open ? "Needs your decision" : "Decided"}</span>}
          {subject && onSubject && <button type="button" className={styles.chip} onClick={onSubject}>{subject}</button>}
          {subject && !onSubject && subjectHref && <Link prefetch={false} className={styles.chip} href={subjectHref}>{subject}</Link>}
          {subject && !onSubject && !subjectHref && <span className={styles.tag}>{subject}</span>}
          <span className={styles.sub}>{dayName(e.created_at)}{e.by.on_behalf_of ? ` · for ${e.by.on_behalf_of}` : ""}</span>
        </div>
        <div className={styles.text}>{e.body}</div>
        {(e.replies ?? []).map((r) => (
          <div key={r.id} className={styles.reply}>
            <Avatar e={r} small />
            <div className={styles.min}><div className={styles.entryMeta}><span className={`${page.status} ${page[KIND_TONE[r.kind]]}`}>{KIND_LABEL[r.kind]}</span><span className={styles.sub}>{dayName(r.created_at)}</span></div><div className={styles.text}>{r.body}</div></div>
          </div>
        ))}
        {replying ? (
          <Composer slug={slug} me={me} subject={{ subject_kind: e.subject_kind, subject_key: e.subject_key, period: e.period }} parentId={e.id} initialKind={replying}
            onDone={() => setReplying(null)} onCancel={() => setReplying(null)} />
        ) : (
          <div className={styles.buttons}>
            <button type="button" className={styles.chip} onClick={() => setReplying("note")}>Reply</button>
            {e.open && <button type="button" className={styles.chip} onClick={() => setReplying("decision")}>Decide</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// A thread: its entries (which may come from related subjects, e.g. a
// reconciliation shows its accounts' threads too) and a box to add to it.
// New entries go to `subject`.
export function Thread({ slug, me, title, entries, subject, labelOf }: {
  slug: string; me: Me; title: string; entries: ThreadEntry[]; subject: ThreadSubject; labelOf?: (e: ThreadEntry) => string | null;
}) {
  const seen = new Set<string>();
  const list = entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return (
    <div className={styles.thread}>
      <h3 className={styles.h3}>{title} <span className={styles.count}>{list.length}</span></h3>
      <p className={styles.sub}>Shared with the Fixed assets page, the reconciliation, the Close page and any agent working on this. Entries are permanent.</p>
      {list.map((e) => <Entry key={e.id} slug={slug} e={e} me={me} subject={labelOf?.(e) ?? null} />)}
      <Composer slug={slug} me={me} subject={subject} onDone={() => {}} />
    </div>
  );
}

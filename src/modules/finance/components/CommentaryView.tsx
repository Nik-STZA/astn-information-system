"use client";

// One month's pack commentary: the words by section, each edited in place, the
// figures beside them for reading, notes on wording the CFO's standard asks
// writers to avoid, the version history, and the CFO's approval.
//
// Nothing here writes to the drive or Xero. The pack build reads the month
// from os.stza.io once it is approved.

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { dayLabel, periodChoices, periodLong } from "@/modules/finance/lib/recs";
import { changedEdits, figureTables, kindOfFile, whoSaved, type CommentaryMonth } from "@/modules/finance/lib/commentary";
import page from "./Page.module.css";
import styles from "./Accruals.module.css";

const said = (b: Record<string, unknown>, fallback: string) =>
  String((b.issues as string[] | undefined)?.join(" ") ?? b.error ?? fallback);

export default function CommentaryView({ slug, data }: { slug: string; data: CommentaryMonth }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const base = `/finance/clients/${encodeURIComponent(slug)}`;
  const h = data.highlights;
  const edits = h ? changedEdits(h.sections, drafts) : [];

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/commentary/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
    setBusy(false);
    if (!out.ok) setError(said(out.body, "That did not work"));
    return out;
  };

  const save = async () => {
    if (!h || !edits.length) return;
    const r = await post("edit", { period: data.period, version: h.version, edits, note: note.trim() || undefined });
    if (!r.ok) return;
    setDrafts({});
    setNote("");
    setNotice(`Saved as version ${r.body.version}${r.body.was_approved ? ". It was approved, so it is a draft again until you approve it" : ""}.`);
    router.refresh();
  };

  const approve = async () => {
    const r = await post("approve", { period: data.period });
    if (!r.ok) return;
    setNotice("Approved. The pack build uses this month's commentary from now on.");
    router.refresh();
  };

  const load = async (f: File) => {
    const kind = kindOfFile(f.name);
    if (!kind) { setError("Name the file highlights_YYYY-MM.json or dashboard_YYYY-MM.json, so it is clear which it is."); return; }
    let content: unknown;
    try { content = JSON.parse(await f.text()); } catch { setError(`${f.name} is not a JSON file.`); return; }
    const r = await post("import", { period: data.period, kind, content, note: `Loaded from ${f.name}` });
    if (!r.ok) return;
    setNotice(`${f.name} loaded as version ${r.body.version} of the ${kind}.`);
    router.refresh();
  };

  return (
    <div>
      <div className={styles.bar}>
        <select aria-label="Month" className={styles.pick} value={data.period}
          onChange={(e) => router.push(`${base}/commentary?period=${e.target.value}`)}>
          {periodChoices(data.period).map((p) => <option key={p} value={p}>{periodLong(p)}</option>)}
        </select>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => file.current?.click()}><Upload size={14} aria-hidden="true" />Load a file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f); }} />
        {h && (
          <span className={`${page.status} ${h.status === "approved" && data.pack.ready ? page["s-green"] : page["s-amber"]}`}>
            <span className={page.dot} />{h.status === "approved" ? `Approved, version ${h.version}` : `Draft, version ${h.version}`}
          </span>
        )}
      </div>

      {error && <div className={page.error} role="alert">{error}</div>}
      {notice && <div className={`${page.card} ${page.pad}`} role="status">{notice}</div>}

      {!h ? (
        <div className={`${page.card} ${page.empty}`}>
          No commentary for {periodLong(data.period)} yet. Ask FP&amp;A to draft it, or load the month&apos;s highlights file.
        </div>
      ) : (
        <>
          {!data.pack.ready && data.pack.why && <p className={page.small}>{data.pack.why}</p>}

          {h.notes.length > 0 && (
            <section className={styles.section} aria-labelledby="notes">
              <h2 id="notes" className={styles.h2}>Wording to look at <span className={styles.count}>{h.notes.length}</span></h2>
              <div className={`${page.card} ${page.pad} ${page.stack}`}>
                {h.notes.map((n) => <span key={n.path} className={styles.warn} style={{ fontSize: 13 }}>{n.heading}: {n.words.join(", ")}</span>)}
              </div>
            </section>
          )}

          {h.sections.map((s) => (
            <section key={s.key} className={styles.section} aria-labelledby={`s-${s.key}`}>
              <h2 id={`s-${s.key}`} className={styles.h2}>{s.title}</h2>
              <div className={page.stack}>
                {s.fields.map((f) => {
                  const value = drafts[f.path] ?? f.text;
                  const changed = drafts[f.path] !== undefined && drafts[f.path] !== f.text;
                  return (
                    <label key={f.path} className={`${page.card} ${page.pad}`} style={{ display: "block" }}>
                      <div className={styles.head}>
                        <span className={styles.name}>{f.heading}{f.status ? ` [${f.status}]` : ""}</span>
                        {changed && <span className={styles.meta}>Changed</span>}
                      </div>
                      <textarea className={styles.area} style={{ marginTop: 6 }} value={value}
                        // Tall enough for the words: about 90 characters a line, plus each paragraph break.
                        rows={Math.min(40, Math.max(3, Math.ceil(value.length / 90) + (value.match(/\n/g)?.length ?? 0)))}
                        aria-label={f.heading} onChange={(e) => setDrafts((d) => ({ ...d, [f.path]: e.target.value }))} />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}

          {figureTables(h.content).map((t) => (
            <section key={t.title} className={styles.section} aria-label={t.title}>
              <h2 className={styles.h2}>{t.title} <span className={styles.count}>for reading</span></h2>
              <div className={`${page.card} ${styles.tableWrap}`}>
                <table className={styles.table}>
                  <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? styles.num : undefined}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </section>
          ))}

          <section className={styles.section} aria-label="Save and approve">
            <div className={`${page.card} ${page.pad} ${page.stack}`}>
              <input className={styles.input} aria-label="What changed" placeholder="What you changed (optional, kept with the version)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className={styles.row}>
                <button type="button" className="btn-secondary" disabled={busy || !edits.length} onClick={save}>{busy ? "Saving..." : `Save ${edits.length || ""} change${edits.length === 1 ? "" : "s"}`}</button>
                {edits.length > 0 && <button type="button" className="btn-text" disabled={busy} onClick={() => setDrafts({})}>Undo my changes</button>}
                {h.status !== "approved" && (
                  <button type="button" className="btn-primary" disabled={busy || edits.length > 0} onClick={approve} title={edits.length ? "Save your changes first" : undefined}>
                    <CheckCircle2 size={14} aria-hidden="true" />Approve for the pack
                  </button>
                )}
              </div>
              <span className={page.small}>
                {data.dashboard ? `Dashboard figures: version ${data.dashboard.version}, ${data.dashboard.status === "approved" ? "approved" : "draft"}. ` : "No dashboard file for this month. "}
                Approving approves both. Changing anything after approval makes the month a draft again.
              </span>
            </div>
          </section>

          {data.versions.length > 0 && (
            <section className={styles.section} aria-labelledby="versions">
              <h2 id="versions" className={styles.h2}>Versions</h2>
              <div className={`${page.card} ${page.pad} ${page.stack}`}>
                {data.versions.map((v, i) => (
                  <div key={i} className={styles.meta} style={{ fontSize: 13 }}>
                    <span>{v.kind} v{v.version}</span><span>{v.action}</span><span>{whoSaved(v.saved_by)}</span><span>{dayLabel(v.saved_at)}</span>
                    {v.changed_paths.length > 0 && <span>{v.changed_paths.length} field{v.changed_paths.length === 1 ? "" : "s"}</span>}
                    {v.note && <span>{v.note}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

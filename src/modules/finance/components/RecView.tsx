"use client";

// One reconciliation at group level. The cover shows each company's ledger,
// schedule, variance, and comment, with the group total. Nothing is typed into a
// spreadsheet: the schedule is here, and Excel comes only with the month-end pack.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, Minus, Plus, X } from "lucide-react";
import MarkdownOutput from "@/modules/finance/components/MarkdownOutput";
import { EVENT_LABEL, PROOF_LABEL, actorLabel, dayLabel, money, monthLabel, type CoverRow, type EntityChecks, type RecDetail, type RecJournal, type ScheduleItem } from "@/modules/finance/lib/recs";
import { StatusPill } from "./RecsList";
import styles from "./Recs.module.css";

type Send = (path: string, body?: unknown, method?: string) => Promise<boolean>;

export default function RecView({ slug, data }: { slug: string; data: RecDetail }) {
  const router = useRouter();
  const { rec, cover, schedule, checks, journals, prior, agent_run: run } = data;
  const working = Boolean(run?.live);
  const [busy, setBusy] = useState(false);

  // While FM1 works, look again every 15 seconds so its items and answer
  // appear without a reload.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [working, router]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [sole, setSole] = useState(false);

  const send: Send = async (path, body = {}, method = "POST") => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/recs/${rec.id}/${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((out.issues as string[] | undefined)?.join(" ") ?? out.error ?? "That did not work");
      return false;
    }
    router.refresh();
    return true;
  };

  const preparing = ["not_started", "in_progress", "sent_back"].includes(rec.status);
  const difference = cover.group.variance;
  const stage = rec.status === "with_fc" ? 1 : rec.status === "with_cfo" ? 2 : rec.status === "signed_off" ? 3 : 0;
  const stepClass = (n: number) => (stage === n ? styles.stepOn : "");

  return (
    <div className={styles.recPage}>
      <div className={styles.top}>
        <div>
          <Link className={styles.crumb} href={`/finance/clients/${slug}/reconciliations?period=${rec.period}`}>Reconciliations / {rec.label}</Link>
          <h1 className={styles.title}>{rec.account_name}</h1>
          <div className={styles.steps} style={{ marginTop: 6 }}>
            <StatusPill r={rec} />
            <span className={stepClass(0)}>FM1 prepares</span><span>/</span>
            <span className={stepClass(1)}>FC reviews</span><span>/</span>
            <span className={stepClass(2)}>CFO signs off</span>
          </div>
        </div>
        <div className={styles.actions}>
          {rec.workable && preparing && (
            <button type="button" className="btn-secondary" disabled={busy || working} onClick={() => send("agent")}>{working ? <><span className={styles.spinner} aria-hidden="true" />FM1 is working</> : "Start FM1"}</button>
          )}
          {["with_fc", "with_cfo", "signed_off"].includes(rec.status) && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => send("reopen")}>Reopen</button>
          )}
          {rec.status === "with_cfo" && (
            <button type="button" className="btn-primary" disabled={busy || !cover.ties || Boolean(rec.recheck_reason)} onClick={() => send("sign-off", { sole_reviewer: sole })}>Sign off</button>
          )}
        </div>
      </div>

      {error && <div className={styles.err} role="alert">{error}</div>}

      {working && (
        <div className={`${styles.note} ${styles.working}`} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>FM1 {run?.status === "queued" ? "is starting" : "is working on this"}, since {timeLabel(run?.started_at ?? run?.queued_at)}. It usually takes three to five minutes. Items appear here as it saves them.</span>
        </div>
      )}
      {run && !working && run.status === "failed" && (
        <div className={styles.alert} role="alert"><strong>FM1&apos;s last run did not finish.</strong> {run.error ?? ""}</div>
      )}
      {run && !working && run.status === "succeeded" && run.output && (
        <details className={styles.found}>
          <summary className={styles.h2}>FM1&apos;s answer, {timeLabel(run.finished_at)}</summary>
          <MarkdownOutput text={run.output} />
        </details>
      )}

      {rec.sole_reviewer && <div className={styles.note}>Sole reviewer: one person acted in more than one seat on this reconciliation.</div>}
      {rec.shown_as_signed && <div className={styles.note}>Shown as signed off on {dayLabel(rec.signed_off_at)}, by {rec.signed_off_by}.</div>}
      {rec.signed_before > 0 && <div className={styles.small}>Signed off before and reopened: {rec.signed_before} earlier {rec.signed_before === 1 ? "signing is" : "signings are"} kept on the record.</div>}
      {cover.mixed_currency && <div className={styles.alert} role="status">These companies report in different currencies and no closing rate is held, so there is no group total. Each company ties on its own.</div>}

      {rec.recheck_reason && (
        <div className={styles.alert} role="alert"><strong>Re-check.</strong> {rec.recheck_reason}{rec.status !== "in_progress" && " Reopen it, then prepare it again."}</div>
      )}

      <div className={styles.tiles}>
        <Tile label={`Ledger at ${dayLabel(rec.period_end)}`} value={money(cover.group.gl)} />
        <Tile label={rec.proof === "schedule" ? "Schedule" : "Support"} value={money(cover.group.schedule)} />
        <Tile label="Difference" value={money(difference)} off={Boolean(difference && !cover.ties)} />
        <Tile label={`Rolled from ${prior.label}`} value={prior.status === null ? "Nothing earlier" : prior.recheck ? "Needs re-check" : prior.status === "signed_off" ? "Signed off" : "Not signed off"} />
      </div>

      {rec.preparer_note && (
        <Fold title="What the preparer found" tone="found">
          <MarkdownOutput text={rec.preparer_note} />
        </Fold>
      )}
      {rec.review_note && (
        <Fold title="Review" tone="found">
          <MarkdownOutput text={rec.review_note} />
        </Fold>
      )}

      {!rec.line_key && <PlaceLine data={data} busy={busy} send={send} />}

      <section className={`${styles.card} ${styles.section}`}>
        <div className={styles.cardHead}>
          <h2 className={styles.h2}>By company</h2>
          <span className={styles.small}>{PROOF_LABEL[rec.proof]}{rec.class ? ` · Class ${rec.class}` : ""}{rec.owner ? ` · Owner ${rec.owner}` : ""}{rec.challenge ? ` · Challenge ${rec.challenge}` : ""}</span>
        </div>
        <Cover rows={cover.rows} group={cover.group} canComment={preparing} busy={busy} send={send} />
      </section>

      {!rec.workable && rec.line_key && (
        <div className={styles.note}>This line is on the list so it cannot be missed. Its {PROOF_LABEL[rec.proof].toLowerCase()} screen comes in a later release; only Prepayments works end to end for now.</div>
      )}

      {rec.workable && (
        <Fold title="Schedule" open meta={`${schedule.items.length} ${schedule.items.length === 1 ? "item" : "items"}`}
          action={preparing && <button type="button" className="btn-secondary" onClick={(e) => { e.preventDefault(); setAdding(!adding); }}><Plus size={14} aria-hidden="true" />Add item</button>}>
          {adding && <ItemForm entities={data.entities} busy={busy} send={send} onDone={() => setAdding(false)} />}
          {schedule.items.length === 0
            ? <div className={styles.pad}><span className={styles.sub}>No items yet.</span></div>
            : <Schedule schedule={schedule} preparing={preparing} busy={busy} send={send} checks={checks?.entities ?? []} />}
        </Fold>
      )}

      {rec.workable && data.releases && <Releases slug={slug} data={data} busy={busy} send={send} preparing={preparing} />}

      {rec.workable && (
        <div className={styles.two}>
          <section className={`${styles.card} ${styles.pad} ${styles.section}`}>
            <h2 className={styles.h2}>Proposed journals</h2>
            {journals.length === 0 && <span className={styles.sub}>None. Agents propose here; nothing goes to Xero without your approval.</span>}
            {journals.map((j) => <Journal key={j.id} j={j} busy={busy} send={send} />)}
          </section>
          <section className={`${styles.card} ${styles.pad} ${styles.section}`}>
            <div className={styles.cardHead} style={{ padding: "0 0 8px" }}>
              <h2 className={styles.h2}>Checks</h2>
              {preparing && <button type="button" className="btn-secondary" disabled={busy} onClick={() => send("checks")}>Run checks</button>}
            </div>
            <Checks data={data} />
          </section>
        </div>
      )}

      {rec.workable && preparing && (
        <section className={`${styles.card} ${styles.pad} ${styles.section}`}>
          <h2 className={styles.h2}>Hand to the FC</h2>
          <label className={styles.field}>What you found
            <textarea className={styles.area} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className={styles.actions} style={{ marginTop: 8 }}>
            <button type="button" className="btn-primary" disabled={busy} onClick={async () => { if (await send("prepare", { note })) setNote(""); }}>Mark prepared</button>
          </div>
        </section>
      )}

      {rec.status === "with_fc" && (
        <section className={`${styles.card} ${styles.pad} ${styles.section}`}>
          <h2 className={styles.h2}>FC review</h2>
          <label className={styles.field}>Your view
            <textarea className={styles.area} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <SoleTick sole={sole} setSole={setSole} />
          <div className={styles.actions} style={{ marginTop: 8 }}>
            <button type="button" className="btn-primary" disabled={busy} onClick={async () => { if (await send("review", { pass: true, note, sole_reviewer: sole })) setNote(""); }}>Pass to the CFO</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={async () => { if (await send("review", { pass: false, note, sole_reviewer: sole })) setNote(""); }}>Send back</button>
          </div>
        </section>
      )}

      {rec.status === "with_cfo" && (
        <section className={`${styles.card} ${styles.pad} ${styles.section}`}>
          <SoleTick sole={sole} setSole={setSole} />
          <h2 className={styles.h2}>Send back</h2>
          <label className={styles.field}>What needs changing
            <textarea className={styles.area} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className={styles.actions} style={{ marginTop: 8 }}>
            <button type="button" className="btn-secondary" disabled={busy} onClick={async () => { if (await send("send-back", { note })) setNote(""); }}>Send back</button>
          </div>
        </section>
      )}

      <Fold title="History" meta={`${data.events.length} ${data.events.length === 1 ? "entry" : "entries"}`}>
        <div className={styles.pad}>
          {data.events.length === 0 && <span className={styles.sub}>Nothing yet.</span>}
          {data.events.map((e, i) => (
            <div key={i} className={styles.event}>
              <span>{EVENT_LABEL[e.action] ?? e.action} · {actorLabel(e.actor)}</span>
              <span>{dayLabel(e.at)}</span>
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}

const RELEASE_STATE: Record<string, string> = {
  proposed: "Waiting for the CFO", approved: "Going to Xero", draft_created: "Draft in Xero", posted: "Posted in Xero", rejected: "Rejected",
};

// The monthly release journal, made here from the schedule because Xero's API
// cannot set up or read a repeating journal. Switched on once for the account;
// each time the month's checks run, the release for anything Xero does not
// already show is proposed on the Journals page.
function Releases({ slug, data, busy, send, preparing }: { slug: string; data: RecDetail; busy: boolean; send: Send; preparing: boolean }) {
  const r = data.releases!;
  const last = data.checks?.releases ?? [];
  return (
    <Fold title="Monthly release journal" meta={r.on ? "On" : "Off"}
      action={<button type="button" className="btn-secondary" disabled={busy} onClick={(e) => { e.preventDefault(); void send("releases", { on: !r.on }, "PUT").then((done) => { if (done && !r.on && preparing) void send("checks"); }); }}>{r.on ? "Switch off" : "Switch on"}</button>}>
      <div className={styles.pad}>
        <p className={styles.small} style={{ marginTop: 0 }}>
          {r.on
            ? <>On{r.by ? ` since ${dayLabel(r.at)}, by ${r.by}` : ""}. Each time this month&apos;s checks run, os.stza.io proposes the releases from the schedule on the Journals page, one journal per item so any one can be reversed on its own, leaving out any item Xero already shows as released this month. The CFO approves them there and each goes to Xero as a draft. Items stop releasing when they end.</>
            : <>Off. Switch it on and os.stza.io prepares each month&apos;s release journal from this schedule, so the schedule and Xero stay in step. A release Xero already has, from a repeating journal set up there or one made by hand, is left out. Only the CFO switches it.</>}
        </p>
        {r.journals.length > 0 && (
          <div className={styles.event} style={{ fontWeight: 600 }}><span>{data.rec.label}</span><span /></div>
        )}
        {r.journals.map((j) => (
          <div key={j.id} className={styles.event}>
            <span>{j.entity_name} · {j.item_no != null ? `${j.item_no}. ` : ""}{j.supplier ?? "An item"} · {money(j.total)} · {RELEASE_STATE[j.state] ?? j.state}{j.xero_journal_no ? ` (#${j.xero_journal_no})` : ""}{j.last_error ? ` · ${j.last_error}` : ""}</span>
            <Link href={`/finance/clients/${slug}/journals?period=${data.rec.period}`}>Journals</Link>
          </div>
        ))}
        {r.on && last.filter((x) => x.state !== "proposed" && x.state !== "kept").map((x) => (
          <div key={`${x.entity_id}-${x.item_id ?? x.state}`} className={styles.small}>{x.entity}{x.supplier ? `, ${x.supplier}` : ""}: {x.why}</div>
        ))}
        {r.on && r.journals.length === 0 && last.length === 0 && (
          <span className={styles.sub}>{preparing ? "Run checks to propose this month's releases." : "No release was proposed for this month."}</span>
        )}
      </div>
    </Fold>
  );
}

function SoleTick({ sole, setSole }: { sole: boolean; setSole: (v: boolean) => void }) {
  return (
    <label className={styles.small} style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "8px 0 12px" }}>
      <input type="checkbox" checked={sole} onChange={(e) => setSole(e.target.checked)} />
      <span>I prepared or reviewed this, or started the agents that did, and I am its only reviewer. This is recorded and shown on the reconciliation.</span>
    </label>
  );
}

function Tile({ label, value, off = false }: { label: string; value: string; off?: boolean }) {
  return (
    <div className={`${styles.tile} ${off ? styles.tileOff : ""}`}>
      <div className={styles.figLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
    </div>
  );
}

function Cover({ rows, group, canComment, busy, send }: {
  rows: CoverRow[]; group: RecDetail["cover"]["group"]; canComment: boolean; busy: boolean; send: Send;
}) {
  return (
    <>
      <div className={styles.cards} style={{ gap: 0 }}>
        {rows.map((r) => (
          <div key={r.entity_id} className={styles.coverCard}>
            <div className={styles.rowTop}><span className={styles.rowName}>{r.entity}</span><span className={styles.small}>{r.no_ledger ? "Nothing in the ledger" : `${r.code ?? ""}${r.currency ? ` ${r.currency}` : ""}`}</span></div>
            <div className={styles.rowFigs}>
              <div className={styles.fig}><div className={styles.figLabel}>Ledger</div><div className={styles.figValue}>{money(r.gl)}</div></div>
              <div className={styles.fig}><div className={styles.figLabel}>Schedule</div><div className={styles.figValue}>{money(r.schedule)}</div></div>
              <div className={styles.fig}><div className={styles.figLabel}>Variance</div><div className={styles.figValue}>{money(r.variance)}</div></div>
            </div>
            <Comment row={r} canComment={canComment} busy={busy} send={send} />
          </div>
        ))}
        <div className={styles.coverCard}>
          <div className={styles.rowTop}><span className={styles.rowName}>Group total</span></div>
          <div className={styles.rowFigs}>
            <div className={styles.fig}><div className={styles.figLabel}>Ledger</div><div className={styles.figValue}>{money(group.gl)}</div></div>
            <div className={styles.fig}><div className={styles.figLabel}>Schedule</div><div className={styles.figValue}>{money(group.schedule)}</div></div>
            <div className={styles.fig}><div className={styles.figLabel}>Variance</div><div className={styles.figValue}>{money(group.variance)}</div></div>
          </div>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Company</th><th>GL account</th><th className={styles.num}>GL per TB</th><th className={styles.num}>Schedule</th><th className={styles.num}>Variance</th><th>Comment</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity_id}>
                <td>{r.entity}</td>
                <td className={styles.sub}>{r.no_ledger ? "Nothing in the ledger" : `${r.code ? `${r.code} ` : ""}${r.gl_name}${r.currency ? ` (${r.currency})` : ""}`}</td>
                <td className={styles.num}>{money(r.gl)}</td>
                <td className={styles.num}>{money(r.schedule)}</td>
                <td className={`${styles.num} ${r.ties === false ? styles.strong : ""}`}>{money(r.variance)}</td>
                <td><Comment row={r} canComment={canComment} busy={busy} send={send} /></td>
              </tr>
            ))}
            <tr className={styles.total}>
              <td>Group total</td><td></td>
              <td className={styles.num}>{money(group.gl)}</td><td className={styles.num}>{money(group.schedule)}</td><td className={styles.num}>{money(group.variance)}</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function Comment({ row, canComment, busy, send }: { row: CoverRow; canComment: boolean; busy: boolean; send: Send }) {
  const [text, setText] = useState(row.comment ?? "");
  if (!canComment) return <span className={styles.small}>{row.comment ?? ""}</span>;
  return (
    <input aria-label={`Comment for ${row.entity}`} className={`${styles.input} ${styles.commentBox}`} placeholder="Comment" value={text} disabled={busy}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== (row.comment ?? "")) void send("comment", { entity_id: row.entity_id, comment: text }); }} />
  );
}

function PlaceLine({ data, busy, send }: { data: RecDetail; busy: boolean; send: Send }) {
  const [line, setLine] = useState("");
  return (
    <section className={`${styles.card} ${styles.pad} ${styles.section}`}>
      <h2 className={styles.h2}>Place this account on the matrix</h2>
      <p className={styles.sub} style={{ marginTop: 0 }}>It could not be placed from its name, and a wrong owner is worse than a visible gap. The line sets the owner, the challenge, and the class.</p>
      <div className={styles.actions}>
        <select aria-label="Matrix line" className={styles.pick} value={line} onChange={(e) => setLine(e.target.value)}>
          <option value="">Choose a line</option>
          {data.lines.map((l) => <option key={l.key} value={l.key}>{l.line}</option>)}
        </select>
        <button type="button" className="btn-primary" disabled={busy || !line} onClick={() => send("place", { line_key: line })}>Place it</button>
      </div>
    </section>
  );
}

function journalText(c: EntityChecks | undefined, itemId: string): string {
  const i = c?.items?.find((x) => x.item_id === itemId);
  if (!i) return c ? "Not checked" : "-";
  if (i.journal === "posted") return i.combined ? "Posted, combined" : "Posted";
  if (i.journal === "draft") return "In draft";
  if (i.journal === "missing") return "Missing";
  return "None due";
}

function Schedule({ schedule, preparing, busy, send, checks }: {
  schedule: RecDetail["schedule"]; preparing: boolean; busy: boolean; send: Send; checks: EntityChecks[];
}) {
  const check = (i: ScheduleItem) => checks.find((c) => c.entity_id === i.entity_id);
  const end = (i: ScheduleItem) => (i.treatment === "held" ? "Held" : `${dayLabel(i.service_start)} to ${dayLabel(i.service_end)}`);
  return (
    <>
      <div className={styles.items}>
        {schedule.items.map((i) => (
          <div key={i.id} className={styles.item}>
            <div className={styles.itemTop}>
              <span className={styles.rowName}>{i.item_no}. {i.supplier}</span>
              <span className={styles.figValue}>{money(i.balance)}</span>
            </div>
            <div className={styles.small}>{i.entity_name}{i.description ? ` · ${i.description}` : ""}</div>
            <div className={styles.rowMeta}>
              <span>{end(i)}</span>
              <span>To {i.pl_account_code}</span>
              <span>Monthly {money(i.monthly)}</span>
              <span>Journal: {journalText(check(i), i.id)}</span>
            </div>
            <details className={styles.itemMonths}>
              <summary>Details and monthly releases</summary>
              <div className={styles.small} style={{ marginTop: 6 }}>
                Invoice {i.invoice_ref ?? "-"}{i.invoice_date ? `, ${dayLabel(i.invoice_date)}` : ""} · Total cost {money(i.total_cost)} · Released {money(i.released)}{i.document_ref ? ` · ${i.document_ref}` : " · No document"}
              </div>
              <div className={styles.monthGrid}>
                {schedule.months.filter((m) => Number(i.by_month[m]) !== 0).map((m) => (
                  <div key={m}><span>{monthLabel(m)}</span><span>{money(i.by_month[m])}</span></div>
                ))}
              </div>
              {i.note && <p className={styles.small}>{i.note}</p>}
            </details>
            {preparing && <button type="button" className="btn-text" disabled={busy} onClick={() => send(`items/${i.id}`, undefined, "DELETE")}>Remove</button>}
          </div>
        ))}
      </div>
      <div className={styles.scheduleWide}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sticky}>No</th><th>Supplier</th><th>Company</th><th>Description</th><th>Release to P&amp;L a/c</th><th>Invoice ref and date</th>
              <th className={styles.num}>Total cost net</th><th>Service start</th><th>Service end</th><th>Amort commenced</th>
              {schedule.months.map((m) => <th key={m} className={styles.num}>{monthLabel(m)}</th>)}
              <th className={styles.num}>Released</th><th className={styles.num}>Balance c/f</th><th>Monthly journal in Xero</th><th>Document</th>{preparing && <th></th>}
            </tr>
          </thead>
          <tbody>
            {schedule.items.map((i) => (
              <tr key={i.id}>
                <td className={styles.sticky}>{i.item_no}</td>
                <td>{i.supplier}</td><td className={styles.sub}>{i.entity_name}</td><td className={styles.sub}>{i.description ?? ""}</td>
                <td>{i.pl_account_code}</td>
                <td className={styles.sub}>{i.invoice_ref ?? "-"}{i.invoice_date ? `, ${dayLabel(i.invoice_date)}` : ""}</td>
                <td className={styles.num}>{money(i.total_cost)}</td>
                <td>{i.treatment === "held" ? "Held" : dayLabel(i.service_start)}</td><td>{i.treatment === "held" ? "" : dayLabel(i.service_end)}</td>
                <td>{i.treatment === "held" ? "" : dayLabel(i.amort_commenced)}</td>
                {schedule.months.map((m) => <td key={m} className={styles.num}>{Number(i.by_month[m]) === 0 ? "" : money(i.by_month[m])}</td>)}
                <td className={styles.num}>{money(i.released)}</td>
                <td className={`${styles.num} ${styles.strong}`}>{money(i.balance)}</td>
                <td>{journalText(check(i), i.id)}</td>
                <td className={styles.sub}>{i.document_ref ?? "None"}</td>
                {preparing && <td><button type="button" className="btn-text" disabled={busy} onClick={() => send(`items/${i.id}`, undefined, "DELETE")}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const BLANK = {
  entity_id: "", supplier: "", description: "", pl_account_code: "", invoice_ref: "", invoice_date: "", total_cost: "",
  service_start: "", service_end: "", document_ref: "",
};

function ItemForm({ entities, busy, send, onDone }: { entities: RecDetail["entities"]; busy: boolean; send: Send; onDone: () => void }) {
  const [f, setF] = useState({ ...BLANK, entity_id: entities.length === 1 ? entities[0].id : "" });
  const field = (k: keyof typeof BLANK, label: string, type = "text") => (
    <label className={styles.field}>{label}
      <input className={styles.input} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className={styles.form}>
      <div className={styles.formGrid}>
        <label className={styles.field}>Company
          <select className={styles.input} value={f.entity_id} onChange={(e) => setF({ ...f, entity_id: e.target.value })}>
            <option value="">Choose</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        {field("supplier", "Supplier")}
        {field("description", "Description")}
        {field("pl_account_code", "Release to P&L account")}
        {field("invoice_ref", "Invoice ref")}
        {field("invoice_date", "Invoice date", "date")}
        <label className={styles.field}>Total cost net
          <input className={styles.input} inputMode="decimal" value={f.total_cost} onChange={(e) => setF({ ...f, total_cost: e.target.value })} />
        </label>
        {field("service_start", "Service start", "date")}
        {field("service_end", "Service end", "date")}
        {field("document_ref", "Document")}
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn-primary" disabled={busy} onClick={async () => {
          const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
          if (await send("items", body)) { setF(BLANK); onDone(); }
        }}>Add item</button>
        <button type="button" className="btn-text" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function Journal({ j, busy, send }: { j: RecJournal; busy: boolean; send: Send }) {
  if (j.state === "superseded") return null;
  const approved = j.retry_state === "live" ? "Approved. An agent is creating the draft in Xero."
    : j.retry_state === "unknown" ? "The last attempt did not finish cleanly, so this draft may already be in Xero. Check Xero. If it is not there, reject this and ask FM1 to propose it again."
      : j.retry_state === "drafted" ? "This draft is in Xero." : "Approved, but no draft was created.";
  const state = { proposed: null, approved, draft_created: `Draft in Xero${j.xero_journal_no ? `, number ${j.xero_journal_no}` : ""}. Post it there.`, rejected: "Rejected." }[j.state];
  return (
    <div style={{ marginBottom: 12 }}>
      <div className={styles.small}>{j.entity_name} · {dayLabel(j.journal_date)} · {j.narration}</div>
      <div style={{ marginTop: 4 }}>
        {j.lines.map((l, i) => (
          <div key={i} className={styles.jLine}>
            <span>{l.account_code}{l.description ? ` ${l.description}` : ""}</span>
            <span className={styles.num}>{l.amount > 0 ? "Dr" : "Cr"} {money(Math.abs(l.amount))}</span>
          </div>
        ))}
      </div>
      {j.reason && <p className={styles.small}>{j.reason}</p>}
      {state ? <p className={styles.sub}>{state}</p> : <p className={styles.small}>After your approval, an agent creates it as a draft in Xero and you post it there.</p>}
      {j.state === "approved" && j.retry_state !== "live" && (
        <div className={styles.actions}>
          {j.can_retry && <button type="button" className="btn-text" disabled={busy} onClick={() => send(`journals/${j.id}/approve`)}>Try again</button>}
          {j.retry_state !== "drafted" && j.retry_state !== "unknown" && <button type="button" className="btn-text" disabled={busy} onClick={() => send(`journals/${j.id}/reject`)}>Reject</button>}
          {j.retry_state === "unknown" && <button type="button" className="btn-text" disabled={busy} onClick={() => send(`journals/${j.id}/reject`, { confirmed_not_in_xero: true })}>I checked: it is not in Xero. Reject</button>}
        </div>
      )}
      {j.state === "proposed" && (
        <div className={styles.actions}>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => send(`journals/${j.id}/approve`)}>Approve as Xero draft</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => send(`journals/${j.id}/reject`)}>Reject</button>
        </div>
      )}
    </div>
  );
}

function Checks({ data }: { data: RecDetail }) {
  const { cover, schedule, checks, prior } = data;
  const undocumented = schedule.items.filter((i) => !i.document_ref && !i.invoice_ref).length;
  const results = checks?.entities ?? [];
  const missing = results.reduce((a, r) => a + (r.missing ?? 0), 0);
  const failed = results.filter((r) => r.error);
  const warnings = results.flatMap((r) => r.warnings ?? []);
  const openingText = prior.opening_agrees === null ? "No earlier month"
    : prior.opening_agrees ? `Agrees${prior.status === "signed_off" ? "" : `, ${prior.label} not signed off`}` : "Differs";
  return (
    <>
      <CheckRow label="Ledger agrees to schedule" result={cover.ties ? "pass" : "fail"} text={cover.ties ? "Pass" : `Out by ${money(cover.group.variance)}`} />
      <CheckRow label={`Opening equals ${prior.label} close`} result={prior.opening_agrees === null ? "none" : prior.opening_agrees ? "pass" : "fail"} text={openingText} />
      <CheckRow label="Every item has a document" result={undocumented ? "fail" : "pass"} text={undocumented ? `${undocumented} without` : "Pass"} />
      <CheckRow label="Monthly journal posted for each item" result={!checks ? "none" : failed.length || missing ? "fail" : "pass"} text={!checks ? "Not run" : failed.length ? "Could not read" : missing ? `${missing} missing` : "Pass"} />
      {failed.map((f) => <p key={f.entity_id} className={styles.small}>{f.entity}: {f.error}</p>)}
      {warnings.map((w, i) => <p key={i} className={styles.small}>{w.text}</p>)}
      {checks && <p className={styles.small}>{checks.note}</p>}
    </>
  );
}

function timeLabel(at: string | null | undefined): string {
  if (!at) return "just now";
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

function CheckRow({ label, result, text }: { label: string; result: "pass" | "fail" | "none"; text: string }) {
  const Icon = result === "pass" ? Check : result === "fail" ? X : Minus;
  const tone = result === "pass" ? styles.pass : result === "fail" ? styles.fail : styles.none;
  return (
    <div className={styles.check}>
      <span>{label}</span>
      <span className={`${styles.checkResult} ${tone}`}><Icon size={15} aria-hidden="true" strokeWidth={2.5} />{text}</span>
    </div>
  );
}

// A card that folds. Closed by default unless `open`; the header carries a
// count and, where there is one, the section's action.
function Fold({ title, meta, action, open = false, tone, children }: {
  title: string; meta?: string; action?: ReactNode; open?: boolean; tone?: "found"; children: ReactNode;
}) {
  return (
    <details className={`${tone === "found" ? styles.foundFold : styles.card} ${styles.section} ${styles.fold}`} open={open}>
      <summary className={styles.cardHead}>
        <span className={styles.foldTitle}><ChevronRight size={16} className={styles.chev} aria-hidden="true" /><span className={styles.h2}>{title}</span>{meta && <span className={styles.small}>{meta}</span>}</span>
        {action}
      </summary>
      <div className={tone === "found" ? styles.foldBody : undefined}>{children}</div>
    </details>
  );
}

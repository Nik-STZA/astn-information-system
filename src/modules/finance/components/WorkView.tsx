"use client";

// Work: the List view and the task panel (redesign step 3b). Every change goes
// to finance-api through /api/finance/<slug>/work/..., which records who did it
// in the task's history; the page then refreshes from the server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, X } from "lucide-react";
import styles from "./Work.module.css";
import {
  AGENTS, DROPPABLE, SETTABLE, STATUS_LABEL, blockerText, boardColumns, eventText, ownerInitials, ownerLabel, taskTree, timelineLayout, viaText,
  type ShownStatus, type Task, type TaskEvent, type TreeRow,
} from "@/modules/finance/lib/work";

export interface BillOption { id: string; label: string }
type View = "list" | "board" | "timeline";
type Entity = { id: string; slug: string; name: string };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const shortDate = (d: string | null) => {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

function StatusPill({ s }: { s: Task["shown_status"] }) {
  return <span className={`${styles.status} ${styles[`s-${s}`]}`}><span className={styles.dot} />{STATUS_LABEL[s]}</span>;
}

export default function WorkView({ slug, tasks, entities, bills, error, initialTask, initialView }: {
  slug: string; tasks: Task[]; entities: Entity[]; bills: BillOption[]; error: string | null; initialTask: string | null;
  initialView: View | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(initialTask);
  const [creating, setCreating] = useState<{ parent_id: string | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<View>(initialView ?? "list");
  const [links, setLinks] = useState(true);
  const [boardIssues, setBoardIssues] = useState<string[]>([]);
  // The view you last used, per browser, unless the link names one.
  useEffect(() => {
    if (initialView) return;
    try {
      const v = localStorage.getItem("stza-work-view");
      if (v === "list" || v === "board" || v === "timeline") setView(v);
      setLinks(localStorage.getItem("stza-work-links") !== "0");
    } catch { /* defaults */ }
  }, [initialView]);
  const toggleLinks = () => {
    setLinks(!links);
    try { localStorage.setItem("stza-work-links", links ? "0" : "1"); } catch { /* ignore */ }
  };
  const pickView = (v: View) => {
    setView(v);
    try { localStorage.setItem("stza-work-view", v); } catch { /* ignore */ }
  };
  // A card dropped on a column: the new status, recorded in the task's history.
  async function moveTo(id: string, status: ShownStatus) {
    const t = tasks.find((x) => x.id === id);
    if (!t || !DROPPABLE.has(status) || t.status === status) return;
    const r = await send(`${base}/tasks/${id}`, "PATCH", { status });
    setBoardIssues(r.issues);
    if (r.ok) router.refresh();
  }
  const rows = useMemo(() => taskTree(tasks, { collapsed, showDone }), [tasks, collapsed, showDone]);
  const task = tasks.find((t) => t.id === selected) ?? null;
  const base = `/api/finance/${encodeURIComponent(slug)}/work`;
  const people = useMemo(() => Array.from(new Set(tasks.flatMap((t) => [t.created_by, t.owner_kind === "person" ? t.owner : null]).filter(Boolean) as string[])).sort(), [tasks]);

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsed(next);
  }

  return (
    <div>
      <div className={styles.head}>
        <div>
          <h1>Work</h1>
          <p className={styles.sub}>Tasks and sub-tasks, what holds them up, and what happened to each.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => { setSelected(null); setCreating({ parent_id: null }); }}>
          <Plus size={15} aria-hidden="true" />New task
        </button>
      </div>

      <div className={styles.bar}>
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "seg-on" : undefined} aria-pressed={view === "list"} onClick={() => pickView("list")}>List</button>
          <button type="button" className={view === "board" ? "seg-on" : undefined} aria-pressed={view === "board"} onClick={() => pickView("board")}>Board</button>
          <button type="button" className={view === "timeline" ? "seg-on" : undefined} aria-pressed={view === "timeline"} onClick={() => pickView("timeline")}>Timeline</button>
        </div>
        {view === "timeline" && (
          <button type="button" className={styles.toggle} onClick={toggleLinks} aria-pressed={links}>
            <span className={`${styles.knob} ${links ? styles.knobOn : ""}`}><span /></span>Show links
          </button>
        )}
        <label className={styles.check}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show done</label>
      </div>

      {error && <p className={styles.issues} role="alert">{error}</p>}

      <div className={styles.layout}>
        <div className={styles.listPane}>
          {view === "timeline" && (
            <Timeline rows={rows} tasks={tasks} links={links} selected={selected}
              onOpen={(id) => { setCreating(null); setSelected(id); }} onToggle={toggle} />
          )}
          {view === "board" && (
            <Board tasks={tasks} showDone={showDone} selected={selected} issues={boardIssues}
              onOpen={(id) => { setCreating(null); setSelected(id); }} onMove={moveTo} />
          )}
          {view === "list" && <section className={`${styles.card} ${styles.scroll}`} aria-label="Tasks">
            {rows.length === 0 ? (
              <div className={styles.empty}>{tasks.length ? "Everything here is done. Tick Show done to see it." : "No tasks yet. Add the first with New task."}</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr><th scope="col">Task</th><th scope="col" className={styles.wide}>Status</th><th scope="col" className={styles.wide}>Holding it up</th><th scope="col" className={styles.wide}>Owner</th><th scope="col" className={styles.wide}>Due</th></tr>
                </thead>
                <tbody>
                  {rows.map(({ task: t, depth, hasChildren, open }) => {
                    const openBlocks = t.blockers.filter((b) => b.open);
                    const block = openBlocks[0];
                    const more = openBlocks.length > 1 ? ` +${openBlocks.length - 1} more` : "";
                    const late = t.due_on && t.status !== "done" && t.due_on < today();
                    return (
                      <tr key={t.id} className={`${styles.row} ${t.id === selected ? styles.sel : ""} ${t.status === "done" ? styles.done : ""}`}
                        onClick={() => { setCreating(null); setSelected(t.id); }}>
                        <td>
                          <div className={styles.title} style={{ paddingLeft: depth * 22 }}>
                            {hasChildren ? (
                              <button type="button" className={styles.chev} aria-label={open ? "Hide sub-tasks" : "Show sub-tasks"} aria-expanded={open}
                                onClick={(e) => { e.stopPropagation(); toggle(t.id); }}>
                                <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : undefined }} aria-hidden="true" />
                              </button>
                            ) : <span className={styles.spacer} />}
                            <button type="button" className={`${styles.titleText} ${hasChildren ? styles.parentTitle : ""}`}>{t.title}</button>
                            {t.priority === "P1" && <span className={styles.blocker}>P1</span>}
                          </div>
                          {t.entity_name && <div className={styles.meta} style={{ paddingLeft: depth * 22 + 28 }}>{t.entity_name}</div>}
                          {/* On a phone the other columns fold in under the title. */}
                          <div className={styles.phoneMeta} style={{ paddingLeft: depth * 22 + 28 }}>
                            <StatusPill s={t.shown_status} />
                            {t.due_on && <span className={late ? styles.overdue : styles.meta}>due {shortDate(t.due_on)}</span>}
                            <span className={styles.ava} title={ownerLabel(t)}>{ownerInitials(t)}</span>
                            {block && <span className={styles.blocker} style={{ flexBasis: "100%" }}>{blockerText(block)}{more}</span>}
                          </div>
                        </td>
                        <td className={styles.wide}><StatusPill s={t.shown_status} /></td>
                        <td className={styles.wide}>{block ? <span className={styles.blocker}>{blockerText(block)}{more}</span> : <span className={styles.meta}>-</span>}</td>
                        <td className={styles.wide}><span className={styles.ava} title={ownerLabel(t)}>{ownerInitials(t)}</span></td>
                        <td className={`${styles.wide} ${styles.nowrap} ${late ? styles.overdue : ""}`}>{shortDate(t.due_on)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>}
        </div>

        {creating && (
          <NewTask base={base} entities={entities} tasks={tasks} people={people} parentId={creating.parent_id}
            onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); setSelected(id); router.refresh(); }} />
        )}
        {!creating && task && (
          <TaskPanel key={task.id} base={base} task={task} tasks={tasks} entities={entities} bills={bills} people={people}
            onClose={() => setSelected(null)} onAddSub={() => setCreating({ parent_id: task.id })}
            onDeleted={() => { setSelected(null); router.refresh(); }} />
        )}
      </div>
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────
//
// One row per task in list order (collapsing a parent here collapses it in the
// list too). Bars run start to due; a parent with no dates spans its
// sub-tasks as a thin bar. Arrows run from the end of a blocking task to the
// start of the task waiting on it, and can be switched off.

const DAY = 36;
const ROW = 40;
const HEAD = 40;

function Timeline({ rows, tasks, links, selected, onOpen, onToggle }: {
  rows: TreeRow[]; tasks: Task[]; links: boolean; selected: string | null;
  onOpen: (id: string) => void; onToggle: (id: string) => void;
}) {
  const l = useMemo(() => timelineLayout(rows, tasks, today()), [rows, tasks]);
  // Open scrolled to two days before today.
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (track.current && l.todayIndex !== null) track.current.scrollLeft = Math.max(0, (l.todayIndex - 2) * DAY);
  }, [l.todayIndex]);
  if (!rows.length) return <section className={styles.card}><div className={styles.empty}>No tasks to show.</div></section>;
  const barOf = new Map(l.bars.map((b) => [b.id, b]));
  const width = l.days.length * DAY;
  const height = rows.length * ROW;
  const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  return (
    <section className={`${styles.card} ${styles.tl}`} aria-label="Tasks on a timeline">
      <div className={styles.tlGrid}>
        <div className={styles.tlNames}>
          <div className={styles.tlNameHead} style={{ height: HEAD }}>Task</div>
          {rows.map(({ task: t, depth, hasChildren, open }) => (
            <div key={t.id} className={`${styles.tlName} ${t.id === selected ? styles.tlSel : ""}`} style={{ height: ROW, paddingLeft: 8 + depth * 16 }}>
              {hasChildren ? (
                <button type="button" className={styles.chev} aria-label={open ? "Hide sub-tasks" : "Show sub-tasks"} aria-expanded={open} onClick={() => onToggle(t.id)}>
                  <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : undefined }} aria-hidden="true" />
                </button>
              ) : <span className={styles.spacer} />}
              <button type="button" className={`${styles.titleText} ${hasChildren ? styles.parentTitle : ""}`} onClick={() => onOpen(t.id)} title={t.title}>{t.title}</button>
            </div>
          ))}
        </div>
        <div className={styles.tlTrackWrap} ref={track}>
          <div style={{ position: "relative", width, height: HEAD + height }}>
            <div className={styles.tlHead} style={{ height: HEAD }}>
              {l.days.map((d, i) => {
                const day = Number(d.slice(8, 10));
                const label = i === 0 || day === 1
                  ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
                  : String(day);
                return (
                  <div key={d} className={`${styles.tlDay} ${isWeekend(d) ? styles.tlWeekend : ""} ${i === l.todayIndex ? styles.tlToday : ""}`}
                    style={{ left: i * DAY, width: DAY }} title={d}>{label}</div>
                );
              })}
            </div>
            {l.days.map((d, i) => (isWeekend(d)
              ? <div key={d} className={styles.tlShade} style={{ left: i * DAY, width: DAY, top: HEAD, height }} />
              : null))}
            {rows.map(({ task: t }, r) => (
              <div key={t.id} className={`${styles.tlRow} ${t.id === selected ? styles.tlSel : ""}`}
                style={{ top: HEAD + r * ROW, height: ROW, width }} onClick={() => onOpen(t.id)} />
            ))}
            {l.todayIndex !== null && <div className={styles.tlTodayLine} style={{ left: l.todayIndex * DAY + DAY / 2, top: HEAD, height }} />}
            {l.bars.map((b) => {
              const t = tasks.find((x) => x.id === b.id)!;
              const w = (b.to - b.from + 1) * DAY - 6;
              return (
                <button key={b.id} type="button" onClick={() => onOpen(b.id)} title={`${t.title}: ${STATUS_LABEL[t.shown_status]}`}
                  className={`${styles.tlBar} ${b.parent ? styles.tlParent : styles[`b-${t.shown_status}`]}`}
                  style={{ left: b.from * DAY + 3, width: w, top: HEAD + b.row * ROW + (b.parent ? 16 : 9) }}>
                  {!b.parent && w > 70 ? STATUS_LABEL[t.shown_status] : ""}
                </button>
              );
            })}
            {links && l.links.length > 0 && (
              <svg className={styles.tlLinks} width={width} height={HEAD + height} aria-hidden="true">
                <defs>
                  <marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0 10 5 0 10z" style={{ fill: "var(--sub)" }} />
                  </marker>
                </defs>
                {l.links.map((k) => {
                  const a = barOf.get(k.from)!;
                  const z = barOf.get(k.to)!;
                  const x1 = (a.to + 1) * DAY - 3;
                  const y1 = HEAD + a.row * ROW + ROW / 2;
                  const x2 = z.from * DAY + 1;
                  const y2 = HEAD + z.row * ROW + ROW / 2;
                  // Forwards: across and down into the bar's start. Overlapping:
                  // down to the row boundary, back, then into the bar from the left.
                  const d = x2 >= x1 + 16
                    ? `M${x1} ${y1} H${x1 + 8} V${y2} H${x2}`
                    : `M${x1} ${y1} H${x1 + 8} V${y2 - ROW / 2 + 3} H${x2 - 10} V${y2} H${x2}`;
                  return <path key={`${k.from}-${k.to}`} d={d} fill="none"
                    style={{ stroke: "var(--sub)" }} strokeWidth={1.5} markerEnd="url(#tl-arrow)" />;
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}


// ── Board ─────────────────────────────────────────────────────────────────────

function Board({ tasks, showDone, selected, issues, onOpen, onMove }: {
  tasks: Task[]; showDone: boolean; selected: string | null; issues: string[];
  onOpen: (id: string) => void; onMove: (id: string, status: ShownStatus) => void;
}) {
  const cols = boardColumns(tasks, { showDone });
  const [over, setOver] = useState<ShownStatus | null>(null);
  return (
    <>
      <Issues issues={issues} />
      <div className={styles.board} aria-label="Tasks as a board">
        {cols.map((c) => {
          const droppable = DROPPABLE.has(c.status);
          return (
            <section key={c.status} aria-label={STATUS_LABEL[c.status]}
              className={`${styles.col} ${over === c.status && droppable ? styles.colOver : ""}`}
              onDragOver={(e) => { if (droppable) { e.preventDefault(); setOver(c.status); } }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) onMove(id, c.status); }}>
              <div className={styles.colHead}>
                <span>{STATUS_LABEL[c.status]}</span><span className={styles.meta}>{c.tasks.length}</span>
              </div>
              {!droppable && c.tasks.length === 0 && <div className={styles.colHint}>Set by blockers</div>}
              {c.tasks.map((t) => {
                const openBlocks = t.blockers.filter((b) => b.open);
                const late = t.due_on && t.status !== "done" && t.due_on < today();
                return (
                  <button key={t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                    className={`${styles.tcard} ${t.id === selected ? styles.tcardSel : ""}`} onClick={() => onOpen(t.id)}>
                    <span className={styles.tcardTitle}>{t.title}{t.priority === "P1" && <span className={styles.blocker}> · P1</span>}</span>
                    {(t.parentTitle || t.entity_name) && <span className={styles.meta}>{[t.parentTitle, t.entity_name].filter(Boolean).join(" · ")}</span>}
                    {openBlocks[0] && <span className={styles.blocker}>{blockerText(openBlocks[0])}{openBlocks.length > 1 ? ` +${openBlocks.length - 1} more` : ""}</span>}
                    <span className={styles.tcardFoot}>
                      <span className={styles.ava} title={ownerLabel(t)}>{ownerInitials(t)}</span>
                      {t.due_on && <span className={late ? styles.overdue : styles.meta}>{shortDate(t.due_on)}</span>}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

interface Sent { ok: boolean; data: { id?: string; events?: TaskEvent[]; issues?: string[]; error?: string }; issues: string[] }

async function send(url: string, method: string, body?: unknown): Promise<Sent> {
  const res = await fetch(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Sent["data"];
  return { ok: res.ok, data, issues: res.ok ? [] : data.issues ?? [data.error ?? `Not saved (${res.status})`] };
}

function OwnerSelect({ value, people, onChange, id }: { value: string; people: string[]; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      <optgroup label="People">{people.map((p) => <option key={p} value={`person:${p}`}>{p}</option>)}</optgroup>
      <optgroup label="Agents">{AGENTS.map((a) => <option key={a.value} value={`agent:${a.value}`}>{a.label}</option>)}</optgroup>
    </select>
  );
}
const ownerValue = (t: Pick<Task, "owner_kind" | "owner">) => (t.owner ? `${t.owner_kind}:${t.owner}` : "");
const ownerFields = (v: string) => {
  if (!v) return { owner_kind: null, owner: null };
  const i = v.indexOf(":");
  return { owner_kind: v.slice(0, i), owner: v.slice(i + 1) };
};

// Tasks that may be a task's parent: not itself, not one of its own sub-tasks.
function parentOptions(tasks: Task[], selfId: string | null) {
  if (!selfId) return tasks;
  const below = new Set<string>([selfId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) if (t.parent_id && below.has(t.parent_id) && !below.has(t.id)) { below.add(t.id); grew = true; }
  }
  return tasks.filter((t) => !below.has(t.id));
}

function Issues({ issues }: { issues: string[] }) {
  return issues.length ? <ul className={styles.issues} role="alert">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : null;
}

// ── New task ──────────────────────────────────────────────────────────────────

function NewTask({ base, entities, tasks, people, parentId, onClose, onCreated }: {
  base: string; entities: Entity[]; tasks: Task[]; people: string[]; parentId: string | null;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const [f, setF] = useState({ title: "", owner: "", due_on: "", start_on: "", entity_id: "", parent_id: parentId ?? "", priority: "" });
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function create() {
    setBusy(true);
    const body = {
      title: f.title, ...ownerFields(f.owner),
      ...(f.due_on ? { due_on: f.due_on } : {}), ...(f.start_on ? { start_on: f.start_on } : {}),
      ...(f.entity_id ? { entity_id: f.entity_id } : {}), ...(f.parent_id ? { parent_id: f.parent_id } : {}),
      ...(f.priority ? { priority: f.priority } : {}),
    };
    if (!body.owner) { delete (body as Record<string, unknown>).owner; delete (body as Record<string, unknown>).owner_kind; }
    const r = await send(`${base}/tasks`, "POST", body);
    setBusy(false);
    if (r.ok && r.data.id) onCreated(r.data.id); else setIssues(r.issues);
  }

  return (
    <aside className={styles.panel} aria-label="New task">
      <div className={styles.panelTop}>
        <h2>{parentId ? "New sub-task" : "New task"}</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
      </div>
      <label className={styles.section}>
        <span className={styles.sectionTitle}>Title</span>
        <input className={styles.input} value={f.title} onChange={set("title")} autoFocus placeholder="What needs doing"
          onKeyDown={(e) => { if (e.key === "Enter" && f.title.trim()) create(); }} />
      </label>
      <div className={styles.grid}>
        <label className={styles.label} htmlFor="nt-owner">Owner</label>
        <OwnerSelect id="nt-owner" value={f.owner} people={people} onChange={(v) => setF({ ...f, owner: v })} />
        <label className={styles.label} htmlFor="nt-start">Start</label>
        <input id="nt-start" type="date" className={styles.input} value={f.start_on} onChange={set("start_on")} />
        <label className={styles.label} htmlFor="nt-due">Due</label>
        <input id="nt-due" type="date" className={styles.input} value={f.due_on} onChange={set("due_on")} />
        <label className={styles.label} htmlFor="nt-pri">Priority</label>
        <select id="nt-pri" className={styles.select} value={f.priority} onChange={set("priority")}>
          <option value="">None</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
        </select>
        <label className={styles.label} htmlFor="nt-ent">Company</label>
        <select id="nt-ent" className={styles.select} value={f.entity_id} onChange={set("entity_id")}>
          <option value="">All / not specific</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className={styles.label} htmlFor="nt-par">Part of</label>
        <select id="nt-par" className={styles.select} value={f.parent_id} onChange={set("parent_id")}>
          <option value="">Nothing (a top-level task)</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>
      <Issues issues={issues} />
      <div className={styles.foot}>
        <button type="button" className="btn-primary" onClick={create} disabled={busy || !f.title.trim()}>{busy ? "Adding..." : "Add task"}</button>
        <button type="button" className="btn-text" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}

// ── The task panel ────────────────────────────────────────────────────────────

function TaskPanel({ base, task, tasks, entities, bills, people, onClose, onAddSub, onDeleted }: {
  base: string; task: Task; tasks: Task[]; entities: Entity[]; bills: BillOption[]; people: string[];
  onClose: () => void; onAddSub: () => void; onDeleted: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [issues, setIssues] = useState<string[]>([]);
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const url = `${base}/tasks/${task.id}`;

  const loadEvents = useCallback(async () => {
    const r = await send(`${url}/events`, "GET");
    setEvents(r.ok ? r.data.events ?? [] : []);
  }, [url]);
  useEffect(() => { loadEvents(); }, [loadEvents, task.updated_at, task.blockers.length]);

  async function save(fields: Record<string, unknown>) {
    const r = await send(url, "PATCH", fields);
    setIssues(r.issues);
    if (r.ok) { router.refresh(); loadEvents(); }
  }
  async function act(path: string, body: unknown) {
    const r = await send(`${url}${path}`, "POST", body);
    setIssues(r.issues);
    if (r.ok) { router.refresh(); loadEvents(); }
    return r.ok;
  }

  const subs = tasks.filter((t) => t.parent_id === task.id);
  const holds = tasks.filter((t) => task.holds_up.includes(t.id));
  const open = task.blockers.filter((b) => b.open);
  const cleared = task.blockers.filter((b) => !b.open);

  return (
    <aside className={styles.panel} aria-label="Task">
      <div className={styles.panelTop}>
        <StatusPill s={task.shown_status} />
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
      </div>
      <label>
        <span style={{ position: "absolute", left: -9999 }}>Title</span>
        <input className={styles.titleInput} value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== task.title && save({ title })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </label>

      <div className={styles.grid}>
        <label className={styles.label} htmlFor="tp-status">Status</label>
        <select id="tp-status" className={styles.select} value={task.status} onChange={(e) => save({ status: e.target.value })}>
          {SETTABLE.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className={styles.label} htmlFor="tp-owner">Owner</label>
        <OwnerSelect id="tp-owner" value={ownerValue(task)} people={people} onChange={(v) => save(ownerFields(v))} />
        <label className={styles.label} htmlFor="tp-start">Start</label>
        <input id="tp-start" type="date" className={styles.input} value={task.start_on ?? ""} onChange={(e) => save({ start_on: e.target.value || null })} />
        <label className={styles.label} htmlFor="tp-due">Due</label>
        <input id="tp-due" type="date" className={styles.input} value={task.due_on ?? ""} onChange={(e) => save({ due_on: e.target.value || null })} />
        <label className={styles.label} htmlFor="tp-pri">Priority</label>
        <select id="tp-pri" className={styles.select} value={task.priority ?? ""} onChange={(e) => save({ priority: e.target.value || null })}>
          <option value="">None</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
        </select>
        <label className={styles.label} htmlFor="tp-ent">Company</label>
        <select id="tp-ent" className={styles.select} value={task.entity_id ?? ""} onChange={(e) => save({ entity_id: e.target.value || null })}>
          <option value="">All / not specific</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className={styles.label} htmlFor="tp-par">Part of</label>
        <select id="tp-par" className={styles.select} value={task.parent_id ?? ""} onChange={(e) => save({ parent_id: e.target.value || null })}>
          <option value="">Nothing (a top-level task)</option>
          {parentOptions(tasks, task.id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>

      <Issues issues={issues} />

      <section className={styles.section} aria-label="What holds it up">
        <h3 className={styles.sectionTitle}>Holding it up</h3>
        {open.length === 0 && <span className={styles.small}>Nothing. It can go ahead.</span>}
        {open.map((b) => (
          <div key={b.id} className={`${styles.blk} ${b.kind === "external" ? styles.blkWait : ""}`}>
            <div>
              <div>{blockerText(b)}</div>
              <div className={styles.small}>since {shortDate(b.since)}{b.chase_on ? ` · chase ${shortDate(b.chase_on)}` : ""}</div>
            </div>
            {b.kind === "external" && <button type="button" className="btn-secondary" onClick={() => act(`/blockers/${b.id}/resolve`, {})}>Cleared</button>}
          </div>
        ))}
        <AddBlocker tasks={tasks.filter((t) => t.id !== task.id)} bills={bills} onAdd={(body) => act("/blockers", body)} />
        {cleared.length > 0 && <span className={styles.small}>{cleared.length} earlier blocker{cleared.length === 1 ? "" : "s"} cleared (see history)</span>}
        {holds.length > 0 && <span className={styles.small}>Holds up: {holds.map((t) => t.title).join(", ")}</span>}
      </section>

      <section className={styles.section} aria-label="Sub-tasks">
        <h3 className={styles.sectionTitle}>Sub-tasks{subs.length ? ` · ${subs.filter((s) => s.status === "done").length} of ${subs.length} done` : ""}</h3>
        <div className={styles.subList}>
          {subs.map((s) => <div key={s.id} className={styles.subItem}><span>{s.title}</span><StatusPill s={s.shown_status} /></div>)}
        </div>
        <div><button type="button" className="btn-secondary" onClick={onAddSub}><Plus size={14} aria-hidden="true" />Add sub-task</button></div>
      </section>

      <label className={styles.section}>
        <span className={styles.sectionTitle}>Notes</span>
        <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (task.notes ?? "") && save({ notes: notes || null })} />
      </label>

      <section className={styles.section} aria-label="History">
        <h3 className={styles.sectionTitle}>History</h3>
        <div className={styles.addRow}>
          <label style={{ flex: "1 1 auto" }}>
            <span style={{ position: "absolute", left: -9999 }}>Add a note to the history</span>
            <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an update"
              onKeyDown={async (e) => { if (e.key === "Enter" && note.trim() && await act("/notes", { text: note })) setNote(""); }} />
          </label>
          <button type="button" className="btn-secondary" disabled={!note.trim()} onClick={async () => { if (await act("/notes", { text: note })) setNote(""); }}>Add</button>
        </div>
        <div className={styles.hist}>
          {events === null && <span className={styles.small}>Loading...</span>}
          {events?.map((e) => (
            <div key={e.id} className={styles.histItem}>{eventText(e)}<span className={styles.histWhen}>{when(e.at)} · {e.actor === "automatic" ? "automatic" : e.actor}{viaText(e)}</span></div>
          ))}
        </div>
      </section>

      <div className={styles.foot}>
        {task.status !== "done"
          ? <button type="button" className="btn-primary" onClick={() => save({ status: "done" })}>Mark done</button>
          : <button type="button" className="btn-secondary" onClick={() => save({ status: "todo" })}>Reopen</button>}
        {!confirmDelete
          ? <button type="button" className={`btn-secondary ${styles.danger}`} onClick={() => setConfirmDelete(true)}>Delete</button>
          : <button type="button" className={`btn-secondary ${styles.danger}`} onClick={async () => {
              const r = await send(url, "DELETE");
              if (r.ok) onDeleted(); else setIssues(r.issues);
            }}>{subs.length ? `Delete it and ${subs.length} sub-task${subs.length === 1 ? "" : "s"}` : "Delete it"}</button>}
      </div>
    </aside>
  );
}

function AddBlocker({ tasks, bills, onAdd }: { tasks: Task[]; bills: BillOption[]; onAdd: (body: unknown) => Promise<boolean> }) {
  const [kind, setKind] = useState<"" | "task" | "ap_item" | "external">("");
  const [pick, setPick] = useState("");
  const [party, setParty] = useState("");
  const [description, setDescription] = useState("");
  const [chase, setChase] = useState("");
  if (!kind) {
    return (
      <div className={styles.small}>
        Add a blocker:{" "}
        <button type="button" className={styles.linkBtn} onClick={() => setKind("task")}>another task</button>{" · "}
        <button type="button" className={styles.linkBtn} onClick={() => setKind("ap_item")}>a bill</button>{" · "}
        <button type="button" className={styles.linkBtn} onClick={() => setKind("external")}>someone outside</button>
      </div>
    );
  }
  const reset = () => { setKind(""); setPick(""); setParty(""); setDescription(""); setChase(""); };
  const ready = kind === "external" ? party.trim() : pick;
  async function add() {
    const body = kind === "task" ? { kind, blocking_task_id: pick } : kind === "ap_item" ? { kind, ap_item_id: pick }
      : { kind, party, description: description || undefined, chase_on: chase || undefined };
    if (await onAdd(body)) reset();
  }
  return (
    <div className={styles.section} style={{ border: "1px dashed var(--bd)", borderRadius: 10, padding: 10 }}>
      {kind === "task" && (
        <select className={styles.select} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="The task it waits for">
          <option value="">Waits for which task?</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}
      {kind === "ap_item" && (
        <select className={styles.select} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="The bill it waits for">
          <option value="">{bills.length ? "Waits for which bill?" : "No open bills in Bills"}</option>{bills.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      )}
      {kind === "external" && (
        <>
          <input className={styles.input} value={party} onChange={(e) => setParty(e.target.value)} placeholder="Who: client, supplier, HMRC..." aria-label="Who it waits on" />
          <input className={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What for (optional)" aria-label="What for" />
          <label className={styles.small}>Chase on <input type="date" className={styles.input} value={chase} onChange={(e) => setChase(e.target.value)} /></label>
        </>
      )}
      <div className={styles.addRow}>
        <button type="button" className="btn-primary" disabled={!ready} onClick={add}>Add blocker</button>
        <button type="button" className="btn-text" onClick={reset}>Cancel</button>
      </div>
    </div>
  );
}

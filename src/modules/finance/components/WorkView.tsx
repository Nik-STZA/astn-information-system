"use client";

// Work: the List view and the task panel (redesign step 3b). Every change goes
// to finance-api through /api/finance/<slug>/work/..., which records who did it
// in the task's history; the page then refreshes from the server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronRight, Plus, Search, X } from "lucide-react";
import styles from "./Work.module.css";
import {
  AGENTS, DROPPABLE, SETTABLE, STATUS_LABEL, URGENT_WHY, blockerText, boardColumns, dropRefusal, eventText, londonToday, ownerInitials,
  ownerLabel, taskTree, timelineLayout, urgency, viaText,
  type ShownStatus, type Task, type TaskEvent, type TreeRow, type UrgentWhy,
} from "@/modules/finance/lib/work";

export interface BillOption { id: string; label: string }
type View = "list" | "board" | "timeline";
type Scale = "day" | "week" | "month";
type Density = "detailed" | "compact";
type Entity = { id: string; slug: string; name: string };

const today = londonToday;

// Read and write a per-browser view setting; private windows may refuse both.
function stored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : null;
  } catch { return null; }
}
function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

function UrgentTag({ why }: { why: UrgentWhy | undefined }) {
  return why ? <span className={styles.urgent} title={URGENT_WHY[why]}>Urgent</span> : null;
}
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
  const [closing, setClosing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<View>(initialView ?? "list");
  const [links, setLinks] = useState(true);
  const [scale, setScale] = useState<Scale>("day");
  const [density, setDensity] = useState<Density>("detailed");
  const [boardIssues, setBoardIssues] = useState<string[]>([]);
  const [boardNote, setBoardNote] = useState<string | null>(null);
  // The view and zoom you last used, per browser, unless the link names a view.
  useEffect(() => {
    if (!initialView) {
      const v = stored("stza-work-view", ["list", "board", "timeline"] as const);
      if (v) setView(v);
    }
    setLinks(stored("stza-work-links", ["0", "1"] as const) !== "0");
    setScale(stored("stza-work-scale", ["day", "week", "month"] as const) ?? "day");
    setDensity(stored("stza-work-density", ["detailed", "compact"] as const) ?? "detailed");
  }, [initialView]);
  const toggleLinks = () => { setLinks(!links); store("stza-work-links", links ? "0" : "1"); };
  const pickView = (v: View) => { setView(v); store("stza-work-view", v); };
  const pickScale = (s: Scale) => { setScale(s); store("stza-work-scale", s); };
  const pickDensity = (d: Density) => { setDensity(d); store("stza-work-density", d); };
  // A card dropped on a column: the new status, recorded in the task's history.
  // Blocked and Waiting columns, and cards held by a blocker, say why the card
  // did not move instead of doing nothing.
  async function moveTo(id: string, status: ShownStatus) {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.shown_status === status) return;
    setBoardIssues([]);
    const refusal = dropRefusal(t, status);
    setBoardNote(refusal);
    if (!DROPPABLE.has(status) || t.status === status) return;
    const r = await send(`${base}/tasks/${id}`, "PATCH", { status });
    setBoardIssues(r.issues);
    if (r.ok) router.refresh(); else setBoardNote(null);
  }
  const rows = useMemo(() => taskTree(tasks, { collapsed, showDone }), [tasks, collapsed, showDone]);
  const urgent = useMemo(() => urgency(tasks, today()), [tasks]);
  const panelOpen = !!(creating || closing || selected);
  // Escape closes whichever panel is open.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setCreating(null); setClosing(false); setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);
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
        <div className={styles.headActions}>
          <button type="button" className="btn-secondary" onClick={() => { setSelected(null); setCreating(null); setClosing(true); }}>
            <CalendarCheck size={15} aria-hidden="true" />Start month-end
          </button>
          <button type="button" className="btn-primary" onClick={() => { setSelected(null); setClosing(false); setCreating({ parent_id: null }); }}>
            <Plus size={15} aria-hidden="true" />New task
          </button>
        </div>
      </div>

      <div className={styles.bar}>
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "seg-on" : undefined} aria-pressed={view === "list"} onClick={() => pickView("list")}>List</button>
          <button type="button" className={view === "board" ? "seg-on" : undefined} aria-pressed={view === "board"} onClick={() => pickView("board")}>Board</button>
          <button type="button" className={view === "timeline" ? "seg-on" : undefined} aria-pressed={view === "timeline"} onClick={() => pickView("timeline")}>Timeline</button>
        </div>
        {view === "timeline" && (
          <div className="seg" role="group" aria-label="Zoom">
            {(["day", "week", "month"] as const).map((s) => (
              <button key={s} type="button" className={scale === s ? "seg-on" : undefined} aria-pressed={scale === s} onClick={() => pickScale(s)}>
                {s === "day" ? "Days" : s === "week" ? "Weeks" : "Months"}
              </button>
            ))}
          </div>
        )}
        {view === "board" && (
          <div className="seg" role="group" aria-label="Card size">
            <button type="button" className={density === "detailed" ? "seg-on" : undefined} aria-pressed={density === "detailed"} onClick={() => pickDensity("detailed")}>Detailed</button>
            <button type="button" className={density === "compact" ? "seg-on" : undefined} aria-pressed={density === "compact"} onClick={() => pickDensity("compact")}>Compact</button>
          </div>
        )}
        {view === "timeline" && (
          <button type="button" className={styles.toggle} onClick={toggleLinks} aria-pressed={links}>
            <span className={`${styles.knob} ${links ? styles.knobOn : ""}`}><span /></span>Show links
          </button>
        )}
        <label className={styles.check}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show done</label>
      </div>

      {error && <p className={styles.issues} role="alert">{error}</p>}

      <div className={`${styles.layout} ${panelOpen ? styles.layoutOpen : ""}`}>
        <div className={styles.listPane}>
          {view === "timeline" && (
            <Timeline rows={rows} tasks={tasks} links={links} selected={selected} scale={scale}
              onOpen={(id) => { setCreating(null); setClosing(false); setSelected(id); }} onToggle={toggle} />
          )}
          {view === "board" && (
            <Board tasks={tasks} showDone={showDone} selected={selected} issues={boardIssues} note={boardNote} urgent={urgent}
              compact={density === "compact"} onDismissNote={() => setBoardNote(null)}
              onOpen={(id) => { setCreating(null); setClosing(false); setSelected(id); }} onMove={moveTo} />
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
                        onClick={() => { setCreating(null); setClosing(false); setSelected(t.id); }}>
                        <td>
                          <div className={styles.title} style={{ paddingLeft: depth * 22 }}>
                            {hasChildren ? (
                              <button type="button" className={styles.chev} aria-label={open ? "Hide sub-tasks" : "Show sub-tasks"} aria-expanded={open}
                                onClick={(e) => { e.stopPropagation(); toggle(t.id); }}>
                                <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : undefined }} aria-hidden="true" />
                              </button>
                            ) : <span className={styles.spacer} />}
                            <button type="button" className={`${styles.titleText} ${hasChildren ? styles.parentTitle : ""}`}>{t.title}</button>
                            <UrgentTag why={urgent.get(t.id)} />
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

        {closing && !creating && (
          <MonthEnd base={base} onClose={() => setClosing(false)}
            onCreated={(id) => { setClosing(false); setSelected(id); router.refresh(); }} />
        )}
        {creating && (
          <NewTask base={base} entities={entities} tasks={tasks} people={people} parentId={creating.parent_id}
            onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); setSelected(id); router.refresh(); }} />
        )}
        {!creating && !closing && task && (
          <TaskPanel key={task.id} base={base} task={task} tasks={tasks} entities={entities} bills={bills} people={people} why={urgent.get(task.id)}
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

// Zoom: how wide a day is, and how many days the range may run to.
const SCALES: Record<Scale, { day: number; minDays: number; maxDays: number }> = {
  day: { day: 36, minDays: 21, maxDays: 120 },
  week: { day: 14, minDays: 70, maxDays: 240 },
  month: { day: 5, minDays: 182, maxDays: 480 },
};
const ROW = 40;
const HEAD = 40;

function Timeline({ rows, tasks, links, selected, scale, onOpen, onToggle }: {
  rows: TreeRow[]; tasks: Task[]; links: boolean; selected: string | null; scale: Scale;
  onOpen: (id: string) => void; onToggle: (id: string) => void;
}) {
  const { day: DAY, minDays, maxDays } = SCALES[scale];
  const l = useMemo(() => timelineLayout(rows, tasks, today(), maxDays, minDays), [rows, tasks, maxDays, minDays]);
  // Open scrolled to a little before today.
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (track.current && l.todayIndex !== null) track.current.scrollLeft = Math.max(0, l.todayIndex * DAY - 72);
  }, [l.todayIndex, DAY]);
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
                const label = dayLabel(d, i, scale);
                if (label === null) return null;
                // Wider scales label one day in seven (Mondays) or in a month (the 1st).
                const w = scale === "day" ? DAY : scale === "week" ? DAY * 7 : DAY * 28;
                return (
                  <div key={d} className={`${styles.tlDay} ${scale === "day" && isWeekend(d) ? styles.tlWeekend : ""} ${scale === "day" && i === l.todayIndex ? styles.tlToday : ""}`}
                    style={{ left: i * DAY, width: w, justifyContent: scale === "day" ? "center" : "flex-start", paddingLeft: scale === "day" ? 0 : 4,
                      borderLeft: scale === "day" ? undefined : "1px solid var(--bd)" }} title={d}>{label}</div>
                );
              })}
            </div>
            {scale !== "month" && l.days.map((d, i) => (isWeekend(d)
              ? <div key={d} className={styles.tlShade} style={{ left: i * DAY, width: DAY, top: HEAD, height }} />
              : null))}
            {rows.map(({ task: t }, r) => (
              <div key={t.id} className={`${styles.tlRow} ${t.id === selected ? styles.tlSel : ""}`}
                style={{ top: HEAD + r * ROW, height: ROW, width }} onClick={() => onOpen(t.id)} />
            ))}
            {l.todayIndex !== null && <div className={styles.tlTodayLine} style={{ left: l.todayIndex * DAY + DAY / 2, top: HEAD, height }} />}
            {l.bars.map((b) => {
              const t = tasks.find((x) => x.id === b.id)!;
              const w = Math.max(6, (b.to - b.from + 1) * DAY - 6);
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


// The header label for a day at a zoom, or null for no label.
function dayLabel(d: string, i: number, scale: Scale): string | null {
  const date = new Date(`${d}T00:00:00Z`);
  const n = date.getUTCDate();
  const short = (o: Intl.DateTimeFormatOptions) => date.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  if (scale === "day") return i === 0 || n === 1 ? short({ day: "numeric", month: "short" }) : String(n);
  if (scale === "week") return date.getUTCDay() === 1 ? short({ day: "numeric", month: "short" }) : null;
  return n === 1 ? short(date.getUTCMonth() === 0 ? { month: "short", year: "numeric" } : { month: "short" }) : null;
}

// ── Board ─────────────────────────────────────────────────────────────────────

function Board({ tasks, showDone, selected, issues, note, urgent, compact, onDismissNote, onOpen, onMove }: {
  tasks: Task[]; showDone: boolean; selected: string | null; issues: string[]; note: string | null;
  urgent: Map<string, UrgentWhy>; compact: boolean; onDismissNote: () => void;
  onOpen: (id: string) => void; onMove: (id: string, status: ShownStatus) => void;
}) {
  const cols = boardColumns(tasks, { showDone, today: today() });
  const [over, setOver] = useState<ShownStatus | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <Issues issues={issues} />
      {note && (
        <p className={styles.notice} role="status">
          <span>{note}</span>
          <button type="button" className={styles.iconBtnSm} onClick={onDismissNote} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
        </p>
      )}
      <div className={`${styles.board} ${compact ? styles.boardCompact : ""}`} aria-label="Tasks as a board">
        {cols.map((c) => {
          const droppable = DROPPABLE.has(c.status);
          return (
            // Every column takes the drop, so Blocked and Waiting can say why
            // the card stays where it is.
            <section key={c.status} aria-label={STATUS_LABEL[c.status]}
              className={`${styles.col} ${over === c.status ? (droppable ? styles.colOver : styles.colNo) : ""} ${dragging && !droppable ? styles.colDim : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = droppable ? "move" : "none"; setOver(c.status); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); }}
              onDrop={(e) => {
                e.preventDefault(); setOver(null); setDragging(false);
                const id = e.dataTransfer.getData("text/plain");
                if (id) onMove(id, c.status);
              }}>
              <div className={styles.colHead}>
                <span>{STATUS_LABEL[c.status]}</span><span className={styles.meta}>{c.tasks.length}</span>
              </div>
              {!droppable && (c.tasks.length === 0 || dragging) && <div className={styles.colHint}>Set by blockers</div>}
              {c.tasks.map((t) => {
                const openBlocks = t.blockers.filter((b) => b.open);
                const late = t.due_on && t.status !== "done" && t.due_on < today();
                // A div, not a button: Firefox will not drag a button.
                return (
                  <div key={t.id} role="button" tabIndex={0} draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
                    onDragEnd={() => { setDragging(false); setOver(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(t.id); } }}
                    className={`${styles.tcard} ${t.id === selected ? styles.tcardSel : ""}`} onClick={() => onOpen(t.id)}
                    title={compact ? [t.title, t.parentTitle, openBlocks[0] ? blockerText(openBlocks[0]) : null].filter(Boolean).join(" · ") : undefined}>
                    <span className={styles.tcardTitle}>{t.title}</span>
                    {!compact && (t.parentTitle || t.entity_name) && <span className={styles.meta}>{[t.parentTitle, t.entity_name].filter(Boolean).join(" · ")}</span>}
                    {!compact && openBlocks[0] && <span className={styles.blocker}>{blockerText(openBlocks[0])}{openBlocks.length > 1 ? ` +${openBlocks.length - 1} more` : ""}</span>}
                    <span className={styles.tcardFoot}>
                      <span className={styles.ava} title={ownerLabel(t)}>{ownerInitials(t)}</span>
                      <span className={styles.tcardTags}>
                        <UrgentTag why={urgent.get(t.id)} />
                        {t.due_on && <span className={late ? styles.overdue : styles.meta}>{shortDate(t.due_on)}</span>}
                      </span>
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <p className={styles.small} style={{ marginTop: 8 }}>Drag a card to To do, In progress, Needs review or Done. Blocked and Waiting follow the task&apos;s blockers.</p>
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

// Picks a task by typing part of its title. The list sits in the panel, under
// the field, in list order with sub-tasks indented under their parent, so a
// long title wraps instead of stretching a dropdown across the screen. Done
// tasks are left out unless already chosen.
function TaskPicker({ id, tasks, value, onChange, none, placeholder }: {
  id?: string; tasks: Task[]; value: string; onChange: (id: string) => void;
  none?: string; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const chosen = tasks.find((t) => t.id === value) ?? null;
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const options = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return taskTree(tasks, { showDone: true })
      .filter(({ task: t }) => t.status !== "done" || t.id === value)
      .filter(({ task: t }) => {
        const text = `${t.title} ${t.parent_id ? byId.get(t.parent_id)?.title ?? "" : ""}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
  }, [tasks, q, value, byId]);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  // The choices: "none" first when offered, then the matching tasks.
  const choices: Array<{ id: string; row: TreeRow | null }> = [
    ...(none && !q ? [{ id: "", row: null }] : []),
    ...options.map((r) => ({ id: r.task.id, row: r })),
  ];

  if (!open) {
    return (
      <button id={id} type="button" className={`${styles.select} ${styles.pickBtn}`} onClick={() => { setOpen(true); setAt(0); }}>
        <span className={chosen ? undefined : styles.meta}>{chosen ? chosen.title : none ?? placeholder}</span>
        {chosen?.parent_id && <span className={styles.meta}>in {byId.get(chosen.parent_id)?.title}</span>}
      </button>
    );
  }
  return (
    <div className={styles.picker}>
      <div className={styles.pickSearch}>
        <Search size={14} aria-hidden="true" />
        <input id={id} className={styles.pickInput} autoFocus value={q} placeholder={placeholder} aria-label={placeholder}
          role="combobox" aria-expanded="true" aria-controls={`${id ?? "pick"}-list`}
          onChange={(e) => { setQ(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(at + 1, choices.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(at - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); if (choices[at]) pick(choices[at].id); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(""); }
          }} />
        <button type="button" className={styles.iconBtnSm} onClick={() => { setOpen(false); setQ(""); }} aria-label="Cancel"><X size={14} aria-hidden="true" /></button>
      </div>
      <div id={`${id ?? "pick"}-list`} role="listbox" className={styles.pickList}>
        {choices.length === 0 && <div className={styles.pickEmpty}>No task matches.</div>}
        {choices.map((c, i) => (
          <button key={c.id || "none"} type="button" role="option" aria-selected={c.id === value}
            className={`${styles.pickItem} ${i === at ? styles.pickAt : ""} ${c.id === value ? styles.pickOn : ""}`}
            style={{ paddingLeft: 10 + (q || !c.row ? 0 : c.row.depth * 14) }}
            onMouseEnter={() => setAt(i)} onClick={() => pick(c.id)}>
            {c.row ? (
              <>
                <span className={c.row.hasChildren ? styles.parentTitle : undefined}>{c.row.task.title}</span>
                {q && c.row.task.parent_id && <span className={styles.meta}>in {byId.get(c.row.task.parent_id)?.title}</span>}
              </>
            ) : <span className={styles.meta}>{none}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Issues({ issues }: { issues: string[] }) {
  return issues.length ? <ul className={styles.issues} role="alert">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : null;
}

// ── Month-end ────────────────────────────────────────────────────────────────

interface ClosePreview { label: string; tasks: Array<{ title: string; owner: string; due_on: string; parent: string | null; waits_for: string[] }> }

// The close for a month from the template: pick the month, see every step
// with its owner, due date and what it waits for, then create it.
function MonthEnd({ base, onClose, onCreated }: { base: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [period, setPeriod] = useState(lastMonth());
  const [vat, setVat] = useState(false);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    const r = await send(`${base}/tasks/month-end`, "POST", { period, vat, dry_run: dryRun });
    setBusy(false);
    setIssues(r.issues);
    if (!r.ok) { setPreview(null); return; }
    const data = r.data as unknown as ClosePreview & { task_id?: string };
    if (dryRun) setPreview(data); else if (data.task_id) onCreated(data.task_id);
  }
  useEffect(() => { setPreview(null); setIssues([]); }, [period, vat]);

  return (
    <aside className={styles.panel} aria-label="Start month-end">
      <div className={styles.panelTop}>
        <h2>Start month-end</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
      </div>
      <p className={styles.small}>Adds the close for a month as tasks: who does each step, when it is due (working days after the month end) and what it waits for. You own the close and the sign-off.</p>
      <div className={styles.grid}>
        <label className={styles.label} htmlFor="me-month">Month</label>
        <input id="me-month" type="month" className={styles.input} value={period} onChange={(e) => setPeriod(e.target.value)} />
        <span className={styles.label}>VAT</span>
        <label className={styles.check}><input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} />Include a VAT return</label>
      </div>
      {preview && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{preview.label}: {preview.tasks.length} tasks</h3>
          <div className={styles.subList}>
            {preview.tasks.slice(1).map((t, i) => (
              <div key={i} className={styles.planItem} style={t.parent && t.parent !== "close" ? { marginLeft: 16 } : undefined}>
                <div>{t.title}</div>
                <div className={styles.small}>
                  {AGENTS.find((a) => a.value === t.owner)?.label ?? t.owner} · due {fmtDay(t.due_on)}
                  {t.waits_for.length > 0 && <> · after {t.waits_for.join(", ")}</>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <Issues issues={issues} />
      <div className={styles.foot}>
        {preview
          ? <button type="button" className="btn-primary" disabled={busy} onClick={() => run(false)}>{busy ? "Adding..." : `Add the ${preview.label} close`}</button>
          : <button type="button" className="btn-primary" disabled={busy || !period} onClick={() => run(true)}>{busy ? "Checking..." : "Preview"}</button>}
        <button type="button" className="btn-text" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}

// "2026-09" when it is October 2026.
function lastMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

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
        <span className={styles.label}>Urgent</span>
        <label className={styles.check}>
          <input type="checkbox" checked={f.priority === "P1"} onChange={(e) => setF({ ...f, priority: e.target.checked ? "P1" : "" })} />Flag as urgent
        </label>
        <label className={styles.label} htmlFor="nt-ent">Company</label>
        <select id="nt-ent" className={styles.select} value={f.entity_id} onChange={set("entity_id")}>
          <option value="">All / not specific</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className={styles.label} htmlFor="nt-par">Part of</label>
        <TaskPicker id="nt-par" tasks={tasks} value={f.parent_id} onChange={(v) => setF({ ...f, parent_id: v })}
          none="Nothing (a top-level task)" placeholder="Search tasks" />
      </div>
      <p className={styles.small}>Tasks also turn urgent by themselves when overdue, due by the next working day, or holding up a flagged or overdue task.</p>
      <Issues issues={issues} />
      <div className={styles.foot}>
        <button type="button" className="btn-primary" onClick={create} disabled={busy || !f.title.trim()}>{busy ? "Adding..." : "Add task"}</button>
        <button type="button" className="btn-text" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}

// ── The task panel ────────────────────────────────────────────────────────────

function TaskPanel({ base, task, tasks, entities, bills, people, why, onClose, onAddSub, onDeleted }: {
  base: string; task: Task; tasks: Task[]; entities: Entity[]; bills: BillOption[]; people: string[]; why: UrgentWhy | undefined;
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
        <span className={styles.tcardTags}><StatusPill s={task.shown_status} /><UrgentTag why={why} /></span>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
      </div>
      <label>
        <span style={{ position: "absolute", left: -9999 }}>Title</span>
        {/* Wraps, so a long title can be read whole; Enter still saves. */}
        <textarea className={styles.titleInput} value={title} rows={Math.min(6, Math.max(1, Math.ceil(title.length / 34)))}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onBlur={() => title.trim() !== task.title && save({ title })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
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
        <span className={styles.label}>Urgent</span>
        <div>
          <label className={styles.check}>
            <input type="checkbox" checked={task.priority === "P1"} onChange={(e) => save({ priority: e.target.checked ? "P1" : null })} />Flag as urgent
          </label>
          {why && why !== "flagged" && <div className={styles.small}>Urgent anyway: {URGENT_WHY[why].toLowerCase()}.</div>}
        </div>
        <label className={styles.label} htmlFor="tp-ent">Company</label>
        <select id="tp-ent" className={styles.select} value={task.entity_id ?? ""} onChange={(e) => save({ entity_id: e.target.value || null })}>
          <option value="">All / not specific</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className={styles.label} htmlFor="tp-par">Part of</label>
        <TaskPicker id="tp-par" tasks={parentOptions(tasks, task.id)} value={task.parent_id ?? ""} onChange={(v) => save({ parent_id: v || null })}
          none="Nothing (a top-level task)" placeholder="Search tasks" />
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
      <div><button type="button" className="btn-secondary" onClick={() => setKind("task")}><Plus size={14} aria-hidden="true" />Add blocker</button></div>
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
    <div className={`${styles.section} ${styles.addBox}`}>
      <span className={styles.small}>It waits for</span>
      <div className="seg" role="group" aria-label="What it waits for">
        {([["task", "Another task"], ["ap_item", "A bill"], ["external", "Someone outside"]] as const).map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? "seg-on" : undefined} aria-pressed={kind === k} onClick={() => { setKind(k); setPick(""); }}>{label}</button>
        ))}
      </div>
      {kind === "task" && (
        <TaskPicker tasks={tasks} value={pick} onChange={setPick} placeholder="Which task? Type to search" />
      )}
      {kind === "ap_item" && (
        <select className={styles.select} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="The bill it waits for">
          <option value="">{bills.length ? "Which bill?" : "No open bills in Bills"}</option>{bills.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
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

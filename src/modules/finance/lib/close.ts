// Close: one month's close for a client on one page. It reads what is already
// there, so it cannot disagree with the screens that own each piece: the
// month-end tasks in Work (made by the template, finance-api lib/month-end.js),
// the month's reconciliations, the month's journals and the Review inbox.
// Nothing here decides a state. A step is done when its task is done in Work;
// a rec is signed off on its reconciliation; a journal is approved on Journals.
//
// Pure, so it is tested without the API. The page fetches and hands it here.

import { ownerLabel, STATUS_LABEL, type ShownStatus, type Task } from "./work";
import { STATUS_LABEL as REC_STATUS, type RecList, type RecRow } from "./recs";
import type { JournalList } from "./journals";

export type Tone = "neutral" | "blue" | "green" | "amber" | "red";

export interface Evidence {
  text: string;
  href: string;
  tone: Tone;
}

export interface CloseStep {
  key: string | null;
  task: Task;
  title: string;
  status: ShownStatus;
  statusLabel: string;
  tone: Tone;
  owner: string;
  due_on: string | null;
  late: boolean;
  // Per-company sub-tasks, when the step has them.
  companies: { done: number; total: number } | null;
  // Open tasks this step waits for, by title.
  waitsFor: string[];
  evidence: Evidence | null;
  href: string;
}

export interface CloseView {
  period: string;
  started: boolean;
  closeTask: Task | null;
  steps: CloseStep[];
  signOff: CloseStep | null;
  done: number;
  total: number;
  recs: { total: number; signed_off: number; not_tying: number; recheck: number; composed: boolean } | null;
  journalsWaiting: number | null;
  reviewForYou: number | null;
  billsOpen: number | null;
  priorOpen: { label: string; href: string } | null;
  // What is left before the CFO can sign off, in words, each with where to act.
  left: Evidence[];
  readyToSignOff: boolean;
  signedOff: boolean;
}

export const TONE: Record<ShownStatus, Tone> = {
  todo: "neutral",
  in_progress: "blue",
  review: "amber",
  waiting: "amber",
  blocked: "red",
  done: "green",
};

// Which reconciliations speak for a step, by account name. A step with no
// matching rec simply shows none; the balance sheet step reads them all.
const REC_MATCH: Record<string, RegExp> = {
  bank: /\b(bank|card|current account|savings|deposit account|cash)\b/i,
  revenue: /\b(deferred (revenue|income)|accrued income|revenue)\b/i,
  payroll: /\b(paye|payroll|wages|salar|pension|national insurance|\bni\b)/i,
  accruals: /\b(prepay|accru)/i,
  "fixed-assets": /\b(fixed asset|depreciation|intangible|tangible|plant|equipment|computer|furniture|vehicle|amortis)/i,
  intercompany: /\b(intercompany|inter-company|due (to|from)|loan to|loan from)\b/i,
  vat: /\bvat\b/i,
};

const enc = encodeURIComponent;

// A rec "does not tie" only once someone has worked on it: one not started has
// no support yet, so it is not started, not failing.
const failsToTie = (r: RecRow) => r.status !== "signed_off" && r.status !== "not_started" && !r.ties;

// The month-end template's step key from a task's source_ref, or null.
export function stepKey(sourceRef: string | null | undefined, period: string): string | null {
  const prefix = `month-end:${period}:`;
  if (!sourceRef || !sourceRef.startsWith(prefix)) return null;
  return sourceRef.slice(prefix.length).split(":")[0] || null;
}

// "1 of 3 signed off", in a person's words.
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function recsEvidence(rows: RecRow[], href: string): Evidence | null {
  if (!rows.length) return null;
  if (rows.length === 1) {
    const r = rows[0];
    const tie = failsToTie(r) ? ", does not tie yet" : "";
    return {
      text: `${r.account_name}: ${REC_STATUS[r.status]}${tie}${r.recheck_reason ? ", needs a re-check" : ""}`,
      href, tone: r.recheck_reason || failsToTie(r) ? "red" : r.status === "signed_off" ? "green" : "amber",
    };
  }
  const signed = rows.filter((r) => r.status === "signed_off").length;
  const notTying = rows.filter(failsToTie).length;
  const recheck = rows.filter((r) => r.recheck_reason).length;
  const parts = [`${signed} of ${plural(rows.length, "rec")} signed off`];
  if (notTying) parts.push(`${notTying} not tying`);
  if (recheck) parts.push(`${recheck} to re-check`);
  return { text: parts.join(", "), href, tone: recheck || notTying ? "red" : signed === rows.length ? "green" : "amber" };
}

export function closeView({ period, tasks, recs, journals, review, slug, today }: {
  period: string;
  tasks: Task[];
  recs: RecList | null;
  journals: JournalList | null;
  review: { for_you: number; by_kind: Partial<Record<string, number>> } | null;
  slug: string;
  today: string; // YYYY-MM-DD
}): CloseView {
  const base = `/finance/clients/${enc(slug)}`;
  const recsHref = `${base}/reconciliations?period=${enc(period)}`;
  const journalsHref = `${base}/journals?period=${enc(period)}`;
  const closeTask = tasks.find((t) => t.source_ref === `month-end:${period}`) ?? null;

  const recRows = recs && !recs.migration_missing ? recs.recs : [];
  const recSummary = recs && !recs.migration_missing ? {
    total: recRows.length,
    signed_off: recRows.filter((r) => r.status === "signed_off").length,
    not_tying: recRows.filter(failsToTie).length,
    recheck: recRows.filter((r) => r.recheck_reason).length,
    composed: Boolean(recs.composed_at),
  } : null;
  const journalsWaiting = journals && !journals.migration_missing
    ? journals.journals.filter((j) => j.state === "proposed").length
    : null;
  const billsOpen = review ? review.by_kind.bill ?? 0 : null;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = (id: string) => tasks.filter((t) => t.parent_id === id).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  const evidenceFor = (key: string | null): Evidence | null => {
    if (key === "bs-recs") {
      if (!recSummary) return null;
      if (!recSummary.total) return { text: recSummary.composed ? "No balance sheet accounts listed for the month" : "The month's list is not made yet. Open Reconciliations to read the trial balance", href: recsHref, tone: "amber" };
      return recsEvidence(recRows, recsHref);
    }
    if (key === "ap") {
      if (billsOpen === null) return null;
      return billsOpen
        ? { text: `${plural(billsOpen, "bill")} still open in Bills`, href: `${base}/bills`, tone: "amber" }
        : { text: "No bills open in Bills", href: `${base}/bills`, tone: "green" };
    }
    const match = key ? REC_MATCH[key] : undefined;
    if (match) return recsEvidence(recRows.filter((r) => match.test(r.account_name)), recsHref);
    return null;
  };

  const step = (t: Task): CloseStep => {
    const key = stepKey(t.source_ref, period);
    const subs = kids(t.id);
    const waitsFor = t.blockers
      .filter((b) => b.open && b.kind === "task" && b.task)
      .map((b) => byId.get(b.task!.id)?.title ?? b.task!.title);
    return {
      key,
      task: t,
      title: t.title,
      status: t.shown_status,
      statusLabel: STATUS_LABEL[t.shown_status],
      tone: TONE[t.shown_status],
      owner: ownerLabel(t),
      due_on: t.due_on,
      late: t.status !== "done" && Boolean(t.due_on) && (t.due_on as string) < today,
      companies: subs.length ? { done: subs.filter((s) => s.status === "done").length, total: subs.length } : null,
      waitsFor,
      evidence: evidenceFor(key),
      href: `${base}/work?task=${enc(t.id)}`,
    };
  };

  const all = closeTask ? kids(closeTask.id).map(step) : [];
  const signOff = all.find((s) => s.key === "sign-off") ?? null;
  const steps = all.filter((s) => s !== signOff);
  const done = steps.filter((s) => s.task.status === "done").length;

  const priorOpen = recs?.prior?.open
    ? { label: recs.prior.label, href: `${base}/close?period=${enc(recs.prior.period)}` }
    : null;

  // What still stands between the month and sign-off.
  const left: Evidence[] = [];
  const open = steps.filter((s) => s.task.status !== "done");
  if (open.length) {
    left.push({
      text: `${plural(open.length, "step")} not done: ${open.slice(0, 4).map((s) => s.title).join(", ")}${open.length > 4 ? ` and ${open.length - 4} more` : ""}`,
      href: `${base}/work?task=${enc(open[0].task.id)}`, tone: "amber",
    });
  }
  if (recSummary) {
    if (!recSummary.total) left.push({ text: "No reconciliations for the month yet", href: recsHref, tone: "amber" });
    const unsigned = recSummary.total - recSummary.signed_off;
    if (unsigned) left.push({ text: `${plural(unsigned, "reconciliation")} not signed off`, href: recsHref, tone: "amber" });
    if (recSummary.recheck) left.push({ text: `${plural(recSummary.recheck, "reconciliation")} to re-check: a figure moved after it was prepared`, href: recsHref, tone: "red" });
  }
  if (journalsWaiting) left.push({ text: `${plural(journalsWaiting, "journal")} waiting for approval`, href: journalsHref, tone: "amber" });
  if (priorOpen) left.push({ text: `${priorOpen.label} is still open`, href: priorOpen.href, tone: "red" });

  const signedOff = Boolean(signOff && signOff.task.status === "done");
  return {
    period,
    started: Boolean(closeTask),
    closeTask,
    steps,
    signOff,
    done,
    total: steps.length,
    recs: recSummary,
    journalsWaiting,
    reviewForYou: review ? review.for_you : null,
    billsOpen,
    priorOpen,
    left,
    readyToSignOff: Boolean(signOff) && !signedOff && left.length === 0,
    signedOff,
  };
}

// "Due 6 Nov", "Due yesterday"... kept short for a phone.
export function dueText(due: string | null, today: string): string {
  if (!due) return "No due date";
  const day = new Date(`${due}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (due === today) return "Due today";
  return due < today ? `Was due ${day}` : `Due ${day}`;
}

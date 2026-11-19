// Close: one month's close for a client. It reads the month-end tasks in Work,
// the month's reconciliations and journals, and the Review inbox, and shows
// them together: each step, what it waits for, its evidence, and what is left
// before sign-off. A source that cannot be read is named, and the rest shows.

import PageHeader from "@/shared/ui/PageHeader";
import CloseView from "@/modules/finance/components/CloseView";
import { closeView } from "@/modules/finance/lib/close";
import { fetchVat } from "@/modules/finance/lib/vat";
import { fetchAccruals } from "@/modules/finance/lib/accruals";
import { defaultPeriod, fetchRecs, isPeriod } from "@/modules/finance/lib/recs";
import { fetchJournals } from "@/modules/finance/lib/journals";
import { fetchReview } from "@/modules/finance/lib/review";
import { fetchTasks, type Task } from "@/modules/finance/lib/work";
import { carriedAt, fetchOutstandingDocs, monthLabel, pounds } from "@/modules/finance/lib/outstanding-docs";
import { fetchPeople, fetchSchedule } from "@/modules/finance/lib/asset-schedule";
import { accountKey, fetchThreads, meFrom, subjectHref, type ThreadEntry } from "@/modules/finance/lib/threads";
import { Entry } from "@/modules/finance/components/Threads";
import Link from "next/link";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ClosePage({ params: paramsPromise, searchParams: searchParamsPromise, actorEmail }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string }>;
  actorEmail: string | null;
}) {
  const { slug } = await paramsPromise;
  const asked = (await searchParamsPromise)?.period;
  const period = isPeriod(asked) ? asked as string : defaultPeriod();

  const errors: string[] = [];
  const [tasks, recs, journals, review, docs, open, people, vat, accruals] = await Promise.all([
    fetchTasks(slug).catch((e: unknown) => e instanceof Error ? e : new Error("the tasks could not be read")),
    fetchRecs(slug, period).catch(() => null),
    fetchJournals(slug, period).catch(() => null),
    fetchReview(slug, actorEmail).catch(() => null),
    fetchOutstandingDocs(slug).catch(() => null),
    fetchThreads(slug, { period, open: true }).catch(() => null),
    fetchPeople().catch(() => null),
    fetchVat(slug).catch(() => null),
    fetchAccruals(slug, period).catch(() => null),
  ]);

  if (tasks instanceof Error) {
    return (
      <div>
        <PageHeader title="Close" sub="One month's close: each step, what it waits for, and what is left before sign-off." />
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the close</div>
          {tasks.message}
        </div>
      </div>
    );
  }
  if (!recs || !recs.ok) errors.push(`Reconciliations could not be read${recs && !recs.ok ? `: ${recs.error}` : ""}, so the close does not show them.`);
  if (!journals || !journals.ok) errors.push(`Journals could not be read${journals && !journals.ok ? `: ${journals.error}` : ""}, so the close does not show them.`);
  if (!review || !review.ok) errors.push("Review could not be read, so open bills and what waits on you are not shown.");

  const today = new Date().toISOString().slice(0, 10);
  // Outstanding documents are carried, never a step: shown under the steps.
  const carried = docs?.ok && !docs.data.migration_missing ? carriedAt(docs.data.items, period) : null;
  const view = closeView({
    period,
    tasks: tasks as Task[],
    recs: recs?.ok ? recs.data : null,
    journals: journals?.ok ? journals.data : null,
    review: review?.ok ? { for_you: review.data.counts.for_you, by_kind: review.data.counts.by_kind } : null,
    slug,
    today,
    vat: vat?.ok ? vat.data : null,
    accruals: accruals?.ok ? accruals.data : null,
  });

  // What waits on a decision in the month's threads, answered here in place.
  // A thread that cannot be read is named; migration 050 not applied is quiet.
  const waiting = open?.ok ? open.data.threads : [];
  if (open && !open.ok && open.status !== 503) errors.push(`Threads could not be read: ${open.error}, so what waits on your decision is not shown.`);
  const me = meFrom(actorEmail, people?.ok ? people.data.people : null);
  const entities = new Map((recs?.ok ? recs.data.entities : []).map((e) => [e.id, e.name]));
  // An account's thread opens the month's reconciliation that covers it.
  const recByAccount = new Map<string, string>();
  for (const r of recs?.ok ? recs.data.recs : []) {
    for (const b of r.by_entity ?? []) for (const c of r.codes) { const k = accountKey(b.entity_id, c); if (k && !recByAccount.has(k)) recByAccount.set(k, r.id); }
  }
  const recName = new Map((recs?.ok ? recs.data.recs : []).map((r) => [r.id, r.account_name]));
  // Assets are named from the month's register, read only when one waits.
  const assetNames = new Map<string, string>();
  if (waiting.some((e) => e.subject_kind === "asset")) {
    const sch = await fetchSchedule(slug, period).catch(() => null);
    for (const g of sch?.ok ? sch.data.groupings : []) for (const a of g.assets) assetNames.set(a.id, `${a.asset_no} ${a.name}`);
  }
  const label = (e: ThreadEntry) => {
    if (e.subject_kind === "account") { const [id, code] = e.subject_key.split(":"); return `${entities.get(id) ?? "Account"} ${code}`; }
    if (e.subject_kind === "reconciliation") return recName.get(e.subject_key) ?? "A reconciliation";
    if (e.subject_kind === "asset") return assetNames.get(e.subject_key) ?? "An asset";
    if (e.subject_kind === "register_month") return "Asset register";
    return "A cost line";
  };

  return (
    <div>
      <PageHeader title="Close" sub="One month's close: each step, what it waits for, and what is left before sign-off. Open a step to work on it." />
      {waiting.length > 0 && (
        <section className={`${styles.card} ${styles.pad} ${styles.wide}`} style={{ marginBottom: 16 }} aria-label="Waiting on your decision">
          <div className={styles.rowHead}>
            <span className={styles.rowTitle}>Waiting on your decision</span>
            <span className={`${styles.status} ${styles["s-amber"]}`}><span className={styles.dot} />{waiting.length} open</span>
          </div>
          <div className={styles.small}>Questions and holds from the month&apos;s threads. Reply or decide here; the thread is the same on the reconciliation, the Fixed assets page and for the agents.</div>
          {waiting.map((e) => <Entry key={e.id} slug={slug} e={e} me={me} subject={label(e)} subjectHref={subjectHref(slug, e, recByAccount)} />)}
        </section>
      )}
      <CloseView slug={slug} view={view} today={today} errors={errors} />
      {carried && carried.count > 0 && (
        <div className={`${styles.card} ${styles.pad} ${styles.wide}`} style={{ marginTop: 16 }}>
          <div className={styles.rowHead}>
            <span className={styles.rowTitle}>Outstanding documents carried</span>
            <span className={`${styles.status} ${styles["s-neutral"]}`}><span className={styles.dot} />Does not block sign-off</span>
          </div>
          <div className={styles.small} style={{ marginTop: 6 }}>
            {carried.count.toLocaleString("en-GB")} transaction{carried.count === 1 ? "" : "s"} to the end of {monthLabel(period)} without their document, {pounds(carried.value)}
            {carried.unknown_gbp ? ` plus ${carried.unknown_gbp} in another currency` : ""}.
            {carried.vat_flagged ? ` VAT not recoverable on ${carried.vat_flagged}, up to ${pounds(carried.vat_at_risk_max)}.` : ""}
            {carried.oldest ? ` Oldest from ${monthLabel(carried.oldest.slice(0, 7))}.` : ""}{" "}
            <Link prefetch={false} href={`/finance/clients/${encodeURIComponent(slug)}/outstanding-documents`}>Open the register</Link>
          </div>
        </div>
      )}
    </div>
  );
}

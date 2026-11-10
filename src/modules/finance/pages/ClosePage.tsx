// Close: one month's close for a client. It reads the month-end tasks in Work,
// the month's reconciliations and journals, and the Review inbox, and shows
// them together: each step, what it waits for, its evidence, and what is left
// before sign-off. A source that cannot be read is named, and the rest shows.

import PageHeader from "@/shared/ui/PageHeader";
import CloseView from "@/modules/finance/components/CloseView";
import { closeView } from "@/modules/finance/lib/close";
import { defaultPeriod, fetchRecs, isPeriod } from "@/modules/finance/lib/recs";
import { fetchJournals } from "@/modules/finance/lib/journals";
import { fetchReview } from "@/modules/finance/lib/review";
import { fetchTasks, type Task } from "@/modules/finance/lib/work";
import { carriedAt, fetchOutstandingDocs, monthLabel, pounds } from "@/modules/finance/lib/outstanding-docs";
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
  const [tasks, recs, journals, review, docs] = await Promise.all([
    fetchTasks(slug).catch((e: unknown) => e instanceof Error ? e : new Error("the tasks could not be read")),
    fetchRecs(slug, period).catch(() => null),
    fetchJournals(slug, period).catch(() => null),
    fetchReview(slug, actorEmail).catch(() => null),
    fetchOutstandingDocs(slug).catch(() => null),
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
  });

  return (
    <div>
      <PageHeader title="Close" sub="One month's close: each step, what it waits for, and what is left before sign-off. Open a step to work on it." />
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

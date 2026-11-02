// Review: everything waiting on a person for one client, from Bills,
// Reconciliations, Journals and the Approvals folders, in one list. It replaces
// Approvals in the client's menu. Work stays the task list; this is what agents
// and people have produced that someone now has to look at.
//
// The signed-in person comes from the route binding, so the module does not
// read the identity itself, and finance-api marks what is on their own queue
// from their engagement role, the same lookup the recs and journals use.

import { Suspense } from "react";
import PageHeader from "@/shared/ui/PageHeader";
import ReviewInbox from "@/modules/finance/components/ReviewInbox";
import { fetchReview } from "@/modules/finance/lib/review";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params: paramsPromise, actorEmail }: {
  params: Promise<{ slug: string }>;
  actorEmail: string | null;
}) {
  const { slug } = await paramsPromise;
  const r = await fetchReview(slug, actorEmail);

  return (
    <div>
      <PageHeader title="Review" sub="Everything waiting on a person: bills, reconciliations, journals, and the Approvals folders. Open a row to act on it in its own screen." />
      {!r.ok ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load what is waiting for review</div>
          {/Cannot GET/i.test(r.error) ? "The review endpoint is not deployed on finance-api yet." : r.error}
        </div>
      ) : (
        <Suspense fallback={null}>
          {/* The time is fixed on the server so the ages read the same after hydration. */}
          <ReviewInbox slug={slug} data={r.data} now={Date.now()} />
        </Suspense>
      )}
    </div>
  );
}

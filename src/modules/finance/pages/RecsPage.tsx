// Reconciliations for one client and one month, at group level: every balance
// sheet account, who has it, and whether it ties.

import PageHeader from "@/shared/ui/PageHeader";
import RecsList from "@/modules/finance/components/RecsList";
import { defaultPeriod, fetchRecs, isPeriod } from "@/modules/finance/lib/recs";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function RecsPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string }>;
}) {
  const { slug } = await paramsPromise;
  const asked = (await searchParamsPromise)?.period;
  const period = isPeriod(asked) ? asked as string : defaultPeriod();
  const r = await fetchRecs(slug, period);

  return (
    <div>
      <PageHeader title="Reconciliations" sub="Every balance sheet account for the month across the group, who has it, and whether it ties." />
      {!r.ok ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the reconciliations</div>
          {/Cannot GET/i.test(r.error) ? "The reconciliation endpoints are not deployed on finance-api yet." : r.error}
        </div>
      ) : (
        <RecsList slug={slug} data={r.data} />
      )}
    </div>
  );
}

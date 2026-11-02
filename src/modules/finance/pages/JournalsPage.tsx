// Journals for one client and one month: every journal proposed, by a person,
// an agent, or on a reconciliation, and what became of it in Xero.

import PageHeader from "@/shared/ui/PageHeader";
import JournalsView from "@/modules/finance/components/JournalsView";
import { fetchJournals } from "@/modules/finance/lib/journals";
import { defaultPeriod, isPeriod } from "@/modules/finance/lib/recs";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function JournalsPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string }>;
}) {
  const { slug } = await paramsPromise;
  const asked = (await searchParamsPromise)?.period;
  const period = isPeriod(asked) ? asked as string : defaultPeriod();
  const r = await fetchJournals(slug, period);

  return (
    <div>
      <PageHeader title="Journals" sub="Every journal proposed for the month, by a person, an agent, or on a reconciliation. The CFO approves here, and the journal goes to Xero as a draft." />
      {!r.ok ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the journals</div>
          {/Cannot GET/i.test(r.error) ? "The journal endpoints are not deployed on finance-api yet." : r.error}
        </div>
      ) : (
        <JournalsView slug={slug} data={r.data} />
      )}
    </div>
  );
}

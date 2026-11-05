// Changes to Xero other than journals, proposed by an agent or a person, for
// the CFO to approve. Fixed assets first.

import PageHeader from "@/shared/ui/PageHeader";
import XeroChangesView from "@/modules/finance/components/XeroChangesView";
import { fetchXeroChanges } from "@/modules/finance/lib/xero-changes";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function XeroChangesPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ item?: string; all?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const r = await fetchXeroChanges(slug, q.all === "1");

  return (
    <div>
      <PageHeader title="Xero changes" sub="Changes to Xero proposed by the agents or a person, other than journals. The CFO approves here, and finance-api makes the change in Xero." />
      {!r.ok ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the Xero changes</div>
          {/Cannot GET/i.test(r.error) ? "The Xero changes endpoints are not deployed on finance-api yet." : r.error}
        </div>
      ) : (
        <XeroChangesView slug={slug} data={r.data} focus={q.item ?? null} all={q.all === "1"} />
      )}
    </div>
  );
}

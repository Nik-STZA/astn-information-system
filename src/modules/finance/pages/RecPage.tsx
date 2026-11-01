// One reconciliation: each company's ledger against its support, the schedule,
// the checks, the proposed journal, and the steps from preparer to sign-off.

import RecView from "@/modules/finance/components/RecView";
import { fetchRec } from "@/modules/finance/lib/recs";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function RecPage({ params: paramsPromise }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await paramsPromise;
  const r = await fetchRec(slug, id);
  if (!r.ok) {
    return (
      <div className={styles.error} role="alert">
        <div className={styles.errorTitle}>Could not load this reconciliation</div>
        {r.error}
      </div>
    );
  }
  return <RecView slug={slug} data={r.data} />;
}

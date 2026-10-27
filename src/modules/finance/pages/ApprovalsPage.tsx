// The approval queue. The item's state comes from the folder it sits in, so
// nothing on this page decides where something belongs.

import { Suspense } from "react";
import PageHeader from "@/shared/ui/PageHeader";
import ApprovalsBoard from "@/modules/finance/components/ApprovalsBoard";
import styles from "@/modules/finance/components/Approvals.module.css";
import { fetchWipItems, type WipItemRow } from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ params }: { params: { slug: string } }) {
  let items: WipItemRow[] = [];
  let error: string | null = null;

  try {
    items = await fetchWipItems(params.slug);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the queue";
  }

  const awaiting = items.filter((i) => i.panel === "awaiting-decision").length;

  return (
    <div>
      <PageHeader title="Approvals" sub="Work that has come up the review chain for your decision, and where everything else stands." />

      {error ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : (
        <>
          <p className={styles.summary}>{awaiting} awaiting your decision, {items.length} in progress.</p>
          <Suspense fallback={null}>
            <ApprovalsBoard slug={params.slug} items={items} />
          </Suspense>
        </>
      )}
    </div>
  );
}

// Changes to Xero other than journals, proposed by an agent or a person, for
// the CFO to approve. Fixed assets first. Off the menu since 6 Nov 2026: a
// change waiting on the CFO reaches him as a Work task and in Review, so this
// page is where it is decided and the record of what happened to each one.
// Reached from those, and from the client's Xero page.

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
      <PageHeader title="Xero changes" sub="Every change to Xero proposed by the agents or a person, other than journals, and what became of it. Waiting ones also show in Work and Review; the CFO approves or rejects here." />
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

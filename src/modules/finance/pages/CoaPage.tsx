// Chart of accounts: which reporting category each Xero account belongs to,
// approved here and used by the pack engine for every build.

import PageHeader from "@/shared/ui/PageHeader";
import CoaMappingPanel from "@/modules/finance/components/CoaMappingPanel";
import { fetchCoaMapping, fetchReportingCategories } from "@/modules/finance/lib/coa";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function CoaPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { entity?: string };
}) {
  const { slug } = params;
  const [view, meta] = await Promise.all([
    fetchCoaMapping(slug, searchParams?.entity),
    fetchReportingCategories(slug),
  ]);

  const error = !view.ok
    ? /Cannot GET/i.test(view.error)
      ? "The chart of accounts endpoints are not deployed on finance-api yet."
      : view.error
    : !meta.ok
      ? meta.error
      : null;

  return (
    <div>
      <PageHeader title="Chart of accounts" sub="How each company's accounts map to the reporting lines in the pack." />

      <p className={styles.intro} style={{ maxWidth: 820 }}>
        Every Xero account needs a reporting category before the management pack can show it. Accounts
        with nothing saved are offered a suggestion from Xero&apos;s account type and reporting code. The
        pack engine uses what is saved here; until every account with activity is approved, the pack
        carries a warning on its Controls tab. Every change is recorded in the audit log.
      </p>

      {error || !view.ok || !meta.ok ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the chart of accounts</div>
          {error}
        </div>
      ) : (
        <CoaMappingPanel key={view.data.entity?.slug ?? "none"} slug={slug} initialView={view.data} initialMeta={meta.data} />
      )}
    </div>
  );
}

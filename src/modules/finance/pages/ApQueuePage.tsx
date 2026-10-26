// Bills: the AP queue (docs/ap-lane/phase3-design.md, 2.3). Documents from the
// Documents inbox become proposed bills; clean ones will go to Xero for the CFO
// to approve there, and exceptions come here first. Mobile first.

import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import ApQueue from "@/modules/finance/components/ApQueue";
import styles from "@/modules/finance/components/ApQueue.module.css";
import { fetchEntities } from "@/modules/finance/lib/api";
import { fetchApItem, fetchApItems, fetchApOptions, type ApItemDetail, type ApItemRow } from "@/modules/finance/lib/ap-queue";
import type { CodingNames } from "@/modules/finance/components/ApQueue";
import { AP_TABS } from "@/modules/finance/lib/ap-labels";

export const dynamic = "force-dynamic";

const ALL_STATES = AP_TABS.flatMap((t) => t.states);

export default async function ApQueuePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { entity?: string; tab?: string; item?: string };
}) {
  let error: string | null = null;
  let entities: Array<{ slug: string; name: string }> = [];
  let items: ApItemRow[] = [];
  let selected: ApItemDetail | null = null;
  let names: CodingNames = { accounts: {}, taxes: {} };

  try {
    entities = (await fetchEntities(params.slug)).filter((e) => e.connected).map((e) => ({ slug: e.slug, name: e.name }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the companies";
  }
  const entity = entities.find((e) => e.slug === searchParams.entity)?.slug ?? entities[0]?.slug;
  const tab = AP_TABS.some((t) => t.key === searchParams.tab) ? searchParams.tab! : AP_TABS[0].key;

  if (entity && !error) {
    try {
      items = await fetchApItems(params.slug, entity, ALL_STATES);
      if (searchParams.item) selected = await fetchApItem(params.slug, entity, searchParams.item);
      // Account and VAT names for the open item; codes alone if Xero is slow.
      if (selected) {
        const o = await fetchApOptions(params.slug, entity);
        if (o.ok) {
          names = {
            accounts: Object.fromEntries(o.data.accounts.map((a) => [a.code, a.name])),
            taxes: Object.fromEntries(o.data.tax_types.map((t) => [t.type, t.name])),
          };
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load the queue";
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader section="STZA · Finance" title="Bills" />
      <ClientTabs slug={params.slug} active="bills" />
      {error ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : !entity ? (
        <div className={styles.empty}>No company is connected to Xero for this client.</div>
      ) : (
        <ApQueue slug={params.slug} entity={entity} entities={entities} tab={tab} items={items} selected={selected} names={names} />
      )}
    </div>
  );
}

// Bills: the AP queue (docs/ap-lane/phase3-design.md, 2.3). Documents from the
// Documents inbox become proposed bills; clean ones will go to Xero for the CFO
// to approve there, and exceptions come here first. Mobile first.

import PageHeader from "@/shared/ui/PageHeader";
import ApQueue from "@/modules/finance/components/ApQueue";
import styles from "@/modules/finance/components/ApQueue.module.css";
import { fetchEntities } from "@/modules/finance/lib/api";
import { fetchApItem, fetchApItems, fetchApOptions, type ApItemDetail, type ApItemRow } from "@/modules/finance/lib/ap-queue";
import type { CodingNames } from "@/modules/finance/components/ApQueue";
import { AP_TABS } from "@/modules/finance/lib/ap-labels";
import { activeAgents, isStep } from "@/modules/finance/lib/ap-agents";
import { listAgentRuns } from "@/modules/finance/lib/agent-runs";

export const dynamic = "force-dynamic";

const ALL_STATES = AP_TABS.flatMap((t) => t.states);

export default async function ApQueuePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { entity?: string; tab?: string; item?: string; with?: string; agent?: string };
}) {
  let error: string | null = null;
  let entities: Array<{ slug: string; name: string }> = [];
  let items: ApItemRow[] = [];
  let selected: ApItemDetail | null = null;
  let names: CodingNames = { accounts: {}, taxes: {} };
  let active: string[] = [];

  try {
    entities = (await fetchEntities(params.slug)).filter((e) => e.connected).map((e) => ({ slug: e.slug, name: e.name }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the companies";
  }
  const entity = entities.find((e) => e.slug === searchParams.entity)?.slug ?? entities[0]?.slug;
  const tab = AP_TABS.some((t) => t.key === searchParams.tab) ? searchParams.tab! : "exceptions";

  if (entity && !error) {
    try {
      items = await fetchApItems(params.slug, entity, ALL_STATES);
      // No runs to read leaves every open bill with the CFO, which is the safe side.
      const runs = await listAgentRuns(params.slug);
      if (runs.ok) active = activeAgents((runs.data ?? []) as Array<{ agent: string | null; status: string }>);
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
      <PageHeader title="Bills" sub="Agents work through each bill. You only see what needs you." />
      {error ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : !entity ? (
        <div className={styles.empty}>No company is connected to Xero for this client.</div>
      ) : (
        <ApQueue slug={params.slug} entity={entity} entities={entities} tab={tab} items={items} selected={selected} names={names} active={active}
          withAgent={isStep(searchParams.with) ? searchParams.with : null} noteAgent={isStep(searchParams.agent) ? searchParams.agent : null} />
      )}
    </div>
  );
}

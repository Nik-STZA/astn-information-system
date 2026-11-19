// Accruals for one client and one month (docs/accruals-spec.md): what the
// agents proposed and the discussion on each, the CFO's decisions, the schedule
// and its journal pairs, the precedents the agents learn from, and the tie of
// the accruals account to the schedule.

import PageHeader from "@/shared/ui/PageHeader";
import AccrualsView from "@/modules/finance/components/AccrualsView";
import { fetchAccruals } from "@/modules/finance/lib/accruals";
import { defaultPeriod, isPeriod } from "@/modules/finance/lib/recs";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function AccrualsPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string; tie?: string; proposal?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const period = isPeriod(q.period) ? q.period as string : defaultPeriod();
  const r = await fetchAccruals(slug, period, q.tie === "1");

  return (
    <div className={page.wide}>
      <PageHeader title="Accruals"
        sub="The agents propose; you discuss each one here and decide. Each decision is kept, and the agents follow it next month. An accrual and its reversal go to the Journals page as one pair." />
      {!r.ok ? (
        <div className={page.error} role="alert">
          Could not load the accruals: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}
        </div>
      ) : r.data.migration_missing ? (
        <div className={`${page.card} ${page.empty}`}>Accruals are built but not switched on: migration 062 has not been applied to the database yet.</div>
      ) : (
        <AccrualsView slug={slug} data={r.data} focus={q.proposal ?? null} />
      )}
    </div>
  );
}

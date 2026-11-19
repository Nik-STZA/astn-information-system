// The month's payroll (migration 065): the provider's salary report in, cut
// down to employee codes and figures in the browser; roles, capitalisation
// shares, the month's journals, and the working file on the client's drive.

import PageHeader from "@/shared/ui/PageHeader";
import PayrollView from "@/modules/finance/components/PayrollView";
import { fetchPayroll } from "@/modules/finance/lib/payroll";
import { defaultPeriod, isPeriod } from "@/modules/finance/lib/recs";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string }>;
}) {
  const { slug } = await paramsPromise;
  const asked = (await searchParamsPromise)?.period;
  const period = isPeriod(asked) ? asked as string : defaultPeriod();
  const r = await fetchPayroll(slug, period);

  return (
    <div className={page.wide}>
      <PageHeader title="Payroll"
        sub="Upload the payroll provider's salary report. Only employee codes and pay figures leave your computer; names and personal details stay in the file. The journals go to the Journals page for approval." />
      {!r.ok ? (
        <div className={page.error} role="alert">
          Could not load payroll: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}
        </div>
      ) : r.data.migration_missing ? (
        <div className={`${page.card} ${page.empty}`}>Payroll is built but not switched on: migration 065 has not been applied to the database yet.</div>
      ) : (
        <PayrollView slug={slug} data={r.data} />
      )}
    </div>
  );
}

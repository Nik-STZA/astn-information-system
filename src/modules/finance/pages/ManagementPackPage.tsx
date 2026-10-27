// Management pack for one client: queue a build for a month and see past builds.
//
// The build runs either on the operator's machine (scripts/report-runner.mjs)
// or as a Cloud Run Job, depending on the client; finance-api says which, and
// either way a draft is saved to the Finance shared drive.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import ManagementPackPanel from "@/modules/finance/components/ManagementPackPanel";
import styles from "@/modules/finance/components/Page.module.css";
import {
  FinanceApiError,
  fetchReportRuns,
  type PackExecutor,
  type PackPipeline,
  type ReportRunRow,
} from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

export default async function ManagementPackPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  let runs: ReportRunRow[] = [];
  let executor: PackExecutor = "local";
  let pipeline: PackPipeline = "legacy";
  let error: string | null = null;
  try {
    ({ runs, executor, pipeline } = await fetchReportRuns(slug, "management_pack"));
  } catch (e) {
    error =
      e instanceof FinanceApiError && e.status === 404 && /Cannot GET/i.test(e.message)
        ? "The report builds endpoint is not deployed on finance-api yet."
        : e instanceof Error
          ? e.message
          : String(e);
  }

  return (
    <div>
      <PageHeader title="Management pack" sub="Build the monthly pack from Xero and download it." />

      <Link href={`/finance/clients/${slug}/reports`} className={styles.back}>
        <ArrowLeft size={15} aria-hidden="true" />Reports
      </Link>

      <p className={styles.intro}>
        Builds the month-end management pack and board pack with the same pipeline as the monthly
        close, then saves both to the Finance shared drive under Month-end, in a Drafts folder for
        that month.
      </p>

      {error ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load past builds</div>
          {error}
        </div>
      ) : (
        <ManagementPackPanel slug={slug} initialRuns={runs} executor={executor} pipeline={pipeline} />
      )}
    </div>
  );
}

// Management pack for one client: queue a build for a month and see past builds.
//
// The build runs either on the operator's machine (scripts/report-runner.mjs)
// or as a Cloud Run Job, depending on the client; finance-api says which, and
// either way a draft is saved to the Finance shared drive.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import ManagementPackPanel from "@/modules/finance/components/ManagementPackPanel";
import {
  FinanceApiError,
  fetchReportRuns,
  type PackExecutor,
  type ReportRunRow,
} from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

export default async function ManagementPackPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  let runs: ReportRunRow[] = [];
  let executor: PackExecutor = "local";
  let error: string | null = null;
  try {
    ({ runs, executor } = await fetchReportRuns(slug, "management_pack"));
  } catch (e) {
    error =
      e instanceof FinanceApiError && e.status === 404 && /Cannot GET/i.test(e.message)
        ? "The report builds endpoint is not deployed on finance-api yet."
        : e instanceof Error
          ? e.message
          : String(e);
  }

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Management pack" />
      <ClientTabs slug={slug} active="reports" />

      <div style={{ marginBottom: 14, fontFamily: "Manrope, sans-serif" }}>
        <Link
          href={`/finance/clients/${slug}/reports`}
          style={{ fontSize: 12, color: "var(--sub)", textDecoration: "none" }}
        >
          ← Reports
        </Link>
      </div>

      <p
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--sub)",
          margin: "0 0 20px",
          maxWidth: 760,
        }}
      >
        Builds the month-end management pack and board pack with the same pipeline as the monthly
        close, then saves both to the Finance shared drive under Month-end, in a Drafts folder for
        that month.
      </p>

      {error ? (
        <div
          style={{
            padding: "16px 18px",
            border: "1px solid var(--alert-red)",
            borderRadius: 8,
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
            color: "var(--tx)",
            maxWidth: 760,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--alert-red)", marginBottom: 4 }}>
            Could not load past builds
          </div>
          {error}
        </div>
      ) : (
        <ManagementPackPanel slug={slug} initialRuns={runs} executor={executor} />
      )}
    </div>
  );
}

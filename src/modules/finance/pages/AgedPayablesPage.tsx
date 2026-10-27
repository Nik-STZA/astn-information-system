// AP ageing for one entity or the whole group.
//
// Server component: fetches the report and the entity list, then hands the
// numbers to AgedPayablesReport for the interactive parts. The entity selector
// is plain links so each view has its own URL and can be shared.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import AgedPayablesReport from "@/modules/finance/components/AgedPayablesReport";
import styles from "@/modules/finance/components/Page.module.css";
import {
  FinanceApiError,
  fetchAgedPayables,
  fetchEntities,
  type AgedPayablesReport as Report,
  type FinanceEntity,
} from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Choice({ href, label, active }: { href: string; label: string; active: boolean }) {
  return <Link href={href} className={active ? "seg-on" : undefined} aria-current={active ? "page" : undefined}>{label}</Link>;
}

export default async function AgedPayablesPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const { slug } = params;

  let entities: FinanceEntity[] = [];
  try {
    entities = await fetchEntities(slug);
  } catch {
    // The report call below reports the failure; an empty selector is enough here.
  }
  const connected = entities.filter((e) => e.connected);
  const isGroup = connected.length > 1;

  const requested = typeof searchParams.entity === "string" ? searchParams.entity : undefined;
  const scope = requested ?? (isGroup || connected.length === 0 ? "all" : connected[0].slug);

  let report: Report | null = null;
  let error: string | null = null;
  try {
    report = await fetchAgedPayables(slug, scope);
  } catch (e) {
    error =
      e instanceof FinanceApiError && e.status === 404 && /Cannot GET/i.test(e.message)
        ? "The AP ageing endpoint is not deployed on finance-api yet."
        : e instanceof Error
          ? e.message
          : String(e);
  }

  const base = `/finance/clients/${slug}/reports/aged-payables`;
  const scopeLabel =
    scope === "all"
      ? "All companies"
      : (connected.find((e) => e.slug === scope)?.legalName ??
        connected.find((e) => e.slug === scope)?.name ??
        scope);

  return (
    <div>
      <PageHeader title="AP ageing" sub="What is owed to suppliers, by how long it has been due." />

      <Link href={`/finance/clients/${slug}/reports`} className={styles.back}>
        <ArrowLeft size={15} aria-hidden="true" />Reports
      </Link>

      {(isGroup || connected.length > 1) && (
        <div style={{ overflowX: "auto", maxWidth: "100%", marginBottom: 12 }}>
          <div className="seg" role="group" aria-label="Company">
            {isGroup && <Choice href={`${base}?entity=all`} label="Group (all companies)" active={scope === "all"} />}
            {connected.map((e) => (
              <Choice key={e.slug} href={`${base}?entity=${encodeURIComponent(e.slug)}`} label={e.name} active={scope === e.slug} />
            ))}
          </div>
        </div>
      )}

      <p className={styles.intro}>
        {scopeLabel}. As at {fmtDate(report?.asAt ?? new Date().toISOString().slice(0, 10))}, amounts due
        per Xero now. Authorised bills only; drafts and bills awaiting approval are excluded.
      </p>

      {error ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the report</div>
          {error}
        </div>
      ) : report ? (
        <AgedPayablesReport report={report} slug={slug} isGroupView={scope === "all" && isGroup} />
      ) : null}
    </div>
  );
}

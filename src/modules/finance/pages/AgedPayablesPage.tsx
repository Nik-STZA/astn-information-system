// AP ageing for one entity or the whole group.
//
// Server component: fetches the report and the entity list, then hands the
// numbers to AgedPayablesReport for the interactive parts. The entity selector
// is plain links so each view has its own URL and can be shared.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import AgedPayablesReport from "@/modules/finance/components/AgedPayablesReport";
import {
  FinanceApiError,
  fetchAgedPayables,
  fetchEntities,
  type AgedPayablesReport as Report,
  type FinanceEntity,
} from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

function Choice({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        padding: "6px 10px",
        borderRadius: 6,
        textDecoration: "none",
        border: `1px solid ${active ? "#C5A059" : "var(--bd)"}`,
        color: active ? "var(--tx)" : "var(--sub)",
        background: active ? "var(--pnl)" : "transparent",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );
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
      ? "All entities"
      : (connected.find((e) => e.slug === scope)?.legalName ??
        connected.find((e) => e.slug === scope)?.name ??
        scope);

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="AP ageing" />
      <ClientTabs slug={slug} active="reports" />

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 14,
          fontFamily: "Manrope, sans-serif",
        }}
      >
        <Link
          href={`/finance/clients/${slug}/reports`}
          style={{ fontSize: 12, color: "var(--sub)", textDecoration: "none", marginRight: 8 }}
        >
          ← Reports
        </Link>
        {isGroup && <Choice href={`${base}?entity=all`} label="Group (all entities)" active={scope === "all"} />}
        {connected.map((e) => (
          <Choice
            key={e.slug}
            href={`${base}?entity=${encodeURIComponent(e.slug)}`}
            label={e.legalName ? `${e.name} · ${e.legalName}` : e.name}
            active={scope === e.slug}
          />
        ))}
      </div>

      <p
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 13,
          color: "var(--sub)",
          margin: "0 0 20px",
        }}
      >
        {scopeLabel}. As at {report?.asAt ?? new Date().toISOString().slice(0, 10)}, amounts due
        per Xero now. Authorised bills only; drafts and bills awaiting approval are excluded.
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
            Could not load the report
          </div>
          {error}
        </div>
      ) : report ? (
        <AgedPayablesReport report={report} slug={slug} isGroupView={scope === "all" && isGroup} />
      ) : null}
    </div>
  );
}

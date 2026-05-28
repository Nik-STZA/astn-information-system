import Link from "next/link";
import { notFound } from "next/navigation";
import OrganizationEditForm from "@/components/OrganizationEditForm";
import {
  confidenceBand,
  fetchFilterOptions,
  fetchOrganization,
} from "@/lib/data/registry";
import type { OrganizationDetail } from "@/lib/data/registry-shared";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function OrganizationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [org, options] = await Promise.all([
    fetchOrganization(params.id),
    fetchFilterOptions(),
  ]);

  if (!org) {
    notFound();
  }

  const band = confidenceBand(org.source_confidence);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/registry" className="btn-text">
          ← Back to registry
        </Link>
        <div className="flex items-center gap-3">
          {band === "High" && <span className="pill pill-high">High confidence</span>}
          {band === "Medium" && <span className="pill pill-medium">Medium confidence</span>}
          {(band === "Medium-Low" || band === "Low") && (
            <span className="pill pill-low">{band} confidence</span>
          )}
          {band === null && <span className="pill pill-neutral">Unverified</span>}
          <a
            href={`/registry/${org.id}/report`}
            className="btn-secondary"
            download
          >
            Generate profile report
          </a>
        </div>
      </div>

      <div>
        <h1>{org.organization_name ?? "Untitled organisation"}</h1>
        <p className="text-caption text-warm-grey mt-1">
          {[org.country, org.sport, org.organization_type].filter(Boolean).join(" · ") || "—"}
        </p>
        {org.astn_id && (
          <p className="text-caption text-warm-grey mt-0.5">AfricanSTN ID: {org.astn_id}</p>
        )}
      </div>

      <OrganizationEditForm org={org} typeOptions={options.types} />

      <ReferenceSection org={org} />
    </div>
  );
}

function ReferenceSection({ org }: { org: OrganizationDetail }) {
  return (
    <div className="card p-5 space-y-5">
      <h2>Reference fields</h2>
      <p className="text-caption text-warm-grey">
        Read-only here. Country, sport, and level edits need to update the matching ISO/code pair, so they are deferred to a later flow.
      </p>

      <FieldGroup
        title="Classification"
        rows={[
          ["Country", org.country],
          ["Country ISO", org.country_iso],
          ["Region / province", org.region_province],
          ["Sport", org.sport],
          ["Sport code", org.sport_code],
          ["Level", org.level],
          ["Parent national body", org.parent_national_body],
          ["Continental body", org.continental_body],
          ["National body website", org.national_body_website],
        ]}
      />

      <FieldGroup
        title="Verification"
        rows={[
          ["Source confidence", org.source_confidence],
          ["Verification source", org.verification_source],
          ["Primary source", org.verification_source_primary],
          ["Cross-reference", org.verification_source_xref],
          ["Source label", org.verification_source_label],
          ["Verification date", org.verification_date],
          ["Data source", org.data_source],
          ["Last updated (legacy)", org.last_updated],
        ]}
      />

      <FieldGroup
        title="System"
        rows={[
          ["Created", formatDate(org.created_at)],
          ["Updated", formatDate(org.updated_at)],
        ]}
      />
    </div>
  );
}

function FieldGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | null]>;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-h3-app text-brand-dark font-bold">{title}</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 border-b border-gold-border/50 pb-1.5">
            <dt className="text-tag uppercase tracking-wider text-warm-grey font-bold sm:w-44 sm:flex-shrink-0">
              {label}
            </dt>
            <dd className="text-body-app text-near-black break-words">
              {value && value.length > 0 ? value : "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import ChangeHistory from "@/components/ChangeHistory";
import OrganizationEditForm from "@/components/OrganizationEditForm";
import {
  confidenceBand,
  fetchFilterOptions,
  fetchOrganization,
  fetchOrganizationChanges,
} from "@/lib/data/registry";
import type { OrganizationDetail } from "@/lib/data/registry-shared";

export const dynamic = "force-dynamic";

/* ── Confidence pill colours ─────────────────────────────────────────── */
const CONF_META: Record<string, { bg: string; text: string; border: string }> = {
  High:       { bg: "#E8F5E9", text: "#2E7D32", border: "#C8E6C9" },
  Medium:     { bg: "#FBF1DE", text: "#A67514", border: "#F0E0B6" },
  "Medium-Low": { bg: "#FBE7E1", text: "#B4432C", border: "#EDCBBF" },
  Low:        { bg: "#FBE7E1", text: "#B4432C", border: "#EDCBBF" },
};

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

type Props = { params: Promise<{ id: string }> };

export default async function OrganizationDetailPage({ params }: Props) {
  const { id } = await params;
  const [org, options, changes] = await Promise.all([
    fetchOrganization(id),
    fetchFilterOptions(),
    fetchOrganizationChanges(id, 20),
  ]);

  if (!org) {
    notFound();
  }

  const band = confidenceBand(org.source_confidence);
  const confStyle = band ? CONF_META[band] ?? CONF_META.Medium : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Top bar: back link + confidence pill + report button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link
          href="/registry"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 13, fontWeight: 700, color: "#C5A059",
            textDecoration: "none", padding: "6px 12px", borderRadius: 8,
          }}
        >
          ← Back to registry
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {confStyle && (
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "5px 10px", borderRadius: 999,
              fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em",
              color: confStyle.text, background: confStyle.bg, border: `1px solid ${confStyle.border}`,
            }}>
              {band} confidence
            </span>
          )}
          {!confStyle && (
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "5px 10px", borderRadius: 999,
              fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em",
              color: "#6E6A62", background: "#F2F0EB", border: "1px solid #DDD9D1",
            }}>
              Unverified
            </span>
          )}
          <a
            href={`/registry/${org.id}/report`}
            download
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "10px 20px", borderRadius: 8,
              fontWeight: 700, fontSize: 13,
              color: "#B08D3F", background: "#FFFFFF",
              border: "1px solid var(--bd)",
              textDecoration: "none",
            }}
          >
            Generate profile report
          </a>
        </div>
      </div>

      {/* Organisation header */}
      <div>
        <h1 style={{ fontSize: 27, fontWeight: 800, color: "var(--tx)", margin: 0 }}>
          {org.organization_name ?? "Untitled organisation"}
        </h1>
        <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)", marginTop: 4 }}>
          {[org.country, org.sport, org.organization_type, org.level]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        {org.astn_id && (
          <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)", marginTop: 2 }}>
            AfricanSTN ID: {org.astn_id}
          </p>
        )}
        <p style={{ fontSize: 12, fontWeight: 400, color: "var(--sub)", marginTop: 8, fontStyle: "italic" }}>
          Organisation name, AfricanSTN ID, country, sport, and level are locked. Open a separate flow to correct identity fields.
        </p>
      </div>

      {/* Edit form (already reskinned via globals.css component classes) */}
      <OrganizationEditForm org={org} typeOptions={options.types} />

      {/* Audit trail */}
      <ChangeHistory changes={changes} />

      {/* Reference fields */}
      <ReferenceSection org={org} />
    </div>
  );
}

/* ── Reference fields (read-only) ────────────────────────────────────── */
function ReferenceSection({ org }: { org: OrganizationDetail }) {
  return (
    <div style={{
      background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10,
      padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20,
      boxShadow: "0 1px 3px rgba(26,28,30,.04), 0 1px 2px rgba(26,28,30,.03)",
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)", margin: 0 }}>
        Reference fields
      </h2>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)" }}>
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
        title="Provenance (read-only)"
        rows={[
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

/* ── Field group ─────────────────────────────────────────────────────── */
function FieldGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | null]>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--tx)", margin: 0 }}>
        {title}
      </h3>
      <dl style={{
        display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
        gap: "8px 24px", margin: 0,
      }}>
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex", flexDirection: "column", gap: 2,
              borderBottom: "1px solid rgba(212,197,169,.5)", paddingBottom: 6,
            }}
          >
            <dt style={{
              fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: ".04em", color: "var(--sub)",
            }}>
              {label}
            </dt>
            <dd style={{ fontSize: 13, fontWeight: 400, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>
              {value && value.length > 0 ? value : "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

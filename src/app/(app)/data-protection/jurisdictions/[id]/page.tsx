import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchJurisdictionById } from "@/lib/data/jurisdictions";

export const dynamic = "force-dynamic";

function flagUrl(iso: string): string {
  return `https://flagcdn.com/w80/${iso.toLowerCase()}.png`;
}

function Pill({
  label,
  positive,
}: {
  label: string;
  positive: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 4,
        background: positive ? "rgba(46,125,50,.12)" : "rgba(204,0,0,.10)",
        color: positive ? "#2E7D32" : "#CC0000",
      }}
    >
      {label}
    </span>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        padding: "12px 0",
        borderBottom: "1px solid var(--bd)",
        gap: 16,
      }}
    >
      <span
        style={{
          flex: "0 0 200px",
          fontWeight: 600,
          fontSize: 12,
          color: "var(--sub)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, fontSize: 14, color: "var(--tx)" }}>
        {children}
      </span>
    </div>
  );
}

export default async function JurisdictionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const j = await fetchJurisdictionById(id);
  if (!j) notFound();

  /* Extract useful fields from record_data if populated */
  const rd = j.recordData || {};
  const sectors = rd.key_sectors as string[] | undefined;
  const notes = rd.notes as string | undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: "var(--sub)" }}>
        <Link
          href="/data-protection/jurisdictions"
          style={{ color: "var(--sub)", textDecoration: "none" }}
        >
          Jurisdictions
        </Link>
        <span style={{ margin: "0 6px", opacity: 0.4 }}>&rsaquo;</span>
        <span style={{ color: "var(--tx)", fontWeight: 600 }}>
          {j.countryName}
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={flagUrl(j.countryIso)}
          alt={j.countryIso}
          width={48}
          height={48}
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            objectFit: "cover",
            border: "2px solid var(--bd)",
            flexShrink: 0,
          }}
        />
        <div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: 26,
              lineHeight: 1.15,
              color: "var(--tx)",
              margin: 0,
            }}
          >
            {j.countryName}
          </h1>
          {j.region && (
            <p
              style={{
                fontWeight: 400,
                fontSize: 13,
                color: "var(--sub)",
                marginTop: 2,
              }}
            >
              {j.region}
            </p>
          )}
        </div>
      </div>

      {/* Status pills */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Pill
          label={
            j.hasComprehensiveLaw ? "Comprehensive law" : "No comprehensive law"
          }
          positive={j.hasComprehensiveLaw}
        />
        <Pill
          label={
            j.authorityOperational
              ? "DPA operational"
              : "DPA not operational"
          }
          positive={j.authorityOperational}
        />
        {j.malaboStatus && (
          <span
            style={{
              display: "inline-block",
              fontWeight: 600,
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 4,
              background: "rgba(197,160,89,.12)",
              color: "#C5A059",
            }}
          >
            Malabo: {j.malaboStatus}
          </span>
        )}
      </div>

      {/* Detail card */}
      <div className="card" style={{ padding: "4px 24px" }}>
        <InfoRow label="Jurisdiction ID">{j.jurisdictionId}</InfoRow>
        <InfoRow label="Country ISO">{j.countryIso}</InfoRow>
        <InfoRow label="Law">
          {j.lawName ?? (
            <span style={{ color: "var(--sub)", fontStyle: "italic" }}>
              No law recorded
            </span>
          )}
        </InfoRow>
        <InfoRow label="Year enacted">
          {j.lawYear ?? (
            <span style={{ color: "var(--sub)", fontStyle: "italic" }}>-</span>
          )}
        </InfoRow>
        <InfoRow label="Authority">
          {j.authorityFullName ?? j.authorityName ?? (
            <span style={{ color: "var(--sub)", fontStyle: "italic" }}>
              No authority recorded
            </span>
          )}
          {j.authorityAcronym && (
            <span
              style={{
                marginLeft: 8,
                fontWeight: 600,
                fontSize: 11,
                color: "var(--sub)",
              }}
            >
              ({j.authorityAcronym})
            </span>
          )}
        </InfoRow>
        <InfoRow label="Authority operational">
          {j.authorityOperational ? "Yes" : "No"}
        </InfoRow>
        <InfoRow label="Malabo Convention">
          {j.malaboStatus ?? (
            <span style={{ color: "var(--sub)", fontStyle: "italic" }}>
              Status unknown
            </span>
          )}
        </InfoRow>

        {sectors && sectors.length > 0 && (
          <InfoRow label="Key sectors">{sectors.join(", ")}</InfoRow>
        )}
        {notes && <InfoRow label="Notes">{notes}</InfoRow>}

        <InfoRow label="Record updated">
          {j.updatedAt
            ? new Date(j.updatedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : "-"}
        </InfoRow>
      </div>

      {/* Back link */}
      <div>
        <Link
          href="/data-protection/jurisdictions"
          style={{
            fontSize: 13,
            color: "#C5A059",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          &larr; Back to all jurisdictions
        </Link>
      </div>
    </div>
  );
}

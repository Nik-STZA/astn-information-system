import Link from "next/link";
import {
  fetchAllJurisdictions,
  fetchJurisdictionMetrics,
} from "@/lib/data/jurisdictions";

export const dynamic = "force-dynamic";

/* ── Helpers ─────────────────────────────────────────────────────── */

function flagUrl(iso: string): string {
  return `https://flagcdn.com/w40/${iso.toLowerCase()}.png`;
}

function LawPill({ has }: { has: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        background: has ? "rgba(46,125,50,.12)" : "rgba(204,0,0,.10)",
        color: has ? "#2E7D32" : "#CC0000",
        letterSpacing: "0.02em",
      }}
    >
      {has ? "Yes" : "No"}
    </span>
  );
}

function DpaPill({ operational }: { operational: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        background: operational
          ? "rgba(46,125,50,.12)"
          : "rgba(204,119,0,.10)",
        color: operational ? "#2E7D32" : "#CC7700",
        letterSpacing: "0.02em",
      }}
    >
      {operational ? "Operational" : "Not operational"}
    </span>
  );
}

function MalaboPill({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: "var(--sub)", fontSize: 12 }}>-</span>;
  const lower = status.toLowerCase();
  const isRatified = lower.includes("ratified");
  const isSigned = lower.includes("signed") && !lower.includes("not signed");
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        background: isRatified
          ? "rgba(46,125,50,.12)"
          : isSigned
            ? "rgba(204,119,0,.10)"
            : "rgba(142,145,150,.10)",
        color: isRatified
          ? "#2E7D32"
          : isSigned
            ? "#CC7700"
            : "var(--sub)",
        letterSpacing: "0.02em",
      }}
    >
      {status}
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default async function JurisdictionsPage() {
  const [jurisdictions, metrics] = await Promise.all([
    fetchAllJurisdictions(),
    fetchJurisdictionMetrics(),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Header */}
      <div>
        <div
          style={{
            fontWeight: 500,
            fontSize: 12,
            color: "var(--sub)",
            marginBottom: 4,
          }}
        >
          AfricanSTN{" "}
          <span style={{ margin: "0 6px", opacity: 0.4 }}>&middot;</span>{" "}
          Regulatory
        </div>
        <h1
          style={{
            fontWeight: 800,
            fontSize: 26,
            lineHeight: 1.15,
            color: "var(--tx)",
            margin: 0,
          }}
        >
          Jurisdictions
        </h1>
        <p
          style={{
            fontWeight: 400,
            fontSize: 13,
            color: "var(--sub)",
            marginTop: 4,
          }}
        >
          {metrics.total} jurisdictions tracked — {metrics.withComprehensiveLaw}{" "}
          with comprehensive law, {metrics.withOperationalDpa} with operational
          DPA
        </p>
      </div>

      {/* Counter cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "var(--pnl)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 28,
              lineHeight: 1,
              color: "var(--tx)",
            }}
          >
            {metrics.total}
          </span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--sub)",
            }}
          >
            Jurisdictions
          </span>
        </div>
        <div
          style={{
            background: "var(--pnl)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 28,
              lineHeight: 1,
              color: "#2E7D32",
            }}
          >
            {metrics.withComprehensiveLaw}
          </span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--sub)",
            }}
          >
            With comprehensive law
          </span>
        </div>
        <div
          style={{
            background: "var(--pnl)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 28,
              lineHeight: 1,
              color: "#C5A059",
            }}
          >
            {metrics.withOperationalDpa}
          </span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--sub)",
            }}
          >
            Operational DPA
          </span>
        </div>
      </section>

      {/* Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--bd)",
                textAlign: "left",
              }}
            >
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Country
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Region
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Law
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Year
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Comprehensive
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Authority
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                DPA status
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--sub)",
                }}
              >
                Malabo
              </th>
            </tr>
          </thead>
          <tbody>
            {jurisdictions.map((j, idx) => (
              <tr
                key={j.id}
                style={{
                  borderTop: idx > 0 ? "1px solid var(--bd)" : "none",
                  transition: "background .15s",
                }}
                className="hover:bg-[var(--cardhover)]"
              >
                <td style={{ padding: "10px 16px" }}>
                  <Link
                    href={`/data-protection/jurisdictions/${j.jurisdictionId}`}
                    style={{
                      textDecoration: "none",
                      color: "var(--tx)",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={flagUrl(j.countryIso)}
                      alt={j.countryIso}
                      width={20}
                      height={20}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        objectFit: "cover",
                        flexShrink: 0,
                      }}
                    />
                    {j.countryName}
                  </Link>
                </td>
                <td
                  style={{
                    padding: "10px 16px",
                    color: "var(--sub)",
                    fontSize: 12,
                  }}
                >
                  {j.region ?? "-"}
                </td>
                <td
                  style={{
                    padding: "10px 16px",
                    color: "var(--tx)",
                    fontSize: 12,
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {j.lawName ?? "-"}
                </td>
                <td
                  style={{
                    padding: "10px 16px",
                    color: "var(--sub)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {j.lawYear ?? "-"}
                </td>
                <td style={{ padding: "10px 16px" }}>
                  <LawPill has={j.hasComprehensiveLaw} />
                </td>
                <td
                  style={{
                    padding: "10px 16px",
                    color: "var(--tx)",
                    fontSize: 12,
                  }}
                >
                  {j.authorityAcronym ?? j.authorityName ?? "-"}
                </td>
                <td style={{ padding: "10px 16px" }}>
                  <DpaPill operational={j.authorityOperational} />
                </td>
                <td style={{ padding: "10px 16px" }}>
                  <MalaboPill status={j.malaboStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

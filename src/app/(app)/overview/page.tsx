import Link from "next/link";
import {
  fetchOverviewMetrics,
  fetchTopCountries,
  fetchTopOrgTypes,
  fetchRecentItems,
} from "@/lib/data/overview";
import { fetchVerificationQueueCount } from "@/lib/data/registry";

export const dynamic = "force-dynamic";

/* ── Sub-components ──────────────────────────────────────────────── */

function CounterCard({
  value,
  label,
  unit,
  href,
  highlight,
}: {
  value: string | number;
  label: string;
  unit?: string;
  href?: string;
  highlight?: boolean;
}) {
  const formatted =
    typeof value === "number" ? value.toLocaleString("en-GB") : value;

  const cardStyle: React.CSSProperties = highlight
    ? {
        background: "rgba(204,119,0,.07)",
        border: "1px solid rgba(204,119,0,.32)",
        borderRadius: 10,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }
    : {
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 10,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      };

  const numberStyle: React.CSSProperties = {
    fontWeight: 800,
    fontSize: 28,
    lineHeight: 1,
    color: highlight ? "#CC7700" : "var(--tx)",
    letterSpacing: "-0.02em",
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 11,
    lineHeight: 1.2,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: highlight ? "#CC7700" : "var(--sub)",
  };

  const inner = (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
        <span style={numberStyle}>{formatted}</span>
        {unit && (
          <span
            style={{ fontWeight: 700, fontSize: 18, color: "var(--sub)" }}
          >
            {unit}
          </span>
        )}
      </div>
      <span style={labelStyle}>{label}</span>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        style={{ textDecoration: "none", transition: "filter .15s" }}
        className="hover:brightness-95"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

function BarRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "7px 0",
      }}
    >
      <span
        style={{
          width: 140,
          flexShrink: 0,
          fontWeight: 500,
          fontSize: 13,
          color: "var(--tx)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 22,
          background: "var(--pg)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background:
              "linear-gradient(90deg, #C5A059, #D4B46A)",
            borderRadius: 4,
            minWidth: pct > 0 ? 2 : 0,
            transition: "width .4s ease",
          }}
        />
      </div>
      <span
        style={{
          width: 52,
          textAlign: "right",
          flexShrink: 0,
          fontWeight: 700,
          fontSize: 13,
          color: "var(--tx)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toLocaleString("en-GB")}
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ── Page ────────────────────────────────────────────────────────── */

export default async function OverviewPage() {
  const [metrics, topCountries, topOrgTypes, recentItems, pendingVerification] =
    await Promise.all([
      fetchOverviewMetrics(),
      fetchTopCountries(8),
      fetchTopOrgTypes(8),
      fetchRecentItems(12),
      fetchVerificationQueueCount(),
    ]);

  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const countryMax = topCountries[0]?.count ?? 1;
  const orgTypeMax = topOrgTypes[0]?.count ?? 1;

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
          Registry
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
          Overview
        </h1>
        <p
          style={{
            fontWeight: 400,
            fontSize: 13,
            color: "var(--sub)",
            marginTop: 4,
          }}
        >
          Live state of the registry as of {today}
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
        <CounterCard
          value={metrics.totalOrganisations}
          label="Organisations"
        />
        <CounterCard
          value={metrics.totalCountries}
          label="Countries + pan-African"
        />
        <CounterCard value={metrics.totalSports} label="Sports" />
        <CounterCard
          value={metrics.highConfidencePercent.toFixed(1)}
          unit="%"
          label="Verified at high"
        />
        <CounterCard
          value={metrics.totalPartnerships}
          label="Partnerships"
        />
        <CounterCard
          value={metrics.itemsThisWeek}
          label="Items this week"
        />
        <CounterCard
          value={pendingVerification}
          label="Pending verification"
          href="/registry/verify"
          highlight
        />
      </section>

      {/* Charts row */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        {/* Top countries */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <h2
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: "var(--tx)",
              margin: "0 0 16px",
            }}
          >
            Top countries
          </h2>
          <div>
            {topCountries.map((row) => (
              <BarRow
                key={row.country}
                label={row.country}
                value={row.count}
                max={countryMax}
              />
            ))}
          </div>
        </div>

        {/* Top organisation types */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <h2
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: "var(--tx)",
              margin: "0 0 16px",
            }}
          >
            Top organisation types
          </h2>
          <div>
            {topOrgTypes.map((row) => (
              <BarRow
                key={row.type}
                label={row.type}
                value={row.count}
                max={orgTypeMax}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Recent intelligence */}
      <section>
        <h2
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: "var(--tx)",
            margin: "0 0 12px",
          }}
        >
          Recent intelligence
        </h2>
        <div className="card" style={{ overflow: "hidden" }}>
          {recentItems.length === 0 ? (
            <div
              style={{
                padding: "32px 24px",
                textAlign: "center",
                color: "var(--sub)",
                fontSize: 13,
              }}
            >
              No recent items. The next scheduled fetch will populate this
              view.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {recentItems.map((item, idx) => (
                <li
                  key={item.id}
                  style={{
                    padding: "12px 24px",
                    borderTop:
                      idx > 0 ? "1px solid var(--bd)" : "none",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    transition: "background .15s",
                  }}
                  className="hover:bg-[var(--cardhover)]"
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          color: "var(--tx)",
                          textDecoration: "none",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          color: "var(--tx)",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </span>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 3,
                        fontSize: 11,
                        color: "var(--sub)",
                      }}
                    >
                      <span>{item.source}</span>
                      {item.createdAt && (
                        <>
                          <span style={{ opacity: 0.4 }}>&middot;</span>
                          <span>{formatDate(item.createdAt)}</span>
                        </>
                      )}
                      {item.languageCode &&
                        item.languageCode !== "EN" && (
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "rgba(197,160,89,.12)",
                              color: "#8F7A45",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {item.languageCode}
                          </span>
                        )}
                    </div>
                  </div>
                  {item.verticals.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      {item.verticals.slice(0, 3).map((v) => (
                        <span
                          key={v}
                          style={{
                            fontWeight: 500,
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "rgba(197,160,89,.10)",
                            color: "var(--sub)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

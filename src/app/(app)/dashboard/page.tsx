/**
 * Cross-module dashboard — reskinned July 2026.
 * Server component fetching from Cloud Run stats + maturity + summary,
 * plus Supabase registry metrics for the headline org/country counts.
 *
 * Amendment #2 (single-source org counts): the four registry headline
 * figures (organisations, countries, partnerships, items this week) come
 * from fetchOverviewMetrics — the same function the Overview page uses.
 * This guarantees the two pages can never show different numbers for the
 * same underlying data.  The Cloud Run /api/summary is still used for
 * non-registry stats (prospects, clients, enforcement actions, etc.).
 */

import { fetchDashboardStats } from "@/lib/data/pipeline";
import { fetchMaturity } from "@/lib/data/data-protection";
import { fetchOverviewMetrics } from "@/lib/data/overview";
import { cloudRunFetch } from "@/lib/cloud-run";
import Link from "next/link";

type SummaryData = {
  version: string;
  stats: {
    countries: number;
    organizations: number;
    partners: number;
    classified_items: number;
    enforcement_actions: number;
    weekly_reports: number;
    prospects: number;
    clients: number;
    pipeline_opportunities: number;
    content_editions: number;
  };
};

/* ── Reusable sub-components ─────────────────────────────────────────────── */

function HeroKpi({
  value,
  label,
  sub,
  empty,
}: {
  value: string;
  label: string;
  sub?: string;
  empty?: boolean;
}) {
  return (
    <div className={empty ? "card-empty" : "card"} style={{ padding: "18px 18px 16px" }}>
      <div className={empty ? "kpi-number-empty" : "kpi-number"} style={{ marginBottom: 7 }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
      {sub && (
        <div className="kpi-sub" style={{ marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function FunnelRow({
  label,
  value,
  max,
  empty,
}: {
  label: string;
  value: number;
  max: number;
  empty?: boolean;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: 78,
          flexShrink: 0,
          fontWeight: 500,
          fontSize: 12,
          color: empty ? "#9A968B" : "#55524C",
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 22,
          background: "#F1EADC",
          borderRadius: 5,
          overflow: "hidden",
        }}
      >
        {value > 0 && (
          <div
            style={{
              width: `${Math.max(pct, 4)}%`,
              height: "100%",
              background:
                pct === 100
                  ? "linear-gradient(90deg, #C5A059, #B08D3F)"
                  : "#C5A059",
              borderRadius: 5,
            }}
          />
        )}
      </div>
      <span
        style={{
          width: 24,
          textAlign: "right",
          fontWeight: 700,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: empty ? "#B9B2A2" : "#1A1C1E",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const TIER_COLOURS: Record<string, string> = {
  leader: "#2E7D32",
  advanced: "#3E6B8E",
  developing: "#C5A059",
  nascent: "#CC7700",
  absent: "#CC0000",
};

function MaturityRow({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{ width: 80, flexShrink: 0, fontWeight: 500, fontSize: 12, color: "#55524C" }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 8,
          background: "#F1EADC",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {count > 0 && (
          <div
            style={{
              width: `${Math.max(pct, 5)}%`,
              height: "100%",
              background: color,
              borderRadius: 4,
            }}
          />
        )}
      </div>
      <span
        style={{
          width: 20,
          textAlign: "right",
          fontWeight: 700,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: "#1A1C1E",
        }}
      >
        {count}
      </span>
    </div>
  );
}

function InventoryCell({
  value,
  label,
  border,
}: {
  value: string;
  label: string;
  border?: boolean;
}) {
  return (
    <div
      style={{
        borderLeft: border ? "1px solid #EEE5D3" : undefined,
        paddingLeft: border ? 22 : undefined,
      }}
    >
      <div
        style={{
          fontWeight: 800,
          fontSize: 22,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: "#1A1C1E",
          marginBottom: 5,
        }}
      >
        {value}
      </div>
      <div style={{ fontWeight: 500, fontSize: 11, lineHeight: 1.3, color: "#8E9196" }}>
        {label}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default async function DashboardPage() {
  const [statsRes, maturityRes, summaryRes, registryMetrics] = await Promise.all([
    fetchDashboardStats(),
    fetchMaturity(),
    cloudRunFetch<SummaryData>("/api/summary"),
    fetchOverviewMetrics(),
  ]);

  const stats = statsRes.data;
  const maturity = maturityRes.data?.data ?? [];
  const summary = summaryRes.data;

  if (!stats || !summary) {
    return (
      <div style={{ padding: 32 }}>
        <div
          className="card"
          style={{ padding: 16, color: "var(--alert-red)", fontSize: 13 }}
        >
          <strong>API error:</strong> {statsRes.error || summaryRes.error}
        </div>
      </div>
    );
  }

  /* Maturity tier counts */
  const tierCounts = maturity.reduce(
    (acc, m) => {
      if (m.tier) {
        const key = m.tier.toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );
  const maxTier = Math.max(...Object.values(tierCounts), 1);

  /* Funnel — pull "researched" from prospectsByStatus if present */
  const prospectTotal = Number(stats.prospects.total);
  const funnelMax = prospectTotal || 1;
  const researchedCount =
    stats.prospectsByStatus?.find(
      (s) => s.outreach_status?.toLowerCase() === "researched"
    )?.count ?? 0;

  /* Empty-state helpers */
  const activeClients = Number(stats.clients.active);
  const arr = Number(stats.clients.arr);
  const pipelineTotal = Number(stats.pipeline.total);
  const pipelineValue = Number(stats.pipeline.total_value);
  const contentTotal = Number(stats.content.total);
  const contentPublished = Number(stats.content.published);

  /* Date for header */
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div>
          <div className="page-breadcrumb">
            AfricanSTN &middot; Cross-module overview
          </div>
          <h1>Dashboard</h1>
        </div>
        <div
          style={{
            fontWeight: 500,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "#8E9196",
            textAlign: "right",
          }}
        >
          Live state &middot; {dateStr}
          <br />
          Registry &middot; compliance &middot; intelligence
        </div>
      </div>

      {/* Hero KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <HeroKpi
          value={registryMetrics.totalOrganisations.toLocaleString("en-GB")}
          label="Organisations"
          sub={`${registryMetrics.totalCountries} countries · ${registryMetrics.totalSports} sports`}
        />
        <HeroKpi
          value={String(registryMetrics.totalCountries)}
          label="Countries tracked"
          sub="Data-protection intelligence"
        />
        <HeroKpi
          value={String(summary.stats.prospects)}
          label="Compliance prospects"
          sub={
            Number(stats.prospects.high_priority) > 0
              ? `${stats.prospects.high_priority} high priority`
              : undefined
          }
        />
        <HeroKpi
          value={String(activeClients)}
          label="Active clients"
          sub={activeClients === 0 ? "Awaiting first conversion" : undefined}
          empty={activeClients === 0}
        />
        <HeroKpi
          value={arr > 0 ? `£${arr.toLocaleString("en-GB")}` : "£0"}
          label="ARR"
          sub={arr === 0 ? "No active engagements" : undefined}
          empty={arr === 0}
        />
      </div>

      {/* Funnel + Maturity */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        {/* Outreach funnel */}
        <div className="card" style={{ padding: "20px 22px", borderRadius: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: 15, margin: 0 }}>Outreach funnel</h2>
            <Link
              href="/compliance"
              style={{ fontWeight: 600, fontSize: 11.5, color: "var(--gold-dark)" }}
            >
              Compliance &rarr;
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <FunnelRow label="Identified" value={Number(stats.prospects.identified)} max={funnelMax} />
            <FunnelRow label="Researched" value={Number(researchedCount)} max={funnelMax} empty={researchedCount === 0} />
            <FunnelRow label="Contacted" value={Number(stats.prospects.contacted)} max={funnelMax} empty={Number(stats.prospects.contacted) === 0} />
            <FunnelRow label="Responded" value={Number(stats.prospects.responded)} max={funnelMax} empty={Number(stats.prospects.responded) === 0} />
            <FunnelRow label="Converted" value={Number(stats.prospects.converted)} max={funnelMax} empty={Number(stats.prospects.converted) === 0} />
          </div>
        </div>

        {/* DPMI maturity distribution */}
        <div className="card" style={{ padding: "20px 22px", borderRadius: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: 15, margin: 0 }}>DPMI maturity distribution</h2>
            <Link
              href="/data-protection"
              style={{ fontWeight: 600, fontSize: 11.5, color: "var(--gold-dark)" }}
            >
              Data protection &rarr;
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {(["Leader", "Advanced", "Developing", "Nascent", "Absent"] as const).map(
              (tier) => (
                <MaturityRow
                  key={tier}
                  label={tier}
                  count={tierCounts[tier.toLowerCase()] ?? 0}
                  max={maxTier}
                  color={TIER_COLOURS[tier.toLowerCase()] ?? "#8E9196"}
                />
              )
            )}
          </div>
        </div>
      </div>

      {/* Sector + Pipeline/Content */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        {/* Prospects by sector */}
        <div className="card" style={{ padding: "20px 22px", borderRadius: 12 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 16px" }}>Prospects by sector</h2>
          {(stats.prospectsBySector || []).length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(stats.prospectsBySector || []).map((s) => (
                <div
                  key={s.sector}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "13px 15px",
                    background: "#FAF6EE",
                    border: "1px solid #EEE5D3",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, color: "#1A1C1E" }}>
                    {s.sector}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--gold-dark)",
                    }}
                  >
                    {Number(s.count)}
                  </span>
                </div>
              ))}
              <p
                style={{
                  fontWeight: 500,
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: "#A29C8E",
                  margin: "4px 0 0",
                }}
              >
                Sector spread widens as the pipeline diversifies.
              </p>
            </div>
          ) : (
            <div className="card-empty" style={{ padding: 20, textAlign: "center" }}>
              <span style={{ fontWeight: 500, fontSize: 12, color: "#B9B2A2" }}>
                No prospects yet
              </span>
            </div>
          )}
        </div>

        {/* Pipeline + Content */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div
            className="card"
            style={{
              padding: 20,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h2 style={{ fontSize: 14, margin: "0 0 14px" }}>BD pipeline</h2>
            <div
              style={{
                fontWeight: 800,
                fontSize: 26,
                fontVariantNumeric: "tabular-nums",
                color: pipelineValue > 0 ? "#1A1C1E" : "#B9B2A2",
                marginBottom: 4,
              }}
            >
              {pipelineValue > 0
                ? `£${pipelineValue.toLocaleString("en-GB")}`
                : "£0"}
            </div>
            <div
              style={{
                fontWeight: 500,
                fontSize: 11.5,
                lineHeight: 1.4,
                color: "#8E9196",
                flex: 1,
              }}
            >
              {pipelineTotal} opportunities &middot;{" "}
              {pipelineValue === 0 ? "no value yet" : "total value"}
            </div>
            <Link
              href="/pipeline"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 16,
                fontWeight: 600,
                fontSize: 12,
                color: "#141414",
                background: "#C5A059",
                borderRadius: 7,
                padding: 10,
                textDecoration: "none",
              }}
            >
              Add opportunity
            </Link>
          </div>

          <div
            className="card"
            style={{
              padding: 20,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h2 style={{ fontSize: 14, margin: "0 0 14px" }}>Content engine</h2>
            <div
              style={{
                fontWeight: 800,
                fontSize: 26,
                fontVariantNumeric: "tabular-nums",
                color: contentTotal > 0 ? "#1A1C1E" : "#B9B2A2",
                marginBottom: 4,
              }}
            >
              {contentTotal}
            </div>
            <div
              style={{
                fontWeight: 500,
                fontSize: 11.5,
                lineHeight: 1.4,
                color: "#8E9196",
                flex: 1,
              }}
            >
              editions &middot; {contentPublished} published &middot;{" "}
              {Number(stats.content.in_progress)} in progress
            </div>
            <Link
              href="/content"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 16,
                fontWeight: 600,
                fontSize: 12,
                color: "var(--gold-dark)",
                background: "#fff",
                border: "1px solid #D4C5A9",
                borderRadius: 7,
                padding: 10,
                textDecoration: "none",
              }}
            >
              Manage content
            </Link>
          </div>
        </div>
      </div>

      {/* Data inventory */}
      <div className="card" style={{ padding: "20px 22px", borderRadius: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#8E9196",
              margin: 0,
            }}
          >
            Data inventory
          </h2>
          <div style={{ flex: 1, height: 1, background: "#EEE5D3" }} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 22,
          }}
        >
          <InventoryCell
            value={registryMetrics.totalPartnerships.toLocaleString("en-GB")}
            label="Partnerships tracked"
          />
          <InventoryCell
            value={summary.stats.classified_items.toLocaleString("en-GB")}
            label="Classified items"
            border
          />
          <InventoryCell
            value={String(summary.stats.enforcement_actions)}
            label="Enforcement actions"
            border
          />
          <InventoryCell
            value={registryMetrics.itemsThisWeek.toLocaleString("en-GB")}
            label="Items this week"
            border
          />
          <InventoryCell value="446" label="Pending verification" border />
        </div>
      </div>
    </div>
  );
}

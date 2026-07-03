/**
 * Cross-module dashboard — unified view of all OS modules.
 * Server component fetching from /api/dashboard/stats, /api/maturity, /api/summary.
 */

import { fetchDashboardStats } from "@/lib/data/pipeline";
import { fetchMaturity } from "@/lib/data/data-protection";
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

function KpiCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: string | number;
  href?: string;
  accent?: boolean;
}) {
  const inner = (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        accent
          ? "border-[#C5A059] bg-[#C5A059]/5"
          : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className={`text-3xl font-bold ${accent ? "text-[#C5A059]" : "text-[#1A1C1E]"}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

function FunnelBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 w-24">{label}</span>
      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="text-sm font-medium text-[#1A1C1E] w-8 text-right">{value}</span>
    </div>
  );
}

function TierDot({ tier, count }: { tier: string; count: number }) {
  const colours: Record<string, string> = {
    Leader: "bg-emerald-500",
    Advanced: "bg-blue-500",
    Developing: "bg-amber-500",
    Nascent: "bg-orange-500",
    Absent: "bg-red-500",
  };
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${colours[tier] ?? "bg-gray-400"}`} />
      <span className="text-sm text-gray-600">{tier}</span>
      <span className="text-sm font-bold text-[#1A1C1E] ml-auto">{count}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const [statsRes, maturityRes, summaryRes] = await Promise.all([
    fetchDashboardStats(),
    fetchMaturity(),
    cloudRunFetch<SummaryData>("/api/summary"),
  ]);

  const stats = statsRes.data;
  const maturity = maturityRes.data?.data ?? [];
  const summary = summaryRes.data;

  if (!stats || !summary) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong> {statsRes.error || summaryRes.error}
        </div>
      </div>
    );
  }

  const tierCounts = maturity.reduce((acc, m) => {
    if (m.tier) acc[m.tier] = (acc[m.tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const prospectTotal = Number(stats.prospects.total);
  const funnelMax = prospectTotal || 1;

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">AfricanSTN dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cross-module overview &middot; v{summary.version} &middot;{" "}
          {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Countries tracked" value={summary.stats.countries} href="/data-protection" />
        <KpiCard label="Organisations" value={summary.stats.organizations.toLocaleString()} />
        <KpiCard label="Prospects" value={summary.stats.prospects} href="/compliance" />
        <KpiCard label="Active clients" value={Number(stats.clients.active)} href="/compliance" accent />
        <KpiCard
          label="ARR (GBP)"
          value={`£${Number(stats.clients.arr).toLocaleString()}`}
          accent
        />
      </div>

      {/* Two-column layout */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Left — Outreach funnel */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1A1C1E]">Outreach funnel</h2>
            <Link href="/compliance" className="text-sm text-[#C5A059] hover:underline">View all</Link>
          </div>
          <div className="space-y-3 p-4 border border-gray-200 rounded-xl">
            <FunnelBar label="Identified" value={Number(stats.prospects.identified)} max={funnelMax} color="bg-gray-400" />
            <FunnelBar label="Contacted" value={Number(stats.prospects.contacted)} max={funnelMax} color="bg-amber-400" />
            <FunnelBar label="Responded" value={Number(stats.prospects.responded)} max={funnelMax} color="bg-emerald-400" />
            <FunnelBar label="Converted" value={Number(stats.prospects.converted)} max={funnelMax} color="bg-[#C5A059]" />
          </div>
        </section>

        {/* Right — Maturity distribution */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1A1C1E]">Maturity distribution</h2>
            <Link href="/data-protection" className="text-sm text-[#C5A059] hover:underline">View all</Link>
          </div>
          <div className="space-y-3 p-4 border border-gray-200 rounded-xl">
            {["Leader", "Advanced", "Developing", "Nascent", "Absent"].map((tier) => (
              <TierDot key={tier} tier={tier} count={tierCounts[tier] ?? 0} />
            ))}
          </div>
        </section>

        {/* Left — Sectors */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[#1A1C1E]">Prospects by sector</h2>
          <div className="space-y-2 p-4 border border-gray-200 rounded-xl">
            {(stats.prospectsBySector || []).map((s) => (
              <div key={s.sector} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{s.sector}</span>
                <span className="font-medium text-[#1A1C1E]">{Number(s.count)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right — Pipeline + Content */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[#1A1C1E]">Pipeline and content</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border border-gray-200 rounded-xl">
              <div className="text-2xl font-bold text-[#1A1C1E]">{Number(stats.pipeline.total)}</div>
              <div className="text-xs text-gray-500 mt-1">Pipeline opportunities</div>
              <div className="text-sm text-[#C5A059] mt-2">
                £{Number(stats.pipeline.total_value).toLocaleString()} total value
              </div>
            </div>
            <div className="p-4 border border-gray-200 rounded-xl">
              <div className="text-2xl font-bold text-[#1A1C1E]">{Number(stats.content.total)}</div>
              <div className="text-xs text-gray-500 mt-1">Content editions</div>
              <div className="text-sm text-gray-500 mt-2">
                {Number(stats.content.published)} published &middot; {Number(stats.content.in_progress)} in progress
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Link
              href="/pipeline"
              className="p-3 text-center border border-gray-200 rounded-lg text-sm text-[#C5A059] hover:bg-[#C5A059]/5 transition-colors"
            >
              Manage pipeline
            </Link>
            <Link
              href="/content"
              className="p-3 text-center border border-gray-200 rounded-lg text-sm text-[#C5A059] hover:bg-[#C5A059]/5 transition-colors"
            >
              Manage content
            </Link>
          </div>
        </section>
      </div>

      {/* Data inventory */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Data inventory</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Countries", value: summary.stats.countries },
            { label: "Organisations", value: summary.stats.organizations.toLocaleString() },
            { label: "Partners", value: summary.stats.partners },
            { label: "Classified items", value: summary.stats.classified_items.toLocaleString() },
            { label: "Enforcement actions", value: summary.stats.enforcement_actions },
            { label: "Weekly reports", value: summary.stats.weekly_reports },
            { label: "Prospects", value: summary.stats.prospects },
            { label: "Clients", value: summary.stats.clients },
            { label: "Pipeline", value: summary.stats.pipeline_opportunities },
            { label: "Editions", value: summary.stats.content_editions },
          ].map((item) => (
            <div key={item.label} className="p-3 border border-gray-100 rounded-lg text-center">
              <div className="text-lg font-bold text-[#1A1C1E]">{item.value}</div>
              <div className="text-xs text-gray-400">{item.label}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

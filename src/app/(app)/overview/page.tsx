import CounterCard from "@/components/CounterCard";
import HorizontalBarChart from "@/components/HorizontalBarChart";
import RecentItemsFeed from "@/components/RecentItemsFeed";
import {
  fetchOverviewMetrics,
  fetchTopCountries,
  fetchTopOrgTypes,
  fetchRecentItems,
} from "@/lib/data/overview";

/**
 * Overview page - the home page after sign-in.
 *
 * Layout per memo Section 3.2:
 *   - Page heading "Overview"
 *   - Row of counter cards with the headline numbers
 *   - Two charts side by side - top countries, top org types
 *   - Recent activity feed below
 *
 * Data is fetched server-side on each request. Caching is intentionally
 * disabled in v1 so the operator always sees the live state of the database.
 * v1.2 may introduce 60-second caching for the heavier aggregations if
 * performance suffers.
 */
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [metrics, topCountries, topOrgTypes, recentItems] = await Promise.all([
    fetchOverviewMetrics(),
    fetchTopCountries(10),
    fetchTopOrgTypes(10),
    fetchRecentItems(15),
  ]);

  // Today's date in the brand format
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1>Overview</h1>
          <p className="text-caption text-warm-grey mt-1">
            Live state of the registry as of {today}
          </p>
        </div>
      </div>

      {/* Counters */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <CounterCard value={metrics.totalOrganisations} label="Organisations" />
        <CounterCard value={metrics.totalCountries} label="Countries + pan-African" />
        <CounterCard value={metrics.totalSports} label="Sports" />
        <CounterCard
          value={metrics.highConfidencePercent.toFixed(1)}
          unit="%"
          label="Verified at High"
        />
        <CounterCard value={metrics.totalPartnerships} label="Partnerships tracked" />
        <CounterCard value={metrics.itemsThisWeek} label="Items this week" />
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="mb-4">Top countries</h2>
          <HorizontalBarChart
            data={topCountries}
            labelKey="country"
            valueKey="count"
          />
        </div>
        <div className="card p-5">
          <h2 className="mb-4">Top organisation types</h2>
          <HorizontalBarChart
            data={topOrgTypes}
            labelKey="type"
            valueKey="count"
          />
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <h2 className="mb-4">Recent intelligence</h2>
        <RecentItemsFeed items={recentItems} />
      </section>
    </div>
  );
}

/**
 * BD Pipeline page.
 * Shows business development opportunities, dashboard stats, and interactions.
 */

import {
  fetchPipeline,
  fetchDashboardStats,
  type PipelineOpportunity,
} from "@/lib/data/pipeline";

const STAGE_COLOURS: Record<string, string> = {
  identified: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-800",
  proposal: "bg-amber-100 text-amber-800",
  negotiation: "bg-purple-100 text-purple-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-700",
};

export default async function PipelinePage() {
  const [pipelineRes, statsRes] = await Promise.all([
    fetchPipeline(),
    fetchDashboardStats(),
  ]);

  const opportunities = pipelineRes.data?.data ?? [];
  const stats = statsRes.data;

  const totalValue = opportunities.reduce(
    (sum, o) => sum + (o.value_gbp ?? 0),
    0
  );
  const byStage = opportunities.reduce(
    (acc, o) => {
      acc[o.stage] = (acc[o.stage] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">
          Business development pipeline
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Opportunities &middot; revenue tracking &middot; interactions
        </p>
      </div>

      {/* Dashboard stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Pipeline opportunities"
            value={stats.pipeline.total.toString()}
          />
          <StatCard
            label="Total value (GBP)"
            value={`£${Number(stats.pipeline.total_value).toLocaleString()}`}
          />
          <StatCard
            label="Active value (GBP)"
            value={`£${Number(stats.pipeline.active_value).toLocaleString()}`}
          />
          <StatCard label="Won" value={stats.pipeline.won.toString()} />
        </div>
      )}

      {/* Stage funnel */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Stage breakdown
        </h2>
        <div className="flex flex-wrap gap-3">
          {[
            "identified",
            "qualified",
            "proposal",
            "negotiation",
            "won",
            "lost",
          ].map((stage) => (
            <div
              key={stage}
              className="px-4 py-2 rounded-lg border border-gray-200 text-center min-w-[100px]"
            >
              <div className="text-xl font-bold text-[#1A1C1E]">
                {byStage[stage] ?? 0}
              </div>
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLOURS[stage] ?? "bg-gray-100 text-gray-700"}`}
              >
                {stage}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Opportunities table */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Opportunities
        </h2>
        {opportunities.length === 0 ? (
          <p className="text-sm text-gray-500">
            No pipeline opportunities yet.
          </p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1A1C1E] text-white">
                  <th className="px-3 py-2 text-left font-medium">
                    Opportunity
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Prospect / client
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Service
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Value (GBP)
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Expected close
                  </th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o, i) => (
                  <tr
                    key={o.id}
                    className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    <td className="px-3 py-2 font-medium text-[#1A1C1E]">
                      {o.opportunity_name}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {o.prospect_name || o.client_name || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {o.service_type ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLOURS[o.stage] ?? "bg-gray-100 text-gray-700"}`}
                      >
                        {o.stage}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {o.value_gbp != null
                        ? `£${o.value_gbp.toLocaleString()}`
                        : "—"}
                      {o.value_recurring && (
                        <span className="text-xs text-[#C5A059] ml-1">
                          /yr
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {o.expected_close_date
                        ? new Date(
                            o.expected_close_date
                          ).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cross-module summary from dashboard stats */}
      {stats && (
        <section>
          <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
            Cross-module summary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <SummaryCard
              title="Compliance prospects"
              items={[
                { label: "Total", value: stats.prospects.total },
                { label: "High priority", value: stats.prospects.high_priority },
                { label: "Contacted", value: stats.prospects.contacted },
              ]}
            />
            <SummaryCard
              title="Clients"
              items={[
                { label: "Total", value: stats.clients.total },
                { label: "Active", value: stats.clients.active },
                {
                  label: "ARR",
                  value: `£${Number(stats.clients.arr).toLocaleString()}`,
                },
              ]}
            />
            <SummaryCard
              title="Content"
              items={[
                { label: "Editions", value: stats.content.total },
                { label: "Published", value: stats.content.published },
                { label: "In progress", value: stats.content.in_progress },
              ]}
            />
          </div>
        </section>
      )}

      {/* Errors */}
      {(pipelineRes.error || statsRes.error) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong>{" "}
          {pipelineRes.error || statsRes.error}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function SummaryCard({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: number | string }>;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-[#1A1C1E] text-sm mb-2">{title}</h3>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex justify-between text-xs"
          >
            <span className="text-gray-500">{item.label}</span>
            <span className="font-medium text-[#1A1C1E]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

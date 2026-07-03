/**
 * Data Protection Intelligence page.
 * Shows countries, maturity scores, and enforcement actions from the Cloud Run API.
 */

import {
  fetchCountries,
  fetchMaturity,
  fetchEnforcement,
  type Country,
  type MaturityRow,
  type EnforcementAction,
} from "@/lib/data/data-protection";

// Brand tokens
const TIER_COLOURS: Record<string, string> = {
  Leader: "bg-emerald-100 text-emerald-800",
  Advanced: "bg-blue-100 text-blue-800",
  Developing: "bg-amber-100 text-amber-800",
  Nascent: "bg-orange-100 text-orange-800",
  Absent: "bg-red-100 text-red-800",
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIER_COLOURS[tier] ?? "bg-gray-100 text-gray-700"}`}
    >
      {tier}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-gray-400">—</span>;
  const pct = Math.round(score * 10);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#C5A059] rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-600">{score.toFixed(1)}</span>
    </div>
  );
}

export default async function DataProtectionPage() {
  const [countriesRes, maturityRes, enforcementRes] = await Promise.all([
    fetchCountries(),
    fetchMaturity(),
    fetchEnforcement(),
  ]);

  const countries = countriesRes.data?.data ?? [];
  const maturity = maturityRes.data?.data ?? [];
  const enforcement = enforcementRes.data?.data ?? [];

  // Aggregate stats
  const withLaw = countries.filter((c) => c.has_dp_law).length;
  const withAuthority = countries.filter((c) => c.authority_name).length;
  const tierCounts = maturity.reduce(
    (acc, m) => {
      if (m.tier) acc[m.tier] = (acc[m.tier] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">
          Data protection intelligence
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {countries.length} African countries tracked &middot; maturity scores
          &middot; enforcement actions
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Countries tracked" value={countries.length} />
        <StatCard label="With DP law" value={withLaw} />
        <StatCard label="With authority" value={withAuthority} />
        <StatCard
          label="Enforcement actions"
          value={enforcement.length}
        />
      </div>

      {/* Tier distribution */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Maturity tier distribution
        </h2>
        <div className="flex flex-wrap gap-3">
          {["Leader", "Advanced", "Developing", "Nascent", "Absent"].map(
            (tier) => (
              <div
                key={tier}
                className="px-4 py-2 rounded-lg border border-gray-200 text-center min-w-[100px]"
              >
                <div className="text-xl font-bold text-[#1A1C1E]">
                  {tierCounts[tier] ?? 0}
                </div>
                <TierBadge tier={tier} />
              </div>
            )
          )}
        </div>
      </section>

      {/* Maturity table */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Country maturity scores
        </h2>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1A1C1E] text-white">
                <th className="px-3 py-2 text-left font-medium">Country</th>
                <th className="px-3 py-2 text-left font-medium">DP law</th>
                <th className="px-3 py-2 text-left font-medium">Authority</th>
                <th className="px-3 py-2 text-left font-medium">Score</th>
                <th className="px-3 py-2 text-left font-medium">Tier</th>
              </tr>
            </thead>
            <tbody>
              {maturity.map((m, i) => (
                <tr
                  key={m.country_name}
                  className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                >
                  <td className="px-3 py-2 font-medium text-[#1A1C1E]">
                    {m.country_name}
                  </td>
                  <td className="px-3 py-2">
                    {m.has_dp_law ? (
                      <span className="text-emerald-600">Yes</span>
                    ) : (
                      <span className="text-red-500">No</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">
                    {m.authority_name ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ScoreBar score={m.overall_score} />
                  </td>
                  <td className="px-3 py-2">
                    <TierBadge tier={m.tier} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent enforcement */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Recent enforcement actions
        </h2>
        {enforcement.length === 0 ? (
          <p className="text-sm text-gray-500">No enforcement actions recorded.</p>
        ) : (
          <div className="space-y-3">
            {enforcement.slice(0, 10).map((e) => (
              <div
                key={e.id}
                className="border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-[#1A1C1E]">
                      {e.country_name}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {e.description}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-400 whitespace-nowrap ml-4">
                    {e.action_date
                      ? new Date(e.action_date).toLocaleDateString("en-GB")
                      : "—"}
                  </div>
                </div>
                {e.entity_involved && (
                  <div className="text-xs text-gray-500 mt-2">
                    Entity: {e.entity_involved}
                  </div>
                )}
                {e.penalty_amount != null && (
                  <div className="text-xs font-medium text-[#C5A059] mt-1">
                    Penalty: {e.penalty_currency} {e.penalty_amount.toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Error states */}
      {(countriesRes.error || maturityRes.error || enforcementRes.error) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong>{" "}
          {countriesRes.error || maturityRes.error || enforcementRes.error}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

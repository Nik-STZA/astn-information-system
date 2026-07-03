"use client";

import { useState } from "react";
import type { Country, MaturityRow, EnforcementAction } from "@/lib/data/data-protection";

// ─── Constants ──────────────────────────────────────────────────────────────

const TIERS = ["leader", "advanced", "developing", "nascent", "absent"];

const TIER_COLOURS: Record<string, string> = {
  leader: "bg-emerald-100 text-emerald-800",
  advanced: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  nascent: "bg-orange-100 text-orange-800",
  absent: "bg-red-100 text-red-800",
};

/** Capitalise first letter for display */
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-gray-400">—</span>;
  const key = tier.toLowerCase();
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIER_COLOURS[key] ?? "bg-gray-100 text-gray-700"}`}>
      {cap(key)}
    </span>
  );
}

function ScoreBar({ score }: { score: number | string | null }) {
  if (score == null) return <span className="text-xs text-gray-400">—</span>;
  const n = Number(score);
  if (isNaN(n)) return <span className="text-xs text-gray-400">—</span>;
  const pct = Math.round(n * 10);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-[#C5A059] rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600">{n.toFixed(1)}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

// ─── Sub-score bar for detail view ──────────────────────────────────────────

function SubScoreRow({ label, score }: { label: string; score: number | string | null }) {
  if (score == null) return null;
  const n = Number(score);
  if (isNaN(n)) return null;
  const pct = Math.round(n * 10);
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 w-44">{label}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-[#C5A059] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium text-[#1A1C1E] w-10 text-right">{n.toFixed(1)}</span>
    </div>
  );
}

// ─── Sort helper ────────────────────────────────────────────────────────────

type SortField = "country_name" | "overall_score" | "tier" | "has_dp_law";
type SortDir = "asc" | "desc";

function sortMaturity(data: MaturityRow[], field: SortField, dir: SortDir): MaturityRow[] {
  return [...data].sort((a, b) => {
    let cmp = 0;
    if (field === "country_name") {
      cmp = (a.country_name ?? "").localeCompare(b.country_name ?? "");
    } else if (field === "overall_score") {
      cmp = (a.overall_score ?? -1) - (b.overall_score ?? -1);
    } else if (field === "tier") {
      const order = { Leader: 0, Advanced: 1, Developing: 2, Nascent: 3, Absent: 4 };
      cmp = (order[a.tier as keyof typeof order] ?? 5) - (order[b.tier as keyof typeof order] ?? 5);
    } else if (field === "has_dp_law") {
      cmp = (a.has_dp_law ? 1 : 0) - (b.has_dp_law ? 1 : 0);
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

// ─── Country detail panel ───────────────────────────────────────────────────

function CountryDetail({
  row,
  enforcement,
  onClose,
}: {
  row: MaturityRow;
  enforcement: EnforcementAction[];
  onClose: () => void;
}) {
  const countryEnforcement = enforcement.filter(
    (e) => e.country_name === row.country_name
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-xl overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#1A1C1E]">{row.country_name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Overview */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <div className="text-2xl font-bold text-[#1A1C1E]">
                {row.overall_score != null ? Number(row.overall_score).toFixed(1) : "—"}
              </div>
              <div className="text-xs text-gray-500 mt-1">Overall score</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <TierBadge tier={row.tier} />
              <div className="text-xs text-gray-500 mt-2">Tier</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <div className="text-2xl">
                {row.has_dp_law ? <span className="text-emerald-600">Yes</span> : <span className="text-red-500">No</span>}
              </div>
              <div className="text-xs text-gray-500 mt-1">DP law</div>
            </div>
          </div>

          {/* Authority */}
          {row.authority_name && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">Supervisory authority</h4>
              <p className="text-sm text-gray-600">{row.authority_name}</p>
            </div>
          )}

          {/* Law status */}
          {row.law_status && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">Law status</h4>
              <p className="text-sm text-gray-600">{row.law_status}</p>
            </div>
          )}

          {/* Sub-scores */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Maturity breakdown (DPMI v2.0)</h4>
            <div className="space-y-3">
              <SubScoreRow label="Regulatory maturity (30%)" score={row.regulatory_maturity} />
              <SubScoreRow label="Enforcement activity (25%)" score={row.enforcement_activity} />
              <SubScoreRow label="Business friendliness (25%)" score={row.business_friendliness} />
              <SubScoreRow label="Cross-border complexity (20%)" score={row.cross_border_complexity} />
            </div>
          </div>

          {/* Children's protections */}
          {row.children_protections != null && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">Children's data protections</h4>
              <ScoreBar score={row.children_protections} />
            </div>
          )}

          {/* Enforcement actions */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">
              Enforcement actions ({countryEnforcement.length})
            </h4>
            {countryEnforcement.length === 0 ? (
              <p className="text-sm text-gray-400">No enforcement actions recorded</p>
            ) : (
              <div className="space-y-3">
                {countryEnforcement.map((e) => (
                  <div key={e.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex justify-between">
                      <div className="text-sm text-gray-700">{e.description}</div>
                      <div className="text-xs text-gray-400 whitespace-nowrap ml-3">
                        {e.action_date ? new Date(e.action_date).toLocaleDateString("en-GB") : "—"}
                      </div>
                    </div>
                    {e.entity_involved && (
                      <div className="text-xs text-gray-500 mt-1">Entity: {e.entity_involved}</div>
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
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function DataProtectionClient({
  countries,
  maturity,
  enforcement,
}: {
  countries: Country[];
  maturity: MaturityRow[];
  enforcement: EnforcementAction[];
}) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [lawFilter, setLawFilter] = useState<"" | "yes" | "no">("");
  const [sortField, setSortField] = useState<SortField>("overall_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedCountry, setSelectedCountry] = useState<MaturityRow | null>(null);

  // Stats
  const withLaw = countries.filter((c) => c.has_dp_law).length;
  const withAuthority = countries.filter((c) => c.authority_name).length;
  const tierCounts = maturity.reduce((acc, m) => {
    if (m.tier) {
      const key = m.tier.toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Filter and sort
  const filtered = maturity.filter((m) => {
    if (search && !m.country_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (tierFilter && m.tier !== tierFilter) return false;
    if (lawFilter === "yes" && !m.has_dp_law) return false;
    if (lawFilter === "no" && m.has_dp_law) return false;
    return true;
  });

  const sorted = sortMaturity(filtered, sortField, sortDir);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "country_name" ? "asc" : "desc");
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">Data protection intelligence</h1>
        <p className="text-sm text-gray-500 mt-1">
          {countries.length} African countries tracked &middot; DPMI v2.0 methodology
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Countries tracked" value={countries.length} />
        <StatCard label="With DP law" value={withLaw} />
        <StatCard label="With authority" value={withAuthority} />
        <StatCard label="Enforcement actions" value={enforcement.length} />
      </div>

      {/* Tier distribution — clickable filters */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Maturity tier distribution</h2>
        <div className="flex flex-wrap gap-3">
          {TIERS.map((tier) => (
            <button
              key={tier}
              onClick={() => setTierFilter(tierFilter === tier ? "" : tier)}
              className={`px-4 py-2 rounded-lg border text-center min-w-[100px] transition-colors ${
                tierFilter === tier ? "border-[#C5A059] bg-[#C5A059]/10" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-xl font-bold text-[#1A1C1E]">{tierCounts[tier] ?? 0}</div>
              <TierBadge tier={tier} />
            </button>
          ))}
        </div>
      </section>

      {/* Search and filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by country..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#C5A059]"
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{cap(t)}</option>)}
        </select>
        <select
          value={lawFilter}
          onChange={(e) => setLawFilter(e.target.value as "" | "yes" | "no")}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">DP law: all</option>
          <option value="yes">Has DP law</option>
          <option value="no">No DP law</option>
        </select>
        {(search || tierFilter || lawFilter) && (
          <button
            onClick={() => { setSearch(""); setTierFilter(""); setLawFilter(""); }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
        <span className="text-sm text-gray-400 ml-auto">
          Showing {sorted.length} of {maturity.length}
        </span>
      </div>

      {/* Maturity table — sortable, clickable rows */}
      <section>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1A1C1E] text-white">
                <th className="px-3 py-2 text-left font-medium cursor-pointer hover:text-[#C5A059]" onClick={() => toggleSort("country_name")}>
                  Country{sortIcon("country_name")}
                </th>
                <th className="px-3 py-2 text-left font-medium cursor-pointer hover:text-[#C5A059]" onClick={() => toggleSort("has_dp_law")}>
                  DP law{sortIcon("has_dp_law")}
                </th>
                <th className="px-3 py-2 text-left font-medium">Authority</th>
                <th className="px-3 py-2 text-left font-medium cursor-pointer hover:text-[#C5A059]" onClick={() => toggleSort("overall_score")}>
                  Score{sortIcon("overall_score")}
                </th>
                <th className="px-3 py-2 text-left font-medium cursor-pointer hover:text-[#C5A059]" onClick={() => toggleSort("tier")}>
                  Tier{sortIcon("tier")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No countries match your filters</td></tr>
              ) : (
                sorted.map((m, i) => (
                  <tr
                    key={m.country_name}
                    onClick={() => setSelectedCountry(m)}
                    className={`cursor-pointer transition-colors ${
                      i % 2 === 0 ? "bg-white hover:bg-[#C5A059]/5" : "bg-gray-50 hover:bg-[#C5A059]/5"
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-[#1A1C1E]">{m.country_name}</td>
                    <td className="px-3 py-2">
                      {m.has_dp_law ? <span className="text-emerald-600">Yes</span> : <span className="text-red-500">No</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">{m.authority_name ?? "—"}</td>
                    <td className="px-3 py-2"><ScoreBar score={m.overall_score} /></td>
                    <td className="px-3 py-2"><TierBadge tier={m.tier} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent enforcement */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Recent enforcement actions</h2>
        {enforcement.length === 0 ? (
          <p className="text-sm text-gray-500">No enforcement actions recorded.</p>
        ) : (
          <div className="space-y-3">
            {enforcement.slice(0, 10).map((e) => (
              <div
                key={e.id}
                className="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-[#C5A059]/50 transition-colors"
                onClick={() => {
                  const row = maturity.find(m => m.country_name === e.country_name);
                  if (row) setSelectedCountry(row);
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-[#1A1C1E]">{e.country_name}</div>
                    <div className="text-sm text-gray-600 mt-1">{e.description}</div>
                  </div>
                  <div className="text-right text-xs text-gray-400 whitespace-nowrap ml-4">
                    {e.action_date ? new Date(e.action_date).toLocaleDateString("en-GB") : "—"}
                  </div>
                </div>
                {e.entity_involved && <div className="text-xs text-gray-500 mt-2">Entity: {e.entity_involved}</div>}
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

      {/* Country detail slide-out */}
      {selectedCountry && (
        <CountryDetail
          row={selectedCountry}
          enforcement={enforcement}
          onClose={() => setSelectedCountry(null)}
        />
      )}
    </div>
  );
}

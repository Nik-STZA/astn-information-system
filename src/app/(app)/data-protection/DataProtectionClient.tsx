"use client";

import { useState } from "react";
import type { Country, MaturityRow, EnforcementAction } from "@/lib/data/data-protection";

/* ── Tier metadata ─────────────────────────────────────────────── */

const TIER_META: Record<string, { color: string; bg: string; border: string }> = {
  leader:     { color: "#2E7D32", bg: "#E7F1EA", border: "#C7E1D1" },
  advanced:   { color: "#3E6B8E", bg: "#E7EEF4", border: "#C6D8E5" },
  developing: { color: "#C5A059", bg: "#FBF1DE", border: "#EAD6A6" },
  nascent:    { color: "#CC7700", bg: "#FBE7DB", border: "#EDD0B5" },
  absent:     { color: "#CC0000", bg: "#FBE3E3", border: "#E6C4C4" },
};
const TIER_UNSET = { color: "#8E9196", bg: "#EEECE7", border: "#DED9CE" };
const TIER_ORDER = ["leader", "advanced", "developing", "nascent", "absent"];

function tierMeta(tier: string | null) {
  if (!tier) return TIER_UNSET;
  return TIER_META[tier.toLowerCase()] ?? TIER_UNSET;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── Flag helper ───────────────────────────────────────────────── */

function flagUrl(iso: string | null | undefined, size = 40): string | null {
  if (!iso) return null;
  return `https://flagcdn.com/w${size}/${iso.toLowerCase()}.png`;
}

/* ── TierPill ──────────────────────────────────────────────────── */

function TierPill({ tier }: { tier: string | null }) {
  const m = tierMeta(tier);
  const label = tier ? cap(tier.toLowerCase()) : "—";
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 700,
        fontSize: 10,
        lineHeight: 1,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 20,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/* ── Sort helper ───────────────────────────────────────────────── */

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
      const order: Record<string, number> = { Leader: 0, Advanced: 1, Developing: 2, Nascent: 3, Absent: 4 };
      cmp = (order[a.tier as string] ?? 5) - (order[b.tier as string] ?? 5);
    } else if (field === "has_dp_law") {
      cmp = (a.has_dp_law ? 1 : 0) - (b.has_dp_law ? 1 : 0);
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

/* ── SubScoreRow ───────────────────────────────────────────────── */

function SubScoreRow({ label, score, color }: { label: string; score: number | string | null; color: string }) {
  if (score == null) return null;
  const n = Number(score);
  if (isNaN(n)) return null;
  const pct = Math.round(n * 10);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontWeight: 500, fontSize: 12, color: "#B9B2A2", width: 160, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "#2A2C2E", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width .3s" }} />
      </div>
      <span style={{ fontWeight: 600, fontSize: 12, color: "#F4F1EA", width: 32, textAlign: "right" }}>{n.toFixed(1)}</span>
    </div>
  );
}

/* ── Country detail drawer ─────────────────────────────────────── */

function CountryDetail({
  row,
  country,
  enforcement,
  onClose,
}: {
  row: MaturityRow;
  country: Country | null;
  enforcement: EnforcementAction[];
  onClose: () => void;
}) {
  const countryEnforcement = enforcement.filter((e) => e.country_name === row.country_name);
  const flag = flagUrl(row.iso_code, 80);
  const tm = tierMeta(row.tier);
  const score = row.overall_score != null ? Number(row.overall_score).toFixed(1) : "—";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      {/* Backdrop */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)" }} onClick={onClose} />

      {/* Drawer */}
      <div
        style={{
          position: "relative",
          width: 460,
          maxWidth: "100vw",
          height: "100%",
          overflowY: "auto",
          background: "#F5F0E8",
          boxShadow: "-4px 0 24px rgba(0,0,0,.15)",
          animation: "slideIn .25s ease-out",
        }}
      >
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Dark header */}
        <div style={{ background: "#0F1113", padding: "28px 28px 24px" }}>
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: 16, right: 20, background: "none", border: "none",
              color: "#8E9196", fontSize: 20, cursor: "pointer", lineHeight: 1,
            }}
          >
            &times;
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            {flag && (
              <div style={{
                width: 34, height: 34, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                border: "2px solid rgba(255,255,255,.15)",
              }}>
                <img src={flag} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#F4F1EA", lineHeight: 1.2 }}>
                {row.country_name}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: tm.color, marginTop: 2 }}>
                DPMI {score}/10 &middot; <TierPill tier={row.tier} />
              </div>
            </div>
          </div>

          {/* 2x2 grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
            {[
              { label: "Law", value: country?.law_name ?? (row.has_dp_law ? "Yes" : "No") },
              { label: "Year", value: country?.law_year ?? "—" },
              { label: "Authority", value: row.authority_name ?? "—" },
              { label: "Max penalty", value: country?.max_fine_description ?? "—" },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: "rgba(255,255,255,.06)",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8E9196", marginBottom: 4 }}>
                  {item.label}
                </div>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: "#F4F1EA", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 28px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Sub-scores */}
          <div style={{ background: "#1A1C1E", borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 14 }}>
              DPMI breakdown
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SubScoreRow label="Regulatory maturity" score={row.regulatory_maturity} color={tm.color} />
              <SubScoreRow label="Enforcement activity" score={row.enforcement_activity} color={tm.color} />
              <SubScoreRow label="Business friendliness" score={row.business_friendliness} color={tm.color} />
              <SubScoreRow label="Cross-border complexity" score={row.cross_border_complexity} color={tm.color} />
              {row.children_protections != null && (
                <SubScoreRow label="Children protections" score={row.children_protections} color={tm.color} />
              )}
            </div>
          </div>

          {/* Breach notification */}
          {country?.breach_notification_detail && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 6 }}>
                Breach notification
              </div>
              <div style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.5, color: "#1A1C1E" }}>
                {country.breach_notification_detail}
              </div>
            </div>
          )}

          {/* Law status */}
          {row.law_status && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 6 }}>
                Law status
              </div>
              <div style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.5, color: "#1A1C1E" }}>
                {row.law_status}
              </div>
            </div>
          )}

          {/* Enforcement actions */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8E9196", marginBottom: 10 }}>
              Enforcement actions ({countryEnforcement.length})
            </div>
            {countryEnforcement.length === 0 ? (
              <div style={{ fontWeight: 500, fontSize: 12.5, color: "#B9B2A2" }}>
                No enforcement actions recorded
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {countryEnforcement.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E4D9C4",
                      borderRadius: 8,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1A1C1E", lineHeight: 1.4 }}>
                        {e.target_entity ?? "Unknown entity"}
                      </div>
                      <div style={{ fontWeight: 500, fontSize: 11, color: "#B9B2A2", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {e.action_date ? new Date(e.action_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </div>
                    </div>
                    <div style={{ fontWeight: 400, fontSize: 12, lineHeight: 1.45, color: "#55524C" }}>
                      {e.description}
                    </div>
                    {e.fine_amount != null && (
                      <div style={{ fontWeight: 600, fontSize: 11, color: "#C5A059", marginTop: 6 }}>
                        Penalty: {e.fine_currency} {Number(e.fine_amount).toLocaleString("en-GB")}
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

/* ── Main component ────────────────────────────────────────────── */

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

  // Filter + sort
  const filtered = maturity.filter((m) => {
    if (search && !m.country_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (tierFilter && m.tier?.toLowerCase() !== tierFilter) return false;
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

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  // Find the full Country record for the drawer
  const selectedCountryDetail = selectedCountry
    ? countries.find((c) => c.country_name === selectedCountry.country_name) ?? null
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Breadcrumb + title */}
      <div>
        <div
          style={{
            fontWeight: 700,
            fontSize: 10,
            lineHeight: 1,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#B08D3F",
            marginBottom: 9,
          }}
        >
          AfricanSTN &middot; Regulatory
        </div>
        <h1
          style={{
            fontWeight: 800,
            fontSize: 27,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--tx)",
            margin: "0 0 5px",
          }}
        >
          Data protection intelligence
        </h1>
        <p
          style={{
            fontWeight: 500,
            fontSize: 13,
            lineHeight: 1.4,
            color: "#8E9196",
            margin: 0,
          }}
        >
          {countries.length} African countries tracked &middot; DPMI v2.0 methodology
        </p>
      </div>

      {/* Counter cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "Countries tracked", value: countries.length },
          { label: "With a DP law", value: withLaw },
          { label: "With an authority", value: withAuthority },
          { label: "Enforcement actions", value: enforcement.length },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: "var(--pnl)",
              border: "1px solid var(--bd)",
              borderRadius: 10,
              padding: "16px 18px",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.1, color: "var(--tx)" }}>
              {card.value.toLocaleString("en-GB")}
            </div>
            <div style={{ fontWeight: 500, fontSize: 11.5, color: "#8E9196", marginTop: 4 }}>
              {card.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tier pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TIER_ORDER.map((tier) => {
          const active = tierFilter === tier;
          const m = TIER_META[tier];
          return (
            <button
              key={tier}
              onClick={() => setTierFilter(active ? "" : tier)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 14px",
                borderRadius: 20,
                border: active ? `2px solid ${m.color}` : "1px solid var(--bd)",
                background: active ? m.bg : "transparent",
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14, color: m.color }}>
                {tierCounts[tier] ?? 0}
              </span>
              <TierPill tier={tier} />
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by country…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: 240,
            padding: "7px 12px",
            border: "1px solid var(--bd)",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--tx)",
            background: "var(--pnl)",
            outline: "none",
          }}
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          style={{
            padding: "7px 12px",
            border: "1px solid var(--bd)",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--tx)",
            background: "var(--pnl)",
            outline: "none",
            cursor: "pointer",
          }}
        >
          <option value="">All tiers</option>
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>{cap(t)}</option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", fontWeight: 600, fontSize: 12.5, color: "#55524C" }}>
          Showing <span style={{ color: "#B08D3F" }}>{sorted.length}</span> of {maturity.length}
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          background: "var(--pnl)",
          border: "1px solid var(--bd)",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(26,28,30,.05)",
        }}
      >
        {sorted.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", fontWeight: 500, fontSize: 13, color: "#8E9196" }}>
            No countries match the current filters.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F6F1E7", borderBottom: "1.5px solid #E4D9C4" }}>
                {/* Flag (no header) */}
                <th style={{ width: 44, padding: "13px 0 13px 18px" }} />
                <th
                  onClick={() => toggleSort("country_name")}
                  style={{
                    textAlign: "left", fontWeight: 700, fontSize: 10.5, lineHeight: 1,
                    letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62",
                    padding: "13px 14px", whiteSpace: "nowrap", cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  Country{sortArrow("country_name")}
                </th>
                <th
                  onClick={() => toggleSort("has_dp_law")}
                  style={{
                    textAlign: "left", fontWeight: 700, fontSize: 10.5, lineHeight: 1,
                    letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62",
                    padding: "13px 14px", whiteSpace: "nowrap", cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  DP law{sortArrow("has_dp_law")}
                </th>
                <th
                  style={{
                    textAlign: "left", fontWeight: 700, fontSize: 10.5, lineHeight: 1,
                    letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62",
                    padding: "13px 14px", whiteSpace: "nowrap",
                  }}
                >
                  Authority
                </th>
                <th
                  onClick={() => toggleSort("overall_score")}
                  style={{
                    textAlign: "left", fontWeight: 700, fontSize: 10.5, lineHeight: 1,
                    letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62",
                    padding: "13px 14px", whiteSpace: "nowrap", cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  DPMI score{sortArrow("overall_score")}
                </th>
                <th
                  onClick={() => toggleSort("tier")}
                  style={{
                    textAlign: "left", fontWeight: 700, fontSize: 10.5, lineHeight: 1,
                    letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E6A62",
                    padding: "13px 18px", whiteSpace: "nowrap", cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  Tier{sortArrow("tier")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m, idx) => {
                const flag = flagUrl(m.iso_code, 40);
                const tm = tierMeta(m.tier);
                const score = m.overall_score != null ? Number(m.overall_score) : null;
                const pct = score != null ? Math.round(score * 10) : 0;

                return (
                  <tr
                    key={m.country_name ?? idx}
                    onClick={() => setSelectedCountry(m)}
                    style={{
                      background: idx % 2 ? "#FBF8F1" : "#FFFFFF",
                      borderBottom: "1px solid #F0E8D8",
                      cursor: "pointer",
                      transition: "background .1s",
                    }}
                    className="hover:!bg-[#FBF6EC]"
                  >
                    {/* Flag */}
                    <td style={{ padding: "10px 0 10px 18px", width: 44 }}>
                      {flag ? (
                        <div
                          style={{
                            width: 20, height: 20, borderRadius: "50%",
                            overflow: "hidden", border: "1px solid #E4D9C4",
                          }}
                        >
                          <img src={flag} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      ) : (
                        <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#EEECE7" }} />
                      )}
                    </td>

                    {/* Country */}
                    <td style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: "var(--tx)", padding: "10px 14px" }}>
                      {m.country_name ?? "—"}
                    </td>

                    {/* DP law */}
                    <td style={{ fontWeight: 600, fontSize: 12.5, padding: "10px 14px" }}>
                      {m.has_dp_law ? (
                        <span style={{ color: "#2E7D32" }}>Yes</span>
                      ) : (
                        <span style={{ color: "#B9B2A2" }}>No</span>
                      )}
                    </td>

                    {/* Authority */}
                    <td
                      style={{
                        fontWeight: 500, fontSize: 12.5, lineHeight: 1.3, color: "#55524C",
                        padding: "10px 14px", maxWidth: 200, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {m.authority_name ?? "—"}
                    </td>

                    {/* Score bar */}
                    <td style={{ padding: "10px 14px" }}>
                      {score != null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 80, height: 6, background: "#EEECE7", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: tm.color, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontWeight: 600, fontSize: 12, color: "#55524C" }}>{score.toFixed(1)}</span>
                        </div>
                      ) : (
                        <span style={{ fontWeight: 500, fontSize: 12, color: "#B9B2A2" }}>{"—"}</span>
                      )}
                    </td>

                    {/* Tier */}
                    <td style={{ padding: "10px 18px" }}>
                      <TierPill tier={m.tier} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Country detail drawer */}
      {selectedCountry && (
        <CountryDetail
          row={selectedCountry}
          country={selectedCountryDetail}
          enforcement={enforcement}
          onClose={() => setSelectedCountry(null)}
        />
      )}
    </div>
  );
}

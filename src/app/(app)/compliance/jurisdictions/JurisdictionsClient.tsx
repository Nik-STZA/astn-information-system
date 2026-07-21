"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import type { Jurisdiction, JurisdictionRequirement } from "@/lib/data/compliance";
import { getJurisdictionDetail, getJurisdictionRequirements } from "../actions";

/* ── Types ─────────────────────────────────────────────────────────────── */
type DomainInfo = { id: number; code: string; name: string; weight: number };
type JurisdictionDetail = {
  jurisdiction: Jurisdiction;
  domains: DomainInfo[];
  requirement_count: number;
  keyword_count: number;
};

/* ── Props ─────────────────────────────────────────────────────────────── */
type Props = { jurisdictions: Jurisdiction[] };

/* ── Styles ────────────────────────────────────────────────────────────── */
const cardStyle: React.CSSProperties = {
  background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 12,
  padding: 20, cursor: "pointer", transition: "box-shadow .15s, border-color .15s",
};
const labelStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 9.5, letterSpacing: "0.14em",
  textTransform: "uppercase" as const, color: "#8E9196", marginBottom: 4,
};
const valStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: 14, color: "var(--tx)",
};
const pillStyle = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-block", padding: "2px 8px", borderRadius: 6,
  fontSize: 10, fontWeight: 600, background: bg, color,
});

/* ── Component ─────────────────────────────────────────────────────────── */
export default function JurisdictionsClient({ jurisdictions }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<JurisdictionDetail | null>(null);
  const [requirements, setRequirements] = useState<JurisdictionRequirement[] | null>(null);
  const [reqsOpen, setReqsOpen] = useState(false);
  const [expandedReq, setExpandedReq] = useState<number | null>(null);
  const [loading, startTransition] = useTransition();
  const [reqLoading, startReqTransition] = useTransition();

  const loadDetail = useCallback((id: number) => {
    setSelected(id);
    setDetail(null);
    setRequirements(null);
    setReqsOpen(false);
    setExpandedReq(null);
    startTransition(async () => {
      const res = await getJurisdictionDetail(id);
      if (res.data) {
        setDetail(res.data as unknown as JurisdictionDetail);
      }
    });
  }, []);

  const loadRequirements = useCallback((id: number) => {
    setReqsOpen(true);
    if (requirements) return; // already loaded
    startReqTransition(async () => {
      const res = await getJurisdictionRequirements(id);
      if (res.data?.data) {
        setRequirements(res.data.data);
      }
    });
  }, [requirements]);

  const selectedJurisdiction = jurisdictions.find((j) => j.id === selected);

  return (
    <div style={{ fontFamily: "'Manrope', sans-serif", padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <Link href="/compliance" style={{ color: "#8E9196", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
            Compliance
          </Link>
          <span style={{ color: "#DED9CE" }}>/</span>
          <span style={{ color: "var(--tx)", fontSize: 13, fontWeight: 600 }}>Knowledge base</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--tx)", margin: "8px 0 4px" }}>
          Compliance knowledge base
        </h1>
        <p style={{ fontSize: 13, color: "#8E9196", margin: 0 }}>
          {jurisdictions.length} jurisdiction{jurisdictions.length !== 1 ? "s" : ""} configured with domains, requirements, and evidence keywords.
        </p>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        {/* Jurisdiction cards grid */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {jurisdictions.map((j) => (
              <div
                key={j.id}
                onClick={() => loadDetail(j.id)}
                style={{
                  ...cardStyle,
                  borderColor: selected === j.id ? "#C5A059" : "var(--bd)",
                  boxShadow: selected === j.id ? "0 0 0 2px rgba(197,160,89,.25)" : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--tx)" }}>{j.short_name}</div>
                    <div style={{ fontWeight: 500, fontSize: 11.5, color: "#8E9196", marginTop: 2 }}>{j.name}</div>
                  </div>
                  <span style={pillStyle(j.is_active ? "#E7F1EA" : "#F7E7E1", j.is_active ? "#2E7D32" : "#B4432C")}>
                    {j.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                  <div>
                    <div style={labelStyle}>Domains</div>
                    <div style={valStyle}>{j.domain_count}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Requirements</div>
                    <div style={valStyle}>{j.requirement_count}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Country</div>
                    <div style={valStyle}>{j.country_iso}</div>
                  </div>
                </div>

                {j.regulator_name && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
                    <div style={labelStyle}>Regulator</div>
                    <div style={{ fontWeight: 500, fontSize: 12, color: "#55524C" }}>
                      {j.regulator_name}
                    </div>
                  </div>
                )}

                {(j.enacted_date || j.effective_date) && (
                  <div style={{ display: "flex", gap: 16, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
                    {j.enacted_date && (
                      <div>
                        <div style={labelStyle}>Enacted</div>
                        <div style={{ fontWeight: 500, fontSize: 11, color: "#55524C" }}>{j.enacted_date}</div>
                      </div>
                    )}
                    {j.effective_date && (
                      <div>
                        <div style={labelStyle}>Effective</div>
                        <div style={{ fontWeight: 500, fontSize: 11, color: "#55524C" }}>{j.effective_date}</div>
                      </div>
                    )}
                  </div>
                )}

                {j.scoring_config && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
                    <div style={labelStyle}>Scoring weights</div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, fontWeight: 500, color: "#55524C" }}>
                      <span>Min: {(j.scoring_config.min_weight * 100).toFixed(0)}%</span>
                      <span>Avg: {(j.scoring_config.avg_weight * 100).toFixed(0)}%</span>
                      {j.scoring_config.mandatory_domains.length > 0 && (
                        <span>Mandatory: {j.scoring_config.mandatory_domains.join(", ")}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ width: 360, flexShrink: 0, position: "sticky", top: 80, alignSelf: "flex-start" }}>
            <div style={{ background: "var(--pnl)", border: "1px solid #C5A059", borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "var(--tx)" }}>
                    {selectedJurisdiction?.short_name}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 12, color: "#8E9196", marginTop: 2 }}>
                    {selectedJurisdiction?.name}
                  </div>
                </div>
                <button
                  onClick={() => { setSelected(null); setDetail(null); }}
                  style={{ background: "none", border: "none", color: "#8E9196", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
                >
                  &times;
                </button>
              </div>

              {loading && (
                <p style={{ fontSize: 12, color: "#8E9196", fontStyle: "italic", margin: 0 }}>Loading detail...</p>
              )}

              {detail && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Summary stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div style={{ textAlign: "center", padding: 10, background: "rgba(197,160,89,.08)", borderRadius: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 20, color: "#C5A059" }}>{detail.domains.length}</div>
                      <div style={{ ...labelStyle, marginBottom: 0 }}>Domains</div>
                    </div>
                    <div style={{ textAlign: "center", padding: 10, background: "rgba(46,125,50,.08)", borderRadius: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 20, color: "#2E7D32" }}>{detail.requirement_count}</div>
                      <div style={{ ...labelStyle, marginBottom: 0 }}>Requirements</div>
                    </div>
                    <div style={{ textAlign: "center", padding: 10, background: "rgba(30,30,30,.05)", borderRadius: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 20, color: "var(--tx)" }}>{detail.keyword_count}</div>
                      <div style={{ ...labelStyle, marginBottom: 0 }}>Keywords</div>
                    </div>
                  </div>

                  {/* Domain breakdown */}
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>Domain breakdown</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {detail.domains.map((d) => (
                        <div
                          key={d.id}
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "8px 12px", background: "rgba(30,30,30,.03)", borderRadius: 8,
                            border: "1px solid var(--bd)",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--tx)" }}>{d.name}</div>
                            <div style={{ fontSize: 10.5, color: "#8E9196", marginTop: 1 }}>{d.code}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: "#C5A059" }}>
                              {(d.weight * 100).toFixed(0)}%
                            </div>
                            <div style={{ fontSize: 10, color: "#8E9196" }}>weight</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Requirements drilldown */}
                  <div>
                    {!reqsOpen ? (
                      <button
                        onClick={() => selected && loadRequirements(selected)}
                        style={{
                          width: "100%", padding: "8px 12px", borderRadius: 8,
                          fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                          background: "transparent", border: "1px solid var(--bd)",
                          color: "#B08D3F", transition: "background .15s",
                        }}
                      >
                        View requirements &amp; keywords
                      </button>
                    ) : (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={labelStyle}>Requirements by domain</div>
                          <button
                            onClick={() => setReqsOpen(false)}
                            style={{ background: "none", border: "none", fontSize: 10, color: "#8E9196", cursor: "pointer", textDecoration: "underline" }}
                          >
                            Collapse
                          </button>
                        </div>
                        {reqLoading && !requirements && (
                          <p style={{ fontSize: 11, color: "#8E9196", fontStyle: "italic", margin: 0 }}>Loading requirements...</p>
                        )}
                        {requirements && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 400, overflowY: "auto" }}>
                            {detail.domains.map((domain) => {
                              const domainReqs = requirements.filter((r) => r.domain_code === domain.code);
                              if (domainReqs.length === 0) return null;
                              return (
                                <div key={domain.id}>
                                  <div style={{ fontWeight: 600, fontSize: 11, color: "#C5A059", padding: "6px 0 2px", borderBottom: "1px solid var(--bd)" }}>
                                    {domain.name} ({domainReqs.length})
                                  </div>
                                  {domainReqs.map((req) => (
                                    <div key={req.id} style={{ borderBottom: "1px solid rgba(0,0,0,.04)" }}>
                                      <div
                                        onClick={() => setExpandedReq(expandedReq === req.id ? null : req.id)}
                                        style={{
                                          display: "flex", justifyContent: "space-between", alignItems: "center",
                                          padding: "6px 4px", cursor: "pointer", fontSize: 11,
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                                          <span style={{ color: "#8E9196", fontFamily: "monospace", fontSize: 9.5, flexShrink: 0 }}>{req.code}</span>
                                          <span style={{ color: "var(--tx)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.name}</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                          {req.is_mandatory && (
                                            <span style={pillStyle("#FBF1DE", "#A67514")}>M</span>
                                          )}
                                          <span style={{ fontSize: 9, color: "#8E9196" }}>{req.keyword_count} kw</span>
                                          <span style={{ fontSize: 10, color: "#8E9196", transform: expandedReq === req.id ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                                        </div>
                                      </div>
                                      {expandedReq === req.id && (
                                        <div style={{ padding: "4px 4px 8px 20px", fontSize: 10.5 }}>
                                          {req.description && (
                                            <p style={{ color: "#55524C", margin: "0 0 6px", lineHeight: 1.4 }}>{req.description}</p>
                                          )}
                                          {req.keywords.length > 0 && (
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                              {req.keywords.map((kw) => (
                                                <span
                                                  key={kw.id}
                                                  style={{
                                                    ...pillStyle(
                                                      kw.keyword_class === "jurisdiction_specific" ? "#E7F1EA" : kw.keyword_class === "negative" ? "#F7E7E1" : "rgba(30,30,30,.06)",
                                                      kw.keyword_class === "jurisdiction_specific" ? "#2E7D32" : kw.keyword_class === "negative" ? "#B4432C" : "#55524C"
                                                    ),
                                                    fontSize: 9, fontFamily: "monospace",
                                                  }}
                                                >
                                                  {kw.pattern}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Regulator link */}
                  {selectedJurisdiction?.regulator_url && (
                    <div>
                      <div style={labelStyle}>Regulator website</div>
                      <a
                        href={selectedJurisdiction.regulator_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: "#B08D3F", fontWeight: 500, wordBreak: "break-all" }}
                      >
                        {selectedJurisdiction.regulator_url}
                      </a>
                    </div>
                  )}

                  {/* Version info */}
                  <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8E9196" }}>
                      <span>Version: {selectedJurisdiction?.version}</span>
                      <span>Engine: v3.0.0</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

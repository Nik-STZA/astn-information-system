"use client";

import { useEffect, useState, useTransition } from "react";
import { loadSystems, saveProcessor, saveRegistration } from "./actions";
import type { Processor, RegulatorRegistration } from "@/lib/data/processor-register";

const DPA_OPTIONS: Processor["dpa_status"][] = [
  "in_place",
  "available_unconfirmed",
  "not_covered",
  "exiting",
  "not_required",
  "decommissioned",
  "unknown",
];

// Colour by how urgent the DPA gap is.
function dpaColour(s: string): { bg: string; fg: string } {
  switch (s) {
    case "not_covered":
      return { bg: "rgba(204,0,0,0.12)", fg: "#CC0000" };
    case "available_unconfirmed":
      return { bg: "rgba(204,119,0,0.12)", fg: "#CC7700" };
    case "in_place":
      return { bg: "rgba(46,125,50,0.12)", fg: "#2E7D32" };
    default:
      return { bg: "rgba(142,145,150,0.12)", fg: "#8E9196" };
  }
}

const CAT_LABEL: Record<string, string> = {
  ai_llm: "AI / LLM",
  infrastructure: "Infrastructure",
  business_saas: "Business SaaS",
};

export default function ProcessorRegisterPanel({ clientId }: { clientId: string }) {
  const [processors, setProcessors] = useState<Processor[]>([]);
  const [registrations, setRegistrations] = useState<RegulatorRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    loadSystems(clientId).then((r) => {
      if (!live) return;
      setProcessors(r.processors);
      setRegistrations(r.registrations);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  function onDpaChange(p: Processor, value: string) {
    setProcessors((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, dpa_status: value as Processor["dpa_status"] } : x)),
    );
    startTransition(async () => {
      await saveProcessor(p.id, { dpa_status: value });
    });
  }

  function onRegNumberBlur(r: RegulatorRegistration, value: string) {
    if (value === (r.registration_number ?? "")) return;
    setRegistrations((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, registration_number: value } : x)),
    );
    startTransition(async () => {
      await saveRegistration(r.id, { registration_number: value });
    });
  }

  if (loading) {
    return <div style={{ padding: 24, color: "var(--sub)", fontSize: 13 }}>Loading systems…</div>;
  }

  const gaps = processors.filter((p) => p.dpa_status === "not_covered").length;
  const unconfirmed = processors.filter((p) => p.dpa_status === "available_unconfirmed").length;

  const cellPad = "10px 12px";
  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".04em",
    textTransform: "uppercase",
    color: "var(--sub)",
    borderBottom: "1px solid var(--bd)",
  };

  return (
    <div>
      {/* Summary */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--tx)" }}>
          <strong>{processors.length}</strong> systems
        </div>
        {gaps > 0 && (
          <div style={{ fontSize: 13, color: "#CC0000" }}>
            <strong>{gaps}</strong> with no DPA (action needed)
          </div>
        )}
        {unconfirmed > 0 && (
          <div style={{ fontSize: 13, color: "#CC7700" }}>
            <strong>{unconfirmed}</strong> to confirm signed
          </div>
        )}
      </div>

      {/* Regulator registrations */}
      {registrations.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
            Regulator registrations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {registrations.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px solid var(--bd)", borderRadius: 8, background: "var(--pnl)", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tx)", minWidth: 180 }}>{r.regulator}</span>
                <span style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase" }}>{r.jurisdiction_code}</span>
                <input
                  defaultValue={r.registration_number ?? ""}
                  placeholder="registration no."
                  onBlur={(e) => onRegNumberBlur(r, e.target.value.trim())}
                  style={{ fontSize: 12.5, padding: "4px 8px", border: "1px solid var(--bd)", borderRadius: 6, background: "var(--bg)", color: "var(--tx)", width: 160 }}
                />
                <span style={{ fontSize: 11.5, color: r.status === "registered" ? "#2E7D32" : "#8E9196", textTransform: "capitalize" }}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processor register */}
      <div style={{ overflowX: "auto", border: "1px solid var(--bd)", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>System</th>
              <th style={th}>Category</th>
              <th style={th}>Tier</th>
              <th style={th}>DPA status</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {processors.map((p) => {
              const c = dpaColour(p.dpa_status);
              return (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--bd)", opacity: p.status === "decommissioned" ? 0.55 : 1 }}>
                  <td style={{ padding: cellPad }}>
                    <div style={{ fontWeight: 600, color: "var(--tx)" }}>{p.system_name}</div>
                    {p.data_categories && (
                      <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{p.data_categories}</div>
                    )}
                  </td>
                  <td style={{ padding: cellPad, color: "var(--sub)", fontSize: 12 }}>{CAT_LABEL[p.category ?? ""] ?? p.category}</td>
                  <td style={{ padding: cellPad, color: "var(--sub)", fontSize: 12 }}>{p.tier}</td>
                  <td style={{ padding: cellPad }}>
                    <select
                      value={p.dpa_status}
                      onChange={(e) => onDpaChange(p, e.target.value)}
                      style={{ fontSize: 12, fontWeight: 700, padding: "4px 8px", borderRadius: 6, border: `1px solid ${c.fg}33`, background: c.bg, color: c.fg, cursor: "pointer" }}
                    >
                      {DPA_OPTIONS.map((o) => (
                        <option key={o} value={o} style={{ background: "var(--bg)", color: "var(--tx)" }}>
                          {o.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: cellPad, color: "var(--sub)", fontSize: 12, maxWidth: 320 }}>{p.action}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 10 }}>
        Change a DPA status to record progress — saved immediately. This is the processor list for the ROPA and the Art 28 / operator action tracker.
      </div>
    </div>
  );
}

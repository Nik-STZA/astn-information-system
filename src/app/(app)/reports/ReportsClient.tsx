"use client";

import { useCallback, useState } from "react";
import type { Prospect, Client } from "@/lib/data/compliance";
import type { PipelineOpportunity, DashboardStats } from "@/lib/data/pipeline";
import type { Country } from "@/lib/data/data-protection";

/* ── CSV helpers ─────────────────────────────────────────────────────────── */
function toCSV(headers: string[], rows: string[][]): string {
  const esc = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n"))
      return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map((c) => esc(c ?? "")).join(","))].join("\n");
}

function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Props ───────────────────────────────────────────────────────────────── */
type Props = {
  prospects: Prospect[];
  clients: Client[];
  opportunities: PipelineOpportunity[];
  stats: DashboardStats | null;
  countries: Country[];
  errors: string[];
};

export default function ReportsClient({ prospects, clients, opportunities, stats, countries, errors }: Props) {
  const [lastExport, setLastExport] = useState<string | null>(null);

  /* ── Export callbacks ────────────────────────────────────────────────── */
  const exportProspects = useCallback(() => {
    const h = ["Company","Website","Country","Sector","Priority","Status","IR Registered","Estimated Tier","SA Presence Evidence","Privacy Policy URL","Terms URL","LinkedIn URL","App Store URL","Created"];
    const rows = prospects.map((p) => [p.company_name, p.company_website ?? "", p.company_country ?? "", p.sector ?? "", p.priority, p.outreach_status, p.ir_registered === true ? "Yes" : p.ir_registered === false ? "No" : "Unknown", p.estimated_tier ?? "", p.sa_presence_evidence ?? "", p.privacy_policy_url ?? "", p.terms_url ?? "", p.linkedin_url ?? "", p.app_store_url ?? "", p.created_at?.slice(0, 10) ?? ""]);
    const fname = `africastn-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, toCSV(h, rows));
    setLastExport(fname);
  }, [prospects]);

  const exportClients = useCallback(() => {
    const h = ["Company","Website","Country","Contact","Email","Role","Status","Service Tier","Annual Fee (GBP)","Engagement Start","Processes Biometric","Processes Minors","Activities"];
    const rows = clients.map((c) => [c.company_name, c.company_website ?? "", c.company_country ?? "", c.contact_name ?? "", c.contact_email ?? "", c.contact_role ?? "", c.status, c.service_tier ?? "", c.annual_fee_gbp?.toString() ?? "", c.engagement_start?.slice(0, 10) ?? "", c.processes_biometric ? "Yes" : "No", c.processes_minors ? "Yes" : "No", c.activity_count?.toString() ?? "0"]);
    const fname = `africastn-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, toCSV(h, rows));
    setLastExport(fname);
  }, [clients]);

  const exportPipeline = useCallback(() => {
    const h = ["Opportunity","Prospect/Client","Service Type","Stage","Value (GBP)","Recurring","Expected Close","Owner","Notes","Created"];
    const rows = opportunities.map((o) => [o.opportunity_name, o.prospect_name ?? o.client_name ?? "", o.service_type ?? "", o.stage, o.value_gbp?.toString() ?? "", o.value_recurring ? "Yes" : "No", o.expected_close_date?.slice(0, 10) ?? "", o.owner ?? "", o.notes ?? "", o.created_at?.slice(0, 10) ?? ""]);
    const fname = `africastn-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, toCSV(h, rows));
    setLastExport(fname);
  }, [opportunities]);

  const exportCountries = useCallback(() => {
    const h = ["Country","Code","Has DP Law","Law Name","Law Status","Law Year","Authority","Authority Website","Transfer Mechanism","Breach Notification","Breach Hours","Max Penalty","Overall Score","Tier"];
    const rows = countries.map((c) => [c.country_name, c.iso_code, c.has_dp_law ? "Yes" : "No", c.law_name ?? "", c.law_status ?? "", c.law_year?.toString() ?? "", c.authority_name ?? "", c.authority_website ?? "", c.transfer_mechanisms ?? "", c.breach_notification_detail ? "Yes" : "No", c.breach_notification_hours?.toString() ?? "", c.max_fine_description ?? "", c.overall_score?.toString() ?? "", c.tier ?? ""]);
    const fname = `africastn-data-protection-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, toCSV(h, rows));
    setLastExport(fname);
  }, [countries]);

  /* ── Derived values ─────────────────────────────────────────────────── */
  const activeValue = opportunities
    .filter((o) => !["won", "lost"].includes(o.stage))
    .reduce((sum, o) => sum + (o.value_gbp ?? 0), 0);

  return (
    <div style={{ fontFamily: "'Manrope', sans-serif" }}>
      {/* Breadcrumb + header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "#A29C8E", marginBottom: 8 }}>
          AfricanSTN <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span> Publishing
        </div>
        <h1 style={{ fontSize: 27, fontWeight: 800, color: "var(--tx)", margin: 0 }}>
          Reports
        </h1>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <SummaryCard label="Prospects" value={stats?.prospects.total ?? prospects.length} />
        <SummaryCard label="Clients" value={stats?.clients.total ?? clients.length} dashed />
        <SummaryCard label="Pipeline value" value={`£${activeValue.toLocaleString("en-GB")}`} dashed />
        <SummaryCard label="Countries tracked" value={countries.length} />
      </div>

      {/* Data exports section */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px 0" }}>Data exports</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ExportCard
            title="Compliance prospects"
            description={`${prospects.length} records — company details, outreach status, IR registration, document URLs.`}
            count={prospects.length}
            onExport={exportProspects}
          />
          <ExportCard
            title="Clients"
            description={`${clients.length} records — service tiers, annual fees, engagement dates, activity counts.`}
            count={clients.length}
            onExport={exportClients}
          />
          <ExportCard
            title="Pipeline opportunities"
            description={`${opportunities.length} records — stages, values, expected close dates, interactions.`}
            count={opportunities.length}
            onExport={exportPipeline}
          />
          <ExportCard
            title="Data protection countries"
            description={`${countries.length} countries — DP laws, authorities, scores, penalties.`}
            count={countries.length}
            onExport={exportCountries}
          />
        </div>
      </div>

      {lastExport && (
        <div style={{ fontSize: 11.5, color: "#B9B2A2", marginBottom: 24 }}>
          Last export: {lastExport}
        </div>
      )}

      {/* Platform snapshot */}
      {stats && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", margin: "0 0 16px 0" }}>Platform snapshot</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {/* Prospect pipeline */}
            <SnapshotCard
              title="Prospect pipeline"
              items={[
                { label: "High priority", value: stats.prospects.high_priority, highlight: true },
                { label: "Identified", value: stats.prospects.identified },
                { label: "Contacted", value: stats.prospects.contacted },
                { label: "Responded", value: stats.prospects.responded },
                { label: "Converted", value: stats.prospects.converted },
              ]}
            />
            {/* Client portfolio */}
            <SnapshotCard
              title="Client portfolio"
              items={[
                { label: "Active", value: stats.clients.active },
                { label: "Total ARR", value: `£${Number(stats.clients.arr).toLocaleString("en-GB")}` },
              ]}
              emptyMessage={stats.clients.total === 0 ? "No active clients yet — convert prospects to populate." : undefined}
            />
            {/* BD pipeline */}
            <SnapshotCard
              title="BD pipeline"
              items={[
                { label: "Total opportunities", value: stats.pipeline.total },
                { label: "Total value", value: `£${Number(stats.pipeline.total_value).toLocaleString("en-GB")}` },
                { label: "Active value", value: `£${Number(stats.pipeline.active_value).toLocaleString("en-GB")}` },
                { label: "Won", value: stats.pipeline.won },
              ]}
            />
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{
          padding: "14px 18px",
          backgroundColor: "#FEF2F2",
          border: "1px solid #FECACA",
          borderRadius: 12,
          color: "#CC0000",
          fontSize: 13,
        }}>
          <strong>API errors:</strong> {errors.join("; ")}
        </div>
      )}
    </div>
  );
}

/* ── SummaryCard ─────────────────────────────────────────────────────────── */
function SummaryCard({ label, value, dashed }: { label: string; value: number | string; dashed?: boolean }) {
  return (
    <div style={{
      borderRadius: 14,
      padding: "18px 20px",
      border: dashed ? "1px dashed #D9CDB4" : "1px solid var(--bd)",
      backgroundColor: dashed ? "#F7F2E9" : "var(--pnl)",
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: dashed ? "#B9B2A2" : "var(--tx)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: dashed ? "#B9B2A2" : "#A29C8E", marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

/* ── ExportCard ──────────────────────────────────────────────────────────── */
function ExportCard({
  title,
  description,
  count,
  onExport,
}: {
  title: string;
  description: string;
  count: number;
  onExport: () => void;
}) {
  const hasData = count > 0;
  return (
    <div style={{
      borderRadius: 14,
      border: "1px solid var(--bd)",
      backgroundColor: "var(--pnl)",
      padding: "20px 22px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--tx)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, fontWeight: 400, color: "#A29C8E", lineHeight: 1.45 }}>{description}</div>
      </div>
      <button
        onClick={onExport}
        style={{
          flexShrink: 0,
          padding: "8px 18px",
          borderRadius: 10,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          border: hasData ? "none" : "1px solid #D4C5A9",
          backgroundColor: hasData ? "#C5A059" : "transparent",
          color: hasData ? "#FFFFFF" : "#B08D3F",
          transition: "opacity 0.15s",
        }}
      >
        Export CSV
      </button>
    </div>
  );
}

/* ── SnapshotCard ────────────────────────────────────────────────────────── */
function SnapshotCard({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: Array<{ label: string; value: number | string; highlight?: boolean }>;
  emptyMessage?: string;
}) {
  return (
    <div style={{
      borderRadius: 14,
      border: emptyMessage ? "1px dashed #D9CDB4" : "1px solid var(--bd)",
      backgroundColor: emptyMessage ? "#F7F2E9" : "var(--pnl)",
      padding: "18px 20px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx)", marginBottom: 14 }}>{title}</div>
      {emptyMessage ? (
        <div style={{ fontSize: 12, color: "#B9B2A2", lineHeight: 1.5 }}>{emptyMessage}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => {
            const isZero = item.value === 0 || item.value === "£0";
            return (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#A29C8E" }}>{item.label}</span>
                <span style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: item.highlight && !isZero ? "#B4432C" : isZero ? "#B9B2A2" : "var(--tx)",
                }}>
                  {item.value}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

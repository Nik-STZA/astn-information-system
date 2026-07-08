"use client";

import { useCallback, useState } from "react";
import type { Prospect, Client } from "@/lib/data/compliance";
import type { PipelineOpportunity } from "@/lib/data/pipeline";
import type { Country } from "@/lib/data/data-protection";
import type { DashboardStats } from "@/lib/data/pipeline";

const btnPrimary =
  "px-4 py-2 bg-[#C5A059] text-white text-sm font-medium rounded-lg hover:bg-[#B08A3E] transition-colors";

type Props = {
  prospects: Prospect[];
  clients: Client[];
  opportunities: PipelineOpportunity[];
  stats: DashboardStats | null;
  countries: Country[];
  errors: string[];
};

function toCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.map((c) => escape(c ?? "")).join(","));
  }
  return lines.join("\n");
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

export default function ReportsClient({
  prospects,
  clients,
  opportunities,
  stats,
  countries,
  errors,
}: Props) {
  const [lastExport, setLastExport] = useState<string | null>(null);

  const exportProspects = useCallback(() => {
    const headers = [
      "Company", "Website", "Country", "Sector", "Priority", "Status",
      "IR Registered", "Estimated Tier", "SA Presence Evidence",
      "Privacy Policy URL", "Terms URL", "LinkedIn URL", "App Store URL",
      "Created",
    ];
    const rows = prospects.map((p) => [
      p.company_name,
      p.company_website ?? "",
      p.company_country ?? "",
      p.sector ?? "",
      p.priority,
      p.outreach_status,
      p.ir_registered === true ? "Yes" : p.ir_registered === false ? "No" : "Unknown",
      p.estimated_tier ?? "",
      p.sa_presence_evidence ?? "",
      p.privacy_policy_url ?? "",
      p.terms_url ?? "",
      p.linkedin_url ?? "",
      p.app_store_url ?? "",
      p.created_at?.slice(0, 10) ?? "",
    ]);
    const csv = toCSV(headers, rows);
    const fname = `africastn-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, csv);
    setLastExport(fname);
  }, [prospects]);

  const exportClients = useCallback(() => {
    const headers = [
      "Company", "Website", "Country", "Contact", "Email", "Role",
      "Status", "Service Tier", "Annual Fee (GBP)", "Engagement Start",
      "Processes Biometric", "Processes Minors", "Activities",
    ];
    const rows = clients.map((c) => [
      c.company_name,
      c.company_website ?? "",
      c.company_country ?? "",
      c.contact_name ?? "",
      c.contact_email ?? "",
      c.contact_role ?? "",
      c.status,
      c.service_tier ?? "",
      c.annual_fee_gbp?.toString() ?? "",
      c.engagement_start?.slice(0, 10) ?? "",
      c.processes_biometric ? "Yes" : "No",
      c.processes_minors ? "Yes" : "No",
      c.activity_count?.toString() ?? "0",
    ]);
    const csv = toCSV(headers, rows);
    const fname = `africastn-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, csv);
    setLastExport(fname);
  }, [clients]);

  const exportPipeline = useCallback(() => {
    const headers = [
      "Opportunity", "Prospect/Client", "Service Type", "Stage",
      "Value (GBP)", "Recurring", "Expected Close", "Owner", "Notes", "Created",
    ];
    const rows = opportunities.map((o) => [
      o.opportunity_name,
      o.prospect_name ?? o.client_name ?? "",
      o.service_type ?? "",
      o.stage,
      o.value_gbp?.toString() ?? "",
      o.value_recurring ? "Yes" : "No",
      o.expected_close_date?.slice(0, 10) ?? "",
      o.owner ?? "",
      o.notes ?? "",
      o.created_at?.slice(0, 10) ?? "",
    ]);
    const csv = toCSV(headers, rows);
    const fname = `africastn-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, csv);
    setLastExport(fname);
  }, [opportunities]);

  const exportCountries = useCallback(() => {
    const headers = [
      "Country", "Code", "Region", "Has DP Law", "Law Name", "Law Status",
      "Law Year", "Authority", "Authority Website",
      "Transfer Mechanism", "Breach Notification Required", "Breach Hours",
      "Max Penalty", "Overall Score", "Tier",
    ];
    const rows = countries.map((c) => [
      c.country_name,
      c.iso_code,
      "",
      c.has_dp_law ? "Yes" : "No",
      c.law_name ?? "",
      c.law_status ?? "",
      c.law_year?.toString() ?? "",
      c.authority_name ?? "",
      c.authority_website ?? "",
      c.transfer_mechanisms ?? "",
      c.breach_notification_detail ? "Yes" : "No",
      c.breach_notification_hours?.toString() ?? "",
      c.max_fine_description ?? "",
      c.overall_score?.toString() ?? "",
      c.tier ?? "",
    ]);
    const csv = toCSV(headers, rows);
    const fname = `africastn-data-protection-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, csv);
    setLastExport(fname);
  }, [countries]);

  const activeValue = opportunities
    .filter((o) => !["won", "lost"].includes(o.stage))
    .reduce((sum, o) => sum + (o.value_gbp ?? 0), 0);

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Export data &middot; platform summary
        </p>
      </div>

      {/* Summary cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Prospects" value={stats.prospects.total} />
          <SummaryCard label="Clients" value={stats.clients.total} />
          <SummaryCard label="Pipeline value" value={`£${activeValue.toLocaleString()}`} />
          <SummaryCard label="Countries tracked" value={countries.length} />
        </div>
      )}

      {/* Export cards */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-4">Data exports</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <ExportCard
            title="Compliance prospects"
            description={`${prospects.length} prospect records — company details, outreach status, IR registration, document URLs.`}
            onExport={exportProspects}
          />
          <ExportCard
            title="Clients"
            description={`${clients.length} client records — service tiers, annual fees, engagement dates, activity counts.`}
            onExport={exportClients}
          />
          <ExportCard
            title="Pipeline opportunities"
            description={`${opportunities.length} opportunities — stages, values, expected close dates, interactions.`}
            onExport={exportPipeline}
          />
          <ExportCard
            title="Data protection (countries)"
            description={`${countries.length} African countries — DP laws, authorities, scores, penalties.`}
            onExport={exportCountries}
          />
        </div>
      </section>

      {lastExport && (
        <p className="text-xs text-gray-400">Last export: {lastExport}</p>
      )}

      {/* Quick stats breakdown */}
      {stats && (
        <section>
          <h2 className="text-lg font-semibold text-[#1A1C1E] mb-4">Platform snapshot</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <BreakdownCard
              title="Prospect pipeline"
              items={[
                { label: "High priority", value: stats.prospects.high_priority },
                { label: "Identified", value: stats.prospects.identified },
                { label: "Contacted", value: stats.prospects.contacted },
                { label: "Responded", value: stats.prospects.responded },
                { label: "Converted", value: stats.prospects.converted },
              ]}
            />
            <BreakdownCard
              title="Client portfolio"
              items={[
                { label: "Active", value: stats.clients.active },
                { label: "Total ARR", value: `£${Number(stats.clients.arr).toLocaleString()}` },
              ]}
            />
            <BreakdownCard
              title="BD pipeline"
              items={[
                { label: "Total opportunities", value: stats.pipeline.total },
                { label: "Total value", value: `£${Number(stats.pipeline.total_value).toLocaleString()}` },
                { label: "Active value", value: `£${Number(stats.pipeline.active_value).toLocaleString()}` },
                { label: "Won", value: stats.pipeline.won },
              ]}
            />
          </div>
        </section>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API errors:</strong> {errors.join("; ")}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function ExportCard({
  title,
  description,
  onExport,
}: {
  title: string;
  description: string;
  onExport: () => void;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 flex items-start justify-between gap-4">
      <div>
        <h3 className="font-semibold text-[#1A1C1E] text-sm">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      </div>
      <button onClick={onExport} className={btnPrimary + " shrink-0"}>
        Export CSV
      </button>
    </div>
  );
}

function BreakdownCard({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: number | string }>;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-[#1A1C1E] text-sm mb-3">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between text-xs">
            <span className="text-gray-500">{item.label}</span>
            <span className="font-medium text-[#1A1C1E]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

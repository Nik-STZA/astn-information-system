/**
 * Compliance Services page.
 * Shows prospects and clients from the POPIA representative pipeline.
 */

import {
  fetchProspects,
  fetchClients,
  type Prospect,
  type Client,
} from "@/lib/data/compliance";

const STATUS_COLOURS: Record<string, string> = {
  identified: "bg-gray-100 text-gray-700",
  researched: "bg-blue-100 text-blue-800",
  contacted: "bg-amber-100 text-amber-800",
  responded: "bg-emerald-100 text-emerald-800",
  converted: "bg-[#C5A059]/20 text-[#8B7340]",
  declined: "bg-red-100 text-red-700",
};

const PRIORITY_COLOURS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-gray-100 text-gray-600",
};

function Badge({
  value,
  map,
}: {
  value: string | null;
  map: Record<string, string>;
}) {
  if (!value) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? "bg-gray-100 text-gray-700"}`}
    >
      {value}
    </span>
  );
}

export default async function CompliancePage() {
  const [prospectsRes, clientsRes] = await Promise.all([
    fetchProspects(),
    fetchClients(),
  ]);

  const prospects = prospectsRes.data?.data ?? [];
  const clients = clientsRes.data?.data ?? [];

  // Stats
  const byStatus = prospects.reduce(
    (acc, p) => {
      acc[p.outreach_status] = (acc[p.outreach_status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const bySector = prospects.reduce(
    (acc, p) => {
      if (p.sector) acc[p.sector] = (acc[p.sector] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const activeClients = clients.filter((c) => c.status === "engaged");
  const arr = activeClients.reduce(
    (sum, c) => sum + (c.annual_fee_gbp ?? 0),
    0
  );

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">
          Compliance services
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          POPIA representative pipeline &middot; prospects &middot; clients
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total prospects" value={prospects.length.toString()} />
        <StatCard
          label="High priority"
          value={
            prospects
              .filter((p) => p.priority === "high")
              .length.toString()
          }
        />
        <StatCard
          label="Active clients"
          value={activeClients.length.toString()}
        />
        <StatCard label="ARR (GBP)" value={`£${arr.toLocaleString()}`} />
      </div>

      {/* Pipeline funnel */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Outreach funnel
        </h2>
        <div className="flex flex-wrap gap-3">
          {[
            "identified",
            "researched",
            "contacted",
            "responded",
            "converted",
          ].map((status) => (
            <div
              key={status}
              className="px-4 py-2 rounded-lg border border-gray-200 text-center min-w-[100px]"
            >
              <div className="text-xl font-bold text-[#1A1C1E]">
                {byStatus[status] ?? 0}
              </div>
              <Badge value={status} map={STATUS_COLOURS} />
            </div>
          ))}
        </div>
      </section>

      {/* Sector breakdown */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Prospects by sector
        </h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(bySector)
            .sort((a, b) => b[1] - a[1])
            .map(([sector, count]) => (
              <div
                key={sector}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              >
                <span className="font-medium text-[#1A1C1E]">{count}</span>
                <span className="text-gray-500 ml-1">{sector}</span>
              </div>
            ))}
        </div>
      </section>

      {/* Prospects table */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Prospects
        </h2>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1A1C1E] text-white">
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Country</th>
                <th className="px-3 py-2 text-left font-medium">Sector</th>
                <th className="px-3 py-2 text-left font-medium">Priority</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">
                  IR registered
                </th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p, i) => (
                <tr
                  key={p.id}
                  className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-[#1A1C1E]">
                      {p.company_name}
                    </div>
                    {p.company_website && (
                      <div className="text-xs text-gray-400 truncate max-w-[200px]">
                        {p.company_website}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {p.company_country ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {p.sector ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={p.priority} map={PRIORITY_COLOURS} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      value={p.outreach_status}
                      map={STATUS_COLOURS}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {p.ir_registered === true ? (
                      <span className="text-emerald-600">Yes</span>
                    ) : p.ir_registered === false ? (
                      <span className="text-red-500">No</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Clients table */}
      {clients.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
            Clients
          </h2>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1A1C1E] text-white">
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Tier</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Annual fee (GBP)
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Activities
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => (
                  <tr
                    key={c.id}
                    className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    <td className="px-3 py-2 font-medium text-[#1A1C1E]">
                      {c.company_name}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        value={c.status}
                        map={{
                          engaged: "bg-emerald-100 text-emerald-800",
                          prospect: "bg-gray-100 text-gray-700",
                          churned: "bg-red-100 text-red-700",
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {c.service_tier ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {c.annual_fee_gbp != null
                        ? `£${c.annual_fee_gbp.toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {c.activity_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Errors */}
      {(prospectsRes.error || clientsRes.error) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong>{" "}
          {prospectsRes.error || clientsRes.error}
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

import Link from "next/link";
import RegistryExportButtons from "@/components/RegistryExportButtons";
import RegistryFilters from "@/components/RegistryFilters";
import RegistryPagination from "@/components/RegistryPagination";
import {
  CONFIDENCE_BANDS,
  REGISTRY_PAGE_SIZE,
  confidenceBand,
  fetchFilterOptions,
  fetchOrganizations,
  type ConfidenceBand,
  type RegistryFilters as RegistryFilterValues,
} from "@/lib/data/registry";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function readConfidence(value: string | string[] | undefined): ConfidenceBand | null {
  const raw = readParam(value);
  if (!raw) return null;
  return (CONFIDENCE_BANDS as readonly string[]).includes(raw) ? (raw as ConfidenceBand) : null;
}

function readPage(value: string | string[] | undefined): number {
  const raw = readParam(value);
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/* ── Confidence pill colours ─────────────────────────────────────── */

const PILL_META: Record<string, { bg: string; color: string; border: string }> = {
  High:        { bg: "#E7F1EA", color: "#2E7D32", border: "#C7E1D1" },
  Medium:      { bg: "#FBF1DE", color: "#A67514", border: "#EAD6A6" },
  "Medium-Low":{ bg: "#FBE7E1", color: "#B4432C", border: "#EDCBBF" },
  Low:         { bg: "#FBE3E3", color: "#B02020", border: "#E6C4C4" },
};
const PILL_UNSET = { bg: "#EEECE7", color: "#8E9196", border: "#DED9CE" };

function ConfidencePill({ band }: { band: string | null }) {
  const m = band ? PILL_META[band] ?? PILL_UNSET : PILL_UNSET;
  const label = band ?? "—";
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

/* ── Page ────────────────────────────────────────────────────────── */

export default async function RegistryPage({ searchParams }: PageProps) {
  const filters: RegistryFilterValues = {
    country: readParam(searchParams.country),
    sport: readParam(searchParams.sport),
    type: readParam(searchParams.type),
    confidence: readConfidence(searchParams.confidence),
    q: readParam(searchParams.q),
  };
  const page = readPage(searchParams.page);

  const [options, result] = await Promise.all([
    fetchFilterOptions(),
    fetchOrganizations(filters, page, REGISTRY_PAGE_SIZE),
  ]);

  const fmt = (n: number) => n.toLocaleString("en-GB");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
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
            AfricanSTN &middot; Registry
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
            Registry
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
            Browse and filter the full organisation registry.
          </p>
        </div>
        <RegistryExportButtons searchParams={searchParams} />
      </div>

      {/* Filter bar */}
      <RegistryFilters options={options} />

      {/* Result bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "0 4px",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 12.5,
            color: "#55524C",
          }}
        >
          Showing{" "}
          <span style={{ color: "#B08D3F" }}>
            {fmt(result.totalCount)}
          </span>{" "}
          organisations
        </div>
        <RegistryPagination
          page={page}
          pageSize={REGISTRY_PAGE_SIZE}
          totalCount={result.totalCount}
          searchParams={searchParams}
        />
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
        {result.rows.length === 0 ? (
          <div
            style={{
              padding: "32px 18px",
              textAlign: "center",
              color: "#8E9196",
              fontSize: 13,
            }}
          >
            No organisations match the current filters.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr
                style={{
                  background: "#F6F1E7",
                  borderBottom: "1.5px solid #E4D9C4",
                }}
              >
                {["Organisation", "Country", "Sport", "Type", "Confidence"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        fontWeight: 700,
                        fontSize: 10.5,
                        lineHeight: 1,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#6E6A62",
                        padding: "13px 18px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((org, idx) => {
                const band = confidenceBand(org.source_confidence);
                return (
                  <tr
                    key={org.id}
                    style={{
                      background: idx % 2 ? "#FBF8F1" : "#FFFFFF",
                      borderBottom: "1px solid #F0E8D8",
                    }}
                    className="hover:!bg-[#FBF6EC]"
                  >
                    <td
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        lineHeight: 1.3,
                        color: "var(--tx)",
                        padding: "12px 18px",
                      }}
                    >
                      <Link
                        href={`/registry/${org.id}`}
                        style={{
                          color: "var(--tx)",
                          textDecoration: "none",
                        }}
                        className="hover:!text-[#B08D3F]"
                      >
                        {org.organization_name ?? "—"}
                      </Link>
                    </td>
                    <td
                      style={{
                        fontWeight: 500,
                        fontSize: 12.5,
                        lineHeight: 1.3,
                        color: "#55524C",
                        padding: "12px 14px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {org.country ?? "—"}
                    </td>
                    <td
                      style={{
                        fontWeight: 500,
                        fontSize: 12.5,
                        lineHeight: 1.3,
                        color: "#55524C",
                        padding: "12px 14px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {org.sport ?? "—"}
                    </td>
                    <td
                      style={{
                        fontWeight: 500,
                        fontSize: 12.5,
                        lineHeight: 1.3,
                        color: "#55524C",
                        padding: "12px 14px",
                      }}
                    >
                      {org.organization_type ?? "—"}
                    </td>
                    <td style={{ padding: "12px 18px", whiteSpace: "nowrap" }}>
                      <ConfidencePill band={band} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom pagination */}
      {result.rows.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <RegistryPagination
            page={page}
            pageSize={REGISTRY_PAGE_SIZE}
            totalCount={result.totalCount}
            searchParams={searchParams}
          />
        </div>
      )}
    </div>
  );
}

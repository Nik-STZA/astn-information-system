import Link from "next/link";
import RegistryExportButtons from "@/components/RegistryExportButtons";
import RegistryPagination from "@/components/RegistryPagination";
import VerifyFilters from "@/components/VerifyFilters";
import {
  CONFIDENCE_BANDS,
  REGISTRY_PAGE_SIZE,
  confidenceBand,
  fetchFilterOptions,
  fetchOrganizations,
  fetchVerificationQueueCount,
  isRegistrySortField,
  type ConfidenceBand,
  type RegistryFilters as RegistryFilterValues,
  type RegistrySortField,
  type SortDir,
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

/* ── Confidence pill ─────────────────────────────────────────────── */

const PILL_META: Record<string, { bg: string; color: string; border: string }> = {
  Medium:      { bg: "#FBF1DE", color: "#A67514", border: "#EAD6A6" },
  "Medium-Low":{ bg: "#FBE7E1", color: "#B4432C", border: "#EDCBBF" },
  Low:         { bg: "#FBE3E3", color: "#B02020", border: "#E6C4C4" },
};
const PILL_UNSET = { bg: "#EEECE7", color: "#8E9196", border: "#DED9CE" };

function ConfidencePill({ band }: { band: string | null }) {
  const m = band ? PILL_META[band] ?? PILL_UNSET : PILL_UNSET;
  const label = band ?? "Unset";
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

/* ── Sortable column config ──────────────────────────────────────── */

const SORT_COLUMNS: Array<{ label: string; field: RegistrySortField }> = [
  { label: "Organisation", field: "organization_name" },
  { label: "Country",      field: "country" },
  { label: "Type",         field: "organization_type" },
  { label: "Confidence",   field: "source_confidence" },
];

function sortIndicator(field: RegistrySortField, activeSort: RegistrySortField, activeDir: SortDir): string {
  if (field !== activeSort) return "";
  return activeDir === "asc" ? " ▲" : " ▼";
}

function sortHref(
  field: RegistrySortField,
  activeSort: RegistrySortField,
  activeDir: SortDir,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === "sort" || k === "dir" || k === "page") continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) params.set(k, val);
  }
  params.set("sort", field);
  const nextDir = field === activeSort && activeDir === "asc" ? "desc" : "asc";
  params.set("dir", nextDir);
  const qs = params.toString();
  return qs ? `/registry/verify?${qs}` : "/registry/verify";
}

/* ── Page ────────────────────────────────────────────────────────── */

export default async function VerificationQueuePage({ searchParams }: PageProps) {
  const filters: RegistryFilterValues = {
    country: readParam(searchParams.country),
    sport: readParam(searchParams.sport),
    type: readParam(searchParams.type),
    confidence: readConfidence(searchParams.confidence),
    q: readParam(searchParams.q),
  };
  const page = readPage(searchParams.page);

  const sortRaw = readParam(searchParams.sort);
  const activeSort: RegistrySortField = isRegistrySortField(sortRaw) ? sortRaw : "organization_name";
  const dirRaw = readParam(searchParams.dir);
  const activeDir: SortDir = dirRaw === "desc" ? "desc" : "asc";

  const [options, result, queueTotal] = await Promise.all([
    fetchFilterOptions(),
    fetchOrganizations(filters, page, REGISTRY_PAGE_SIZE, { verifyMode: true, sort: activeSort, sortDir: activeDir }),
    fetchVerificationQueueCount(),
  ]);

  const filteredCount = result.totalCount;
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
            Verification queue
          </h1>
          <p
            style={{
              fontWeight: 500,
              fontSize: 13,
              lineHeight: 1.45,
              color: "#8E9196",
              margin: 0,
              maxWidth: 640,
            }}
          >
            Organisations below High confidence. Add a primary or secondary
            source and set the confidence — raising it to High clears the
            item from the queue.
          </p>
        </div>
        <Link
          href="/registry"
          style={{
            fontWeight: 600,
            fontSize: 12,
            lineHeight: 1,
            color: "#B08D3F",
            textDecoration: "none",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          Browse all organisations →
        </Link>
      </div>

      {/* Filter bar */}
      <VerifyFilters options={options} />

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
          style={{ fontWeight: 600, fontSize: 12.5, color: "#55524C" }}
        >
          <span style={{ color: "#B08D3F" }}>{fmt(filteredCount)}</span>{" "}
          of {fmt(queueTotal)} awaiting verification
        </div>
        <RegistryPagination
          page={page}
          pageSize={REGISTRY_PAGE_SIZE}
          totalCount={filteredCount}
          searchParams={searchParams}
          basePath="/registry/verify"
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
              padding: "40px 18px",
              textAlign: "center",
            }}
          >
            {queueTotal === 0 ? (
              <>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1.3,
                    color: "#2E7D32",
                    marginBottom: 4,
                  }}
                >
                  Queue clear
                </div>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 12,
                    lineHeight: 1.4,
                    color: "#8E9196",
                  }}
                >
                  Every organisation is at High confidence.
                </div>
              </>
            ) : (
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: "#8E9196",
                }}
              >
                No organisations match the current filters.
              </div>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background: "#F6F1E7",
                  borderBottom: "1.5px solid #E4D9C4",
                }}
              >
                <th style={{ width: 40, padding: "13px 0 13px 18px" }} />
                {SORT_COLUMNS.map(({ label, field }) => (
                  <th
                    key={field}
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
                    <Link
                      href={sortHref(field, activeSort, activeDir, searchParams)}
                      style={{
                        color: field === activeSort ? "#B08D3F" : "#6E6A62",
                        textDecoration: "none",
                        cursor: "pointer",
                      }}
                    >
                      {label}{sortIndicator(field, activeSort, activeDir)}
                    </Link>
                  </th>
                ))}
                <th
                  style={{
                    textAlign: "right",
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
                  Action
                </th>
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
                    <td style={{ padding: "12px 0 12px 18px", width: 40 }}>
                      {org.country_iso ? (
                        <span style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", display: "block", border: "1px solid #E4D9C4" }}>
                          <img
                            src={`https://flagcdn.com/w40/${org.country_iso.toLowerCase()}.png`}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        </span>
                      ) : (
                        <span style={{ width: 20, height: 20, borderRadius: "50%", display: "block", background: "#F2F0EB", border: "1px solid #E4D9C4" }} />
                      )}
                    </td>
                    <td
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        lineHeight: 1.3,
                        color: "var(--tx)",
                        padding: "12px 18px",
                      }}
                    >
                      {org.organization_name ?? "—"}
                    </td>
                    <td
                      style={{
                        fontWeight: 500,
                        fontSize: 12.5,
                        lineHeight: 1.3,
                        color: "#55524C",
                        padding: "12px 18px",
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
                        padding: "12px 18px",
                      }}
                    >
                      {org.organization_type ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 18px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <ConfidencePill band={band} />
                    </td>
                    <td
                      style={{
                        padding: "12px 18px",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Link
                        href={`/registry/${org.id}`}
                        style={{
                          fontWeight: 600,
                          fontSize: 11.5,
                          lineHeight: 1,
                          color: "#141414",
                          background: "#C5A059",
                          border: "none",
                          borderRadius: 6,
                          padding: "8px 13px",
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                      >
                        Verify
                      </Link>
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
            totalCount={filteredCount}
            searchParams={searchParams}
            basePath="/registry/verify"
          />
        </div>
      )}
    </div>
  );
}

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

export default async function RegistryPage({ searchParams }: PageProps) {
  const filters: RegistryFilterValues = {
    country: readParam(searchParams.country),
    sport: readParam(searchParams.sport),
    type: readParam(searchParams.type),
    confidence: readConfidence(searchParams.confidence),
  };
  const page = readPage(searchParams.page);

  const [options, result] = await Promise.all([
    fetchFilterOptions(),
    fetchOrganizations(filters, page, REGISTRY_PAGE_SIZE),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1>Registry</h1>
        <p className="text-caption text-warm-grey mt-1">
          Browse and filter the {result.totalCount.toLocaleString("en-GB")} organisations matching your selection.
        </p>
      </div>

      <RegistryFilters options={options} />

      <RegistryPagination
        page={page}
        pageSize={REGISTRY_PAGE_SIZE}
        totalCount={result.totalCount}
        searchParams={searchParams}
      />

      <div className="card overflow-hidden">
        {result.rows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-body-app text-warm-grey">
              No organisations match the current filters.
            </p>
          </div>
        ) : (
          <table className="table-brand">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Country</th>
                <th>Sport</th>
                <th>Type</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((org) => {
                const band = confidenceBand(org.source_confidence);
                return (
                  <tr key={org.id}>
                    <td className="font-medium text-brand-dark">{org.organization_name ?? "—"}</td>
                    <td className="text-warm-grey">{org.country ?? "—"}</td>
                    <td className="text-warm-grey">{org.sport ?? "—"}</td>
                    <td>{org.organization_type ?? "—"}</td>
                    <td>
                      {band === "High" && <span className="pill pill-high">High</span>}
                      {band === "Medium" && <span className="pill pill-medium">Medium</span>}
                      {(band === "Medium-Low" || band === "Low") && (
                        <span className="pill pill-low">{band}</span>
                      )}
                      {band === null && <span className="pill pill-neutral">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {result.rows.length > 0 && (
        <RegistryPagination
          page={page}
          pageSize={REGISTRY_PAGE_SIZE}
          totalCount={result.totalCount}
          searchParams={searchParams}
        />
      )}
    </div>
  );
}

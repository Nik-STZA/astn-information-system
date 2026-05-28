import Link from "next/link";

type Props = {
  page: number;
  pageSize: number;
  totalCount: number;
  // The current URL search params, used so prev/next preserve filters.
  searchParams: Record<string, string | string[] | undefined>;
  // Path the prev/next links point at. Defaults to /registry so existing
  // callers don't change; the verification queue passes /registry/verify.
  basePath?: string;
};

function buildHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page") continue;
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export default function RegistryPagination({
  page,
  pageSize,
  totalCount,
  searchParams,
  basePath = "/registry",
}: Props) {
  if (totalCount === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const firstRow = (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, totalCount);

  const prevDisabled = safePage <= 1;
  const nextDisabled = safePage >= totalPages;

  const fmt = (n: number) => n.toLocaleString("en-GB");

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1">
      <p className="text-caption text-warm-grey">
        Showing <span className="font-bold text-near-black">{fmt(firstRow)}–{fmt(lastRow)}</span> of{" "}
        <span className="font-bold text-near-black">{fmt(totalCount)}</span>
      </p>
      <div className="flex items-center gap-2">
        {prevDisabled ? (
          <span className="btn-secondary opacity-50 cursor-not-allowed">Previous</span>
        ) : (
          <Link href={buildHref(basePath, searchParams, safePage - 1)} className="btn-secondary">
            Previous
          </Link>
        )}
        <span className="text-caption text-warm-grey px-2">
          Page <span className="font-bold text-near-black">{fmt(safePage)}</span> of {fmt(totalPages)}
        </span>
        {nextDisabled ? (
          <span className="btn-secondary opacity-50 cursor-not-allowed">Next</span>
        ) : (
          <Link href={buildHref(basePath, searchParams, safePage + 1)} className="btn-secondary">
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";

type Props = {
  page: number;
  pageSize: number;
  totalCount: number;
  searchParams: Record<string, string | string[] | undefined>;
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

const btnBase: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  borderRadius: 6,
  padding: "8px 12px",
  textDecoration: "none",
  display: "inline-block",
  fontFamily: "inherit",
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  color: "#141414",
  background: "#fff",
  border: "1px solid #D4C5A9",
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  color: "#B9B2A2",
  background: "#fff",
  border: "1px solid #E4D9C4",
  cursor: "not-allowed",
  opacity: 0.6,
};

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
  const fmt = (n: number) => n.toLocaleString("en-GB");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {safePage <= 1 ? (
        <span style={btnDisabled}>Previous</span>
      ) : (
        <Link href={buildHref(basePath, searchParams, safePage - 1)} style={btnActive}>
          Previous
        </Link>
      )}
      <span
        style={{
          fontWeight: 600,
          fontSize: 12,
          color: "#8E9196",
          padding: "0 4px",
        }}
      >
        Page {fmt(safePage)} of {fmt(totalPages)}
      </span>
      {safePage >= totalPages ? (
        <span style={btnDisabled}>Next</span>
      ) : (
        <Link href={buildHref(basePath, searchParams, safePage + 1)} style={btnActive}>
          Next
        </Link>
      )}
    </div>
  );
}

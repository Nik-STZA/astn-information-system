type Props = {
  searchParams: Record<string, string | string[] | undefined>;
  // Pass true when rendered from /registry/verify so the export reflects the
  // verification queue scope, not the full registry.
  verifyMode?: boolean;
};

function buildHref(
  format: "csv" | "docx",
  searchParams: Record<string, string | string[] | undefined>,
  verifyMode: boolean,
): string {
  const params = new URLSearchParams();
  params.set("format", format);
  if (verifyMode) params.set("queue", "verify");
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page" || key === "format" || key === "queue") continue;
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  return `/registry/export?${params.toString()}`;
}

/**
 * Two download links that preserve the current filter querystring.
 * CSV is the full data dump for analysis; Word is a brand-styled table-shape
 * summary capped at 1,000 rows.
 */
export default function RegistryExportButtons({ searchParams, verifyMode = false }: Props) {
  const csvHref = buildHref("csv", searchParams, verifyMode);
  const docxHref = buildHref("docx", searchParams, verifyMode);
  return (
    <div className="flex items-center gap-2">
      <span className="text-caption text-warm-grey uppercase tracking-wider font-bold">
        Export
      </span>
      <a href={csvHref} className="btn-text" download>
        CSV
      </a>
      <a href={docxHref} className="btn-text" download>
        Word
      </a>
    </div>
  );
}

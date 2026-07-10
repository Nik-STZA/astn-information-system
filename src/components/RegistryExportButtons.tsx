type Props = {
  searchParams: Record<string, string | string[] | undefined>;
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

const btnGold: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  color: "#141414",
  background: "#C5A059",
  borderRadius: 7,
  padding: "9px 14px",
  textDecoration: "none",
  display: "inline-block",
};

const btnOutline: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1,
  color: "#B08D3F",
  background: "#fff",
  border: "1px solid #D4C5A9",
  borderRadius: 7,
  padding: "9px 14px",
  textDecoration: "none",
  display: "inline-block",
};

export default function RegistryExportButtons({
  searchParams,
  verifyMode = false,
}: Props) {
  const csvHref = buildHref("csv", searchParams, verifyMode);
  const docxHref = buildHref("docx", searchParams, verifyMode);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          fontSize: 10,
          lineHeight: 1,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#A29C8E",
        }}
      >
        Export
      </span>
      <a href={csvHref} style={btnGold} download>
        CSV
      </a>
      <a href={docxHref} style={btnOutline} download>
        Word
      </a>
    </div>
  );
}

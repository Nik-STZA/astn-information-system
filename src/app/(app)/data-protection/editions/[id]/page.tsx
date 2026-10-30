import { markdownToHtml } from "@/lib/markdown";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchEditionByNumber } from "@/lib/data/editions";

export const dynamic = "force-dynamic";

function flagUrl(iso: string): string {
  return `https://flagcdn.com/w80/${iso.toLowerCase()}.png`;
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const isPublished = s === "published";
  const isDrafted = s === "drafted" || s === "draft";
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 4,
        background: isPublished
          ? "rgba(46,125,50,.12)"
          : isDrafted
            ? "rgba(204,119,0,.10)"
            : "rgba(142,145,150,.10)",
        color: isPublished
          ? "#2E7D32"
          : isDrafted
            ? "#CC7700"
            : "var(--sub)",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default async function EditionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const editionNumber = parseInt(id, 10);
  if (isNaN(editionNumber)) notFound();

  const edition = await fetchEditionByNumber(editionNumber);
  if (!edition) notFound();

  const contentHtml = edition.contentMarkdown
    ? markdownToHtml(edition.contentMarkdown)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: "var(--sub)" }}>
        <Link
          href="/data-protection/editions"
          style={{ color: "var(--sub)", textDecoration: "none" }}
        >
          Editions
        </Link>
        <span style={{ margin: "0 6px", opacity: 0.4 }}>&rsaquo;</span>
        <span style={{ color: "var(--tx)", fontWeight: 600 }}>
          #{edition.editionNumber}
          {edition.countryName ? ` — ${edition.countryName}` : ""}
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        {edition.countryIso && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={flagUrl(edition.countryIso)}
            alt={edition.countryIso}
            width={48}
            height={48}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              objectFit: "cover",
              border: "2px solid var(--bd)",
              flexShrink: 0,
              marginTop: 2,
            }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 14, color: "#C5A059" }}>
              Edition #{edition.editionNumber}
            </span>
            <StatusPill status={edition.status} />
            <span
              style={{
                fontWeight: 600,
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 4,
                background: "rgba(197,160,89,.12)",
                color: "#C5A059",
              }}
            >
              Phase {edition.phase} · Week {edition.weekNumber}
            </span>
          </div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: 24,
              lineHeight: 1.2,
              color: "var(--tx)",
              margin: 0,
            }}
          >
            {edition.title ?? edition.countryName ?? `Edition ${edition.editionNumber}`}
          </h1>
          {/* Meta row */}
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: 12,
              color: "var(--sub)",
              marginTop: 8,
            }}
          >
            {edition.countryName && <span>{edition.countryName}</span>}
            {edition.wordCount && (
              <span>
                {edition.wordCount.toLocaleString("en-GB")} words
              </span>
            )}
            {edition.publishedAt && (
              <span>
                Published{" "}
                {new Date(edition.publishedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {contentHtml ? (
        <article
          className="card"
          style={{ padding: "32px 36px" }}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      ) : (
        <div
          className="card"
          style={{
            padding: "48px 36px",
            textAlign: "center",
            color: "var(--sub)",
            fontSize: 14,
          }}
        >
          No content available for this edition.
        </div>
      )}

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Link
          href="/data-protection/editions"
          style={{
            fontSize: 13,
            color: "#C5A059",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          &larr; All editions
        </Link>

        {edition.jurisdictionId && (
          <Link
            href={`/data-protection/jurisdictions/${edition.jurisdictionId}`}
            style={{
              fontSize: 13,
              color: "#C5A059",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            View jurisdiction record &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import {
  fetchAllEditions,
  fetchEditionMetrics,
} from "@/lib/data/editions";

export const dynamic = "force-dynamic";

function flagUrl(iso: string): string {
  return `https://flagcdn.com/w40/${iso.toLowerCase()}.png`;
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
        fontSize: 10,
        padding: "2px 8px",
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
        letterSpacing: "0.02em",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

function PhasePill({ phase }: { phase: number }) {
  const colours: Record<number, { bg: string; fg: string }> = {
    1: { bg: "rgba(46,125,50,.12)", fg: "#2E7D32" },
    2: { bg: "rgba(197,160,89,.12)", fg: "#C5A059" },
    3: { bg: "rgba(30,100,180,.12)", fg: "#1E64B4" },
    4: { bg: "rgba(156,39,176,.12)", fg: "#9C27B0" },
    5: { bg: "rgba(142,145,150,.10)", fg: "var(--sub)" },
    6: { bg: "rgba(204,0,0,.10)", fg: "#CC0000" },
  };
  const c = colours[phase] || colours[5];
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        background: c.bg,
        color: c.fg,
        letterSpacing: "0.02em",
      }}
    >
      Phase {phase}
    </span>
  );
}

export default async function EditionsPage() {
  const [editions, metrics] = await Promise.all([
    fetchAllEditions(),
    fetchEditionMetrics(),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Header */}
      <div>
        <div
          style={{
            fontWeight: 500,
            fontSize: 12,
            color: "var(--sub)",
            marginBottom: 4,
          }}
        >
          AfricanSTN{" "}
          <span style={{ margin: "0 6px", opacity: 0.4 }}>&middot;</span>{" "}
          Publishing
        </div>
        <h1
          style={{
            fontWeight: 800,
            fontSize: 26,
            lineHeight: 1.15,
            color: "var(--tx)",
            margin: 0,
          }}
        >
          Data protection pulse
        </h1>
        <p
          style={{
            fontWeight: 400,
            fontSize: 13,
            color: "var(--sub)",
            marginTop: 4,
          }}
        >
          {metrics.total} editions — {metrics.published} published
        </p>
      </div>

      {/* Counter cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "var(--pnl)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 28,
              lineHeight: 1,
              color: "var(--tx)",
            }}
          >
            {metrics.total}
          </span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--sub)",
            }}
          >
            Total editions
          </span>
        </div>
        <div
          style={{
            background: "var(--pnl)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 28,
              lineHeight: 1,
              color: "#2E7D32",
            }}
          >
            {metrics.published}
          </span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--sub)",
            }}
          >
            Published
          </span>
        </div>
      </section>

      {/* Editions grid */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {editions.map((e) => (
          <Link
            key={e.id}
            href={`/data-protection/editions/${e.editionNumber}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              className="card"
              style={{
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                height: "100%",
                transition: "border-color .15s, box-shadow .15s",
                cursor: "pointer",
              }}
            >
              {/* Top row: edition number + country flag */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: 13,
                      color: "#C5A059",
                    }}
                  >
                    #{e.editionNumber}
                  </span>
                  <PhasePill phase={e.phase} />
                  <StatusPill status={e.status} />
                </div>
                {e.countryIso && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={flagUrl(e.countryIso)}
                    alt={e.countryIso}
                    width={24}
                    height={24}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>

              {/* Title */}
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1.3,
                  color: "var(--tx)",
                }}
              >
                {e.title ?? e.countryName ?? `Edition ${e.editionNumber}`}
              </div>

              {/* Hook */}
              {e.hookText && (
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "var(--sub)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {e.hookText}
                </div>
              )}

              {/* Bottom meta */}
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  fontSize: 11,
                  color: "var(--sub)",
                  marginTop: "auto",
                  paddingTop: 6,
                }}
              >
                {e.countryName && <span>{e.countryName}</span>}
                {e.wordCount && (
                  <span>
                    {e.wordCount.toLocaleString("en-GB")} words
                  </span>
                )}
                <span>Week {e.weekNumber}</span>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

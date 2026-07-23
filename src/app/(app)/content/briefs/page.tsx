import Link from "next/link";
import { fetchBriefs } from "@/lib/data/content";

export const dynamic = "force-dynamic";

/**
 * Weekly briefs archive — the canonical copies from weekly_reports.
 */
export default async function BriefsPage() {
  const res = await fetchBriefs();
  const briefs = res.data?.data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 12, color: "var(--sub)", marginBottom: 4 }}>
          AfricanSTN <span style={{ margin: "0 6px", opacity: 0.4 }}>&middot;</span> Publishing
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.15, color: "var(--tx)", margin: 0 }}>
          Weekly briefs
        </h1>
        <p style={{ fontWeight: 400, fontSize: 13, color: "var(--sub)", marginTop: 4 }}>
          {briefs.length.toLocaleString("en-GB")} briefs generated — newest first.
        </p>
      </div>

      {briefs.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center", border: "1.5px dashed var(--empty-border)", borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--sub)", marginBottom: 4 }}>No briefs yet</div>
          <div style={{ fontWeight: 500, fontSize: 12.5, color: "var(--empty-text)" }}>
            Generate one from the review queue.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {briefs.map((b) => (
            <Link
              key={b.id}
              href={`/content/briefs/${b.id}`}
              style={{
                display: "block",
                background: "var(--pnl)",
                border: "1px solid var(--bd)",
                borderRadius: 10,
                padding: "16px 18px",
                textDecoration: "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: "var(--tx)" }}>
                  Week ending{" "}
                  {new Date(b.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--sub)" }}>
                  {b.item_count} items
                </span>
              </div>
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--label-text)",
                  margin: "8px 0 0",
                  lineHeight: 1.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {b.preview.replace(/[#*\-]/g, "").slice(0, 260)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

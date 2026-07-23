import { fetchReviewQueue, fetchReviewStats } from "@/lib/data/content";
import ReviewClient from "./ReviewClient";

export const dynamic = "force-dynamic";

/**
 * Editorial review queue — the in-OS replacement for the Notion review loop.
 * Approve/reject classified items; approved items form the weekly brief.
 */
export default async function ReviewPage() {
  // Default floor 0.4 — the same relevance threshold the brief generator uses.
  const [queueRes, statsRes] = await Promise.all([
    fetchReviewQueue("pending_review", 25, 0, 0.4),
    fetchReviewStats(),
  ]);

  const stats = statsRes.data ?? {
    pending: 0,
    approved: 0,
    rejected: 0,
    pending_this_week: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 12, color: "var(--sub)", marginBottom: 4 }}>
          AfricanSTN <span style={{ margin: "0 6px", opacity: 0.4 }}>&middot;</span> Publishing
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.15, color: "var(--tx)", margin: 0 }}>
          Review queue
        </h1>
        <p style={{ fontWeight: 400, fontSize: 13, color: "var(--sub)", marginTop: 4 }}>
          Approve items for the weekly brief. {stats.pending.toLocaleString("en-GB")} awaiting review
          ({stats.pending_this_week.toLocaleString("en-GB")} from the last 7 days).
        </p>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          maxWidth: 640,
        }}
      >
        {[
          { label: "Pending", value: stats.pending, color: "var(--warning-amber)" },
          { label: "This week", value: stats.pending_this_week, color: "var(--tx)" },
          { label: "Approved", value: stats.approved, color: "var(--success-green)" },
          { label: "Rejected", value: stats.rejected, color: "var(--sub)" },
        ].map((c) => (
          <div
            key={c.label}
            style={{
              background: "var(--pnl)",
              border: "1px solid var(--bd)",
              borderRadius: 10,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 24, lineHeight: 1, color: c.color }}>
              {c.value.toLocaleString("en-GB")}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--sub)",
              }}
            >
              {c.label}
            </span>
          </div>
        ))}
      </section>

      <ReviewClient
        initialItems={queueRes.data?.data ?? []}
        initialTotal={queueRes.data?.count ?? 0}
      />
    </div>
  );
}

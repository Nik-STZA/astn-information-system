import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchBrief } from "@/lib/data/content";
import { markdownToHtml } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetchBrief(id);
  if (!res.data) notFound();
  const brief = res.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 820 }}>
      <div>
        <Link href="/content/briefs" style={{ fontSize: 12, fontWeight: 600, color: "var(--gold-dark)", textDecoration: "none" }}>
          ← All briefs
        </Link>
        <h1 style={{ fontWeight: 800, fontSize: 24, lineHeight: 1.2, color: "var(--tx)", margin: "10px 0 0" }}>
          Weekly brief —{" "}
          {new Date(brief.created_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 4 }}>
          {brief.item_count} items
        </p>
      </div>

      <article
        className="brief-prose"
        style={{
          background: "var(--pnl)",
          border: "1px solid var(--bd)",
          borderRadius: 12,
          padding: "28px 32px",
          fontSize: 13.5,
          lineHeight: 1.65,
          color: "var(--tx)",
        }}
        dangerouslySetInnerHTML={{ __html: markdownToHtml(brief.report_markdown) }}
      />
      <style>{`
        .brief-prose h1 { font-size: 20px; font-weight: 800; margin: 18px 0 10px; }
        .brief-prose h2 { font-size: 17px; font-weight: 800; margin: 18px 0 8px; }
        .brief-prose h3 { font-size: 14.5px; font-weight: 700; margin: 14px 0 6px; }
        .brief-prose h4 { font-size: 13px; font-weight: 700; margin: 12px 0 4px; }
        .brief-prose p { margin: 8px 0; }
        .brief-prose ul { margin: 8px 0; padding-left: 22px; list-style: disc; }
        .brief-prose li { margin: 4px 0; }
        .brief-prose hr { border: none; border-top: 1px solid var(--bd); margin: 16px 0; }
      `}</style>
    </div>
  );
}

// Placeholder for a client tab that is not built yet.
//
// The tab bar shows the full set from the outset so the shape of the module is
// visible, which means the unbuilt ones need somewhere to land. A page saying
// what is coming is honest; a 404 just looks broken.

import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";

export default function ComingSoon({
  slug,
  tab,
  title,
  summary,
}: {
  slug: string;
  tab: string;
  title: string;
  summary: string;
}) {
  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title={title} />
      <ClientTabs slug={slug} active={tab} />

      <div
        style={{
          padding: "28px 24px",
          border: "1px dashed var(--empty-border)",
          borderRadius: 10,
          background: "var(--empty-bg)",
          fontFamily: "Manrope, sans-serif",
          maxWidth: 620,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--sub)",
            marginBottom: 8,
          }}
        >
          Not built yet
        </div>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--tx)", margin: 0 }}>
          {summary}
        </p>
      </div>
    </div>
  );
}

// Reports for one client.
//
// Each report is a card. A card that is not built yet says what it will do
// rather than disappearing, for the same reason the unbuilt tabs do.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";

export const dynamic = "force-dynamic";

const CARD: React.CSSProperties = {
  display: "block",
  padding: "18px 20px",
  border: "1px solid var(--bd)",
  borderRadius: 10,
  background: "var(--pnl)",
  fontFamily: "Manrope, sans-serif",
  textDecoration: "none",
  color: "var(--tx)",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  marginBottom: 8,
};

export default function ReportsPage({ params }: { params: { slug: string } }) {
  const base = `/finance/clients/${params.slug}/reports`;
  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Reports" />
      <ClientTabs slug={params.slug} active="reports" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
          maxWidth: 980,
        }}
      >
        <Link href={`${base}/aged-payables`} style={CARD}>
          <div style={{ ...LABEL, color: "#C5A059" }}>Live</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>AP ageing</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--sub)", margin: 0 }}>
            Amounts owed to suppliers by age, for a single entity or combined across the
            group, straight from Xero. Export to CSV.
          </p>
        </Link>

        <div
          style={{
            ...CARD,
            border: "1px dashed var(--empty-border)",
            background: "var(--empty-bg)",
          }}
        >
          <div style={{ ...LABEL, color: "var(--sub)" }}>Not built yet</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Management pack</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--sub)", margin: 0 }}>
            Generate the month-end management pack for a chosen period and save it to the
            Finance shared drive, with the past packs listed here.
          </p>
        </div>
      </div>
    </div>
  );
}

// Finance overview. Placeholder for Phase 1: confirms the module is mounted,
// routed and reading its own config. The cross-client KPI tiles described in
// the brief arrive in Phase 6.

import PageHeader from "@/shared/ui/PageHeader";
import { FINANCE_MODULE_VERSION } from "@/modules/finance/lib/version";

export const dynamic = "force-dynamic";

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 10,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "var(--sub)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontWeight: 800,
          fontSize: 20,
          lineHeight: 1.1,
          color: "var(--tx)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Overview" />

      <p
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--sub)",
          maxWidth: 640,
          margin: "0 0 24px",
        }}
      >
        Finance module active. Cross-client summary tiles land in a later phase.
      </p>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card label="Module" value="Finance" />
        <Card label="Version" value={FINANCE_MODULE_VERSION} />
        <Card label="Status" value="Active" />
      </div>
    </div>
  );
}

// Finance client list. The landing page when Finance is selected.
//
// A client appears here only if it has a row in finance.client_finance_config,
// so the compliance module's clients do not leak in.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import { fetchFinanceClients, type FinanceClientSummary } from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

function Count({ n, label, urgent }: { n: number; label: string; urgent?: boolean }) {
  const colour = urgent && n > 0 ? "var(--alert-red)" : "var(--tx)";
  return (
    <div style={{ minWidth: 72 }}>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontWeight: 800,
          fontSize: 20,
          lineHeight: 1.1,
          color: n === 0 ? "var(--sub)" : colour,
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "var(--sub)",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ClientRow({ client }: { client: FinanceClientSummary }) {
  return (
    <Link
      href={`/finance/clients/${client.slug}/open-items`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 10,
        padding: "18px 20px",
        marginBottom: 12,
        textDecoration: "none",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 16,
            fontWeight: 800,
            color: "var(--tx)",
          }}
        >
          {client.name}
        </div>
        <div
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 12,
            color: "var(--sub)",
            marginTop: 3,
          }}
        >
          {[client.jurisdiction, client.framework, client.reporting_currency]
            .filter(Boolean)
            .join(" · ")}
          {client.close_cadence ? ` · ${client.close_cadence} close` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
        <Count n={client.p1_count} label="P1 open" urgent />
        <Count n={client.open_item_count} label="Open items" />
      </div>
    </Link>
  );
}

export default async function ClientsPage() {
  let clients: FinanceClientSummary[] = [];
  let error: string | null = null;

  try {
    clients = await fetchFinanceClients();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load clients";
  }

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Clients" />

      {error && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--warning-amber)",
            color: "var(--warning-amber)",
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          {error}
        </div>
      )}

      {!error && clients.length === 0 && (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            border: "1px dashed var(--empty-border)",
            borderRadius: 10,
            background: "var(--empty-bg)",
            color: "var(--empty-text)",
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
          }}
        >
          No finance clients yet.
        </div>
      )}

      {clients.map((c) => (
        <ClientRow key={c.id} client={c} />
      ))}
    </div>
  );
}

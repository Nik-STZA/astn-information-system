// Finance client list. The landing page when Finance is selected.
//
// A client appears here only if it has a row in finance.client_finance_config,
// so the compliance module's clients do not leak in.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import { fetchFinanceClients, type FinanceClientSummary } from "@/modules/finance/lib/api";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

function Count({ n, label, urgent }: { n: number; label: string; urgent?: boolean }) {
  const colour = n === 0 ? "var(--sub)" : urgent ? "var(--alert-red)" : "var(--tx)";
  return (
    <div className={styles.count}>
      <div className={styles.countN} style={{ color: colour }}>{n}</div>
      <div className={styles.countLabel}>{label}</div>
    </div>
  );
}

function ClientRow({ client }: { client: FinanceClientSummary }) {
  return (
    <Link
      href={`/finance/clients/${client.slug}/open-items`}
      className={`${styles.card} ${styles.tile}`}
      style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}
    >
      <div style={{ minWidth: 0 }}>
        <div className={styles.tileTitle}>{client.name}</div>
        <div className={styles.small} style={{ marginTop: 2 }}>
          {[client.jurisdiction, client.framework, client.reporting_currency]
            .filter(Boolean)
            .join(" · ")}
          {client.close_cadence ? ` · ${client.close_cadence} close` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 20 }}>
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
    <div>
      <PageHeader title="Clients" sub="Every client, its companies and how each one connects to Xero." />

      {error && (
        <div className={styles.error} role="alert" style={{ marginBottom: 16 }}>
          <div className={styles.errorTitle}>Could not load clients</div>
          {error}
        </div>
      )}

      {!error && clients.length === 0 && (
        <div className={`${styles.card} ${styles.empty} ${styles.wide}`}>No finance clients yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 980 }}>
        {clients.map((c) => (
          <ClientRow key={c.id} client={c} />
        ))}
      </div>
    </div>
  );
}

// The client master: every client, prospect and former client, one record
// each, shared by every service (migration 029).

import PageHeader from "@/shared/ui/PageHeader";
import ClientMaster from "@/modules/finance/components/ClientMaster";
import { fetchMasterClients, type MasterClient } from "@/modules/finance/lib/clients";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ClientMasterPage() {
  let clients: MasterClient[] = [];
  let error: string | null = null;
  try {
    clients = await fetchMasterClients();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the clients";
  }

  return (
    <div>
      <PageHeader title="Clients" sub="Every client in one place: where they are with us, and which services they take." />
      {error ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the clients</div>
          {error}
        </div>
      ) : (
        <ClientMaster clients={clients} />
      )}
    </div>
  );
}

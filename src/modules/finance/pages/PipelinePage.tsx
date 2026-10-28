// The pipeline: the client master's prospects by stage (migration 029).

import PageHeader from "@/shared/ui/PageHeader";
import PipelineBoard from "@/modules/finance/components/PipelineBoard";
import { fetchMasterClients, type MasterClient } from "@/modules/finance/lib/clients";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  let clients: MasterClient[] = [];
  let error: string | null = null;
  try {
    clients = await fetchMasterClients();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the pipeline";
  }

  return (
    <div>
      <PageHeader title="Pipeline" sub="Prospects from first contact to agreed. Converting one makes it a client and opens its set-up." />
      {error ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the pipeline</div>
          {error}
        </div>
      ) : (
        <PipelineBoard clients={clients} />
      )}
    </div>
  );
}

// Where agent work is queued and read back.
//
// Every run is recorded whether or not it produces something to approve: a run
// that only answered a question still read client data.

import PageHeader from "@/shared/ui/PageHeader";
import AgentPanel from "@/modules/finance/components/AgentPanel";
import styles from "@/modules/finance/components/Agents.module.css";
import { fetchAgentRuns, type AgentRunRow } from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

export default async function AgentsPage({ params }: { params: { slug: string } }) {
  let runs: AgentRunRow[] = [];
  let error: string | null = null;

  try {
    runs = await fetchAgentRuns(params.slug);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load runs";
  }

  return (
    <div>
      <PageHeader title="Agents" sub="Ask an agent to look into something. Each conversation is kept, with its follow-ups." />

      {error ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : (
        <AgentPanel slug={params.slug} initialRuns={runs} />
      )}
    </div>
  );
}

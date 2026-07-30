// Where agent work is queued and read back.
//
// Every run is recorded whether or not it produces something to approve: a run
// that only answered a question still read client data.

import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import AgentPanel from "@/modules/finance/components/AgentPanel";
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
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Agents" />
      <ClientTabs slug={params.slug} active="agents" />

      {error ? (
        <div
          style={{
            padding: "12px 14px", borderRadius: 8, border: "1px solid var(--warning-amber)",
            color: "var(--warning-amber)", fontFamily: "Manrope, sans-serif", fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : (
        <AgentPanel slug={params.slug} initialRuns={runs} />
      )}
    </div>
  );
}

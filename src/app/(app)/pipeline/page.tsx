/**
 * BD Pipeline page.
 * Server component — fetches data then hands off to PipelineClient.
 */

import {
  fetchPipeline,
  fetchInteractions,
  fetchDashboardStats,
} from "@/lib/data/pipeline";
import PipelineClient from "./PipelineClient";

export default async function PipelinePage() {
  const [pipelineRes, interactionsRes, statsRes] = await Promise.all([
    fetchPipeline(),
    fetchInteractions(),
    fetchDashboardStats(),
  ]);

  const opportunities = pipelineRes.data?.data ?? [];
  const interactions = interactionsRes.data?.data ?? [];
  const stats = statsRes.data ?? null;

  return (
    <>
      <PipelineClient
        opportunities={opportunities}
        interactions={interactions}
        stats={stats}
      />
      {/* API errors */}
      {(pipelineRes.error || interactionsRes.error || statsRes.error) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4 mt-4">
          <strong>API error:</strong>{" "}
          {pipelineRes.error || interactionsRes.error || statsRes.error}
        </div>
      )}
    </>
  );
}

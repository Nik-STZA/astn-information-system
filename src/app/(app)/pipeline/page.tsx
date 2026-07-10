/**
 * Pipeline page — server component wrapper.
 * Fetches pipeline opportunities, interactions, and cross-module stats.
 */

import { fetchPipeline, fetchDashboardStats } from "@/lib/data/pipeline";
import PipelineClient from "./PipelineClient";

export default async function PipelinePage() {
  const [pipelineRes, statsRes] = await Promise.all([
    fetchPipeline(),
    fetchDashboardStats(),
  ]);

  const opportunities = pipelineRes.data?.data ?? [];
  const stats = statsRes.data ?? null;

  if (pipelineRes.error && statsRes.error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong> {pipelineRes.error || statsRes.error}
        </div>
      </div>
    );
  }

  return <PipelineClient opportunities={opportunities} stats={stats} />;
}

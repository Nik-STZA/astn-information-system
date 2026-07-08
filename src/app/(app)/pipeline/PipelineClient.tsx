"use client";

import { useState, useCallback } from "react";
import type { PipelineOpportunity, Interaction } from "@/lib/data/pipeline";
import { addOpportunity, editOpportunity, addInteraction } from "./actions";

const STAGE_COLOURS: Record<string, string> = {
  identified: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-800",
  proposal: "bg-amber-100 text-amber-800",
  negotiation: "bg-purple-100 text-purple-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-700",
};

const STAGES = ["identified", "qualified", "proposal", "negotiation", "won", "lost"];
const SERVICE_TYPES = [
  "POPIA Representative",
  "Compliance Assessment",
  "Data Protection Consulting",
  "Information Officer (Outsourced)",
  "Training & Awareness",
  "Other",
];

const btnPrimary =
  "px-4 py-2 bg-[#C5A059] text-white text-sm font-medium rounded-lg hover:bg-[#B08A3E] transition-colors";
const btnSecondary =
  "px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors text-gray-600";
const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C5A059]/30 focus:border-[#C5A059]";
const labelClass = "block text-xs font-medium text-gray-600 mb-1";

type Props = {
  opportunities: PipelineOpportunity[];
  interactions: Interaction[];
  stats: {
    pipeline: { total: number; total_value: number; active_value: number; won: number };
    prospects: { total: number; high_priority: number; identified: number; contacted: number; responded: number; converted: number };
    clients: { total: number; active: number; arr: number };
    content: { total: number; published: number; in_progress: number };
  } | null;
};

export default function PipelineClient({ opportunities, interactions, stats }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<PipelineOpportunity | null>(null);
  const [showInteraction, setShowInteraction] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const totalValue = opportunities.reduce((sum, o) => sum + (o.value_gbp ?? 0), 0);
  const byStage = opportunities.reduce((acc, o) => {
    acc[o.stage] = (acc[o.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleAddOpportunity = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    await addOpportunity(fd);
    setShowForm(false);
    setSubmitting(false);
  }, []);

  const handleStageChange = useCallback(async (opp: PipelineOpportunity, newStage: string) => {
    const fd = new FormData();
    fd.set("stage", newStage);
    await editOpportunity(opp.id, fd);
  }, []);

  const handleAddInteraction = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    await addInteraction(fd);
    setShowInteraction(false);
    setSubmitting(false);
  }, []);

  const oppInteractions = selected
    ? interactions.filter((i) => i.pipeline_id === selected.id)
    : [];

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1C1E]">Business development pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            Opportunities &middot; revenue tracking &middot; interactions
          </p>
        </div>
        <button onClick={() => { setShowForm(true); setSelected(null); }} className={btnPrimary}>
          + Add opportunity
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Pipeline opportunities" value={opportunities.length.toString()} />
          <StatCard label="Total value (GBP)" value={`£${totalValue.toLocaleString()}`} />
          <StatCard label="Active value (GBP)" value={`£${Number(stats.pipeline.active_value).toLocaleString()}`} />
          <StatCard label="Won" value={String(stats.pipeline.won)} />
        </div>
      )}

      {/* Stage funnel */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Stage breakdown</h2>
        <div className="flex flex-wrap gap-3">
          {STAGES.map((stage) => (
            <div key={stage} className="px-4 py-2 rounded-lg border border-gray-200 text-center min-w-[100px]">
              <div className="text-xl font-bold text-[#1A1C1E]">{byStage[stage] ?? 0}</div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLOURS[stage]}`}>
                {stage}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Opportunities table */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Opportunities</h2>
        {opportunities.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-gray-500 mb-3">No pipeline opportunities yet.</p>
            <button onClick={() => setShowForm(true)} className={btnPrimary}>
              Add your first opportunity
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1A1C1E] text-white">
                  <th className="px-3 py-2 text-left font-medium">Opportunity</th>
                  <th className="px-3 py-2 text-left font-medium">Prospect / client</th>
                  <th className="px-3 py-2 text-left font-medium">Service</th>
                  <th className="px-3 py-2 text-left font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">Value (GBP)</th>
                  <th className="px-3 py-2 text-left font-medium">Expected close</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o, i) => (
                  <tr
                    key={o.id}
                    onClick={() => { setSelected(o); setShowForm(false); }}
                    className={`cursor-pointer hover:bg-[#C5A059]/5 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50"} ${selected?.id === o.id ? "ring-2 ring-[#C5A059]/30" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium text-[#1A1C1E]">{o.opportunity_name}</td>
                    <td className="px-3 py-2 text-gray-600">{o.prospect_name || o.client_name || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{o.service_type ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLOURS[o.stage] ?? "bg-gray-100 text-gray-700"}`}>
                        {o.stage}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {o.value_gbp != null ? `£${o.value_gbp.toLocaleString()}` : "—"}
                      {o.value_recurring && <span className="text-xs text-[#C5A059] ml-1">/yr</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {o.expected_close_date ? new Date(o.expected_close_date).toLocaleDateString("en-GB") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── ADD OPPORTUNITY FORM ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1A1C1E]">Add opportunity</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleAddOpportunity} className="p-6 space-y-4">
              <div>
                <label className={labelClass}>Opportunity name *</label>
                <input name="opportunity_name" required className={inputClass} placeholder="e.g. Catapult Sports — POPIA Representative" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Prospect / company</label>
                  <input name="prospect_name" className={inputClass} placeholder="Company name" />
                </div>
                <div>
                  <label className={labelClass}>Service type</label>
                  <select name="service_type" className={inputClass}>
                    <option value="">Select...</option>
                    {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Stage</label>
                  <select name="stage" className={inputClass} defaultValue="identified">
                    {STAGES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Value (GBP)</label>
                  <input name="value_gbp" type="number" className={inputClass} placeholder="e.g. 2500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Expected close date</label>
                  <input name="expected_close_date" type="date" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Recurring?</label>
                  <select name="value_recurring" className={inputClass}>
                    <option value="true">Yes — annual</option>
                    <option value="false">No — one-off</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Owner</label>
                <input name="owner" className={inputClass} defaultValue="Nik" />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea name="notes" className={inputClass} rows={3} placeholder="Context, next steps..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={submitting} className={btnPrimary}>
                  {submitting ? "Saving..." : "Save opportunity"}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── OPPORTUNITY DETAIL PANEL ── */}
      {selected && !showForm && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1A1C1E]">{selected.opportunity_name}</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-6 space-y-6">
              {/* Key info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-gray-400">Prospect / Client</span>
                  <p className="text-sm font-medium text-[#1A1C1E]">{selected.prospect_name || selected.client_name || "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Service</span>
                  <p className="text-sm font-medium text-[#1A1C1E]">{selected.service_type ?? "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Value</span>
                  <p className="text-sm font-medium text-[#1A1C1E]">
                    {selected.value_gbp != null ? `£${selected.value_gbp.toLocaleString()}` : "—"}
                    {selected.value_recurring && <span className="text-[#C5A059] ml-1">/yr</span>}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Expected close</span>
                  <p className="text-sm font-medium text-[#1A1C1E]">
                    {selected.expected_close_date ? new Date(selected.expected_close_date).toLocaleDateString("en-GB") : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Owner</span>
                  <p className="text-sm font-medium text-[#1A1C1E]">{selected.owner ?? "—"}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Created</span>
                  <p className="text-sm text-gray-500">{new Date(selected.created_at).toLocaleDateString("en-GB")}</p>
                </div>
              </div>

              {selected.notes && (
                <div>
                  <span className="text-xs text-gray-400">Notes</span>
                  <p className="text-sm text-gray-600 mt-1">{selected.notes}</p>
                </div>
              )}

              {/* Stage progression */}
              <div>
                <span className="text-xs text-gray-400 block mb-2">Stage</span>
                <div className="flex gap-1">
                  {STAGES.map((stage) => (
                    <button
                      key={stage}
                      onClick={() => handleStageChange(selected, stage)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                        selected.stage === stage
                          ? "bg-[#C5A059] text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {stage.charAt(0).toUpperCase() + stage.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Interactions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-400">Interactions ({oppInteractions.length})</span>
                  <button onClick={() => setShowInteraction(true)} className="text-xs text-[#C5A059] hover:underline">
                    + Add interaction
                  </button>
                </div>
                {oppInteractions.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No interactions logged yet.</p>
                ) : (
                  <div className="space-y-3">
                    {oppInteractions.map((i) => (
                      <div key={i.id} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-[#1A1C1E]">
                            {i.channel ?? "—"} · {i.direction}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(i.interaction_date).toLocaleDateString("en-GB")}
                          </span>
                        </div>
                        {i.summary && <p className="text-xs text-gray-600">{i.summary}</p>}
                        {i.next_action && (
                          <p className="text-xs text-[#C5A059] mt-1">
                            Next: {i.next_action}
                            {i.next_action_date && ` (${new Date(i.next_action_date).toLocaleDateString("en-GB")})`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add interaction form */}
              {showInteraction && (
                <form onSubmit={handleAddInteraction} className="border border-[#C5A059]/30 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[#1A1C1E]">Log interaction</h3>
                  <input type="hidden" name="pipeline_id" value={selected.id} />
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Date</label>
                      <input name="interaction_date" type="date" className={inputClass} defaultValue={new Date().toISOString().split("T")[0]} />
                    </div>
                    <div>
                      <label className={labelClass}>Channel</label>
                      <select name="channel" className={inputClass}>
                        <option value="email">Email</option>
                        <option value="call">Call</option>
                        <option value="meeting">Meeting</option>
                        <option value="linkedin">LinkedIn</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Direction</label>
                      <select name="direction" className={inputClass}>
                        <option value="outbound">Outbound</option>
                        <option value="inbound">Inbound</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Summary</label>
                    <textarea name="summary" className={inputClass} rows={2} placeholder="What happened?" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Next action</label>
                      <input name="next_action" className={inputClass} placeholder="Follow up with proposal" />
                    </div>
                    <div>
                      <label className={labelClass}>Next action date</label>
                      <input name="next_action_date" type="date" className={inputClass} />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" disabled={submitting} className={btnPrimary}>
                      {submitting ? "Saving..." : "Log interaction"}
                    </button>
                    <button type="button" onClick={() => setShowInteraction(false)} className={btnSecondary}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cross-module summary */}
      {stats && (
        <section>
          <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Cross-module summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <SummaryCard
              title="Compliance prospects"
              items={[
                { label: "Total", value: stats.prospects.total },
                { label: "High priority", value: stats.prospects.high_priority },
                { label: "Contacted", value: stats.prospects.contacted },
              ]}
            />
            <SummaryCard
              title="Clients"
              items={[
                { label: "Total", value: stats.clients.total },
                { label: "Active", value: stats.clients.active },
                { label: "ARR", value: `£${Number(stats.clients.arr).toLocaleString()}` },
              ]}
            />
            <SummaryCard
              title="Content"
              items={[
                { label: "Editions", value: stats.content.total },
                { label: "Published", value: stats.content.published },
                { label: "In progress", value: stats.content.in_progress },
              ]}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function SummaryCard({ title, items }: { title: string; items: Array<{ label: string; value: number | string }> }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-[#1A1C1E] text-sm mb-2">{title}</h3>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between text-xs">
            <span className="text-gray-500">{item.label}</span>
            <span className="font-medium text-[#1A1C1E]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

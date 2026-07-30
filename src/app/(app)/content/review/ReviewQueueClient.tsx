"use client";

import { useState, useTransition } from "react";
import type {
  ClassifiedItem,
  ItemStats,
  IngestionRun,
} from "@/lib/data/content-pipeline";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialItems: ClassifiedItem[];
  totalItems: number;
  stats: ItemStats | null;
  recentRuns: IngestionRun[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryLabel(cat: string | null) {
  if (!cat) return "—";
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLOURS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  published: "bg-blue-100 text-blue-800",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReviewQueueClient({
  initialItems,
  totalItems,
  stats,
  recentRuns,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(totalItems);
  const [filter, setFilter] = useState<string>("pending");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [ingesting, setIngesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // ── Fetch items with filter ──
  async function loadItems(status: string) {
    setFilter(status);
    setSelected(new Set());
    try {
      const res = await fetch(
        `/api/proxy/content/items?status=${status}&limit=50&sort=relevance`
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.data ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      // keep existing items on error
    }
  }

  // ── Update single item ──
  async function updateItem(id: number, status: string) {
    try {
      const res = await fetch(`/api/proxy/content/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        setTotal((t) => Math.max(0, t - 1));
        setMessage(`Item ${status}`);
        setTimeout(() => setMessage(null), 2000);
      }
    } catch {
      setMessage("Failed to update");
    }
  }

  // ── Bulk update ──
  async function bulkUpdate(status: string) {
    if (selected.size === 0) return;
    try {
      const res = await fetch("/api/proxy/content/items/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), status }),
      });
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => prev.filter((i) => !selected.has(i.id)));
        setTotal((t) => Math.max(0, t - selected.size));
        setSelected(new Set());
        setMessage(`${data.updated} items ${status}`);
        setTimeout(() => setMessage(null), 2000);
      }
    } catch {
      setMessage("Bulk update failed");
    }
  }

  // ── Trigger ingestion ──
  async function triggerIngest() {
    setIngesting(true);
    try {
      const res = await fetch("/api/proxy/content/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger_type: "manual" }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessage(`Ingestion started (run #${data.run_id}). Refresh in a minute to see new items.`);
        setTimeout(() => setMessage(null), 10000);
      }
    } catch {
      setMessage("Failed to trigger ingestion");
    } finally {
      setIngesting(false);
    }
  }

  // ── Toggle selection ──
  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">
            Review queue
          </h1>
          <p className="text-sm text-warm-grey mt-1">
            Content pipeline — approve or reject items for the AfricanSTN weekly brief
          </p>
        </div>
        <button
          onClick={triggerIngest}
          disabled={ingesting}
          className="px-4 py-2 bg-brand-gold text-white text-sm font-medium rounded-lg hover:bg-brand-gold/90 disabled:opacity-50 transition-colors"
        >
          {ingesting ? "Fetching…" : "Fetch new content"}
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { label: "Pending", value: stats.pending, colour: "text-amber-600" },
            { label: "This week", value: stats.this_week, colour: "text-brand-dark" },
            { label: "Approved", value: stats.approved, colour: "text-green-600" },
            { label: "Rejected", value: stats.rejected, colour: "text-red-600" },
            { label: "Published", value: stats.published, colour: "text-blue-600" },
            { label: "Total", value: stats.total, colour: "text-warm-grey" },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white border border-gold-border rounded-lg p-3 text-center"
            >
              <div className={`text-2xl font-semibold ${s.colour}`}>
                {s.value.toLocaleString("en-GB")}
              </div>
              <div className="text-xs text-warm-grey mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {message && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">
          {message}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-4 border-b border-gold-border pb-2">
        {["pending", "approved", "rejected", "published"].map((s) => (
          <button
            key={s}
            onClick={() =>
              startTransition(() => {
                loadItems(s);
              })
            }
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              filter === s
                ? "border-brand-gold text-brand-gold"
                : "border-transparent text-warm-grey hover:text-brand-dark"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && filter === "pending" && (
            <>
              <button
                onClick={() => bulkUpdate("approved")}
                className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
              >
                Approve {selected.size}
              </button>
              <button
                onClick={() => bulkUpdate("rejected")}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
              >
                Reject {selected.size}
              </button>
            </>
          )}
          <span className="text-xs text-warm-grey">
            {total.toLocaleString("en-GB")} items
          </span>
        </div>
      </div>

      {/* Items list */}
      {isPending ? (
        <div className="text-center py-12 text-warm-grey">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-warm-grey">
          No {filter} items.{" "}
          {filter === "pending" && (
            <button
              onClick={triggerIngest}
              className="text-brand-gold underline"
            >
              Fetch new content
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select all */}
          {filter === "pending" && (
            <label className="flex items-center gap-2 text-xs text-warm-grey pb-1">
              <input
                type="checkbox"
                checked={selected.size === items.length && items.length > 0}
                onChange={selectAll}
                className="rounded border-gold-border"
              />
              Select all ({items.length})
            </label>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-gold-border rounded-lg p-4 hover:border-brand-gold/50 transition-colors"
            >
              <div className="flex items-start gap-3">
                {filter === "pending" && (
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="mt-1 rounded border-gold-border"
                  />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        STATUS_COLOURS[item.status] || "bg-gray-100"
                      }`}
                    >
                      {item.status}
                    </span>
                    <span className="text-[10px] text-warm-grey">
                      {categoryLabel(item.category)}
                    </span>
                    {item.region && (
                      <span className="text-[10px] text-warm-grey">
                        · {item.region}
                      </span>
                    )}
                    <span className="text-[10px] text-warm-grey ml-auto">
                      {formatDate(item.published_at || item.created_at)}
                    </span>
                  </div>

                  <h3 className="text-sm font-medium text-brand-dark leading-snug">
                    {item.source_url ? (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-brand-gold"
                      >
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h3>

                  {item.summary && (
                    <p className="text-xs text-warm-grey mt-1 line-clamp-2">
                      {item.summary}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-warm-grey">
                      {item.source_name}
                    </span>
                    {item.relevance_score > 0 && (
                      <span className="text-[10px] text-warm-grey">
                        Score: {item.relevance_score}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                {filter === "pending" && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => updateItem(item.id, "approved")}
                      className="px-2 py-1 text-[10px] bg-green-50 text-green-700 rounded hover:bg-green-100 border border-green-200"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateItem(item.id, "rejected")}
                      className="px-2 py-1 text-[10px] bg-red-50 text-red-700 rounded hover:bg-red-100 border border-red-200"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-brand-dark mb-3">
            Recent ingestion runs
          </h2>
          <div className="bg-white border border-gold-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-warm-light text-warm-grey">
                  <th className="text-left p-2 font-medium">Run</th>
                  <th className="text-left p-2 font-medium">Started</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-right p-2 font-medium">Sources</th>
                  <th className="text-right p-2 font-medium">Fetched</th>
                  <th className="text-right p-2 font-medium">New</th>
                  <th className="text-right p-2 font-medium">Skipped</th>
                  <th className="text-right p-2 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-gold-border">
                    <td className="p-2 text-brand-dark">#{run.id}</td>
                    <td className="p-2 text-warm-grey">
                      {formatDate(run.started_at)} {formatTime(run.started_at)}
                    </td>
                    <td className="p-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          run.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : run.status === "running"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="p-2 text-right">{run.sources_checked}</td>
                    <td className="p-2 text-right">{run.items_fetched}</td>
                    <td className="p-2 text-right text-green-600 font-medium">
                      {run.items_new}
                    </td>
                    <td className="p-2 text-right text-warm-grey">
                      {run.items_skipped}
                    </td>
                    <td className="p-2 text-right text-red-600">
                      {Array.isArray(run.errors) ? run.errors.length : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ReviewItem } from "@/lib/data/content";
import { loadReviewQueue, submitReview } from "./actions";

const CATEGORY_LABELS: Record<string, string> = {
  company: "New company",
  funding: "Funding",
  partnership: "Partnership",
  regulatory: "Regulatory",
  event: "Event",
  m_and_a: "M&A",
  launch: "Launch",
  data: "Market data",
};

function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 600,
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        background: bg,
        color,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function ItemCard({
  item,
  onDone,
}: {
  item: ReviewItem;
  onDone: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const [summary, setSummary] = useState(item.summary ?? "");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    const payload: Parameters<typeof submitReview>[1] = { action };
    if (editing) {
      if (title.trim() && title.trim() !== (item.title ?? "")) payload.edited_title = title.trim();
      if (summary.trim() && summary.trim() !== (item.summary ?? "")) payload.edited_summary = summary.trim();
    }
    const res = await submitReview(item.id, payload);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone(item.id);
  }

  return (
    <div
      style={{
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 10,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {item.category && (
            <Pill
              text={CATEGORY_LABELS[item.category] ?? item.category}
              color="var(--gold-dark)"
              bg="rgba(197,160,89,.12)"
            />
          )}
          {item.region && <Pill text={item.region} color="var(--sub)" bg="var(--table-header)" />}
          {item.relevance_score != null && (
            <Pill
              text={`Score ${Number(item.relevance_score).toFixed(1)}`}
              color={Number(item.relevance_score) >= 7 ? "var(--success-green)" : "var(--sub)"}
              bg="var(--table-header)"
            />
          )}
        </div>
        <span style={{ fontSize: 11.5, color: "var(--sub)" }}>
          {item.source_name ?? "Unknown source"} ·{" "}
          {new Date(item.created_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
        </span>
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--bd)",
              background: "var(--pg)",
              color: "var(--tx)",
            }}
          />
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            style={{
              fontSize: 12.5,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--bd)",
              background: "var(--pg)",
              color: "var(--tx)",
              resize: "vertical",
            }}
          />
        </div>
      ) : (
        <div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13.5, fontWeight: 700, color: "var(--tx)", textDecoration: "none" }}
          >
            {item.title ?? "Untitled"} ↗
          </a>
          {item.summary && (
            <p style={{ fontSize: 12.5, color: "var(--label-text)", margin: "6px 0 0", lineHeight: 1.5 }}>
              {item.summary}
            </p>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "var(--alert-red)" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => act("approve")}
          disabled={busy !== null}
          style={{
            fontWeight: 700,
            fontSize: 12,
            padding: "7px 16px",
            borderRadius: 6,
            border: "none",
            background: "var(--success-green)",
            color: "#fff",
            cursor: "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => act("reject")}
          disabled={busy !== null}
          style={{
            fontWeight: 600,
            fontSize: 12,
            padding: "7px 16px",
            borderRadius: 6,
            border: "1px solid var(--bd)",
            background: "transparent",
            color: "var(--risk-red)",
            cursor: "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
        <button
          onClick={() => setEditing((e) => !e)}
          disabled={busy !== null}
          style={{
            fontWeight: 600,
            fontSize: 12,
            padding: "7px 12px",
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--gold-dark)",
            cursor: "pointer",
          }}
        >
          {editing ? "Cancel edit" : "Edit"}
        </button>
      </div>
    </div>
  );
}

export default function ReviewClient({
  initialItems,
  initialTotal,
}: {
  initialItems: ReviewItem[];
  initialTotal: number;
}) {
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [loadingMore, setLoadingMore] = useState(false);

  function handleDone(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }

  async function loadMore() {
    setLoadingMore(true);
    const res = await loadReviewQueue("pending_review", 25, items.length);
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...(res.data?.data ?? []).filter((i) => !seen.has(i.id))];
    });
    if (res.data) setTotal(res.data.count);
    setLoadingMore(false);
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: "48px 20px",
          textAlign: "center",
          border: "1.5px dashed var(--empty-border)",
          borderRadius: 12,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--sub)", marginBottom: 4 }}>
          Queue clear
        </div>
        <div style={{ fontWeight: 500, fontSize: 12.5, color: "var(--empty-text)" }}>
          No items awaiting review. New items arrive with the Thursday fetch.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onDone={handleDone} />
      ))}
      {items.length < total && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          style={{
            alignSelf: "center",
            fontWeight: 600,
            fontSize: 12.5,
            padding: "9px 22px",
            borderRadius: 8,
            border: "1px solid var(--bd)",
            background: "var(--pnl)",
            color: "var(--tx)",
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          {loadingMore ? "Loading…" : `Load more (${(total - items.length).toLocaleString("en-GB")} remaining)`}
        </button>
      )}
    </div>
  );
}

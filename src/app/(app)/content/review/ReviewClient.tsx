"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { ReviewItem, ReviewItemDetail } from "@/lib/data/content";
import { loadReviewQueue, loadItemDetail, submitReview, triggerWorkflow, workflowStatus, runIngest } from "./actions";

// "Generate weekly brief" — dispatches the agent's generate-report workflow
// and polls its status so GitHub stays invisible.
function GenerateBriefButton() {
  const [state, setState] = useState<"idle" | "dispatching" | "running" | "done" | "failed" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function poll() {
    const res = await workflowStatus("generate-report");
    if (res.error || !res.data) return;
    if (res.data.status === "completed") {
      if (pollRef.current) clearInterval(pollRef.current);
      setState(res.data.conclusion === "success" ? "done" : "failed");
      setMessage(res.data.conclusion === "success"
        ? "Brief generated — check Notion / Beehiiv."
        : "Generation failed — see the run in GitHub.");
    }
  }

  async function run() {
    setState("dispatching");
    setMessage(null);
    const res = await triggerWorkflow("generate-report");
    if (res.error) {
      setState("error");
      setMessage(res.error.includes("not configured")
        ? "Not connected yet — GitHub dispatch token pending."
        : res.error);
      return;
    }
    setState("running");
    setMessage("Generating the weekly brief from your approvals…");
    // First status read can lag the dispatch; poll gently.
    pollRef.current = setInterval(poll, 15000);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {message && (
        <span style={{ fontSize: 11.5, color: state === "failed" || state === "error" ? "var(--alert-red)" : "var(--sub)" }}>
          {message}
        </span>
      )}
      <button
        onClick={run}
        disabled={state === "dispatching" || state === "running"}
        style={{
          fontWeight: 700,
          fontSize: 12,
          padding: "8px 18px",
          borderRadius: 6,
          border: "none",
          background: "#C5A059",
          color: "#141414",
          cursor: "pointer",
          opacity: state === "dispatching" || state === "running" ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {state === "dispatching" ? "Starting…" : state === "running" ? "Generating…" : "Generate weekly brief"}
      </button>
    </div>
  );
}

// "Fetch sources" — triggers the RSS ingestion pipeline and shows results.
function FetchSourcesButton({ onComplete }: { onComplete: () => void }) {
  const [state, setState] = useState<"idle" | "fetching" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("fetching");
    setMessage("Fetching RSS sources — this may take a few minutes…");
    const res = await runIngest();
    if (res.error) {
      setState("error");
      setMessage(res.error);
      return;
    }
    if (res.data) {
      setState("done");
      setMessage(
        `Done — ${res.data.items_new.toLocaleString("en-GB")} new items from ${res.data.sources_checked.toLocaleString("en-GB")} sources (${res.data.items_skipped.toLocaleString("en-GB")} duplicates skipped).`
      );
      onComplete();
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {message && (
        <span style={{ fontSize: 11.5, color: state === "error" ? "var(--alert-red)" : "var(--sub)" }}>
          {message}
        </span>
      )}
      <button
        onClick={run}
        disabled={state === "fetching"}
        style={{
          fontWeight: 700,
          fontSize: 12,
          padding: "8px 18px",
          borderRadius: 6,
          border: "1px solid var(--bd)",
          background: "var(--pnl)",
          color: "var(--tx)",
          cursor: "pointer",
          opacity: state === "fetching" ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {state === "fetching" ? "Fetching…" : "Fetch sources"}
      </button>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  company: "Company",
  funding: "Funding",
  partnership: "Partnership",
  regulatory: "Regulatory",
  event: "Event",
  m_and_a: "M&A",
  launch: "Launch",
  data: "Market data",
};

function scoreColor(score: number | null): string {
  if (score == null) return "var(--sub)";
  if (score >= 0.7) return "var(--success-green)";
  if (score >= 0.4) return "var(--gold-dark)";
  return "var(--sub)";
}

// Expanded row: article substance + classifier reasoning + edit-and-decide.
function DetailPanel({
  item,
  onDone,
}: {
  item: ReviewItem;
  onDone: (id: string) => void;
}) {
  const [detail, setDetail] = useState<ReviewItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(item.title ?? "");
  const [summary, setSummary] = useState(item.summary ?? "");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load full detail once on mount
  useEffect(() => {
    let cancelled = false;
    loadItemDetail(item.id).then((res) => {
      if (cancelled) return;
      setDetail(res.data ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    const payload: Parameters<typeof submitReview>[1] = { action };
    if (title.trim() && title.trim() !== (item.title ?? "")) payload.edited_title = title.trim();
    if (summary.trim() && summary.trim() !== (item.summary ?? "")) payload.edited_summary = summary.trim();
    const res = await submitReview(item.id, payload);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone(item.id);
  }

  // The original article text, in whatever language it was published in.
  // translated_text is deliberately NOT part of this fallback chain: an English
  // translation is a companion to the source text, not a substitute for it, and
  // folding it in here meant it only ever surfaced when the original was missing.
  const articleText = detail?.content || detail?.snippet || null;

  const originalLanguage = (detail?.original_language || item.original_language || "").toLowerCase();
  const isForeignLanguage = originalLanguage !== "" && !originalLanguage.startsWith("en");
  const translatedText = detail?.translated_text || null;

  return (
    <div
      style={{
        padding: "14px 18px 18px",
        background: "var(--table-header)",
        borderTop: "1px solid var(--bd)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: editable brief copy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
            Brief copy (editable)
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ fontSize: 13, fontWeight: 700, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)" }}
          />
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            style={{ fontSize: 12.5, lineHeight: 1.5, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", resize: "vertical" }}
          />
          {detail?.gemini_reasoning && (
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
                Classifier reasoning
              </span>
              <p style={{ fontSize: 12, color: "var(--label-text)", margin: "4px 0 0", lineHeight: 1.5 }}>
                {detail.gemini_reasoning}
              </p>
            </div>
          )}
        </div>

        {/* Right: the article itself */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
              {isForeignLanguage ? `Article (${originalLanguage})` : "Article"}
            </span>
            <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--gold-dark)", textDecoration: "none" }}>
              Open original ↗
            </a>
          </div>
          <div
            style={{
              maxHeight: 260,
              overflowY: "auto",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--label-text)",
              background: "var(--pnl)",
              border: "1px solid var(--bd)",
              borderRadius: 6,
              padding: "10px 12px",
              whiteSpace: "pre-wrap",
            }}
          >
            {loading ? "Loading article…" : articleText ?? "No stored article text — use Open original."}
          </div>

          {/* English translation, shown alongside the source text rather than
              replacing it, so the reviewer can always check the wording back
              against the original. */}
          {isForeignLanguage && !loading && (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub)" }}>
                English translation
              </span>
              <div
                style={{
                  maxHeight: 260,
                  overflowY: "auto",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: translatedText ? "var(--label-text)" : "var(--sub)",
                  fontStyle: translatedText ? "normal" : "italic",
                  background: "var(--pnl)",
                  border: "1px solid var(--bd)",
                  borderRadius: 6,
                  padding: "10px 12px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {translatedText ?? "Not translated yet — review against the original."}
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--alert-red)" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => act("approve")}
          disabled={busy !== null}
          style={{ fontWeight: 700, fontSize: 12, padding: "7px 18px", borderRadius: 6, border: "none", background: "var(--success-green)", color: "#fff", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => act("reject")}
          disabled={busy !== null}
          style={{ fontWeight: 600, fontSize: 12, padding: "7px 18px", borderRadius: 6, border: "1px solid var(--bd)", background: "transparent", color: "var(--risk-red)", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // "candidates" replicates the old Notion view (last 7 days, score >= 0.4,
  // best first); "all" is the raw pending table.
  const [view, setView] = useState<"candidates" | "all">("candidates");
  const viewParams = (v: "candidates" | "all") =>
    v === "candidates"
      ? { minScore: 0.4, days: 7, sort: "relevance" as const }
      : { minScore: 0, days: 0, sort: "newest" as const };

  function handleDone(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    setExpandedId((e) => (e === id ? null : e));
  }

  // One-click decision straight from the row — no expansion needed.
  async function quickAct(id: string, action: "approve" | "reject") {
    setBusyId(id);
    const res = await submitReview(id, { action });
    setBusyId(null);
    if (!res.error) handleDone(id);
  }

  async function switchView(next: "candidates" | "all") {
    setView(next);
    setLoadingMore(true);
    setExpandedId(null);
    const p = viewParams(next);
    const res = await loadReviewQueue("pending_review", 50, 0, p.minScore, p.days, p.sort);
    setItems(res.data?.data ?? []);
    setTotal(res.data?.count ?? 0);
    setLoadingMore(false);
  }

  async function loadMore() {
    setLoadingMore(true);
    const p = viewParams(view);
    const res = await loadReviewQueue("pending_review", 50, items.length, p.minScore, p.days, p.sort);
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...(res.data?.data ?? []).filter((i) => !seen.has(i.id))];
    });
    if (res.data) setTotal(res.data.count);
    setLoadingMore(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          {view === "candidates"
            ? `This week's brief candidates (last 7 days, relevance ≥ 0.4, best first) — ${total.toLocaleString("en-GB")} items`
            : `All pending items, newest first — ${total.toLocaleString("en-GB")} items`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => switchView(view === "candidates" ? "all" : "candidates")}
            disabled={loadingMore}
            style={{ fontWeight: 600, fontSize: 11.5, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--bd)", background: "transparent", color: "var(--gold-dark)", cursor: "pointer" }}
          >
            {view === "candidates" ? "Show all pending" : "Show brief candidates"}
          </button>
          <FetchSourcesButton onComplete={() => switchView(view)} />
          <GenerateBriefButton />
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center", border: "1.5px dashed var(--empty-border)", borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--sub)", marginBottom: 4 }}>Queue clear</div>
          <div style={{ fontWeight: 500, fontSize: 12.5, color: "var(--empty-text)" }}>
            No items in this view. New items arrive with the Thursday fetch.
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--table-header)", borderBottom: "1.5px solid var(--bd)" }}>
                {["Score", "Category", "Title", "Source", ""].map((h) => (
                  <th
                    key={h || "actions"}
                    style={{
                      textAlign: h === "" ? "right" : "left",
                      fontWeight: 700,
                      fontSize: 10.5,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--sub)",
                      padding: "11px 14px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <Fragment key={item.id}>
                  <tr
                    onClick={() => setExpandedId((e) => (e === item.id ? null : item.id))}
                    style={{
                      background: expandedId === item.id ? "var(--table-header)" : idx % 2 ? "var(--table-header)" : "transparent",
                      borderBottom: expandedId === item.id ? "none" : "1px solid var(--bd)",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "9px 14px", fontWeight: 800, fontSize: 12.5, color: scoreColor(item.relevance_score), fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {item.relevance_score != null ? Number(item.relevance_score).toFixed(1) : "—"}
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 11.5, fontWeight: 600, color: "var(--gold-dark)", whiteSpace: "nowrap" }}>
                      {item.category ? CATEGORY_LABELS[item.category] ?? item.category : "—"}
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "var(--tx)", lineHeight: 1.35 }}>
                      {item.title ?? "Untitled"}
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 11.5, color: "var(--sub)", whiteSpace: "nowrap" }}>
                      {item.source_name ?? "—"} ·{" "}
                      {new Date(item.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); quickAct(item.id, "approve"); }}
                        disabled={busyId === item.id}
                        title="Approve"
                        style={{ fontWeight: 800, fontSize: 13, width: 30, height: 26, borderRadius: 6, border: "none", background: "rgba(46,125,50,.14)", color: "var(--success-green)", cursor: "pointer", marginRight: 6, opacity: busyId === item.id ? 0.5 : 1 }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); quickAct(item.id, "reject"); }}
                        disabled={busyId === item.id}
                        title="Reject"
                        style={{ fontWeight: 800, fontSize: 13, width: 30, height: 26, borderRadius: 6, border: "none", background: "rgba(204,0,0,.10)", color: "var(--risk-red)", cursor: "pointer", opacity: busyId === item.id ? 0.5 : 1 }}
                      >
                        ✗
                      </button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <DetailPanel item={item} onDone={handleDone} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && items.length < total && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          style={{ alignSelf: "center", fontWeight: 600, fontSize: 12.5, padding: "9px 22px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", cursor: "pointer", marginTop: 4 }}
        >
          {loadingMore ? "Loading…" : `Load more (${(total - items.length).toLocaleString("en-GB")} remaining)`}
        </button>
      )}
    </div>
  );
}

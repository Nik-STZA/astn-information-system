/**
 * Edition detail page — reskinned to match design system.
 * Server component — fetches edition data directly.
 */

import { fetchEditions } from "@/lib/data/content";
import Link from "next/link";
import { notFound } from "next/navigation";

/* ── Status pill colours (matches ContentClient) ──────────────────────── */
const STATUS_META: Record<string, { bg: string; text: string; border: string }> = {
  planned:     { bg: "#F0ECE3", text: "#8E9196", border: "#D9CDB4" },
  researching: { bg: "#EBF0F5", text: "#3E6B8E", border: "#C4D4E4" },
  drafting:    { bg: "#FBF1DE", text: "#A67514", border: "#E6D5A3" },
  draft:       { bg: "#FBF1DE", text: "#A67514", border: "#E6D5A3" },
  drafted:     { bg: "#FBF1DE", text: "#A67514", border: "#E6D5A3" },
  review:      { bg: "#F0E8F5", text: "#8156A6", border: "#D4C4E4" },
  scheduled:   { bg: "#EBF0F5", text: "#3E6B8E", border: "#C4D4E4" },
  published:   { bg: "#E8F5E9", text: "#2E7D32", border: "#C7E1D1" },
  archived:    { bg: "#F0ECE3", text: "#8E9196", border: "#D9CDB4" },
};

/* ── Country → flag lookup ─────────────────────────────────────────────── */
const COUNTRY_ISO: Record<string, string> = {
  "South Africa": "za", "Kenya": "ke", "Nigeria": "ng", "Egypt": "eg",
  "Ghana": "gh", "Tanzania": "tz", "Ethiopia": "et", "Rwanda": "rw",
  "Uganda": "ug", "Senegal": "sn", "Morocco": "ma", "Cameroon": "cm",
};

function formatDate(d: string): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(d: string): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditionDetailPage({ params }: Props) {
  const { id } = await params;
  const editionsRes = await fetchEditions();
  const editions = editionsRes.data?.data ?? [];
  const edition = editions.find((e) => String(e.id) === id);

  if (!edition) return notFound();

  const sm = STATUS_META[edition.status] ?? STATUS_META.planned;
  const iso = edition.country_name ? COUNTRY_ISO[edition.country_name] : null;

  return (
    <div style={{ fontFamily: "'Manrope', sans-serif" }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12.5, fontWeight: 500, color: "#A29C8E", marginBottom: 8 }}>
        <Link href="/content" style={{ color: "#B08D3F", textDecoration: "none" }}>Content engine</Link>
        <span style={{ margin: "0 6px", opacity: 0.5 }}>&middot;</span>
        <span>Edition #{edition.edition_number}</span>
      </div>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 800, color: "var(--tx)", margin: "0 0 4px" }}>{edition.title}</h1>
          {edition.subtitle && (
            <p style={{ fontSize: 14, fontWeight: 400, color: "#A29C8E", margin: 0 }}>{edition.subtitle}</p>
          )}
        </div>
        <span style={{
          flexShrink: 0,
          fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 11, lineHeight: "1",
          textTransform: "uppercase", letterSpacing: ".04em",
          color: sm.text, background: sm.bg, border: `1px solid ${sm.border}`,
          borderRadius: 6, padding: "7px 12px", whiteSpace: "nowrap",
        }}>
          {edition.status}
        </span>
      </div>

      {/* Meta cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        <MetaCard label="Series" value={edition.series} />
        <MetaCard label="Country" value={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {iso && <span style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", display: "inline-flex", flexShrink: 0, border: "1px solid #E4D9C4" }}><img src={`https://flagcdn.com/w40/${iso}.png`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span>}
            {edition.country_name ?? "—"}
          </span>
        } />
        <MetaCard label="Word count" value={edition.word_count?.toLocaleString("en-GB") ?? "—"} />
        <MetaCard label="Target publish" value={edition.target_publish_date ? formatDate(edition.target_publish_date) : "—"} />
      </div>

      {/* Content area */}
      <div style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: "22px 24px", marginBottom: 24, background: "var(--pnl)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", margin: "0 0 14px" }}>Edition content</h2>
        {edition.file_path ? (
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: "#A29C8E" }}>Content file: <span style={{ color: "var(--tx)" }}>{edition.file_path}</span></p>
            <p style={{ fontSize: 12, color: "#B9B2A2", marginTop: 8 }}>
              Content rendering from file storage will be available once the content pipeline is connected.
            </p>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "36px 0", border: "1px dashed #D9CDB4", borderRadius: 10, background: "#F7F2E9" }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: "#B9B2A2", margin: "0 0 4px" }}>No content file attached to this edition yet</p>
            <p style={{ fontSize: 11.5, color: "#C8C1B3", margin: 0 }}>Content will appear here once drafted by the Content Agent or uploaded manually.</p>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: "22px 24px", marginBottom: 24, background: "var(--pnl)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", margin: "0 0 14px" }}>Timeline</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <TimelineItem label="Created" date={formatDateTime(edition.created_at)} active />
          <TimelineItem label="Last updated" date={formatDateTime(edition.updated_at)} active />
          {edition.target_publish_date && (
            <TimelineItem label="Target publish" date={formatDate(edition.target_publish_date)} active={!!edition.actual_publish_date} />
          )}
          {edition.actual_publish_date && (
            <TimelineItem label="Published" date={formatDate(edition.actual_publish_date)} active />
          )}
        </div>
      </div>

      {/* Back link */}
      <Link href="/content" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "#C5A059", textDecoration: "none" }}>
        &larr; Back to all editions
      </Link>
    </div>
  );
}

/* ── MetaCard ─────────────────────────────────────────────────────────── */
function MetaCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 10, border: "1px solid var(--bd)", background: "var(--pnl)", padding: "14px 16px" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)", marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "#A29C8E" }}>{label}</div>
    </div>
  );
}

/* ── TimelineItem ─────────────────────────────────────────────────────── */
function TimelineItem({ label, date, active }: { label: string; date: string; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: active ? "#C5A059" : "#D9CDB4", flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 500, color: "#A29C8E", width: 120 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 400, color: "var(--tx)" }}>{date}</span>
    </div>
  );
}

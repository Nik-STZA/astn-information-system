// Client diary, read-only mirror of diary/YYYY-MM.md.
//
// Internal audit trail. Entries may name individuals, which the diary
// convention permits, but nothing here may be lifted into board or
// exec-visible output without anonymising (Feldspar CLAUDE.md rule 8).

import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import { fetchDiary, type DiaryEntryRow } from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

// Month-only entries are rendered as a month, not a spurious first-of-month.
function formatWhen(entry: DiaryEntryRow): string {
  if (!entry.occurred_at) return "Undated";
  const d = new Date(entry.occurred_at);

  if (entry.occurred_precision === "month") {
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const day = d.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  if (entry.occurred_precision === "minute") {
    const time = d.toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "UTC",
    });
    return `${day}, ${time}`;
  }
  return day;
}

function Entry({ entry }: { entry: DiaryEntryRow }) {
  const who = entry.role
    ? entry.agent_name
      ? `${entry.role} (${entry.agent_name})`
      : entry.role
    : null;

  return (
    <article
      style={{
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 10,
        padding: "16px 18px",
        marginBottom: 12,
        fontFamily: "Manrope, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx)" }}>
          {formatWhen(entry)}
          {who && (
            <span style={{ fontWeight: 500, color: "var(--sub)" }}> · {who}</span>
          )}
        </div>
        {entry.status && (
          <div style={{ fontSize: 11, color: "var(--sub)" }}>{entry.status}</div>
        )}
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--tx)", whiteSpace: "pre-wrap" }}>
        {entry.action}
      </div>

      {entry.where_path && (
        <details style={{ marginTop: 10 }}>
          <summary
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--sub)",
              cursor: "pointer",
            }}
          >
            Where
          </summary>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--sub)",
              whiteSpace: "pre-wrap",
            }}
          >
            {entry.where_path}
          </div>
        </details>
      )}

      {entry.notes && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--sub)",
              cursor: "pointer",
            }}
          >
            Notes
          </summary>
          <div
            style={{
              marginTop: 6,
              fontSize: 12.5,
              lineHeight: 1.65,
              color: "var(--tx)",
              whiteSpace: "pre-wrap",
            }}
          >
            {entry.notes}
          </div>
        </details>
      )}

      <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--sub)" }}>
        {entry.source_file}
        {entry.source_line ? `:${entry.source_line}` : ""}
      </div>
    </article>
  );
}

export default async function DiaryPage({ params }: { params: { slug: string } }) {
  const entries = await fetchDiary(params.slug);

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Diary" />
      <ClientTabs slug={params.slug} active="diary" />

      <p
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 13,
          color: "var(--sub)",
          margin: "0 0 20px",
        }}
      >
        {entries.length} entries, most recent first. Mirrored from the client diary files.
      </p>

      {entries.length === 0 ? (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            border: "1px dashed var(--empty-border)",
            borderRadius: 10,
            background: "var(--empty-bg)",
            color: "var(--empty-text)",
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
          }}
        >
          No diary entries mirrored yet.
        </div>
      ) : (
        entries.map((e) => <Entry key={e.id} entry={e} />)
      )}
    </div>
  );
}

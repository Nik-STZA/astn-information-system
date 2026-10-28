// Client diary, read-only mirror of diary/YYYY-MM.md.
//
// Internal audit trail. Entries may name individuals, which the diary
// convention permits, but nothing here may be lifted into board or
// exec-visible output without anonymising (Feldspar CLAUDE.md rule 8).

import PageHeader from "@/shared/ui/PageHeader";
import { fetchDiary, type DiaryEntryRow } from "@/modules/finance/lib/api";
import styles from "@/modules/finance/components/Page.module.css";

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
    <article className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>
          {formatWhen(entry)}
          {who && <span style={{ fontWeight: 400, color: "var(--sub)" }}> · {who}</span>}
        </span>
      </div>

      <div style={{ marginTop: 6, color: "var(--tx)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.action}</div>

      {/* Status is free text, often a sentence, so it wraps rather than sitting in a pill. */}
      {entry.status && (
        <div className={styles.small} style={{ marginTop: 6, overflowWrap: "anywhere" }}>Status: {entry.status}</div>
      )}

      {entry.where_path && (
        <details style={{ marginTop: 8 }}>
          <summary className={styles.summary}>Where</summary>
          <div className={styles.small} style={{ marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {entry.where_path}
          </div>
        </details>
      )}

      {entry.notes && (
        <details style={{ marginTop: 6 }}>
          <summary className={styles.summary}>Notes</summary>
          <div style={{ marginTop: 4, color: "var(--tx)", whiteSpace: "pre-wrap" }}>{entry.notes}</div>
        </details>
      )}

      <div className={styles.small} style={{ marginTop: 8, fontSize: 11, overflowWrap: "anywhere" }}>
        {entry.source_file}
        {entry.source_line ? `:${entry.source_line}` : ""}
      </div>
    </article>
  );
}

export default async function DiaryPage({ params }: { params: { slug: string } }) {
  const entries = await fetchDiary(params.slug);

  return (
    <div>
      <PageHeader title="Diary" sub="Notes and decisions for this client, newest first." />

      <p className={styles.intro}>
        {entries.length.toLocaleString("en-GB")} entries, mirrored from the client diary files.
      </p>

      <section className={`${styles.card} ${styles.wide}`} aria-label="Diary entries">
        {entries.length === 0 ? (
          <div className={styles.empty}>No diary entries mirrored yet.</div>
        ) : (
          entries.map((e) => <Entry key={e.id} entry={e} />)
        )}
      </section>
    </div>
  );
}

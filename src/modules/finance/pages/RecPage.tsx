// One reconciliation: each company's ledger against its support, the schedule,
// the checks, the proposed journal, the steps from preparer to sign-off, and
// its thread (with its accounts' threads for the month, as the Fixed assets
// page and the agents see them).

import RecView from "@/modules/finance/components/RecView";
import { fetchRec } from "@/modules/finance/lib/recs";
import { fetchPeople } from "@/modules/finance/lib/asset-schedule";
import { fetchThreads, meFrom, recSubjects } from "@/modules/finance/lib/threads";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function RecPage({ params: paramsPromise, actorEmail = null }: { params: Promise<{ slug: string; id: string }>; actorEmail?: string | null }) {
  const { slug, id } = await paramsPromise;
  const r = await fetchRec(slug, id);
  if (!r.ok) {
    return (
      <div className={styles.error} role="alert">
        <div className={styles.errorTitle}>Could not load this reconciliation</div>
        {r.error}
      </div>
    );
  }
  const [threads, people] = await Promise.all([
    fetchThreads(slug, { subjects: recSubjects(r.data.rec.id, r.data.cover.rows), period: r.data.rec.period }).catch(() => null),
    fetchPeople().catch(() => null),
  ]);
  const me = meFrom(actorEmail, people?.ok ? people.data.people : null);
  // A thread that cannot be read (or migration 050 not yet applied) leaves the
  // reconciliation as it was, with a line saying so.
  const thread = threads?.ok ? { entries: threads.data.threads, error: null } : { entries: [], error: threads && !threads.ok && threads.status !== 503 ? threads.error : null };
  return <RecView slug={slug} data={r.data} thread={thread} me={me} />;
}

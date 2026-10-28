// Open items register, read-only mirror of the client's open-items.md.
//
// Internal surface. Owner labels name individuals, which is fine here because
// this is the CFO's own working view, but nothing on this page may be reused in
// board or exec-visible output without anonymising (Feldspar CLAUDE.md rule 8).

import Link from "next/link";
import { SquareKanban } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import { fetchOpenItems, type OpenItemRow } from "@/modules/finance/lib/api";
import { isDoneStatus } from "@/modules/finance/lib/parse-open-items";
import NoteThread from "@/modules/finance/components/NoteThread";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

const PRIORITY_TONE: Record<string, string> = {
  P1: "s-red",
  P2: "s-amber",
  P3: "s-neutral",
};

function Row({ item, slug }: { item: OpenItemRow; slug: string }) {
  return (
    <div className={styles.itemRow}>
      <div className={styles.ref}>{item.ref}</div>
      <div style={{ color: "var(--tx)", minWidth: 0 }}>
        {item.title}
        {item.resolution && (
          <div className={styles.small} style={{ marginTop: 4 }}>{item.resolution}</div>
        )}
      </div>
      <div className={styles.itemSide}>
        <div className={styles.small}>{item.status ?? "-"}</div>
        <div className={styles.small}>{item.owner_label ?? "-"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {item.priority && (
              <span className={`${styles.status} ${styles[PRIORITY_TONE[item.priority] ?? "s-neutral"]}`}>
                {item.priority}
              </span>
            )}
            <span className={styles.small}>{item.closed_at ?? item.last_update_at ?? item.raised_at ?? ""}</span>
          </div>
          <NoteThread slug={slug} targetType="open_item" targetId={item.id} initialCount={item.note_count ?? 0} />
        </div>
      </div>
    </div>
  );
}

function Group({ title, items, slug }: { title: string; items: OpenItemRow[]; slug: string }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className={styles.listHead}>
        <h2>{title}</h2>
        <span className={styles.updating}>{items.length}</span>
      </div>
      <section className={`${styles.card} ${styles.wide}`} aria-label={title}>
        {items.map((i) => (
          <Row key={i.id} item={i} slug={slug} />
        ))}
      </section>
    </>
  );
}

export default async function OpenItemsPage({
  params,
}: {
  params: { slug: string };
}) {
  const items = await fetchOpenItems(params.slug);

  // The register keeps completed items in the active table until someone tidies
  // up, so counting rows overstates the workload. Outstanding means not in the
  // closed section and not marked done in place.
  const active = items.filter((i) => !i.is_closed && !isDoneStatus(i.status));
  const doneInPlace = items.filter((i) => !i.is_closed && isDoneStatus(i.status));
  const closed = items.filter((i) => i.is_closed);

  const categories = Array.from(
    new Set(active.map((i) => i.category ?? "Uncategorised"))
  );

  return (
    <div>
      <PageHeader title="Open items" sub="The old open-items register, kept as an archive. Open items now live in Work." />
      {/* Work is the master for open items (Nik, 27 Oct 2026); this is the register as it stood. */}
      <div className={`${styles.card} ${styles.pad} ${styles.wide}`} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontSize: 13, lineHeight: 1.55, flex: "1 1 280px" }}>
          Open items now live in <strong>Work</strong>, where you can add, change, block and close them. This page is the register as it stood, kept as an archive.
        </span>
        <Link href={`/finance/clients/${params.slug}/work`} className="btn-primary">
          <SquareKanban size={15} aria-hidden="true" />Open Work
        </Link>
      </div>

      <p className={styles.intro}>
        {active.length} outstanding, {doneInPlace.length} done but still listed as active,{" "}
        {closed.length} closed. Mirrored from open-items.md.
      </p>

      {categories.map((c) => (
        <Group
          key={c}
          title={c}
          slug={params.slug}
          items={active.filter((i) => (i.category ?? "Uncategorised") === c)}
        />
      ))}

      <Group title="Done, still filed under active" items={doneInPlace} slug={params.slug} />

      <Group title="Closed and superseded" items={closed} slug={params.slug} />
    </div>
  );
}

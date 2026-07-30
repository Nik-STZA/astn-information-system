// Open items register, read-only mirror of the client's open-items.md.
//
// Internal surface. Owner labels name individuals, which is fine here because
// this is the CFO's own working view, but nothing on this page may be reused in
// board or exec-visible output without anonymising (Feldspar CLAUDE.md rule 8).

import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import { fetchOpenItems, type OpenItemRow } from "@/modules/finance/lib/api";
import { isDoneStatus } from "@/modules/finance/lib/parse-open-items";
import NoteThread from "@/modules/finance/components/NoteThread";

export const dynamic = "force-dynamic";

const PRIORITY_COLOUR: Record<string, string> = {
  P1: "var(--alert-red)",
  P2: "var(--warning-amber)",
  P3: "var(--sub)",
};

function Pill({ text, colour }: { text: string; colour: string }) {
  return (
    <span
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: ".04em",
        padding: "3px 6px",
        borderRadius: 4,
        border: `1px solid ${colour}`,
        color: colour,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Row({ item, slug }: { item: OpenItemRow; slug: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "46px 1fr 150px 110px 96px",
        gap: 12,
        alignItems: "start",
        padding: "12px 0",
        borderTop: "1px solid var(--bd)",
        fontFamily: "Manrope, sans-serif",
        fontSize: 13,
        color: "var(--tx)",
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--sub)" }}>{item.ref}</div>
      <div style={{ lineHeight: 1.5 }}>
        {item.title}
        {item.resolution && (
          <div style={{ marginTop: 5, fontSize: 12, color: "var(--sub)", lineHeight: 1.5 }}>
            {item.resolution}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--sub)", lineHeight: 1.45 }}>
        {item.status ?? "-"}
      </div>
      <div style={{ fontSize: 12, color: "var(--sub)" }}>{item.owner_label ?? "-"}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
        {item.priority && (
          <Pill text={item.priority} colour={PRIORITY_COLOUR[item.priority] ?? "var(--sub)"} />
        )}
        <span style={{ fontSize: 11, color: "var(--sub)" }}>
          {item.closed_at ?? item.last_update_at ?? item.raised_at ?? ""}
        </span>
        <NoteThread
          slug={slug}
          targetType="open_item"
          targetId={item.id}
          initialCount={item.note_count ?? 0}
        />
      </div>
    </div>
  );
}

function Group({ title, items, slug }: { title: string; items: OpenItemRow[]; slug: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--sub)",
          marginBottom: 4,
        }}
      >
        {title} ({items.length})
      </div>
      {items.map((i) => (
        <Row key={i.id} item={i} slug={slug} />
      ))}
    </div>
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
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Open items" />
      <ClientTabs slug={params.slug} active="open-items" />

      <p
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 13,
          color: "var(--sub)",
          margin: "0 0 22px",
        }}
      >
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

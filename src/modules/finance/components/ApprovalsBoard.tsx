"use client";

// The approvals surface: activity list on the left, five state panels on the
// right. Selecting a row turns the left pane into the detail view, and the
// selection is held in the URL so a push notification can deep-link to an item.
//
// Every item sits in exactly one panel, because the panel is derived from the
// item's state and state is the directory the folder lives in. Nothing here
// decides which panel something belongs to.

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { WipItemRow } from "@/modules/finance/lib/api";
import NoteThread from "@/modules/finance/components/NoteThread";

type Panel = WipItemRow["panel"];

const PANELS: Array<{ key: Panel; title: string; glyph: string; attention?: boolean }> = [
  { key: "awaiting-decision", title: "Awaiting decision", glyph: "●", attention: true },
  { key: "blocked-external", title: "Blocked on external", glyph: "○" },
  { key: "in-progress-upstream", title: "In progress upstream", glyph: "↳" },
  { key: "upcoming", title: "Upcoming", glyph: "▲" },
  { key: "activity", title: "Activity", glyph: "·" },
];

const GOLD = "#C5A059";

function money(amount: string | null): string {
  if (!amount) return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "entity" | "type" | "p1" }) {
  const colour =
    tone === "p1" ? "var(--alert-red)" : tone === "entity" ? GOLD : "var(--sub)";
  return (
    <span
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        padding: "2px 5px",
        borderRadius: 3,
        border: `1px solid ${colour}`,
        color: colour,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function PanelRow({
  item,
  selected,
  onSelect,
}: {
  item: WipItemRow;
  selected: boolean;
  onSelect: (ref: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.ref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item.ref);
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "60px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        cursor: "pointer",
        fontSize: 11.5,
        fontFamily: "Manrope, sans-serif",
        borderBottom: "1px solid var(--bd)",
        background: selected ? "rgba(197,160,89,.12)" : "transparent",
        borderLeft: selected ? `2px solid ${GOLD}` : "2px solid transparent",
      }}
    >
      <span style={{ color: GOLD, fontWeight: 700, fontSize: 9.5, letterSpacing: ".05em" }}>
        {item.entityLabel}
      </span>
      <span
        style={{
          color: "var(--tx)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.title}
      </span>
      <span style={{ color: "var(--sub)", whiteSpace: "nowrap" }}>
        {money(item.amountTotal) || (item.type === "month-end" ? "Pack" : "")}
      </span>
    </div>
  );
}

function StatePanel({
  panel,
  items,
  selectedRef,
  onSelect,
}: {
  panel: (typeof PANELS)[number];
  items: WipItemRow[];
  selectedRef: string | null;
  onSelect: (ref: string) => void;
}) {
  return (
    <section
      style={{
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 8,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: items.length ? "1px solid var(--bd)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: panel.attention ? GOLD : "var(--sub)", fontSize: 11 }}>
            {panel.glyph}
          </span>
          <span
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--tx)",
            }}
          >
            {panel.title}
          </span>
        </div>
        <span
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 7px",
            borderRadius: 9,
            color: panel.attention && items.length ? "#141414" : "var(--sub)",
            background: panel.attention && items.length ? GOLD : "transparent",
            border: panel.attention && items.length ? "none" : "1px solid var(--bd)",
          }}
        >
          {items.length}
        </span>
      </div>
      {items.map((i) => (
        <PanelRow
          key={i.ref}
          item={i}
          selected={i.ref === selectedRef}
          onSelect={onSelect}
        />
      ))}
    </section>
  );
}


// States the segregation position rather than letting four role labels imply
// independence that may not exist. "Cannot tell" is shown as its own state,
// never folded into either answer.
function IndependenceNote({ item }: { item: WipItemRow }) {
  const map = {
    independent: {
      colour: "var(--success-green)",
      text: "Reviewed by someone other than the preparer.",
    },
    "same-person": {
      colour: "var(--warning-amber)",
      text: "Prepared and reviewed by the same person. The tiers below are a workflow record, not independent review.",
    },
    "not-recorded": {
      colour: "var(--sub)",
      text: "Who performed each step was not recorded, so independence cannot be established from this record.",
    },
  } as const;
  const s = map[item.reviewIndependence] ?? map["not-recorded"];

  return (
    <div
      style={{
        border: `1px solid ${s.colour}`,
        borderRadius: 7,
        padding: "9px 11px",
        marginBottom: 12,
        fontFamily: "Manrope, sans-serif",
        fontSize: 11.5,
        lineHeight: 1.5,
        color: s.colour,
      }}
    >
      {s.text}
    </div>
  );
}

function Detail({
  item,
  slug,
  onBack,
}: {
  item: WipItemRow;
  slug: string;
  onBack: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--sub)",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          marginBottom: 14,
        }}
      >
        &larr; Back to activity
      </button>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <Tag tone="entity">{item.entityLabel}</Tag>
        <Tag tone="type">{item.type}</Tag>
        {item.priority && <Tag tone={item.priority === "P1" ? "p1" : "type"}>{item.priority}</Tag>}
      </div>

      <h2
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 20,
          fontWeight: 800,
          color: "var(--tx)",
          margin: "0 0 8px",
        }}
      >
        {item.title}
      </h2>

      {item.amountTotal && (
        <div
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 24,
            fontWeight: 800,
            color: "var(--tx)",
            marginBottom: 16,
          }}
        >
          {money(item.amountTotal)}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          fontSize: 12,
          fontFamily: "Manrope, sans-serif",
          padding: "14px 0",
          borderTop: "1px solid var(--bd)",
          borderBottom: "1px solid var(--bd)",
          marginBottom: 16,
        }}
      >
        {[
          ["Drafted by", item.drafterRole ?? "-"],
          ["Entity", item.entityLabel],
          ["State", item.status + (item.tier ? ` (${item.tier})` : "")],
          ["Drafted", when(item.draftedAt) || "-"],
        ].map(([label, value]) => (
          <div key={label}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--sub)",
              }}
            >
              {label}
            </div>
            <div style={{ color: "var(--tx)", marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--sub)",
          marginBottom: 8,
        }}
      >
        Review chain
      </div>

      <IndependenceNote item={item} />

      {item.reviews.length === 0 ? (
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12.5, color: "var(--sub)" }}>
          No reviews recorded yet.
        </div>
      ) : (
        item.reviews.map((r, i) => (
          <div
            key={i}
            style={{
              background: "var(--pnl)",
              border: "1px solid var(--bd)",
              borderRadius: 7,
              padding: "10px 12px",
              marginBottom: 8,
              fontFamily: "Manrope, sans-serif",
              fontSize: 12.5,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <strong style={{ color: "var(--tx)" }}>{r.reviewerRole}</strong>
              <span style={{ color: "var(--sub)", fontSize: 11 }}>
                {r.outcome} · {when(r.reviewedAt)}
              </span>
            </div>
            {r.findings.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--tx)" }}>
                {r.findings.map((f, j) => (
                  <li key={j}>{f}</li>
                ))}
              </ul>
            )}
            {r.notes && (
              <div style={{ marginTop: 6, color: "var(--sub)", lineHeight: 1.5 }}>{r.notes}</div>
            )}
            {r.nextStep && (
              <div style={{ marginTop: 6, color: "var(--sub)" }}>Next: {r.nextStep}</div>
            )}
          </div>
        ))
      )}

      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--sub)",
          margin: "20px 0 8px",
        }}
      >
        Notes
      </div>
      <NoteThread slug={slug} targetType="wip_item" targetId={item.id} />

      <div style={{ marginTop: 18, fontFamily: "Manrope, sans-serif", fontSize: 11, color: "var(--sub)" }}>
        {item.folderPath}
      </div>
    </div>
  );
}

export default function ApprovalsBoard({
  slug,
  items,
}: {
  slug: string;
  items: WipItemRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selectedRef = params.get("item");

  // Selection lives in the URL so a push notification can open a specific item
  // and the back button behaves.
  const select = useCallback(
    (ref: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (ref) next.set("item", ref);
      else next.delete("item");
      router.replace(`/finance/clients/${slug}/approvals?${next.toString()}`, { scroll: false });
    },
    [params, router, slug]
  );

  const byPanel = useMemo(() => {
    const map = new Map<Panel, WipItemRow[]>();
    for (const p of PANELS) map.set(p.key, []);
    for (const i of items) map.get(i.panel)?.push(i);
    return map;
  }, [items]);

  const selected = items.find((i) => i.ref === selectedRef) ?? null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        gap: 18,
        alignItems: "start",
      }}
      className="finance-two-pane"
    >
      <div>
        {selected ? (
          <Detail item={selected} slug={slug} onBack={() => select(null)} />
        ) : (
          <>
            <div
              style={{
                fontFamily: "Manrope, sans-serif",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                color: "var(--sub)",
                marginBottom: 8,
              }}
            >
              All activity
            </div>
            {items.length === 0 ? (
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
                Nothing in progress for this client.
              </div>
            ) : (
              items.map((i) => (
                <div
                  key={i.ref}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(i.ref)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(i.ref);
                    }
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr auto auto",
                    alignItems: "center",
                    gap: 10,
                    padding: "11px 12px",
                    cursor: "pointer",
                    fontFamily: "Manrope, sans-serif",
                    fontSize: 12.5,
                    borderBottom: "1px solid var(--bd)",
                  }}
                >
                  <Tag tone="entity">{i.entityLabel}</Tag>
                  <span style={{ color: "var(--tx)" }}>{i.title}</span>
                  <span style={{ color: "var(--sub)", fontSize: 11 }}>{i.status}</span>
                  <span style={{ color: "var(--tx)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {money(i.amountTotal)}
                  </span>
                </div>
              ))
            )}
          </>
        )}
      </div>

      <div>
        {PANELS.map((p) => (
          <StatePanel
            key={p.key}
            panel={p}
            items={byPanel.get(p.key) ?? []}
            selectedRef={selectedRef}
            onSelect={select}
          />
        ))}
      </div>
    </div>
  );
}

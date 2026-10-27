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
import { ArrowLeft, CalendarClock, CircleDot, CornerDownRight, History, Hourglass, type LucideIcon } from "lucide-react";
import type { WipItemRow } from "@/modules/finance/lib/api";
import NoteThread from "@/modules/finance/components/NoteThread";
import styles from "./Approvals.module.css";

type Panel = WipItemRow["panel"];

const PANELS: Array<{ key: Panel; title: string; icon: LucideIcon; attention?: boolean }> = [
  { key: "awaiting-decision", title: "Awaiting your decision", icon: CircleDot, attention: true },
  { key: "blocked-external", title: "Waiting on someone outside", icon: Hourglass },
  { key: "in-progress-upstream", title: "In progress below you", icon: CornerDownRight },
  { key: "upcoming", title: "Upcoming", icon: CalendarClock },
  { key: "activity", title: "Recently finished", icon: History },
];

// The folder state in words, and how it looks. pending-cfo is the CFO's own
// queue, so it reads "Awaiting you".
const STATUS: Record<string, { label: string; tone: string }> = {
  drafting: { label: "Drafting", tone: "s-neutral" },
  "pending-fm": { label: "With the FM", tone: "s-review" },
  "pending-fc": { label: "With the FC", tone: "s-review" },
  "pending-cfo": { label: "Awaiting you", tone: "s-you" },
  "sent-back": { label: "Sent back", tone: "s-back" },
  posted: { label: "Posted", tone: "s-done" },
  rejected: { label: "Rejected", tone: "s-neutral" },
};

function Status({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "s-neutral" };
  return <span className={`${styles.status} ${styles[s.tone]}`}><span className={styles.dot} />{s.label}</span>;
}

function money(amount: string | null): string {
  if (!amount) return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ") : s);

const TYPE_LABEL: Record<string, string> = {
  ap: "AP", ar: "AR", vat: "VAT", fpa: "FP&A", tax: "Tax", "month-end": "Month-end", reconciliation: "Reconciliation",
};

function onKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function PanelRow({ item, selected, onSelect }: { item: WipItemRow; selected: boolean; onSelect: (ref: string) => void }) {
  return (
    <div role="button" tabIndex={0} onClick={() => onSelect(item.ref)} onKeyDown={onKey(() => onSelect(item.ref))}
      className={`${styles.row} ${styles.compact} ${selected ? styles.rowSel : ""}`}>
      <span className={styles.chip}>{item.entityLabel}</span>
      <span className={styles.rowTitle} title={item.title}>{item.title}</span>
      <span className={styles.amount}>{money(item.amountTotal) || (item.type === "month-end" ? "Pack" : "")}</span>
    </div>
  );
}

// Sums for display without going through a float. The rest of the module keeps
// money as strings for exactly this reason, and a total that is a penny out on
// an attestation the CFO signs is not a rounding curiosity.
function sumPence(items: WipItemRow[]): number {
  return items.reduce((acc, i) => {
    if (!i.amountTotal) return acc;
    const [whole, frac = ""] = i.amountTotal.replace("-", "").split(".");
    const sign = i.amountTotal.startsWith("-") ? -1 : 1;
    return acc + sign * Number(whole + frac.padEnd(2, "0").slice(0, 2));
  }, 0);
}

// Mechanical work below the client's materiality threshold may be approved as a
// population rather than read line by line. The banner states what that
// approval actually covers, because the alternative - recording individual
// approval of items nobody read individually - produces durable evidence of a
// review that did not happen.
function BatchBanner({ items }: { items: WipItemRow[] }) {
  const total = sumPence(items);
  return (
    <div className={styles.batch}>
      <div className={styles.batchTitle}>
        Batch of {items.length} item{items.length === 1 ? "" : "s"}
        {total !== 0 && `, ${money((total / 100).toFixed(2))} total`}
      </div>
      <div className={styles.small}>
        Mechanical and below threshold, reconciling clean. Approving here attests
        to the population, not to each line. Anything carrying judgement is listed
        separately below and is not part of this batch.
      </div>
    </div>
  );
}

function StatePanel({ panel, items, selectedRef, onSelect }: {
  panel: (typeof PANELS)[number]; items: WipItemRow[]; selectedRef: string | null; onSelect: (ref: string) => void;
}) {
  // Only the decision panel splits. Everywhere else the class is irrelevant,
  // because nothing is being approved.
  const batchable = items.filter((i) => i.routingClass === "mechanical");
  const individual = items.filter((i) => i.routingClass !== "mechanical");
  const Icon = panel.icon;
  const row = (i: WipItemRow) => <PanelRow key={i.ref} item={i} selected={i.ref === selectedRef} onSelect={onSelect} />;

  return (
    <section className={styles.card} aria-label={panel.title}>
      <div className={styles.cardHead} style={items.length ? undefined : { borderBottom: 0 }}>
        <span className={styles.cardTitle}><Icon size={15} aria-hidden="true" />{panel.title}</span>
        <span className={`${styles.count} ${panel.attention && items.length ? styles.countOn : ""}`}>{items.length}</span>
      </div>
      {panel.key === "awaiting-decision" ? (
        <>
          {batchable.length > 0 && <BatchBanner items={batchable} />}
          {batchable.map(row)}
          {individual.length > 0 && batchable.length > 0 && <div className={styles.divider}>Read individually</div>}
          {individual.map(row)}
        </>
      ) : items.map(row)}
    </section>
  );
}

// States the segregation position rather than letting four role labels imply
// independence that may not exist. "Cannot tell" is shown as its own state,
// never folded into either answer.
function IndependenceNote({ item }: { item: WipItemRow }) {
  const map = {
    independent: { tone: "s-done", text: "Reviewed by someone other than the preparer." },
    "same-person": {
      tone: "s-you",
      text: "Prepared and reviewed by the same person. The tiers below are a workflow record, not independent review.",
    },
    "not-recorded": {
      tone: "s-neutral",
      text: "Who performed each step was not recorded, so independence cannot be established from this record.",
    },
  } as const;
  const s = map[item.reviewIndependence] ?? map["not-recorded"];
  return <div className={`${styles.note} ${styles[s.tone]}`}>{s.text}</div>;
}

function Detail({ item, slug, onBack }: { item: WipItemRow; slug: string; onBack: () => void }) {
  return (
    <section className={styles.card} aria-label={item.title}>
      <div className={styles.detail}>
        <button type="button" className={styles.back} onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />All activity
        </button>

        <div className={styles.section}>
          <div className={styles.chips}>
            <span className={styles.chip}>{item.entityLabel}</span>
            <span className={styles.chip}>{TYPE_LABEL[item.type] ?? sentence(item.type)}</span>
            {item.priority && <span className={`${styles.chip} ${item.priority === "P1" ? styles.chipP1 : ""}`}>{item.priority}</span>}
            <Status status={item.status} />
          </div>
          <h2 className={styles.detailTitle}>{item.title}</h2>
          {item.amountTotal && <div className={styles.bigAmount}>{money(item.amountTotal)}</div>}
        </div>

        <div className={styles.facts}>
          {[
            ["Drafted by", item.drafterRole ?? "-"],
            ["Company", item.entityLabel],
            ["Stage", (STATUS[item.status]?.label ?? item.status) + (item.tier ? ` (${item.tier.toUpperCase()})` : "")],
            ["Drafted", when(item.draftedAt) || "-"],
          ].map(([label, value]) => (
            <div key={label}>
              <div className={styles.factLabel}>{label}</div>
              <div>{value}</div>
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Review chain</h3>
          <IndependenceNote item={item} />
          {item.reviews.length === 0 ? (
            <div className={styles.small}>No reviews recorded yet.</div>
          ) : (
            item.reviews.map((r, i) => (
              <div key={i} className={styles.review}>
                <div className={styles.reviewHead}>
                  <strong>{r.reviewerRole}</strong>
                  <span className={styles.small}>{sentence(r.outcome ?? "")} · {when(r.reviewedAt)}</span>
                </div>
                {r.findings.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {r.findings.map((f, j) => <li key={j}>{f}</li>)}
                  </ul>
                )}
                {r.notes && <div className={styles.reviewBody}>{r.notes}</div>}
                {r.nextStep && <div className={styles.reviewBody}>Next: {r.nextStep}</div>}
              </div>
            ))
          )}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Notes</h3>
          <NoteThread slug={slug} targetType="wip_item" targetId={item.id} />
        </div>

        <div className={styles.path}>{item.folderPath}</div>
      </div>
    </section>
  );
}

export default function ApprovalsBoard({ slug, items }: { slug: string; items: WipItemRow[] }) {
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
    <div className={styles.layout}>
      {selected ? (
        <Detail item={selected} slug={slug} onBack={() => select(null)} />
      ) : (
        <section className={styles.card} aria-label="All activity">
          <div className={styles.cardHead}><h2>All activity</h2><span className={styles.count}>{items.length}</span></div>
          {items.length === 0 ? (
            <div className={styles.empty}>Nothing in progress for this client.</div>
          ) : (
            items.map((i) => (
              <div key={i.ref} role="button" tabIndex={0} onClick={() => select(i.ref)} onKeyDown={onKey(() => select(i.ref))} className={styles.row}>
                <span className={styles.chip}>{i.entityLabel}</span>
                <span className={styles.rowTitle}>{i.title}</span>
                <Status status={i.status} />
                <span className={styles.amount}>{money(i.amountTotal)}</span>
              </div>
            ))
          )}
        </section>
      )}

      <div className={styles.panels}>
        {PANELS.map((p) => (
          <StatePanel key={p.key} panel={p} items={byPanel.get(p.key) ?? []} selectedRef={selectedRef} onSelect={select} />
        ))}
      </div>
    </div>
  );
}

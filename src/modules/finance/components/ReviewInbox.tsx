"use client";

// The Review inbox: what is waiting for you, then what is waiting on others,
// each oldest first, filtered by kind. Every row is a link to the screen where
// it is acted on; nothing is approved here, so each screen's own CFO and FC
// rules stay the only way anything moves. The filter is kept in the address so
// a link or a refresh keeps it.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  FILTERS, KIND_LABEL, WAITING_LABEL, ageText, amountText, filterCount, grouped, isFilter,
  type Filter, type ReviewInbox as Inbox, type ReviewItem,
} from "@/modules/finance/lib/review";
import styles from "./Review.module.css";

function Waiting({ item }: { item: ReviewItem }) {
  return (
    <span className={`${styles.pill} ${item.for_you ? styles.pillYou : ""}`}>
      {item.for_you ? "You" : WAITING_LABEL[item.waiting_on]}
    </span>
  );
}

function Cards({ items, now }: { items: ReviewItem[]; now: number }) {
  return (
    <div className={styles.cards}>
      {items.map((i) => (
        <Link key={`${i.kind}-${i.id}`} href={i.href} className={styles.cardLink}>
          <div className={styles.rowTop}>
            <span className={styles.rowName}>{i.title}</span>
            <Waiting item={i} />
          </div>
          <div className={styles.rowStatus}>{i.status}</div>
          <div className={styles.rowMeta}>
            <span>{KIND_LABEL[i.kind]}</span>
            {i.company && <span>{i.company}</span>}
            {amountText(i.amount, i.currency) && <span className={styles.num}>{amountText(i.amount, i.currency)}</span>}
            {i.produced_by && <span>By {i.produced_by}</span>}
            <span>{ageText(i.since, now)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function Table({ items, now }: { items: ReviewItem[]; now: number }) {
  return (
    <div className={`${styles.tableWrap} ${styles.card}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>What</th>
            <th>Company</th>
            <th className={styles.num}>Amount</th>
            <th>Status</th>
            <th>Produced by</th>
            <th>Waiting on</th>
            <th>Waiting</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={`${i.kind}-${i.id}`}>
              <td className={styles.what}>
                <Link href={i.href} className={styles.link}>{i.title}</Link>
                <div className={styles.small}>{KIND_LABEL[i.kind]}</div>
              </td>
              <td>{i.company ?? "-"}</td>
              <td className={styles.num}>{amountText(i.amount, i.currency) || "-"}</td>
              <td className={styles.statusCell}>{i.status}</td>
              <td>{i.produced_by ?? "-"}</td>
              <td><Waiting item={i} /></td>
              <td className={styles.nowrap}>{ageText(i.since, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Group({ title, items, you, empty, now }: { title: string; items: ReviewItem[]; you?: boolean; empty: string; now: number }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>
        {title}
        <span className={`${styles.count} ${you && items.length ? styles.countYou : ""}`}>{items.length}</span>
      </h2>
      {items.length ? (
        <>
          <Cards items={items} now={now} />
          <Table items={items} now={now} />
        </>
      ) : (
        <div className={styles.empty}>{empty}</div>
      )}
    </section>
  );
}

export default function ReviewInbox({ slug, data, now }: { slug: string; data: Inbox; now: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("kind");
  const filter: Filter = isFilter(asked) ? asked : "all";
  const { forYou, others } = useMemo(() => grouped(data.items, filter), [data.items, filter]);

  function choose(f: Filter) {
    const next = new URLSearchParams(params.toString());
    if (f === "all") next.delete("kind"); else next.set("kind", f);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  const role = data.viewer.waits_as;
  const youEmpty = role
    ? `Nothing is waiting for the ${role} here.`
    : "Your role on this client is not CFO or FC, so nothing here waits on you. Items for each role are below.";

  return (
    <div className={styles.reviewPage}>
      {data.missing.length > 0 && (
        <div className={styles.alert} role="status">
          Not shown yet: {data.missing.map((m) => m.note).join(" ")}
        </div>
      )}

      <div className={styles.bar}>
        <div className={`seg ${styles.chips}`} role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={f.key === filter ? "seg-on" : ""} aria-pressed={f.key === filter} onClick={() => choose(f.key)}>
              {f.label}<span className={styles.chipCount}>{filterCount(data.items, f.key)}</span>
            </button>
          ))}
        </div>
        <span className={styles.barEnd}>
          {data.viewer.role ? `You are ${data.viewer.role} here.` : ""}
        </span>
      </div>

      <Group title="Waiting for you" items={forYou} you empty={youEmpty} now={now} />
      <Group title="Waiting on others" items={others} empty="Nothing is waiting on anyone else." now={now} />

      <p className={styles.small}>
        Each row opens the screen where it is decided. The Work list holds the tasks; this holds what agents and people
        have produced for review. An Approvals folder item opens its Work task: answer it there, and mark it done to close it
        off. Finished and upcoming folder items stay on the{" "}
        <Link href={`/finance/clients/${encodeURIComponent(slug)}/approvals?board=1`} className={styles.link}>Approvals board</Link>.
      </p>
    </div>
  );
}

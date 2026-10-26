// The AP queue: tabs and list on the left, the chosen item on the right. On a
// phone the open item replaces the list, with a way back. The URL holds the
// entity, tab and item, so a link can open any of them.

import Link from "next/link";
import styles from "./ApQueue.module.css";
import FetchDocuments from "./FetchDocuments";
import ApActions from "./ApActions";
import { AP_TABS, checkLabel, documentTypeLabel, money, shortDate } from "@/modules/finance/lib/ap-labels";
import type { ApItemDetail, ApItemRow } from "@/modules/finance/lib/ap-queue";

interface Props {
  slug: string;
  entity: string;
  entities: Array<{ slug: string; name: string }>;
  tab: string;
  items: ApItemRow[];
  selected: ApItemDetail | null;
}

export default function ApQueue({ slug, entity, entities, tab, items, selected }: Props) {
  const href = (q: { entity?: string; tab?: string; item?: string }) => {
    const p = new URLSearchParams({ entity: q.entity ?? entity, tab: q.tab ?? tab });
    if (q.item) p.set("item", q.item);
    return `/finance/clients/${slug}/bills?${p.toString()}`;
  };
  const current = AP_TABS.find((t) => t.key === tab) ?? AP_TABS[0];
  const shown = items.filter((i) => current.states.includes(i.state));

  return (
    <>
      <div className={styles.toolbar}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {entities.length > 1 && (
            <nav className={styles.chips} aria-label="Company">
              {entities.map((e) => (
                <Link key={e.slug} href={href({ entity: e.slug, item: undefined })}
                  className={e.slug === entity ? styles.chipActive : styles.chip}>{e.name}</Link>
              ))}
            </nav>
          )}
          <nav className={styles.chips} aria-label="Queue">
            {AP_TABS.map((t) => {
              const n = items.filter((i) => t.states.includes(i.state)).length;
              return (
                <Link key={t.key} href={href({ tab: t.key, item: undefined })}
                  className={t.key === current.key ? styles.chipActive : styles.chip}>
                  {t.label} <span className={styles.count}>{n}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <FetchDocuments slug={slug} entity={entity} />
      </div>

      <div className={styles.layout}>
        <section className={selected ? styles.hideOnPhone : styles.listPane} aria-label={current.label}>
          {shown.length ? (
            <ul className={styles.list}>
              {shown.map((i) => <Card key={i.id} item={i} href={href({ item: i.id })} active={selected?.id === i.id} />)}
            </ul>
          ) : (
            <div className={styles.empty}>{EMPTY[current.key] ?? "Nothing here."}</div>
          )}
        </section>

        <section className={selected ? styles.detailPane : styles.hideOnPhone} aria-label="Item">
          {selected
            ? <Detail item={selected} slug={slug} entity={entity} back={href({ item: undefined })} />
            : <div className={styles.empty}>Choose an item to see the bill and its document.</div>}
        </section>
      </div>
    </>
  );
}

const EMPTY: Record<string, string> = {
  exceptions: "Nothing needs you. Bills that need a decision appear here.",
  clean: "No clean bills waiting.",
  sent: "Nothing sent to Xero yet.",
  "set-aside": "Nothing set aside.",
};

function Card({ item, href, active }: { item: ApItemRow; href: string; active: boolean }) {
  const reasons = item.reasons ?? [];
  const title = item.supplier || (item.state === "skipped" ? item.file_name : "Supplier not recognised");
  return (
    <li>
      <Link href={href} className={active ? styles.cardActive : styles.card} aria-current={active ? "true" : undefined}>
        <div className={styles.cardTop}>
          <span className={styles.supplier}>{title}</span>
          {item.total !== null && <span className={styles.amount}>{money(item.total, item.currency)}</span>}
        </div>
        <div className={styles.meta}>
          {item.state === "skipped" || item.state === "rejected"
            ? item.state_reason
            : [item.number, shortDate(item.date)].filter((x) => x && x !== "-").join(" · ") || item.file_name}
        </div>
        {item.state === "exception" && reasons.length > 0 && (
          <div className={styles.reasonsShort}>
            {reasons.slice(0, 3).map((r) => <span key={r.check} className={styles.tagWarn}>{checkLabel(r.check)}</span>)}
            {reasons.length > 3 && <span className={styles.tag}>+{reasons.length - 3} more</span>}
          </div>
        )}
      </Link>
    </li>
  );
}

function Detail({ item, slug, entity, back }: { item: ApItemDetail; slug: string; entity: string; back: string }) {
  const bill = item.proposed_bill;
  const reasons = item.review?.reasons ?? [];
  const fileUrl = `/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/items/${item.id}/file`;
  const isPdf = (item.mime_type || "").includes("pdf");
  const isImage = (item.mime_type || "").startsWith("image/");

  return (
    <div>
      <Link href={back} className={styles.back}>&larr; Back to the list</Link>
      <article className={styles.panel}>
        <h2 className={styles.title}>{bill?.Contact?.Name || item.extraction?.supplier_name || item.file_name}</h2>
        <div className={styles.meta}>
          {documentTypeLabel(item.extraction?.document_type)} · {item.file_name}
          {item.matched_by ? ` · supplier matched by ${item.matched_by}` : ""}
        </div>

        {item.state_reason && <div className={styles.note}>{item.state_reason}</div>}

        {bill && (
          <dl className={styles.facts}>
            <Fact label="Total" value={money(bill.Total, bill.CurrencyCode)} />
            <Fact label="VAT" value={money(bill.TotalTax, bill.CurrencyCode)} />
            <Fact label="Date" value={shortDate(bill.DateString)} />
            <Fact label="Due" value={shortDate(bill.DueDateString)} />
            <Fact label="Number" value={bill.InvoiceNumber || "-"} />
            <Fact label="Amounts" value={bill.LineAmountTypes === "Inclusive" ? "Including VAT" : bill.LineAmountTypes === "NoTax" ? "No VAT" : "Before VAT"} />
          </dl>
        )}

        {reasons.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Why this needs you</h3>
            {reasons.map((r, n) => (
              <div key={`${r.check}-${n}`} className={styles.reason}>
                <div className={styles.reasonLabel}>{checkLabel(r.check)}</div>
                <div className={styles.reasonDetail}>{r.detail}</div>
              </div>
            ))}
          </div>
        )}

        {bill && bill.LineItems.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Lines</h3>
            {bill.LineItems.map((l, n) => (
              <div key={n} className={styles.line}>
                <div className={styles.lineTop}>
                  <span className={styles.lineDesc}>{l.Description}</span>
                  <span className={styles.amount}>{money(l.LineAmount, null)}</span>
                </div>
                <div className={styles.lineCoding}>
                  Account {l.AccountCode ?? <span className={styles.missing}>not set</span>} · VAT {l.TaxType ?? <span className={styles.missing}>not set</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {isImage
          // A plain img on purpose: next/image would put a client document
          // through the image optimiser and its cache.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={fileUrl} alt={`The document: ${item.file_name}`} className={styles.docImage} />
          : (
            <>
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className={styles.docLink}>Open the document</a>
              {isPdf && <iframe src={fileUrl} title={`The document: ${item.file_name}`} className={styles.docFrame} />}
            </>
          )}

        {bill && (
          <ApActions slug={slug} entity={entity} item={{
            id: item.id,
            state: item.state,
            contactId: bill.Contact?.ContactID ?? null,
            contactName: bill.Contact?.Name ?? null,
            number: bill.InvoiceNumber,
            total: bill.Total,
            currency: bill.CurrencyCode,
            lines: bill.LineItems.map((l) => ({ description: l.Description, amount: l.LineAmount, account: l.AccountCode, tax: l.TaxType })),
          }} />
        )}
      </article>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// The AP queue: tabs and list on the left, the chosen item on the right. On a
// phone the open item replaces the list, with a way back. The URL holds the
// entity, tab and item, so a link can open any of them.

import Link from "next/link";
import styles from "./ApQueue.module.css";
import FetchDocuments from "./FetchDocuments";
import ApActions from "./ApActions";
import ApRecommendation from "./ApRecommendation";
import { AP_TABS, checkLabel, documentTypeLabel, money, shortDate } from "@/modules/finance/lib/ap-labels";
import type { ApItemDetail, ApItemRow } from "@/modules/finance/lib/ap-queue";

// Account and VAT names by code, from the entity's own Xero chart.
export interface CodingNames {
  accounts: Record<string, string>;
  taxes: Record<string, string>;
}

export function accountLabel(code: string | null, names: CodingNames): string | null {
  return code ? (names.accounts[code] ? `${code} · ${names.accounts[code]}` : code) : null;
}

export function taxLabel(type: string | null, names: CodingNames): string | null {
  return type ? names.taxes[type] ?? type : null;
}

interface Props {
  slug: string;
  entity: string;
  entities: Array<{ slug: string; name: string }>;
  tab: string;
  items: ApItemRow[];
  selected: ApItemDetail | null;
  names: CodingNames;
}

export default function ApQueue({ slug, entity, entities, tab, items, selected, names }: Props) {
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
            ? <Detail item={selected} slug={slug} entity={entity} back={href({ item: undefined })} names={names} />
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
        {(item.source === "ledger_draft" || item.recommended || (item.state === "exception" && reasons.length > 0)) && (
          <div className={styles.reasonsShort}>
            {item.source === "ledger_draft" && <span className={styles.tag}>Xero draft</span>}
            {item.recommended && <span className={styles.tag}>AP Clerk suggestion</span>}
            {item.review_verdict && <span className={item.review_verdict === "agree" ? styles.tag : styles.tagWarn}>{item.review_verdict === "agree" ? "Reviewed" : "Reviewer disagrees"}</span>}
            {item.review_repetitive === "repetitive" && <span className={styles.tag}>Repetitive</span>}
            {item.review_repetitive === "changed" && <span className={styles.tagWarn}>Regular, but changed</span>}
            {item.state === "exception" && reasons.slice(0, 3).map((r) => <span key={r.check} className={styles.tagWarn}>{checkLabel(r.check)}</span>)}
            {item.state === "exception" && reasons.length > 3 && <span className={styles.tag}>+{reasons.length - 3} more</span>}
          </div>
        )}
      </Link>
    </li>
  );
}

function Detail({ item, slug, entity, back, names }: { item: ApItemDetail; slug: string; entity: string; back: string; names: CodingNames }) {
  const bill = item.proposed_bill;
  const reasons = item.review?.reasons ?? [];
  // Coding the engine changes from Xero's draft. A different bill (supplier,
  // number, date, total) is already a reason above.
  const coding = item.review?.draft_differences?.coding ?? [];
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

        {item.source === "ledger_draft" && (
          <div className={styles.note}>
            Xero keyed this as a draft bill from its bills email. Sending updates that draft with the bill below; the document is already attached.
          </div>
        )}

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

        {coding.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Changed from Xero&apos;s draft</h3>
            {coding.map((d) => (
              <div key={d.field} className={styles.reason}>
                <div className={styles.reasonLabel}>{d.field[0].toUpperCase() + d.field.slice(1)}</div>
                <div className={styles.reasonDetail}>Xero: {String(d.keyed ?? "blank")} · Sent: {String(d.proposed ?? "blank")}</div>
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
                  <div>Account: {accountLabel(l.AccountCode, names) ?? <span className={styles.missing}>not set</span>}</div>
                  <div>VAT: {taxLabel(l.TaxType, names) ?? <span className={styles.missing}>not set</span>}</div>
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

        {bill && item.recommendation && (
          <ApRecommendation key={item.id} slug={slug} entity={entity} itemId={item.id} state={item.state} rec={item.recommendation}
            billSupplier={bill.Contact?.Name ?? null}
            lines={bill.LineItems.map((l) => ({ description: l.Description, account: l.AccountCode, tax: l.TaxType }))}
            labels={item.recommendation.lines.map((l) => ({
              account: accountLabel(l.account_code, names) ?? l.account_code, tax: taxLabel(l.tax_type, names) ?? l.tax_type,
            }))} />
        )}

        {bill && (
          <ApActions key={item.id} slug={slug} entity={entity} item={{
            id: item.id,
            state: item.state,
            contactId: bill.Contact?.ContactID ?? null,
            contactName: bill.Contact?.Name ?? null,
            number: bill.InvoiceNumber,
            date: bill.DateString,
            dueDate: bill.DueDateString,
            fromDraft: item.source === "ledger_draft",
            total: bill.Total,
            currency: bill.CurrencyCode,
            lines: bill.LineItems.map((l) => ({
              description: l.Description, amount: l.LineAmount, account: l.AccountCode, tax: l.TaxType,
              accountName: accountLabel(l.AccountCode, names), taxName: taxLabel(l.TaxType, names),
            })),
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

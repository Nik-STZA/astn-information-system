// The AP queue: a short list, the bill and its decisions, and the document in
// its own pane, each scrolling on its own so a bill can be read and processed
// without moving the page. On a phone the open item replaces the list, with a
// way back. The URL holds the entity, tab and item, so a link can open any of them.

import type React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const at = selected ? shown.findIndex((i) => i.id === selected.id) : -1;
  const previous = at > 0 ? href({ item: shown[at - 1].id }) : null;
  const next = at >= 0 && at < shown.length - 1 ? href({ item: shown[at + 1].id }) : null;

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

      <div className={styles.workspace}>
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
            ? <Detail item={selected} slug={slug} entity={entity} back={href({ item: undefined })} names={names} previous={previous} next={next} position={`${at + 1} of ${shown.length}`} />
            : <div className={styles.empty}>Choose an item to see the bill and its document.</div>}
        </section>
      </div>
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
  const warnings = item.state === "exception" ? reasons.length : 0;
  const good = [
    item.recommended ? "Suggested" : null,
    item.review_verdict === "agree" ? "Reviewed" : null,
    item.review_repetitive === "repetitive" ? "Repetitive" : null,
  ].filter(Boolean);
  const bad = [
    item.review_verdict === "disagree" ? "Reviewer disagrees" : null,
    item.review_repetitive === "changed" ? "Changed" : null,
    warnings ? `${warnings} to check` : null,
  ].filter(Boolean);
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
        {(good.length > 0 || bad.length > 0) && (
          <div className={styles.cardStatus}>
            {bad.length > 0 && <span className={styles.cardWarn}>{bad.join(" · ")}</span>}
            {bad.length > 0 && good.length > 0 && " · "}
            {good.join(" · ")}
          </div>
        )}
      </Link>
    </li>
  );
}

function Detail({ item, slug, entity, back, names, previous, next, position }: {
  item: ApItemDetail; slug: string; entity: string; back: string; names: CodingNames;
  previous: string | null; next: string | null; position: string;
}) {
  const bill = item.proposed_bill;
  const reasons = item.review?.reasons ?? [];
  // Coding the engine changes from Xero's draft. A different bill (supplier,
  // number, date, total) is already a reason above.
  const coding = item.review?.draft_differences?.coding ?? [];
  const fileUrl = `/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/items/${item.id}/file`;
  const isPdf = (item.mime_type || "").includes("pdf");
  const isImage = (item.mime_type || "").startsWith("image/");

  return (
    <>
      <Link href={back} className={styles.back}>&larr; Back to the list</Link>
      <article className={styles.panel}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h2 className={styles.title}>{bill?.Contact?.Name || item.extraction?.supplier_name || item.file_name}</h2>
            {bill && <div className={styles.headTotal}>{money(bill.Total, bill.CurrencyCode)}</div>}
          </div>
          <nav className={styles.pager} aria-label="Other bills">
            <span className={styles.meta}>{position}</span>
            {previous ? <Link href={previous} className={styles.pagerLink} aria-label="Previous bill"><ChevronLeft size={16} aria-hidden="true" /></Link> : <span className={styles.pagerOff}><ChevronLeft size={16} aria-hidden="true" /></span>}
            {next ? <Link href={next} className={styles.pagerLink} aria-label="Next bill"><ChevronRight size={16} aria-hidden="true" /></Link> : <span className={styles.pagerOff}><ChevronRight size={16} aria-hidden="true" /></span>}
          </nav>
        </div>

        {bill && (
          <dl className={styles.facts}>
            <Fact label="Date" value={shortDate(bill.DateString)} />
            <Fact label="Due" value={shortDate(bill.DueDateString)} />
            <Fact label="Number" value={bill.InvoiceNumber || "-"} />
            <Fact label="VAT" value={money(bill.TotalTax, bill.CurrencyCode)} />
            <Fact label="Amounts" value={bill.LineAmountTypes === "Inclusive" ? "Including VAT" : bill.LineAmountTypes === "NoTax" ? "No VAT" : "Before VAT"} />
            <Fact label="Type" value={documentTypeLabel(item.extraction?.document_type)} />
          </dl>
        )}

        {item.state_reason && <div className={styles.note}>{item.state_reason}</div>}

        {reasons.length > 0 && (
          <details className={styles.fold} open>
            <summary className={styles.sectionTitle}>Why this needs you ({reasons.length})</summary>
            <ul className={styles.checks}>
              {reasons.map((r, n) => (
                <li key={`${r.check}-${n}`}><strong>{checkLabel(r.check)}.</strong> {r.detail}</li>
              ))}
            </ul>
          </details>
        )}

        {coding.length > 0 && (
          <details className={styles.fold}>
            <summary className={styles.sectionTitle}>Changed from Xero&apos;s draft ({coding.length})</summary>
            <ul className={styles.checks}>
              {coding.map((d) => (
                <li key={d.field}><strong>{d.field[0].toUpperCase() + d.field.slice(1)}.</strong> Xero: {String(d.keyed ?? "blank")} · Sent: {String(d.proposed ?? "blank")}</li>
              ))}
            </ul>
          </details>
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
                  {accountLabel(l.AccountCode, names) ?? <span className={styles.missing}>No account</span>}
                  {" · "}
                  {taxLabel(l.TaxType, names) ?? <span className={styles.missing}>No VAT treatment</span>}
                </div>
              </div>
            ))}
          </div>
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
          <Folded when={!!item.recommendation && item.state === "exception"}>
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
          </Folded>
        )}

        <div className={styles.note}>
          {item.file_name}{item.matched_by ? ` · supplier matched by ${item.matched_by}` : ""}
          {item.source === "ledger_draft" ? " · from Xero's bills email: sending updates that draft" : ""}
        </div>
      </article>

      <aside key={item.id} className={styles.docPane} aria-label="The document">
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
      </aside>
    </>
  );
}

// With a recommendation to accept, the full form is the exception, not the way in.
function Folded({ when, children }: { when: boolean; children: React.ReactNode }) {
  if (!when) return <>{children}</>;
  return (
    <details className={styles.fold}>
      <summary className={styles.sectionTitle}>Change the coding or reject</summary>
      {children}
    </details>
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

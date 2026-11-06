// Fixed assets, client scoped (Nik, 6 Nov 2026): each company's register as
// Xero holds it. Read only. Shows where depreciation stands, totals by asset
// type with the accounts each type posts to, the drafts waiting in Xero, and
// any asset an agent has proposed that waits on the CFO. Tying cost and
// accumulated depreciation to the ledger comes with the fixed asset
// reconciliation, on this page.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import {
  DEPRECIATION_LABEL, DEPRECIATION_TONE, dateText, fetchFixedAssets, methodText, money, pickCompany,
  type AssetRow, type CompanyRegister,
} from "@/modules/finance/lib/fixed-assets";
import { proposerLabel } from "@/modules/finance/lib/xero-changes";
import page from "@/modules/finance/components/Page.module.css";
import styles from "@/modules/finance/components/FixedAssets.module.css";

export const dynamic = "force-dynamic";

export default async function FixedAssetsPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ company?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const r = await fetchFixedAssets(slug);
  const base = `/finance/clients/${encodeURIComponent(slug)}`;

  return (
    <div>
      <PageHeader title="Fixed assets"
        sub="Each company's asset register as Xero holds it. Read only: the ties to the ledger come with the fixed asset reconciliation." />
      {!r.ok ? (
        <div className={styles.error} role="alert">Could not load the fixed assets: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}</div>
      ) : !r.data.companies.length ? (
        <div className={`${styles.card} ${styles.pad} ${styles.sub}`}>No company of this client is connected to Xero.</div>
      ) : (
        <Register base={base} companies={r.data.companies} company={pickCompany(r.data.companies, q.company)!} />
      )}
    </div>
  );
}

function Register({ base, companies, company }: { base: string; companies: CompanyRegister[]; company: CompanyRegister }) {
  return (
    <div>
      {companies.length > 1 && (
        <div className={`seg ${styles.companies}`} role="group" aria-label="Company">
          {companies.map((c) => (
            <Link key={c.slug} prefetch={false} href={`${base}/fixed-assets?company=${encodeURIComponent(c.slug)}`}
              className={c.slug === company.slug ? "seg-on" : undefined} aria-current={c.slug === company.slug ? "page" : undefined}>{c.name}</Link>
          ))}
        </div>
      )}
      {company.error ? <div className={styles.error} role="alert">{company.name}: {company.error}</div> : <Company base={base} c={company} />}
    </div>
  );
}

function Company({ base, c }: { base: string; c: CompanyRegister }) {
  const t = c.totals ?? { count: 0, cost: 0, accumulated: 0, book_value: 0 };
  const drafts = c.drafts ?? [];
  const registered = c.registered ?? [];
  const proposals = c.proposals ?? [];
  return (
    <div>
      {c.depreciation && (
        <section className={`${styles.card} ${styles.pad} ${styles.section}`} aria-label="Depreciation">
          <div className={styles.state}>
            <span className={`${page.status} ${page[DEPRECIATION_TONE[c.depreciation.state]]}`}><span className={page.dot} />{DEPRECIATION_LABEL[c.depreciation.state]}</span>
            <span className={styles.sub}>{c.depreciation.text}{c.depreciation.state === "behind" || c.depreciation.state === "never_run" ? " Depreciation is run in Xero." : ""}</span>
          </div>
        </section>
      )}

      {proposals.length > 0 && (
        <section className={styles.section} aria-labelledby="fa-waiting">
          <h2 id="fa-waiting" className={styles.h2}>Waiting for you <span className={styles.count}>{proposals.length}</span></h2>
          <div className={styles.card}>
            {proposals.map((p) => (
              <div key={p.id} className={styles.row}>
                <div className={styles.rowTop}>
                  <span className={styles.name}>{p.summary}</span>
                  <Link prefetch={false} className={styles.link} href={`${base}/xero-changes?item=${encodeURIComponent(p.id)}`}>Approve or reject</Link>
                </div>
                <div className={styles.meta}><span>Proposed by {proposerLabel(p.proposed_by)}</span>{p.state === "approved" && <span>Approved, not yet confirmed in Xero</span>}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={styles.tiles}>
        <Tile label="Registered assets" value={t.count.toLocaleString("en-GB")} />
        <Tile label="Cost" value={money(t.cost)} />
        <Tile label="Accumulated depreciation" value={money(t.accumulated)} />
        <Tile label="Book value" value={money(t.book_value)} />
      </div>

      {(c.by_type ?? []).length > 0 && (
        <section className={styles.section} aria-labelledby="fa-types">
          <h2 id="fa-types" className={styles.h2}>By asset type</h2>
          <div className={styles.card}>
            {(c.by_type ?? []).map((ty) => (
              <div key={ty.type ?? "none"} className={styles.row}>
                <div className={styles.rowTop}><span className={styles.name}>{ty.type ?? "No asset type"}</span><span className={styles.small}>{ty.count} asset{ty.count === 1 ? "" : "s"}</span></div>
                <div className={styles.figs}><span>Cost <b>{money(ty.cost)}</b></span><span>Accumulated <b>{money(ty.accumulated)}</b></span><span>Book value <b>{money(ty.book_value)}</b></span></div>
                {(ty.cost_account || ty.accumulated_account || ty.expense_account) && (
                  <div className={styles.meta}>
                    {ty.cost_account && <span>Cost: {ty.cost_account}</span>}
                    {ty.accumulated_account && <span>Accumulated: {ty.accumulated_account}</span>}
                    {ty.expense_account && <span>Charge: {ty.expense_account}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Fold title="Drafts in Xero" count={drafts.length} open={false}
        note="Not in the register until someone registers them in Xero, so they are left out of the totals above." rows={drafts} draft />
      <Fold title="Registered" count={registered.length} open={false} rows={registered} />
      {(c.disposed_count ?? 0) > 0 && <p className={styles.small}>{c.disposed_count} disposed asset{c.disposed_count === 1 ? "" : "s"} not shown.</p>}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className={`${styles.card} ${styles.tile}`}><div className={styles.tileLabel}>{label}</div><div className={styles.tileValue}>{value}</div></div>;
}

function Fold({ title, count, open, note, rows, draft = false }: { title: string; count: number; open: boolean; note?: string; rows: AssetRow[]; draft?: boolean }) {
  if (!count) return null;
  return (
    <section className={styles.section}>
      <details className={`${styles.card} ${styles.fold}`} open={open}>
        <summary><span className={styles.h2} style={{ margin: 0 }}>{title} <span className={styles.count}>{count}</span></span>{note && <div className={styles.small} style={{ marginTop: 4 }}>{note}</div>}</summary>
        <div className={styles.foldBody}>
          {rows.map((a) => (
            <div key={a.id} className={styles.row}>
              <div className={styles.rowTop}>
                <span className={styles.name}>{a.number && <span className={styles.ref}>{a.number}</span>}{a.name || "(no name)"}</span>
                <span className={styles.num}>{money(a.cost)}</span>
              </div>
              <div className={styles.meta}>
                <span>Bought {dateText(a.purchase_date)}</span>
                {a.type && <span>{a.type}</span>}
                {methodText(a) && <span>{methodText(a)}</span>}
                {!draft && <span className={styles.num}>Accumulated {money(a.accumulated)}</span>}
                {!draft && <span className={styles.num}>Book value {money(a.book_value)}</span>}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

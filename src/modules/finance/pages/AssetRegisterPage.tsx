// Asset register, client scoped (Nik, 18 Nov 2026): the register os.stza.io
// keeps for capitalised projects, IP and self-built assets, month by month.
// For each grouping: its months (prepared, signed), the tie of every mapped
// account to Xero at the chosen month end with its named items, each asset's
// cost and accumulated amortisation as the month was prepared, and the lines
// waiting on the CFO. Deciding lines, signing and reopening months happen here;
// intake and preparing a month still run from the CFO's runners. Phone first.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import {
  STATUS_LABEL, STATUS_TONE, assetTotals, dateTimeText, decidable, fetchRegisterView, fetchWaitingLines, money, monthEndText, monthText,
  reopenable, signable, tieState, type AccountTie, type Grouping, type MonthAsset, type RegisterMonth, type WaitingLine,
} from "@/modules/finance/lib/asset-register";
import { MonthActions, WaitingLineCard } from "@/modules/finance/components/AssetRegisterActions";
import page from "@/modules/finance/components/Page.module.css";
import styles from "@/modules/finance/components/FixedAssets.module.css";

export const dynamic = "force-dynamic";

export default async function AssetRegisterPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ grouping?: string; period?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const [r, w] = await Promise.all([fetchRegisterView(slug, q.grouping, q.period), fetchWaitingLines(slug)]);
  const base = `/finance/clients/${encodeURIComponent(slug)}/asset-register`;

  return (
    <div>
      <PageHeader title="Asset register"
        sub="Capitalised projects, IP and self-built assets, from the first invoice to the end of their life, tied to Xero each month end. You decide the lines and sign the months here." />
      {!r.ok ? (
        <div className={styles.error} role="alert">Could not load the asset register: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}</div>
      ) : !r.data.grouping ? (
        <div className={`${styles.card} ${styles.pad} ${styles.sub}`}>No asset register is switched on for this client.</div>
      ) : (
        <Register slug={slug} base={base} groupings={r.data.groupings} grouping={r.data.groupings.find((g) => g.grouping === r.data.grouping)!}
          month={r.data.month} waiting={w.ok ? w.data.lines.filter((l) => l.grouping === r.data.grouping) : null} waitingError={w.ok ? null : w.error}
          assets={decidable(r.data.assets).map((a) => ({ asset_no: a.asset_no, label: `${a.asset_no} ${a.name}` }))} />
      )}
    </div>
  );
}

function Register({ slug, base, groupings, grouping, month, waiting, waitingError, assets }: {
  slug: string; base: string; groupings: Grouping[]; grouping: Grouping; month: RegisterMonth | null;
  waiting: WaitingLine[] | null; waitingError: string | null;
  assets: Array<{ asset_no: string; label: string }>;
}) {
  const months = grouping.periods.filter((p) => p.status !== "open");
  return (
    <div>
      <div className={`seg ${styles.companies}`} role="group" aria-label="Register">
        {groupings.map((g) => (
          <Link key={g.grouping} prefetch={false} href={`${base}?grouping=${encodeURIComponent(g.grouping)}`}
            className={g.grouping === grouping.grouping ? "seg-on" : undefined} aria-current={g.grouping === grouping.grouping ? "page" : undefined}>
            {g.name}{g.waiting ? ` (${g.waiting})` : ""}
          </Link>
        ))}
      </div>

      {waitingError ? <div className={`${styles.error} ${styles.section}`} role="alert">Could not load the lines waiting: {waitingError}</div>
        : waiting && waiting.length > 0 && (
          <section className={styles.section} aria-labelledby="ar-waiting">
            <h2 id="ar-waiting" className={styles.h2}>Waiting for you <span className={styles.count}>{waiting.length}</span></h2>
            <div className={styles.card}>
              {waiting.map((l) => <WaitingLineCard key={l.id} slug={slug} line={l} assets={assets} />)}
            </div>
            <p className={styles.small}>Splitting a line across assets, attaching history and withdrawing a line Xero changed still run from the CFO&apos;s runners.</p>
          </section>
        )}

      {months.length > 0 && (
        <div className={`seg ${styles.companies}`} role="group" aria-label="Month">
          {months.map((p) => (
            <Link key={p.period} prefetch={false} href={`${base}?grouping=${encodeURIComponent(grouping.grouping)}&period=${p.period}`}
              className={p.period === month?.period ? "seg-on" : undefined} aria-current={p.period === month?.period ? "page" : undefined}>
              {monthText(p.period)}
            </Link>
          ))}
        </div>
      )}

      {!month ? (
        <div className={`${styles.card} ${styles.pad} ${styles.sub}`}>No month of this register has been prepared yet.</div>
      ) : (
        <Month slug={slug} grouping={grouping} month={month} />
      )}
    </div>
  );
}

function Month({ slug, grouping, month }: { slug: string; grouping: Grouping; month: RegisterMonth }) {
  const tie = tieState(month.accounts);
  const t = assetTotals(month.assets);
  const canSign = signable(grouping.periods) === month.period;
  const canReopen = reopenable(grouping.periods) === month.period;
  return (
    <div>
      <section className={`${styles.card} ${styles.pad} ${styles.section}`} aria-label="Month">
        <div className={styles.state}>
          <span className={`${page.status} ${page[STATUS_TONE[month.status]]}`}><span className={page.dot} />{STATUS_LABEL[month.status]}</span>
          <span className={`${page.status} ${page[tie.tone]}`}><span className={page.dot} />{tie.label}</span>
          <span className={styles.sub}>
            {month.opening ? "Opening, " : ""}at {monthEndText(month.period)}.
            {month.status === "signed" && month.signed_by ? ` Signed by ${month.signed_by} on ${dateTimeText(month.signed_at)}.` : ""}
            {month.status === "prepared" && month.prepared_at ? ` Prepared on ${dateTimeText(month.prepared_at)}.` : ""}
          </span>
        </div>
        {(canSign || canReopen) && <MonthActions slug={slug} grouping={grouping.grouping} period={month.period} canSign={canSign} canReopen={canReopen}
          monthLabel={monthText(month.period)} />}
      </section>

      {month.assets.length > 0 && (
        <div className={styles.tiles}>
          <Tile label="Assets" value={t.count.toLocaleString("en-GB")} />
          <Tile label="Cost" value={money(t.cost)} />
          <Tile label="Accumulated" value={money(t.accumulated)} />
          <Tile label="Net book value" value={money(t.nbv)} />
        </div>
      )}

      <section className={styles.section} aria-labelledby="ar-tie">
        <h2 id="ar-tie" className={styles.h2}>Tie to Xero</h2>
        <div className={styles.card}>
          {month.accounts.filter((a) => a.register !== 0 || a.ledger !== 0).map((a) => <AccountRow key={`${a.company}:${a.account}`} a={a} />)}
        </div>
        {month.accounts.some((a) => a.by_xero) && (
          <p className={styles.small}>Xero amortises some of these accounts itself; its charge is taken at account level, so it is in the tie but not against any asset below.</p>
        )}
      </section>

      {month.assets.length > 0 ? (
        <section className={styles.section}>
          <details className={`${styles.card} ${styles.fold}`} open={month.assets.length <= 12}>
            <summary><span className={styles.h2} style={{ margin: 0 }}>Assets <span className={styles.count}>{month.assets.length}</span></span></summary>
            <div className={styles.foldBody}>
              {[...month.assets].sort((x, y) => x.asset_no.localeCompare(y.asset_no)).map((a) => <AssetRow key={a.asset_no} a={a} />)}
            </div>
          </details>
        </section>
      ) : month.opening ? (
        <p className={styles.small}>The opening month shows the tie only; each asset&apos;s figures start with the first month prepared after it.</p>
      ) : null}
    </div>
  );
}

function AccountRow({ a }: { a: AccountTie }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowTop}>
        <span className={styles.name}>{a.account} <span className={styles.small}>{a.company}</span></span>
        <span className={`${page.status} ${page[a.ties ? "s-green" : "s-red"]}`}><span className={page.dot} />{a.ties ? "Ties" : "Differs"}</span>
      </div>
      <div className={styles.figs}>
        <span>Register <b>{money(a.register)}</b></span>
        <span>Xero <b>{money(a.ledger)}</b></span>
        {a.difference !== 0 && <span>Difference <b>{money(a.difference)}</b></span>}
        {!a.ties && <span>Unexplained <b>{money(a.unexplained)}</b></span>}
      </div>
      {(a.additions !== 0 || a.amortisation !== 0 || a.impairment !== 0) && (
        <div className={styles.meta}>
          {a.opening !== null && <span>Opening {money(a.opening)}</span>}
          {a.additions !== 0 && <span>Additions {money(a.additions)}</span>}
          {a.amortisation !== 0 && <span>Amortisation {money(a.amortisation)}{a.by_xero ? " (Xero's run)" : ""}</span>}
          {a.impairment !== 0 && <span>Impairment {money(a.impairment)}</span>}
        </div>
      )}
      {a.named_items.map((n, i) => (
        <div key={i} className={styles.meta}><span>Named item {money(n.amount)}: {n.label}</span></div>
      ))}
    </div>
  );
}

function AssetRow({ a }: { a: MonthAsset }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowTop}>
        <span className={styles.name}><span className={styles.ref}>{a.asset_no}</span>{a.name ?? ""}</span>
        <span className={styles.num}>{money(a.cost + a.accumulated)}</span>
      </div>
      <div className={styles.figs}>
        <span>Cost <b>{money(a.cost)}</b></span>
        {a.accumulated !== 0 && <span>Accumulated <b>{money(a.accumulated)}</b></span>}
        {a.additions !== 0 && <span>Added this month <b>{money(a.additions)}</b></span>}
      </div>
      <div className={styles.meta}>
        {a.company && <span>{a.company}</span>}
        {a.status && <span>{a.status}</span>}
        {a.jurisdiction && <span>{a.jurisdiction}</span>}
        {a.parent_asset_no && <span>Part of {a.parent_asset_no}</span>}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className={`${styles.card} ${styles.tile}`}><div className={styles.tileLabel}>{label}</div><div className={styles.tileValue}>{value}</div></div>;
}

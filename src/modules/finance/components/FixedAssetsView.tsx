"use client";

// The Fixed assets page (CFO design, 18 Nov 2026, mock-up v5). One page for
// every register the client keeps, a month at a time:
//   close strip      where the month stands, and what waits on you
//   register pills   All registers, each register, and the ones Xero keeps
//   company pills    All, or one company
//   tabs             Roll-forward, Tie to Xero, Assets, Activity
// Every figure in the roll-forward opens what makes it up, and every account
// and asset opens below the table with its lines and its thread. Threads are
// shared with the reconciliation and the Close page; entries are permanent.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./FixedAssetsView.module.css";
import page from "./Page.module.css";
import {
  STATUS_TONE, accountSubject, addRolls, chargedInXero, dayName, fig, lineWhat, monthEndName, monthName, passes, roll, xeroRoll,
  type ActivityFilter, type Schedule, type ScheduleAccount, type ScheduleAsset, type ScheduleGrouping, type ScheduleLine, type ThreadEntry,
} from "@/modules/finance/lib/asset-schedule";
import type { WaitingLine } from "@/modules/finance/lib/asset-register";
import { reopenable, signable, type RegisterPeriod } from "@/modules/finance/lib/asset-register";
import { MonthActions, WaitingLineCard } from "./AssetRegisterActions";
import { Entry, Thread, type Me } from "./Threads";

type View = "rf" | "tie" | "as" | "act";
type Panel =
  | { type: "lines"; title: string; ids: string[]; monthOnly: boolean }
  | { type: "list"; title: string; metric: "cost_bf" | "charge" | "nbv_cf"; ids: string[] }
  | { type: "asset"; id: string }
  | { type: "account"; key: string };


export default function FixedAssetsView({ slug, schedule, threads, threadsError, waiting, me, xeroTab }: {
  slug: string; schedule: Schedule; threads: ThreadEntry[]; threadsError: string | null; waiting: WaitingLine[]; me: Me; xeroTab: ReactNode;
}) {
  const router = useRouter();
  const period = schedule.period!;
  const [tab, setTab] = useState<string>("all");
  const [co, setCo] = useState<string>("all");
  const [view, setView] = useState<View>("rf");
  const [stack, setStack] = useState<Panel[]>([]);
  const [scope, setScope] = useState<"month" | "all">("month");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollNext = useRef(false);
  const panel = stack[stack.length - 1] ?? null;
  const open = (p: Panel) => { setStack((s) => [...s, p]); setScope("month"); scrollNext.current = true; };
  useEffect(() => {
    if (scrollNext.current && panelRef.current) { scrollNext.current = false; panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }, [stack]);

  const groups = schedule.groupings.filter((g) => g.assets.length || g.accounts.length);
  const shown = tab === "all" ? groups : groups.filter((g) => g.grouping === tab);
  const companies = useMemo(() => [...new Set(groups.flatMap((g) => [...g.assets.map((a) => a.company), ...g.accounts.map((a) => a.company)]))].filter(Boolean).sort(), [groups]);
  const inCo = (c: string) => co === "all" || c === co;
  const allAssets = groups.flatMap((g) => g.assets.map((a) => ({ ...a, group: g })));
  const assets = shown.flatMap((g) => g.assets.filter((a) => inCo(a.company)).map((a) => ({ ...a, group: g })));
  const accounts = shown.flatMap((g) => g.accounts.filter((a) => inCo(a.company)).map((a) => ({ ...a, group: g })));
  const allLines = groups.flatMap((g) => g.lines);
  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  // Accounts Xero amortises itself: its charge is on the account, not against
  // each asset, so the roll-forward carries it as its own row and the total
  // ties to the ledger.
  const xeroAccounts = accounts.filter(chargedInXero);
  const total = addRolls(roll(assets), xeroRoll(xeroAccounts));

  // Threads: by subject, for the panels and the counts.
  const bySubject = new Map<string, ThreadEntry[]>();
  for (const e of threads) bySubject.set(`${e.subject_kind}|${e.subject_key}`, [...(bySubject.get(`${e.subject_kind}|${e.subject_key}`) ?? []), e]);
  const threadOf = (kind: string, key: string | null) => (key ? bySubject.get(`${kind}|${key}`) ?? [] : []);
  const openCount = threads.filter((e) => e.open).length + waiting.length;
  const subjectLabel = (e: ThreadEntry) => {
    if (e.subject_kind === "asset") { const a = assetById.get(e.subject_key); return a ? `${a.asset_no} ${a.name}` : "An asset"; }
    if (e.subject_kind === "account") { const a = allAccounts().find((x) => accountSubject(x) === e.subject_key); return a ? `${a.code} ${a.name} (${a.company})` : "An account"; }
    if (e.subject_kind === "register_month") return `${groups.find((g) => g.grouping === e.subject_key)?.name ?? "Register"}, ${monthName(e.period ?? period)}`;
    return "Thread";
  };
  function allAccounts() { return groups.flatMap((g) => g.accounts); }
  const openSubject = (e: ThreadEntry) => {
    if (e.subject_kind === "asset") open({ type: "asset", id: e.subject_key });
    else if (e.subject_kind === "account") open({ type: "account", key: e.subject_key });
  };

  // The close strip: each register's month.
  const months = groups.map((g) => g.month);
  const allSigned = months.length > 0 && months.every((m) => m?.status === "signed");
  const signer = groups.map((g) => g.month?.signed_by).find(Boolean);

  // Roll-forward rows: registers in "All registers"; accounts inside a register.
  const rfRows = tab === "all"
    ? shown.map((g) => ({ key: g.grouping, label: g.name, sub: "", company: co === "all" ? "" : co, xs: g.assets.filter((a) => inCo(a.company)), onLabel: () => setTab(g.grouping) }))
      .filter((r) => r.xs.length)
    : (() => {
      const by = new Map<string, ScheduleAsset[]>();
      for (const a of assets) { const k = `${a.company}|${a.account ?? ""}`; by.set(k, [...(by.get(k) ?? []), a]); }
      return [...by.entries()].sort((x, y) => (x[0].split("|")[1] + x[0]).localeCompare(y[0].split("|")[1] + y[0])).map(([k, xs]) => {
        const [company, code] = k.split("|");
        const acc = accounts.find((a) => a.company === company && a.code === code);
        return { key: k, label: code, sub: acc?.name ?? "", company, xs, onLabel: () => acc && accountSubject(acc) && open({ type: "account", key: accountSubject(acc)! }) };
      });
    })();
  const xeroRows = tab === "all"
    ? shown.map((g) => ({ key: `x-${g.grouping}`, label: "Charged in Xero", sub: g.name, company: co === "all" ? "" : co,
      r: xeroRoll(g.accounts.filter((a) => chargedInXero(a) && inCo(a.company))), n: g.accounts.filter((a) => chargedInXero(a) && inCo(a.company)).length, key2: null as string | null }))
      .filter((x) => x.n)
    : xeroAccounts.map((a) => ({ key: `x-${a.company}-${a.code}`, label: a.code ?? "", sub: `${a.name}, charged in Xero`, company: a.company, r: xeroRoll([a]), n: 1, key2: accountSubject(a) }));
  const reg = accounts.reduce((s, a) => s + a.register, 0);
  const recDiff = Math.round((reg - total.nbv_cf) * 100) / 100;

  return (
    <div className={styles.wrap}>
      <section className={`${styles.card} ${styles.strip}`} aria-label={`${monthName(period)} close`}>
        <label className={styles.month}><span className={styles.sub}>Month</span>
          <select value={period} onChange={(e) => router.push(`?period=${e.target.value}`)} aria-label="Month">
            {schedule.months.slice().reverse().map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        {groups.map((g) => (
          <span key={g.grouping} className={styles.stripItem} title={g.month?.signed_by ? `Signed by ${g.month.signed_by.name} on ${dayName(g.month.signed_at)}` : undefined}>
            <span className={`${page.status} ${page[g.month?.status === "signed" ? "s-green" : g.month?.status === "prepared" ? "s-amber" : "s-neutral"]}`}><span className={page.dot} />{g.month?.status === "signed" ? "Signed" : g.month?.status === "prepared" ? "Prepared" : "Not prepared"}</span>
            <span>{g.name}</span>
          </span>
        ))}
        {openCount > 0 && (
          <button type="button" className={`${page.status} ${page["s-amber"]} ${styles.pillBtn}`} onClick={() => { setView("act"); setFilter("open"); }}>
            <span className={page.dot} />{openCount} need{openCount === 1 ? "s" : ""} your decision
          </button>
        )}
        {allSigned && signer && <span className={styles.signed} title={signer.name}>All signed by {signer.initials ?? signer.name}</span>}
      </section>

      {tab !== "all" && tab !== "xero" && (() => {
        const g = groups.find((x) => x.grouping === tab);
        if (!g) return null;
        const ps = g.months.map((m) => ({ period: m.period, status: m.status } as RegisterPeriod));
        const canSign = signable(ps) === period, canReopen = reopenable(ps) === period;
        return canSign || canReopen ? (
          <section className={`${styles.card} ${styles.pad}`} aria-label={`${g.name}, ${monthName(period)}`}>
            <span className={styles.sub}>{g.name}, {monthName(period)}: {g.month?.status === "signed" ? `signed${g.month.signed_by ? ` by ${g.month.signed_by.initials ?? g.month.signed_by.name}` : ""}` : "prepared and tied, ready to sign"}.</span>
            <MonthActions slug={slug} grouping={g.grouping} period={period} monthLabel={monthName(period)} canSign={canSign} canReopen={canReopen} />
          </section>
        ) : null;
      })()}

      <div className={styles.filters}>
        <div role="group" aria-label="Register" className={`seg ${styles.pills}`}>
          {[{ key: "all", name: "All registers", hint: undefined as string | undefined }, ...groups.map((g) => ({ key: g.grouping, name: g.name, hint: g.catalogue_name && g.catalogue_name !== g.name ? g.catalogue_name : undefined })), { key: "xero", name: "Kept by Xero", hint: undefined }].map((t) => (
            <button key={t.key} type="button" className={t.key === tab ? "seg-on" : undefined} aria-pressed={t.key === tab} title={t.hint}
              onClick={() => { setTab(t.key); setStack([]); }}>{t.name}</button>
          ))}
        </div>
        {tab !== "xero" && companies.length > 1 && (
          <div role="group" aria-label="Company" className={styles.cos}>
            <span className={styles.sub}>Company</span>
            {["all", ...companies].map((c) => (
              <button key={c} type="button" className={`${styles.chip} ${c === co ? styles.chipOn : ""}`} aria-pressed={c === co} onClick={() => { setCo(c); setStack([]); }}>{c === "all" ? "All" : c}</button>
            ))}
          </div>
        )}
      </div>

      {tab === "xero" ? xeroTab : (
        <>
          <div role="tablist" aria-label="View" className={styles.tabs}>
            {([["rf", "Roll-forward"], ["tie", "Tie to Xero"], ["as", `Assets (${assets.length})`], ["act", `Activity${openCount ? ` (${openCount} need you)` : ""}`]] as Array<[View, string]>).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={k === view} className={`${styles.tab} ${k === view ? styles.tabOn : ""}`} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>

          {view === "rf" && (
            <section className={styles.card} aria-label="Roll-forward">
              <p className={styles.intro}>Cost and WIP, accumulated amortisation and impairment, and net book value for {monthName(period)}. Select a figure to see what makes it up, or an account to open it.</p>
              <div className={styles.scroll}>
                <div className={`${styles.tr} ${styles.th} ${styles.rf}`}><span>{tab === "all" ? "Register" : "Account"}</span><span>Co.</span>
                  <span className={styles.r}>Cost b/f</span><span className={styles.r}>Additions</span><span className={styles.r}>Cost c/f</span>
                  <span className={styles.r}>Acc. b/f</span><span className={styles.r}>Charge</span><span className={styles.r}>Acc. c/f</span>
                  <span className={styles.r}>NBV b/f</span><span className={styles.r}>NBV c/f</span></div>
                {rfRows.map((row) => {
                  const r = roll(row.xs);
                  const ids = row.xs.map((a) => a.id);
                  const t = tab === "all" ? row.label : `${row.label} ${row.sub} (${row.company})`;
                  return (
                    <div key={row.key} className={`${styles.tr} ${styles.rf}`}>
                      <span><button type="button" className={styles.lnk} onClick={row.onLabel}>{row.label}</button> <span className={styles.sub}>{row.sub}</span></span>
                      <span>{row.company}</span>
                      <span className={styles.r}><button type="button" className={styles.num} onClick={() => open({ type: "list", title: `Cost b/f, ${t}`, metric: "cost_bf", ids })}>{fig(r.cost_bf)}</button></span>
                      <span className={styles.r}><button type="button" className={styles.num} onClick={() => open({ type: "lines", title: `${monthName(period)} additions, ${t}`, ids, monthOnly: true })}>{fig(r.additions)}</button></span>
                      <span className={styles.r}>{fig(r.cost_cf)}</span>
                      <span className={styles.r}>{fig(r.accumulated_bf)}</span>
                      <span className={styles.r}><button type="button" className={styles.num} onClick={() => open({ type: "list", title: `${monthName(period)} charge, ${t}`, metric: "charge", ids })}>{fig(r.charge)}</button></span>
                      <span className={styles.r}>{fig(r.accumulated_cf)}</span>
                      <span className={styles.r}>{fig(r.nbv_bf)}</span>
                      <span className={`${styles.r} ${styles.strong}`}><button type="button" className={styles.num} onClick={() => open({ type: "list", title: `NBV c/f, ${t}`, metric: "nbv_cf", ids })}>{fig(r.nbv_cf)}</button></span>
                    </div>
                  );
                })}
                {xeroRows.map((x) => (
                  <div key={x.key} className={`${styles.tr} ${styles.rf}`}>
                    <span><button type="button" className={styles.lnk} onClick={() => (x.key2 ? open({ type: "account", key: x.key2 }) : setView("tie"))}>{x.label}</button> <span className={styles.sub}>{x.sub}</span></span>
                    <span>{x.company}</span>
                    <span className={styles.r}>-</span><span className={styles.r}>-</span><span className={styles.r}>-</span>
                    <span className={styles.r}>{fig(x.r.accumulated_bf)}</span>
                    <span className={styles.r}><button type="button" className={styles.num} onClick={() => (x.key2 ? open({ type: "account", key: x.key2 }) : setView("tie"))}>{fig(x.r.charge)}</button></span>
                    <span className={styles.r}>{fig(x.r.accumulated_cf)}</span>
                    <span className={styles.r}>{fig(x.r.nbv_bf)}</span><span className={styles.r}>{fig(x.r.nbv_cf)}</span>
                  </div>
                ))}
                <div className={`${styles.tr} ${styles.tt} ${styles.rf}`}><span>Total</span><span />
                  <span className={styles.r}>{fig(total.cost_bf)}</span><span className={styles.r}>{fig(total.additions)}</span><span className={styles.r}>{fig(total.cost_cf)}</span>
                  <span className={styles.r}>{fig(total.accumulated_bf)}</span><span className={styles.r}>{fig(total.charge)}</span><span className={styles.r}>{fig(total.accumulated_cf)}</span>
                  <span className={styles.r}>{fig(total.nbv_bf)}</span><span className={styles.r}>{fig(total.nbv_cf)}</span></div>
              </div>
              {accounts.some((a) => a.amortised_by === "xero") && (
                <p className={styles.foot}>Where Xero amortises an account itself, it charges the account, not each asset. That charge is the &ldquo;Charged in Xero&rdquo; row, so the total ties to Xero.</p>
              )}
            </section>
          )}

          {view === "tie" && (
            <section className={styles.card} aria-label="Tie to Xero">
              <p className={styles.intro}>Each account at {monthEndName(period)}. The signed register is the reconciliation&apos;s evidence for these accounts. Select one for its assets, its lines and its thread.</p>
              <div className={styles.scroll}>
                <div className={`${styles.tr} ${styles.th} ${styles.tie}`}><span>Account</span><span>Co.</span><span className={styles.r}>Register</span><span className={styles.r}>Xero</span><span className={styles.r}>Difference</span><span>Explained by</span><span>Ties</span></div>
                {accounts.filter((a) => a.register !== 0 || a.ledger !== 0).map((a) => {
                  const key = accountSubject(a);
                  const n = threadOf("account", key).length;
                  return (
                    <button key={`${a.company}${a.code}`} type="button" className={`${styles.tr} ${styles.tie} ${styles.rowBtn}`} onClick={() => key && open({ type: "account", key })}>
                      <span><b className={styles.strong}>{a.code}</b> {a.name}{a.xero_charge_in_month ? <span className={styles.sub}> · {fig(a.xero_charge_in_month)} charged in Xero this month</span> : null}</span>
                      <span>{a.company}</span><span className={styles.r}>{fig(a.register)}</span><span className={styles.r}>{fig(a.ledger)}</span><span className={styles.r}>{fig(a.difference)}</span>
                      <span className={styles.sub}>{a.named_items.length ? a.named_items.map((x) => `${fig(x.amount)} ${x.label}`).join("; ") : "Nothing to explain"}{n ? ` · ${n} in thread` : ""}</span>
                      <span><span className={`${page.status} ${page[a.ties ? "s-green" : "s-red"]}`}><span className={page.dot} />{a.ties ? "Ties" : "Differs"}</span></span>
                    </button>
                  );
                })}
              </div>
              {Math.abs(recDiff) >= 0.005 && (
                <p className={styles.foot}>The roll-forward&apos;s net book value {fig(total.nbv_cf)} and the register on the ledger {fig(reg)} differ by {fig(recDiff)}.</p>
              )}
            </section>
          )}

          {view === "as" && (
            <section className={styles.card} aria-label="Assets">
              <p className={styles.intro}>{assets.length} assets. Select one to see each invoice behind its cost and its thread.</p>
              <div className={styles.scroll}>
                <div className={`${styles.tr} ${styles.th} ${styles.as}`}><span>Asset</span><span>Name</span><span>Co.</span><span>Status</span><span className={styles.r}>Cost c/f</span><span className={styles.r}>Additions</span><span className={styles.r}>Acc. c/f</span><span className={styles.r}>NBV c/f</span></div>
                {assets.map((a) => (
                  <button key={a.id} type="button" className={`${styles.tr} ${styles.as} ${styles.rowBtn} ${panel?.type === "asset" && panel.id === a.id ? styles.picked : ""}`} onClick={() => open({ type: "asset", id: a.id })}>
                    <b className={styles.strong}>{a.asset_no}</b><span>{a.name}</span><span>{a.company}</span>
                    <span><span className={`${page.status} ${page[STATUS_TONE[a.status] ?? "s-neutral"]}`}>{a.status}</span></span>
                    <span className={styles.r}>{fig(a.cost_cf)}</span><span className={styles.r}>{fig(a.additions)}</span><span className={styles.r}>{fig(a.accumulated_cf)}</span><span className={`${styles.r} ${styles.strong}`}>{fig(a.nbv_cf)}</span>
                  </button>
                ))}
                <div className={`${styles.tr} ${styles.tt} ${styles.as}`}><span>Total</span><span /><span /><span />
                  <span className={styles.r}>{fig(total.cost_cf)}</span><span className={styles.r}>{fig(total.additions)}</span><span className={styles.r}>{fig(total.accumulated_cf)}</span><span className={styles.r}>{fig(total.nbv_cf)}</span></div>
              </div>
              <p className={styles.foot}>{shown.reduce((s, g) => s + g.expensed.count, 0)} lines on these registers were expensed, not capitalised ({fig(shown.reduce((s, g) => s + g.expensed.total, 0))}): research, admin and maintenance. They stay on the record with their reasons.</p>
            </section>
          )}

          {view === "act" && (
            <section className={`${styles.card} ${styles.pad}`} aria-label="Activity">
              <p className={styles.sub}>What people and agents have said and decided on these registers. The same entries show on the account&apos;s reconciliation and the asset. Entries are permanent: a correction is a further entry.</p>
              {waiting.length > 0 && (
                <div className={styles.waiting}>
                  <h2 className={styles.h2}>Lines waiting for your decision <span className={styles.count}>{waiting.length}</span></h2>
                  {waiting.map((l) => <WaitingLineCard key={l.id} slug={slug} line={l}
                    assets={allAssets.filter((a) => a.group.grouping === l.grouping && !["impaired", "disposed", "lapsed"].includes(a.status)).map((a) => ({ asset_no: a.asset_no, label: `${a.asset_no} ${a.name}` }))} />)}
                </div>
              )}
              <div role="group" aria-label="Show" className={styles.cos}>
                {([["all", "All"], ["open", `Needs your decision (${threads.filter((e) => e.open).length})`], ["decisions", "Decisions made"], ["questions", "Questions"], ["holds", "Holds"], ["agents", "From agents"]] as Array<[ActivityFilter, string]>).map(([k, l]) => (
                  <button key={k} type="button" className={`${styles.chip} ${k === filter ? styles.chipOn : ""}`} aria-pressed={k === filter} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              {threadsError && <p className={page.error} role="alert">Could not load the threads: {threadsError}</p>}
              {threads.filter((e) => passes(e, filter)).length === 0 && <p className={styles.sub}>Nothing here yet. Notes, questions and decisions on any account or asset show here.</p>}
              {threads.filter((e) => passes(e, filter)).map((e) => (
                <Entry key={e.id} slug={slug} e={e} me={me} subject={subjectLabel(e)} onSubject={() => openSubject(e)} />
              ))}
            </section>
          )}

          {panel && (
            <aside ref={panelRef} className={`${styles.card} ${styles.panel}`} aria-label="Detail">
              <PanelBody slug={slug} panel={panel} period={period} me={me} scope={scope} setScope={setScope}
                assetById={assetById} accounts={allAccounts()} groups={groups} lines={allLines} threadOf={threadOf}
                open={open} back={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : null} close={() => setStack([])} />
            </aside>
          )}
        </>
      )}
    </div>
  );
}

type AssetWithGroup = ScheduleAsset & { group: ScheduleGrouping };

function PanelBody({ slug, panel, period, me, scope, setScope, assetById, accounts, groups, lines, threadOf, open, back, close }: {
  slug: string; panel: Panel; period: string; me: Me; scope: "month" | "all"; setScope: (s: "month" | "all") => void;
  assetById: Map<string, AssetWithGroup>; accounts: ScheduleAccount[]; groups: ScheduleGrouping[]; lines: ScheduleLine[];
  threadOf: (kind: string, key: string | null) => ThreadEntry[]; open: (p: Panel) => void; back: (() => void) | null; close: () => void;
}) {
  const head = (kicker: string, title: string, sub: string) => (
    <div className={styles.panelHead}>
      <div className={styles.min}><div className={styles.sub}>{kicker}</div><h2 className={styles.h2Big}>{title}</h2>{sub && <div className={styles.sub}>{sub}</div>}</div>
      <div className={styles.buttons}>{back && <button type="button" className="btn-secondary" onClick={back}>Back</button>}<button type="button" className="btn-secondary" onClick={close}>Close</button></div>
    </div>
  );
  const linesOf = (ids: string[], monthOnly: boolean) => lines.filter((l) => ids.includes(l.asset_id) && (!monthOnly || l.period === period)).sort((x, y) => (x.date < y.date ? 1 : -1));
  const accountKey = (a: ScheduleAsset) => { const acc = accounts.find((x) => x.company === a.company && x.code === a.account); return acc ? accountSubject(acc) : null; };

  if (panel.type === "lines") {
    const ls = linesOf(panel.ids, true);
    return (<>{head("Roll-forward", panel.title, `${ls.length} lines taken in from Xero and approved, each against its asset`)}
      <div className={styles.panelBody}><Lines ls={ls} assetById={assetById} open={open} /></div></>);
  }
  if (panel.type === "list") {
    const f = (a: ScheduleAsset) => (panel.metric === "charge" ? a.charge + a.impairment + a.other : a[panel.metric]);
    const xs = panel.ids.map((id) => assetById.get(id)!).filter((a) => a && Math.abs(f(a)) >= 0.005);
    return (<>{head("Roll-forward", panel.title, `${xs.length} assets`)}
      <div className={styles.panelBody}>
        <div className={styles.box}>
          {xs.map((a) => (
            <button key={a.id} type="button" className={`${styles.tr} ${styles.lr} ${styles.rowBtn}`} onClick={() => open({ type: "asset", id: a.id })}>
              <span><b className={styles.strong}>{a.asset_no}</b> <span className={styles.sub}>{a.name}</span></span><span className={styles.r}>{fig(f(a))}</span>
            </button>
          ))}
          <div className={`${styles.tr} ${styles.tt} ${styles.lr}`}><span>Total</span><span className={styles.r}>{fig(xs.reduce((s, a) => s + f(a), 0))}</span></div>
        </div>
      </div></>);
  }
  if (panel.type === "asset") {
    const a = assetById.get(panel.id);
    if (!a) return head("Asset", "Not in this register", "");
    const key = accountKey(a);
    const ls = linesOf([a.id], false);
    const amort = a.status === "pending" ? "Pending: capitalised, not amortised until registration; impaired if refused."
      : a.status === "wip" ? "Work in progress: not amortised until available for use."
      : a.status === "impaired" ? "Written off in full."
      : a.charge ? `${monthName(period)} charge ${fig(a.charge)}.` : "Amortised in Xero's fixed asset register on the account; see the account's tie.";
    return (<>{head(a.group.name, `${a.asset_no} ${a.name}`, [a.company, a.status, a.jurisdiction, a.parent_asset_no ? `part of ${a.parent_asset_no}` : null].filter(Boolean).join(" · "))}
      <div className={styles.panelBody}>
        <div className={styles.kpis}>
          {[["Cost c/f", a.cost_cf], [`Added in ${monthName(period)}`, a.additions], ["Accumulated c/f", a.accumulated_cf], ["NBV c/f", a.nbv_cf]].map(([l, v]) => (
            <div key={String(l)} className={styles.kpi}><div className={styles.sub}>{l}</div><div className={styles.kpiValue}>{fig(v as number)}</div></div>
          ))}
        </div>
        <p className={styles.note}>{amort}</p>
        <div className={styles.cos}>
          {key && <button type="button" className={styles.chip} onClick={() => open({ type: "account", key })}>Account {a.account} ({a.company})</button>}
          {a.parent_asset_no && [...assetById.values()].find((x) => x.asset_no === a.parent_asset_no) && (
            <button type="button" className={styles.chip} onClick={() => open({ type: "asset", id: [...assetById.values()].find((x) => x.asset_no === a.parent_asset_no)!.id })}>Part of {a.parent_asset_no}</button>
          )}
        </div>
        <h3 className={styles.h3}>Each invoice and journal behind its cost <span className={styles.count}>{ls.length}</span></h3>
        <Lines ls={ls} assetById={assetById} open={open} />
        <Thread slug={slug} me={me} title="Thread" entries={[...threadOf("asset", a.id), ...threadOf("account", key)]} subject={{ subject_kind: "asset", subject_key: a.id, period: null }} />
      </div></>);
  }
  const acc = accounts.find((x) => accountSubject(x) === panel.key);
  if (!acc) return head("Account", "Not in this register", "");
  const g = groups.find((x) => x.accounts.includes(acc));
  const xs = [...assetById.values()].filter((a) => a.company === acc.company && a.account === acc.code);
  const all = linesOf(xs.map((a) => a.id), false);
  const ls = scope === "month" ? all.filter((l) => l.period === period) : all;
  const entries = [...threadOf("account", panel.key), ...xs.flatMap((a) => threadOf("asset", a.id))];
  return (<>{head(`Account at ${monthEndName(period)} · ${acc.company}`, `${acc.code} ${acc.name}`, g?.name ?? "")}
    <div className={styles.panelBody}>
      <div className={styles.kpis}>
        {[["Register", acc.register], ["Xero", acc.ledger], ["Difference", acc.difference], ["Unexplained", acc.unexplained]].map(([l, v]) => (
          <div key={String(l)} className={styles.kpi}><div className={styles.sub}>{l}</div><div className={styles.kpiValue}>{fig(v as number)}</div></div>
        ))}
      </div>
      <p className={styles.note}>
        {acc.named_items.length ? `Explained by: ${acc.named_items.map((n) => `${fig(n.amount)} ${n.label}`).join("; ")}. ` : "Nothing to explain. "}
        {acc.xero_charge_in_month ? `${fig(acc.xero_charge_in_month)} charged in Xero's fixed asset register in ${monthName(period)}. ` : ""}
        {g?.month?.status === "signed" ? "The signed register is this account's reconciliation evidence." : "Once the month is signed, the register is this account's reconciliation evidence."}
      </p>
      {xs.length > 0 && (<>
        <h3 className={styles.h3}>Assets on this account <span className={styles.count}>{xs.length}</span></h3>
        <div className={styles.box}>
          {xs.map((a) => (
            <button key={a.id} type="button" className={`${styles.tr} ${styles.lr} ${styles.rowBtn}`} onClick={() => open({ type: "asset", id: a.id })}>
              <span><b className={styles.strong}>{a.asset_no}</b> <span className={styles.sub}>{a.name}</span></span><span className={styles.r}>{fig(a.cost_cf)}</span>
            </button>
          ))}
        </div>
        <div className={styles.rowHead}>
          <h3 className={styles.h3}>Lines on this account</h3>
          <span className={styles.buttons}>
            {([["month", monthName(period)], ["all", `All (${all.length})`]] as Array<["month" | "all", string]>).map(([k, l]) => (
              <button key={k} type="button" className={`${styles.chip} ${scope === k ? styles.chipOn : ""}`} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
            ))}
          </span>
        </div>
        <Lines ls={ls} assetById={assetById} open={open} />
      </>)}
      <Thread slug={slug} me={me} title="Thread" entries={entries} subject={{ subject_kind: "account", subject_key: panel.key, period }} />
    </div></>);
}

function Lines({ ls, assetById, open }: { ls: ScheduleLine[]; assetById: Map<string, AssetWithGroup>; open: (p: Panel) => void }) {
  if (!ls.length) return <p className={styles.sub}>No lines.</p>;
  return (
    <div className={`${styles.box} ${styles.scroll}`}>
      <div className={`${styles.tr} ${styles.th} ${styles.ln}`}><span>Date</span><span>Asset</span><span>Supplier</span><span>Invoice</span><span>What it&apos;s for</span><span className={styles.r}>Amount</span></div>
      {ls.map((l) => {
        const a = assetById.get(l.asset_id);
        return (
          <div key={l.id} className={`${styles.tr} ${styles.ln}`} title={l.reason ?? undefined}>
            <span>{l.date}</span>
            <span>{a ? <><button type="button" className={styles.lnk} onClick={() => open({ type: "asset", id: a.id })}><b>{a.asset_no}</b></button><br /><span className={styles.sub}>{a.name}</span></> : "-"}</span>
            <span>{l.supplier ?? (l.source_type === "manual_journal" ? "Journal" : "-")}</span><span>{l.invoice_no ?? "-"}</span>
            <span className={styles.what}>{lineWhat(l)}</span><span className={styles.r}>{fig(l.amount)}</span>
          </div>
        );
      })}
      <div className={`${styles.tr} ${styles.tt} ${styles.ln}`}><span>Total</span><span /><span /><span /><span className={styles.sub}>{ls.length} lines</span><span className={styles.r}>{fig(ls.reduce((s, l) => s + l.amount, 0))}</span></div>
    </div>
  );
}

// Finance Overview: where every client is, on one page (redesign step 2, 27 Oct
// 2026). What needs the CFO, what is blocked or overdue, each client's Bills,
// approvals, open items, last agent run and last pack, and recent agent work.
// Every number links to the page that holds it. Read-only.

import Link from "next/link";
import { fetchFinanceOverview, type FinanceOverview, type FinanceOverviewClient } from "@/modules/finance/lib/api";
import styles from "@/modules/finance/components/FinanceOverview.module.css";

export const dynamic = "force-dynamic";

const AGENT_INITIALS: Record<string, string> = { "ap-clerk": "AP", "ar-clerk": "AR", fm1: "F1", fm2: "F2", fc: "FC", fpa: "PA" };
const AGENT_NAMES: Record<string, string> = {
  "ap-clerk": "AP Clerk", "ar-clerk": "AR Clerk", fm1: "FM1", fm2: "FM2 review", fc: "Financial Controller", fpa: "FP&A",
};

// "today 14:05", "yesterday 09:12", else "21 Oct".
function when(iso: string | null | undefined, today: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  if (day === today) return `today ${time}`;
  const y = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  if (day === y) return `yesterday ${time}`;
  return d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
}

function period(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

function greeting(): string {
  const h = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Count({ n, href, warn }: { n: number; href: string; warn?: boolean }) {
  if (!n) return <span className={`${styles.num} ${styles.zero}`}>0</span>;
  return <Link href={href} className={`${styles.num} ${warn ? styles.warn : ""}`} style={{ fontWeight: 600 }}>{n}</Link>;
}

function PackStatus({ c }: { c: FinanceOverviewClient }) {
  if (!c.pack) return <span className={`${styles.status} ${styles.sNone}`}><span className={styles.dot} />None yet</span>;
  const cls = c.pack.status === "succeeded" ? styles.sDone : c.pack.status === "failed" ? styles.sBlocked
    : c.pack.status === "queued" || c.pack.status === "running" ? styles.sProgress : styles.sNone;
  const label = c.pack.status === "succeeded" ? period(c.pack.period) : `${period(c.pack.period)}: ${c.pack.status}`;
  return <span className={`${styles.status} ${cls}`}><span className={styles.dot} />{label}</span>;
}

export default async function OverviewPage() {
  let o: FinanceOverview;
  try {
    o = await fetchFinanceOverview();
  } catch (e) {
    return (
      <div className={styles.error} role="alert">
        The overview could not be loaded: {e instanceof Error ? e.message : "finance service unavailable"}.
      </div>
    );
  }
  const dateLine = new Date(`${o.today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const firstFor = (pick: (c: FinanceOverviewClient) => number, seg: string) => {
    const c = o.clients.find((x) => pick(x) > 0);
    return c ? `/finance/clients/${c.slug}/${seg}` : "/finance/clients";
  };

  return (
    <div>
      <div className={styles.head}>
        <div>
          <h1>{greeting()}</h1>
          <p className={styles.sub}>{dateLine} · {o.clients.length} client{o.clients.length === 1 ? "" : "s"}</p>
        </div>
        <Link href="/finance/clients" className="btn-secondary">All clients</Link>
      </div>

      <div className={styles.kpis}>
        <Link href={firstFor((c) => c.bills.for_you + c.approvals.awaiting, o.totals.bills_for_you ? "bills" : "approvals")} className={styles.kpi}>
          <span className={styles.kpiLabel}>Needs your decision</span>
          <span className={styles.kpiValue}>{o.totals.needs_you}</span>
          <span className={styles.kpiHint}>{o.totals.bills_for_you} bill{o.totals.bills_for_you === 1 ? "" : "s"} · {o.totals.approvals_awaiting} approval{o.totals.approvals_awaiting === 1 ? "" : "s"}</span>
        </Link>
        <a href="#blocked" className={styles.kpi}>
          <span className={styles.kpiLabel}>Blocked or overdue</span>
          <span className={`${styles.kpiValue} ${o.totals.blocked ? styles.warn : ""}`}>{o.totals.blocked}</span>
          <span className={styles.kpiHint}>{o.totals.blocked ? "listed below" : "nothing stuck"}</span>
        </a>
        <Link href={firstFor((c) => c.bills.ready, "bills")} className={styles.kpi}>
          <span className={styles.kpiLabel}>Bills ready to send</span>
          <span className={styles.kpiValue}>{o.totals.ready_to_send}</span>
          <span className={styles.kpiHint}>clean or approved</span>
        </Link>
        <a href="#activity" className={styles.kpi}>
          <span className={styles.kpiLabel}>Agents working</span>
          <span className={styles.kpiValue}>{o.totals.agents_in_flight}</span>
          <span className={styles.kpiHint}>queued or running now</span>
        </a>
      </div>

      <section className={styles.card} aria-labelledby="where">
        <div className={styles.cardHead}><h2 id="where">Where are we</h2></div>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Bills for you</th>
                <th scope="col">Ready to send</th>
                <th scope="col">Approvals</th>
                <th scope="col">Work</th>
                <th scope="col">Last pack</th>
                <th scope="col">Last agent run</th>
              </tr>
            </thead>
            <tbody>
              {o.clients.map((c) => {
                const base = `/finance/clients/${c.slug}`;
                return (
                  <tr key={c.slug}>
                    <td>
                      <Link href={`${base}/bills`} className={styles.clientName}>{c.name}</Link>
                      <div className={styles.muted}>{c.entities} compan{c.entities === 1 ? "y" : "ies"}</div>
                    </td>
                    <td><Count n={c.bills.for_you} href={`${base}/bills`} warn /></td>
                    <td><Count n={c.bills.ready} href={`${base}/bills?tab=clean`} /></td>
                    <td>
                      <Count n={c.approvals.awaiting} href={`${base}/approvals`} />
                      {c.approvals.blocked > 0 && <span className={styles.muted}> · {c.approvals.blocked} blocked</span>}
                    </td>
                    <td>
                      <Count n={c.work.open} href={`${base}/work`} />
                      {(c.work.blocked + c.work.waiting > 0 || c.work.overdue > 0) && (
                        <span className={styles.muted}>
                          {c.work.blocked + c.work.waiting > 0 ? ` · ${c.work.blocked + c.work.waiting} held up` : ""}{c.work.overdue > 0 ? ` · ${c.work.overdue} overdue` : ""}
                        </span>
                      )}
                    </td>
                    <td><PackStatus c={c} /></td>
                    <td className={styles.muted}>
                      {c.agents.last ? `${AGENT_NAMES[c.agents.last.agent ?? ""] ?? "Agent"} · ${when(c.agents.last.at, o.today)}` : "None in 30 days"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.grid2}>
        <section className={styles.card} aria-labelledby="blocked" id="blocked">
          <div className={styles.cardHead}><h2 id="blocked-h">Blocked and overdue</h2><span className={styles.muted}>oldest first</span></div>
          {o.blocked.length === 0 && <div className={styles.empty}>Nothing is blocked or overdue.</div>}
          {o.blocked.map((b, i) => (
            <Link key={`${b.slug}-${i}`} href={b.href} className={styles.row}>
              <span className={`${styles.status} ${b.kind === "waiting" ? styles.sWaiting : styles.sBlocked}`} style={{ flex: "0 0 auto" }}>
                <span className={styles.dot} />{b.kind === "overdue" ? "Overdue" : b.kind === "blocked" ? "Blocked" : "Waiting"}
              </span>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>{b.title}</div>
                <div className={styles.why}>{b.client} · {b.why}</div>
              </div>
            </Link>
          ))}
        </section>

        <section className={styles.card} aria-labelledby="activity-h" id="activity">
          <div className={styles.cardHead}><h2 id="activity-h">Agent activity</h2></div>
          {o.activity.length === 0 && <div className={styles.empty}>No agent runs in the last 30 days.</div>}
          {o.activity.map((a) => (
            <Link key={a.id} href={`/finance/clients/${a.slug}/agents`} className={styles.row}>
              <span className={styles.ava} aria-hidden="true">{AGENT_INITIALS[a.agent ?? ""] ?? "AI"}</span>
              <div className={styles.rowBody}>
                <div><span className={styles.rowTitle}>{AGENT_NAMES[a.agent ?? ""] ?? "Agent"}</span> <span className={styles.muted}>· {a.client} · {when(a.at, o.today)}{a.status === "failed" ? " · failed" : a.status === "queued" || a.status === "running" ? ` · ${a.status}` : ""}</span></div>
                <div className={styles.why}>{a.instruction}</div>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}

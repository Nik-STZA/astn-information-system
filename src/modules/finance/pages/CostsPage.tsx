// What the platform costs to run: Google Cloud from the billing export, and
// Claude from each agent run's recorded cost. Practice level, read-only.
//
// The two are in different currencies (Google bills in the billing account's
// currency, Claude in USD), so they sit side by side and are never added.

import { Bot, Cloud, Hourglass } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import { fetchPlatformCosts, type CostLine, type CostMonth, type PlatformCosts } from "@/modules/finance/lib/api";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function money(n: number, currency: string | null) {
  if (!currency || currency === "mixed") return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-GB", { style: "currency", currency });
}

const TH: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: "var(--sub)", textAlign: "right", padding: "10px 12px",
  borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  fontSize: 13, color: "var(--tx)", textAlign: "right", padding: "10px 12px", borderBottom: "1px solid var(--bd)",
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};
const LEFT: React.CSSProperties = { textAlign: "left", whiteSpace: "normal" };

function Tile({ icon, title, value, note }: { icon: React.ReactNode; title: string; value: string; note: string }) {
  return (
    <div className={`${styles.card} ${styles.tile}`}>
      <div className={styles.tileTitle}>{icon}{title}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <p className={styles.tileText}>{note}</p>
    </div>
  );
}

// One row per name across the months, ordered by the newest month's cost.
function Compare({ title, months, pick }: { title: string; months: CostMonth[]; pick: (m: CostMonth) => CostLine[] }) {
  const cell = (m: CostMonth, name: string) => pick(m).find((l) => l.name === name)?.net;
  const newest = (name: string) => cell(months[0], name) ?? 0;
  const rows = [...new Set(months.flatMap((m) => pick(m).map((l) => l.name)))].sort((a, b) => newest(b) - newest(a));
  if (!rows.length) return null;
  const currency = months.find((m) => m.google.currency)?.google.currency ?? null;

  return (
    <>
      <div className={styles.listHead}><h2>{title}</h2></div>
      <div className={styles.card} style={{ overflowX: "auto", maxWidth: 980 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ ...TH, ...LEFT }}>{title === "By service" ? "Service" : "Project"}</th>
              {months.map((m, i) => <th key={m.month} style={TH}>{monthName(m.month)}{i === 0 ? " to date" : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((name) => (
              <tr key={name}>
                <td style={{ ...TD, ...LEFT }}>{name}</td>
                {months.map((m) => {
                  const v = cell(m, name);
                  return <td key={m.month} style={{ ...TD, color: v === undefined ? "var(--sub)" : "var(--tx)" }}>{v === undefined ? "-" : money(v, currency)}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td style={{ ...TD, ...LEFT, fontWeight: 600 }}>Total</td>
              {months.map((m) => <td key={m.month} style={{ ...TD, fontWeight: 600 }}>{money(m.google.total, currency)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function CostsPage() {
  let costs: PlatformCosts | null = null;
  let error: string | null = null;
  try {
    costs = await fetchPlatformCosts();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the costs";
  }

  return (
    <div>
      <PageHeader title="Platform costs" sub="What os.stza.io and its agents cost to run, month by month." />

      {error || !costs ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the costs</div>
          {error}
        </div>
      ) : (
        <Body costs={costs} />
      )}
    </div>
  );
}

function Body({ costs }: { costs: PlatformCosts }) {
  const [now, last] = costs.months;
  const currency = costs.months.find((m) => m.google.currency)?.google.currency ?? null;
  const change = (a: number, b: number) =>
    b > 0 ? `${a >= b ? "Up" : "Down"} ${Math.abs(Math.round(((a - b) / b) * 100))}% on ${monthName(last.month)} so far` : `${monthName(last.month)}: none recorded`;

  return (
    <>
      <p className={styles.intro}>
        Google Cloud is everything on the billing account, net of free-tier credits, as Google reports it a few hours
        behind. Claude is the model calls behind agent runs, at list price, from each run&apos;s record. The two are in
        different currencies, so they are shown side by side and never added together.
      </p>

      {!costs.exportReady && (
        <div className={`${styles.card} ${styles.pad} ${styles.narrow}`} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
          <Hourglass size={16} aria-hidden="true" style={{ color: "var(--sub)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            {costs.googleError ? (
              <>The Google Cloud figures could not be read: <span style={{ overflowWrap: "anywhere" }}>{costs.googleError}</span></>
            ) : (
              <>Google&apos;s billing export was switched on on 28 October 2026 and has not written any data yet. Google
                usually starts within a day; until then only the Claude figures show.</>
            )}
          </div>
        </div>
      )}

      <div className={styles.tiles} style={{ marginBottom: 4 }}>
        <Tile
          icon={<Cloud size={16} aria-hidden="true" />}
          title={`Google Cloud, ${monthName(now.month)}`}
          value={costs.exportReady ? money(now.google.total, currency) : "Waiting"}
          note={costs.exportReady ? change(now.google.total, last.google.total) : "Waiting for the first export."}
        />
        <Tile
          icon={<Bot size={16} aria-hidden="true" />}
          title={`Claude agents, ${monthName(now.month)}`}
          value={money(now.claude.usd, "USD")}
          note={
            `${now.claude.runs} run${now.claude.runs === 1 ? "" : "s"} with a cost` +
            (now.claude.uncosted ? `, ${now.claude.uncosted} without one` : "") +
            `. ${monthName(last.month)}: ${money(last.claude.usd, "USD")}.`
          }
        />
      </div>

      {costs.exportReady && (
        <>
          <Compare title="By service" months={costs.months} pick={(m) => m.google.byService} />
          <Compare title="By project" months={costs.months} pick={(m) => m.google.byProject} />
        </>
      )}

      <div className={styles.listHead}><h2>Claude agents</h2></div>
      <div className={styles.card} style={{ overflowX: "auto", maxWidth: 980 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...TH, ...LEFT }}>Month</th>
              <th style={TH}>Costed runs</th>
              <th style={TH}>No cost</th>
              <th style={TH}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {costs.months.map((m, i) => (
              <tr key={m.month}>
                <td style={{ ...TD, ...LEFT }}>{monthName(m.month)}{i === 0 ? " to date" : ""}</td>
                <td style={TD}>{m.claude.runs}</td>
                <td style={{ ...TD, color: m.claude.uncosted ? "var(--tx)" : "var(--sub)" }}>{m.claude.uncosted}</td>
                <td style={TD}>{money(m.claude.usd, "USD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.small} style={{ maxWidth: 760, marginTop: 8 }}>
        Runs before 28 October 2026 were recorded at older prices, about half as much again as the true cost.
      </p>
    </>
  );
}

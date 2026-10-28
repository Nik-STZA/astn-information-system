// What this client's agent runs have cost this calendar month (UK time), from
// the cost each run recorded. Runs with no recorded cost (still going, failed
// before the model answered, or a model with no price) are left out of the
// total and counted separately, so a gap is visible rather than read as free.

import type { AgentRunRow } from "./api";

export interface MonthSpend {
  usd: number;
  costed: number;
  uncosted: number;
}

const monthKey = (d: Date) =>
  d.toLocaleDateString("en-GB", { month: "2-digit", year: "numeric", timeZone: "Europe/London" });

export function monthSpend(runs: AgentRunRow[], now = new Date()): MonthSpend {
  const month = monthKey(now);
  const out: MonthSpend = { usd: 0, costed: 0, uncosted: 0 };
  for (const r of runs) {
    if (monthKey(new Date(r.queued_at)) !== month) continue;
    if (r.status === "queued" || r.status === "running") continue;
    const usd = r.cost_usd == null ? NaN : Number(r.cost_usd);
    if (Number.isFinite(usd)) {
      out.usd += usd;
      out.costed++;
    } else {
      out.uncosted++;
    }
  }
  return out;
}

// "$0.42", or "<$0.01" for a total too small to show in cents.
export function usdText(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

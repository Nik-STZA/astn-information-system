// What the platform costs to run: Google Cloud spend from the Cloud Billing
// export, and Claude spend from each agent run's recorded cost.
//
// The export (standard usage cost, switched on 28 Oct 2026) writes one row per
// usage line to BigQuery, dataset africanstn-research:billing_export, and covers
// every project on the billing account. Google creates the table on its first
// write, so until then the page says the export is waiting, not that the
// platform is free.
//
// Net cost is cost plus credits: credits (free tier, discounts) are negative
// amounts, and without them small services look as if they cost money they do
// not. Google amounts are in the billing account's currency; Claude amounts are
// in USD. They are never added together.
//
// getToken and fetchImpl are injected so tests never reach Google.

const PROJECT = process.env.BILLING_EXPORT_PROJECT || "africanstn-research";
const DATASET = process.env.BILLING_EXPORT_DATASET || "billing_export";
const ACCOUNT = process.env.BILLING_ACCOUNT_ID || "01F577-A74EA0-247EE7";
const TABLE = `gcp_billing_export_v1_${ACCOUNT.replace(/-/g, "_")}`;

let auth;
async function adcToken() {
  if (!auth) {
    const { GoogleAuth } = require("google-auth-library");
    auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/bigquery.readonly"] });
  }
  const t = await auth.getAccessToken();
  return typeof t === "string" ? t : t?.token;
}

// "YYYYMM" for the month `back` months before `now`, in UK time: the export's
// invoice.month is in that form.
function invoiceMonth(now, back = 0) {
  const [y, m] = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" }).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function costQuery(fromMonth) {
  return {
    query: `SELECT invoice.month AS month, service.description AS service, project.id AS project, currency,
       SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net
FROM \`${PROJECT}.${DATASET}.${TABLE}\`
WHERE invoice.month >= @fromMonth
GROUP BY month, service, project, currency`,
    useLegacySql: false,
    location: "EU",
    parameterMode: "NAMED",
    queryParameters: [{ name: "fromMonth", parameterType: { type: "STRING" }, parameterValue: { value: fromMonth } }],
    timeoutMs: 30000,
  };
}

// BigQuery's rows ({f: [{v}]}) as objects, in the order the query names them.
function rowsOf(body) {
  const names = (body.schema?.fields || []).map((f) => f.name);
  return (body.rows || []).map((r) => Object.fromEntries(r.f.map((c, i) => [names[i], c.v])));
}

// Reads the export. { ready: false } while Google has not created the table.
async function googleCosts({ now = new Date(), months = 3, getToken = adcToken, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(costQuery(invoiceMonth(now, months - 1))),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 || /Not found: Table/i.test(body.error?.message || "")) return { ready: false, rows: [] };
  if (!res.ok) throw new Error(`BigQuery ${res.status}: ${body.error?.message || "query failed"}`);
  if (body.jobComplete === false) throw new Error("BigQuery did not finish the cost query in time");
  return { ready: true, rows: rowsOf(body) };
}

const round2 = (n) => Math.round(n * 100) / 100;
const monthLabel = (yyyymm) => `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;

// One entry per month, newest first: Google spend by service and by project
// (largest first, net of credits), and Claude spend from the agent runs.
// agentRows: [{ month: "YYYY-MM", usd, runs, uncosted }].
function shapeCosts({ now = new Date(), months = 3, google, agentRows = [] }) {
  const out = [];
  for (let back = 0; back < months; back++) {
    const ym = invoiceMonth(now, back);
    const lines = (google?.rows || []).filter((r) => r.month === ym);
    const byKey = (key) => {
      const m = new Map();
      for (const r of lines) m.set(r[key] || "Other", (m.get(r[key] || "Other") || 0) + Number(r.net || 0));
      return [...m].map(([name, net]) => ({ name, net: round2(net) })).filter((x) => x.net !== 0).sort((a, b) => b.net - a.net);
    };
    const currencies = [...new Set(lines.map((r) => r.currency).filter(Boolean))];
    const a = agentRows.find((r) => r.month === monthLabel(ym));
    out.push({
      month: monthLabel(ym),
      google: {
        currency: currencies.length === 1 ? currencies[0] : currencies.length ? "mixed" : null,
        total: round2(lines.reduce((s, r) => s + Number(r.net || 0), 0)),
        byService: byKey("service"),
        byProject: byKey("project"),
      },
      claude: { usd: round2(Number(a?.usd || 0)), runs: Number(a?.runs || 0), uncosted: Number(a?.uncosted || 0) },
    });
  }
  return { exportReady: Boolean(google?.ready), months: out };
}

module.exports = { TABLE, invoiceMonth, costQuery, rowsOf, googleCosts, shapeCosts };

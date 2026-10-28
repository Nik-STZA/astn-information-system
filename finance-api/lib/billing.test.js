import { describe, expect, it } from "vitest";
import { TABLE, costQuery, googleCosts, invoiceMonth, rowsOf, shapeCosts } from "./billing.js";

const now = new Date("2026-10-28T12:00:00Z");

describe("invoiceMonth", () => {
  it("gives YYYYMM in UK time, counting back across a year", () => {
    expect(invoiceMonth(now)).toBe("202610");
    expect(invoiceMonth(now, 2)).toBe("202608");
    expect(invoiceMonth(new Date("2027-01-15T12:00:00Z"), 1)).toBe("202612");
    // 31 August 23:30 UTC is already September in London.
    expect(invoiceMonth(new Date("2026-08-31T23:30:00Z"))).toBe("202609");
  });
});

describe("costQuery", () => {
  it("reads the account's export table, net of credits, from a month passed as a parameter", () => {
    const q = costQuery("202608");
    expect(TABLE).toBe("gcp_billing_export_v1_01F577_A74EA0_247EE7");
    expect(q.query).toContain(`africanstn-research.billing_export.${TABLE}`);
    expect(q.query).toContain("UNNEST(credits)");
    expect(q.query).not.toContain("202608");
    expect(q.queryParameters[0].parameterValue.value).toBe("202608");
    expect(q.location).toBe("EU");
  });
});

describe("rowsOf", () => {
  it("names BigQuery's positional cells", () => {
    expect(rowsOf({ schema: { fields: [{ name: "a" }, { name: "b" }] }, rows: [{ f: [{ v: "1" }, { v: "x" }] }] })).toEqual([{ a: "1", b: "x" }]);
    expect(rowsOf({})).toEqual([]);
  });
});

describe("googleCosts", () => {
  const getToken = async () => "token";
  const reply = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });

  it("says the export is not ready while Google has not created the table", async () => {
    const out = await googleCosts({ now, getToken, fetchImpl: reply(404, { error: { message: "Not found: Table africanstn-research:billing_export.x" } }) });
    expect(out).toEqual({ ready: false, rows: [] });
  });

  it("returns the rows once it is", async () => {
    const body = { jobComplete: true, schema: { fields: [{ name: "month" }, { name: "net" }] }, rows: [{ f: [{ v: "202610" }, { v: "1.5" }] }] };
    expect(await googleCosts({ now, getToken, fetchImpl: reply(200, body) })).toEqual({ ready: true, rows: [{ month: "202610", net: "1.5" }] });
  });

  it("fails loudly on any other error rather than showing zero", async () => {
    await expect(googleCosts({ now, getToken, fetchImpl: reply(403, { error: { message: "Access Denied" } }) })).rejects.toThrow(/403.*Access Denied/);
  });
});

describe("shapeCosts", () => {
  const google = {
    ready: true,
    rows: [
      { month: "202610", service: "Cloud SQL", project: "africanstn-research", currency: "GBP", net: "6.10" },
      { month: "202610", service: "Networking", project: "africanstn-research", currency: "GBP", net: "12.40" },
      { month: "202610", service: "Cloud Run", project: "africanstn-research", currency: "GBP", net: "0.80" },
      { month: "202610", service: "Cloud Run", project: "stza-xero-vault", currency: "GBP", net: "0.20" },
      { month: "202610", service: "Secret Manager", project: "stza-xero-vault", currency: "GBP", net: "0" },
      { month: "202609", service: "Cloud SQL", project: "africanstn-research", currency: "GBP", net: "7.00" },
    ],
  };

  it("totals each month by service and by project, largest first, newest month first", () => {
    const out = shapeCosts({ now, months: 3, google, agentRows: [{ month: "2026-10", usd: "1.234", runs: 9, uncosted: 2 }] });
    expect(out.exportReady).toBe(true);
    expect(out.months.map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
    const oct = out.months[0];
    expect(oct.google).toEqual({
      currency: "GBP",
      total: 19.5,
      byService: [{ name: "Networking", net: 12.4 }, { name: "Cloud SQL", net: 6.1 }, { name: "Cloud Run", net: 1 }],
      byProject: [{ name: "africanstn-research", net: 19.3 }, { name: "stza-xero-vault", net: 0.2 }],
    });
    expect(oct.claude).toEqual({ usd: 1.23, runs: 9, uncosted: 2 });
    expect(out.months[2].google).toEqual({ currency: null, total: 0, byService: [], byProject: [] });
  });

  it("keeps the Claude spend when the export is not ready yet", () => {
    const out = shapeCosts({ now, google: { ready: false, rows: [] }, agentRows: [{ month: "2026-10", usd: 2, runs: 4, uncosted: 0 }] });
    expect(out.exportReady).toBe(false);
    expect(out.months[0].claude.usd).toBe(2);
  });
});

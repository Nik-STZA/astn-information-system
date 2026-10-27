// The practice toolset reads lists through the read routes, which answer
// { entity, resource, data } with Xero's reply under data. Until 27 Oct 2026
// the paged tools looked for Invoices, Contacts and so on at the top level and
// so returned empty lists without any error. These tests drive the tools
// against that real response shape.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { practiceTools } from "../mcp-server/practice-tools.js";

const BASE = "http://api.test";
const ENTITY = "/api/finance/clients/acme/xero/acme-ltd";

function wrap(data) {
  return { entity: "ACME", resource: "/x", data };
}

function route(url) {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/api/finance/clients") return { data: [{ slug: "acme" }] };
  if (p === "/api/finance/clients/acme/entities") return { data: [{ slug: "acme-ltd", name: "ACME", connected: true }] };
  if (p === `${ENTITY}/read/invoices`) {
    // two pages: 100 then 1, to prove paging still stops on a short page
    const page = Number(u.searchParams.get("page"));
    const n = page === 1 ? 100 : page === 2 ? 1 : 0;
    return wrap({ Invoices: Array.from({ length: n }, (_, i) => ({ InvoiceID: `inv-${page}-${i}` })) });
  }
  if (p === `${ENTITY}/read/contacts`) return wrap({ Contacts: [{ Name: "Jo Bloggs Ltd" }, { Name: "Jo Bloggs Trading" }] });
  if (p === `${ENTITY}/read/organisation`) return wrap({ Organisations: [{ OrganisationID: "org-1" }] });
  if (p === `${ENTITY}/read/organisation/org-1/cis`) return wrap({ CISSettings: [{ CISContractorEnabled: false }] });
  return null;
}

let calls;
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url) => {
    calls.push(String(url));
    const body = route(String(url));
    return new Response(JSON.stringify(body ?? { error: "not found" }), { status: body ? 200 : 404, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const tools = () => practiceTools({ apiUrl: BASE, apiKey: async () => "k", actorEmail: "test@example.com", log: () => {} }).handlers;

describe("practice list reads", () => {
  it("get_invoices returns the invoices under data, across pages", async () => {
    const r = await tools().get_invoices({ entity: "acme-ltd", invoice_type: "ACCPAY" });
    expect(r.count).toBe(101);
    expect(r.Invoices[100].InvoiceID).toBe("inv-2-0");
    expect(calls.filter((c) => c.includes("/read/invoices"))).toHaveLength(2);
  });

  it("search_contacts returns the matches under data, capped", async () => {
    const r = await tools().search_contacts({ entity: "acme-ltd", search_term: "bloggs", max_results: 1 });
    expect(r.Contacts).toEqual([{ Name: "Jo Bloggs Ltd" }]);
    expect(r.count).toBe(1);
  });

  it("get_cis_settings finds the organisation id under data", async () => {
    const r = await tools().get_cis_settings({ entity: "acme-ltd" });
    expect(r.data.CISSettings).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { agentXeroReads, NAMES, SETTINGS } from "./agent-xero-reads";
import { agentLedger } from "./agent-ledger";
import { resolveRead } from "./xero-read";

const ID = "11111111-2222-3333-4444-555555555555";
const job = { client: { slug: "acme" } };

// A fake finance-api: records each path and answers from a table keyed by the
// read resource.
function fake(answers = {}) {
  const calls = [];
  const apiCall = async (method, url) => {
    calls.push({ method, url });
    const m = /\/read\/([^?]+)/.exec(url);
    const key = m ? m[1] : url;
    return answers[key] ?? { data: {} };
  };
  return { calls, ...agentXeroReads({ apiCall }), ledger: agentLedger({ apiCall }) };
}

describe("agent Xero reads", () => {
  it("offers every tool it names", () => {
    const names = agentXeroReads({}).tools(["udl"]).map((t) => t.name);
    expect(names.sort()).toEqual([...NAMES].sort());
  });

  it("reads only resources finance-api allows, by GET", async () => {
    const f = fake();
    const runs = [
      ["get_contact", { contact_id: ID }], ["get_prepayments", {}], ["get_overpayments", {}], ["get_bank_transfers", {}],
      ["get_purchase_orders", {}], ["get_quotes", {}], ["get_cis_settings", { contact_id: ID }],
      ["get_payroll", { what: "pay_runs" }], ["get_payroll", { what: "pay_runs", pay_run_id: ID }],
      ["get_xero_files", { what: "inbox" }], ["get_xero_files", { what: "associations", file_id: ID }],
      ["get_xero_files", { what: "record_files", record_id: ID }],
      ...Object.keys(SETTINGS).map((what) => ["get_xero_settings", { what }]),
      ...["repeating_invoices", "budgets", "batch_payments", "linked_transactions", "invoice_reminders"].map((what) => ["get_schedule_data", { what }]),
    ];
    for (const [name, input] of runs) await f.call(job, name, { entity: "udl", ...input });
    for (const c of f.calls) {
      expect(c.method).toBe("GET");
      const path = /\/read\/([^?]+)/.exec(c.url)[1].split("/");
      const [resource, id, sub] = path;
      expect(resolveRead({ resource, id, sub }).ok, c.url).toBe(true);
    }
  });

  it("refuses bad input before calling Xero", async () => {
    const f = fake();
    expect(await f.call(job, "get_contact", { entity: "udl", contact_id: "nope" })).toHaveProperty("error");
    expect(await f.call(job, "get_quotes", { entity: "udl", from_date: "5/11/2026" })).toHaveProperty("error");
    expect(await f.call(job, "get_xero_settings", { entity: "udl", what: "secrets" })).toHaveProperty("error");
    expect(await f.call(job, "get_payroll", { entity: "udl", what: "settings", pay_run_id: ID })).toHaveProperty("error");
    expect(f.calls).toHaveLength(0);
  });

  it("gives users' names and roles, never their email", async () => {
    const f = fake({ users: { data: { Users: [{ FirstName: "Jo", LastName: "Bloggs", EmailAddress: "jo@example.com", OrganisationRole: "ADMIN" }] } } });
    const r = await f.call(job, "get_xero_settings", { entity: "udl", what: "users" });
    expect(r.items).toEqual([{ name: "Jo Bloggs", role: "ADMIN", subscriber: null }]);
    expect(JSON.stringify(r)).not.toContain("example.com");
  });

  it("reads organisation CIS through the organisation's own id", async () => {
    const f = fake({ organisation: { data: { Organisations: [{ OrganisationID: ID }] } } });
    await f.call(job, "get_cis_settings", { entity: "udl" });
    expect(f.calls.map((c) => c.url).pop()).toContain(`/read/organisation/${ID}/cis`);
  });

  it("shows a contact's balances and only the masked bank number", async () => {
    const f = fake({ [`contacts/${ID}`]: { data: { Contacts: [{ ContactID: ID, Name: "Acme", BankAccountDetails: "****1234", Balances: { AccountsPayable: { Outstanding: 120, Overdue: 20 } } }] } } });
    const c = await f.call(job, "get_contact", { entity: "udl", contact_id: ID });
    expect(c).toMatchObject({ name: "Acme", bank_account: "****1234", we_owe: 120, we_owe_overdue: 20 });
  });
});

describe("fixed assets", () => {
  const asset = {
    assetId: ID, assetName: "Laptop", assetNumber: "FA-0001", assetStatus: "Registered", purchasePrice: 1200, accountingBookValue: 1100,
    bookDepreciationSetting: { depreciationMethod: "StraightLine", effectiveLifeYears: 3, residualValue: 0 },
    bookDepreciationDetail: { currentAccumDepreciationAmount: 100, priorAccumDepreciationAmount: 0, depreciationStartDate: "2026-09-01T00:00:00" },
  };

  it("shows book value from Xero's accountingBookValue", async () => {
    const f = fake({ assets: { data: { items: [asset] } } });
    const r = await f.ledger.call({ ...job, agent: "fm1" }, "get_fixed_assets", { entity: "udl" });
    expect(r.items[0]).toMatchObject({ book_value: 1100, accumulated_depreciation: 100, residual_value: 0, depreciation_start: "2026-09-01" });
  });

  it("reads asset types, settings and one asset", async () => {
    const f = fake({
      "asset-types": { data: [{ assetTypeId: ID, assetTypeName: "Computer equipment", fixedAssetAccountId: "a", accumulatedDepreciationAccountId: "b", depreciationExpenseAccountId: "c", bookDepreciationSetting: {} }] },
      "asset-settings": { data: { lastDepreciationDate: "2026-08-31T00:00:00" } },
      [`assets/${ID}`]: { data: asset },
    });
    const j = { ...job, agent: "fm1" };
    expect((await f.ledger.call(j, "get_fixed_assets", { entity: "udl", what: "types" })).items[0])
      .toMatchObject({ name: "Computer equipment", cost_account_id: "a", accumulated_depreciation_account_id: "b", expense_account_id: "c" });
    expect(await f.ledger.call(j, "get_fixed_assets", { entity: "udl", what: "settings" })).toMatchObject({ lastDepreciationDate: "2026-08-31T00:00:00" });
    expect(await f.ledger.call(j, "get_fixed_assets", { entity: "udl", what: "asset", asset_id: ID })).toMatchObject({ number: "FA-0001" });
    expect(await f.ledger.call(j, "get_fixed_assets", { entity: "udl", what: "asset", asset_id: "x" })).toHaveProperty("error");
  });
});

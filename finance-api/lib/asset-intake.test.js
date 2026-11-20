import { describe, it, expect } from "vitest";
import { intake, lineNet, xeroDay } from "./asset-intake";

const E = "e1";
const map = [
  { entity_id: E, grouping: "dev_project", role: "wip", xero_account_id: "acc-783", account_code: "783", effective_from: "2026-08-31", effective_to: null },
  { entity_id: E, grouping: "dev_project", role: "wip", xero_account_id: "acc-780", account_code: "780", effective_from: "2026-08-31", effective_to: null },
  { entity_id: E, grouping: "dev_project", role: "cost", xero_account_id: "acc-787", account_code: "787", effective_from: "2026-08-31", effective_to: null },
  { entity_id: E, grouping: "dev_project", role: "wip", xero_account_id: "acc-789", account_code: "789", effective_from: "2026-08-31", effective_to: null },
];
const assets = [
  { id: "a-mmt", asset_no: "IA-003", name: "Mass Market Track", status: "wip", cost_account_id: "acc-783" },
  { id: "a-et", asset_no: "IA-001", name: "Extreme Track", status: "wip", cost_account_id: "acc-780" },
  { id: "a-f1", asset_no: "IA-002", name: "F1 Track", status: "wip", cost_account_id: "acc-780" },
];
const bill = (o) => ({ InvoiceID: "inv-1", InvoiceNumber: "LTD-1", Type: "ACCPAY", Status: "PAID", DateString: "2026-10-22T00:00:00", LineAmountTypes: "Exclusive",
  Contact: { Name: "Jo Bloggs Design" }, LineItems: [{ LineItemID: "li-1", AccountCode: "783", LineAmount: 52000, TaxAmount: 10400 }], ...o });

describe("amounts as the ledger holds them", () => {
  it("takes the net of a VAT-inclusive line and converts foreign currency", () => {
    expect(lineNet({ LineAmountTypes: "Inclusive" }, { LineAmount: 7800, TaxAmount: 1300 })).toBe(6500);
    expect(lineNet({ LineAmountTypes: "Exclusive" }, { LineAmount: 7800, TaxAmount: 1560 })).toBe(7800);
    expect(lineNet({ LineAmountTypes: "Exclusive", CurrencyRate: 1.25 }, { LineAmount: 1000 })).toBe(800);
    expect(xeroDay("/Date(1790726400000+0000)/")).toBe("2026-09-30");
  });
});

describe("the month's intake", () => {
  it("proposes each line on a mapped account once, allocated to the only asset on it", () => {
    const out = intake({ period: "2026-10", grouping: "dev_project", map, assets, docs: [{ entity_id: E, bills: [bill()] }] });
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ source_type: "invoice", xero_source_id: "inv-1", xero_line_id: "li-1", amount: 52000, asset_id: "a-mmt",
      treatment: "capitalise", state: "proposed", posted_account_code: "783" });
    const again = intake({ period: "2026-10", grouping: "dev_project", map, assets, docs: [{ entity_id: E, bills: [bill()] }], existing: new Set(["invoice|inv-1|li-1"]) });
    expect(again.lines).toHaveLength(0);
  });

  it("asks which asset when an account holds several, or none", () => {
    const two = intake({ period: "2026-10", grouping: "dev_project", map, assets,
      docs: [{ entity_id: E, bills: [bill({ LineItems: [{ LineItemID: "li-2", AccountCode: "780", LineAmount: 100 }] })] }] });
    expect(two.lines[0]).toMatchObject({ asset_id: null, treatment: null });
    expect(two.lines[0].fields.question).toMatch(/IA-001, IA-002/);
    const none = intake({ period: "2026-10", grouping: "dev_project", map, assets,
      docs: [{ entity_id: E, bills: [bill({ LineItems: [{ LineItemID: "li-3", AccountCode: "787", LineAmount: 96000 }] })] }] });
    expect(none.lines[0].fields.question).toMatch(/787, which no asset holds/);
    expect(none.findings[0]).toMatchObject({ kind: "posted_where_no_asset", account: "787" });
  });

  it("splits by a supplied allocation when it makes the line, and says so when it does not", () => {
    const hints = [{ invoice_no: "LTD-2", slices: [{ asset_no: "IA-001", amount: 60, treatment: "capitalise", reason: "Phase 3" }, { asset_no: "IA-002", amount: 40, treatment: "capitalise", reason: "Phase 3" }] }];
    const doc = bill({ InvoiceNumber: "LTD-2", LineItems: [{ LineItemID: "li-4", AccountCode: "780", LineAmount: 100 }] });
    const out = intake({ period: "2026-10", grouping: "dev_project", map, assets, docs: [{ entity_id: E, bills: [doc] }], hints });
    expect(out.lines.map((l) => [l.asset_id, l.amount])).toEqual([["a-et", 60], ["a-f1", 40]]);
    expect(out.lines.every((l) => l.source_net === 100 && l.fields.source_key === "inv-1|li-4")).toBe(true);
    hints[0].slices[1].amount = 30;
    const off = intake({ period: "2026-10", grouping: "dev_project", map, assets, docs: [{ entity_id: E, bills: [doc] }], hints });
    expect(off.findings[0]).toMatchObject({ kind: "allocation_does_not_match", line: 100, allocation: 90 });
  });

  it("sets aside a shared account's line that belongs to another grouping, by its counterpart", () => {
    const journal = { ManualJournalID: "mj-1", Status: "POSTED", DateString: "2026-09-30T00:00:00", Narration: "Capitalised development - Sep",
      JournalLines: [{ AccountCode: "789", LineAmount: 1804 }, { AccountCode: "789", LineAmount: 601.33 }, { AccountCode: "464", LineAmount: -2405.33 }] };
    const out = intake({ period: "2026-09", grouping: "dev_project", map, assets, docs: [{ entity_id: E, manual_journals: [journal] }],
      rules: [{ account_code: "789", when_counterpart_code: "464", belongs_to: "software_internal" }] });
    expect(out.lines).toHaveLength(0);
    expect(out.set_aside).toEqual([{ entity_id: E, account_code: "789", belongs_to: "software_internal", amount: 2405.33 }]);
  });

  it("leaves documents outside the month, voided, or not yet approved, and reports the last", () => {
    const out = intake({ period: "2026-10", grouping: "dev_project", map, assets, docs: [{ entity_id: E, bills: [
      bill({ DateString: "2026-09-30T00:00:00" }), bill({ InvoiceID: "v", Status: "VOIDED" }), bill({ InvoiceID: "s", InvoiceNumber: "LTD-9", Status: "SUBMITTED" })] }] });
    expect(out.lines).toHaveLength(0);
    expect(out.findings).toEqual([expect.objectContaining({ kind: "waiting_in_xero", number: "LTD-9", status: "SUBMITTED" })]);
  });

  it("takes a supplier credit note as a negative line", () => {
    const cn = { CreditNoteID: "cn-1", CreditNoteNumber: "CN-1", Type: "ACCPAYCREDIT", Status: "AUTHORISED", DateString: "2026-10-05T00:00:00",
      LineAmountTypes: "Exclusive", LineItems: [{ LineItemID: "cl-1", AccountCode: "783", LineAmount: 500 }] };
    const out = intake({ period: "2026-10", grouping: "dev_project", map, assets, docs: [{ entity_id: E, credit_notes: [cn] }] });
    expect(out.lines[0]).toMatchObject({ amount: -500, asset_id: "a-mmt", source_type: "invoice" });
  });
});

describe("a software build costed by layer", () => {
  // Made-up: a project asset and two layer versions share the WIP account.
  const layers = [
    { id: "a-proj", asset_no: "IA-005", name: "Platform project", status: "wip", cost_account_id: "acc-789" },
    { id: "a-l1", asset_no: "SW-003", name: "L1 Venue Gateway V1", status: "wip", cost_account_id: "acc-789", fields: { layer: "L1", version: "V1" } },
    { id: "a-app", asset_no: "SW-006", name: "APP Application V1", status: "wip", cost_account_id: "acc-789", fields: { layer: "APP", version: "V1" } },
    { id: "a-l2-v1", asset_no: "SW-004", name: "L2 V1", status: "available", cost_account_id: "acc-789", fields: { layer: "L2", version: "V1" } },
  ];
  const jnl = (lines) => ({ ManualJournalID: "mj-1", Status: "POSTED", Narration: "Recharge and capitalised development", DateString: "2026-10-23T00:00:00",
    JournalLines: lines.map((l, i) => ({ JournalLineID: `jl-${i}`, AccountCode: l.code, LineAmount: l.amount, Description: l.desc })) });

  it("puts each journal line on the open version of the layer it names", () => {
    const out = intake({ period: "2026-10", grouping: "dev_project", map, assets: layers, docs: [{ entity_id: E, manual_journals: [jnl([
      { code: "789", amount: 3608.01, desc: "Capitalised Development - Oct 2026 - L1" },
      { code: "789", amount: 601.33, desc: "Capitalised Development -  Oct 2026 - APP" },
      { code: "464", amount: -4209.34, desc: "Capitalised Development - Oct 2026" },
    ])] }] });
    expect(out.lines.map((l) => [l.asset_id, l.amount, l.fields.allocation])).toEqual([["a-l1", 3608.01, "layer"], ["a-app", 601.33, "layer"]]);
    expect(out.lines[0].reason_text).toBe("Layer L1 in the line; SW-003 L1 Venue Gateway V1 is its open version.");
  });

  it("asks when the layer has no open version, and leaves bills to the project", () => {
    const out = intake({ period: "2026-10", grouping: "dev_project", map, assets: layers, docs: [{ entity_id: E,
      manual_journals: [jnl([{ code: "789", amount: 1202.67, desc: "Capitalised Development - Oct 2026 - L2" }])],
      bills: [bill({ LineItems: [{ LineItemID: "li-9", AccountCode: "789", LineAmount: 96000, Description: "Platform development stage 3" }] })] }] });
    const byAmount = Object.fromEntries(out.lines.map((l) => [l.amount, l]));
    expect(byAmount[1202.67].asset_id).toBeNull();
    expect(byAmount[1202.67].fields.question).toMatch(/Layer L2 has no open version/);
    expect(byAmount[96000].asset_id).toBe("a-proj");
    expect(out.findings.some((f) => f.kind === "layer_has_no_open_version")).toBe(true);
  });
});

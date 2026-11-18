import { describe, expect, it } from "vitest";

const { parseVatExport, netPosition, kindOf, longDate } = require("./vat-export");
const { checkReturn, adjustmentKey } = require("./vat-checks");

// A synthetic export in Xero's layout (names and figures made up).
function exportOf({ entity = "Sample Ltd", start = "01 Oct 2026", end = "31 Oct 2026", boxes = {}, label5 = "VAT to reclaim from HMRC", extra = [] } = {}) {
  const b = { 1: 20, 2: 0, 3: 20, 4: 120, 5: 100, 6: 100, 7: 600, 8: 0, 9: 0, ...boxes };
  return {
    "VAT Return": [
      ["VAT Return"], [entity], [`For the period ${start} - ${end}`], [], [],
      ["VAT Return Details"], ["VAT Number", "GB123456789"], ["VAT Scheme", "Accrual"], ["Period covered by the return", "Monthly"],
      ["Period Start", start], ["Period End", end], [], ["VAT Calculations"],
      ["VAT due in the period on sales and other outputs", "1", String(b[1])],
      ["VAT due in the period on acquisitions", "2", String(b[2])],
      ["Total VAT due (the sum of boxes 1 and 2)", "3", String(b[3])],
      ["VAT reclaimed in the period on purchases", "4", String(b[4])],
      [label5, "5", String(b[5])],
      ["Total value of sales", "6", String(b[6])], ["Total value of purchases", "7", String(b[7])],
      ["Total value of all supplies of goods to EU", "8", String(b[8])], ["Total value of all acquisitions from EU", "9", String(b[9])],
    ],
    "Transactions by VAT Box": [
      ["Transactions by VAT Box"], [entity], [`For the period ${start} - ${end}`], [], [],
      ["Box 1", "VAT due in the period on sales and other outputs", String(b[1])],
      ["20% (VAT on Income)"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["12/10/2026", "Sales(200)", "INV-001", "Sample Customer - services", "20", "100"],
      [],
      ["Box 4", "VAT reclaimed in the period on purchases", String(b[4])],
      ["20% (VAT on Expenses)"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["03/10/2026", "Rent(469)", "R-10", "Sample Landlord - October rent", "100", "500"],
      ["20% (VAT on Expenses) Late Claims"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["28/09/2026", "Travel - Rail(511)", "T-9", "Sample Rail - September fare", "20", "100"],
      ...extra,
      ["Box 7", "Total value of purchases", String(b[7])],
      ["20% (VAT on Expenses)"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["03/10/2026", "Rent(469)", "R-10", "Sample Landlord - October rent", "100", "500"],
      ["28/09/2026", "Travel - Rail(511)", "T-9", "Sample Rail - September fare", "20", "100"],
    ],
  };
}

describe("parsing Xero's VAT return export", () => {
  it("reads the period, the boxes and every transaction line", () => {
    const r = parseVatExport(exportOf());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r).toMatchObject({ entity: "Sample Ltd", period_start: "2026-10-01", period_end: "2026-10-31", vat_number: "123456789", scheme: "Accrual" });
    expect(r.boxes).toEqual({ 1: 20, 2: 0, 3: 20, 4: 120, 5: 100, 6: 100, 7: 600, 8: 0, 9: 0 });
    const late = r.lines.find((l) => l.kind === "late" && l.box === 4);
    expect(late).toMatchObject({ date: "2026-09-28", account: "Travel - Rail", account_code: "511", vat: 20, net: 100 });
    expect(r.lines.filter((l) => l.box === 7)).toHaveLength(2);
  });

  it("reads Xero's month names with four letters and classifies sections", () => {
    expect(longDate("01 Sept 2026")).toBe("2026-09-01");
    expect(kindOf("20% (VAT on Expenses) Late Claims - Adjusted")).toBe("late_adjusted");
    expect(kindOf("Adjustments with no accounting transactions")).toBe("no_transaction");
    expect(kindOf("Imported VAT box amount")).toBe("imported");
    expect(kindOf("Reverse Charge Expenses (20%) Reclaimed VAT")).toBe("standard");
  });

  it("reads an adjustment with no accounting transaction, with its created date", () => {
    const extra = [["Adjustments with no accounting transactions"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["31/10/2026", "N/A", "Created on 28/11/2026", "Correcting the group position", "-5", "0"]];
    const r = parseVatExport(exportOf({ boxes: { 4: 115, 5: 95 }, extra }));
    expect(r.lines.find((l) => l.kind === "no_transaction")).toMatchObject({ created_on: "2026-11-28", vat: -5, account: "N/A", account_code: null });
    expect(r.warnings).toEqual([]);
  });

  it("refuses a file that is not a VAT return export", () => {
    expect(parseVatExport({ Sheet1: [["a"]] }).errors[0]).toMatch(/no "VAT Return" tab/);
  });

  it("signs the net position: negative to reclaim", () => {
    expect(netPosition({ 3: 20, 4: 120 })).toBe(-10000);
  });
});

describe("checking a return's uploads", () => {
  const ret = { period_start: "2026-10-01", period_end: "2026-10-31" };
  const members = [{ entity_id: "a", entity_name: "Alpha" }, { entity_id: "b", entity_name: "Beta" }];
  const x = (id, name, opts) => ({ entity_id: id, entity_name: name, parsed: parseVatExport(exportOf(opts)) });

  it("passes a clean pair of member exports", () => {
    const r = checkReturn({ exports: [x("a", "Alpha"), x("b", "Beta")], ret, members });
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.key === "late_claims").items).toHaveLength(2);
  });

  it("blocks a stale period, a missing member and bad arithmetic", () => {
    const r = checkReturn({ exports: [x("a", "Alpha", { start: "01 Sept 2026", end: "30 Sept 2026", boxes: { 5: 90 } })], ret, members });
    expect(r.blocking).toEqual(expect.arrayContaining(["period", "members", "arithmetic"]));
    expect(r.checks.find((c) => c.key === "members").said).toMatch(/No export yet for Beta/);
    expect(r.checks.find((c) => c.key === "arithmetic").said).toMatch(/box 5 is 90.00, box 3 less box 4 is -100.00/);
  });

  it("blocks an adjustment with no transaction until the CFO accepts it", () => {
    const extra = [["Adjustments with no accounting transactions"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["31/10/2026", "N/A", "Created on 28/11/2026", "Correcting the group position", "-5", "0"]];
    const a = x("a", "Alpha", { boxes: { 4: 115, 5: 95 }, extra });
    let r = checkReturn({ exports: [a, x("b", "Beta")], ret, members });
    expect(r.blocking).toEqual(["adjustments"]);
    const key = adjustmentKey("a", a.parsed.lines.find((l) => l.kind === "no_transaction"));
    r = checkReturn({ exports: [a, x("b", "Beta")], ret, members, accepted: new Set([key]) });
    expect(r.ok).toBe(true);
  });
});

describe("the group return and its import file", () => {
  const { buildGroup, confirmImport, importTemplateRows } = require("./vat-group");
  const member = (id, rep, boxes, extra) => ({ entity_id: id, entity_name: id, representative: rep, parsed: parseVatExport(exportOf({ entity: id, boxes, extra })) });
  const imported = (b1, b4) => [["Imported VAT box amount"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
    ["31/10/2026", "N/A", "Import", "VAT box amount from uploaded file", String(b4), "0"]];

  it("sums every member's own figures and imports the members' share into the representative", () => {
    const g = buildGroup([member("REP", true), member("M1", false), member("M2", false)]);
    expect(g.target[4]).toBe(360);
    expect(g.target[5]).toBe(-300); // signed: 300 to reclaim
    expect(g.import).toEqual({ 1: 40, 2: 0, 4: 240, 6: 200, 7: 1200, 8: 0, 9: 0 });
    expect(importTemplateRows(g.import)[5]).toEqual(["Box 5", 200]);
  });

  it("never double counts: after the import, the next file is only the difference", () => {
    // The representative re-exported after importing 200 into box 4 (40 short).
    const after = parseVatExport(exportOf({ entity: "REP", boxes: { 4: 320, 5: 300 }, extra: imported(0, 200) }));
    const g = buildGroup([member("REP", true), member("M1", false), member("M2", false)], undefined, after);
    expect(g.import[4]).toBe(40);
    expect(confirmImport(g.target, after)).toEqual(expect.arrayContaining([{ box: 4, want: 360, got: 320 }]));
  });

  it("leaves imports and unaccepted adjustments out of a company's own figures", () => {
    const extra = [["Adjustments with no accounting transactions"], ["Date", "Account", "Reference", "Details", "VAT", "Net"],
      ["31/10/2026", "N/A", "Created on 28/11/2026", "Manual group adjustment", "50", "0"]];
    const rep = member("REP", true, { 4: 170, 5: 150 }, extra);
    const g = buildGroup([rep, member("M1", false)]);
    expect(g.columns[0].own[4]).toBe(120);
    const g2 = buildGroup([rep, member("M1", false)], () => true);
    expect(g2.columns[0].own[4]).toBe(170);
  });
});

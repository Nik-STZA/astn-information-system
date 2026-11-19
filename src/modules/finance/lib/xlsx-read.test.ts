import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readXlsx, readXlsxAll } from "./xlsx-read";

const fixture = new URL("./__fixtures__/master-sample.xlsx", import.meta.url);

describe("readXlsx", () => {
  it("reads the first sheet: shared strings, numbers, blanks, escaped text, sparse cells", async () => {
    const { sheet, rows } = await readXlsx(readFileSync(fixture));
    expect(sheet).toBe("Master Mapping");
    expect(rows[0]).toEqual(["Sample Group - master mapping"]);
    expect(rows[1]).toEqual([]);
    expect(rows[2].slice(0, 8)).toEqual(["Lookup", "*Code", "*Name", "*Type", "*Tax Code", "P&L Mapping 1", "P&L Mapping 2", "BS Mapping"]);
    expect(rows[3].slice(0, 7)).toEqual(["200 - Sales", "200", "Sales", "Revenue", "20% (VAT on Income)", "Revenue", "Ticketing"]);
    expect(rows[4][10]).toBe("1.5");
    expect(rows[4][2]).toBe("Postage, Freight & Courier");
    expect(rows[5][1]).toBe("");
    expect(rows[5][2]).toBe('Bank <Main> "GBP"');
    expect(rows[5][7]).toBe("Cash");
  });

  // Payroll software built on .NET's Open XML SDK writes every element with a
  // namespace prefix (<x:sheet>, <x:row>, <x:c>) after a byte-order mark, and
  // mixes stored and compressed parts. Excel reads it; so must we (19 Nov 2026:
  // a provider's salary report was refused as "not an Excel workbook").
  it("reads a workbook whose XML elements carry a namespace prefix", async () => {
    const all = await readXlsxAll(readFileSync(new URL("./__fixtures__/prefixed-sample.xlsx", import.meta.url)));
    expect(Object.keys(all)).toEqual(["Salary Report"]);
    expect(all["Salary Report"]).toEqual([["EmpCode", "Surname", "Basic"], ["11", "BLOGGS", "5000.5"]]);
  });

  it("refuses a file that is not an xlsx", async () => {
    await expect(readXlsx(new TextEncoder().encode("code,name\n1,a\n"))).rejects.toThrow(/not an xlsx/);
  });

  // A local check against a real master file, when one is named.
  const real = process.env.MASTER_XLSX;
  it.skipIf(!real || !existsSync(real))("reads a real master file", async () => {
    const { rows } = await readXlsx(readFileSync(real!));
    const head = rows.findIndex((r) => r.includes("P&L Mapping 1"));
    expect(head).toBeGreaterThanOrEqual(0);
    console.log(`header at row ${head + 1}, ${rows.length} rows; sample:`, rows[head + 1]);
  });
});

describe("readXlsxAll", () => {
  // A local check against a real Xero VAT return export, when one is named:
  // every tab is read, and the two the parser needs stay well under 1 MB.
  const real = process.env.VAT_XLSX;
  it.skipIf(!real || !existsSync(real))("reads every tab of a real VAT export", async () => {
    const all = await readXlsxAll(readFileSync(real!));
    const sent = JSON.stringify({ "VAT Return": all["VAT Return"], "Transactions by VAT Box": all["Transactions by VAT Box"] });
    console.log(Object.entries(all).map(([k, v]) => `${k}: ${v.length} rows`).join("; "), `| sent ${sent.length} bytes`);
    expect(all["VAT Return"]).toBeDefined();
    expect(sent.length).toBeLessThan(1_000_000);
  });
});

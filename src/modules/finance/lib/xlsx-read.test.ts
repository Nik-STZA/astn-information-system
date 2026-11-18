import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readXlsx } from "./xlsx-read";

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

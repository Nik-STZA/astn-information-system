import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { writeWorkbook, sheetNames, serial, colName, crc32 } from "./xlsx-write";
import { readXlsx, unzip } from "./sheet-read";

describe("xlsx-write", () => {
  it("writes sheets our reader reads back: text, money, dates, totals", () => {
    const book = writeWorkbook([
      { name: "Summary", lines: [[["Title", "title"]], ["Sample Ltd"], [], { cells: [{ value: "Items", style: "header" }, { value: 2, type: "number" }] }] },
      {
        name: "All items",
        columns: [{ header: "Date", type: "date" }, { header: "Payee" }, { header: "Spent £", type: "money" }],
        rows: [["2026-09-30", "=HYPERLINK(\"x\")", 690], ["2026-10-07", "Jo & Co <Ltd>", 12.5]],
        totals: { label: "Total", sum: [2] },
      },
    ]);
    const sheets = readXlsx(book);
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "All items"]);
    expect(sheets[0].rows.map((r) => r.cells[0])).toEqual(["Title", "Sample Ltd", "Items"]);
    expect(sheets[1].rows).toEqual([
      { row: 1, cells: ["Date", "Payee", "Spent £"] },
      { row: 2, cells: ["2026-09-30", "=HYPERLINK(\"x\")", "690"] },
      { row: 3, cells: ["2026-10-07", "Jo & Co <Ltd>", "12.5"] },
      { row: 4, cells: ["Total", "", "702.5"] },
    ]);
  });

  it("keeps text that looks like a formula as text, and writes the total as a SUBTOTAL", () => {
    const book = writeWorkbook([{ name: "S", columns: [{ header: "A" }, { header: "B", type: "money" }], rows: [["=1+1", 1], ["x", 2]], totals: { sum: [1] } }]);
    const xml = unzip(book).text("xl/worksheets/sheet1.xml");
    expect(xml).toMatch(/t="inlineStr"[^>]*><is><t xml:space="preserve">=1\+1<\/t>/);
    expect(xml).toMatch(/<f>SUBTOTAL\(9,B2:B3\)<\/f><v>3<\/v>/);
    expect(xml).toMatch(/<pane ySplit="1"/);
    expect(xml).toMatch(/<autoFilter ref="A1:B3"\/>/);
  });

  it("stores correct CRCs, so Excel opens the file", () => {
    const book = writeWorkbook([{ name: "S", columns: [{ header: "A" }], rows: [["x"]] }]);
    let p = book.readUInt32LE(book.length - 6);
    for (let n = 0; n < book.readUInt16LE(book.length - 12); n++) {
      const crc = book.readUInt32LE(p + 16), csize = book.readUInt32LE(p + 20), local = book.readUInt32LE(p + 42);
      const start = local + 30 + book.readUInt16LE(local + 26) + book.readUInt16LE(local + 28);
      expect(crc32(zlib.inflateRawSync(book.subarray(start, start + csize)))).toBe(crc);
      p += 46 + book.readUInt16LE(p + 28) + book.readUInt16LE(p + 30) + book.readUInt16LE(p + 32);
    }
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("makes tab names Excel accepts", () => {
    expect(sheetNames(["Jo Bloggs", "jo bloggs", "A/B: [x]?", "", "x".repeat(40)])).toEqual(["Jo Bloggs", "jo bloggs (2)", "A B x", "Sheet", "x".repeat(31)]);
  });

  it("drops characters XML forbids", () => {
    const book = writeWorkbook([{ name: "S", columns: [{ header: "A" }], rows: [["a\u0001b"]] }]);
    expect(readXlsx(book)[0].rows[1].cells[0]).toBe("ab");
  });

  it("helpers", () => {
    expect(serial("2025-01-29")).toBe(45686);
    expect(serial("nope")).toBe(null);
    expect([colName(0), colName(25), colName(26), colName(27)]).toEqual(["A", "Z", "AA", "AB"]);
  });
});

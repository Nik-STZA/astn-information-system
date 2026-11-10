import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { readXlsx, readCsv, kindOf, sheetsAsText, serialDate, colIndex, XLSX_TYPE } from "./sheet-read";

// A minimal zip writer: enough to build a workbook in the test, so no real
// client file sits in the repo. CRCs are left at 0; the reader does not check them.
function zip(files, { store = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const body = store ? data : zlib.deflateRawSync(data);
    const n = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(store ? 0 : 8, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(store ? 0 : 8, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body);
    centrals.push(ch, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const WORKBOOK = {
  "xl/workbook.xml": `<workbook><sheets><sheet name="Outstanding &amp; queries" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>Bank A</t></si><si><t>Date</t></si><si><r><t>Jo </t></r><r><t>Bloggs Ltd</t></r></si><si><t xml:space="preserve">Note &lt;1&gt;</t></si></sst>`,
  "xl/styles.xml": `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c></row>
    <row r="4"><c r="A4" s="1"><v>45686</v></c><c r="B4" t="s"><v>2</v></c><c r="D4" s="2"><v>930.31</v></c><c r="E4" t="inlineStr"><is><t>inline</t></is></c></row>
    <row r="5"><c r="A5" s="3"><v>45751</v></c><c r="C5" t="s"><v>3</v></c><c r="D5" t="str"><v>1,319.88</v></c><c r="F5" t="b"><v>1</v></c></row>
    <row r="6"><c r="A6"/></row>
  </sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row></sheetData></worksheet>`,
};

describe("readXlsx", () => {
  it("reads values, shared and rich strings, dates by number format, and skips hidden sheets and empty rows", () => {
    const sheets = readXlsx(zip(WORKBOOK));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Outstanding & queries");
    expect(sheets[0].rows).toEqual([
      { row: 1, cells: ["Bank A"] },
      { row: 2, cells: ["Date"] },
      { row: 4, cells: ["2025-01-29", "Jo Bloggs Ltd", "", "930.31", "inline"] },
      { row: 5, cells: ["2025-04-04", "", "Note <1>", "1,319.88", "", "TRUE"] },
    ]);
  });

  it("reads a stored (uncompressed) workbook too", () => {
    expect(readXlsx(zip(WORKBOOK, { store: true }))[0].rows[0].cells).toEqual(["Bank A"]);
  });

  it("says plainly when the file is not a workbook", () => {
    expect(() => readXlsx(Buffer.from("hello"))).toThrow(/not a zip/);
    expect(() => readXlsx(zip({ "a.txt": "x" }))).toThrow(/not an Excel workbook/);
  });
});

describe("readCsv", () => {
  it("handles quotes, commas and line breaks inside quotes", () => {
    const rows = readCsv(Buffer.from('﻿Date,Payee,Amount\r\n29/01/2025,"Jo, Bloggs ""Ltd""",930.31\n\n04/04/2025,"two\nlines",1319.88\n'))[0].rows;
    expect(rows).toEqual([
      { row: 1, cells: ["Date", "Payee", "Amount"] },
      { row: 2, cells: ["29/01/2025", 'Jo, Bloggs "Ltd"', "930.31"] },
      { row: 4, cells: ["04/04/2025", "two\nlines", "1319.88"] },
    ]);
  });
});

describe("kindOf", () => {
  it("tells files apart by their first bytes, then their name", () => {
    expect(kindOf(Buffer.from("%PDF-1.7 ..."), "x.xlsx")).toBe("pdf");
    expect(kindOf(zip(WORKBOOK), "rec.xlsx")).toBe("xlsx");
    expect(kindOf(zip(WORKBOOK), "blob", XLSX_TYPE)).toBe("xlsx");
    expect(kindOf(zip(WORKBOOK), "archive.zip")).toBe(null);
    expect(kindOf(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "old.xls")).toBe("xls");
    expect(kindOf(Buffer.from("a,b"), "list.CSV")).toBe("csv");
    expect(kindOf(Buffer.from("<html>"), "page.html")).toBe(null);
  });
});

describe("helpers", () => {
  it("turns Excel day numbers into dates, including the 1904 system", () => {
    expect(serialDate(45686)).toBe("2025-01-29");
    expect(serialDate(45686 - 1462, true)).toBe("2025-01-29");
    expect(serialDate(0)).toBe(null);
  });

  it("reads column letters", () => {
    expect(colIndex("A1")).toBe(0);
    expect(colIndex("AB12")).toBe(27);
    expect(colIndex("12")).toBe(null);
  });

  it("writes sheets as text with row labels, and cuts off past the limit", () => {
    const sheets = [{ name: "S", rows: [{ row: 3, cells: ["a\tb", "c"] }, { row: 9, cells: ["d"] }] }];
    expect(sheetsAsText(sheets).text).toBe("=== Sheet: S ===\nR3\ta b\tc\nR9\td");
    const cut = sheetsAsText(sheets, { maxChars: 10 });
    expect(cut.truncated).toBe(true);
    expect(cut.text).toMatch(/cut off/);
  });
});

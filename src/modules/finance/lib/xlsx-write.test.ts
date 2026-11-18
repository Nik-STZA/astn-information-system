import { describe, expect, it } from "vitest";
import { crc32, writeXlsx } from "./xlsx-write";
import { readXlsx, readXlsxAll } from "./xlsx-read";

describe("writeXlsx", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a sheet the reader reads back: text, numbers, blanks, escaped text", async () => {
    const rows = [["VAT Return Import"], ["Box 1", 40.5], ["Box 2", 0], ["Note", "A & B <C>"], [], ["", 7]];
    const { sheet, rows: back } = await readXlsx(writeXlsx("VAT Return", rows));
    expect(sheet).toBe("VAT Return");
    expect(back[0]).toEqual(["VAT Return Import"]);
    expect(back[1]).toEqual(["Box 1", "40.5"]);
    expect(back[2]).toEqual(["Box 2", "0"]);
    expect(back[3]).toEqual(["Note", "A & B <C>"]);
    expect(back[5]).toEqual(["", "7"]);
  });

  it("is read by readXlsxAll under its tab name", async () => {
    const all = await readXlsxAll(writeXlsx("Only tab", [["x"]]));
    expect(Object.keys(all)).toEqual(["Only tab"]);
  });
});

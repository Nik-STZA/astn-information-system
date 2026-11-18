// A master mapping file (xlsx or CSV) as a table of cell text, read in the
// browser; finance-api finds the header row and plans it.

import { parseCsv } from "./coa-csv";
import { readXlsx } from "./xlsx-read";

const MAX_COLS = 40;

export async function readMasterFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  let rows: string[][];
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) rows = (await readXlsx(await file.arrayBuffer())).rows;
  else if (name.endsWith(".csv")) rows = parseCsv(await file.text());
  else throw new Error("Choose an .xlsx or .csv file");
  // Only what finance-api needs: no trailing blanks, no far-off columns.
  return rows.map((r) => {
    const cells = r.slice(0, MAX_COLS).map((c) => String(c ?? "").trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells;
  });
}

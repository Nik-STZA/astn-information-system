import { describe, expect, it } from "vitest";
import type { CoaAccountRow, ReportingCategory } from "./coa";
import { changesFromCsv, mappingCsv, parseCsv } from "./coa-csv";

const cat = (key: string, label: string, statement: "pnl" | "bs"): ReportingCategory => ({
  key, label, statement, section: statement === "pnl" ? "overheads" : "current_assets",
  sortOrder: 1, cashFlow: statement === "bs" ? "working_capital" : null, active: true, scope: "standard",
});
const CATS = [cat("staff_costs", "Staff costs", "pnl"), cat("debtors", "Debtors", "bs")];

const row = (accountId: string, code: string | null, name: string, extra: Partial<CoaAccountRow> = {}): CoaAccountRow => ({
  accountId, code, name, class: "EXPENSE", type: "OVERHEADS", reportingCode: null, xeroStatus: "ACTIVE",
  statement: "pnl", mapping: null, proposal: { category: "staff_costs", reason: "rule" }, flags: [], ...extra,
});
const ROWS = [row("id-1", "477", "Wages, salaries"), row("id-2", "610", "Debtors", { class: "ASSET", statement: "bs" }), row("id-3", null, "Bank")];

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas, CRLF and a byte order mark", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("mappingCsv", () => {
  it("round-trips through the upload", () => {
    const csv = mappingCsv(ROWS, CATS);
    expect(csv.split("\r\n")[1]).toBe('477,"Wages, salaries",EXPENSE,staff_costs,Staff costs,,rule proposal,id-1');
    const { changes, errors } = changesFromCsv(csv, ROWS, CATS);
    expect(errors).toEqual([]);
    expect(changes.map((c) => c.accountId)).toEqual(["id-1", "id-2", "id-3"]);
  });
});

describe("changesFromCsv", () => {
  it("matches by code and by category label, skips blank categories, and approves when asked", () => {
    const { changes, errors, skipped } = changesFromCsv("Code,Category,Cash flow\n477,staff costs,\n610,,\n", ROWS, CATS, { approve: true });
    expect(errors).toEqual([]);
    expect(skipped).toBe(1);
    expect(changes).toEqual([{ accountId: "id-1", category: "staff_costs", approve: true, cashFlow: null }]);
  });

  it("reports unknown accounts and categories by row", () => {
    const { errors } = changesFromCsv("code,category\n999,staff_costs\n477,Mystery\n", ROWS, CATS);
    expect(errors).toEqual(["Row 2: no account 999 in this entity", 'Row 3: unknown category "Mystery"']);
  });

  it("refuses a file without the columns it needs", () => {
    expect(changesFromCsv("name,thing\n", ROWS, CATS).errors[0]).toMatch(/needs a category column/);
  });
});

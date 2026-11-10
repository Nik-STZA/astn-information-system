import { describe, expect, it } from "vitest";
import {
  CONCERN_KEYS, amountOf, vatFlag, normaliseLine, markDuplicates, buildReadRequest, parseRead, placeByOrganisation,
  editInput, newItemInput, stepIssues, stepTarget, summary, dupKey,
} from "./outstanding-docs";

const ENTITIES = [
  { id: "e-1", slug: "acme-ltd", name: "Acme", legal_name: "Acme Trading Limited" },
  { id: "e-2", slug: "acme-holdings", name: "Acme Holdings", legal_name: "Acme Holdings Limited" },
];

describe("amountOf", () => {
  it("reads amounts as UK reports write them", () => {
    expect(amountOf("£1,234.50")).toBe(1234.5);
    expect(amountOf("(120.00)")).toBe(-120);
    expect(amountOf(" 15,786.85 ")).toBe(15786.85);
    expect(amountOf(42)).toBe(42);
    expect(amountOf("n/a")).toBe(null);
    expect(amountOf("")).toBe(null);
  });
});

describe("vatFlag", () => {
  const item = (o) => ({ direction: "spent", concern: "no_vat_invoice", currency: "GBP", amount: 100, ...o });
  it("flags a sterling cost above the threshold, with up to a sixth at risk", () => {
    expect(vatFlag(item({ amount: 120 }), 25)).toMatchObject({ flagged: true, at_risk_max: 20 });
  });
  it("leaves a cost at or under the threshold alone", () => {
    expect(vatFlag(item({ amount: 25 }), 25).flagged).toBe(false);
  });
  it("uses the sterling value of a foreign line, and flags one with none", () => {
    expect(vatFlag(item({ currency: "USD", amount: 20, amount_gbp: 30 }), 25)).toMatchObject({ flagged: true, at_risk_max: 5 });
    expect(vatFlag(item({ currency: "USD", amount: 20 }), 25)).toMatchObject({ flagged: true, at_risk_max: null });
  });
  it("does not count money received or overseas suppliers", () => {
    expect(vatFlag(item({ direction: "received", amount: 500 })).flagged).toBe(false);
    expect(vatFlag(item({ concern: "overseas_reverse_charge", amount: 500 })).flagged).toBe(false);
  });
  it("follows the client's threshold", () => {
    expect(vatFlag(item({ amount: 40 }), 50).flagged).toBe(false);
  });
});

describe("normaliseLine", () => {
  it("cleans a good line and places it only in this client's companies", () => {
    const { line, issues } = normaliseLine({ date: "2025-01-29", payee: "  Jo   Bloggs ", amount: "930.31", currency: "gbp", company: "acme-ltd", concern: "audit_evidence", source_line: "R4" }, ENTITIES);
    expect(issues).toEqual([]);
    expect(line).toMatchObject({ txn_date: "2025-01-29", payee: "Jo Bloggs", amount: 930.31, currency: "GBP", entity_id: "e-1", concern: "audit_evidence", direction: "spent", amount_gbp: null });
    expect(normaliseLine({ date: "2025-01-29", payee: "x", amount: 1, company: "someone-else" }, ENTITIES).line.entity_id).toBe(null);
  });
  it("refuses a line with a bad date, no payee or no amount", () => {
    expect(normaliseLine({ date: "2025-02-30", payee: "x", amount: 1 }).issues[0]).toMatch(/not a date/);
    expect(normaliseLine({ date: "2025-02-03", payee: " ", amount: 1 }).issues).toContain("no payee");
    expect(normaliseLine({ date: "2025-02-03", payee: "x", amount: "0" }).issues[0]).toMatch(/not an amount/);
  });
  it("turns a negative amount positive and falls back to a known concern", () => {
    const { line } = normaliseLine({ date: "2025-02-03", payee: "x", amount: "-12.5", concern: "made_up" });
    expect(line).toMatchObject({ amount: 12.5, concern: "no_vat_invoice" });
  });
  it("keeps a sterling value only for a foreign line", () => {
    expect(normaliseLine({ date: "2025-02-03", payee: "x", amount: 20, currency: "USD", amount_gbp: 16 }).line.amount_gbp).toBe(16);
    expect(normaliseLine({ date: "2025-02-03", payee: "x", amount: 20, currency: "GBP", amount_gbp: 16 }).line.amount_gbp).toBe(null);
  });
});

describe("markDuplicates", () => {
  const l = (o) => ({ txn_date: "2025-03-21", payee: "British A 1252206089244", amount: 3036.12, currency: "GBP", direction: "spent", ...o });
  it("treats identical lines in one file as separate transactions", () => {
    const out = markDuplicates([l(), l({ payee: "BRITISH A   1252206089244" }), l({ amount: 1 })], [{ id: "x-1", state: "dismissed", ...l() }]);
    expect(out.map((x) => x.duplicate_of)).toEqual([null, null, null]);
  });
  it("counts repeats: the k-th identical line meets the k-th live item, the rest are new", () => {
    const held = [{ id: "x-1", state: "open", ...l() }, { id: "x-2", state: "received", ...l() }];
    expect(markDuplicates([l(), l(), l()], held).map((x) => x.duplicate_of)).toEqual(["x-1", "x-2", null]);
  });
  it("matches live items whatever the payee's spacing or case", () => {
    const again = markDuplicates([l()], [{ id: "x-2", state: "open", ...l({ payee: "british a 1252206089244" }) }]);
    expect(again[0].duplicate_of).toBe("x-2");
  });
  it("does not treat a different payee on the same day and amount as a repeat", () => {
    expect(dupKey(l())).not.toBe(dupKey(l({ payee: "British A 1252206089245" })));
  });
});

describe("reading a report", () => {
  it("sends a PDF as the file and a spreadsheet as text, at temperature 0", () => {
    const pdf = buildReadRequest({ kind: "pdf", bytes: Buffer.from("x"), fileName: "rec.pdf", entities: ENTITIES });
    expect(pdf.contents[0].parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: "eA==" });
    expect(pdf.contents[0].parts[1].text).toMatch(/acme-ltd: Acme \(Acme Trading Limited\)/);
    const sheet = buildReadRequest({ kind: "xlsx", sheetText: "R4\tx", fileName: "rec.xlsx", entities: ENTITIES });
    expect(sheet.contents[0].parts).toHaveLength(1);
    expect(sheet.contents[0].parts[0].text).toMatch(/R4\tx$/);
    expect(sheet.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0 });
    expect(sheet.generationConfig.responseSchema.properties.lines.items.properties.concern.enum).toEqual(CONCERN_KEYS);
  });

  it("keeps good lines, lists the rest with why, and checks the report date", () => {
    const out = parseRead(JSON.stringify({
      report: { title: "Bank Reconciliation", organisation: "Acme Trading Limited", as_at: "2025-07-31" },
      lines: [
        { date: "2025-01-29", payee: "Utility Co", amount: 930.31, currency: "GBP", direction: "spent", concern: "no_vat_invoice", source_line: "R4" },
        { date: "29/01/2025", payee: "Bad date", amount: 1, currency: "GBP", direction: "spent", concern: "other", source_line: "R5" },
      ],
    }), ENTITIES);
    expect(out.lines).toHaveLength(1);
    expect(out.skipped).toEqual([{ source_line: "R5", payee: "Bad date", issues: [expect.stringMatching(/not a date/)] }]);
    expect(out.report.as_at).toBe("2025-07-31");
    expect(() => parseRead("not json", ENTITIES)).toThrow(/not valid JSON/);
  });

  it("places unplaced lines when the report names exactly one company", () => {
    const parsed = { report: { organisation: "Acme Trading Limited" }, lines: [{ entity_id: null }, { entity_id: "e-2", entity_slug: "acme-holdings" }] };
    expect(placeByOrganisation(parsed, ENTITIES).lines.map((l) => l.entity_id)).toEqual(["e-1", "e-2"]);
    // "Acme" sits inside both names: no guess.
    expect(placeByOrganisation({ ...parsed, report: { organisation: "Acme" } }, ENTITIES).lines[0].entity_id).toBe(null);
  });
});

describe("edits and steps", () => {
  it("checks each edited field", () => {
    expect(editInput({ entity: "acme-holdings", concern: "business_purpose", note: " hi " }, ENTITIES)).toEqual({ set: { entity_id: "e-2", concern: "business_purpose", note: "hi" }, issues: [] });
    expect(editInput({ entity: "nope", concern: "x", amount: "0", txn_date: "2025-13-01" }, ENTITIES).issues).toHaveLength(4);
  });

  it("needs a company for a hand-added item", () => {
    expect(newItemInput({ txn_date: "2025-01-01", payee: "x", amount: 10 }, ENTITIES).issues).toContain("choose the company");
    expect(newItemInput({ txn_date: "2025-01-01", payee: "x", amount: 10, entity: "acme-ltd" }, ENTITIES).issues).toEqual([]);
  });

  it("accepts a candidate only with a company and no live twin", () => {
    expect(stepIssues("accept", { state: "candidate", entity_id: null })).toContain("choose the company first");
    expect(stepIssues("accept", { state: "candidate", entity_id: "e-1" }, { duplicateState: "open" })[0]).toMatch(/repeats/);
    expect(stepIssues("accept", { state: "candidate", entity_id: "e-1" }, { duplicateState: "open", allowDuplicate: true })).toEqual([]);
    expect(stepIssues("accept", { state: "open", entity_id: "e-1" })[0]).toMatch(/applies to candidate/);
  });

  it("lets only the CFO close an item without its document, with a reason", () => {
    const open = { state: "open", entity_id: "e-1" };
    expect(stepIssues("accept_without", open, { role: "Accountant", reason: "x".repeat(20) })).toContain("only the CFO closes an item without its document");
    expect(stepIssues("accept_without", open, { role: "Fractional Finance Director", reason: "too short" })[0]).toMatch(/at least 15/);
    expect(stepIssues("accept_without", open, { role: "Chief Financial Officer", reason: "Supplier closed, cannot obtain" })).toEqual([]);
  });

  it("moves to the right state", () => {
    expect(stepTarget("accept", { state: "candidate" })).toBe("open");
    expect(stepTarget("reopen", { state: "dismissed" })).toBe("candidate");
    expect(stepTarget("reopen", { state: "received" })).toBe("open");
    expect(stepTarget("chased", { state: "open" })).toBe("open");
  });
});

describe("summary", () => {
  it("sums open items by concern, company and month, with VAT flagged", () => {
    const items = [
      { state: "open", txn_date: "2025-01-29", direction: "spent", amount: 930.31, currency: "GBP", concern: "no_vat_invoice", entity_slug: "acme-ltd" },
      { state: "open", txn_date: "2025-01-03", direction: "spent", amount: 20, currency: "GBP", concern: "business_purpose", entity_slug: "acme-ltd" },
      { state: "open", txn_date: "2025-02-09", direction: "spent", amount: 1840, currency: "USD", concern: "overseas_reverse_charge", entity_slug: "acme-holdings" },
      { state: "candidate", txn_date: "2025-02-09", direction: "spent", amount: 5, currency: "GBP", concern: "other", entity_slug: null },
      { state: "received", txn_date: "2025-02-09", direction: "spent", amount: 999, currency: "GBP", concern: "other", entity_slug: "acme-ltd" },
    ];
    const s = summary(items, { threshold: 25 });
    expect(s.open).toEqual({ count: 3, value: 950.31, unknown_gbp: 1 });
    expect(s.candidates).toBe(1);
    expect(s.by_concern.no_vat_invoice).toEqual({ count: 1, value: 930.31, unknown_gbp: 0 });
    expect(Object.keys(s.by_month)).toEqual(["2025-01", "2025-02"]);
    expect(s.by_company["acme-ltd"].count).toBe(2);
    expect(s.vat).toEqual({ flagged: 1, at_risk_max: 155.05, threshold: 25 });
    expect(s.oldest).toBe("2025-01-03");
  });
});

describe("card holder or processor", () => {
  it("is read from a report line and can be edited", async () => {
    const { normaliseLine, editInput, holderName } = await import("./outstanding-docs");
    expect(normaliseLine({ date: "2026-09-30", payee: "x", amount: 1, card_holder: "  Jo   Bloggs " }).line.card_holder).toBe("Jo Bloggs");
    expect(normaliseLine({ date: "2026-09-30", payee: "x", amount: 1, card_holder: "null" }).line.card_holder).toBe(null);
    expect(editInput({ card_holder: "Sam Smith" }, []).set).toEqual({ card_holder: "Sam Smith" });
    expect(holderName("")).toBe(null);
  });

  it("is found for lines already loaded, text only, keeping only the ids asked", async () => {
    const { buildHoldersRequest, parseHolders } = await import("./outstanding-docs");
    const req = buildHoldersRequest([{ id: "a", payee: "Cafe", reference: "Cafe - Jo Bloggs" }]);
    expect(req.contents[0].parts).toHaveLength(1);
    expect(req.contents[0].parts[0].text).toMatch(/a\tCafe\tCafe - Jo Bloggs$/);
    expect(parseHolders(JSON.stringify({ holders: [{ id: "a", card_holder: "Jo Bloggs" }, { id: "zz", card_holder: "Not asked" }, { id: "a", card_holder: "Twice" }] }), ["a", "b"]))
      .toEqual({ a: "Jo Bloggs" });
    expect(() => parseHolders("nope", ["a"])).toThrow(/not valid JSON/);
  });
});

describe("exportSheets", () => {
  it("gives a summary, every item, then a tab per card holder by spend, no one last", async () => {
    const { exportSheets, ITEM_COLUMNS } = await import("./outstanding-docs");
    const it = (o) => ({ state: "open", direction: "spent", currency: "GBP", amount: 10, concern: "no_vat_invoice", payee: "P", txn_date: "2026-10-01", entity_name: "Alpha", vat: { flagged: false, at_risk_max: null }, ...o });
    const items = [
      it({ card_holder: "Jo Bloggs", amount: 100, vat: { flagged: true, at_risk_max: 16.67 } }),
      it({ card_holder: "jo  bloggs", amount: 50, txn_date: "2026-09-01" }),
      it({ card_holder: "Sam Smith", amount: 500 }),
      it({ card_holder: null, amount: 1000 }),
      it({ card_holder: "Sam Smith", direction: "received", amount: 20, concern: "audit_evidence" }),
      it({ card_holder: "Ann Lee", currency: "USD", amount: 20, amount_gbp: 15 }),
    ];
    const sheets = exportSheets(items, { clientName: "Sample Ltd", asAt: "10 November 2026", threshold: 25 });
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "All items", "Sam Smith", "Jo Bloggs", "Ann Lee", "No card holder"]);
    expect(sheets[1].rows).toHaveLength(6);
    const jo = sheets[3];
    expect(jo.rows.map((r) => r[0])).toEqual(["2026-09-01", "2026-10-01"]);
    const col = (h) => ITEM_COLUMNS.findIndex((c) => c.header === h);
    expect(jo.rows[1][col("Spent £")]).toBe(100);
    expect(jo.rows[1][col("VAT not recoverable")]).toBe("Yes");
    expect(sheets[2].rows.find((r) => r[col("Received £")] === 20)[col("Spent £")]).toBe(null);
    expect(sheets[4].rows[0][col("Spent £")]).toBe(15);
    expect(jo.totals.sum).toEqual([col("Spent £"), col("Received £"), col("VAT at risk, up to £")]);
    const total = sheets[0].lines.find((l) => l.cells?.[0]?.value === "Total");
    expect(total.cells.map((c) => c.value)).toEqual(["Total", 6, 1665, 20, 16.67]);
  });
});

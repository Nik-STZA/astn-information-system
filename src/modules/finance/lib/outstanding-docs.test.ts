import { describe, expect, it } from "vitest";
import { amountText, byMonth, byUpload, carriedAt, fileProblem, filtered, inBatches, isDocsPath, monthLabel, type DocItem, type DocUpload } from "./outstanding-docs";

const item = (o: Partial<DocItem>): DocItem => ({
  id: "i", state: "open", entity_slug: "alpha", entity_name: "Alpha", bank_account: "Main", txn_date: "2025-01-29", payee: "Utility Co",
  reference: null, direction: "spent", amount: 120, currency: "GBP", amount_gbp: null, concern: "no_vat_invoice", note: null,
  source: "upload", upload_id: null, upload_name: null, source_line: null, duplicate_of: null, created_by: "x", created_at: "",
  opened_at: null, last_chased_at: null, chase_count: 0, closed_at: null, closed_by: null, close_reason: null,
  card_holder: null, vat: { flagged: true, at_risk_max: 20, reason: null }, ...o,
});

describe("fileProblem", () => {
  it("lets PDFs, workbooks and CSVs through and says why not for the rest", () => {
    expect(fileProblem({ name: "Rec July.PDF", size: 10 })).toBe(null);
    expect(fileProblem({ name: "rec.xlsx", size: 10 })).toBe(null);
    expect(fileProblem({ name: "rec.xls", size: 10 })).toMatch(/save it as .xlsx/);
    expect(fileProblem({ name: "photo.png", size: 10 })).toMatch(/not a PDF/);
    expect(fileProblem({ name: "big.pdf", size: 9 * 1024 * 1024 })).toMatch(/over 8 MB/);
    expect(fileProblem({ name: "none.csv", size: 0 })).toBe("empty");
  });
});

describe("inBatches", () => {
  it("never runs more than the limit at once, and runs every item", async () => {
    let live = 0, most = 0;
    const seen: number[] = [];
    await inBatches([1, 2, 3, 4, 5], 2, async (n) => {
      live += 1; most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n); live -= 1;
    });
    expect(most).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("display", () => {
  it("writes amounts with their currency and sterling value", () => {
    expect(amountText(item({ amount: 1319.88 }))).toBe("£1,319.88");
    expect(amountText(item({ amount: 20000, currency: "USD", amount_gbp: 15786.85 }))).toBe("USD 20,000.00 (£15,786.85)");
    expect(amountText(item({ direction: "received", amount: 5 }))).toBe("In £5.00");
    expect(monthLabel("2025-07")).toBe("July 2025");
  });

  it("groups the register by month, newest first", () => {
    const g = byMonth([item({ id: "a", txn_date: "2025-01-03" }), item({ id: "b", txn_date: "2025-03-01" }), item({ id: "c", txn_date: "2025-01-29" })]);
    expect(g.map((x) => x.month)).toEqual(["2025-03", "2025-01"]);
    expect(g[1].items.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("groups lines to accept by file, in sheet row order", () => {
    const uploads = [{ id: "u2" }, { id: "u1" }] as DocUpload[];
    const g = byUpload([item({ id: "a", upload_id: "u1", source_line: "R10" }), item({ id: "b", upload_id: "u1", source_line: "R9" }), item({ id: "c", upload_id: "u2" })], uploads);
    expect(g.map((x) => x.upload?.id)).toEqual(["u2", "u1"]);
    expect(g[1].items.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("filters by company, concern and words", () => {
    const list = [item({ id: "a", note: "Flight to Riyadh" }), item({ id: "b", entity_slug: "beta", concern: "business_purpose" })];
    expect(filtered(list, { company: "beta", concern: "", q: "" }).map((x) => x.id)).toEqual(["b"]);
    expect(filtered(list, { company: "", concern: "", q: "riyadh" }).map((x) => x.id)).toEqual(["a"]);
    expect(filtered(list, { company: "", concern: "business_purpose", q: "" }).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("carriedAt", () => {
  it("carries open items dated to the end of the month only", () => {
    const c = carriedAt([
      item({ txn_date: "2026-10-31", amount: 100, vat: { flagged: true, at_risk_max: 16.67, reason: null } }),
      item({ txn_date: "2025-02-01", amount: 20, vat: { flagged: false, at_risk_max: null, reason: null } }),
      item({ txn_date: "2026-11-01", amount: 999 }),
      item({ txn_date: "2026-01-01", state: "received", amount: 999 }),
      item({ txn_date: "2026-01-01", currency: "USD", amount: 50 }),
    ], "2026-10");
    expect(c).toEqual({ count: 3, value: 120, unknown_gbp: 1, vat_flagged: 2, vat_at_risk_max: 36.67, oldest: "2025-02-01" });
  });
});

describe("isDocsPath", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  it("lets through only the routes the page uses", () => {
    for (const p of ["outstanding-documents", "outstanding-documents/settings", "outstanding-documents/bulk", "outstanding-documents/uploads",
      `outstanding-documents/uploads/${id}/read`, `outstanding-documents/${id}`, `outstanding-documents/${id}/accept-without`]) {
      expect(isDocsPath(p)).toBe(true);
    }
    for (const p of ["outstanding-documents/../tasks", `outstanding-documents/uploads/${id}/file`, `outstanding-documents/${id}/delete`, "outstanding-documents/uploads/x/read", "tasks"]) {
      expect(isDocsPath(p)).toBe(false);
    }
  });
});

describe("card holders", () => {
  it("filters by card holder ignoring case, with a no-one choice, and lists one spelling each", async () => {
    const { holders, NO_HOLDER } = await import("./outstanding-docs");
    const list = [item({ id: "a", card_holder: "Jo Bloggs" }), item({ id: "b", card_holder: "jo  bloggs" }), item({ id: "c", card_holder: null }), item({ id: "d", card_holder: "Ann Lee" })];
    expect(holders(list)).toEqual(["Ann Lee", "Jo Bloggs"]);
    expect(filtered(list, { company: "", concern: "", q: "", holder: "JO BLOGGS" }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(filtered(list, { company: "", concern: "", q: "", holder: NO_HOLDER }).map((x) => x.id)).toEqual(["c"]);
  });

  it("lets the export and card holder routes through", () => {
    expect(isDocsPath("outstanding-documents/export.xlsx")).toBe(true);
    expect(isDocsPath("outstanding-documents/card-holders")).toBe(true);
    expect(isDocsPath("outstanding-documents/exportxxlsx")).toBe(false);
  });
});

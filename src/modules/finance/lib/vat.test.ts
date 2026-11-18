import { describe, expect, it } from "vitest";
import { importFileName, isVatPath, periodLabel } from "./vat";

describe("VAT helpers", () => {
  it("lets through only the VAT paths the portal posts to", () => {
    const id = "6e437bfe-1111-4222-8333-444455556666";
    expect(isVatPath("vat/returns")).toBe(true);
    for (const p of ["uploads", "adjustments", "imports", "workbook", "submit", "clearing"]) expect(isVatPath(`vat/returns/${id}/${p}`)).toBe(true);
    expect(isVatPath(`vat/returns/${id}`)).toBe(false);
    expect(isVatPath(`vat/returns/${id}/payments`)).toBe(false);
    expect(isVatPath("vat/returns/not-an-id/uploads")).toBe(false);
  });

  it("names a calendar month as the month, anything else as dates", () => {
    expect(periodLabel("2026-10-01", "2026-10-31")).toBe("Oct 2026");
    expect(periodLabel("2026-08-01", "2026-10-31")).toBe("1 Aug 2026 to 31 Oct 2026");
    expect(importFileName("2026-10-31", 2)).toBe("VAT Return Import 2026-10-31 (2).xlsx");
  });
});

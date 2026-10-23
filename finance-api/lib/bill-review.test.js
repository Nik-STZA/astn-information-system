import { describe, expect, it } from "vitest";
import { parseExtraction, pdfPageCount, documentValue, reviewBill, reviewBatch, buildExtractRequest } from "./bill-review";
import batch from "./fixtures/udl-2026-10-12-batch.json";

const byId = (r, id) => r.bills.find((b) => b.invoice_id.startsWith(id));

// Spec table 5, phase 2 exit: replaying the 12 Oct UDL batch flags all five
// known errors. Keyed at GBP 8,421.29; the documents support GBP 1,105.04.
describe("replay of the 12 Oct 2026 UDL batch", () => {
  const r = reviewBatch(batch);

  it("1. the screenshot of a Xero report, made into two bills", () => {
    for (const id of ["f14a85e3", "351c77bd"]) {
      expect(byId(r, id).flagged).toEqual(expect.arrayContaining(["not_an_invoice", "same_file_twice"]));
    }
  });

  it("2. HK$4,967.97 keyed as GBP", () => {
    const b = byId(r, "b9a80703");
    expect(b.flagged).toContain("currency");
    expect(b.flags.find((f) => f.check === "currency").detail).toBe("document in HKD, bill in GBP");
  });

  it("3. GBP 876.79 of VAT on three Google invoices that show 0%", () => {
    const ids = ["b9a80703", "ceb3dad1", "5fdb9fae"];
    for (const id of ids) expect(byId(r, id).flagged).toContain("vat_not_on_document");
    const phantom = ids.reduce((t, id) => t + Math.round(batch.items.find((i) => i.bill.InvoiceID.startsWith(id)).bill.TotalTax * 100), 0);
    expect(phantom).toBe(87679);
    // Reverse charge is the master's, and the bill does not follow it.
    expect(byId(r, "ceb3dad1").flagged).toContain("vat_treatment");
  });

  it("4. two two-page PDFs, page 2 of each with no bill", () => {
    const missing = r.findings.filter((f) => f.check === "documents_without_bill");
    expect(missing.map((f) => f.document.number).sort()).toEqual(["GB6AXAJUXAEUD", "GB6AXL201AEUD"]);
    expect(missing.map((f) => f.document.value).sort()).toEqual(["28.83", "9.99"]);
    expect(r.summary.documents_without_bill).toBe(2);
  });

  it("5. the two SSD bills are two invoices, not a duplicate", () => {
    for (const id of ["eeab6277", "a361dd68"]) {
      const b = byId(r, id);
      expect(b.flags.find((f) => f.check === "duplicate_cleared_by_number")).toMatchObject({ flagged: false });
      expect(b.flagged).not.toContain("duplicate_same_document");
    }
  });

  it("values each SSD invoice at 74.99, leaving the Amazon-funded credit to the bank", () => {
    const f = byId(r, "eeab6277").flags.find((x) => x.check === "total_vs_document");
    expect(f.flagged).toBe(true);
    expect(f.detail).toMatch(/^bill 73\.98, document 74\.99 \(bill under by 1\.01\); payment credit\(s\) left to bank reconciliation: Funded by Amazon -1\.01/);
  });

  it("also catches Twilio: USD keyed as GBP, no supplier, the wrong date", () => {
    expect(byId(r, "79edc2b4").flagged).toEqual(expect.arrayContaining(["currency", "no_supplier", "date_vs_document"]));
  });

  it("finds the Workspace invoice addressed to someone other than UDL", () => {
    const f = byId(r, "b9a80703").flags.find((x) => x.check === "addressee");
    expect(f.flagged).toBe(true);
    expect(f.detail).toMatch(/^addressed to NAMED INDIVIDUAL.*Hong Kong, not Ultraspeed Digital Limited$/);
  });

  it("passes what is right: the Google Cloud invoice is addressed to UDL by VAT number", () => {
    const b = byId(r, "ceb3dad1");
    expect(b.flags.find((f) => f.check === "addressee").flagged).toBe(false);
    expect(b.flags.find((f) => f.check === "customer_vat_number").flagged).toBe(false);
    expect(b.flags.find((f) => f.check === "pages_unread").flagged).toBe(false);
  });
});

describe("parseExtraction", () => {
  it("normalises numbers and currency, and never keeps more than 4 bank characters", () => {
    const p = parseExtraction(JSON.stringify({ total_pages_read: "2", documents: [{
      document_type: "invoice", page_numbers: ["1"], currency: " gbp", gross_total: "12.50", vat_total: null,
      bank_account_last4: "GB29 NWBK 6016 1331 9268 19", lines: [{ description: "x", net: "10" }],
    }] }));
    expect(p.total_pages_read).toBe(2);
    expect(p.documents[0]).toMatchObject({ currency: "GBP", gross_total: 12.5, vat_total: null, bank_account_last4: "6819", page_numbers: [1] });
    expect(p.documents[0].lines[0]).toEqual({ description: "x", net: 10, vat: null });
  });

  it("refuses an answer that is not JSON", () => {
    expect(() => parseExtraction("not json")).toThrow(/not JSON/);
  });
});

describe("pdfPageCount", () => {
  it("reads the page tree, and says null rather than guess", () => {
    expect(pdfPageCount(Buffer.from("%PDF-1.4\n1 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj"))).toBe(2);
    expect(pdfPageCount(Buffer.from("%PDF-1.4\n3 0 obj << /Type /Page >> endobj"))).toBe(1);
    expect(pdfPageCount(Buffer.from("\x89PNG"))).toBeNull();
  });
});

describe("documentValue", () => {
  it("falls back to the printed gross when there are no lines", () => {
    expect(documentValue({ gross_total: 19.95, lines: [] })).toBe(1995);
  });

  // Smart Numbers, FSL, 23 Oct 2026: the line printed net, the VAT only in the summary.
  it("adds the VAT total once when the lines carry no VAT of their own", () => {
    expect(documentValue({ gross_total: 13.18, vat_total: 2.2, lines: [{ description: "Service Charges", net: 10.98, vat: null }] })).toBe(1318);
    expect(documentValue({ gross_total: 13.18, vat_total: 2.2, lines: [{ description: "Service Charges", net: 10.98, vat: 2.2 }] })).toBe(1318);
  });
});

describe("reviewBill", () => {
  const bill = { InvoiceID: "b1", Status: "DRAFT", Total: 120, TotalTax: 20, CurrencyCode: "GBP", DateString: "2026-10-01T00:00:00",
    Contact: { ContactID: "c1", Name: "Acme" }, LineItems: [{ TaxType: "INPUT2", AccountCode: "429" }] };
  const doc = { document_type: "invoice", page_numbers: [1], currency: "GBP", net_total: 100, vat_total: 20, gross_total: 120,
    document_date: "2026-10-01", customer_name: "Ultraspeed Digital Ltd", lines: [] };
  const entity = { name: "Ultraspeed Digital Limited", vat_number: "GB493735845" };

  it("says when there is nothing to read rather than passing", () => {
    expect(reviewBill({ bill }).flagged).toEqual(["no_document"]);
    expect(reviewBill({ bill, file: { name: "a.pdf" } }).flagged).toEqual(["not_read"]);
  });

  it("is clean when the bill matches its document and the master", () => {
    const r = reviewBill({ bill, entity, today: "2026-10-23", file: { name: "a.pdf", pages: 1 },
      extraction: { documents: [doc] }, supplier: { vat_number: null }, link: { status: "approved", default_tax_type: "INPUT2", default_account_code: "429" } });
    expect(r.flagged).toEqual([]);
  });

  it("sends always-discuss suppliers to the CFO, and flags a new supplier", () => {
    const r = reviewBill({ bill, entity, file: { name: "a.pdf", pages: 1 }, extraction: { documents: [doc] }, supplier: { always_discuss: true }, link: null });
    expect(r.flagged).toEqual(expect.arrayContaining(["not_in_master", "cfo_review"]));
  });

  // Live run, UDL, 23 Oct 2026.
  it("reads 'GB VAT 493735845' as the entity's own VAT number", () => {
    const r = reviewBill({ bill, entity, file: { name: "a.pdf", pages: 1 },
      extraction: { documents: [{ ...doc, customer_name: "X", customer_vat_number: "GB VAT 493735845" }] } });
    expect(r.flags.find((f) => f.check === "customer_vat_number").flagged).toBe(false);
    expect(r.flags.find((f) => f.check === "addressee").flagged).toBe(false);
  });

  it("treats Xero's 'No Contact' placeholder as no supplier", () => {
    const r = reviewBill({ bill: { ...bill, Contact: { ContactID: "14a3c84d", Name: "No Contact" } }, entity,
      file: { name: "a.pdf", pages: 1 }, extraction: { documents: [doc] } });
    expect(r.flagged).toContain("no_supplier");
    expect(r.flagged).not.toContain("not_in_master");
  });

  it("flags VAT on the document the bill does not claim, and lines with no account or tax type", () => {
    const r = reviewBill({ bill: { ...bill, TotalTax: 0, LineItems: [{ LineAmount: 120 }] }, entity,
      file: { name: "a.pdf", pages: 1 }, extraction: { documents: [doc] } });
    expect(r.flagged).toEqual(expect.arrayContaining(["vat_not_claimed", "line_incomplete"]));
    expect(r.flags.find((f) => f.check === "line_incomplete").detail).toBe("1 line(s) without an account or a tax type");
  });

  it("flags a document dated in the future", () => {
    const r = reviewBill({ bill: { ...bill, DateString: "2026-12-08T00:00:00" }, entity, today: "2026-10-23",
      file: { name: "a.pdf", pages: 1 }, extraction: { documents: [{ ...doc, document_date: "2026-12-08" }] } });
    expect(r.flagged).toContain("date_in_future");
  });
});

describe("buildExtractRequest", () => {
  it("sends the file inline with a JSON schema, at temperature 0", () => {
    const b = buildExtractRequest({ document: Buffer.from("x"), mimeType: "application/pdf" });
    expect(b.contents[0].parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: "eA==" });
    expect(b.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0 });
  });
});

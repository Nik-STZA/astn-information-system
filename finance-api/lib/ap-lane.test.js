import { describe, expect, it } from "vitest";
import { screenFile, notADocument, matchSupplier, buildBill, duplicatesOf, alreadyBilled, triage } from "./ap-lane";
import { reviewBill } from "./bill-review";

// One invoice from the 12 Oct 2026 UDL batch, as the extraction read it.
const invoice = {
  document_type: "invoice", page_numbers: [1], supplier_name: "Cable Matters Inc.", supplier_vat_number: "GB727255821",
  customer_name: "Ultraspeed Digital Ltd", document_number: "GB6AYHTG9AEUD", document_date: "2026-09-29", due_date: null,
  currency: "GBP", net_total: 12.49, vat_total: 2.5, gross_total: 14.99,
  lines: [{ description: "USB to Ethernet Adapter", net: 12.49, vat: 2.5 }, { description: "Shipping Charges", net: 0, vat: 0 }],
};
const link = {
  xero_contact_id: "00000000-0000-4000-8000-0000000000a1", xero_contact_name: "Amazon", status: "approved",
  default_account_code: "454", default_tax_type: "INPUT2", payment_terms_days: 0,
  supplier: { legal_name: "Amazon EU S.a r.l.", trading_name: "Amazon", vat_number: "GB 727 2558 21", status: "active" },
};
const entity = { name: "Ultraspeed Digital Limited", vat_number: "GB493735845", pays_tax: true };

describe("screenFile", () => {
  it("reads PDFs and real images, and says why it skips the rest", () => {
    expect(screenFile({ MimeType: "application/pdf", Size: 65516 })).toBeNull();
    expect(screenFile({ MimeType: "image/jpeg", Size: 429811 })).toBeNull();
    // UDL inbox, 26 Oct 2026: signature logos and a text file beside the invoices.
    expect(screenFile({ MimeType: "image/png", Size: 642 })).toMatch(/^image under 20 KB: an email signature/);
    expect(screenFile({ MimeType: "text/plain", Size: 206 })).toBe("not a PDF or image (text/plain)");
    expect(screenFile({ MimeType: "application/pdf", Size: 20e6 })).toBe("over 15 MB");
  });
});

// UDL inbox, 26 Oct 2026: signatures, a banner and a certification logo over
// the image floor, and a cropped spreadsheet of card spend.
describe("notADocument", () => {
  const blank = { gross_total: null, net_total: null, lines: [] };
  it("sets aside a file with no amounts that is not a purchase document", () => {
    for (const type of ["other", "report_or_screenshot", "statement"]) {
      expect(notADocument({ ...blank, document_type: type })).toMatch(/^no amounts on it/);
    }
  });
  it("keeps anything with an amount, and every purchase document", () => {
    expect(notADocument({ ...blank, document_type: "report_or_screenshot", lines: [{ description: "Card spend", net: -341.1 }] })).toBeNull();
    expect(notADocument({ ...blank, document_type: "other", gross_total: 10 })).toBeNull();
    expect(notADocument({ ...blank, document_type: "invoice" })).toBeNull();
  });
});

describe("matchSupplier", () => {
  it("matches by VAT number however it is spaced, before the name", () => {
    expect(matchSupplier(invoice, [link])).toMatchObject({ matched_by: "VAT number", link });
  });

  it("matches by exact normalised name, and not by a near miss", () => {
    const noVat = { ...invoice, supplier_vat_number: null };
    expect(matchSupplier({ ...noVat, supplier_name: "AMAZON" }, [link])?.matched_by).toBe("name");
    expect(matchSupplier({ ...noVat, supplier_name: "Amazon Web Services" }, [link])).toBeNull();
  });
});

describe("buildBill", () => {
  it("builds from the document's lines and the master's defaults", () => {
    const b = buildBill({ doc: invoice, match: { link }, entity });
    expect(b).toMatchObject({
      Type: "ACCPAY", Contact: { ContactID: link.xero_contact_id }, InvoiceNumber: "GB6AYHTG9AEUD", Reference: "GB6AYHTG9AEUD",
      DateString: "2026-09-29T00:00:00", DueDateString: "2026-09-29T00:00:00", CurrencyCode: "GBP",
      LineAmountTypes: "Exclusive", Total: 14.99, TotalTax: 2.5,
    });
    expect(b.LineItems.map((l) => [l.LineAmount, l.AccountCode, l.TaxType])).toEqual([[12.49, "454", "INPUT2"], [0, "454", "INPUT2"]]);
  });

  it("passes the phase 2 review clean", () => {
    const bill = buildBill({ doc: invoice, match: { link }, entity });
    const review = reviewBill({ bill, entity, file: { name: "a.pdf", pages: 1 }, extraction: { documents: [invoice] }, supplier: link.supplier, link });
    expect(review.flagged).toEqual([]);
    expect(triage({ review, doc: invoice, match: { link }, bill })).toEqual({ state: "clean", reasons: [] });
  });

  // A hotel folio: lines printed with VAT, the card payment as the last line.
  it("leaves out a settlement line and keeps VAT-inclusive lines inclusive", () => {
    const folio = { ...invoice, net_total: 618.46, vat_total: 122.87, gross_total: 741.33,
      lines: [...[225, 225, 19.5, 227, 36.75, 4, 4.08].map((net) => ({ description: "Room", net, vat: null })), { description: "VISA-0000", net: -741.33, vat: null }] };
    const b = buildBill({ doc: folio, match: { link }, entity });
    expect(b.LineAmountTypes).toBe("Inclusive");
    expect(b.LineItems).toHaveLength(7);
    expect([b.Total, b.TotalTax]).toEqual([741.33, 122.87]);
  });

  it("takes the due date from the supplier's terms when the document has none", () => {
    expect(buildBill({ doc: invoice, match: { link: { ...link, payment_terms_days: 30 } }, entity }).DueDateString).toBe("2026-10-29T00:00:00");
    expect(buildBill({ doc: invoice, match: { link: { ...link, payment_terms_days: null } }, entity }).DueDateString).toBeNull();
    // A receipt was paid when issued (a till receipt, UDL inbox, 26 Oct 2026).
    expect(buildBill({ doc: { ...invoice, document_type: "receipt" }, match: { link: { ...link, payment_terms_days: null } }, entity }).DueDateString).toBe("2026-09-29T00:00:00");
  });

  it("claims no VAT under a no-reclaim treatment, and none for an entity not registered", () => {
    expect(buildBill({ doc: invoice, match: { link: { ...link, default_tax_type: "REVERSECHARGES" } }, entity }).TotalTax).toBe(0);
    const stza = buildBill({ doc: invoice, match: { link }, entity: { pays_tax: false } });
    expect(stza).toMatchObject({ LineAmountTypes: "NoTax", Total: 14.99, TotalTax: 0 });
    expect(stza.LineItems).toEqual([expect.objectContaining({ LineAmount: 14.99, TaxType: "NONE", AccountCode: "454" })]);
  });

  it("leaves account and VAT blank for a supplier not in the master, which the CFO then sees", () => {
    const bill = buildBill({ doc: invoice, match: null, entity });
    expect(bill.Contact).toEqual({ Name: "Cable Matters Inc." });
    const review = reviewBill({ bill, entity, file: { name: "a.pdf", pages: 1 }, extraction: { documents: [invoice] } });
    const t = triage({ review, doc: invoice, match: null, bill });
    expect(t.state).toBe("exception");
    expect(t.reasons.map((r) => r.check)).toEqual(expect.arrayContaining(["no_supplier", "line_incomplete"]));
  });
});

// UDL inbox, 26 Oct 2026: invoices whose bills were keyed another way and paid.
describe("alreadyBilled", () => {
  const bill = buildBill({ doc: invoice, match: { link }, entity });
  const paid = { id: "x1", contact_id: link.xero_contact_id, number: "GB6AYHTG9AEUD", date: "2026-09-29", total: 14.99, status: "PAID" };

  it("is certain on the same number and the same supplier or total", () => {
    expect(alreadyBilled(bill, [paid])).toBe(paid);
    expect(alreadyBilled(bill, [{ ...paid, contact_id: "merged-away", total: 14.99 }])?.id).toBe("x1");
  });

  it("is not certain on a number alone, or with no number", () => {
    expect(alreadyBilled(bill, [{ ...paid, contact_id: "another-supplier", total: 99 }])).toBeNull();
    expect(alreadyBilled({ ...bill, InvoiceNumber: "" }, [paid])).toBeNull();
  });
});

describe("duplicatesOf and triage", () => {
  const bill = buildBill({ doc: invoice, match: { link }, entity });

  it("finds the same supplier's bill by number, or by date and total", () => {
    const others = [
      { source: "xero", contact_id: link.xero_contact_id, number: "gb6ayhtg9aeud", date: "2026-01-01", total: 1 },
      { source: "queue", contact_id: link.xero_contact_id, number: "X", date: "2026-09-29", total: 14.99 },
      { source: "xero", contact_id: "someone-else", number: "GB6AYHTG9AEUD", date: "2026-09-29", total: 14.99 },
    ];
    expect(duplicatesOf(bill, others).map((d) => d.source)).toEqual(["xero", "queue"]);
  });

  it("sends a duplicate, an inactive supplier and the reader's doubts to the CFO", () => {
    const t = triage({
      review: { flags: [] }, doc: { ...invoice, doubts: "page 2 blurred" }, bill,
      match: { link: { ...link, supplier: { ...link.supplier, status: "dormant" } } },
      duplicates: [{ source: "xero", number: "GB6AYHTG9AEUD", date: "2026-09-29", total: 14.99 }],
    });
    expect(t.state).toBe("exception");
    expect(t.reasons.map((r) => r.check)).toEqual(["supplier_status", "duplicate", "reader_doubts"]);
  });
});

// Step 3: the CFO's decision and the send (phase3-design.md, one approval per
// bill: a clean item goes to Xero at SUBMITTED; an exception is decided first).
import { applyEdits, decide, sendRequest } from "./ap-lane";

describe("step 3", () => {
  const bill = buildBill({ doc: invoice, match: { link }, entity });
  const item = { state: "clean", file_name: "a.pdf", proposed_bill: bill };

  it("builds the bill write at SUBMITTED from a clean item", () => {
    const { body, issues } = sendRequest(item);
    expect(issues).toEqual([]);
    expect(body).toMatchObject({
      type: "ACCPAY", status: "SUBMITTED", contact_id: link.xero_contact_id, date: "2026-09-29", due_date: "2026-09-29",
      number: "GB6AYHTG9AEUD", reference: "GB6AYHTG9AEUD", currency_code: "GBP", line_amount_types: "Exclusive",
    });
    expect(body.lines[0]).toEqual({ description: "USB to Ethernet Adapter", quantity: "1", unit_amount: "12.49", account_code: "454", tax_type: "INPUT2" });
    expect(body.audit_note).toMatch(/Documents inbox \(a\.pdf\)/);
  });

  it("refuses to send an exception, or a bill with no supplier, account or VAT", () => {
    expect(sendRequest({ ...item, state: "exception" }).issues).toContain("only a clean or approved item is sent; this item is exception");
    const bare = buildBill({ doc: invoice, match: null, entity });
    expect(sendRequest({ ...item, proposed_bill: bare }).issues).toEqual(expect.arrayContaining([
      "no Xero supplier: choose one first", "line 1 has no account", "line 1 has no VAT treatment",
    ]));
  });

  it("approves an exception with the CFO's supplier and coding, then it can be sent", () => {
    const bare = buildBill({ doc: invoice, match: null, entity });
    const d = decide({ state: "exception", proposed_bill: bare }, { action: "approve", edits: {
      contact: { ContactID: link.xero_contact_id, Name: "Amazon" },
      lines: [{ index: 0, account_code: "454", tax_type: "INPUT2" }, { index: 1, account_code: "454", tax_type: "INPUT2" }],
    } });
    expect(d).toMatchObject({ issues: [], state: "approved" });
    expect(sendRequest({ ...item, state: "approved", proposed_bill: d.bill }).issues).toEqual([]);
  });

  it("needs a reason to reject, and only decides an item once", () => {
    expect(decide({ state: "exception", proposed_bill: bill }, { action: "reject" }).issues).toEqual(["a reason is required to reject"]);
    expect(decide({ state: "exception", proposed_bill: bill }, { action: "reject", note: "Not ours" })).toMatchObject({ state: "rejected", note: "Not ours" });
    expect(decide({ state: "written", proposed_bill: bill }, { action: "approve" }).issues).toEqual(["only an unsent item is approved here; this item is written"]);
    // A clean bill re-coded before it is sent.
    const recoded = decide({ state: "clean", proposed_bill: bill }, { action: "approve", edits: { lines: [{ index: 0, account_code: "463" }] } });
    expect(recoded).toMatchObject({ issues: [], state: "approved" });
    expect(recoded.bill.LineItems[0].AccountCode).toBe("463");
    expect(applyEdits(bill, { lines: [{ index: 9, account_code: "1" }] }).issues).toEqual(["there is no line 9"]);
  });
});

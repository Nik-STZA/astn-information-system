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
      contact: { ContactID: link.xero_contact_id, Name: "Amazon" }, due_date: "2026-10-29",
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

// Drafts Xero keyed from documents emailed to its bills address (FSL, 27 Oct
// 2026): the engine reads the attachment, proposes its own bill, and sending
// updates the draft in place.
import { draftVersion, billFromDraft, draftDifferences } from "./ap-lane";

describe("drafts Xero keyed", () => {
  // What Xero's own extraction keyed from the same document: the right
  // supplier and total, no number, one VAT-inclusive line on another account.
  const draft = {
    InvoiceID: "00000000-0000-4000-8000-0000000000d1", Type: "ACCPAY", Status: "DRAFT", InvoiceNumber: "",
    Contact: { ContactID: link.xero_contact_id, Name: "Amazon" }, DateString: "2026-09-29T00:00:00", CurrencyCode: "GBP",
    LineAmountTypes: "Inclusive", Total: 14.99,
    LineItems: [{ Description: "Invoice from Cable Matters", LineAmount: 14.99, AccountCode: "429", TaxType: "INPUT2" }],
    UpdatedDateUTC: "/Date(1793099040013+0000)/", UpdatedDateUTCString: "2026-10-27T11:04:00Z",
  };

  it("versions a draft by its last-changed stamp", () => {
    expect(draftVersion(draft)).toBe("1793099040013");
    expect(draftVersion({ UpdatedDateUTCString: "2026-10-27T11:04:00Z" })).toBe(String(Date.parse("2026-10-27T11:04:00Z")));
    expect(draftVersion({})).toBeNull();
  });

  it("keeps the engine's bill and takes only blanks from the draft", () => {
    const { bill, filled } = billFromDraft(buildBill({ doc: invoice, match: { link }, entity }), draft);
    expect(bill.InvoiceID).toBe(draft.InvoiceID);
    expect(bill.InvoiceNumber).toBe("GB6AYHTG9AEUD");
    expect(bill.LineItems.map((l) => l.AccountCode)).toEqual(["454", "454"]);
    expect(filled).toEqual([]);
  });

  it("carries over the draft's supplier, number and coding where the master has none, as a suggestion", () => {
    const doc = { ...invoice, document_number: null, lines: [{ description: "USB to Ethernet Adapter", net: 14.99, vat: null }], net_total: null, vat_total: null };
    const { bill, filled } = billFromDraft(buildBill({ doc, match: null, entity }), { ...draft, InvoiceNumber: "K-1" });
    expect(bill.Contact).toEqual({ ContactID: link.xero_contact_id, Name: "Amazon" });
    expect(bill.InvoiceNumber).toBe("K-1");
    expect(bill.LineItems[0]).toMatchObject({ AccountCode: "429", TaxType: "INPUT2" });
    expect(filled).toEqual(["line 1 account 429", "line 1 VAT INPUT2"]);
  });

  it("separates a different bill from different coding", () => {
    const { bill } = billFromDraft(buildBill({ doc: invoice, match: { link }, entity }), draft);
    expect(draftDifferences(bill, draft)).toEqual({
      blocking: [],
      coding: [{ field: "lines", keyed: 1, proposed: 2 }, { field: "amounts are", keyed: "Inclusive", proposed: "Exclusive" }],
    });
    const wrong = { ...draft, Total: 149.9, DateString: "2026-09-30T00:00:00", InvoiceNumber: "OTHER" };
    expect(draftDifferences(bill, wrong).blocking.map((d) => d.field)).toEqual(["number", "date", "total"]);
  });

  it("sends a draft that differs, or coding taken from Xero, to the CFO", () => {
    const { bill } = billFromDraft(buildBill({ doc: invoice, match: { link }, entity }), draft);
    const clean = triage({ review: { flags: [] }, doc: invoice, match: { link }, bill,
      draft: { differences: draftDifferences(bill, draft), filled: [], attachments: 1, documents: 1 } });
    expect(clean).toEqual({ state: "clean", reasons: [] });
    const t = triage({ review: { flags: [] }, doc: invoice, match: { link }, bill, draft: {
      differences: draftDifferences(bill, { ...draft, Total: 149.9 }), filled: ["line 1 account 429"], attachments: 2, documents: 2 } });
    expect(t.state).toBe("exception");
    expect(t.reasons.map((r) => r.check)).toEqual(["draft_differs", "coding_from_xero", "several_attachments", "several_documents"]);
    expect(t.reasons[0].detail).toBe("Xero keyed the total as 149.9; the document says 14.99");
  });

  it("sends a draft item as an update of that draft", () => {
    const { bill } = billFromDraft(buildBill({ doc: invoice, match: { link }, entity }), draft);
    const item = { state: "clean", file_name: "inv.pdf", proposed_bill: bill, source: "ledger_draft", ledger_draft_id: draft.InvoiceID };
    const { body, issues } = sendRequest(item);
    expect(issues).toEqual([]);
    expect(body).toMatchObject({ id: draft.InvoiceID, status: "SUBMITTED", number: "GB6AYHTG9AEUD" });
    expect(body.audit_note).toMatch(/^Draft keyed by Xero from inv\.pdf/);
    expect(sendRequest({ ...item, ledger_draft_id: null }).issues).toContain("the Xero draft this item came from is not recorded");
    // An inbox item still creates a new bill.
    expect(sendRequest({ ...item, source: "files_inbox" }).body.id).toBeUndefined();
  });
});

describe("due date before a send", () => {
  // FSL, 27 Oct 2026: a retainer invoice with no due date; Xero refused the
  // bill at SUBMITTED ("Due Date cannot be empty").
  const noDue = { ...buildBill({ doc: invoice, match: { link: { ...link, payment_terms_days: null } }, entity }), DueDateString: null };

  it("refuses to send a bill with no due date", () => {
    expect(sendRequest({ state: "approved", file_name: "a.pdf", proposed_bill: noDue }).issues)
      .toEqual(["no due date: set one first (Xero needs it on a bill awaiting approval)"]);
  });

  it("lets the CFO set the due date, not before the bill's date", () => {
    const d = decide({ state: "exception", proposed_bill: noDue }, { action: "approve", edits: { due_date: "2026-11-01" } });
    expect(d.issues).toEqual([]);
    expect(d.bill.DueDateString).toBe("2026-11-01T00:00:00");
    expect(sendRequest({ state: "approved", file_name: "a.pdf", proposed_bill: d.bill }).body.due_date).toBe("2026-11-01");
    expect(decide({ state: "exception", proposed_bill: noDue }, { action: "approve", edits: { due_date: "2026-09-01" } }).issues)
      .toEqual(["the due date is before the bill's date"]);
    expect(decide({ state: "exception", proposed_bill: noDue }, { action: "approve", edits: { due_date: "1 Nov" } }).issues)
      .toEqual(["the due date must be a date (YYYY-MM-DD)"]);
  });
});

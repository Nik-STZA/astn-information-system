import { describe, it, expect } from "vitest";
import { agentDocuments, fileBlocks, MAX_BYTES } from "./agent-documents";

const job = { client: { slug: "jo-bloggs" } };
const pdf = { contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7") };
const id = "11111111-2222-3333-4444-555555555555";

describe("fileBlocks", () => {
  it("gives a PDF to the model as a document and an image as an image", () => {
    expect(fileBlocks(pdf, "x").blocks[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(fileBlocks({ contentType: "image/png; charset=binary", bytes: Buffer.from("a") }, "x").blocks[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
  });

  it("says plainly what it cannot open", () => {
    expect(fileBlocks({ contentType: "text/csv", bytes: Buffer.from("a") }, "x").error).toMatch(/cannot be opened/);
    expect(fileBlocks({ contentType: "application/pdf", bytes: Buffer.alloc(0) }, "x").error).toMatch(/empty/);
    expect(fileBlocks({ contentType: "application/pdf", bytes: Buffer.alloc(MAX_BYTES + 1) }, "x").error).toMatch(/over the 10 MB limit/);
  });
});

describe("agentDocuments", () => {
  const calls = [];
  const docs = agentDocuments({ apiBytes: async (p) => { calls.push(p); return pdf; } });

  it("opens a queue item's document through finance-api", async () => {
    const r = await docs.call(job, "read_bill_document", { entity: "jo-trading", item_id: id });
    expect(r.blocks[0].type).toBe("document");
    expect(calls.at(-1)).toBe(`/api/finance/clients/jo-bloggs/xero/jo-trading/ap/items/${id}/file`);
  });

  it("opens a record's attachment by name, with the name encoded", async () => {
    await docs.call(job, "read_attachment", { entity: "jo-trading", record_type: "invoice", record_id: id, file_name: "a b/c.pdf" });
    expect(calls.at(-1)).toBe(`/api/finance/clients/jo-bloggs/xero/jo-trading/read/invoices/${id}/attachments/a%20b%2Fc.pdf`);
  });

  it("refuses ids and record types that did not come from a tool", async () => {
    const n = calls.length;
    expect((await docs.call(job, "read_bill_document", { entity: "e", item_id: "../x" })).error).toBeTruthy();
    expect((await docs.call(job, "read_attachment", { entity: "e", record_type: "payroll", record_id: id, file_name: "x" })).error).toBeTruthy();
    expect((await docs.call(job, "read_attachment", { entity: "e", record_type: "invoice", record_id: "x", file_name: "x" })).error).toBeTruthy();
    expect(calls.length).toBe(n);
  });
});

// Document tools for the agent runner (30 Oct 2026): the agent opens the real
// file, as it does in Cowork, instead of working from the engine's reading of it.
//
// The bytes come through finance-api, which holds the Xero token. A tool result
// here carries Anthropic content blocks (a document or an image) rather than
// JSON, so the file reaches the model as a file.

const NAMES = ["read_bill_document", "read_attachment"];

// The same record types as lib/agent-ledger.js list_attachments.
const RECORD_TYPES = {
  invoice: "invoices", credit_note: "credit-notes", bank_transaction: "bank-transactions",
  manual_journal: "manual-journals", contact: "contacts", bank_transfer: "bank-transfers",
};

// The API takes larger, but a file this size is a scan to read by hand.
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const isGuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

// The content blocks for a file, or { error } for one the model cannot open.
function fileBlocks({ contentType, bytes }, label) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!bytes?.length) return { error: `${label} is empty.` };
  if (bytes.length > MAX_BYTES) return { error: `${label} is ${Math.round(bytes.length / 1048576)} MB, over the 10 MB limit. Say you could not open it.` };
  const data = bytes.toString("base64");
  const source = { type: "base64", media_type: type, data };
  if (type === "application/pdf") return { blocks: [{ type: "document", source }, { type: "text", text: `${label}, opened above.` }] };
  if (IMAGES.includes(type)) return { blocks: [{ type: "image", source }, { type: "text", text: `${label}, opened above.` }] };
  return { error: `${label} is ${type || "an unknown type"}, which cannot be opened. Say so.` };
}

function tools(entityEnum) {
  const entity = { type: "string", enum: entityEnum, description: "Entity slug" };
  return [
    {
      name: "read_bill_document",
      description:
        "Open the actual document behind a Bills queue item, so you read it yourself rather than relying on what the engine " +
        "extracted. Use it on every bill you code or review.",
      input_schema: {
        type: "object",
        properties: { entity, item_id: { type: "string", description: "Queue item id from list_bills_queue" } },
        required: ["entity", "item_id"],
      },
    },
    {
      name: "read_attachment",
      description:
        "Open a file attached to a Xero record (a bill's invoice, a bank line's receipt, a journal's support). Get the file " +
        "name from list_attachments.",
      input_schema: {
        type: "object",
        properties: {
          entity,
          record_type: { type: "string", enum: Object.keys(RECORD_TYPES) },
          record_id: { type: "string", description: "The record's id" },
          file_name: { type: "string", description: "The file name from list_attachments" },
        },
        required: ["entity", "record_type", "record_id", "file_name"],
      },
    },
  ];
}

// apiBytes(path) gives { contentType, bytes } and throws on a non-2xx answer.
function agentDocuments({ apiBytes }) {
  const base = (job, entity) =>
    `/api/finance/clients/${encodeURIComponent(job.client.slug)}/xero/${encodeURIComponent(entity)}`;

  async function call(job, name, input) {
    if (name === "read_bill_document") {
      if (!isGuid(input.item_id)) return { error: "item_id must be an id from list_bills_queue" };
      const file = await apiBytes(`${base(job, input.entity)}/ap/items/${encodeURIComponent(input.item_id)}/file`);
      return fileBlocks(file, "The document");
    }
    if (name === "read_attachment") {
      const resource = RECORD_TYPES[input.record_type];
      if (!resource) return { error: `record_type must be one of ${Object.keys(RECORD_TYPES).join(", ")}` };
      if (!isGuid(input.record_id)) return { error: "record_id must be an id from an earlier tool result" };
      const file = await apiBytes(
        `${base(job, input.entity)}/read/${resource}/${input.record_id}/attachments/${encodeURIComponent(input.file_name)}`);
      return fileBlocks(file, input.file_name);
    }
    return { error: `Unknown tool: ${name}` };
  }

  return { tools, call, names: NAMES };
}

module.exports = { agentDocuments, fileBlocks, NAMES, MAX_BYTES };

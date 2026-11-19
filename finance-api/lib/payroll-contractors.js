// Contractors in the capitalisation (migration 066). Pure: lib/payroll-routes.js
// reads Xero and Secret Manager.
//
// A contractor invoices the payroll company, often through an umbrella company
// whose bill names the person on the line ("... services of <name>"). The
// platform knows the contractor only by a code (C1, C2, ...). Its settings hold
// the supplier's Xero contact and a keyed fingerprint of one word of the
// person's name: HMAC-SHA256 under a key kept in Secret Manager, so the stored
// value cannot be turned back into the name without the key. Each month the
// supplier's approved bills dated in the month are read, every word on each
// line is fingerprinted the same way, and the lines that match are the
// contractor's cost, net of VAT.

const crypto = require("crypto");
const { toPence, fromPence } = require("./journal");

const CODE = /^C[0-9]{1,3}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;
const KEY_SECRET = "payroll-match-key";
// Approved bills only: a draft can still change, and a voided one is not a cost.
const BILL_STATUSES = ["AUTHORISED", "PAID"];

const fingerprint = (key, word) => crypto.createHmac("sha256", key).update(String(word).toLowerCase()).digest("hex");
// The words of a line, as fingerprinted: letters (with ' and -) only.
const wordsOf = (text) => String(text ?? "").toLowerCase().split(/[^a-z'À-ɏ-]+/).filter((w) => w.length >= 2);

function contractorsIssues(list) {
  if (!Array.isArray(list)) return ["contractors must be a list"];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== "object") { out.push("each contractor is { code, contact_id, match }"); continue; }
    if (!CODE.test(String(c.code ?? ""))) out.push(`${c.code} is not a contractor code (C1, C2, ...)`);
    else if (seen.has(c.code)) out.push(`contractor ${c.code} is listed twice`);
    seen.add(c.code);
    if (!GUID.test(String(c.contact_id ?? ""))) out.push(`contractor ${c.code}: contact_id must be the supplier's Xero ContactID`);
    if (!HEX.test(String(c.match ?? ""))) out.push(`contractor ${c.code}: match must be the fingerprint, never the name`);
  }
  return out;
}

// Xero's where clause for one supplier's bills dated in the month.
function billsWhere(contactId, period) {
  if (!GUID.test(String(contactId))) throw new Error("contact_id is not a Xero ContactID");
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `Type=="ACCPAY" AND Contact.ContactID==guid("${contactId}") AND Date>=DateTime(${y},${m},1) AND Date<=DateTime(${y},${m},${last})`;
}

// A line's amount before VAT, in pence.
function netPence(line, amountTypes) {
  const amount = toPence(Number(line.LineAmount ?? 0));
  return amountTypes === "Inclusive" ? amount - toPence(Number(line.TaxAmount ?? 0)) : amount;
}

// { code: { cost, bills } } from the bills read for each contractor's supplier.
//   bills   [Xero invoice], for any of the suppliers
//   key     the fingerprint key
function costsFromBills(bills, contractors, key, period) {
  const out = {};
  for (const c of contractors) {
    let pence = 0;
    const numbers = new Set();
    for (const b of bills) {
      if (b.Type !== "ACCPAY" || b.Contact?.ContactID !== c.contact_id || !BILL_STATUSES.includes(b.Status)) continue;
      if (String(b.DateString ?? "").slice(0, 7) !== period) continue;
      for (const line of b.LineItems ?? []) {
        if (!wordsOf(line.Description).some((w) => fingerprint(key, w) === c.match)) continue;
        pence += netPence(line, b.LineAmountTypes);
        numbers.add(String(b.InvoiceNumber || b.InvoiceID));
      }
    }
    out[c.code] = { cost: Number(fromPence(pence)), bills: [...numbers] };
  }
  return out;
}

module.exports = { CODE, KEY_SECRET, BILL_STATUSES, fingerprint, wordsOf, contractorsIssues, billsWhere, costsFromBills };

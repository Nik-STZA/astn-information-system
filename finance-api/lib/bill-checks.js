// The deterministic checks over one supplier bill. Ported from the laptop
// MCP's check_bill (xero-server.py), so the portal and the laptop flag the
// same things.
//
// Every rule was derived from STZA's own 153 supplier bills rather than from
// what sounded sensible, and two plausible rules died in the process:
//
//   - "same supplier, same amount, within N days" is unusable at any N. At 31
//     days it raised 135 false pairs: every monthly subscription in the ledger.
//     Same supplier, same amount, SAME DAY raised 5, of which 4 were worth
//     reading. Monthly billing cannot collide on a date.
//   - "an invoice number is unique" is false where a supplier's number is a
//     label. One contact carried "Expense Claims" on 60 bills. A number on more
//     than LABEL_THRESHOLD bills identifies nothing, so it is reported as a
//     data-quality gap instead of sixty duplicates.
//
// Numbers are normalised before comparison: GKSLYBWM-0001 and GKSLYBWM0001
// were the same bill entered twice, and an exact match missed it.
//
// This computes. It does not judge, and it never writes. The one check it
// cannot do deterministically, lines against the PDF, says so rather than
// passing: a flag claiming a check it did not perform is worse than no flag.
//
// One deliberate difference from the laptop: Round is matched as a word, so a
// history entry about rounding no longer reads as the Round app.

const LABEL_THRESHOLD = 3;

const normNumber = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Xero dates arrive as "/Date(1727654400000+0000)/" or an ISO string.
function xeroTime(s) {
  const m = /^\/Date\((-?\d+)/.exec(String(s || ""));
  if (m) return Number(m[1]);
  const t = Date.parse(s || "");
  return Number.isNaN(t) ? null : t;
}

function billDate(b) {
  if (b.DateString) return String(b.DateString).slice(0, 10);
  const t = xeroTime(b.Date);
  return t === null ? "" : new Date(t).toISOString().slice(0, 10);
}

const pence = (v) => Math.round(Number(v || 0) * 100);

/**
 * @param {object} x
 *   bill         the full bill (GET /Invoices/{id})
 *   paysTax      the organisation's PaysTax
 *   accounts     the chart of accounts
 *   siblings     the supplier's other ACCPAY bills
 *   priorLines   line items of the supplier's three most recent other bills
 *   history      the bill's HistoryRecords
 *   attachments  the bill's Attachments
 *   since        optional ISO time of the agent's own edit
 */
function checkBill({ bill, paysTax, accounts = [], siblings = [], priorLines = [], history = [], attachments = [], since = "" }) {
  const flags = [];
  const flag = (check, fired, detail, extra = {}) => flags.push({ check, flagged: Boolean(fired), detail, ...extra });
  const lines = bill.LineItems || [];
  const total = pence(bill.Total);
  const number = bill.InvoiceNumber || "";
  const date = billDate(bill);

  // A blank line repeating an amount: the commonest Round artefact.
  const blanks = lines.filter((l) => !String(l.Description || "").trim());
  const amounts = lines.map((l) => pence(l.LineAmount));
  const repeats = blanks.filter((l) => pence(l.LineAmount) === total || amounts.filter((a) => a === pence(l.LineAmount)).length > 1);
  flag("blank_line_repeating_total", repeats.length,
    repeats.length ? `${repeats.length} undescribed line(s) repeating an amount` : `${blanks.length} blank line(s), none repeating an amount`);

  // VAT on an entity that is not registered.
  const taxLines = lines.filter((l) => (l.TaxType || "NONE") !== "NONE");
  const totalTax = pence(bill.TotalTax);
  flag("vat_on_non_vat_entity", paysTax === false && (taxLines.length || totalTax !== 0),
    `PaysTax=${paysTax}, TotalTax=${(totalTax / 100).toFixed(2)}, ${taxLines.length} taxed line(s)`);

  // Account codes exist.
  const codes = new Set(accounts.map((a) => String(a.Code)));
  const unknown = [...new Set(lines.filter((l) => l.AccountCode && !codes.has(String(l.AccountCode))).map((l) => String(l.AccountCode)))].sort();
  flag("account_not_in_coa", unknown.length, unknown.length ? `not in the chart: ${unknown.join(", ")}` : "every line code is in the chart");

  // The supplier's other bills. A deleted or voided bill is a duplicate already
  // dealt with; counting it flagged a paid bill against the one Nik deleted.
  const live = siblings.filter((b) => b.InvoiceID !== bill.InvoiceID && !["DELETED", "VOIDED"].includes(b.Status));
  const counts = new Map();
  for (const b of [...live, bill]) {
    const n = normNumber(b.InvoiceNumber);
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const mine = normNumber(number);
  const isLabel = Boolean(mine) && counts.get(mine) > LABEL_THRESHOLD;
  flag("non_identifying_number", isLabel, isLabel
    ? `${JSON.stringify(number)} appears on ${counts.get(mine)} of this supplier's bills, so it labels rather than identifies. Duplicate detection by number cannot work for this supplier.`
    : `${JSON.stringify(number)} appears once for this supplier`);

  const dupNum = isLabel || !mine ? [] : live.filter((b) => normNumber(b.InvoiceNumber) === mine);
  flag("duplicate_invoice_number", dupNum.length,
    dupNum.map((b) => `${b.InvoiceID.slice(0, 8)} ${billDate(b)} ${b.Total} ${b.Status}`).join("; ") || "no other bill carries this number",
    { normalised: mine });

  const sameDay = live.filter((b) => billDate(b) === date && pence(b.Total) === total);
  flag("duplicate_same_day", sameDay.length,
    sameDay.map((b) => `${b.InvoiceID.slice(0, 8)} number=${b.InvoiceNumber || "(blank)"} ${b.Status}`).join("; ")
      || "no other bill from this supplier on this date for this amount");

  // Informational: what this supplier was coded to before.
  const prior = [...new Set(priorLines.filter((l) => l.AccountCode).map((l) => String(l.AccountCode)))].sort();
  const used = [...new Set(lines.filter((l) => l.AccountCode).map((l) => String(l.AccountCode)))].sort();
  flag("supplier_prior_account", false,
    `last 3 bills used ${prior.length ? JSON.stringify(prior) : "nothing recorded"}; this one uses ${JSON.stringify(used)}`,
    { matches_prior: prior.length > 0 && used.every((c) => prior.includes(c)) });

  // Has the Round app written to the bill since the agent's edit?
  const rounds = history.filter((h) => /\bround\b/i.test(JSON.stringify(h)));
  const sinceT = since ? xeroTime(since) : null;
  const after = sinceT === null ? [] : rounds.filter((h) => (xeroTime(h.DateUTC || h.DateUTCString || h.Date) ?? 0) > sinceT);
  flag("round_overwrote", sinceT !== null && after.length > 0, !rounds.length
    ? "no Round entries in this bill's history"
    : sinceT !== null ? `${after.length} Round entry/entries after ${since}`
      : `${rounds.length} Round entry/entries in history; pass since to detect an overwrite of your edit`);

  // The one that cannot be computed.
  flag("lines_vs_pdf", false,
    "NOT CHECKED - comparing lines to the source document needs the document read. Fetch it and compare yourself; do not treat this as a pass.",
    { not_checked: true, attachments: attachments.map((a) => ({ FileName: a.FileName, AttachmentID: a.AttachmentID, ContentLength: a.ContentLength })) });

  return {
    invoice_id: bill.InvoiceID, supplier: bill.Contact?.Name, number, reference: bill.Reference || "",
    date, total: (total / 100).toFixed(2), status: bill.Status,
    flags, flagged: flags.filter((f) => f.flagged).map((f) => f.check),
  };
}

module.exports = { LABEL_THRESHOLD, normNumber, xeroTime, billDate, checkBill };

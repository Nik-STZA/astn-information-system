// HMRC's payment for a VAT return (VAT build spec 17 Nov 2026, step 5): the
// repayment received, or the payment made, found in the representative's bank
// feed and matched to the return. Bank-feed matching is the evidence until the
// MTD API is proven (CFO, 18 Nov). Pure: vat-routes.js reads Xero.

const pence = (n) => Math.round(Number(n || 0) * 100);
const pounds = (p) => Math.round(p) / 100;
const HMRC = /\bhmrc\b|hm revenue|revenue (&|and) customs/i;

// Xero dates come as /Date(ms+0000)/ or ISO.
function dayOf(d) {
  const m = /\/Date\((\d+)/.exec(String(d ?? ""));
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(String(d ?? "")) ? String(d).slice(0, 10) : null;
}

const addDays = (iso, n) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// What HMRC should move for a submitted return, in pence: positive is a
// repayment into the bank, negative a payment out. boxes: as submitted.
function expectedOf(boxes) {
  return pence(boxes?.[4] ?? boxes?.["4"]) - pence(boxes?.[3] ?? boxes?.["3"]);
}

// The window to look in: a week before the return was filed (HMRC sometimes
// pays the day it is received) to 90 days after.
const windowOf = (submittedOn) => ({ from: addDays(submittedOn, -7), to: addDays(submittedOn, 90) });

// A bank transaction's money in (positive) or out (negative), in pence.
function moneyOf(t) {
  const total = pence(t.Total ?? (t.LineItems || []).reduce((s, l) => s + Number(l.LineAmount || 0), 0));
  return String(t.Type ?? "").toUpperCase().startsWith("SPEND") ? -total : total;
}

// The candidates in a list of bank transactions: HMRC's by contact or by a
// line to the VAT control account, in the window, in the right direction.
// Best first: the exact amount, then the nearest. taken: ids already matched.
function candidatesFrom(txns, { expected, vatCode, from, to, taken = [] }) {
  const out = [];
  for (const t of txns || []) {
    if (!["AUTHORISED", "PAID"].includes(String(t.Status ?? "AUTHORISED").toUpperCase())) continue;
    const date = dayOf(t.Date);
    if (!date || date < from || date > to) continue;
    const amount = moneyOf(t);
    if (!amount || Math.sign(amount) !== Math.sign(expected || 1)) continue;
    const contact = t.Contact?.Name ?? "";
    const toVat = (t.LineItems || []).some((l) => vatCode && String(l.AccountCode ?? "") === String(vatCode));
    if (!HMRC.test(contact) && !toVat) continue;
    out.push({
      xero_bank_txn_id: t.BankTransactionID, date, contact: contact || null, reference: t.Reference ?? null,
      bank_account: t.BankAccount?.Name ?? null, amount: pounds(amount), difference: pounds(amount - expected),
      exact: amount === expected, to_vat_account: toVat, taken: taken.includes(t.BankTransactionID),
    });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact) || Math.abs(a.difference) - Math.abs(b.difference) || a.date.localeCompare(b.date));
}

// The return's status once a payment is matched.
function statusAfter({ expected, amount, setOffReason }) {
  if (pence(amount) === expected) return "paid";
  return setOffReason ? "paid" : "part_paid";
}

module.exports = { expectedOf, windowOf, candidatesFrom, statusAfter, dayOf, moneyOf };

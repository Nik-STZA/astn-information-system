// Evidence for the VAT control reconciliations from the VAT returns kept in
// os.stza.io (VAT build spec 17 Nov 2026, step 6). Pure: recs-routes.js reads
// the rows.
//
// At a month end each company's VAT control holds, with clearing at
// submission (CFO, 18 Nov 2026):
//   - its own position on every return not yet filed by that date (box 4 less
//     box 3: a reclaim is a debit, positive here, as the ledger shows it);
//   - for the representative (or a single registration's company), every
//     return filed by that date and not yet paid by HMRC: the return as filed.
// A filed group return's members hold nothing for it once its clearing
// journals are in Xero; until then the rec says so. Returns from before
// os.stza.io stay as the evidence keyed for them (fetching keeps keyed rows).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pence = (n) => Math.round(Number(n || 0) * 100);
const amount = (p) => (p / 100).toFixed(2);
const gbp = (p) => (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label = (start, end) => {
  const [sy, sm] = String(start).split("-").map(Number);
  const [ey, em] = String(end).split("-").map(Number);
  return sy === ey && sm === em ? `${MONTHS[em - 1]} ${ey}` : `${MONTHS[sm - 1]} ${sy} to ${MONTHS[em - 1]} ${ey}`;
};
const longDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const position = (boxes) => pence(boxes?.[4] ?? boxes?.["4"]) - pence(boxes?.[3] ?? boxes?.["3"]);

//   balances  [{ entity_id, entity_name }] the companies on the rec
//   returns   [{ id, period_start, period_end, submitted_on, submitted_boxes, kind,
//               representative_id, own: { entity_id: boxes } from each company's own export,
//               paid_on: earliest matched payment date or null,
//               clearing: [journal state] }]
//   date      the month end
// Returns { rows, said }
function vatEvidence({ balances = [], returns = [], date }) {
  const rows = [];
  const said = [];
  const relevant = returns.filter((r) => r.period_end <= date).sort((a, b) => a.period_end.localeCompare(b.period_end));
  if (!relevant.some((r) => r.period_end === date)) {
    said.push(`No VAT return in os.stza.io ends on ${longDate(date)} yet. Open it on the VAT returns page and upload each company's export, then fetch again.`);
  }
  for (const b of balances) {
    const who = b.entity_name ?? "A company";
    let found = 0;
    for (const r of relevant) {
      const name = label(r.period_start, r.period_end);
      const filed = r.submitted_on && r.submitted_on <= date;
      if (!filed) {
        const boxes = r.own?.[b.entity_id];
        if (!boxes) { said.push(`${who}: no export uploaded for the ${name} return, so nothing was taken for it.`); continue; }
        const p = position(boxes);
        rows.push({ entity_id: b.entity_id, amount: amount(p),
          source: `${name} VAT return, ${who}'s own box 5 (${p >= 0 ? "to reclaim" : "owed"}), not yet filed at ${longDate(date)}` });
        found++;
        continue;
      }
      const payer = r.kind === "group" ? r.representative_id : b.entity_id;
      if (r.kind === "group" && b.entity_id !== payer) {
        const unposted = (r.clearing || []).filter((s) => s !== "posted" && s !== "rejected" && s !== "superseded");
        if (!(r.clearing || []).some((s) => s === "posted")) {
          said.push(`${who}: the ${name} return was filed on ${longDate(r.submitted_on)} but its clearing journals are ${unposted.length ? "not yet in Xero" : "not proposed"}, so ${who} still holds its share in the ledger.`);
        }
        continue;
      }
      if (b.entity_id !== payer) continue;
      if (r.paid_on && r.paid_on <= date) continue;
      const p = position(r.submitted_boxes);
      rows.push({ entity_id: b.entity_id, amount: amount(p),
        source: `${name} VAT return as filed on ${longDate(r.submitted_on)}: ${p >= 0 ? "refund claimed" : "payment due"}, ${r.paid_on ? `paid ${longDate(r.paid_on)}, after` : "not yet paid by HMRC at"} ${longDate(date)}` });
      found++;
    }
    if (found) said.push(`${who}: ${found} VAT return figure${found === 1 ? "" : "s"} taken from os.stza.io.`);
  }
  return { rows, said };
}

module.exports = { vatEvidence, position };

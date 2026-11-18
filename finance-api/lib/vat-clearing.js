// VAT group clearing journals (VAT build spec 17 Nov 2026, step 4; CFO, 18 Nov:
// clearing at submission for all clients). Pure: vat-routes.js reads the rows.
//
// A group files one return through its representative member, but each member
// books its own VAT. At submission each member's own position moves to the
// representative over their intercompany accounts, as the CFO did by hand:
//
//   each member         Dr its account with the representative   its reclaim
//                       Cr VAT control                           its reclaim
//   the representative  Dr VAT control                           the members' total
//                       Cr its account with each member          that member's reclaim
//
// A member owing VAT for the period reverses the signs. A member with nothing
// to clear has no journal. No tax on any line.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pence = (n) => Math.round(Number(n || 0) * 100);
const pounds = (p) => Math.round(p) / 100;

// "Oct 2026" for a month; "Aug-Oct 2026" for a longer period.
function returnLabel(start, end) {
  const [sy, sm] = String(start).split("-").map(Number);
  const [ey, em] = String(end).split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[em - 1]} ${ey}`;
  return sy === ey ? `${MONTHS[sm - 1]}-${MONTHS[em - 1]} ${ey}` : `${MONTHS[sm - 1]} ${sy}-${MONTHS[em - 1]} ${ey}`;
}

// ret      { period_start, period_end, submitted_on, representative_id }
// columns  the group build's columns: [{ entity_id, entity_name, representative, own: { 5: signed, owed positive } }]
// pairs    vat_ic_pairs in force: [{ member_entity_id, member_account_code, representative_account_code }]
// vatCode  { entity_id: the company's VAT control account code }
// codes    { entity_id: short code, e.g. FGH }
// Returns { journals: [{ entity_id, journal_date, narration, lines, reason }], issues }
function clearingJournals({ ret, columns = [], pairs = [], vatCode = {}, codes = {} }) {
  const issues = [];
  const label = returnLabel(ret.period_start, ret.period_end);
  const narration = `VAT group clearing: ${label} return`;
  const desc = `${label} VAT return`;
  const rep = columns.find((c) => c.representative);
  if (!rep) return { journals: [], issues: ["the group build has no representative member"] };
  const journals = [];
  const repLines = [];
  let total = 0;
  for (const c of columns.filter((x) => !x.representative)) {
    const reclaim = -pence(c.own?.[5] ?? c.own?.["5"]);   // own[5] is owed positive; a reclaim clears as a debit to the representative
    if (reclaim === 0) continue;
    const pair = pairs.find((p) => p.member_entity_id === c.entity_id);
    const name = codes[c.entity_id] ?? c.entity_name;
    if (!pair) { issues.push(`${name} has no intercompany accounts with the representative set for VAT clearing`); continue; }
    if (!vatCode[c.entity_id]) { issues.push(`${name}: no VAT control account found in Xero`); continue; }
    journals.push({
      entity_id: c.entity_id, journal_date: ret.submitted_on, narration,
      lines: [
        { account_code: pair.member_account_code, description: desc, amount: pounds(reclaim), tax_type: "NONE" },
        { account_code: vatCode[c.entity_id], description: desc, amount: pounds(-reclaim), tax_type: "NONE" },
      ],
      reason: `${name}'s own ${label} VAT position (${pounds(Math.abs(reclaim)).toFixed(2)} ${reclaim > 0 ? "to reclaim" : "owed"}) moves to ${codes[rep.entity_id] ?? rep.entity_name}, which filed the group return.`,
    });
    repLines.push({ account_code: pair.representative_account_code, description: `${desc} - ${name} share`, amount: pounds(-reclaim), tax_type: "NONE" });
    total += reclaim;
  }
  if (issues.length) return { journals: [], issues };
  if (repLines.length) {
    if (!vatCode[rep.entity_id]) return { journals: [], issues: [`${codes[rep.entity_id] ?? rep.entity_name}: no VAT control account found in Xero`] };
    journals.push({
      entity_id: rep.entity_id, journal_date: ret.submitted_on, narration,
      lines: [{ account_code: vatCode[rep.entity_id], description: desc, amount: pounds(total), tax_type: "NONE" }, ...repLines],
      reason: `The members' ${label} VAT positions, taken into ${codes[rep.entity_id] ?? rep.entity_name}'s VAT account for the group return, against each member's intercompany account.`,
    });
  }
  return { journals, issues };
}

module.exports = { clearingJournals, returnLabel };

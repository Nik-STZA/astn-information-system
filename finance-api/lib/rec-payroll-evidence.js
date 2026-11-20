// Staff time capitalised through payroll, on the capitalisation account's rec
// (CFO, 20 Nov 2026). The account holds two things: the asset register's
// development projects, proved by the signed register, and staff and
// contractor time capitalised by project each month through os.stza.io's
// payroll, which the register sets aside while its Software grouping is
// paused. This module gives the second as its own evidence row beside the
// register's:
//
//   staff time at the month end = staff time at last month end
//                                 + this month's payroll capitalisation
//
// Staff time at last month end is last month's signed staff-time row. The
// first month there is none: it is then last month's signed ledger balance
// less everything else last month's rec signed as evidence (the register),
// said plainly as a starting figure.
//
// Pure, so it is tested without a database. Amounts in pounds, as the ledger
// (an asset is a debit, positive).

const MARK = "payroll-capitalisation";

const pence = (n) => Math.round(Number(n || 0) * 100);
const pounds = (p) => Math.round(p) / 100;
const money = (p) => (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATE_WORD = { proposed: "proposed", approved: "approved", draft_created: "a draft in Xero", posted: "posted in Xero" };

// balance: { entity_id, entity_name, opening, closing }
// cap: { found, confirmed, issues, total, by_project, journals: [{ jnl, state }] }
// prior: null, or { period, signed: bool, evidence: [{ entity_id, amount, document_ref, method }] }
//   (last month's rec of the same account; evidence from its signed snapshot)
// register: what the register's own rows give for this company, or null.
// Returns { row (or null), said: [] }.
function staffTimeEvidence({ balance: b, cap, prior, period, date, register = null }) {
  const who = b.entity_name;
  // Once the register holds the staff time as cost lines by layer, its own
  // figure is the whole balance and a separate row would count it twice.
  if (register !== null && pence(register) === pence(b.closing)) {
    return { row: null, said: [`${who}: the register holds the staff time by layer and covers the whole balance, so no separate staff-time row is needed.`] };
  }
  if (!cap.found) return { row: null, said: [`${who}: no payroll month is loaded for ${period}, so staff time was not taken. Upload the salary report on the Payroll page, then fetch again.`] };
  if (!cap.confirmed) return { row: null, said: [`${who}: the ${period} capitalisation shares are not confirmed yet, so staff time was not taken. Confirm them on the Payroll page, then fetch again.`] };
  if (cap.issues?.length) return { row: null, said: [`${who}: the ${period} payroll cannot be worked out yet (${cap.issues.slice(0, 3).join("; ")}), so staff time was not taken.`] };
  if (!prior?.signed) return { row: null, said: [`${who}: last month's rec of this account is not signed, so there is no staff-time figure to roll forward. Sign it, then fetch again.`] };

  const mine = (prior.evidence || []).filter((v) => v.entity_id === b.entity_id);
  const last = mine.find((v) => v.document_ref === MARK);
  let opening, start = null;
  if (last) {
    opening = pence(last.amount);
  } else {
    // First month through payroll: last month's closing (this month's
    // opening) less what last month signed as the register's. Only the
    // register's own fetched rows count: a staff-time row keyed by hand last
    // month (method null) is staff time, not register, and subtracting it
    // started October at nil (20 Nov 2026). Snapshots from before rows carried
    // a method count every row, as before.
    const tagged = mine.some((v) => v.method !== undefined);
    const register = tagged ? mine.filter((v) => v.method === "asset_register") : mine;
    const others = register.reduce((a, v) => a + pence(v.amount), 0);
    opening = pence(b.opening) - others;
    start = `Starting figure: the ${prior.period} balance ${money(pence(b.opening))} less the ${money(others)} signed for it then.`;
  }
  const added = pence(cap.total);
  const projects = Object.entries(cap.by_project || {}).filter(([, v]) => pence(v) !== 0)
    .map(([p, v]) => `${p} ${money(pence(v))}`).join(", ");
  const jnls = (cap.journals || []).map((j) => `${j.jnl} ${STATE_WORD[j.state] ?? j.state}`).join(", ");
  return {
    row: {
      entity_id: b.entity_id,
      amount: pounds(opening + added),
      document_ref: MARK,
      source: `Staff time capitalised through payroll at ${date}: ${prior.period} ${money(opening)} plus ${period} ${money(added)}`,
      note: [
        start,
        projects ? `${period} by project: ${projects}.` : `Nothing capitalised in ${period}.`,
        jnls ? `Journals: ${jnls}.` : `The ${period} capitalisation journal is not on the Journals page.`,
      ].filter(Boolean).join(" "),
    },
    said: [`${who}: staff time capitalised through payroll ${money(opening)} at the end of ${prior.period}${start ? " (starting figure)" : ""}, plus ${money(added)} for ${period}, is ${money(opening + added)}, alongside the register's figure.`],
  };
}

// The account's lines in the month's staff and contractor capitalisation
// journals for one company. journals: [{ kind, entity, lines }].
function capitalisedTotal(journals, { entity, accountCode }) {
  let total = 0;
  for (const j of journals || []) {
    if (!["capdev", "capdev_contractor"].includes(j.kind) || j.entity !== entity) continue;
    for (const l of j.lines || []) if (String(l.account_code) === String(accountCode)) total += pence(l.amount);
  }
  return pounds(total);
}

module.exports = { staffTimeEvidence, capitalisedTotal, MARK };

// The capitalised development account's evidence from payroll (migration 068,
// CFO 20 Nov 2026): last month's signed figure, plus this month's staff and
// contractor time capitalised by project in os.stza.io's payroll. Anything
// else posted to the account is the difference the rec explains.
//
// Pure, so it is tested without a database. Amounts in pounds, signed as the
// ledger (an asset is a debit, positive).
//
// balances: [{ entity_id, entity_name, opening, closing }]
// cap: null when payroll is not set up, else { entity_id, account_code,
//   found (a payroll month is loaded), confirmed (its shares are confirmed),
//   total (capitalised to the account this month), by_project, journals:
//   [{ jnl, kind, state }] }
// prior: null, or { signed: true, period, by_entity: { [entity_id]: amount } }
//   from last month's signed rec of the same account.

const pence = (n) => Math.round(Number(n || 0) * 100);
const pounds = (p) => Math.round(p) / 100;
const money = (p) => (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATE_WORD = { proposed: "proposed", approved: "approved", draft_created: "a draft in Xero", posted: "posted in Xero" };

function payrollCapEvidence({ balances, cap, prior, period, date }) {
  const rows = [];
  const said = [];
  if (!cap) {
    said.push("Payroll is not set up in os.stza.io for this client, so there is no capitalisation to roll forward. Record the outside evidence.");
    return { rows, said };
  }
  for (const b of balances) {
    if (b.entity_id !== cap.entity_id) {
      said.push(`${b.entity_name}: payroll capitalises in another company, so nothing was taken for it. Record the outside evidence.`);
      continue;
    }
    if (!cap.found) {
      said.push(`${b.entity_name}: no payroll month is loaded for ${period}. Upload the salary report on the Payroll page, then refresh.`);
      continue;
    }
    if (!cap.confirmed) {
      said.push(`${b.entity_name}: the ${period} capitalisation shares are not confirmed yet, so nothing was taken. Confirm them on the Payroll page, then refresh.`);
      continue;
    }
    if (cap.issues?.length) {
      said.push(`${b.entity_name}: the ${period} payroll cannot be worked out yet (${cap.issues.slice(0, 3).join("; ")}), so nothing was taken. Resolve it on the Payroll page, then refresh.`);
      continue;
    }
    const fromSigned = prior?.signed && prior.by_entity?.[b.entity_id] !== undefined;
    const opening = fromSigned ? pence(prior.by_entity[b.entity_id]) : pence(b.opening);
    const added = pence(cap.total);
    const projects = Object.entries(cap.by_project || {}).filter(([, v]) => pence(v) !== 0)
      .map(([p, v]) => `${p} ${money(pence(v))}`).join(", ");
    const jnls = (cap.journals || []).map((j) => `${j.jnl} ${STATE_WORD[j.state] ?? j.state}`).join(", ");
    rows.push({
      entity_id: b.entity_id,
      amount: pounds(opening + added),
      source: `${fromSigned ? `Signed ${prior.period} figure` : "Opening balance"} ${money(opening)} plus ${period} payroll capitalisation ${money(added)} at ${date}`,
      note: [
        projects ? `By project: ${projects}.` : "Nothing capitalised this month.",
        fromSigned ? null : "Last month's rec is not signed, so the ledger's opening balance is used.",
        jnls ? `Journals: ${jnls}.` : "The month's capitalisation journals are not on the Journals page yet.",
      ].filter(Boolean).join(" "),
    });
    const diff = pence(b.closing) - (opening + added);
    said.push(`${b.entity_name}: ${fromSigned ? `signed ${prior.period}` : "opening"} ${money(opening)} + payroll capitalisation ${money(added)} = ${money(opening + added)}; the ledger holds ${money(pence(b.closing))}${diff ? `, ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"}: other postings to the account to explain` : ", which ties"}.`);
  }
  return { rows, said };
}

// The capitalisation lines of the month's payroll journals: the account's
// lines in the capitalisation journals (staff and contractors), with the
// project each is for. journals: preview kinds [{ kind, entity, lines }].
function capitalisedTotal(journals, { entity, accountCode }) {
  let total = 0;
  for (const j of journals || []) {
    if (!["capdev", "capdev_contractor"].includes(j.kind) || j.entity !== entity) continue;
    for (const l of j.lines || []) if (String(l.account_code) === String(accountCode)) total += pence(l.amount);
  }
  return pounds(total);
}

module.exports = { payrollCapEvidence, capitalisedTotal };

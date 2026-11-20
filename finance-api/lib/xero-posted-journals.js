// A journal proposed in os.stza.io that someone already posted by hand in
// Xero (20 Nov 2026: October payroll, VAT clearing for returns filed before
// the platform, accruals booked outside it). The posted manual journal is
// found and linked, so the proposal becomes "posted" with Xero's id and
// nothing is drafted twice.
//
// A match is either the same lines (account and amount, line by line), or,
// failing that, the same net amount on every account: a hand journal that
// splits or combines lines differently has the same effect on the ledger.
// Same-lines matches are preferred. Only POSTED journals count, and a Xero
// journal already linked to another proposal here is never taken again.

const pence = (n) => Math.round(Number(n || 0) * 100);
const codeOf = (l) => String(l.account_code ?? l.AccountCode ?? "").trim();
const amountOf = (l) => l.amount ?? l.LineAmount;

function linesKey(lines) {
  return (lines || []).map((l) => `${codeOf(l)}|${pence(amountOf(l))}`).sort().join(",");
}

function accountsKey(lines) {
  const by = new Map();
  for (const l of lines || []) by.set(codeOf(l), (by.get(codeOf(l)) ?? 0) + pence(amountOf(l)));
  return [...by].filter(([, v]) => v !== 0).map(([k, v]) => `${k}|${v}`).sort().join(",");
}

// "lines", "accounts" or null.
function matchKind(proposalLines, xeroLines) {
  if (!proposalLines?.length || !xeroLines?.length) return null;
  if (linesKey(proposalLines) === linesKey(xeroLines)) return "lines";
  const a = accountsKey(proposalLines);
  return a && a === accountsKey(xeroLines) ? "accounts" : null;
}

// The best posted match for one proposal among Xero's manual journals, as
// { journal, match } or null. taken: Set of ManualJournalIDs already linked.
function findPosted(proposal, xeroJournals, taken = new Set()) {
  let best = null;
  for (const x of xeroJournals || []) {
    if (String(x.Status).toUpperCase() !== "POSTED" || taken.has(x.ManualJournalID)) continue;
    const match = matchKind(proposal.lines, x.JournalLines || []);
    if (match === "lines") return { journal: x, match };
    if (match && !best) best = { journal: x, match };
  }
  return best;
}

const shiftDay = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const xeroDate = (d) => d.split("-").map(Number).join(",");

// Every posted manual journal in one company's Xero within `days` of `date`,
// with its lines. Throws when Xero cannot be read.
async function postedAround({ xeroEntityContext, xeroGet, clientSlug, entitySlug, date, days = 31 }) {
  const ctx = await xeroEntityContext(clientSlug, entitySlug);
  if (!ctx || ctx.error) throw new Error(ctx?.error ?? "not connected to Xero");
  const where = `Date >= DateTime(${xeroDate(shiftDay(date, -days))}) AND Date <= DateTime(${xeroDate(shiftDay(date, days))}) AND Status=="POSTED"`;
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const batch = (await xeroGet(ctx.accessToken, ctx.tenantId, "/ManualJournals", { where, page }))?.ManualJournals ?? [];
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  throw new Error("more than 50 pages of manual journals in the period");
}

// The Xero ids this client's journals are already linked to.
async function linkedIds(db, clientId) {
  return new Set((await db.query(
    "SELECT xero_journal_id FROM finance.journals WHERE client_id = $1 AND xero_journal_id IS NOT NULL", [clientId])).rows.map((r) => r.xero_journal_id));
}

// The reason line added when a proposal is linked.
function linkedNote(x, match, by) {
  const how = match === "lines" ? "same lines" : "same amount on every account, lines split differently";
  return ` Already posted in Xero by hand (${String(x.Narration ?? "").slice(0, 80)}; ${how})${by ? `, recorded by ${by}` : ""}: linked, not posted again.`;
}

module.exports = { matchKind, findPosted, postedAround, linkedIds, linkedNote, linesKey, accountsKey };

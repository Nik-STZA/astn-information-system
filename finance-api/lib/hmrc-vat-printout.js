// HMRC's own record of a VAT registration, read from the pages a person saves
// from "Manage your VAT account" on GOV.UK: a submitted return, and the
// payment history for a year. Used to load returns filed before os.stza.io
// (scripts/vat-backload.js). Pure: takes the page text (PDF to text, or the
// saved markdown), returns figures, and refuses anything it cannot read
// cleanly rather than guess.
//
// A submitted return lists its nine boxes in order after "VAT details". Box 4
// carries a display minus ("- £90,600.14": a reclaim, held as 90,600.14); a
// figure's own sign is a minus against the pound sign ("- -£30,291.67" is a
// negative box 4, "-£149,999" a negative box 7, January 2025). Box 5 is shown
// unsigned. Boxes are returned as the platform holds a filed return, with
// each figure's own sign: lib/vat-evidence.js takes box 4 less box 3 as the
// reclaim, so a payable return comes out negative.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthOf = (name) => {
  const i = MONTHS.findIndex((m) => m.startsWith(String(name).toLowerCase().slice(0, 3)));
  return i < 0 ? null : i + 1;
};
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const flat = (text) => String(text ?? "").replace(/−/g, "-").replace(/\s+/g, " ").trim();
const pence = (s) => Math.round(Number(String(s).replace(/,/g, "")) * 100);

// "1 October to 31 December 2025", "10 August 2023 to 29 February 2024",
// "1 Jan to 28 Feb 2026" -> { start, end }
function periodOf(text) {
  const m = /(\d{1,2}) ([A-Za-z]+)(?: (\d{4}))? to (\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(text);
  if (!m) return null;
  const [, sd, sm, sy, ed, em, ey] = m;
  const smn = monthOf(sm);
  const emn = monthOf(em);
  if (!smn || !emn) return null;
  const startYear = sy ? Number(sy) : smn > emn ? Number(ey) - 1 : Number(ey);
  return { start: iso(startYear, smn, sd), end: iso(Number(ey), emn, ed) };
}

// One submitted return. Returns { ok, company, period_start, period_end,
// submitted_on, due_on, period_key, boxes, issues }.
function parseSubmittedReturn(text) {
  const t = flat(text);
  const issues = [];
  const title = /Submitted return for (\d{1,2} [A-Za-z]+(?: \d{4})? to \d{1,2} [A-Za-z]+ \d{4})/.exec(t);
  const period = title ? periodOf(title[1]) : null;
  if (!period) issues.push("the period could not be read");
  const company = /Submitted return for ([A-Z0-9&.,'() -]+?(?:LIMITED|LTD|PLC|LLP))\b/.exec(t)?.[1]?.trim() ?? null;
  const dateAfter = (label) => {
    const m = new RegExp(`${label}: (\\d{1,2}) ([A-Za-z]+) (\\d{4})`).exec(t);
    return m && monthOf(m[2]) ? iso(m[3], monthOf(m[2]), m[1]) : null;
  };
  const submitted = dateAfter("Date submitted");
  if (!submitted) issues.push("the date submitted could not be read");
  const periodKey = /vat-returns\/submitted\/\d{4}\/([A-Z0-9#]{4})/i.exec(t)?.[1] ?? null;

  const from = t.indexOf("VAT details");
  const to = t.indexOf("Correct as of");
  const body = from >= 0 ? t.slice(from, to > from ? to : undefined) : "";
  // (display minus, then a space) (the figure's own minus) £ figure
  const amounts = [...body.matchAll(/(- )?(-)?£([\d,]+(?:\.\d{1,2})?)/g)].map((m) => ({ shown: Boolean(m[1]), p: (m[2] ? -1 : 1) * pence(m[3]) }));
  const boxes = {};
  if (amounts.length !== 9) issues.push(`expected the nine boxes, found ${amounts.length} amounts`);
  else {
    amounts.forEach((a, i) => { boxes[i + 1] = a.p / 100; });
    if (amounts[2].p !== amounts[0].p + amounts[1].p) issues.push("box 3 is not box 1 plus box 2");
    if (amounts[4].p !== Math.abs(amounts[2].p - amounts[3].p)) issues.push("box 5 is not the difference between box 3 and box 4");
    if (amounts.some((a, i) => a.shown && i !== 3)) issues.push("a box other than box 4 carries the display minus; check the page");
  }
  return {
    ok: issues.length === 0, company, period_start: period?.start ?? null, period_end: period?.end ?? null,
    submitted_on: submitted, due_on: dateAfter("Return due date"), period_key: periodKey, boxes, issues,
  };
}

// A year of the payment history. Rows are read in order: each row's date, the
// return it is for, and its pair of amounts (you paid HMRC, HMRC paid you).
// Rows that are not for a return (interest, penalties) would break the pairing,
// so the counts must agree or nothing is returned.
//   year  the year the page is for (the page shows "13 Nov", not the year)
function parsePaymentHistory(text, year) {
  const t = flat(text);
  const dates = [...t.matchAll(/(?:^|\s)(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?= (?:Repayment|Payment))/g)].map((m) => iso(year, monthOf(m[2]), m[1]));
  const kinds = [...t.matchAll(/\b(Repayment from HMRC|Payment (?:to|received by) HMRC)/g)].map((m) => (/^Repayment/.test(m[1]) ? "repayment" : "payment"));
  const fors = [...t.matchAll(/for the (\d{1,2} [A-Za-z]{3}(?: \d{4})? to \d{1,2} [A-Za-z]{3} \d{4}) return/g)].map((m) => periodOf(m[1]));
  const amounts = [...t.matchAll(/£([\d,]+\.\d{2})/g)].map((m) => pence(m[1]));
  const issues = [];
  if (!(dates.length === fors.length && kinds.length === fors.length && amounts.length === fors.length * 2)) {
    issues.push(`the rows could not be paired: ${dates.length} dates, ${kinds.length} descriptions, ${fors.length} returns, ${amounts.length} amounts. Interest or penalty lines need reading by hand.`);
    return { ok: false, rows: [], issues };
  }
  const rows = fors.map((p, i) => {
    const paid = amounts[i * 2];
    const repaid = amounts[i * 2 + 1];
    return { date: dates[i], kind: kinds[i], period_start: p?.start ?? null, period_end: p?.end ?? null, you_paid: paid / 100, hmrc_paid: repaid / 100 };
  });
  for (const r of rows) {
    if (!r.period_start) issues.push(`the return for the row of ${r.date} could not be read`);
    if ((r.kind === "repayment") !== (r.hmrc_paid > 0 && r.you_paid === 0)) issues.push(`the row of ${r.date} has amounts that do not fit its description`);
  }
  return { ok: issues.length === 0, rows, issues };
}

module.exports = { parseSubmittedReturn, parsePaymentHistory, periodOf };

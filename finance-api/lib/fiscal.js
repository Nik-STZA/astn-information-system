// Financial years.
//
// A financial year is named by the calendar year it ends in: STZA's year ending
// 31 March 2027 is 2027 (FY27), and Feldspar's year ending 31 December 2026 is
// 2026, the same as its calendar year. Everything that asks "which year is this
// in" for a pack goes through here, so a March year end and a December one are
// the same code.
//
// The year end comes from shared.clients.year_end. Only its month matters. A
// client with no year end recorded is treated as December, which is what the
// check did for every client before this existed.

function yearEndMonth(yearEnd) {
  if (yearEnd instanceof Date && !Number.isNaN(yearEnd.getTime())) return yearEnd.getUTCMonth() + 1;
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(String(yearEnd ?? ""));
  const month = m ? Number(m[1]) : NaN;
  return month >= 1 && month <= 12 ? month : 12;
}

// The financial year (by its end year) that a date falls in.
function fiscalYear(date, endMonth = 12) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return d.getUTCMonth() + 1 <= endMonth ? y : y + 1;
}

// The financial year of a YYYY-MM reporting period.
function fiscalYearOfPeriod(period, endMonth = 12) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period));
  if (!m) return null;
  const y = Number(m[1]);
  return Number(m[2]) <= endMonth ? y : y + 1;
}

module.exports = { yearEndMonth, fiscalYear, fiscalYearOfPeriod };

// Xero P&L comparative periods.
//
// Xero treats fromDate..toDate as ONE period and returns `periods` more of the
// same length, each shifted back by `timeframe` with the same days of the
// month. Two ways that went wrong on 11 Sep 2026:
//
// 1. A multi-month range with periods (Jan-Aug, periods 8) came back as eight
//    overlapping 8-month windows. An agent labelled them "monthly" and summed
//    them: revenue 200,248.60 against a true 53,095.60.
// 2. A base period ending mid-month (toDate = today, the 11th) made every
//    comparative the 1st to the 11th of its month. An agent read those as whole
//    months and concluded the company was dormant.
//
// So when comparatives are wanted, the request becomes the last whole period of
// the range, ending at month end, plus N-1 prior periods. Where the range ends
// in the current month, the latest column is month to date. The agent is not
// trusted to know any of this.

const TIMEFRAME_MONTHS = { MONTH: 1, QUARTER: 3, YEAR: 12 };
const iso = (d) => d.toISOString().slice(0, 10);

function normaliseProfitAndLossParams(params) {
  const span = TIMEFRAME_MONTHS[params.timeframe];
  if (!span || !params.fromDate || !params.toDate) return params;

  const [fy, fm] = params.fromDate.split("-").map(Number);
  const [ty, tm] = params.toDate.split("-").map(Number);
  const months = (ty - fy) * 12 + (tm - fm) + 1;

  const periods =
    months > span
      ? Math.min(Math.ceil(months / span) - 1, 11) // Xero caps periods at 11
      : Number(params.periods) || 0;
  if (!periods) return params; // no comparatives: one column for the range, as asked

  const next = {
    ...params,
    fromDate: iso(new Date(Date.UTC(ty, tm - span, 1))),
    toDate: iso(new Date(Date.UTC(ty, tm, 0))),
    periods,
  };
  const unchanged =
    next.fromDate === params.fromDate &&
    next.toDate === params.toDate &&
    Number(params.periods) === periods;
  return unchanged ? params : next;
}

module.exports = { normaliseProfitAndLossParams };

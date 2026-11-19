import { describe, expect, it } from "vitest";
import { parsePaymentHistory, parseSubmittedReturn, periodOf } from "./hmrc-vat-printout";

// The shape of a saved GOV.UK page, company name replaced.
const RETURN = `19/11/2026, 10:55

Submitted return for 1 October to 31 December 2025 - Manage your VAT account - GOV.UK

Submitted return for SAMPLE TRADING LIMITED
1 Oct to 31 Dec 2025

Return due date: 7 February 2026
Date submitted: 3 February 2026

VAT details

Box 1

VAT due in the period on sales and other outputs

Box 2

VAT due in the period on acquisitions of goods made in Northern
Ireland from EU Member States

Box 3

Total VAT due (this is the total of box 1 and 2)

Box 4

VAT reclaimed in the period on purchases and other inputs
(including acquisitions in Northern Ireland from EU member
states)

£3,762.98

£0

£3,762.98

− £90,600.14

Box 5

Net VAT to pay to HMRC or reclaim (this is the difference
between box 3 and 4)

£86,837.16

Additional information

Box 6

Total value of sales and other supplies, excluding VAT

£18,814

Box 7

Total value of purchases and all other inputs excluding any VAT

£143,504

Box 8

Box 9

£0

£0

Correct as of 16 November 2026

https://www.tax.service.gov.uk/vat-through-software/vat-returns/submitted/2025/25C4
`;

const HISTORY = `Payment history

You
paid
HMRC

HMRC
paid you

£0.00

£82,564.33

£0.00

£7,978.66

Date

Payment
description

13 Nov Repayment
from HMRC
for the 1 Oct to
31 Oct 2026
return

23 Oct Repayment
from HMRC
for the 1 Sep to
30 Sep 2026
return

15 Jul

Repayment
from HMRC

£0.00

£12,865.59

https://www.tax.service.gov.uk/vat-through-software/payment-history

1/2

19/11/2026, 10:56

Date

Payment
description

for the 1 Jun to
30 Jun 2026
return

27 Mar Repayment
from HMRC
for the 1 Jan to
28 Feb 2026
return

£0.00

£32,551.99
`;

describe("a submitted return from HMRC", () => {
  it("reads the period, dates, key and all nine boxes, unsigned", () => {
    const r = parseSubmittedReturn(RETURN);
    expect(r).toMatchObject({
      ok: true, company: "SAMPLE TRADING LIMITED", period_start: "2025-10-01", period_end: "2025-12-31",
      submitted_on: "2026-02-03", due_on: "2026-02-07", period_key: "25C4",
      boxes: { 1: 3762.98, 2: 0, 3: 3762.98, 4: 90600.14, 5: 86837.16, 6: 18814, 7: 143504, 8: 0, 9: 0 },
    });
  });

  it("keeps a figure's own minus apart from box 4's display minus (a payable return)", () => {
    const payable = RETURN
      .replace(/£3,762\.98(\s+)£0(\s+)£3,762\.98(\s+)− £90,600\.14/, "£3,959.36$1£0$2£3,959.36$3− −£30,291.67")
      .replace("£86,837.16", "£34,251.03").replace("£143,504", "−£149,999");
    const r = parseSubmittedReturn(payable);
    expect(r.issues).toEqual([]);
    expect(r.boxes).toMatchObject({ 3: 3959.36, 4: -30291.67, 5: 34251.03, 7: -149999 });
  });

  it("refuses a page whose boxes do not add up or are missing", () => {
    expect(parseSubmittedReturn(RETURN.replace("£86,837.16", "£86,837.17")).issues).toContain("box 5 is not the difference between box 3 and box 4");
    expect(parseSubmittedReturn(RETURN.replace("£143,504", "")).issues[0]).toMatch(/expected the nine boxes, found 8/);
    expect(parseSubmittedReturn("nothing").ok).toBe(false);
  });

  it("reads a period across a year end and a long first period", () => {
    expect(periodOf("1 October to 31 December 2025")).toEqual({ start: "2025-10-01", end: "2025-12-31" });
    expect(periodOf("1 Dec to 28 Feb 2026")).toEqual({ start: "2025-12-01", end: "2026-02-28" });
    expect(periodOf("10 August 2023 to 29 February 2024")).toEqual({ start: "2023-08-10", end: "2024-02-29" });
  });
});

describe("HMRC's payment history", () => {
  it("pairs each row with its return and amounts, across a page break", () => {
    const r = parsePaymentHistory(HISTORY, 2026);
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([
      { date: "2026-11-13", kind: "repayment", period_start: "2026-10-01", period_end: "2026-10-31", you_paid: 0, hmrc_paid: 82564.33 },
      { date: "2026-10-23", kind: "repayment", period_start: "2026-09-01", period_end: "2026-09-30", you_paid: 0, hmrc_paid: 7978.66 },
      { date: "2026-07-15", kind: "repayment", period_start: "2026-06-01", period_end: "2026-06-30", you_paid: 0, hmrc_paid: 12865.59 },
      { date: "2026-03-27", kind: "repayment", period_start: "2026-01-01", period_end: "2026-02-28", you_paid: 0, hmrc_paid: 32551.99 },
    ]);
  });

  it("refuses rather than guess when a row is not for a return", () => {
    const r = parsePaymentHistory(HISTORY.replace("for the 1 Sep to\n30 Sep 2026\nreturn", "Repayment interest"), 2026);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/could not be paired/);
  });
});

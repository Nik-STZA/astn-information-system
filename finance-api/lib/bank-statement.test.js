import { describe, it, expect } from "vitest";
import bs from "./bank-statement.js";
import sheets from "./sheet-read.js";

const { dateOf, slashOrder, penceOf, readStatement, balanceAt, xeroItems, agreedPoint, matchAfter, compare, itemEffect } = bs;
const csv = (text) => sheets.readCsv(Buffer.from(text));

describe("bank statement cells", () => {
  it("reads dates the way UK banks write them", () => {
    expect(dateOf("2026-09-30")).toBe("2026-09-30");
    expect(dateOf("2026-09-30 14:02:11")).toBe("2026-09-30");
    expect(dateOf("30/09/2026")).toBe("2026-09-30");
    expect(dateOf("01/09/26")).toBe("2026-09-01");
    expect(dateOf("30 Sep 2026")).toBe("2026-09-30");
    expect(dateOf("30-Sept-2026")).toBe("2026-09-30");
    expect(dateOf("Sep 30, 2026")).toBe("2026-09-30");
    expect(dateOf("09/30/2026", "mdy")).toBe("2026-09-30");
    expect(dateOf("31/02/2026")).toBe(null);
    expect(dateOf("Card payment")).toBe(null);
  });

  it("takes slashed dates as month first only when the file shows it", () => {
    expect(slashOrder(["01/09/2026", "30/09/2026"])).toBe("dmy");
    expect(slashOrder(["09/01/2026", "09/30/2026"])).toBe("mdy");
    expect(slashOrder(["01/02/2026"])).toBe("dmy");
  });

  it("reads amounts with signs, symbols and bank suffixes", () => {
    expect(penceOf("1,234.56")).toBe(123456);
    expect(penceOf("-£39.97")).toBe(-3997);
    expect(penceOf("(12.50)")).toBe(-1250);
    expect(penceOf("12.50 DR")).toBe(-1250);
    expect(penceOf("12.50 CR")).toBe(1250);
    expect(penceOf("GBP 5.00")).toBe(500);
    expect(penceOf("+0.67")).toBe(67);
    expect(penceOf("")).toBe(null);
    expect(penceOf("n/a")).toBe(null);
  });
});

describe("reading a bank export", () => {
  it("reads a paid in / paid out export, newest first, into oldest first", () => {
    const r = readStatement(csv([
      "Date,Description,Paid out,Paid in,Balance",
      "30/09/2026,Uber,39.97,,960.03",
      "15/09/2026,Customer,,500.00,1000.00",
      "01/09/2026,Opening,,,500.00",
    ].join("\n")));
    expect(r.issues).toEqual([]);
    expect(r.read).toMatchObject({ amount: "paid in less paid out", newest_first: true });
    expect(r.lines.map((l) => [l.date, l.amount, l.balance])).toEqual([["2026-09-15", 50000, 100000], ["2026-09-30", -3997, 96003]]);
    expect(balanceAt(r.lines, "2026-09-30")).toBe(96003);
    expect(balanceAt(r.lines, "2026-09-20")).toBe(100000);
    expect(balanceAt(r.lines, "2026-09-01")).toBe(50000);
  });

  it("finds that a Revolut export's balance moves by amount less fee, and drops declined lines", () => {
    const r = readStatement(csv([
      "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
      "CARD_PAYMENT,Current,2026-09-02 10:00:00,2026-09-03 09:00:00,Shop,-10.00,0.50,GBP,COMPLETED,89.50",
      "CARD_PAYMENT,Current,2026-09-04 10:00:00,,Shop,-99.00,0.00,GBP,DECLINED,",
      "TOPUP,Current,2026-09-05 10:00:00,2026-09-05 10:00:00,Top up,20.00,0.00,GBP,COMPLETED,109.50",
      "TRANSFER,Current,2026-09-06 10:00:00,2026-09-06 10:00:00,Wise,-50.00,1.25,GBP,COMPLETED,58.25",
    ].join("\n")));
    expect(r.issues).toEqual([]);
    expect(r.read.amount).toBe("amount less fee");
    expect(r.read.date).toBe("completed date");
    expect(r.lines.map((l) => l.amount)).toEqual([-1050, 2000, -5125]);
    expect(r.said.join(" ")).toMatch(/1 declined/);
  });

  it("refuses a file with no running balance, or one the amounts do not follow", () => {
    expect(readStatement(csv("Date,Description,Amount\n01/09/2026,A,1.00")).issues[0]).toMatch(/balance/);
    const bad = readStatement(csv(["Date,Description,Amount,Balance", "01/09/2026,A,1.00,10.00", "02/09/2026,B,1.00,50.00", "03/09/2026,C,1.00,90.00"].join("\n")));
    expect(bad.issues[0]).toMatch(/follow the running balance/);
  });
});

describe("Xero's side of a bank account", () => {
  const acct = "acc-1";
  it("signs spend and receive money and payments, and keeps a batch as one line", () => {
    const items = xeroItems({
      accountId: acct,
      bankTransactions: [
        { BankTransactionID: "t1", Type: "SPEND", Status: "AUTHORISED", Total: 39.97, Date: "/Date(1790208000000+0000)/", BankAccount: { AccountID: acct }, Contact: { Name: "Uber" } },
        { BankTransactionID: "t2", Type: "RECEIVE-TRANSFER", Status: "AUTHORISED", Total: 100, DateString: "2026-09-10T00:00:00", BankAccount: { AccountID: acct } },
        { BankTransactionID: "t3", Type: "SPEND", Status: "DELETED", Total: 5, DateString: "2026-09-10T00:00:00", BankAccount: { AccountID: acct } },
        { BankTransactionID: "t4", Type: "SPEND", Status: "AUTHORISED", Total: 5, DateString: "2026-09-10T00:00:00", BankAccount: { AccountID: "other" } },
      ],
      payments: [
        { PaymentID: "p1", PaymentType: "ACCRECPAYMENT", Status: "AUTHORISED", Amount: 119988, Date: "/Date(1792368000000+0000)/", Account: { AccountID: acct }, Invoice: { InvoiceNumber: "INV-1", Contact: { Name: "Jo Bloggs" } } },
        { PaymentID: "p2", PaymentType: "ACCPAYPAYMENT", Status: "AUTHORISED", Amount: 10, DateString: "2026-09-20T00:00:00", Account: { AccountID: acct }, BatchPayment: { BatchPaymentID: "b1" } },
        { PaymentID: "p3", PaymentType: "ACCPAYPAYMENT", Status: "AUTHORISED", Amount: 15, DateString: "2026-09-20T00:00:00", Account: { AccountID: acct }, BatchPayment: { BatchPaymentID: "b1" } },
        { PaymentID: "p4", PaymentType: "ACCPAYPAYMENT", Status: "AUTHORISED", Amount: 1, DateString: "2026-09-20T00:00:00", Account: { AccountID: "other" } },
      ],
    });
    expect(items.map((x) => [x.date, x.amount, x.kind])).toEqual([
      ["2026-09-10", 10000, "bank_transaction"],
      ["2026-09-20", -2500, "batch_payment"],
      ["2026-09-24", -3997, "bank_transaction"],
      ["2026-10-19", 11998800, "payment"],
    ]);
  });
});

describe("setting the statement against Xero", () => {
  const line = (date, amount, balance, row = 0) => ({ row, date, description: `L${row}`, amount, balance });
  const item = (date, amount, key) => ({ key, date, amount, description: key });

  it("agrees at the month end when every line is in Xero, a day apart allowed", () => {
    const lines = [line("2026-09-05", 1000, 11000, 2), line("2026-09-28", -500, 10500, 3)];
    const items = [item("2026-09-05", 1000, "a"), item("2026-09-27", -500, "b")];
    const out = compare({ lines, items, ledgerEnd: 10500, periodEnd: "2026-09-30" });
    expect(out.agreed).toEqual({ date: "2026-09-30", balance: 10500 });
    expect(out.items).toEqual([]);
    expect(out.check).toBe(0);
  });

  it("finds the last day they agreed and holds what differs after it", () => {
    // Agreed on 10 Sep. Then: a fee on the statement never entered in Xero,
    // a payment in Xero on 29 Sep not yet through the bank, and one in Xero
    // on 12 Sep that never reached the bank.
    const lines = [
      line("2026-09-01", 0, 10000, 1), line("2026-09-10", 2000, 12000, 2),
      line("2026-09-15", -67, 11933, 3), line("2026-09-20", -1000, 10933, 4),
    ];
    const items = [item("2026-09-10", 2000, "rcpt"), item("2026-09-12", -300, "ghost"), item("2026-09-20", -1000, "pay"), item("2026-09-29", -250, "late")];
    const ledgerEnd = 10000 + 2000 - 300 - 1000 - 250;
    const out = compare({ lines, items, ledgerEnd, periodEnd: "2026-09-30" });
    expect(out.agreed.date).toBe("2026-09-10");
    expect(out.statement_balance).toBe(10933);
    expect(out.items.map((h) => [h.side, h.kind, h.amount])).toEqual([
      ["bank_only", "unreconciled", -67], ["xero_only", "error", -300], ["xero_only", "timing", -250],
    ]);
    expect(out.check).toBe(0);
    const support = out.statement_balance + out.items.reduce((a, h) => a + itemEffect({ ...h, amount: h.amount / 100 }), 0);
    expect(support).toBe(ledgerEnd);
  });

  it("says the gap is older than the file when they never agree in it", () => {
    const lines = [line("2026-09-10", 100, 1100, 1)];
    const out = compare({ lines, items: [item("2026-09-10", 100, "a")], ledgerEnd: 900, periodEnd: "2026-09-30" });
    expect(out.agreed).toBe(null);
    expect(out.check).toBe(200);
    expect(out.said.join(" ")).toMatch(/older than the file/);
  });

  it("matches one bank line to several Xero items: a card payment and its fee, a batch beside others", () => {
    // As Revolut and Xero showed it on 11 Nov 2026 (names changed).
    const lines = [line("2026-01-13", -53874, 0, 1), line("2026-03-25", -1387400, 0, 2)];
    const items = [
      item("2026-01-13", -53341, "charge"), item("2026-01-13", -533, "fee"),
      item("2026-03-25", -1342500, "batch"), item("2026-03-25", -37700, "a"), item("2026-03-25", -7200, "b"),
      item("2026-03-20", -53341, "too-early"),
    ];
    const m = matchAfter({ lines, items, from: "2026-01-01", periodEnd: "2026-03-31" });
    expect(m.matched.map((p) => (p.items ?? [p.item]).map((x) => x.key).sort().join("+"))).toEqual(["charge+fee", "a+b+batch"]);
    expect(m.bankOnly).toEqual([]);
    expect(m.xeroOnly.map((x) => x.key)).toEqual(["too-early"]);
  });

  it("matches several bank lines to one Xero item, but only within a day", () => {
    const lines = [line("2026-02-01", -1000, 0, 1), line("2026-02-01", -250, 0, 2), line("2026-02-05", -250, 0, 3)];
    const m = matchAfter({ lines, items: [item("2026-02-01", -1250, "one"), item("2026-02-06", -1250, "two")], from: "2026-01-31", periodEnd: "2026-02-28" });
    expect(m.matched.length).toBe(1);
    expect(m.matched[0].lines.map((l) => l.row)).toEqual([1, 2]);
    expect(m.bankOnly.map((l) => l.row)).toEqual([3]);
  });

  it("sets aside entries that cancel on the same day, and holds a near match as its difference", () => {
    const lines = [line("2026-03-25", -682600, 0, 1), line("2026-06-03", -19732, 0, 2), line("2026-07-01", -10000, 0, 3)];
    const items = [
      item("2026-08-04", 612852, "clear-in"), item("2026-08-04", -612852, "clear-out"),
      item("2026-03-25", -682560, "inv"), item("2026-06-03", -19622, "hotel"), item("2026-07-01", -11000, "too-far"),
    ];
    const m = matchAfter({ lines, items, from: "2026-01-01", periodEnd: "2026-09-30" });
    expect(m.cancelled.length).toBe(1);
    expect(m.near.map((n) => [n.item.key, n.item.amount - n.line.amount])).toEqual([["inv", 40], ["hotel", 110]]);
    expect(m.bankOnly.map((l) => l.row)).toEqual([3]);
    expect(m.xeroOnly.map((x) => x.key)).toEqual(["too-far"]);
    const out = compare({ lines: [line("2026-01-01", 0, 1000000, 0), ...lines.map((l, i) => ({ ...l, balance: 1000000 - [682600, 702332, 712332][i] }))], items, ledgerEnd: 1000000 - 682560 - 19622 - 11000, periodEnd: "2026-09-30" });
    expect(out.items.find((h) => h.xero_ref === "inv")).toMatchObject({ side: "xero_only", kind: "error", amount: 40 });
    expect(out.check).toBe(0);
    expect(out.said.join(" ")).toMatch(/slightly different amounts/);
  });

  it("matches each line once, to the nearest date", () => {
    const lines = [line("2026-09-10", -500, 0, 1), line("2026-09-11", -500, 0, 2)];
    const items = [item("2026-09-11", -500, "x"), item("2026-09-14", -500, "y")];
    const m = matchAfter({ lines, items, from: "2026-09-01", periodEnd: "2026-09-30" });
    expect(m.matched.map((p) => [p.line.row, p.item.key])).toEqual([[1, "x"], [2, "y"]]);
    expect(m.bankOnly).toEqual([]);
    expect(agreedPoint({ lines: [line("2026-09-10", 0, 5, 1)], items: [], ledgerEnd: 6, periodEnd: "2026-09-30" })).toBe(null);
  });
});

describe("testing near matches against Xero's own balances", () => {
  // The case of 13 Nov 2026 (names changed): a card account, January to
  // September. Xero sat 10.63 below the statement at every month end, and
  // Xero's net movement equalled the statement's in every month. The old
  // matcher held four near differences (0.40, 1.10, -0.20, -2.02; net -0.72)
  // as errors and called the rest, 9.91, older than the file.
  const opening = 100000;
  const bankMoves = [
    ["2026-01-13", -53874], ["2026-02-02", 700000], ["2026-03-25", -682600], ["2026-04-10", -1250], ["2026-05-31", 7499],
    ["2026-06-03", -19732], ["2026-06-05", -350], ["2026-07-15", 25000], ["2026-09-30", -30069],
  ];
  let run = opening;
  const lines = bankMoves.map(([date, amount], i) => { run += amount; return { row: i + 2, date, description: `L${i}`, amount, balance: run }; });
  const items = [
    { key: "charge", date: "2026-01-13", amount: -53341 }, { key: "fee", date: "2026-01-13", amount: -533 },
    { key: "funding", date: "2026-02-02", amount: 700000 },
    { key: "sta", date: "2026-03-25", amount: -682560 },
    { key: "sub", date: "2026-04-10", amount: -1250 },
    { key: "late", date: "2026-06-01", amount: 7499 },
    { key: "hotel", date: "2026-06-03", amount: -19622 }, { key: "coffee", date: "2026-06-05", amount: -370 },
    { key: "refund", date: "2026-07-15", amount: 25000 },
    { key: "batch", date: "2026-09-30", amount: -30271 }, { key: "receipt", date: "2026-09-30", amount: 202 },
  ].map((x) => ({ ...x, description: x.key }));
  const periodEnd = "2026-09-30";
  const statementAt = (d) => bs.balanceAt(lines, d);
  // Xero 10.63 below at every month end, but for 31 May: a receipt on the
  // statement that day is in Xero on 1 June, so the gap is 85.62 (as seen).
  const xeroBalances = Object.fromEntries(bs.balanceDays(lines, periodEnd).map((d) => [d, statementAt(d) - 1063 - (d === "2026-05-31" ? 7499 : 0)]));
  const ledgerEnd = xeroBalances[periodEnd];

  it("reads Xero's balance on the day before the file and at each month end", () => {
    expect(bs.balanceDays(lines, periodEnd)).toEqual([
      "2026-01-12", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30",
    ]);
  });

  it("holds nothing and puts the whole 10.63 before the file", () => {
    const out = compare({ lines, items, ledgerEnd, periodEnd, xeroBalances });
    expect(out.agreed).toBe(null);
    expect(out.items).toEqual([]);
    expect(out.before_file).toMatchObject({ date: "2026-01-12", statement: opening, xero: opening - 1063, difference: 1063, from_xero: true });
    expect(out.check).toBe(1063);
    expect(out.noted.map((n) => n.amount).sort((a, b) => a - b)).toEqual([-20, 40, 110]);
    expect(out.said.join(" ")).toMatch(/difference of 10\.63/);
    expect(out.said.join(" ")).not.toMatch(/A further/);
  });

  it("matches a bank line to a Xero payment and a receipt on the same day", () => {
    const m = matchAfter({ lines, items, from: "2026-01-12", periodEnd });
    const amazon = m.matched.find((p) => p.line?.date === "2026-09-30");
    expect(amazon.items.map((x) => x.key).sort()).toEqual(["batch", "receipt"]);
    expect(m.near.map((n) => n.item.key)).toEqual(["sta", "hotel", "coffee"]);
    expect(m.matched.some((p) => p.item?.key === "late")).toBe(true);
  });

  it("still holds a near difference when Xero's balance did move by it", () => {
    const moved = { ...xeroBalances };
    for (const d of Object.keys(moved)) if (d >= "2026-03-31") moved[d] += 40;
    const out = compare({ lines, items, ledgerEnd: moved[periodEnd], periodEnd, xeroBalances: moved });
    expect(out.items.map((h) => [h.xero_ref, h.kind, h.amount])).toEqual([["sta", "error", 40]]);
    expect(out.check - out.before_file.difference).toBe(0);
  });

  it("without Xero's balances, works the day before back from the items and holds the near differences", () => {
    const out = compare({ lines, items, ledgerEnd, periodEnd });
    expect(out.before_file.from_xero).toBe(false);
    expect(out.items.map((h) => h.xero_ref)).toEqual(["sta", "hotel", "coffee"]);
    expect(out.before_file.difference).toBe(1063 + 130);
    expect(out.check).toBe(1063 + 130);
    expect(out.said.join(" ")).not.toMatch(/A further/);
  });

  it("finds the fewest entries of either sign that make up an amount", () => {
    const pool = [{ amount: 500 }, { amount: -300 }, { amount: 202 }, { amount: 100 }];
    expect(bs.offsetsFor(202, pool)).toEqual([{ amount: 202 }]);
    expect(bs.offsetsFor(200, pool)).toEqual([{ amount: 500 }, { amount: -300 }]);
    expect(bs.offsetsFor(7, pool)).toBe(null);
  });

  it("reads one account's closing balance from Xero's Bank Summary", () => {
    const report = { Reports: [{ Rows: [
      { RowType: "Header", Cells: [{ Value: "Bank Accounts" }, { Value: "Opening Balance" }, { Value: "Cash Received" }, { Value: "Cash Spent" }, { Value: "Closing Balance" }] },
      { RowType: "Section", Rows: [
        { RowType: "Row", Cells: [{ Value: "Other", Attributes: [{ Id: "accountID", Value: "x-1" }] }, { Value: "1.00" }, { Value: "0" }, { Value: "0" }, { Value: "1.00" }] },
        { RowType: "Row", Cells: [{ Value: "Card GBP", Attributes: [{ Id: "accountID", Value: "a-2" }] }, { Value: "100.00" }, { Value: "5.00" }, { Value: "10.00" }, { Value: "-1,095.00" }] },
        { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "" }, { Value: "" }, { Value: "" }, { Value: "96.00" }] },
      ] },
    ] }] };
    expect(bs.bankSummaryClosing(report, "a-2")).toBe(-109500);
    expect(bs.bankSummaryClosing(report, null, "Other")).toBe(100);
    expect(bs.bankSummaryClosing(report, "nope")).toBe(null);
  });
});

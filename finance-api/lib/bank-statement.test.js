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

  it("matches each line once, to the nearest date", () => {
    const lines = [line("2026-09-10", -500, 0, 1), line("2026-09-11", -500, 0, 2)];
    const items = [item("2026-09-11", -500, "x"), item("2026-09-14", -500, "y")];
    const m = matchAfter({ lines, items, from: "2026-09-01", periodEnd: "2026-09-30" });
    expect(m.matched.map((p) => [p.line.row, p.item.key])).toEqual([[1, "x"], [2, "y"]]);
    expect(m.bankOnly).toEqual([]);
    expect(agreedPoint({ lines: [line("2026-09-10", 0, 5, 1)], items: [], ledgerEnd: 6, periodEnd: "2026-09-30" })).toBe(null);
  });
});

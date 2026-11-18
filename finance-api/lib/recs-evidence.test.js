import { describe, expect, it } from "vitest";
import {
  workable, usesEvidence, notWorkableReason, evidenceTotals, autoMethod, outstandingAt, creditLeftAt, paidAheadAt, paidAheadItems, ageingEvidence, intercompanyGrid,
  counterpartCandidates, carryForward, stepIssues, prepareInstruction, cover,
} from "./recs";
import { classify } from "./bs-matrix";

describe("which recs can be worked", () => {
  it("Prepayments by schedule, any placed evidence account, never an unplaced one or another schedule", () => {
    expect(workable("prepay", "schedule")).toBe(true);
    expect(workable("ar", "outside_evidence")).toBe(true);
    expect(workable("reserves", "ledger_review")).toBe(true);
    expect(workable(null, "ledger_review")).toBe(false);
    // Asset accounts are proved by the asset register as evidence (18 Nov 2026).
    expect(workable("ppe", "schedule")).toBe(true);
    expect(workable("intangible", "schedule")).toBe(true);
    expect(autoMethod({ line_key: "ppe" })).toBe("asset_register");
    expect(workable("provisions", "schedule")).toBe(true);   // the schedule is recorded as evidence until built
    expect(workable(null, "schedule")).toBe(false);
    expect(notWorkableReason(null, "ledger_review")).toMatch(/Place this account/);
    expect(notWorkableReason("provisions", "schedule")).toBe(null);
    expect(usesEvidence("prepay", "schedule")).toBe(false);
  });
});

describe("evidence as support", () => {
  it("sums each company's evidence; a company with none does not tie", () => {
    const t = evidenceTotals([{ entity_id: "a", amount: "100.10" }, { entity_id: "a", amount: -0.1 }, { entity_id: "b", amount: 5 }]);
    expect(t.get("a")).toBe(10000);
    const c = cover([{ entity_id: "a", closing: "100.00" }, { entity_id: "c", closing: "1.00" }], t, 0);
    expect(c.rows.find((r) => r.entity_id === "a").ties).toBe(true);
    expect(c.rows.find((r) => r.entity_id === "c").ties).toBe(false);
    expect(c.ties).toBe(false);
  });

  it("refuses to prepare an evidence rec until every company has evidence", () => {
    const rec = { line_key: "ar", proof: "outside_evidence", status: "in_progress" };
    expect(stepIssues("prepare", { rec, tied: true, via: null, missingEvidence: ["Alpha Ltd"] })[0]).toMatch(/Add the evidence for Alpha Ltd/);
    expect(stepIssues("prepare", { rec, tied: true, via: null, missingEvidence: [] })).toEqual([]);
  });

  it("asks FM1 for evidence, not the schedule, and never the ledger as its own evidence", () => {
    const text = prepareInstruction({ id: "r", account_name: "Accounts Receivable", period: "2026-10", line_key: "ar", proof: "outside_evidence" });
    expect(text).toMatch(/fetch_rec_evidence/);
    expect(text).toMatch(/never record the ledger figure itself/);
    expect(prepareInstruction({ id: "r", account_name: "Directors' Loan", period: "2026-10", line_key: "loans", proof: "outside_evidence" })).toMatch(/add_rec_evidence/);
    expect(prepareInstruction({ id: "r", account_name: "Prepayments", period: "2026-10", line_key: "prepay", proof: "schedule" })).toMatch(/run_rec_checks/);
  });
});

describe("automatic methods", () => {
  it("by line", () => {
    expect(autoMethod({ line_key: "ar" })).toBe("ageing_ar");
    expect(autoMethod({ line_key: "ap" })).toBe("ageing_ap");
    expect(autoMethod({ line_key: "ar", account_name: "Accounts Receivable" })).toBe("ageing_ar");
    expect(autoMethod({ line_key: "ar", account_name: "Other debtors" })).toBe(null);
    expect(autoMethod({ line_key: "ap", account_name: "Other creditors" })).toBe(null);
    expect(autoMethod({ line_key: "ap", account_name: "Trade Creditors" })).toBe("ageing_ap");
    expect(autoMethod({ line_key: "ic_asset", account_name: "Alpha intercompany" })).toBe("counterpart");
    expect(autoMethod({ line_key: "ic_liab", account_name: "Owed to Alpha" })).toBe("counterpart");
    expect(autoMethod({ line_key: "loans", account_name: "Alpha Intercompany Loan" })).toBe("counterpart");
    expect(autoMethod({ line_key: "loans", account_name: "Directors' Loan Account" })).toBe(null);
    expect(autoMethod({ line_key: "sharecap" })).toBe("carry_forward");
    expect(autoMethod({ line_key: "vat" })).toBe("vat_return");
  });

  it("works an invoice's balance at a date from its own payments and credits", () => {
    const inv = { Status: "PAID", DateString: "2026-09-10T00:00:00", Total: 120,
      Payments: [{ DateString: "2026-10-05T00:00:00", Amount: 100 }], CreditNotes: [{ DateString: "2026-09-20T00:00:00", AppliedAmount: 20 }] };
    expect(outstandingAt(inv, "2026-09-30")).toBe(10000);
    expect(outstandingAt(inv, "2026-10-31")).toBe(0);
    expect(outstandingAt({ ...inv, DateString: "2026-10-01T00:00:00" }, "2026-09-30")).toBe(null);
    expect(outstandingAt({ ...inv, Status: "VOIDED" }, "2026-10-31")).toBe(null);
    expect(creditLeftAt({ Status: "AUTHORISED", DateString: "2026-09-01T00:00:00", Total: 50, Allocations: [{ DateString: "2026-10-02T00:00:00", Amount: 50 }] }, "2026-09-30")).toBe(5000);
  });

  it("reads a payment dated only as /Date(ms)/, as Xero nests them on an invoice", () => {
    // The shape Xero returned on 10 Nov 2026: a part-payment with no DateString.
    const inv = { Status: "AUTHORISED", DateString: "2026-09-03T00:00:00", Date: "/Date(1788393600000+0000)/", Total: 250000,
      Payments: [{ Date: "/Date(1792368000000+0000)/", Amount: 119988 }] };
    expect(outstandingAt(inv, "2026-09-30")).toBe(25000000);
    expect(outstandingAt(inv, "2026-10-31")).toBe(13001200);
    expect(outstandingAt({ Status: "AUTHORISED", Date: "/Date(1788393600000+0000)/", Total: 10 }, "2026-09-30")).toBe(1000);
    expect(creditLeftAt({ Status: "AUTHORISED", DateString: "2026-09-01T00:00:00", Total: 50, Allocations: [{ Date: "/Date(1792368000000+0000)/", Amount: 50 }] }, "2026-10-31")).toBe(0);
    expect(ageingEvidence([inv], { date: "2026-10-31", kind: "ar" })).toMatchObject({ amount: "130012.00", count: 1 });
  });

  it("gives receivables as a debit and payables as a credit, net of unallocated credit", () => {
    const invs = [{ Status: "AUTHORISED", DateString: "2026-10-01T00:00:00", Total: 300 }, { Status: "AUTHORISED", DateString: "2026-10-02T00:00:00", Total: 200, CurrencyRate: 2 }];
    const cns = [{ Status: "AUTHORISED", DateString: "2026-10-03T00:00:00", Total: 50 }];
    expect(ageingEvidence(invs, { date: "2026-10-31", kind: "ar", creditNotes: cns })).toMatchObject({ amount: "350.00", count: 2 });
    const ap = ageingEvidence(invs, { date: "2026-10-31", kind: "ap" });
    expect(ap.amount).toBe("-400.00");
    expect(ap.note).toMatch(/1 in another currency/);
  });

  it("counts payments made by the month end against bills dated after it", () => {
    // Two bills dated 1 Oct, paid 29 Sep; one paid in October is not counted.
    const later = [
      { Status: "PAID", DateString: "2026-10-01T00:00:00", Total: 18732, Payments: [{ DateString: "2026-09-29T00:00:00", Amount: 18732 }] },
      { Status: "PAID", DateString: "2026-10-01T00:00:00", Total: 18000, Payments: [{ Date: "/Date(1790640000000+0000)/", Amount: 18000 }] },
      { Status: "PAID", DateString: "2026-10-05T00:00:00", Total: 500, Payments: [{ DateString: "2026-10-06T00:00:00", Amount: 500 }] },
    ];
    expect(paidAheadAt(later[0], "2026-09-30")).toBe(1873200);
    expect(paidAheadAt(later[2], "2026-09-30")).toBe(0);
    expect(paidAheadAt({ ...later[0], DateString: "2026-09-15T00:00:00" }, "2026-09-30")).toBe(0);   // not after: it is outstandingAt's
    // The evidence stays the ageing; each payment ahead is a timing item, signed as the ledger.
    const invs = [{ Status: "AUTHORISED", DateString: "2026-09-10T00:00:00", Total: 1000 }];
    expect(ageingEvidence(invs, { date: "2026-09-30", kind: "ap" }).amount).toBe("-1000.00");
    const items = paidAheadItems(later.map((x, i) => ({ ...x, InvoiceNumber: `LTD-${i}`, Contact: { Name: "Sample Supplier Ltd" } })), { date: "2026-09-30", kind: "ap" });
    expect(items).toEqual([
      expect.objectContaining({ side: "xero_only", kind: "timing", txn_date: "2026-09-29", amount: "18732.00", xero_ref: "LTD-0" }),
      expect.objectContaining({ amount: "18000.00", xero_ref: "LTD-1" }),
    ]);
    expect(items[0].description).toMatch(/Paid 2026-09-29 on Sample Supplier Ltd LTD-0 dated 2026-10-01/);
    expect(paidAheadItems([later[0]], { date: "2026-09-30", kind: "ar" })[0].amount).toBe("-18732.00");
  });

  it("takes off prepayments and overpayments not allocated at the month end", () => {
    const invs = [{ Status: "AUTHORISED", DateString: "2026-10-01T00:00:00", Total: 5000 }];
    const advances = [
      // A supplier overpayment on 28 Oct, still open at 31 Oct.
      { Status: "AUTHORISED", DateString: "2026-10-28T00:00:00", Total: 3000, Allocations: [] },
      // A prepayment allocated in November was still open at 31 Oct.
      { Status: "PAID", DateString: "2026-10-05T00:00:00", Total: 400, Allocations: [{ DateString: "2026-11-02T00:00:00", Amount: 400 }] },
      // One allocated in October is not.
      { Status: "PAID", DateString: "2026-10-06T00:00:00", Total: 100, Allocations: [{ DateString: "2026-10-20T00:00:00", Amount: 100 }] },
      { Status: "VOIDED", DateString: "2026-10-07T00:00:00", Total: 999 },
    ];
    const ap = ageingEvidence(invs, { date: "2026-10-31", kind: "ap", advances });
    expect(ap.amount).toBe("-1600.00");
    expect(ap.note).toMatch(/less 2 prepayments or overpayments not yet allocated/);
    expect(ageingEvidence(invs, { date: "2026-09-30", kind: "ap", advances }).amount).toBe("0.00");
  });

  it("lays out the group's intercompany pairs and grid, paired from either side", () => {
    const names = new Map([["u", "Alpha Digital Ltd"], ["h", "Beta Holdings Ltd"], ["f", "Gamma Ltd"]]);
    const acc = (id, name, entity, closing, twin = null) => ({ rec_id: `r-${id}`, rec_account_id: id, account_name: name, entity_id: entity, closing, counterpart_account_id: twin, status: "in_progress" });
    const out = intercompanyGrid([
      acc("u1", "Beta Holdings intercompany", "u", 1000000, "h1"),
      acc("h1", "Alpha intercompany", "h", -1000000),            // paired from the other side only
      acc("u2", "Gamma intercompany loan", "u", 50000, "f1"),
      acc("f1", "Alpha intercompany loan", "f", -49000),           // out by 10.00
      acc("h2", "Gamma intercompany", "h", 2500),                  // not paired
    ], names, 0);
    expect(out.pairs).toHaveLength(2);
    expect(out.pairs[0]).toMatchObject({ difference: "0.00", ties: true });
    expect(out.pairs[1]).toMatchObject({ difference: "10.00", ties: false });
    expect(out.unpaired).toEqual([expect.objectContaining({ account_name: "Gamma intercompany", entity: "Beta Holdings Ltd", paired_elsewhere: false })]);
    expect(out.ties).toBe(false);
    expect(out.grid.entities.map((e) => e.name)).toEqual(["Alpha Digital Ltd", "Beta Holdings Ltd", "Gamma Ltd"]);
    expect(out.grid.cells).toEqual(expect.arrayContaining([
      { from: "u", to: "h", amount: "10000.00", ties: true }, { from: "h", to: "u", amount: "-10000.00", ties: true }, { from: "f", to: "u", amount: "-490.00", ties: false },
    ]));
    expect(intercompanyGrid([acc("u1", "x", "u", 100, "h1"), acc("h1", "y", "h", -100)], names, 0).ties).toBe(true);
  });

  it("suggests a pair for an unpaired account, pairs each account once, and ties cells within tolerance", () => {
    const names = new Map([["u", "Alpha Digital Ltd"], ["h", "Beta Holdings Ltd"]]);
    const acc = (id, name, entity, closing, twin = null) => ({ rec_id: `r-${id}`, rec_account_id: id, account_name: name, entity_id: entity, closing, counterpart_account_id: twin, status: "in_progress" });
    // No line_key on these, as the route builds them.
    const lone = intercompanyGrid([acc("u1", "Beta Holdings intercompany", "u", 1000), acc("h1", "Alpha intercompany", "h", -1000)], names, 0);
    expect(lone.unpaired).toEqual([]);
    expect(lone.suggested_pairs).toEqual([expect.objectContaining({ a: expect.objectContaining({ account_name: "Beta Holdings intercompany" }),
      b: expect.objectContaining({ account_name: "Alpha intercompany", entity: "Beta Holdings Ltd", rec_account_id: "h1" }), difference: "0.00", ties: true })]);
    expect(lone.ties).toBe(false);
    // Two accounts naming the same twin: the second is not paired again.
    const twice = intercompanyGrid([acc("u1", "Beta trading", "u", 1000, "h1"), acc("u2", "Beta loan", "u", 500, "h1"), acc("h1", "Alpha", "h", -1000)], names, 0);
    expect(twice.pairs).toHaveLength(1);
    expect(twice.unpaired.map((x) => x.account_name)).toEqual(["Beta loan"]);
    expect(twice.unpaired[0].paired_elsewhere).toBe(true);
    expect(twice.grid.cells.find((c) => c.from === "h")).toMatchObject({ amount: "-10.00", ties: true });
    // Within a 1.00 tolerance, the pair and its grid cells agree.
    const near = intercompanyGrid([acc("u1", "x", "u", 1000040, "h1"), acc("h1", "y", "h", -1000000)], names, 100);
    expect(near.pairs[0].ties).toBe(true);
    expect(near.grid.cells.every((c) => c.ties)).toBe(true);
    expect(intercompanyGrid([acc("u1", "x", "u", 1000040, "h1"), acc("h1", "y", "h", -1000000)], names, 0).grid.cells.every((c) => !c.ties)).toBe(true);
  });

  it("matches pairs when the companies go by short names, from every name they have, by amount between equals", () => {
    // As Feldspar (18 Nov 2026): companies shown as three-letter codes, so the
    // display name alone matched no account and nothing was ever suggested.
    const names = new Map([["h", "HCO"], ["s", "SCO"], ["d", "DCO"]]);
    const aliases = new Map([["h", "HCO Alpha Group Holdings Limited alpha-group-holdings"], ["s", "SCO Alpha Ltd alpha-ltd"], ["d", "DCO Delta Digital Ltd delta-digital"]]);
    const acc = (id, name, entity, closing) => ({ rec_id: `r-${id}`, rec_account_id: id, account_name: name, entity_id: entity, closing, counterpart_account_id: null, status: "in_progress" });
    const month = [
      acc("d641", "Alpha Group Holdings", "d", 70108917), acc("s804", "Alpha Group Holdings intercompany", "s", -4437492),
      acc("d640", "Alpha Intercompany Loan", "d", 85017758), acc("h662", "Alpha Ltd intercompany", "h", 4437492),
      acc("h621", "Delta Intercompany Account", "h", -70008917), acc("s802", "Delta Intercompany Loan", "s", -84862782),
    ];
    const out = intercompanyGrid(month, names, 0, aliases);
    const got = out.suggested_pairs.map((p) => [p.a.rec_account_id, p.b.rec_account_id, p.difference].join(" ")).sort();
    expect(got).toEqual(["d640 s802 1549.76", "d641 h621 1000.00", "s804 h662 0.00"]);
    expect(out.unpaired).toEqual([]);
    // Without the other names, amounts still find them: nothing is ruled out on its name.
    expect(intercompanyGrid(month, names, 0).suggested_pairs).toHaveLength(3);
    expect(counterpartCandidates({ ...month[0], line_key: "ic_asset" }, month.map((m) => ({ ...m, line_key: "ic_asset" })), names, aliases)[0])
      .toMatchObject({ rec_account_id: "h621", difference: "1000.00" });
  });

  it("counts a foreign prepayment or overpayment in the note", () => {
    const ev = ageingEvidence([], { date: "2026-10-31", kind: "ap", advances: [{ Status: "AUTHORISED", DateString: "2026-10-01T00:00:00", Total: 100, CurrencyRate: 2 }] });
    expect(ev.amount).toBe("50.00");
    expect(ev.note).toMatch(/1 in another currency/);
  });

  it("suggests the intercompany twin that names this company, closest balance first", () => {
    const names = new Map([["e1", "Alpha Trading Ltd"], ["e2", "Beta Holdings Ltd"], ["e3", "Gamma Ltd"]]);
    const me = { id: "r1", rec_account_id: "a1", account_name: "Beta intercompany", entity_id: "e1", closing: 4437492, line_key: "ic_asset" };
    const others = [
      me,
      { id: "r2", rec_account_id: "a2", account_name: "Alpha Trading intercompany", entity_id: "e2", closing: -4370492, line_key: "ic_asset" },
      { id: "r3", rec_account_id: "a3", account_name: "Software", entity_id: "e2", closing: 100, line_key: "ppe" },
      { id: "r4", rec_account_id: "a4", account_name: "Gamma loan", entity_id: "e3", closing: -4437492, line_key: "loans" },
    ];
    const c = counterpartCandidates(me, others, names);
    expect(c[0]).toMatchObject({ rec_account_id: "a2", difference: "670.00" });
    expect(c.map((x) => x.rec_account_id)).not.toContain("a3");
  });

  it("carries last month's evidence only where the account did not move", () => {
    const prior = [{ entity_id: "a", amount: "-102.00", source: "Confirmation statement" }, { entity_id: "b", amount: "-1.00", source: "x" }];
    expect(carryForward(prior, [{ entity_id: "a", movement: "0.00" }, { entity_id: "b", movement: "5.00" }]).map((e) => e.entity_id)).toEqual(["a"]);
  });
});

describe("the matrix", () => {
  it("files a bank account as cash whatever it is called, and VAT only on the whole word", () => {
    expect(classify({ Name: "HSBC Innovation", Type: "BANK" }).key).toBe("cash");
    expect(classify({ Name: "Innovation reserve", Type: "CURRLIAB" })?.key).not.toBe("vat");
    expect(classify({ Name: "VAT", Type: "CURRLIAB" }).key).toBe("vat");
    expect(classify({ Name: "Output VAT control", Type: "CURRLIAB" }).key).toBe("vat");
  });
});

describe("an intercompany reconciliation at sign-off", () => {
  const { counterpartSignOffIssues } = require("./recs");
  const twin = { entity: "Beta Ltd", account: "Alpha intercompany", closing: -1234567 };
  it("is refused unpaired, or when the counterpart was not read", () => {
    expect(counterpartSignOffIssues({ paired: false, twin, evidence: [] })[0]).toMatch(/Choose the paired account/);
    expect(counterpartSignOffIssues({ paired: true, twin: null, evidence: [] })[0]).toMatch(/not found/);
  });
  it("needs the counterpart's balance, reversed, as its evidence, as Xero holds it now", () => {
    expect(counterpartSignOffIssues({ paired: true, twin, evidence: [] })[0]).toMatch(/Fetch the evidence: Beta Ltd holds Alpha intercompany at -12,345.67, which reversed is 12,345.67/);
    expect(counterpartSignOffIssues({ paired: true, twin, evidence: [{ method: null, amount: "12345.67" }] })[0]).toMatch(/Fetch the evidence/);
    expect(counterpartSignOffIssues({ paired: true, twin, evidence: [{ method: "counterpart", amount: "12345.67" }] })).toEqual([]);
    const moved = counterpartSignOffIssues({ paired: true, twin: { ...twin, closing: -1300000 }, evidence: [{ method: "counterpart", amount: "12345.67" }] });
    expect(moved[0]).toMatch(/now holds -13,000.00 \(reversed 13,000.00\), but the evidence says 12,345.67/);
  });
});

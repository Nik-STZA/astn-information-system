import { describe, expect, it } from "vitest";
import {
  workable, usesEvidence, notWorkableReason, evidenceTotals, autoMethod, outstandingAt, creditLeftAt, ageingEvidence,
  counterpartCandidates, carryForward, stepIssues, prepareInstruction, cover,
} from "./recs";
import { classify } from "./bs-matrix";

describe("which recs can be worked", () => {
  it("Prepayments by schedule, any placed evidence account, never an unplaced one or another schedule", () => {
    expect(workable("prepay", "schedule")).toBe(true);
    expect(workable("ar", "outside_evidence")).toBe(true);
    expect(workable("reserves", "ledger_review")).toBe(true);
    expect(workable(null, "ledger_review")).toBe(false);
    expect(workable("ppe", "schedule")).toBe(false);
    expect(notWorkableReason(null, "ledger_review")).toMatch(/Place this account/);
    expect(notWorkableReason("ppe", "schedule")).toMatch(/schedule, which is not built/);
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
    expect(autoMethod({ line_key: "ic_asset", account_name: "Alpha intercompany" })).toBe("counterpart");
    expect(autoMethod({ line_key: "loans", account_name: "Alpha Intercompany Loan" })).toBe("counterpart");
    expect(autoMethod({ line_key: "loans", account_name: "Directors' Loan Account" })).toBe(null);
    expect(autoMethod({ line_key: "sharecap" })).toBe("carry_forward");
    expect(autoMethod({ line_key: "vat" })).toBe(null);
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

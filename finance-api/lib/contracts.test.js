import { describe, it, expect } from "vitest";
import {
  PATTERNS, PATTERN, contractInput, sideIssues, scheduleInput, scheduleIssues, movementInput,
  heldAt, deferredEvidence, noticeBy, noticeTask, comingUp, parseRead, buildReadRequest, isPdf,
} from "./contracts";

const entities = [
  { id: "00000000-0000-4000-8000-0000000000e1", slug: "group-holdings", name: "Group Holdings" },
  { id: "00000000-0000-4000-8000-0000000000e2", slug: "trading-co", name: "Trading Co" },
];

describe("patterns", () => {
  it("covers both sides, including sport revenue", () => {
    for (const k of ["goods", "services_time", "subscription", "milestone", "deposit", "agent", "sponsorship", "event", "grant", "media_rights"]) {
      expect(PATTERN[k].side).toBe("customer");
    }
    for (const k of ["prepaid", "recurring", "lease", "services_buy"]) expect(PATTERN[k].side).toBe("supplier");
    expect(new Set(PATTERNS.map((p) => p.key)).size).toBe(PATTERNS.length);
  });

  it("refuses a pattern from the other side", () => {
    expect(sideIssues("supplier", "milestone")).toEqual(["Milestone or installation is a customer pattern; this is a supplier contract"]);
    expect(sideIssues("customer", "milestone")).toEqual([]);
  });
});

describe("contract fields", () => {
  it("takes a full contract, naming the company by slug", () => {
    const { set, issues } = contractInput({
      entity: "group-holdings", side: "customer", counterparty: " Jo Bloggs Foundation ", pattern: "milestone",
      total_value: "250,000.00", start_date: "2026-09-03", renewal: "no", account_code: "810",
    }, entities);
    expect(issues).toEqual([]);
    expect(set).toMatchObject({ entity_id: entities[0].id, side: "customer", counterparty: "Jo Bloggs Foundation", pattern: "milestone", total_value: 250000, currency: "GBP", account_code: "810" });
  });

  it("says what is missing or wrong", () => {
    const { issues } = contractInput({ entity: "other-client-co", side: "both", pattern: "x", start_date: "3/9/2026", notice_days: 1.5 }, entities);
    expect(issues).toEqual(expect.arrayContaining([
      "entity must be one of this client's companies", "side must be customer or supplier",
      "counterparty is required: who the contract is with", "pattern must be one of the standard patterns",
      "start_date must be YYYY-MM-DD", "notice_days must be a whole number of days",
    ]));
  });

  it("an edit changes only what it names", () => {
    const { set, issues } = contractInput({ notice_days: 30 }, entities, { partial: true });
    expect(issues).toEqual([]);
    expect(set).toEqual({ notice_days: 30 });
  });
});

describe("schedule", () => {
  it("a milestone is met only with its evidence named", () => {
    expect(scheduleIssues({ kind: "milestone", status: "met", evidence: "" })).toHaveLength(1);
    expect(scheduleIssues({ kind: "milestone", status: "met", evidence: "Signed handover note 12 Feb" })).toEqual([]);
    expect(scheduleIssues({ kind: "payment", status: "met" })).toEqual([]);
  });

  it("checks an instalment", () => {
    expect(scheduleInput({ kind: "payment", label: "Second instalment", amount: "65000", trigger_text: "14 days from shipping" }).issues).toEqual([]);
    expect(scheduleInput({ kind: "fee", label: "", due_on: "soon" }).issues).toEqual(["kind must be payment or milestone", "label is required", "due_on must be YYYY-MM-DD"]);
  });

  it("checks a movement", () => {
    expect(movementInput({ kind: "billed", on_date: "2026-09-03", amount: 250000, ref: "INV-0003" }).issues).toEqual([]);
    expect(movementInput({ kind: "billed", on_date: "2026-09-03", amount: 0 }).issues).toEqual(["amount must be more than nothing"]);
  });
});

describe("what a contract holds", () => {
  const movements = [
    { kind: "billed", on_date: "2026-09-03", amount: "250000.00" },
    { kind: "released", on_date: "2027-02-28", amount: "200000.00" },
    { kind: "billed", on_date: "2026-10-01", amount: "5.00", withdrawn_at: "2026-10-02" },
  ];

  it("billed less released, to the date", () => {
    expect(heldAt(movements, "2026-08-31")).toBe(0);
    expect(heldAt(movements, "2026-10-31")).toBe(25000000);
    expect(heldAt(movements, "2027-02-28")).toBe(5000000);
  });

  it("is a deferred income rec's evidence, as a liability, per company and account", () => {
    const contracts = [
      { id: "c1", entity_id: entities[0].id, side: "customer", account_code: "810", counterparty: "Jo Bloggs Foundation", movements },
      { id: "c2", entity_id: entities[0].id, side: "supplier", account_code: "810", counterparty: "A supplier", movements },
    ];
    const out = deferredEvidence([
      { entity_id: entities[0].id, entity_name: "Group Holdings", account_code: "810" },
      { entity_id: entities[1].id, entity_name: "Trading Co", account_code: "810" },
    ], contracts, "2026-10-31");
    expect(out.rows).toEqual([expect.objectContaining({ entity_id: entities[0].id, amount: "-250000.00" })]);
    expect(out.said[1]).toMatch(/Trading Co: no customer contract/);
  });
});

describe("notice deadlines", () => {
  const c = { id: "c1", counterparty: "An insurer", status: "active", renewal: "auto", end_date: "2027-03-01", notice_days: 30 };

  it("is the end less the notice period, for a contract that renews", () => {
    expect(noticeBy(c)).toBe("2027-01-30");
    expect(noticeBy({ ...c, renewal: "no" })).toBeNull();
    expect(noticeBy({ ...c, notice_days: null })).toBeNull();
  });

  it("raises a Work task 30 days ahead, once per deadline", () => {
    expect(noticeTask(c, "Trading Co")).toMatchObject({
      title: "Notice deadline: An insurer renews itself on 2027-03-01", due_on: "2026-12-31",
      source: "contract", source_ref: "contract:c1:notice:2027-01-30",
    });
    expect(noticeTask({ ...c, status: "ended" })).toBeNull();
  });
});

describe("coming up", () => {
  it("puts undated items first, then by date, inside the window", () => {
    const contracts = [
      { id: "c1", counterparty: "Jo Bloggs Foundation", status: "active", currency: "GBP" },
      { id: "c2", counterparty: "An insurer", status: "active", currency: "GBP", renewal: "auto", end_date: "2027-01-20", notice_days: 30 },
    ];
    const schedule = [
      { contract_id: "c1", kind: "payment", label: "Second instalment", amount: "65000", status: "pending", due_on: null, trigger_text: "14 days from shipping" },
      { contract_id: "c1", kind: "payment", label: "First instalment", amount: "120000", status: "met", due_on: "2026-10-03" },
      { contract_id: "c1", kind: "milestone", label: "Handover", status: "pending", due_on: null, expected: "early 2027" },
      { contract_id: "c1", kind: "payment", label: "Far off", status: "pending", due_on: "2028-01-01" },
    ];
    const out = comingUp(contracts, schedule, "2026-11-15");
    expect(out.map((x) => x.label)).toEqual(["Second instalment", "Handover", "Notice deadline: decide"]);
    expect(out[2].due_on).toBe("2026-12-21");
  });
});

describe("monitoring renewals", () => {
  const sub = { id: "s1", side: "supplier", status: "active", counterparty: "A software firm", renewal: "auto",
    start_date: "2026-01-01", end_date: "2026-12-31", notice_days: 30, cost_amount: 400, billing_frequency: "monthly" };

  it("annual value from the billing rate", async () => {
    const { annualValue } = await import("./contracts");
    expect(annualValue(sub)).toBe(4800);
    expect(annualValue({ ...sub, billing_frequency: "quarterly", cost_amount: 1000 })).toBe(4000);
    expect(annualValue({ ...sub, billing_frequency: "one_off" })).toBeNull();
    expect(annualValue({ ...sub, cost_amount: null })).toBeNull();
  });

  it("a decision applies only to the end date it was made for", async () => {
    const { currentDecision, noticeTask } = await import("./contracts");
    const kept = { ...sub, renewal_decision: "keep", renewal_decision_for: "2026-12-31" };
    expect(currentDecision(kept)).toBe("keep");
    expect(noticeTask(kept)).toBeNull();
    expect(currentDecision({ ...kept, end_date: "2027-12-31" })).toBeNull();
  });

  it("checks a decision", async () => {
    const { decisionInput } = await import("./contracts");
    expect(decisionInput({ decision: "cancel", note: "Not used since July" }, sub).issues).toEqual([]);
    expect(decisionInput({ decision: "drop", note: "" }, { ...sub, renewal: "no" }).issues).toEqual([
      "decision must be keep, cancel or renegotiate", "say why, in a few words", "this contract does not renew"]);
  });

  it("what renews in the next 90 days, and what is at stake", async () => {
    const { renewingSoon } = await import("./contracts");
    const out = renewingSoon([sub, { ...sub, id: "s2", end_date: "2027-06-30" }, { ...sub, id: "s3", renewal_decision: "cancel", renewal_decision_for: "2026-12-31" }], "2026-11-15");
    expect(out).toMatchObject({ count: 2, undecided: 1, cancelling: 1, supplier_annual: 9600 });
  });
});

describe("the forward view", () => {
  it("months of income and cost, renewals assumed unless cancelled, undated apart", async () => {
    const { forwardView } = await import("./contracts");
    const contracts = [
      { id: "s1", side: "supplier", status: "active", renewal: "auto", start_date: "2026-01-15", end_date: "2026-12-31", cost_amount: 400, billing_frequency: "monthly" },
      { id: "s2", side: "supplier", status: "active", renewal: "auto", start_date: "2026-03-01", end_date: "2027-02-28", cost_amount: 1200, billing_frequency: "annual",
        renewal_decision: "cancel", renewal_decision_for: "2027-02-28" },
      { id: "c1", side: "customer", status: "active", renewal: "no" },
      { id: "c2", side: "customer", status: "active", renewal: "no" },
    ];
    const schedule = [
      { contract_id: "c1", kind: "payment", status: "pending", amount: 65000, due_on: "2027-01-15" },
      { contract_id: "c1", kind: "payment", status: "pending", amount: 65000, due_on: null },
      { contract_id: "c1", kind: "payment", status: "met", amount: 120000, due_on: "2026-10-03" },
    ];
    const out = forwardView(contracts, schedule, "2026-11-15", 12);
    expect(out.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(out.months[0]).toMatchObject({ cost: 400, income: 0, assumed: 0 });
    expect(out.months[2]).toMatchObject({ income: 65000, cost: 400, assumed: 400, net: 64600 });
    // Cancelled: the annual subscription does not come round again in March 2027.
    expect(out.months[4].cost).toBe(400);
    expect(out.total.cost).toBe(4800);
    expect(out).toMatchObject({ undated_income: 65000, undated_count: 1, unpriced: 1 });
  });
});

describe("the Deferred income reconciliation", () => {
  it("is worked from the register as evidence, never as the Prepayments schedule", async () => {
    const recs = await import("./recs");
    expect(recs.autoMethod({ line_key: "deferred" })).toBe("contracts");
    expect(recs.usesEvidence("deferred", "schedule")).toBe(true);
    expect(recs.workable("deferred", "schedule")).toBe(true);
    expect(recs.bySchedule("deferred", "schedule")).toBe(false);
    expect(recs.bySchedule("prepay", "schedule")).toBe(true);
    expect(recs.usesEvidence("accruals", "schedule")).toBe(false);
    // rec_evidence holds only the two evidence kinds.
    expect(recs.evidenceKind("schedule")).toBe("outside_evidence");
    expect(recs.evidenceKind("ledger_review")).toBe("ledger_review");
  });

  it("places Xero's Income in Advance account on the deferred income line", async () => {
    const { classify } = await import("./bs-matrix");
    expect(classify({ Name: "Income in Advance", Type: "CURRLIAB" }).key).toBe("deferred");
    expect(classify({ Name: "Income received in advance", Type: "CURRLIAB" }).key).toBe("deferred");
    expect(classify({ Name: "Pensions Payable", Type: "CURRLIAB" }).key).toBe("payroll");
    expect(classify({ Name: "Provision for dilapidations", Type: "CURRLIAB" }).key).toBe("provisions");
    expect(classify({ Name: "Accruals", Type: "CURRLIAB" }).key).toBe("accruals");
  });
});

describe("reading a contract", () => {
  it("keeps what fits, drops what does not", () => {
    const out = parseRead(JSON.stringify({
      is_contract: true, side: "customer", company: "group-holdings", counterparty: "Jo Bloggs Foundation", pattern: "prepaid",
      currency: "gbp", total_value: 250000, start_date: "2026-09-03", end_date: "31/12/2027", renewal: "no", notice_days: -1,
      schedule: [{ kind: "payment", label: "First", amount: 120000, trigger_text: "within 30 days of signing", due_on: "next month" }],
      pages: { counterparty: "p1" }, not_found: ["end date"],
    }), entities);
    expect(out).toMatchObject({
      side: "customer", entity: "group-holdings", pattern: null, currency: "GBP", total_value: 250000, start_date: "2026-09-03",
      end_date: null, notice_days: null, pages: { counterparty: "p1" }, not_found: ["end date"],
    });
    expect(out.schedule[0]).toMatchObject({ kind: "payment", seq: 1, amount: 120000, due_on: null });
  });

  it("refuses an answer that is not JSON", () => {
    expect(() => parseRead("not json", entities)).toThrow("the reading was not valid JSON");
  });

  it("sends the PDF itself, with the companies and patterns", () => {
    const req = buildReadRequest({ bytes: Buffer.from("%PDF-1.4"), fileName: "a.pdf", entities, clientName: "A client" });
    expect(req.contents[0].parts[0].inlineData.mimeType).toBe("application/pdf");
    expect(req.contents[0].parts[1].text).toMatch(/group-holdings: Group Holdings/);
    expect(req.contents[0].parts[1].text).toMatch(/media_rights \(customer\)/);
    expect(isPdf(Buffer.from("%PDF-1.7 rest"))).toBe(true);
    expect(isPdf(Buffer.from("PK zip"))).toBe(false);
  });
});

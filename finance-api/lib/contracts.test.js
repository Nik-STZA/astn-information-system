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
    expect(out.map((x) => x.label)).toEqual(["Second instalment", "Handover", "Notice deadline"]);
    expect(out[2].due_on).toBe("2026-12-21");
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

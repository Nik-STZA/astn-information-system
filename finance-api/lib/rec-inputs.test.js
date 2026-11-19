import { describe, expect, it } from "vitest";
import { inputsKey, unchangedSince } from "./rec-inputs";

const PARTS = {
  status: "in_progress", review_note: null, prior_status: "signed_off",
  balances: [{ entity_id: "e1", opening: "100.00", closing: "250.00" }, { entity_id: "e2", opening: "0.00", closing: "-10.00" }],
  evidence: [{ id: "v1", entity_id: "e1", amount: "250.00" }],
  items: [{ id: "i1", updated_at: "2026-11-01T10:00:00.000Z", deleted_at: null }],
  reconciling: [{ id: "r1", state: "open", amount: "5.00", kind: "timing" }],
  statements: [],
  people: [{ id: "t1" }],
};

describe("what FM1 works from on a rec", () => {
  it("is the same whatever order the rows come in", () => {
    const shuffled = { ...PARTS, balances: [...PARTS.balances].reverse() };
    expect(inputsKey(shuffled)).toBe(inputsKey(PARTS));
    expect(inputsKey(PARTS)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("moves when anything FM1 would read moves", () => {
    const k = inputsKey(PARTS);
    expect(inputsKey({ ...PARTS, balances: [{ ...PARTS.balances[0], closing: "251.00" }, PARTS.balances[1]] })).not.toBe(k);
    expect(inputsKey({ ...PARTS, evidence: [] })).not.toBe(k);
    expect(inputsKey({ ...PARTS, items: [{ ...PARTS.items[0], updated_at: "2026-11-02T10:00:00.000Z" }] })).not.toBe(k);
    expect(inputsKey({ ...PARTS, reconciling: [{ ...PARTS.reconciling[0], state: "cleared" }] })).not.toBe(k);
    expect(inputsKey({ ...PARTS, people: [{ id: "t1" }, { id: "t2" }] })).not.toBe(k);
    expect(inputsKey({ ...PARTS, prior_status: "with_cfo" })).not.toBe(k);
    expect(inputsKey({ ...PARTS, review_note: "Look at the October bill" })).not.toBe(k);
  });

  it("reads money to the penny, not as typed", () => {
    expect(inputsKey({ ...PARTS, evidence: [{ id: "v1", entity_id: "e1", amount: 250 }] })).toBe(inputsKey(PARTS));
  });
});

describe("Run all leaves a rec alone", () => {
  const last = { run_id: "run-1", status: "succeeded", inputs: "abc", at: "2026-11-18T21:00:00.000Z" };

  it("when FM1 finished on it and nothing has moved since", () => {
    expect(unchangedSince({ rec: { status: "in_progress" }, last, key: "abc" }))
      .toBe("FM1 finished on it on 18 November 2026 and nothing has moved since, so its answer stands. Comment on the rec or add evidence to have it run again.");
  });

  it("but not when anything moved, the run failed, it was sent back, or it never ran", () => {
    expect(unchangedSince({ rec: { status: "in_progress" }, last, key: "abd" })).toBeNull();
    expect(unchangedSince({ rec: { status: "in_progress" }, last: { ...last, status: "failed" }, key: "abc" })).toBeNull();
    expect(unchangedSince({ rec: { status: "sent_back" }, last, key: "abc" })).toBeNull();
    expect(unchangedSince({ rec: { status: "not_started" }, last, key: "abc" })).toBeNull();
    expect(unchangedSince({ rec: { status: "in_progress" }, last: null, key: "abc" })).toBeNull();
  });
});

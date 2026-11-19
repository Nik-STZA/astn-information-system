import { describe, expect, it } from "vitest";
import { amountOf, decisionBody, isAccrualPath, isOpen, whoSaid } from "./accruals";

const ID = "12345678-1234-1234-1234-123456789012";

describe("accrual paths", () => {
  it("lets through what the page uses", () => {
    for (const p of ["accruals/run", "accruals/proposals", `accruals/proposals/${ID}/comments`, `accruals/proposals/${ID}/decide`,
      `accruals/precedents/${ID}/end`, `accruals/precedents/${ID}/promote`, `accruals/items/${ID}/stop`]) expect(isAccrualPath(p, "POST"), p).toBe(true);
    expect(isAccrualPath("accruals/settings", "PUT")).toBe(true);
  });
  it("keeps anything else out", () => {
    for (const p of ["accruals", "accruals/history", `accruals/proposals/${ID}`, "accruals/settings", "accruals/../journals", `accruals/proposals/${ID}/decide/x`]) {
      expect(isAccrualPath(p, "POST"), p).toBe(false);
    }
    expect(isAccrualPath("accruals/run", "PUT")).toBe(false);
  });
});

describe("the CFO's decision", () => {
  it("needs the reason for no accrual and the words of a question", () => {
    expect(decisionBody({ decision: "no_accrual", reason: " ", appliesTo: "this_month" }).issue).toMatch(/Say why/);
    expect(decisionBody({ decision: "question", reason: "", appliesTo: "this_month" }).issue).toMatch(/question/);
    expect(decisionBody({ decision: "no_accrual", reason: "Fully billed", appliesTo: "until_changed" }).body)
      .toEqual({ decision: "no_accrual", applies_to: "until_changed", reason: "Fully billed" });
  });
  it("takes edited lines in pounds, and refuses nil or a missing account", () => {
    expect(decisionBody({ decision: "accept_edited", reason: "", appliesTo: "this_month", lines: [{ account_code: "412", amount: "1,250.5" }] }).body)
      .toEqual({ decision: "accept_edited", applies_to: "this_month", lines: [{ account_code: "412", amount: 1250.5 }] });
    expect(decisionBody({ decision: "accept_edited", reason: "", appliesTo: "this_month", lines: [{ account_code: "412", amount: "0" }] }).issue).toBeTruthy();
    expect(decisionBody({ decision: "accept_edited", reason: "", appliesTo: "this_month", lines: [{ account_code: "", amount: "10" }] }).issue).toBeTruthy();
  });
  it("sends a standing item's end month and billing lag", () => {
    expect(decisionBody({ decision: "standing", reason: "", appliesTo: "until_changed", endPeriod: "2027-06", lag: 1 }).body)
      .toEqual({ decision: "standing", applies_to: "until_changed", end_period: "2027-06", bill_lag_months: 1 });
  });
});

describe("small things", () => {
  it("reads amounts and names", () => {
    expect(amountOf("750")).toBe(75000);
    expect(amountOf("7.505")).toBeNull();
    expect(whoSaid("agent:fm1")).toBe("FM1");
    expect(whoSaid("claude")).toBe("Claude");
    expect(whoSaid("platform:accruals")).toBe("os.stza.io");
    expect(isOpen({ decision: "question" })).toBe(true);
    expect(isOpen({ decision: "standing" })).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { isContractsPath, money, whenLabel, dateLabel } from "./contracts";

const id = "0b5c6f0e-1d2a-4b3c-9d8e-7f6a5b4c3d2e";

describe("the paths the browser may reach", () => {
  it("allows the register's own routes", () => {
    for (const p of ["contracts", "contracts/uploads", `contracts/uploads/${id}/read`, `contracts/uploads/${id}/dismiss`, `contracts/${id}`,
      `contracts/${id}/confirm-pattern`, `contracts/${id}/renewal-decision`, `contracts/${id}/end`, `contracts/${id}/schedule`, `contracts/${id}/schedule/${id}`,
      `contracts/${id}/movements`, `contracts/${id}/movements/${id}/withdraw`]) {
      expect(isContractsPath(p)).toBe(true);
    }
  });

  it("refuses anything else, including another section's routes", () => {
    for (const p of ["contracts/../tasks", "tasks", "outstanding-documents", `contracts/${id}/delete`, "contracts/uploads/x/read", `contracts/${id}/schedule/x`]) {
      expect(isContractsPath(p)).toBe(false);
    }
  });
});

describe("labels", () => {
  it("money and dates", () => {
    expect(money(250000)).toBe("£250,000.00");
    expect(money(-12, "USD")).toBe("-USD 12.00");
    expect(dateLabel("2026-10-19")).toBe("19 Oct 2026");
  });

  it("says when, or that no date is set", () => {
    expect(whenLabel({ due_on: "2027-01-30", expected: null, trigger_text: null })).toBe("30 Jan 2027");
    expect(whenLabel({ due_on: null, expected: "early 2027", trigger_text: null })).toBe("Expected early 2027");
    expect(whenLabel({ due_on: null, expected: null, trigger_text: "on installation" })).toBe("Date not set: on installation");
  });
});
